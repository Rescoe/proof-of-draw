# Mesures des appareils — capteur de température/humidité UNO R4 WiFi + DHT22 (12/10/2026)

Une carte (avec ou sans écran) envoie des **mesures** à PoD ; elles sont visibles dans **Mon profil** (carte de l'appareil → « 🌡 Mesures »), dans la **Topologie** et dans la **Constellation** (clic sur l'appareil). La R4 DHT22 ne calcule rien, ne vote pas, n'affiche rien.

> Le sketch n'a pas pu être compilé dans la session cloud (pas de chaîne ARM) ; **le porteur l'a compilé, flashé, appairé et validé sur la carte** (`21.1 C, 71.9 %` puis `19.7 C, 74.0 %` avec `/api/sensor -> 200`, 12/10/2026). Le serveur, lui, n'avait pas encore la route : le **404** de `/api/sensor` venait de là (site non déployé avec ce code), pas de Redis — Redis crée les clés à la première écriture, rien à préparer. Le corps de ce 404 (page HTML) dépasse aussi le tampon de réponse du firmware (511 o) : d'où « corps incomplet » (−3).

## Validation matérielle (12/10/2026)

Firmware `r4dht22-1.1` sur la carte du porteur, serveur déployé avec le modèle de mesures. Journal série :

```
[HTTP POST] /api/register -> -2        (1re tentative : TLS impossible, transitoire)
[REGISTER] échec — nouvel essai dans 5 s
[HTTP POST] /api/register -> 200
[REGISTER] deviceId=dev_I25D9Z7A paired=oui
[BOOT] prêt — une mesure toutes les 5 min
[DHT22] 19.7 C, 74.0 %
[HTTP POST] /api/sensor -> 200
[SENSOR] mesure envoyée
```

Le chemin complet fonctionne : lecture DHT22 → `/api/sensor` 200 → stockage. Le `-2` initial est absorbé par la boucle de ré-essai (5 s). **Non encore éprouvé** : coupure Wi-Fi/Internet prolongée, fonctionnement sur plusieurs jours (fuite de tas éventuelle), affichage dans la topologie/constellation (à confirmer à l'œil).

## Ce que fait — et ne fait pas — cet appareil

- Il **ne reçoit aucune frame, ne vote pas, ne calcule rien** : pas de `pull`, pas de `pull-frame`, pas de validation ; il n'est dans aucune pool d'écran. Il fait : Wi-Fi → inscription (`/api/register`) → lecture DHT22 → `POST /api/sensor`.
- **Reprise après coupure** (par le code, non testée sur une longue panne) : Wi-Fi perdu → `WiFi.begin` répété toutes les 5 s jusqu'au retour, puis mesure immédiate ; serveur/Internet injoignable → nouvel essai 5 min après ; code d'appairage changé → 403 → ré-inscription automatique ; Wi-Fi absent au démarrage → redémarrage de la carte. Les mesures de la période de coupure sont **perdues** (pas de tampon local). Aucun chien de garde matériel : un blocage dur du module Wi-Fi exigerait un redémarrage manuel.
- Mise à jour du firmware : **manuelle (câble USB)** ; l'OTA n'existe pas encore (lot 8 du plan de travail).

## Modèle de données (générique, pensé pour d'autres capteurs)

| Élément | Choix |
|---|---|
| Série | **une liste Redis par appareil** : `meas:{deviceId}` ; une entrée = un instant + une ou plusieurs grandeurs : `1760000000;temp=211;hum=719` (dixièmes d'unité, ≈ 25 o) |
| Grandeurs | registre `MEASURE_KINDS` (`lib/measures.ts`) : `temp` (°C, −40..80), `hum` (%, 0..100). **Ajouter un capteur = une ligne** (étiquette, unité, plage), aucune route ni clé à changer |
| Qui mesure | une carte **sans écran** s'enregistre avec `screens = ["sensor"]` (pseudo-écran, jamais affiché comme écran) ; une carte **avec écran** déclare `sensors = ["temp", …]` à `POST /api/register` (champ `sensors` de la fiche) — elle garde ses écrans, ses pools et son rôle de validateur |
| Rétention | 744 mesures par appareil (31 jours à 1/h ; ≈ 62 h pendant l'essai à 5 min), `EXPIRE` 40 j |
| Horloge | celle du **serveur** (les cartes n'en ont pas) |
| Index | `meas:devices` (SET des appareils qui mesurent) : lu par la vue réseau |

## Routes

- `POST /api/sensor` `{deviceId, pairCode, m:{temp:211, hum:719}}` (l'ancien `{c, h}` du firmware 1.0 est accepté). Exige : code exact, appareil déclarant des grandeurs, **appairé**. Appareil inconnu et code faux donnent la **même** réponse 403 (le firmware se ré-inscrit seul). Anti-rafale `SET NX` (voir cadence).
- `GET /api/sensor?deviceId=…&hours=…` : historique (jusqu'à 31 jours) du **propriétaire** (cookie).
- `GET /api/sensor?deviceId=…&public=1` : **48 h** pour la vue réseau (appareils présents dans `meas:devices` seulement), mis en cache par le CDN 2 min.

## Visibilité dans l'application

- **Profil** : bouton « 🌡 Mesures » (valeur courante, période 24 h / 7 j / 31 j, courbe par grandeur, tableau horaire). Pas de « Dessiner/Animer » ni de réglages d'affichage pour un capteur seul. La page `/draw/…/sensor` affiche « Capteur sans écran » au lieu de « Écran inconnu ».
- **Repérage visuel** (12/10/2026) : un capteur seul est un **losange ambre** (les appareils à écran restent des cercles : bleus en topologie, couleur de famille en constellation), avec une entrée « capteur » dans la légende de la constellation.
- **Topologie** : nœud « CAPTEUR » avec la dernière mesure (« 21,1 °C · 71,9 % »). **Constellation** : nœud 🌡 avec la même ligne. **Panneau latéral** (clic) : section « Mesures » (valeurs, âge), bouton « Voir les dernières 48 h » (courbe) ; aucune lecture de bloc ni d'activité pour un capteur.
- **Lisibilité de la vue réseau (12/10/2026)** — *Topologie* : le rayon de chaque anneau est dicté par le nombre de nœuds (espacement d'arc ≥ 170 × échelle, anneaux écartés d'au moins 185 × échelle) ; le **monde s'agrandit** (facteur ≤ 4) quand le cadre ne suffit pas, la vue initiale le cadre en entier, le zoom arrière descend à 15 % ; les écrans satellites sont un peu plus éloignés de leur appareil. *Constellation* : plus de respiration entre artistes (rayon +15 %, marge des libellés 50 → 90). *Constellation, tactile* : un doigt posé sur un appareil participe désormais au **pincement** (avant, seuls les doigts posés dans le vide comptaient) ; un glissement qui part d'un appareil déplace la vue (seuil 8 px, sinon c'est un clic), et le clic qui suit un glissement ou un pincement est ignoré (aucune sélection involontaire).
- La dernière mesure vient du **snapshot réseau** (1 `SMEMBERS` + un pipeline de `LINDEX` par reconstruction, ≤ 1 / 5 min) : au plus ≈ 5 min de retard. Un capteur est « en ligne » s'il a mesuré depuis < 2 h 30.
- Les températures sont donc **publiques** (dernière valeur + 48 h) pour les appareils qui mesurent ; l'historique long reste privé.

## Diagnostic de la liaison Wi-Fi (12/10/2026)

Chaque mesure embarque deux grandeurs de diagnostic, **dans la même entrée Redis (aucune commande de plus)** : `rssi` (puissance du signal reçu, dBm entier, −127..0 ; −50 excellent, −70 correct, −85 limite) et `lat` (temps de réponse du serveur au DERNIER envoi réussi, ms). Elles apparaissent dans « 🌡 Mesures » du profil (boutons de grandeur, courbe, tableau) et dans la section « Mesures » du panneau réseau, **pas** sur les nœuds (seules température et humidité y sont, `primary` dans `MEASURE_KINDS`).

- « Connectée ou non » : déjà visible (pastille en ligne/hors ligne = dernière mesure < 2 h 30). Une coupure se lit comme un trou dans la courbe.
- **Débit : non mesuré** — il exigerait un transfert de test à chaque mesure (bande passante, commandes Redis, temps d'éveil) pour un bénéfice faible ; `lat` + `rssi` en donnent une image suffisante. À reprendre si besoin.
- La carte doit se **ré-inscrire** (redémarrage après reflash) pour déclarer `rssi` et `lat` (`sensors` à `/api/register`) ; avant cela le serveur ignore ces deux champs.

## Cadences : lecture 30 min, envoi 1 h, tampon (firmware `r4dht22-1.3`, 12/10/2026)

- **Température et humidité : LUES toutes les 30 min** (48 points/jour), **ENVOYÉES toutes les heures**, deux lectures par envoi. Le coût Redis d'un envoi est de 8 commandes **quel que soit le nombre de lectures** (un seul `LPUSH` à plusieurs valeurs) : **192 commandes/jour ≈ 5 800/mois** et par capteur (≈ 3 % du plan de 200 k) — au lieu de 11 500 pour un envoi à chaque lecture.
- **Tampon** : les lectures restent en RAM (12 au plus = 6 h) tant que le serveur ne les a pas stockées (`"stored":true`) ; **une coupure Internet ne fait donc plus perdre de points** (les lectures continuent pendant la coupure et partent au retour du réseau). Chaque lecture porte son **âge** à l'envoi ; le serveur calcule l'heure (`t = maintenant − âge`). Une réinitialisation de la carte perd les lectures non envoyées.
- **Connexion de la carte** (une fois par envoi, joint au même POST, rattaché à la lecture la plus récente) : `rssi` (signal, dBm : −50 excellent, −70 correct, −85 limite), `lat` (temps de réponse du DERNIER envoi, ms) et `dl` (**débit**, kbit/s). Le débit est le temps de lecture de `public/speedtest.bin` (4 096 o, **fichier statique du CDN** : aucune commande Redis, aucune fonction serveur), lu par blocs de 240 o par le client borné `PodBoundedSSL` : c'est le débit **effectif de bout en bout** (Internet + Wi-Fi + module + UART de la carte), pas la capacité de la box. `SPEED_EVERY_N_POSTS` règle sa fréquence (1 = chaque heure, 2 = toutes les 2 h).
- **Pas de « temps réel »** : la valeur affichée est celle du dernier envoi (au plus 1 h + 30 min de retard). Un affichage vraiment instantané coûterait une requête de la carte à la demande (non prévu : la carte ne reçoit rien du serveur) ou un sondage serveur.
- **Persistance « par-dessus »** : le diagnostic vit DANS l'entrée de la lecture : aucune commande de plus, aucune série dédiée, effacé quand l'anneau de 31 jours (1 488 entrées) fait le tour.
- Serveur : envois espacés d'au moins **50 min** (`MEASURE_MIN_INTERVAL_SEC = 3000`) ; si l'anti-rafale refuse, la carte **garde** ses lectures et réessaie 5 min plus tard. « En ligne » = dernière lecture de moins de 2 h 30. Risque connu : si la réponse d'un envoi est perdue après stockage, les mêmes lectures peuvent être renvoyées (doublons rares, non filtrés pour ne pas ajouter de commande Redis).

## Affichage (profil et vue réseau)

- **Carte de l'appareil sans écran** : plus de pastille d'écran, de « Conversion », de compteur de frames ni de « ping » ; elle affiche **la dernière température/humidité**, la **ligne Connexion** (signal · latence · débit) et « dernière mesure il y a… ». Le point vert/rouge suit la dernière mesure (pas la fiche, réécrite seulement toutes les 12 h). Le résumé vient de `GET /api/devices` (1 `LINDEX` par capteur, un pipeline).
- **« 📈 Historique »** : deux parties séparées — « 🌡 Température et humidité » et « 📶 Connexion de la carte » (courbe + tableau chacune), période 24 h / 7 j / 31 j.
- **Panneau latéral du réseau** : mêmes deux parties (valeurs du snapshot, courbes 48 h à la demande).

## Cadence et PHASE D'ESSAI

- Firmware : `READ_INTERVAL_MS = 1800000UL` (lecture) et `POST_INTERVAL_MS = 3600000UL` (envoi) ; l'essai à 5 min utilisait `300000UL`.
- Serveur : intervalle minimal **240 s** jusqu'au **16/10/2026 00:00 UTC**, puis **3 000 s** (50 min) automatiquement (`MEASURE_TEST_UNTIL_MS`, extinction de l'essai : règle « mode test » de CLAUDE.md). Le firmware est maintenant à 1 h : aucune action avant cette date.
- Pour prolonger l'essai : changer `MEASURE_TEST_UNTIL_MS` (une ligne) ; pour revenir à 1 h plus tôt : reflasher, et mettre la date à une valeur passée.

## Quota Redis (règle PRIMORDIALE)

Par POST accepté : limite IP 2 + lecture appareil 1 + anti-rafale 1 + `LPUSH/LTRIM/EXPIRE/SADD` 4 = **8 commandes** (la fiche n'est réécrite que toutes les 12 h). **Production (envoi horaire de 2 lectures) : 192/jour ≈ 5 800/mois** et par capteur (≈ 3 % du plan mensuel de 200 k). Le profil lit en plus 1 `LINDEX` par capteur à chaque chargement de la liste. L'essai à 5 min avait coûté ≈ 2 300/jour. Historique : 1 `LRANGE` (ouverture du panneau, ou clic « 48 h » ; les réponses publiques sont mises en cache 2 min côté CDN). Snapshot réseau : + 1 `SMEMBERS` et N `LINDEX` par reconstruction. Un redémarrage en boucle ne coûte qu'une commande utile (l'anti-rafale refuse le reste).

## Garde-fous (tests : `tests/sensor.test.ts`)

- **Quorum** : une carte à pseudo-écran « sensor » n'entre **jamais** dans `devices:all` ni dans une pool d'écran, et `getGlobalActiveCount` / `getPoolSnapshot` **l'ignorent** même s'il y est (entrée créée avant le correctif : à son prochain enregistrement, 2 `SREM` la retirent de `pool:screen:sensor` et `devices:all`). Sinon un capteur appairé « actif » gonflerait le quorum et pourrait bloquer le minage.
- Onboarding : un capteur renvoie vers `/profile`.

## Mise en service (rappel)

1. Câblage : DHT22 **VCC → 3,3 V**, **GND → GND**, **DATA → D2** (+ 10 kΩ DATA↔3,3 V si le module n'en a pas).
2. `arduino_uno_r4/pod_uno_r4_dht22/` : `secrets.h` (Wi-Fi 2,4 GHz), ArduinoJson, carte « Arduino UNO R4 WiFi », téléverser.
3. Moniteur série 115200 : `[PAIR] Code d'appairage : XXXXXXXX` → Mon profil → « + Ajouter un ESP » (ou `/onboard`). Un capteur déjà appairé n'a rien à refaire : il se ré-inscrit avec la nouvelle version et déclare `sensors`.
4. Journal normal : `[DHT22] 21.1 C, 71.9 %` puis `[SENSOR] mesure envoyée`. `[SENSOR] 404 : la route /api/sensor n'existe pas…` = site pas encore déployé ; `refusé (403)` = code changé ou appareil supprimé (la carte se ré-inscrit seule).

## Limites

- Timing du DHT22 (impulsions mesurées par `micros()`, interruptions actives) : 3 tentatives, somme de contrôle ; sinon passer à la bibliothèque Adafruit « DHT sensor library ».
- Mesures horodatées à la **réception** : une coupure Wi-Fi = un trou. Cartes AVEC écran qui mesurent : le modèle et le serveur sont prêts (`sensors`), **aucun firmware d'écran ne mesure encore**.
- Les températures sont publiques dans la vue réseau (dernière valeur + 48 h) ; pas encore d'interrupteur de confidentialité par appareil.
- Écrit sans pouvoir tester l'interface dans un navigateur : vérifié par `tsc`, ESLint et tests, pas à l'œil.

## Rollback

`git revert` des commits du capteur ; les listes `meas:*` expirent seules (40 jours) ; `meas:devices` peut être supprimé à la main.

## Station R4 TFT 1,8″ : relevés de 5 min poussés toutes les 30 min (29/10/2026)

- Firmware `r4tft18-2.5` (option `POD_ENV_DISPLAY`) : **un relevé toutes les 5 min** (même rythme que l'historique de la carte SD) et **un seul POST toutes les 30 min** contenant tous les relevés de la période (≈ 6 ; tampon de 48 = 4 h de coupure rattrapées). Les autres firmwares (DHT22 seul, BWR…) gardent lecture 30 min / envoi 1 h.
- Serveur : intervalle minimal entre deux envois **25 min** (`MEASURE_MIN_INTERVAL_SEC = 1500`, avant 50), `MEASURE_BATCH_MAX = 64`, `MEASURE_KEEP = 4 032` entrées (14 jours à 5 min ; 84 jours à 30 min, TTL 40 j).
- **Coût Redis** : inchangé par envoi (≈ 8 commandes : gate `SET NX`, un `LPUSH` pour tout le lot + `LTRIM` + `EXPIRE` + `SADD`, présence rare) ; l'envoi passe de 1 h à 30 min : ≈ **11 500 commandes/mois** pour la station (contre ≈ 5 800), pour six fois plus de points. Lecture d'historique : 1 `LRANGE` (≈ 140 Ko pour 4 032 entrées), mise en cache (CDN 2 min en public, 60 s en privé).
- Interface : le profil du **propriétaire** utilise désormais le même explorateur que le profil public (Graphique · Œuvre · Interprétation, `MeasuresExplorer owner`) ; le tableau des relevés reste sous « Tableau des relevés » (288 lignes les plus récentes).
- Écran de la station : courbes **continues et lissées** (`histSmoothCurve`, jointure des colonnes vides, lissage 1-2-3-2-1, trait de 2 px), valeurs **min / max réelles** à gauche et repères blancs sur ces deux points. Compilé, non vu sur l'écran avant le flash.
