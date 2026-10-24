# TFT 1,8″ + DHT22 sur D3 : mesures à distance par OTA, menu « Mesures » selon le firmware réel (24/10/2026)

Statut : **préparé, compilé, testé sur l'hôte ; jamais flashé ni essayé sur la carte.** La carte cible (`dev_VIRBQRV1`) est chez le porteur, à distance, avec un DHT22 branché sur D3.

## Pourquoi
Le DHT22 est branché sur le TFT 1,8″, pas sur un multiscreen. Le menu « Mesures » du profil apparaissait sur le multiscreen du porteur parce qu'une image expérimentale (`multiscreen-2.8`, 23/10) **déclarait** `sensors:["temp","hum"]` à `/api/register` sans qu'aucun capteur ne soit branché : la déclaration est une *capacité du code*, pas la preuve d'un capteur.

## Règle serveur / interface (déployable seule)
`lib/measures.ts::showsMeasures(device, hasMeasure)` : un appareil **avec écran** n'affiche « Mesures » (profil `DevicesPanel`, vue réseau `networkSnapshot`) que si le firmware a déclaré des capteurs **ET** qu'une vraie mesure a été reçue. Un capteur seul (pseudo-écran `sensor`) reste affiché dès sa déclaration. Conséquences : aucun capteur branché = aucun menu ; firmware sans déclaration = jamais ; le menu apparaît dès la première mesure reçue (≈ 70 s après le démarrage, puis 1 par heure). Test : `tests/sensor.test.ts`. Pas de bouton manuel d'activation : inutile tant que la capacité vient du firmware (à reconsidérer si un capteur doit être choisi par l'utilisateur).

## Firmware TFT 1,8″ (`esp8266/esp_tft1.8`)
Option `POD_SENSOR_DHT22` (0 par défaut ; exige `POD_WIFI_PORTAL`), broche `POD_DHT_PIN` = D3 (GPIO0 ; TFT : D0 RST, D1 DC, D2 CS, D5 SCK, D7 MOSI). Même ordonnanceur que le BWR (`pod_dht22.h`) : première lecture 20 s après le démarrage, lecture toutes les 30 min, envoi toutes les heures (`POST /api/sensor`, le serveur refuse < 50 min), retry 5 min. Le service ne tourne ni avant l'appairage, ni sans Wi-Fi, ni pendant un vote, une observation ou le banc d'essai ; l'envoi exige 18 000 o contigus (sinon reporté). Pas de plans image à libérer (le TFT n'en garde pas en RAM).

**Option à 0 : binaire identique au bit près** au build épinglé de la carte (`tft18-2.9`, séquence 6, SHA `f9eb8e74…`) — vérifié par recompilation le 24/10/2026. Tests : `tests/tftSensor.test.ts` (statique), `otaUndo.ts` (laboratoire : le sketch sans capteur redevient celui d'avant, au texte près).

## Release OTA préparée (non publiée)
`ota-releases/tft18-2.10-ota7/` : **canari ciblé `dev_VIRBQRV1` uniquement**, version `tft18-2.10`, séquence 7, clé `ota-a`, 616 692 o (région signée `58cbfa97…`), image générique sans Wi-Fi, contrôle de pré-publication OK. Mesures statiques : binaire 616 368 o (+ 2 352 o), RAM statique 39 092 o (+ 208 o ; seuil 40 000).

## Risques (à lire avant de publier)
- **Une seule tentative à distance.** Le téléchargement est fait par le firmware ACTUEL (`tft18-2.9`, séquence 6, portail inclus) ; son tas minimal pendant un téléchargement n'est pas mesuré pour ce build (2.8 : 1,2 Ko ; le portail coûte ≈ 370 o de plus ⇒ ≈ 0,8 Ko attendu). Marge très étroite : un échec est possible.
- **Pas de retour arrière automatique.** Après un échec, la carte reste sur son ancienne image ou doit être reflashée par câble sur place.
- **Les OTA suivantes seront encore plus serrées** (RAM statique + 208 o ⇒ environ 0,6 Ko de marge pendant le téléchargement).
- Procédure : le porteur fait la PR, le déploiement, ouvre `ota:kill` (`DEL ota:kill`) pendant la fenêtre d'essai et le referme (`SET ota:kill 1`) ; vérification côté serveur : version déclarée à `register` = `tft18-2.10`, première mesure reçue, menu « Mesures » apparu.
