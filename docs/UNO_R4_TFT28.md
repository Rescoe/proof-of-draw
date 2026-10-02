# UNO R4 WiFi + shield TFT 2.8" tactile — firmware PoD

Statut : **compilé pour l'UNO R4 WiFi et vérifié sur PC (lecteur HTTP, agrandissement) — PAS encore essayé sur la carte.**
Firmware : `arduino_uno_r4/pod_uno_r4/` (`pod_uno_r4.ino` + `pod_http.h` + `pod_scale.h` + `ana_scene_v1.h`).
Test matériel de l'écran seul (validé) : `arduino_uno_r4/tft_shield_test/tft_shield_test.ino`.

## Ce que ça fait

Même protocole que les ESP (register → pull → image fixe **ou** scène animée → ACK, validation Ed25519, observation, blocs possédés).
L'appareil se déclare **`tft18`** (128×160) : **aucun changement serveur**. Il apparaît dans la vue réseau / « Mon profil » comme un TFT.

| | |
|---|---|
| Image fixe | flux RGB565 128×160 (40 960 o), agrandi **×1,5** (192×240) au centre de l'écran 240×320 |
| Cartel | bandes natives 40 px : « RESCOE #bloc » en haut, titre (2×) + artiste en bas (accents repliés en ASCII) |
| Œuvre ANA animée (scene-v1) | paquet ANAS ≤ 4 Ko téléchargé, vérifié (CRC, règles, hash), puis **rejoué localement à 2 FPS** (rectangles sales agrandis) ; ACK `mode:"scene"` après la lecture |
| Tactile (STMPE610) | **désactivé par défaut** (`TOUCH_ENABLED 0`). À `1` : un toucher rejoue la scène en cours, ou force un pull immédiat sur une image fixe |
| Appairage | écran de clés (touché = continuer, sinon 60 s) puis QR + code ; même flux que les ESP |

Pas de microSD (broche 4 maintenue HIGH, bus partagé) : elle n'est pas nécessaire.

## Installation

1. Retirer `Documents/Arduino/libraries/SPI` s'il existe (copie AVR qui masque le SPI du cœur R4 et casse la compilation).
2. Bibliothèques : Adafruit ILI9341, Adafruit GFX, Adafruit BusIO, Adafruit STMPE610, ArduinoJson (≥ 6, testé 7.4), QRCode, Crypto.
3. Carte « Arduino UNO R4 WiFi », ouvrir `pod_uno_r4.ino`, renseigner `WIFI_SSID` / `WIFI_PASSWORD`, téléverser, moniteur série 115200.
4. Premier boot : l'écran affiche les clés (noter la privée), puis le QR d'appairage ; l'appareil redémarre une fois appairé.

Si le Serial affiche « connexion TLS impossible » : mettre à jour le firmware du module Wi-Fi (IDE → Outils → Updater le firmware) ; le
coprocesseur ESP32-S3 vérifie le certificat avec son propre lot de certificats racine.

## Contraintes matérielles (à connaître)

| Sujet | Valeur | Conséquence |
|---|---|---|
| **Pile principale** | **1 Ko** (`BSP_CFG_STACK_MAIN_BYTES = 0x400`), protection désactivée par le cœur | une pile qui déborde descend dans le HAUT du tas : sans danger tant que le tas est peu rempli. Ed25519 (signature ≈ 1,7 Ko cumulés) passe pour cette raison. Aucun gros tableau local ; tampons de lignes statiques |
| Tas | ≈ 12,3 Ko libres au boot | tampon image de scène 10 240 o alloué **seulement pendant la lecture** ; si `malloc` échoue → image fixe |
| RAM statique | 19,2 Ko (58 %) | paquet de scène (4 Ko) conservé en statique pour pouvoir **rejouer** |
| Flash | 129 Ko (49 %) | |
| Liaison RA4M1 ↔ ESP32-S3 | 115 200 bauds | image complète : **plusieurs secondes** ; paquet de scène (≤ 4 Ko) < 1 s. Les temps réels sont affichés `[FRAME]` / `[SCENE]` |
| SPI écran | matériel (Adafruit_ILI9341) | à mesurer : `fillScreen` du script de test donne la vitesse réelle |

## À me rapporter après le premier essai (Serial 115200)

```
[MEM] boot: tas libre … o, pile max … o
[SELFTEST] Ed25519 signature … ms, vérification … ms -> OK     ← DOIT être OK ; sinon pile insuffisante : me le dire tout de suite
[MEM] après Ed25519: tas libre … o, pile max … o               ← « pile max » > 2 000 o = marge à surveiller
[REGISTER] deviceId=… paired=…
[FRAME] OK en … ms                                             ← durée réelle d'une image complète
[SCENE] reçu N/N o en … ms · [SCENE] terminé: … rendu max … us, envoi TFT max … us, dépassements …
[MEM] fin de lecture … / après pull …                          ← tas libre pendant la lecture (≥ ~1,5 Ko attendu)
```
Visuel : l'image doit remplir le cadre 192×240 sans décalage ; les couleurs = l'aperçu de la galerie ; toucher = rejeu / pull.

## Vérifié sans matériel (`npm test`)

- `tests/podHttpR4.test.ts` : `pod_http.h` compilé avec g++ et rejoué sur des réponses fragmentées à l'octet avec « silences » du modem :
  Content-Length, chunked (extensions, hexa majuscule), lecture jusqu'à fermeture, **corps tronqué détecté**, tampon trop petit, réponses illisibles.
- `tests/podR4Display.test.ts` : faux ILI9341 (fenêtre d'adresse + curseur) recevant les mêmes appels que le firmware ; pour **chaque tick de
  chaque scène de référence** (2 boucles) l'écran 240×320 = agrandissement ×1,5 de la frame de référence (formule indépendante), aucun pixel
  hors fenêtre, aucune fenêtre à moitié remplie ; image fixe idem ; `ana_scene_v1.h` identique à la copie du TFT ESP8266.

## Interaction avec l'œuvre : ce que scene-v1 permet (et pas)

scene-v1 est un manifeste **fermé et déterministe** : ses entités se déplacent selon le tick, mais **elles ne lisent aucune entrée**.
Le tactile peut donc rejouer / relancer, **pas** faire réagir l'œuvre (un sketch p5.js interactif de la galerie ANA n'est pas
reproductible en l'état). Pour de la vraie interaction il faut étendre le contrat avec ANA/GPT, par exemple : une entité « réactive au
toucher » (décalage ou palette dépendant d'un point (x,y) ∈ Q15 fourni par l'appareil), des paramètres modifiables (vitesse / couleur) ou
une séquence de scènes à choisir au toucher. À décider avant d'écrire du firmware.

## Pas fait / limites connues

- Essai matériel complet (Wi-Fi/TLS, appairage, image, scène, tactile).
- Cadence : déclarée 2 FPS (seule classe `f2` compilée côté serveur) ; la R4 pourrait aller plus vite — il faut ajouter une classe (`f4`…) dans
  `lib/scene/delivery.ts` **après** mesure du Serial.
- Pas de profil serveur natif 240×320 : les dessins sont rendus en 128×160 puis agrandis (net pour du pixel-art, doux pour du détail fin).
- Le tactile n'interrompt pas une lecture en cours (≈ 75 s pour 50 ticks × 3 boucles) ; il est servi entre deux lectures.
- Entropie des clés : bruit analogique + gigue d'horloge + MAC/RSSI condensés par SHA-256 (même niveau que les firmwares ESP, pas un TRNG certifié).
