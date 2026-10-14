# Guide de téléversement des 4 appareils — vote réel (14/10/2026)

Contexte : `docs/LOT_VOTE_REEL_COMPLET_2026_10_14.md` (ce que fait le vote réel) et `docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md` (production directe). Ici : **comment téléverser**, rien d'autre.

## 1. Les 4 dossiers prêts (`A_TELEVERSER/`, à la racine du dossier du projet)
Copie **exacte** des 4 sketches de la branche `claude/integration-vote-reel-2026-10-14` (commit indiqué dans le journal de la session), avec **le `secrets.h` de chaque sketch déjà en place** (copié tel quel, jamais lu). Le dossier est **ignoré par git** (il contient le Wi-Fi) : il n'est ni commité ni poussé. Il peut être régénéré à tout moment à partir de la branche.
| # | Appareil | Dossier à ouvrir | Fichier | Carte (IDE) | Firmware déclaré |
|---|---|---|---|---|---|
| 1 | UNO R4 + TFT 2,8″ tactile | `A_TELEVERSER/1_TFT28_tactile_R4/pod_uno_r4/` | `pod_uno_r4.ino` | Arduino UNO R4 WiFi | `r4tft28-2.5` |
| 2 | ESP8266 multiscreen (e-ink 2,7″ + OLED) | `A_TELEVERSER/2_multiscreen_eink27_OLED_ESP8266/esp_eink_2.7BW_OLED/` | `esp_eink_2.7BW_OLED.ino` | NodeMCU 1.0 (ESP-12E) | `multiscreen-2.5` |
| 3 | ESP8266 e-ink 2,9″ BWR | `A_TELEVERSER/3_eink29_BWR_ESP8266/esp_eink_2.9BWR/` | `esp_eink_2.9BWR.ino` | NodeMCU 1.0 (ESP-12E) | `eink29bwr-2.3` |
| 4 | UNO R4 + e-ink 2,9″ BWR | `A_TELEVERSER/4_eink29_BWR_R4/pod_uno_r4_eink29/` | `pod_uno_r4_eink29.ino` | Arduino UNO R4 WiFi | `r4eink29-1.1` |
**Aucun drapeau à régler** : tous les drapeaux de canari valent 0 (vérifié dans chaque copie) ; ce sont des firmwares de production qui **contiennent le vote v2**. Le dossier contient quelques fichiers `.h`/`.cpp` locaux : ne rien supprimer.

## 2. Bibliothèques (déjà installées si vous compiliez avant)
- R4 TFT 2,8″ : Adafruit GFX, Adafruit ILI9341, Adafruit STMPE610, ArduinoJson (7.x), Crypto (Ed25519, SHA256), QRCode, SD (avec le cœur « Arduino UNO R4 Boards »).
- ESP8266 multiscreen : Adafruit GFX, Adafruit SSD1306, ArduinoJson, Crypto (Ed25519), QRCode (cœur esp8266 3.1.2).
- ESP8266 2,9″ BWR : ArduinoJson, Crypto (Ed25519), QRCode.
- R4 e-ink 2,9″ : ArduinoJson, Crypto (Ed25519, SHA256), QRCode.

## 2bis. Variables Vercel (avant ou pendant le téléversement)
Ajouter dans Vercel (environnement **Production**) : `MIN_V2_APPROVALS` = `1` et `STRICT_SIGNATURE` = `true`, puis **Redeploy**. Ne PAS ajouter `VOTE_ONLY_NETWORK`, ni mettre `false` / `0` : ces valeurs-là sont les interrupteurs d'arrêt du vote réel.

## 3. Déroulé (par appareil)
1. Ouvrir le `.ino` du tableau (l'IDE ouvre tout le dossier). Onglet `secrets.h` : vérifier le Wi-Fi.
2. Choisir la carte et le port ; ouvrir le moniteur série à **115200**.
3. Téléverser. Au démarrage, repérer : `[KEYS] clés chargées`, `[SELFTEST] Ed25519 … OK`, `[REGISTER] … paired=oui`, puis `[PULL] …`. Garder le journal.
4. Ne rien changer d'autre. Si une erreur de compilation apparaît, copier le message **tel quel**.
**Ordre : flasher les 4 d'abord, puis seulement ensuite on déploie le serveur** (sinon un appareil non reflashé est coupé dès le déploiement). Les nouveaux firmwares marchent aussi avec l'ancien serveur.

## 4. Après le téléversement
Copier l'ensemble (journaux série des 4 appareils + éventuellement l'export des logs Redis Upstash activés) et me le transmettre : on relit ensemble avant de déployer. Le déploiement (fusion dans `main`) ne se fait qu'après votre accord et après l'audit des branches (`docs/AUDIT_BRANCHES_2026_10_14.md`).

## 5. Retour arrière (rien n'est supprimé)
- **Firmwares** : l'ancienne version de chaque sketch est dans `main` (tag `avant-vote-reel-2026-10-14`) : `git checkout main` dans le dossier du projet rétablit les sketches d'avant (vos `secrets.h`, ignorés par git, ne bougent pas) ; les sauvegardes `firmware-backups/` restent en place. `git checkout claude/integration-vote-reel-2026-10-14` revient à la version vote réel.
- **Serveur** (après déploiement) : variables Vercel `VOTE_ONLY_NETWORK=false`, `MIN_V2_APPROVALS=0`, `STRICT_SIGNATURE=false` + redéploiement ; ou revenir au tag `avant-vote-reel-2026-10-14`.
