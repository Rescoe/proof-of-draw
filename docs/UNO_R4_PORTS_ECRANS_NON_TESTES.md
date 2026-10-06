# Ports UNO R4 WiFi supplémentaires — non testés

Date de création : 06/10/2026.

> ⚠️ Les trois firmwares décrits ici n’ont pas encore été testés sur le matériel. Ils ne doivent pas être présentés comme validés tant qu’un téléversement, un cycle d’appairage, une réception d’œuvre et un ACK n’ont pas été observés sur chaque montage réel.

Les trois sketches compilent avec `arduino-cli`, cœur `arduino:renesas_uno` 1.5.3, cible `arduino:renesas_uno:unor4wifi` :

- e-ink 2,7″ : 117 372 o de flash (44 %), 19 128 o de RAM globale (58 %), 13 640 o libres ;
- multiscreen : 131 976 o de flash (50 %), 22 524 o de RAM globale (68 %), 10 244 o libres ;
- TFT 1,8″ : 127 968 o de flash (48 %), 16 128 o de RAM globale (49 %), 16 640 o libres.

## Périmètre livré

| Montage | Dossier | Version | Images fixes | Animation / scene-v1 |
|---|---|---|---|---|
| UNO R4 + e-ink 2,7″ BW | `arduino_uno_r4/pod_uno_r4_eink27` | `r4eink27-1.1` | oui | non applicable à l’e-ink |
| UNO R4 + e-ink 2,7″ BW + OLED 0,96″ | `arduino_uno_r4/pod_uno_r4_eink27_oled` | `r4multiscreen-1.1` | oui, sur les deux écrans | volontairement non annoncé avant test |
| UNO R4 + TFT 1,8″ ST7735S | `arduino_uno_r4/pod_uno_r4_tft18` | `r4tft18-1.1` | oui | volontairement non annoncé avant test |

Chaque dossier est autonome : sketch principal, lecteur HTTP R4, `secrets.h.example` et, pour les e-ink, pilote Waveshare local. Le fichier `secrets.h` réel n’est jamais inclus dans les ZIP.

## Câblages

### E-ink 2,7″ BW

VCC → 3.3V · GND → GND · DIN → D11 · CLK → D13 · CS → D10 · DC → D9 · RST → D8 · BUSY → D7.

### OLED du multiscreen

VCC → 3.3V · GND → GND · SDA → A4/SDA · SCL → A5/SCL. Adresse attendue : `0x3C`.

### TFT 1,8″ ST7735S

VCC → 3.3V · GND → GND · SCL → D13 · SDA → D11 · RES → D8 · DC → D9 · CS → D10 · BLK → 3.3V.

Le lecteur microSD éventuel du module TFT n’est pas utilisé par cette première version R4.

## Comportement réseau et quota Redis

Ces ports réutilisent le rythme serveur existant : un `/api/pull` au rythme actif ou dormant renvoyé par PoD, sans nouveau poll périodique. Une œuvre provoque seulement son téléchargement binaire puis son ACK. Le multiscreen annonce deux écrans mais ne lance jamais deux boucles de pull : il traite séquentiellement la livraison indiquée par le serveur.

Les trois versions 1.1 utilisent aussi le vote réel v2 de l’UNO R4 : téléchargement unique de `/api/candidate-frame`, SHA-256 et métriques entières calculés en flux, verdict puis signature Ed25519. Cela ne change pas le rythme de pull et respecte le même budget de commandes que le port R4 e-ink 2,9″.

Les versions R4 OLED/TFT ne sont pas ajoutées aux listes de firmwares capables d’animation ou de `scene-v1`. Elles reçoivent donc l’affiche fixe, sans requête supplémentaire. Cette capacité ne sera activée qu’après mesures matérielles.

## Protocole de validation matérielle

Pour chaque montage :

1. compiler avec la carte « Arduino UNO R4 WiFi » et relever RAM/flash ;
2. vérifier le démarrage et l’avertissement `[WARNING] PORT NON TESTE...` à 115200 bauds ;
3. afficher les clés, le QR code et le code d’appairage ;
4. attendre l’appairage puis recevoir une œuvre de la bonne taille ;
5. confirmer dans les logs l’affichage puis l’ACK ;
6. redémarrer et vérifier la restauration attendue (e-ink conservé, OLED restauré depuis EEPROM, TFT retéléchargé) ;
7. relever la mémoire, les durées de téléchargement et d’affichage ;
8. seulement après ces contrôles, retirer les avertissements et envisager animations / `scene-v1` sur OLED et TFT.
