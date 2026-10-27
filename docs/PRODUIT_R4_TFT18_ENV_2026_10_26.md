# Produit R4 complet : TFT 1,8″ + vote v2 + capteurs + OTA (`r4tft18-2.0`, 26/10/2026)

> **Statut révisé au 28/10/2026** (la chronologie ci-dessous reste historique) : firmware courant `r4tft18-2.3` sur `dev_I25D9Z7A` (TFT 1,8″, DHT22 D2, SGP40 I²C, microSD D4).
> **Observé sur la carte (`M`)** : démarrage, Ed25519, register 200, pull 200, DHT22, SGP40 (brut), SD, une OTA A→B de laboratoire du produit complet (clés de test, HTTP local). **Vote** : un refus signé `blank` (28/10), aucune acceptation ; cause identifiée (règle « blank » R4 plus large que celle de l'ESP), correctif local non flashé.
> **Intégré mais jamais observé** : affichage d'une œuvre du réseau, ACK, lecture d'une animation depuis la SD, indice COV Sensirion face à une référence, pages de courbes sur l'écran (tracé sans erreur de pile seulement).
> **Plan canonique** : `PLAN_RESEAU_VALIDATEURS_ET_STATION_R4_2026_10_28.md`. L'ancien montage ESP8266 + TFT 1,8″ est archivé matériellement mais son profil serveur `tft18` reste pris en charge.

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

## Écran de station (`POD_ENV_DISPLAY`, `POD_SD_CS_PIN`, r4tft18-2.3, 28/10/2026)

Options (0 par défaut) : `POD_ENV_DISPLAY = 1` (exige `POD_SENSORS`), `POD_SD_CS_PIN = 4` (exige `POD_ENV_DISPLAY`). Le TFT alterne toutes les `ENV_PAGE_MS` (60 s pour l'essai) entre :
- une **page relevés** dynamique (température colorée, humidité, air SGP40 brut, Wi-Fi, âge du dernier envoi ; DHT22 lu toutes les 5 s, SGP40 chaque seconde, RSSI toutes les 15 s — pour l'écran seulement) ;
- la **page œuvre** : la dernière œuvre minée reçue du réseau — **animation** jouée depuis la carte SD (clip PBC1, en boucle, `GeoOne<48>` : 128×64 au centre, cartel en haut et en bas) ou **image** redessinée depuis la carte.
Une œuvre qui vient d'arriver s'affiche tout de suite et reste `ENV_PAGE_MS` ; l'alternance reprend ensuite. Au démarrage, la dernière œuvre est redessinée depuis la carte (méta `frame.met`) et n'est pas retéléchargée si le serveur annonce le même `frameId`.
**Enregistrement des mesures inchangé** : lecture toutes les 30 min, UN envoi par heure (le serveur refuse moins de 50 min : `/api/sensor`), pour ne pas saturer Redis ; l'écran lit ses propres mesures vives sans toucher au réseau.
**Cartes SD (module partagé avec le TFT)** : SCK D13, MOSI D11, MISO D12, CS TFT D10, CS SD D4 (tenu haut au démarrage). Chaque ligne d'image est écrite sur la carte AVANT d'être envoyée au TFT (une transaction TFT par ligne, jamais d'accès SD pendant l'une d'elles). Fichiers : `/pod18/frame.bin` (40 960 o), `frame.met`, `anim.pbc` (≤ 9 216 o), `anim.met`. Toute opération SD de haut niveau passe par la pile de travail dédiée.
**Animations** : `lib/anim/pointer.ts` envoie le pointeur `anim` aux appareils `r4tft18-2.3` et plus (comme `tft18-2.2` ESP) ; le clip est téléchargé UNE fois (`/api/block-clip`, ≈ 1 – 9 Ko) sur la carte, validé en flux (mêmes codes que `podbench::parse`), joué sans aucune requête. Sans carte : l'affiche seule, pas d'animation.
**Vote** : un dessin est voté en v2 (relu et recalculé) ; une animation en chemin v1 (écho signé, comme les autres écrans) — jamais validée par recalcul avant le lot 8.
Compilé le 28/10/2026 : 154 716 o de flash, RAM statique 21 764 o (tas libre ≈ 9,5 ko après Ed25519). Sur la carte `dev_I25D9Z7A` : SD lue, DHT22 19,2 °C / 81,9 %, SGP40 33 026, register / pull 200, alternance relevés ↔ œuvre. **Jamais observés : une œuvre reçue (frame, ACK), le vote, un clip d'animation, le rendu visuel (pas de caméra).**

### Pages de l'écran de station (29/10/2026) : valeur + tendance + courbes, indice COV Sensirion

Cycle (une page par `ENV_PAGE_MS`) : **relevés** (valeurs en direct) → **œuvre** (si une image ou un clip est sur la SD) → **température** → **humidité** → **air (COV)** → **synthèse**. Les pages d'historique n'apparaissent qu'avec au moins 3 enregistrements.
- **Pages température / humidité** : valeur, flèche et pente sur les 3 dernières heures (stable sous 0,2 °C/h ou 1 %/h), minimum / maximum, courbe 24 h et, dès que l'historique dépasse 2 jours, courbe 7 jours (30 jours en alternance au-delà de 14 jours). Les plages s'**adaptent** : jamais plus larges que l'historique existant (« depuis 2h10 »), le tracé n'est pas vide parce que la plage demandée est trop grande.
- **Page air** : l'indice COV (1..500, 100 = air habituel du lieu) vient de l'algorithme **officiel de Sensirion** (bibliothèque « Sensirion Gas Index Algorithm » 3.2.3, BSD-3), appelé à 1 Hz sur le brut du SGP40, y compris pendant une animation. Classes indicatives : ≤ 120 bon, ≤ 200 moyen, au-delà élevé. **Tendance globale** : la moyenne du dernier quart de la fenêtre contre les trois quarts précédents (amélioration / stable / dégradation à ±8 points). L'état de l'algorithme est repris après un redémarrage de moins de 10 minutes (enregistré sur la SD toutes les 5 minutes après 3 h de fonctionnement continu, consigne de Sensirion) ; l'apprentissage complet de la ligne de base dure environ 12 h.
- **Synthèse** : les trois grandeurs sur une plage adaptée (24 h, 7 jours, 30 jours, 1 an quand l'historique le permet), une flèche de tendance chacune. La courbe annuelle n'apparaît donc que lorsqu'il existe ≥ 200 jours de données.
- **Serveur** : nouvelle grandeur `vocidx` (indice COV) envoyée avec les mesures (lecture toutes les 30 min, envoi toutes les heures, inchangés) à côté du brut `voc`.
- **Historique** : fichiers `vAAMM.bin` (5 min) et `vh.bin` (horaire) ; les fichiers `d*.bin` / `h.bin` des tout premiers essais (brut SGP40) sont ignorés.
- **Pile réseau** : 2 Ko par défaut (le vote tombait en manque de mémoire à 3 Ko), 3 Ko seulement pour l'image et le clip.
- **Pistes non faites (consignées)** : synchronisation SD ↔ serveur (rattrapage des mesures manquantes après une coupure, restauration de l'historique depuis le serveur sur une carte neuve).
