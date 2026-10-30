# flash-dump-capture.ps1 — capture le vidage de la data flash (lignes « FD … ») d'une UNO R4 sur son port série et l'écrit dans un fichier (HORS Git : il contient la clé privée de l'appareil).
#   .\flash-dump-capture.ps1 -Port COM7 -Out C:\Users\...\dump.log [-Seconds 60] [-ResetAndAsk]
# Sans -ResetAndAsk : écoute seulement (sonde flash_dump_probe, qui vide toutes les 20 s).
# Avec -ResetAndAsk : envoie « FLASH-DUMP » toutes les 300 ms pendant la fenêtre série de 1,5 s du firmware (jusqu'à voir « FD BEGIN ») ; le RESET se fait au BOUTON de la carte (l'impulsion DTR/RTS ne la réinitialise pas).
#   Le port USB natif disparaît puis réapparaît au reset : le script ROUVRE le port tant qu'il le faut.
# Ne fait que LIRE et, pour -ResetAndAsk, envoyer la commande série de lecture seule. Ne téléverse rien.
param([Parameter(Mandatory = $true)][string]$Port, [Parameter(Mandatory = $true)][string]$Out, [int]$Seconds = 60, [switch]$ResetAndAsk)
$ErrorActionPreference = "Continue"
$lines = New-Object System.Collections.Generic.List[string]
$sawBegin = $false; $sawEnd = $false; $reopens = 0
$sp = $null
function Open-Port { $p = New-Object System.IO.Ports.SerialPort $Port, 115200, "None", 8, "One"; $p.ReadTimeout = 200; $p.WriteTimeout = 200; $p.DtrEnable = $true; $p.RtsEnable = $false; $p.Open(); return $p }
$t0 = Get-Date; $lastSend = [datetime]::MinValue; $buf = ""
while (((Get-Date) - $t0).TotalSeconds -lt $Seconds -and -not $sawEnd) {
  if ($null -eq $sp -or -not $sp.IsOpen) { try { $sp = Open-Port; $reopens++ } catch { $sp = $null; Start-Sleep -Milliseconds 200; continue } }
  try {
    if ($ResetAndAsk -and -not $sawBegin -and ((Get-Date) - $lastSend).TotalMilliseconds -gt 300) { $sp.Write("FLASH-DUMP`n"); $lastSend = Get-Date }
    $chunk = $sp.ReadExisting()
  } catch { try { $sp.Close() } catch {}; $sp = $null; Start-Sleep -Milliseconds 100; continue }
  if ($chunk) {
    $buf += $chunk
    while (($i = $buf.IndexOf("`n")) -ge 0) {
      $l = $buf.Substring(0, $i).TrimEnd("`r"); $buf = $buf.Substring($i + 1)
      if ($l -match "^FD BEGIN") { $sawBegin = $true }
      if ($l.StartsWith("FD ") -or $l.StartsWith("[WIFI]") -or $l.StartsWith("FLASH-DUMP")) { $lines.Add($l) }
      if ($l -match "^FD END") { $sawEnd = $true }
    }
  } else { Start-Sleep -Milliseconds 20 }
}
if ($sp) { try { $sp.Close() } catch {} }
[System.IO.File]::WriteAllLines($Out, $lines)
Write-Output ("lignes gardees : {0} ; FD BEGIN vu : {1} ; FD END vu : {2} ; ouvertures du port : {3} ; fichier : {4}" -f $lines.Count, $sawBegin, $sawEnd, $reopens, $Out)
if (-not ($sawBegin -and $sawEnd)) { exit 1 }
