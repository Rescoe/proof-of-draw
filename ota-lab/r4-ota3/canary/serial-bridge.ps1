# serial-bridge.ps1 — pont série pour l'orchestrateur du canari OTA-3 (Windows PowerShell 5.1, System.IO.Ports.SerialPort, AUCUNE dépendance).
# Protocole : une ligne JSON par message, sur stdout : {"t":"open"} · {"t":"line","s":"..."} · {"t":"closed","why":"..."} · {"t":"error","s":"..."}.
# Commandes reçues sur stdin (une ligne JSON) : {"cmd":"send","s":"<texte>"} · {"cmd":"close"}. Le pont NE FILTRE PAS les commandes : la liste blanche est appliquée par l'orchestrateur AVANT l'envoi.
# Il n'ouvre qu'UN port, celui donné par -Port, et se termine quand le port disparaît : l'orchestrateur relance alors un nouveau pont sur le port retrouvé.
# LECTURE SANS BLOCAGE (essai matériel du 17/10/2026) : SerialPort.ReadLine() puis BytesToRead rendaient les lignes de la carte avec plusieurs secondes de retard (réponses livrées seulement quand une autre écriture avait lieu).
# Le pont lit donc le flux de base en ASYNCHRONE, découpe les lignes lui-même (UTF-8 exact, y compris sur une frontière de paquet) et traite stdin dans la même boucle.
param([Parameter(Mandatory = $true)][string]$Port, [int]$Baud = 115200)
$ErrorActionPreference = 'Stop'
function Out-Json($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$sp = New-Object System.IO.Ports.SerialPort $Port, $Baud, ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)
$sp.NewLine = "`n"; $sp.ReadTimeout = -1; $sp.WriteTimeout = 2000; $sp.DtrEnable = $true; $sp.Encoding = $utf8
try { $sp.Open() } catch { Out-Json @{ t = 'error'; s = $_.Exception.Message }; exit 3 }
Out-Json @{ t = 'open' }
# CAUSE RACINE (17/10/2026) : [Console]::In.ReadLineAsync() est SYNCHRONE dans Windows PowerShell 5.1 (.NET Framework) — il bloquait la boucle jusqu'à la prochaine commande de l'orchestrateur, d'où des réponses de la carte
# livrées avec une commande de retard. stdin est donc lu en ASYNCHRONE sur le flux brut (exécuté par le pool de threads), et découpé en lignes ici.
$inStream = [Console]::OpenStandardInput()
$ibuf = New-Object byte[] 1024
$inTask = $inStream.ReadAsync($ibuf, 0, $ibuf.Length)
$inAcc = New-Object 'System.Collections.Generic.List[byte]'
$acc = New-Object 'System.Collections.Generic.List[byte]'
$rbuf = New-Object byte[] 1024
$readTask = $sp.BaseStream.ReadAsync($rbuf, 0, $rbuf.Length)   # lecture ASYNCHRONE directe du flux (ReadFile recouvert) : n'attend pas l'événement EV_RXCHAR de SerialPort, qui n'arrive qu'avec retard sur ce pilote USB
try {
  while ($true) {
    if ($readTask.IsCompleted) {
      $n = $readTask.Result
      if ($n -le 0) { Out-Json @{ t = 'closed'; why = 'eof' }; break }
      $acc.AddRange([byte[]]($rbuf[0..($n - 1)]))
      $readTask = $sp.BaseStream.ReadAsync($rbuf, 0, $rbuf.Length)
      while (($i = $acc.IndexOf(10)) -ge 0) {
        $lineBytes = $acc.GetRange(0, $i).ToArray()
        $acc.RemoveRange(0, $i + 1)
        $line = $utf8.GetString($lineBytes).TrimEnd("`r")
        Out-Json @{ t = 'line'; s = $line }
      }
      if ($acc.Count -gt 8192) { $acc.Clear() }
    }
    if ($inTask.IsCompleted) {
      $m = $inTask.Result
      if ($m -le 0) { Out-Json @{ t = 'closed'; why = 'stdin' }; break }
      $inAcc.AddRange([byte[]]($ibuf[0..($m - 1)]))
      $inTask = $inStream.ReadAsync($ibuf, 0, $ibuf.Length)
    }
    while (($j = $inAcc.IndexOf(10)) -ge 0) {
      $cmdLine = $utf8.GetString($inAcc.GetRange(0, $j).ToArray()).TrimEnd("`r")
      $inAcc.RemoveRange(0, $j + 1)
      try { $c = $cmdLine | ConvertFrom-Json } catch { Out-Json @{ t = 'error'; s = 'commande illisible' }; continue }
      if ($c.cmd -eq 'send') { $sp.Write(([string]$c.s) + "`n") }
      elseif ($c.cmd -eq 'close') { Out-Json @{ t = 'closed'; why = 'close' }; $closing = $true; break }
    }
    if ($closing) { break }
    Start-Sleep -Milliseconds 5
  }
} catch { Out-Json @{ t = 'closed'; why = $_.Exception.GetType().Name } }
finally { try { if ($sp.IsOpen) { $sp.Close() } } catch { } }
