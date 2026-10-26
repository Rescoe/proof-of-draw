# Station de monitoring UNO R4 WiFi — DHT22 + SGP40 + TFT 1,8″ (26/10/2026)

Firmware `arduino_uno_r4/pod_uno_r4_station` (`r4env-1.0`). **COMPILÉ seulement** (cœur Arduino renesas 1.6.0 : 98 624 o de flash, 11 128 o de RAM statique ; le cœur 1.5.3 n'est pas installé sur cette machine) + pilote SGP40 testé sur l'hôte. **Jamais flashé, aucun capteur ni écran branché au moment de l'écriture.**

## Pourquoi (et ce que ça ne règle pas)
Le DHT22 du TFT 1,8″ ESP8266 est devenu muet le 26/10 (voir `DIAGNOSTIC_TFT18_DHT22_BOUCLE_WDT_2026_10_26.md`) : cause = capteur/contact, **pas** la carte ESP. La R4 apporte surtout : 5 V sur les broches, bus I2C Grove pour le SGP40, 32 Ko de RAM (vs ≈ 38 Ko de tas ESP mais sans TLS à deux dimensions), et un réseau déjà VALIDÉ sur carte (`r4dht22-1.3`). Contreparties à garder en tête : **pas de mise à jour à distance sur R4** (flash par câble), pile principale de 1 024 o (toute I/O profonde passe par `podWorkRun`), et le firmware PoD « écran » R4 TFT 1,8″ (`pod_uno_r4_tft18`, vote + art) reste **compilé, jamais essayé** — la station n'en est pas un : c'est un capteur avec un afficheur local, sans vote ni quorum.

## Câblage (décidé pour la R4, logique 5 V)
| Module | Broche module | Broche R4 |
|---|---|---|
| DHT22 | VCC / GND / DATA | 5 V / GND / **D2** (ordre variable selon le module : lire les inscriptions) |
| SGP40 Grove | rouge / noir / jaune (SCL) / blanc (SDA) | 5 V / GND / **SCL** / **SDA** (côté AREF, ou A5 / A4) |
| TFT 1,8″ ST7735 | VCC / GND | 5 V / GND |
| | CS / RESET / A0-DC | **D10** / **D8** / **D9** |
| | SDA (MOSI) / SCK | **D11** / **D13** |
| | LED (rétro-éclairage) | 3,3 V (100 Ω si le module n'en a pas) |

D13 = horloge SPI : rien d'autre dessus. Le SGP40 Grove accepte 3,3 V ou 5 V (vérifier l'inscription du module).

## Ce qui se passe
- Lecture toutes les **30 min** (DHT22 + 12 mesures SGP40 à 1 Hz pour stabiliser le chauffage, on garde la dernière), envoi **toutes les heures** à `/api/sensor` (8 commandes Redis par envoi, inchangé), tampon de 12 lectures, diagnostic Wi-Fi joint (signal, latence, débit).
- Une grandeur absente (capteur débranché) n'empêche pas l'envoi des autres.
- Nouvelle grandeur serveur **`voc`** (`lib/measures.ts`) : sortie BRUTE du SGP40 en « ticks » 0..65535, **plus bas = plus de composés organiques volatils**. Ce n'est PAS l'indice VOC 0–500 de Sensirion (algorithme à part, non inclus ; à ajouter si on installe la bibliothèque « Sensirion Gas Index Algorithm »). Valeur relative à la puce, qui dérive avec l'âge. Affichée dans le groupe « Environnement » (profil, constellation, profil public).
- Écran : température, humidité, gaz, signal Wi-Fi, état de l'envoi (« envoi OK il y a N min »), code d'appairage tant que la carte n'est pas appairée. Rafraîchi après chaque lecture/envoi et toutes les 30 s (âge). Tout dessin sur la pile de travail dédiée.
- Appairage : comme `r4dht22` (`secrets.h` Wi-Fi 2,4 GHz, code affiché à l'écran et au Serial → Mon profil → « + Ajouter un ESP »). Pas de portail Wi-Fi sur cette carte.

## Protocole du premier essai (demain)
1. Tout brancher (carte débranchée de l USB), puis lire le Serial (115200, DTR actif) : attendre `[REGISTER]`, `[DHT22] x.x C`, `[SGP40] n ticks`, `[TFT]` sans « impossible ».
2. Si `[SGP40] lecture impossible` : vérifier SDA/SCL (inversion fréquente) ; si `[DHT22] lecture impossible` : alimentation 5 V et ordre des broches.
3. Mesure de la pile : le firmware n'a pas de relevé de pile (≠ canari) ; si la carte redémarre en boucle, noter la dernière ligne avant le reset.
4. Premier envoi : dans la minute qui suit l'appairage, puis 1/h (le serveur refuse < 50 min).

## Hors périmètre / suite
- Archivage du TFT 1,8″ ESP8266 : **rien supprimé** ; voir `ARCHIVE_TFT18_ESP8266_2026_10_26.md`.
- Indice VOC Sensirion, seuils d'alerte, affichage des courbes sur l'écran : plus tard.
- Port OTA sur R4 : non commencé.
