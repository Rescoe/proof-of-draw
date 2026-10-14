# Audit Claude local de `480eacd` + protocole du canari TFT 2,8″ (animation en flux) — 12 octobre 2026

**Statut : préparation. Aucun flash, aucun commit, aucun changement de code.** Worktree `codex/claude-local-resume-2026-10-12` à `224a164`, propre avant ce fichier.

## 1. Toolchain réellement utilisée (installée à part, rien désinstallé ni remplacé)

| Élément | Avant | Utilisé |
|---|---|---|
| Node / npm | 22.12.0 / 10.7.0 | idem ; `npm ci` fait dans le worktree (`node_modules` ignoré par Git) |
| arduino-cli | 1.4.1 (Arduino IDE) | idem |
| Cœurs R4 | 1.6.0 (Arduino15 principal) | `C:\Users\thibf\tools\pod-arduino\data-153` (1.5.3) et `…\data-160` (1.6.0) ; Arduino15 principal intact |
| Bibliothèques | — | `…\tools\pod-arduino\user` : SD 1.3.0, ArduinoJson 7.4.3, Adafruit GFX 1.12.6, ILI9341 1.6.3, STMPE610 1.1.6, BusIO 1.17.4 (installées), Crypto 0.4.0 et QRCode 0.0.1 (copiées de votre dossier) |
| g++ | MSYS2 mingw64 10.2.0 | **WinLibs 14.2.0 UCRT** : `C:\Users\thibf\tools\winlibs-14.2\mingw64\bin\g++.exe` |
| arm-none-eabi-gcc | — | 7-2017-q4 (Arduino officiel) |

**Écart par rapport à la consigne :** MSYS2 UCRT64 n'a pas pu être installé (`pacman` : « signature … unknown trust », trousseau périmé). Le réparer aurait modifié votre MSYS2 existant ; WinLibs a été installé à part à la place. Les variables à poser : `CXX=C:/Users/thibf/tools/winlibs-14.2/mingw64/bin/g++.exe`, `ARDUINO_DIRECTORIES_DATA/USER/DOWNLOADS` vers `…\pod-arduino\…`.

## 2. Compilations réelles (copie temporaire, `secrets.h` factice, dossier du sketch tel quel)

| Cœur | Production (0/0) | Canari (`-DPOD_RENDER_V1=1 -DPOD_CANARY=1`) |
|---|---|---|
| 1.5.3 | OK — flash 157 492 o, RAM 21 468 o | OK — 149 568 o, RAM 21 464 o |
| 1.6.0 | OK — idem | OK — idem |

Aucun avertissement venant du sketch (seulement le cœur et `Crypto`). Le canari ne contient plus `validate-candidate`/`validation-result` et porte « AUCUN VOTE » ; la production les contient. Les tailles diffèrent de celles archivées (165 340 / 21 700) : l'auteur a compilé avec l'`arm-none-eabi-gcc` système d'un bac à sable Linux (`real.sh`), pas avec la chaîne Arduino. **Analyse statique de pile refaite sur mes ELF (gcc 7.2.1) : mêmes valeurs** — lecture 792 o, validation 752 o sur la pile SD de 1 536 o (budget 1 344 o) ; téléchargement 1 040 o sur la pile réseau de 2 048 o (budget 1 856 o). Identique entre 1.5.3 et 1.6.0.

## 3. Tests ciblés (g++ 14.2)

Premier passage dans le worktree : 94 tests, 88 OK, 6 en échec — **tous dus à l'hôte Windows, pas au firmware** :
- `animStream` (2) : la sortie du harnais est en `\r\n`, le test découpe sur `\n` (`'GEOM\r' !== 'GEOM'`).
- `tft28Host` (4) : `struct mallinfo` absente de `<malloc.h>` MinGW (glibc seulement) → le harnais du firmware complet ne compile pas.

Rejoués dans une **copie jetable de `HEAD`** (hors dépôt) avec seulement ces deux ajustements hôte : `animStream` 8/8 ; `tft28Host` 9/10 — firmware complet production, canari, arrêt sûr : OK.
**Reste 1 échec réel :** contrôle négatif « pile SD : échec ignoré (opération présentée comme faite) » → mutant **non détecté**. Identique sur le parent `1bb2512` (test d'origine, mêmes ajustements) : **pas une régression de `480eacd`**. Cause non établie (hôte Windows ou trou de sensibilité du harnais, aucun scénario n'y fait échouer `runSized`). À trancher par GPT/porteur ; je n'ai pas modifié le test.

## 4. Verdict sur « GO canari sans vote, avec réserves » : **CONFIRMÉ**

Points relus et jugés corrects (`pod_bench_stream.h`, `pod_uno_r4.ino` 1701-1850) : tampon fixe 2 048 o ; validation en flux mêmes codes que `parse` ; aucune lecture SD entre `startWrite` et `endWrite` (lot de runs lu avant) ; ordre marqueur supprimé → clip écrit → validé → marqueur écrit en dernier ; tout échec supprime clip et marqueur ; lecture et validation sur une seule pile SD dédiée ; réseau sur la pile réseau dédiée ; `PodBoundedSSL` actif (réception modem bornée) ; aucun vote compilé en canari.

Réserves que j'ajoute à celles de GPT (non bloquantes) :
1. **Pic de tas au téléchargement.** `work` (2 048 o) est alloué AVANT la transaction TLS alors qu'il ne sert qu'à la validation, après. Pic = 2 048 (work) + 2 048 (pile réseau) sur un plus grand bloc de 4 884 o : ≈ 788 o de marge de bloc. Le chemin « frame fixe » validé n'avait pas ce tampon vivant pendant le TLS. Correctif trivial possible (allouer `work` après `netGetBlockClipToSd`) mais **non fait** (pas bloquant, à décider après audit).
2. **Marge de la pile SD pendant la lecture** : statique 552 o, mais le crochet appelle le toucher (STMPE610, appels indirects non vus) et `delay`. Seule la mesure carte tranche (ligne `animPlay`).
3. **Validation refaite à chaque `runResidentAnim`** (2 passes CRC sur ≤ 9 Ko de SD) : voulu, mais coûte du temps SD à chaque cycle ; à observer.
4. Les tests du lot ont été produits sur Linux/autre chaîne ; deux hypothèses de portabilité Windows (CRLF, `mallinfo`) sont à corriger côté dépôt si l'on veut des tests reproductibles ici (hors périmètre tant que GPT n'a pas statué).

## 5. Protocole matériel (porteur) — à n'exécuter qu'après audit GPT

**Préparation locale (rien de commité).** Dans une copie du dossier ou `canary-builds/` (ignoré par Git), avec votre vrai `secrets.h` :
```
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi --build-property "compiler.cpp.extra_flags=-DPOD_RENDER_V1=1 -DPOD_CANARY=1" --output-dir canary-builds/tft28-anim-stream arduino_uno_r4/pod_uno_r4
```
Les drapeaux se passent par `-D` : **inutile d'éditer le `.ino`**, donc rien à remettre à 0/0. Garder le binaire stable précédent (`POD_CANARY=0`) comme retour arrière ; sauvegarde du `.ino` d'avant : `firmware-backups/2026-10-13_avant-animation-flux-tft28/`.

**Étapes et lignes à relever (journal série brut, à me renvoyer en entier) :**
1. Démarrage avec la SD actuelle (clip résident) : `[CANARY] BUILD …` / `AUCUN VOTE` ; `[ANIM] clip trouvé sur la carte` ; **absence** de `[ANIM] mémoire insuffisante` ; `[CANARY] pile sd/tft animValidate` et `animPlay` (utilisée / marge) ; `[CANARY] tas …` (libre, plus grand bloc, fragmentation).
2. Observer 2 min : fluidité, couleurs, aucun reset.
3. Toucher → pause + cartel ; re-toucher → reprise.
4. Envoyer UNE animation personnelle déjà finalisée (aucun dessin soumis au consensus) : `[HTTP GET] /api/block-clip -> 200`, `[CANARY] pile reseau block-clip (reseau + SD)` (**le plus important pour la réserve 1**), `[ANIM] clip reçu en N ms … rangé sur la carte`, `[CANARY] tas apres …`, puis lecture.
5. Reset : la dernière frame revient depuis la SD, puis l'animation reprend.
6. Laisser ≥ 3 pulls au repos (stabilité, aucun `animValidate` en échec).

**Arrêt immédiat :** marge de pile < 128 o (le canari s'arrête seul), reset, écran corrompu, ACK incohérent, boucle de téléchargement, erreur SD répétée, tout message de vote/candidat.
**Verdict suivant :** archiver le journal brut dans `docs/mesures/8B2E_…/` et écrire un verdict matériel séparé ; spécification SD v1 seulement si vert.
