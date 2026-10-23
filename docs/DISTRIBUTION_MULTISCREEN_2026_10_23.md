# Profil de distribution — multiscreen ESP8266 (e-ink 2,7″ + OLED 0,96″) — 23/10/2026

Même principe que `docs/DISTRIBUTION_TFT_BWR_2026_10_23.md` : le dossier téléchargé depuis le site (`/api/esp-firmware?variant=eink27bw`, page Installer) donne directement la version finale : **Wi-Fi réglé depuis le téléphone par le portail** (écran = **OLED** : QR de connexion, nom et mot de passe, adresse `192.168.4.1` en entier), **association à l'application**, puis **mises à jour à distance signées**. Rien à modifier dans le code.

| | multiscreen (`esp_eink_2.7BW_OLED`) |
|---|---|
| Version déclarée / séquence OTA | `multiscreen-2.7` / 7 (= la release canari `multiscreen-2.7-ota7`, installée avec succès sur une carte) |
| Options par défaut | `POD_WIFI_FROM_RECORD=1`, `POD_WIFI_PORTAL=1`, `POD_OTA=1`, `POD_OTA_CLIENT=1` ; `POD_WIFI_MIGRATE=0` (jamais de Wi-Fi dans un binaire distribué) ; **`POD_SENSOR_DHT22=0`** (capteur expérimental : à activer à la main, voir `docs/CAPTEUR_DHT22_MULTISCREEN_ESP8266_2026_10_23.md`) |
| EEPROM | Wi-Fi à 1540..1644 et état OTA à 1668..1695, APRÈS les octets existants (l'image OLED sauvegardée occupe 99..1122) ; `EEPROM_SIZE` 1696 |
| Clés | `pod_ota_keys.h` : clés PUBLIQUES de publication (les moitiés privées restent hors du dépôt) |
| Mémoire (compilé sans `secrets.h`) | RAM statique **37 252 o** ; tas libre après Wi-Fi ≈ 40 Ko |

## Statut de test (honnête)
- **Validé sur UNE carte (23/10/2026)** : portail sur l'OLED utilisé par le porteur (Wi-Fi enregistré, connexion obtenue, identité conservée, image OLED restaurée), **OTA Internet `multiscreen-2.6` (séq. 6) → `2.7` (séq. 7) réussie en production, flash relue identique** (`docs/MULTISCREEN_PORTAIL_OTA_2026_10_23.md`).
- **⚠ Marge mémoire de l'OTA très faible : tas minimal 608 o (bloc 264 o) pendant le téléchargement** — réussi sans marge. Les tampons e-ink / OLED sont statiques et ne peuvent pas être libérés pendant le TLS. À traiter avant de publier une release `stable` pour cette famille.
- **Non testé de bout en bout** : association d'une carte neuve, mauvais mot de passe dans le portail, vote réel et affichage d'un dessin neuf (e-ink et OLED) avec cette version ; le portail n'a pas d'écran e-ink. La page de téléchargement le dit (avertissement de statut).
- Compatibilité : une carte déjà flashée en `multiscreen-2.5` (Wi-Fi compilé) ne reçoit **pas** l'OTA (client ≥ 2.6 requis côté serveur) : elle doit être reflashée par câble une fois.

## Tests (hôte)
`wifiMsFirmware` (sketch avec options à 0 == sketch d'avant au texte près ; défauts du profil ; mutants), `dht22` (décodage, planification, JSON accepté par le serveur), `renderFirmware` (31), `benchHeaderCopies` (22), `podHeaderCopies` (38) verts ; `esp8266Eink27OledCanary` : 34 réussis / 6 échecs, **les mêmes 6 que sur `main` avant ce travail** (harnais C++ hôte dépendant de l'environnement). `tsc --noEmit` propre.
