# Firmwares opérationnels (vote v2 réel) et archives — 15/10/2026

Rangement demandé par le porteur : les versions flashées pour le vote réel sont les versions **canoniques** de leurs dossiers du dépôt ; les anciennes restent archivées ; le ménage final viendra plus tard. **Aucun firmware modifié, aucun flash, aucune suppression.**

## 1. Constat
Le dossier local `A_TELEVERSER/` (ignoré par git, contient les `secrets.h` Wi-Fi) est une **copie** : ses 4 sketches sont **identiques, au retour à la ligne près**, aux dossiers correspondants de `main` (`f6f648e`) — vérifié fichier par fichier (`diff --strip-trailing-cr`, hors `secrets.h`). Les versions opérationnelles sont donc déjà « rangées » dans leurs dossiers respectifs :

| Appareil | Dossier canonique (sur `main`) | `FIRMWARE_VERSION` déclarée | Carte | Vote v2 observé sur la carte |
|---|---|---|---|---|
| TFT 2,8″ tactile + SD | `arduino_uno_r4/pod_uno_r4/` | `r4tft28-2.5` | UNO R4 WiFi | blocs #100, #103, #104 |
| Multiscreen e-ink 2,7″ + OLED | `esp8266/esp_eink_2.7BW_OLED/` | `multiscreen-2.5` | NodeMCU ESP-12E | bloc #103 |
| e-ink 2,9″ BWR | `esp8266/esp_eink_2.9BWR/` | `eink29bwr-2.3` | NodeMCU ESP-12E | blocs #101, #104 |
| e-ink 2,9″ BWR | `arduino_uno_r4/pod_uno_r4_eink29/` | `r4eink29-1.1` | UNO R4 WiFi | blocs #100, #101, #103 |

Drapeaux de canari / rendu / vote : tous à 0 (ou indéfinis) dans le dépôt ; `secrets.h`, `pod_vote_pins.h` et `pod_preview_host.h` ne sont jamais commités.

## 2. Instantané archivé
`firmware-backups/2026-10-15_operationnel-vote-v2/` : copie **complète et sans secret** des 4 sketches ci-dessus (78 fichiers, 1,8 Mo), avec `MANIFEST.sha256`. Elle fige l'état **exact** qui a voté (blocs #100–#104) : même si les dossiers du dépôt évoluent ensuite (OTA, nouveaux lots), la version flashée reste récupérable. Empreintes des `.ino` (fins de ligne LF, telles que versionnées) :

| Sketch | SHA-256 |
|---|---|
| `pod_uno_r4.ino` (TFT 2,8″) | `632a9eb44299753276bf8075d237f3999146b0db7c52caf57c8f44874ac5e17d` |
| `esp_eink_2.7BW_OLED.ino` | `26723022946b24a32bf04489c85b282adc68b02e06788402b14bf03acc688cd9` |
| `esp_eink_2.9BWR.ino` | `a5fb4bdb19432cb7678dbd823e748911383b3024927158b0e6599a20c08e3df7` |
| `pod_uno_r4_eink29.ino` (R4) | `09e28db97a748028d7ce4366933b1baef24d8dfa12b2884dd1920eed7f98d435` |

Note : le TFT 2,8″ flashé contient TFT28-ACK-STATE-FIX1 (commit `c4be328`), validé sur la carte le 15/10/2026.

## 3. Les anciens : déjà archivés, rien déplacé
Les versions antérieures sont les **32 instantanés datés** `firmware-backups/2026-10-03_… à 2026-10-14_avant-ack-state-fix1/` (chacun = l'état d'un sketch **avant** un lot) et l'historique git. Je ne les ai **pas déplacés ni supprimés** : des tests d'identité les lisent par chemin. Pour le ménage final, **à conserver tant que ces tests existent** :

`2026-10-13_avant-vote-v4-canary` · `2026-10-12_avant-canari-tft28` · `2026-10-09_avant-netstack-fix1` · `2026-10-08_avant-correctif-pile-ed25519-r4` · `2026-10-14_avant-preview-enroll` · `2026-10-13_avant-canari-esp8266-eink27-oled` · `2026-10-12_avant-fix2-esp8266-eink29` · `2026-10-12_avant-canari-esp8266-eink29` · `2026-10-11_avant-pullframe-bounded-ssl-fix1` · `2026-10-08_avant-rendu-v1-canaris` · `2026-10-08_avant-propagation-8b2b1`

Les 21 autres (avant-animation, avant-validation-v2…, phases d'audit du canari R4, etc.) ne sont référencés par aucun test : candidats au ménage — **après** décision du porteur (ils restent de toute façon dans l'historique git). Recommandation : garder aussi `2026-10-14_avant-ack-state-fix1` (dernier état du TFT avant sa version actuelle, utile au retour arrière), non référencé par un test.

## 4. Dossiers du dépôt qui ne sont PAS des versions opérationnelles du vote
`arduino_uno_r4/pod_uno_r4_eink27`, `pod_uno_r4_eink27_oled`, `pod_uno_r4_tft18` (code de vote compilé, jamais essayé sur la carte), `esp8266/esp_eink_2.7BW` (solo), `esp8266/esp_tft1.8` (idem), `arduino_uno_r4/tft_shield_test` (outil d'essai). `arduino_uno_r4/pod_uno_r4_dht22/` est le firmware du capteur (`r4dht22-1.3`, validé le 12/10/2026) : opérationnel, mais hors vote.

## 5. `A_TELEVERSER/` (local, non versionné)
Copie redondante des 4 sketches **plus** les `secrets.h` réels. Non supprimée. À supprimer au ménage final (le guide `docs/GUIDE_TELEVERSEMENT_4_APPAREILS_2026_10_14.md` reste valable : mêmes sources). Remarque : le `secrets.h` de `A_TELEVERSER/1_…/` et celui de `arduino_uno_r4/pod_uno_r4/` diffèrent (fichiers locaux ignorés par git) ; idem pour le R4 e-ink 2,9″ — vérifier lequel contient le bon Wi-Fi avant de supprimer l'un des deux.

## 6. Procédure de ménage (quand le porteur le décidera)
1. Garder `firmware-backups/2026-10-15_operationnel-vote-v2/`, les 11 instantanés référencés par des tests (§ 3) et `2026-10-14_avant-ack-state-fix1`.
2. Supprimer `A_TELEVERSER/` après avoir copié les `secrets.h` utiles dans les dossiers du dépôt.
3. Lancer `npm test` (tests d'identité) avant et après.
