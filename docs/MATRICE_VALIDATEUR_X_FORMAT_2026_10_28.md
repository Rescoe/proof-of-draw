# Matrice « famille de firmware × format du candidat » (28/10/2026, générée)

> Règle produit : toute carte qui embarque le moteur de vote relit et recalcule TOUS les formats, quel que soit son écran. Ce tableau est **déduit du code des sketchs** par `tests/helpers/voteFormatMatrix.ts` (jamais écrit à la main) et comparé au fichier par `tests/voteFormatMatrix.test.ts`. Régénérer : `node --import tsx scripts/gen-vote-format-matrix.ts`.

**Niveau de preuve : `C`** (le chemin de vote compilé peut relire le format : le tampon exigé est couvert) + **`H`** (flux et métriques de CHAQUE format égaux à la référence TypeScript sur l'hôte, `tests/podMetrics.test.ts`). **Aucun `M` ni `V2` ici** : « oui » ne dit ni que la mémoire d'une carte réelle suffit pendant un TLS, ni qu'un vote croisé a été observé. Le vote croisé observé sur carte reste à produire (protocole d'essai du plan).

Tampon exigé par le format : OLED 1 024 o, e-ink 2,9″ BWR 4 736 o, e-ink 2,7″ / TFT 1,8″ / TFT 2,8″ aucun.

<!-- MATRIX:BEGIN -->
| Famille de firmware | OLED 0,96″ (1 024 o) | e-ink 2,7″ (5 808 o) | e-ink 2,9″ BWR (9 472 o) | TFT 1,8″ (40 960 o) | TFT 2,8″ (153 600 o) |
|---|---|---|---|---|---|
| **UNO R4 + e-ink 2,9″** — plan noir réutilisé (4 736 o) | oui (tampon 4736 o ≥ 1024 o) | oui (aucun tampon) | oui (tampon 4736 o ≥ 4736 o) | oui (aucun tampon) | oui (aucun tampon) |
| **UNO R4 + e-ink 2,7″** — plan noir réutilisé (5 808 o) | oui (tampon 5808 o ≥ 1024 o) | oui (aucun tampon) | oui (tampon 5808 o ≥ 4736 o) | oui (aucun tampon) | oui (aucun tampon) |
| **UNO R4 + e-ink 2,7″ + OLED** — plan noir réutilisé (5 808 o) | oui (tampon 5808 o ≥ 1024 o) | oui (aucun tampon) | oui (tampon 5808 o ≥ 4736 o) | oui (aucun tampon) | oui (aucun tampon) |
| **UNO R4 + TFT 1,8″ (firmware de base)** — tampon statique (4 736 o) | oui (tampon 4736 o ≥ 1024 o) | oui (aucun tampon) | oui (tampon 4736 o ≥ 4736 o) | oui (aucun tampon) | oui (aucun tampon) |
| **UNO R4 + TFT 2,8″ (production)** — tampon statique (4 736 o) ; le canari de vote de laboratoire, lui, est épinglé sur son seul format | oui (tampon 4736 o ≥ 1024 o) | oui (aucun tampon) | oui (tampon 4736 o ≥ 4736 o) | oui (aucun tampon) | oui (aucun tampon) |
| **UNO R4 + TFT 1,8″ station (r4tft18-2.3)** — tampon au tas, seulement si le format l'exige | oui (1024 o au tas, le temps de la lecture) | oui (aucun tampon) | oui (4736 o au tas, le temps de la lecture) | oui (aucun tampon) | oui (aucun tampon) |
| **ESP8266 + e-ink 2,9″ BWR** — tampon au tas, seulement si le format l'exige (correctif du 28/10) | oui (1024 o au tas, le temps de la lecture) | oui (aucun tampon) | oui (4736 o au tas, le temps de la lecture) | oui (aucun tampon) | oui (aucun tampon) |
| **ESP8266 multiscreen (e-ink 2,7″ + OLED)** — tampon au tas, seulement si le format l'exige | oui (1024 o au tas, le temps de la lecture) | oui (aucun tampon) | oui (4736 o au tas, le temps de la lecture) | oui (aucun tampon) | oui (aucun tampon) |
| **ESP8266 + e-ink 2,7″ seul** — tampon au tas, seulement si le format l'exige | oui (1024 o au tas, le temps de la lecture) | oui (aucun tampon) | oui (4736 o au tas, le temps de la lecture) | oui (aucun tampon) | oui (aucun tampon) |
| **ESP8266 + TFT 1,8″ (archivé, toujours pris en charge)** — tampon au tas, seulement si le format l'exige | oui (1024 o au tas, le temps de la lecture) | oui (aucun tampon) | oui (4736 o au tas, le temps de la lecture) | oui (aucun tampon) | oui (aucun tampon) |
<!-- MATRIX:END -->

Lecture : une famille « au tas » prend 1 024 o ou 4 736 o le temps de la lecture ; un échec d'allocation est une **abstention explicite** (`memoire`), jamais un refus signé. Les profils capteurs seuls ne figurent pas : ils sont exclus du quorum aujourd'hui (capacité de validation explicite : `lib/voteCapability.ts`, aucune famille autorisée).
