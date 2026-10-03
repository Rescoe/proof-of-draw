# UNO R4 WiFi + e-ink 2.9" BWR (module B) — firmware PoD (écran `eink29bwr`)

Statut : **compile pour l'UNO R4 WiFi — PAS encore essayé sur la carte.**
Firmware : `arduino_uno_r4/pod_uno_r4_eink29/` (`pod_uno_r4_eink29.ino`, `epd29b.h`, `pod_http.h`, `secrets.h.example`).
Aucun changement serveur : l'appareil se déclare `eink29bwr`, comme l'ESP8266 (`esp8266/esp_eink_2.9BWR`).

## Câblage

| Écran | UNO R4 WiFi |
|---|---|
| VCC | 3.3V |
| GND | GND |
| DIN | D11 (SPI COPI) |
| CLK | D13 (SPI SCK) |
| CS | D10 |
| DC | D9 |
| RST | D8 |
| BUSY | D7 |

Pas de shield TFT en même temps (D8/D9/D10 partagés). Broches modifiables par `#define EPD_*_PIN` en tête de `epd29b.h`.

## Installation

1. Bibliothèques : ArduinoJson (≥ 6), QRCode (ricmoo), Crypto (rweather). Carte « Arduino UNO R4 WiFi ».
2. Copier `secrets.h.example` en `secrets.h` (ignoré par git) et renseigner le Wi-Fi 2,4 GHz.
3. Téléverser, Serial 115200.
4. Un appareil neuf affiche ses clés (60 s, clé privée en rouge, une seule fois) puis le QR d'appairage. Un appareil déjà appairé reçoit l'œuvre au premier pull.

## Différences avec le firmware ESP8266

- Wi-Fi/TLS sur le coprocesseur ESP32-S3 : pas de `free()/malloc()` des buffers autour des requêtes, 2 tampons statiques de 4736 o.
- Lecture du flux binaire par `pod_http.h` (boucle jusqu'au compte exact, chunked accepté) : équivalent du `readFull()` de l'ESP.
- `frameId` mémorisé en EEPROM (offset 420, 32 car.) : un redémarrage ne rafraîchit pas ni ne ré-ACK une œuvre déjà affichée ; effacé dès qu'un écran d'appairage la remplace.
- **BUSY** : polarité du pilote officiel Waveshare (HAUT = occupé). Le pilote ESP du dépôt attend l'inverse (il ne tient que par ses temporisations).
- **Cartel / textes dessinés dans le repère de l'image du serveur** (`bufRow = x`, `bufCol = 127 - y`, glyphes bit 0 = haut) : bande « date · #bloc » en HAUT, « artiste - titre » en BAS. Le firmware ESP dessine dans un repère retourné (bandes inversées) — à confirmer à l'œil sur l'écran réel.
- Écran blanc avant chaque nouvelle œuvre (`CLEAR_BEFORE_IMAGE 1`, comme l'ESP) : ~30 s au total. Mettre 0 pour un seul rafraîchissement.
- Pas de calcul de métriques local (le vote reprend `score_server`, comme les firmwares actuels).

## À me rapporter après le premier essai (Serial 115200)

```
[SELFTEST] Ed25519 … -> OK
[REGISTER] deviceId=… paired=…
[EPD] BUSY reste actif …            ← NE DOIT PAS apparaître (sinon fil BUSY / polarité)
[EINK] image affichée en … ms
[FRAME] OK en … ms (frameId=…)  puis  [ACK] … -> OK
[VALIDATE] vote OK
```
Visuel : l'œuvre à l'endroit, cartel haut/bas lisible, rouge et noir corrects.
