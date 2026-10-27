# Produit R4 complet : TFT 1,8″ + vote v2 + capteurs + OTA (`r4tft18-2.0`, 26/10/2026)

Firmware `arduino_uno_r4/pod_uno_r4_tft18_env/pod_uno_r4_tft18_env.ino`. **COMPILÉ seulement** (cœur Arduino renesas 1.6.0) : jamais essayé avec le TFT ni les capteurs branchés. Seul essai matériel : démarrage SANS écran ni capteur sur la carte `dev_I25D9Z7A` (26/10, 22:45 UTC) — clés chargées, auto-test Ed25519 OK (marges 924 / 708 o), `register` 200, `pull` 200 (JSON décodé sur la pile de travail), `[DHT22]` et `[SGP40]` « lecture impossible » (rien de branché). **Aucune frame reçue, aucun vote, aucun ACK, aucun OTA de ce produit n'ont été observés.**

## 1. Provenance (script `scripts/gen-tft18-env.js`, à titre de traçabilité)
- base : `pod_uno_r4_tft18` (affichage TFT 1,8″, cartel, clés Ed25519, vote v2, ACK, obs-confirm, blocs possédés) ;
- correctifs de mémoire VALIDÉS sur carte dans d'autres firmwares R4, transplantés : client TLS **borné** (`PodBoundedSSL`), `register` / `pull` / `validate` décodés **sur la pile de travail** (`podWorkRun`, tout le JSON), en-têtes `podNetStack.h` / `pod_http.h` récents ;
- propre à ce produit : enveloppes d'affichage `tftStatus` / `drawCartel` / QR / clés **sur la pile de travail** (la pile principale n'a que 1 024 o), pile réseau de 3 072 o (le flux de l'image s'écrit dans la transaction TLS) ;
- de la station : capteurs DHT22 + SGP40 (`POD_SENSORS`) et client OTA (`POD_OTA_R4`).
Le `.ino` généré est la source de vérité (il se modifie à la main).

## 2. Drapeaux (`pod_build_flags.h`, ignoré par git) et mesures de compilation
| Configuration | Flash | RAM statique (reste) |
|---|---|---|
| défaut (tout éteint) | 135 688 o (51 %) | 20 864 o (11 904 o) |
| `POD_SENSORS=1` + `POD_OTA_R4=1` | 148 448 o (56 %) | 21 704 o (11 064 o) |
| `POD_RENDER_V1=1` | 138 248 o (52 %) | 21 424 o (11 344 o) |

Référence : le firmware TFT 1,8″ d'origine = 131 664 o / 20 864 o. L'éditeur de liens refuse un tas inférieur à 8 Ko (c'est ce qui a imposé les tampons OTA au tas).

## 3. Câblage (R4 en logique 5 V)
TFT 1,8″ ST7735 : VCC → 3,3 V · GND · CS **D10** · RESET **D8** · DC **D9** · MOSI **D11** · SCK **D13** (rien d'autre dessus). DHT22 : 5 V · GND · DATA **D2**. SGP40 Grove : 5 V · GND · **SDA/SCL**. Détails et ordre des broches du DHT22 : `STATION_MONITORING_R4_2026_10_26.md`.

## 4. Identité et serveur
Écran serveur **`tft18`**, firmware `r4tft18-2.0` : capable de voter (`VOTE_V2_FIRMWARE`, `r4tft18 ≥ 1.1`), donc **compté dans le quorum dès qu'il est appairé et actif**. Avec `POD_SENSORS=1` il déclare `sensors=[temp,hum,voc,rssi,lat,dl]` et envoie ses mesures à `/api/sensor` (toutes les heures, 8 commandes Redis par envoi). Une carte déjà enregistrée comme capteur (`screens=["sensor"]`) qui reçoit ce firmware devient un écran `tft18` : l'appareil change de nature côté serveur.

## 5. Protocole du premier essai (carte seule d'abord)
1. `secrets.h` (Wi-Fi 2,4 GHz) ; compiler avec le dossier tel quel ; téléverser ; moniteur série 115200 (DTR). Attendu : `[KEYS]`, `[SELFTEST] Ed25519 … OK`, `[REGISTER]`, `[PULL]`.
2. Brancher le TFT : au `register` non appairé, QR d'appairage ; sinon `tftStatus`. Envoyer une œuvre « Afficher sur mon écran » : attendre `[FRAME] OK` puis `[ACK] … OK`. Surveiller `[TFT] … pile de travail dédiée` (marge) et `[FRAME] pile réseau dédiée`.
3. Vote : attendre `[VALIDATE2] … verdict` puis HTTP 200 (`blockMined`), en production directe. **Arrêt** au premier `GUARD`, redémarrage en boucle, ou `calcul impossible`.
4. Capteurs (drapeau à 1) : `[DHT22]`, `[SGP40]` ; premier envoi dans la minute après appairage. OTA (drapeau à 1, clés de publication compilées) : voir `OTA_R4_CLIENT_ET_PUBLICATION_2026_10_26.md`.
Si l'écran reste noir : vérifier D13 (SCK) et RESET ; la bibliothèque Adafruit ST7735 initialise en `INITR_BLACKTAB`, rotation 0 (comme le firmware d'origine).

## 6. Ce qui n'est PAS prouvé
Tout l'affichage (TFT, cartel, QR) · le flux de l'image dans la transaction TLS (marge de la pile réseau) · le vote v2 du TFT 1,8″ (la lecture d'un candidat de n'importe quel écran utilise un tampon statique de 4 736 o) · l'ACK · les enveloppes `podWorkRun` du TFT · les capteurs avec le TFT · l'OTA de ce produit · la cohabitation capteurs + vote (cadences indépendantes ; un envoi de capteur bloque ≈ 3 s). Ce produit est un candidat de laboratoire activable par drapeaux, pas une version stable.

## Écran de station (`POD_ENV_DISPLAY`, 28/10/2026) — essai de laboratoire

Option `POD_ENV_DISPLAY = 1` (0 par défaut, exige `POD_SENSORS`) : le TFT alterne toutes les `ENV_PAGE_MS` (60 s pour l'essai) entre une **page mesures** (température, humidité, air SGP40 brut, Wi-Fi, âge du dernier envoi) et une **page animation** (3 anneaux qui respirent, couleur = température ; cœur = humidité ; 6 points en orbite, plus vifs si l'air est chargé). Une œuvre reçue reste `ENV_PAGE_MS` à l'écran, puis l'alternance reprend (aucune copie de l'image n'est gardée : la SD en sera le cache). Lectures vives pour l'écran seulement (DHT22 / 5 s, SGP40 / 1 s, RSSI / 15 s) ; le tampon d'envoi (lecture 30 min, envoi 1 h) est inchangé. L'« animation » est **locale et générée par les mesures**, ce n'est pas un clip du consensus (le client d'animations R4 TFT 1,8″ n'existe pas).
`POD_SD_CS_PIN` (0 par défaut) : broche CS du lecteur SD du module, tenue haute pour le garder muet sur le bus SPI partagé (SCK D13, MOSI D11, MISO D12 ; la SD n'est pas encore utilisée).
Mesuré le 28/10/2026 sur la carte `dev_I25D9Z7A` : compile 147 508 o de flash, RAM statique 21 124 o ; DHT22 19,3 °C / 79,9 %, SGP40 32 680 ticks ; pages mesures ↔ animation à 7 s, 67 s, 127 s (alternance de 60 s), aucun redémarrage sur ≈ 4 min. **Rendu visuel non constaté par moi** (pas de caméra) : à confirmer par l'œil. Frame / ACK / vote toujours jamais observés.
