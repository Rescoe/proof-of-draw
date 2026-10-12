# État des branches et des lots 8B — 12 octobre 2026

Cette note distingue la production, les travaux validés sur carte, les travaux prêts mais non testés, et les archives. Elle évite de confondre « local propre » avec « tout fusionné dans `main` ».

## 1. Production et checkout principal

| Élément | Révision | État |
|---|---:|---|
| `main` local | `3239d2e` | propre |
| `origin/main` | `3239d2e` | identique au local |
| production en ligne prise comme référence | `3239d2e` | aucune branche de canari n'est fusionnée |

Le checkout principal reste `C:\Users\thibf\Documents\App-Rescoe\proof-of-draw`. Il ne doit pas servir à reprendre le lot TFT : la reprise se fait dans le worktree isolé indiqué plus bas.

## 2. Worktree de reprise locale

| Élément | Valeur |
|---|---|
| chemin | `C:\Users\thibf\Documents\ChatGPT\ANA\worktrees\proof-of-draw-claude-local-resume` |
| branche | `codex/claude-local-resume-2026-10-12` |
| code firmware courant | `480eacd` — animation TFT 2,8″ en flux depuis la SD |
| notes produit ajoutées | `f8657d8` — preuves de mesure et modèle économique |
| état Git attendu | propre avant toute nouvelle modification |

Cette branche est locale. Elle n'est ni `main`, ni une production, ni une autorisation de déploiement.

## 3. Branches actives ou conservées

| Branche | Révision | Verdict |
|---|---:|---|
| `origin/claude/r4-tft28-canary-8b2d` | `480eacd` | code compilé et testé sur hôte ; animation en flux **jamais flashée** |
| `origin/claude/esp8266-eink29-canary-8b2c` | `e059db3` | canari matériel principal réussi : frame reçue, rendue, affichée, ACK 200 ; stabilité observée |
| `origin/claude/hopeful-noether-ndz9ud` | `1a68a49` | R4 e-ink 2,7″ solo et + OLED prêts ; test matériel reporté, cartes indisponibles |
| `codex/archive-nifty-hamilton-2026-10-12` | `9e62f95` | archive locale d'un vieux worktree Claude ; ne pas reprendre le développement dessus |

L'archive `9e62f95` conserve les 33 fichiers modifiés et 43 fichiers non suivis d'un ancien worktree, sans secret détecté par nom de chemin. Le checkout obsolète a été supprimé après archivage. La branche n'a pas été poussée.

## 4. Verdicts matériels à ne pas perdre

### UNO R4 WiFi + e-ink 2,9″ BWR

- Le défaut historique de pile pendant Ed25519, les appels Wi-Fi, TLS et certains JSON a été localisé puis borné par des piles dédiées.
- La véritable commande `_SSLCLIENTRECEIVE` a été bornée à 240 octets.
- Une frame personnelle de 9 472 octets a été reçue, rendue, affichée et acquittée sur carte sans `abort()`.
- Ces résultats sont déjà dans l'histoire de `main` jusqu'à `265262c`, puis complétés par les travaux de lot non fusionnés.

### ESP8266 + e-ink 2,9″ BWR

- Le canari `e059db3` a reçu une frame personnelle, calculé `frameHash` et `renderHash`, remis le flux au pilote et obtenu un ACK 200.
- BearSSL a fait descendre le tas à 4 000 octets libres, avec un plus grand bloc de 2 776 octets : succès réel, mais marge à surveiller.
- Les trois `e-Paper busy TIMEOUT` pendant l'initialisation restent une réserve distincte du rendu en flux.

### UNO R4 WiFi + TFT 2,8″ tactile + SD

- Le canari FIX2 a affiché et acquitté plusieurs frames personnelles de 153 600 octets.
- Pile principale minimale observée : marge 184 octets ; pile dédiée réseau/SD/TFT : marge 732 à 740 octets.
- Tas après transaction : environ 7 912 octets, plus grand bloc 4 884 octets, fragmentation environ 39 %.
- Le cache SD, le toucher et l'ACK ont fonctionné.
- L'ancien lecteur d'animation échouait proprement car il voulait allouer le clip entier ; l'affiche fixe restait utilisable.
- `480eacd` remplace cette lecture par un téléchargement et une lecture en flux avec un tampon fixe de 2 048 octets. Ce dernier point est **logiciellement prouvé mais jamais testé sur la carte**.

## 5. Ce qui ne doit pas être fait implicitement

- ne pas fusionner les branches Claude dans `main` ;
- ne pas pousser la branche locale de reprise sans demande explicite ;
- ne pas mettre `POD_CANARY=1` ou `POD_RENDER_V1=1` dans un commit ;
- ne jamais commiter `secrets.h`, `.env`, clés, binaires ou sorties de compilation ;
- ne pas propager le lecteur d'animation à d'autres firmwares avant le verdict matériel TFT ;
- ne pas autoriser de candidat ou de vote pendant le canari ;
- ne pas confondre la future archive SD avec une autorité de consensus.

## 6. Ancienne date documentaire

Le lot `480eacd` utilise des chemins et un titre datés du `2026-10-13`, alors que cette reprise est rédigée le `2026-10-12`. Cette incohérence de calendrier provient du lot existant. Elle est conservée pour ne pas réécrire l'historique ; ne pas en déduire qu'un essai matériel a eu lieu le 13.
