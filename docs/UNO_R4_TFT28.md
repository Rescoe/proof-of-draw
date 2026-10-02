# UNO R4 WiFi + shield TFT 2.8" tactile — firmware PoD (écran `tft28`)

Statut : **compilé pour l'UNO R4 WiFi, serveur et lecteur HTTP vérifiés sur PC — PAS encore essayé sur la carte.**
Firmware : `arduino_uno_r4/pod_uno_r4/` (`pod_uno_r4.ino` + `pod_http.h`). Test d'écran seul (validé) : `arduino_uno_r4/tft_shield_test/`.

## Ce que c'est

Un **nouveau type d'écran serveur : `tft28`** (TFT 2.8" tactile, **240×320 RGB565**, 153 600 octets), distinct du `tft18` (128×160).
Même protocole que les ESP : register → pull → image → ACK, validation Ed25519, observation, blocs possédés.

| | |
|---|---|
| Image | **plein écran 240×320**, natif (plus d'agrandissement) |
| Œuvres ANA | **image fixe (aperçu)**, comme les e-ink : cet écran ne déclare **pas** `sceneCapability`, le serveur ne lui envoie jamais de scène |
| Toucher | **affiche / cache le cartel** : bande haute « RESCOE · #bloc », bande basse « titre · artiste », par-dessus l'œuvre. Par défaut l'œuvre est seule |
| microSD | garde la dernière image (`/pod/frame.bin`, 153 600 o) + son cartel (`/pod/meta.txt`). Sert à **cacher** le cartel (les deux bandes sont redessinées depuis la carte, sans re-télécharger) et à **réafficher l'œuvre au redémarrage** |
| Sans carte SD | l'œuvre reste en plein écran **sans cartel** (rien à restaurer sous les bandes) ; le Serial l'indique |
| Appairage | écran de clés (touché = continuer, sinon 60 s) puis QR + code, comme les ESP |

## Côté serveur (ce qui a été ajouté)

`lib/screenProfiles.ts` (profil `tft28`, palette 48 couleurs partagée avec le `tft18`) · encodage canvas→buffer (`canvasToScreen`) · décodage
(`screenToCanvas` : `tft28ToCanvas`) · conversion inter-écrans (`frameConverter`, `screenConvert`) · encodage ANA (`screenEncode`) ·
`/api/pull-frame` (`screen=tft28`) · validation (`adaptiveValidation`, `submit-candidate`) · poèmes (`poemRender`) · exports SVG · aperçus et libellés
(galeries, blocs, profil, réseau) · **vue réseau : icône dédiée** (tablette portrait + point de contact) et couleur turquoise `#2dd4bf`.
Aucune scène : `lib/scene/delivery.ts` ne connaît que `oled096` et `tft18`.

## Installation

1. Retirer `Documents/Arduino/libraries/SPI` s'il existe (copie AVR qui masque le SPI du cœur R4).
2. Bibliothèques : Adafruit ILI9341, Adafruit GFX, Adafruit BusIO, Adafruit STMPE610, ArduinoJson (≥ 6, testé 7.4), QRCode, Crypto, SD (fournie avec l'IDE).
3. Carte « Arduino UNO R4 WiFi », ouvrir `pod_uno_r4.ino`, renseigner `WIFI_SSID` / `WIFI_PASSWORD` (2,4 GHz), téléverser, Serial 115200.
4. Carte microSD **formatée FAT/FAT32** (vide convient). Sans elle : pas de cartel masquable.
5. L'appareil déjà enregistré (ancien firmware `tft18`) se **ré-enregistre** avec `tft28` : même `deviceId`, ses écrans sont mis à jour côté serveur.
   Dessiner pour lui : `/draw/<deviceId>/tft28`.

## Contraintes matérielles

| Sujet | Valeur | Conséquence |
|---|---|---|
| **Liaison RA4M1 ↔ ESP32-S3** | 115 200 bauds | une image = **≈ 15 à 25 s** (153 600 o) ; elle se dessine de haut en bas pendant ce temps. `[FRAME] OK en … ms` donne la mesure |
| **Pile principale** | **1 Ko** (`BSP_CFG_STACK_MAIN_BYTES = 0x400`), protection désactivée | Ed25519 (≈ 1,7 Ko) déborde dans le HAUT du tas, libre tant que le tas est peu rempli ; aucun gros tableau local. `[SELFTEST]` / `[MEM]` au Serial |
| RAM statique | 15,5 Ko (47 %) | libère de la marge par rapport à l'ancienne version (plus de lecteur de scène) |
| Flash | 130 Ko (49 %) | |
| Redis / Vercel | image = **205 Ko en base64** par frame et par bloc | ~5× un `tft18`. Surveiller la taille de la base (blocs ANA archivés par écran) |

## À me rapporter après le premier essai (Serial 115200)

```
[SD] carte lisible …                                           ← ou « absente / non formatée »
[SELFTEST] Ed25519 signature … ms, vérification … ms -> OK     ← DOIT être OK
[REGISTER] deviceId=… paired=…
[FRAME] OK en … ms (… cache SD: oui)                           ← durée réelle d'une image
[TOUCH] cartel affiché / masqué en … ms                        ← la restauration depuis la carte
```
Visuel : l'œuvre occupe tout l'écran, sans marge ; toucher = bandes haut/bas ; retoucher = elles disparaissent et l'œuvre est intacte.

## Pas fait / limites connues

- Essai matériel complet (Wi-Fi/TLS, appairage, image, SD, tactile).
- **Œuvres ANA déjà ingérées** : seules les nouvelles œuvres reçoivent un bloc `tft28` ; les anciennes ne seront pas envoyées à cet écran.
- Pas de réduction de poids (RLE / palette) : si les 20 s ou la taille Redis gênent, une compression est la suite logique.
- Le toucher n'agit qu'entre deux opérations réseau (pas pendant un téléchargement).
- Interaction avec l'œuvre elle-même (scene-v1 est fermé et sans entrée) : non prévue pour cet écran.
- Entropie des clés : bruit analogique + gigue d'horloge + MAC/RSSI condensés par SHA-256 (même niveau que les firmwares ESP, pas un TRNG certifié).

## Vérifié sans matériel (`npm test`)

- `tests/podHttpR4.test.ts` : `pod_http.h` rejoué sur des réponses fragmentées à l'octet (Content-Length, chunked, tronqué, illisible…).
- `tests/canvasToScreen.test.ts` : encodage `tft28` RGB565 octet pour octet (formule indépendante) ; `tests/screenConvert.test.ts` : aller-retour
  et conversions entre tous les écrans, `tft28` inclus.
