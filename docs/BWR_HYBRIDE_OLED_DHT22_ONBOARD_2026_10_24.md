# BWR 2,9″ hybride : OLED d'état + capteur DHT22 + commande ONBOARD (24/10/2026)

Statut : **EXPÉRIMENTAL**. Options à 0 par défaut : le sketch redevient, au texte près, celui d'avant (test `wifiBwrFirmware`). Essayé sur UNE carte (`dev_T46HBXG1`), par câble.

## Ce que c'est
`esp8266/esp_eink_2.9BWR` accepte trois options de compilation (toutes à 0 dans le dépôt) :

| Option | Effet |
|---|---|
| `POD_OLED_STATUS=1` | OLED SSD1306 0,96″ (I2C 0x3C, SDA=D6, SCL=D4) : état (Wi-Fi, enregistrement, dernière mesure) et portail Wi-Fi avec QR. **Ce n'est PAS un deuxième écran réseau** (pas de frame, pas de vote pour l'OLED). |
| `POD_SENSOR_DHT22=1` | DHT22 sur D3 (GPIO0) : lecture toutes les 30 min, envoi toutes les heures (`POST /api/sensor`), tampons image libérés avant le TLS. Déclare `sensors:["temp","hum"]` à `/api/register`. |
| `POD_WIFI_PORTAL=1` | requis par les deux autres (`#error` sinon). Ajoute la commande série `ONBOARD`. |

## Commande série `ONBOARD` (récupération d'accès)
Envoyée dans la fenêtre de démarrage (1,5 s) comme `WIFI-PORTAL` : affiche le QR `…/onboard?code=<pairCode>` sur l'e-ink (ancien `displayQR`, éprouvé) et sur l'OLED **même si la carte est déjà appairée**. Scanné dans un vrai navigateur (pas la vue intégrée d'une application), il rend l'accès au profil de l'ESP (le serveur retrouve le profil propriétaire : cas « cookie perdu »).

```
powershell -NoProfile -File ota-lab\esp8266-canary\tools\serial-send-after-reset.ps1 -Port COM4 -Line "ONBOARD" -Expect "onboarding demandee" -Seconds 12
```
(outils du dossier de laboratoire ; en son absence, envoyer `ONBOARD` + fin de ligne sur le port série à 115 200 bauds juste après un reset.)

## Correctif serveur : présence (`lib/pullBudget.ts`)
`/api/register` rafraîchit `lastSeen` seulement ; le pull ne réécrivait `lastSeen`/`lastPing` que si le plus récent des deux avait plus de 10 min ; `validate-candidate` et le quorum lisent `lastPing`. Une carte redémarrée souvent restait « inactive » (> 45 min) et recevait `Device inactif depuis trop longtemps` : **pas de vote**. `presenceStale` ne regarde plus que `lastPing` (test ajouté). Coût Redis inchangé (une écriture au plus toutes les 10 min par appareil). **À déployer pour prendre effet.**

## Câblage
E-ink : VCC 3V3, GND, DIN D7, CLK D5, CS D8, DC D2, RST D1, BUSY D0. OLED : VCC 3V3, GND, SDA D6, SCL D4. DHT22 : + 3V3, − GND, OUT D3 (ne pas maintenir D3/GPIO0 à la masse au reset ; débrancher le DHT22 pour flasher par câble).

## Mesures de la carte (build `eink29bwr-2.6`, séquence OTA 8)
RAM statique 37 932 → 37 996 o (avec `ONBOARD`) ; tas après Wi-Fi 39 632 – 39 696 o ; `register` 200, `pull` 200, DHT22 lu (13,2 °C, 92,9 %) et envoyé (`/api/sensor` 200) ; aucun watchdog ni exception.

## Limites (honnêtes)
- **OTA** : le client est actif (`eink29bwr-2.6`, séquence 8, famille `esp8266-eink29bwr`) mais la production n'annonce rien de plus que la séquence 7. **Aucune mise à jour OTA n'a été essayée avec OLED + capteur.** Le tas minimal pendant le téléchargement n'est pas mesuré dans cette configuration (BWR seul : 3 688 o ; multiscreen + capteur : environ 400 o). Ne pas publier de release stable pour cette combinaison avant mesure.
- Un seul appareil, un seul essai ; l'OLED n'a pas été relu par un humain pour chaque écran ; le vote du dessin de test dépendait du correctif de présence ci-dessus.
- Pas de déclencheur sans câble pour `ONBOARD` (à ajouter si utile : bouton).
