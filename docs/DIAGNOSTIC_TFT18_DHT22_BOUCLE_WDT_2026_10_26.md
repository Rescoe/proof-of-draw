# TFT 1,8″ + DHT22 : boucle de redémarrage, reflash, DHT22 muet (26/10/2026, soir)

Appareil : `dev_VIRBQRV1` (COM4). Faits mesurés sur la carte, par Claude, après l'arrêt de la session GPT (limite d'usage atteinte).

## 1. Constats
1. **La carte était en boucle de redémarrage** (`Soft WDT reset`, Exception 4, toutes les ≈ 16 s), toujours juste après `[WIFI] IP` et avant `[HEAP] après WiFi` (donc pendant `tftStatus`). Reproduite avec ET sans DHT22 branché : **le capteur n'est pas en cause**. Le binaire laissé par la session précédente (build local non publié) était fautif.
2. **Reflash de l'image officielle `ota-releases/tft18-2.10-ota7/image.bin`** (région signée de 616 432 o, sans le trailer de 260 o, à l'adresse 0, `esptool` du cœur 3.1.2, hash vérifié) : démarrage complet (register 200, pull, `[DHT22] actif`), **0 WDT sur 75 s**, EEPROM (Wi-Fi, clés) conservée. C'est maintenant le firmware sur la carte.
3. **DHT22 muet** : `[DHT22] lecture impossible` avec le capteur branché. Sonde dédiée (`dhtprobe`, hors dépôt, flashée puis retirée) : la ligne D3 repose à l'état haut (rappel interne ET sans rappel : la carte a son propre rappel sur GPIO0, ce n'est donc PAS une preuve de présence du capteur), mais après l'impulsion de départ de 5 ms **0 transition sur 9 essais**, trois fois de suite (après reserrage, puis rebranchement soigné). Le capteur ne tire jamais la ligne.
4. **Il a pourtant fonctionné** : une mesure est stockée sur le serveur (`GET /api/sensor?deviceId=dev_VIRBQRV1&public=1`) : 19,2 °C / 90,2 %, 26/10 19:18 UTC (21:18 Paris), cohérente avec le thermostat du porteur. Entre-temps : essais GPT avec le fil de données déplacé sur D6 puis remis sur D3, GND changé de broche.

## 2. Verdict
Hors firmware. Capteur non alimenté, mauvais contact, inversion +/− (module 3 broches : ordre variable) ou capteur endommagé pendant les manipulations. **Non tranché** faute d'un second capteur. Cause exacte du binaire fautif : non établie (inutile : remplacé par l'image officielle).

## 3. Règles apprises
- Pour reset un ESP8266 par RTS sous Windows : `DtrEnable=false`, pulse `RtsEnable` seul. Laisser DTR haut après le pulse peut tirer GPIO0 bas = mode téléchargement, carte silencieuse.
- Lire le port **brut** (`ReadExisting`) : `ReadLine` masque une carte qui redémarre.
- `Soft WDT` juste après `[WIFI] IP` = bloqué dans l'affichage ; ne pas accuser un capteur avant d'avoir recapturé sans lui.
- Un état haut sur GPIO0 ne prouve pas qu'un DHT22 est présent.

## 4. Suite
Brancher un second DHT22 (ou le même, soudé) sur D3/3V3/GND, relancer la capture : `[DHT22] x.x C, y.y %`. OTA 2.9→2.10 : cause = TLS sans mémoire (diagnostic GPT, voir `DIAGNOSTIC_TFT18_OTA_2_9_VERS_2_10_2026_10_26.md` dans le dépôt principal local, non poussé) ; nouvelle tentative prévue mercredi. Le test DHT sur le multiscreen OLED + e-ink 2,7″ BW reste à faire (capteurs à racheter).
