# Plan multi-sessions — animations (atelier, ESP, couleur) et ports R4 WiFi (OLED, TFT 1.8")

Créé le 03/10/2026. Légende : ✅ fait · 🟡 fait mais **non testé sur le matériel** · ⏳ à faire · 🔎 à décider/mesurer.
Règles transverses : (1) **tout code non testé sur le matériel porte un avertissement** (en-tête du fichier, doc, interface) ; (2) chaque modification de firmware est précédée d'une
**sauvegarde** (`firmware-backups/`, tag git) ; (3) **toute fonction qui touche Redis est chiffrée en commandes/heure/acteur avant d'être codée** (`CLAUDE.md`).

## Session du 03/10/2026 (cette session) — bilan

| # | Tâche | État |
|---|---|---|
| A1 | Commit des fichiers qui n'étaient pas de l'assistant (`.gitignore` des `secrets.h`, firmware R4 e-ink 2.9" BWR, docs de travail) | ✅ `4e0a6a2`, `79be85e` |
| A2 | Sauvegarde des `.ino` AVANT intégration (`firmware-backups/2026-10-03_avant-integration-animation/`, tag `firmware-avant-animations-2026-10-03`) | ✅ |
| A3 | Lecteur de clips généralisé : géométrie TFT 2.8" (inchangée), TFT 1.8" (`GeoOne<48>`), OLED (`playBitmap`) ; tests PC différentiels | ✅ (PC) |
| A4 | Firmware ESP8266 TFT 1.8" v2.1 et OLED (multiscreen) v2.1 : banc d'essai | 🟡 compilent, **jamais essayés sur la carte** |
| A5 | Serveur : écrans compatibles tft28 / tft18 / oled096, page `/bench` par écran, `retryAfter` 30 s quand le mode est actif | ✅ |
| A6 | **Atelier d'animation `/animer`** (éditeur sorti du banc d'essai, qualité OLED 128×64 noir et blanc, entrée « Animer » du menu) | ✅ |
| A7 | Analyse de faisabilité ESP + essai couleur/grand | ✅ `ANIMATIONS_FAISABILITE_ESP_ET_COULEUR.md` |
| A8 | Ce plan, la note de tâches R4 et la notice matériel/ZIP (ci-dessous) | ✅ (plan écrit, réalisation à venir) |

## Session suivante (S2) — mesures ESP + essai couleur/grand

| # | Tâche | Détail | État |
|---|---|---|---|
| B1 | **Mesurer le TFT 1.8" et l'OLED** avec le banc d'essai (porteur, avec le matériel) | flasher `esp_tft1.8` v2.1 et `esp_eink_2.7BW_OLED` v2.1, activer le mode, envoyer « plein écran clignotant » à 20 ms puis la balle ; relever travail moyen/max, marge min, mémoire | 🔎 |
| B2 | Consigner les mesures dans `BENCH_ANIMATION.md` et passer `tested: true` dans `lib/bench/screens.ts` (retire l'avertissement orange de la page) | | ⏳ |
| B3 | Corriger ce que les mesures révèlent (SPI matériel du TFT 1.8", mises à jour partielles de l'OLED, mémoire) | | ⏳ |
| B4 | **Format PBC2** (couleur, plus grand) : spécification figée → codeur/décodeur TS → lecteur C++ → tests différentiels | cf. § 3.2 de la note de faisabilité ; palette 2/4/16 couleurs, 1/2/4 bpp, agrandissement entier | ⏳ |
| B5 | Éditeur couleur dans le banc d'essai (palette, pinceau, remplissage), export GIF couleur | après B4 | ⏳ |
| B6 | Essai sur le TFT 2.8" (R4) : 120×160 en 4 couleurs ×2 = plein écran | après B4/B5 | ⏳ |

## Sessions S3 et suivantes — ports UNO R4 WiFi (OLED, TFT 1.8") et notice par matériel

Modèle à suivre : le port **e-ink 2.9" BWR sur R4** (`arduino_uno_r4/pod_uno_r4_eink29/`, `docs/UNO_R4_EINK29.md`), qui a fonctionné chez le porteur sans modification. Le R4 prend la place de l'ESP8266 :
même protocole serveur (register → pull → image → ACK, validation Ed25519, observation, blocs possédés), même `pod_http.h`, Wi-Fi/TLS par le coprocesseur ESP32-S3, `secrets.h` (ignoré par git).

### C. Ports de firmware

| # | Tâche | Base de code | Points d'attention | État |
|---|---|---|---|---|
| C1 | **R4 + OLED 0,96" SSD1306** (écran `oled096`) | `pod_uno_r4` (R4 TFT 2.8", pour la structure) + `Adafruit_SSD1306` | I2C du R4 (connecteur Qwiic / A4-A5), 1 Ko d'image ; œuvres ANA = scene-v1 `oled096` à décider (R4 : RAM 32 Ko) ; ticker du firmware multiscreen à reprendre ou pas | ⏳ |
| C2 | **R4 + TFT 1.8" ST7735** (écran `tft18`) | `pod_uno_r4` + `Adafruit_ST7735` (SPI **matériel**) | 40 960 o par image (comme le R4 TFT 2.8" mais plus petit) ; pas de partage de bus avec la SD si pas de SD ; cartel brûlé (bandes de 14 px) | ⏳ |
| C3 | **R4 + e-ink 2.7" BW** et **e-ink 2.7" + OLED** (combo) | `pod_uno_r4_eink29` pour l'e-ink | seulement si l'utilisateur veut ces cartes en R4 ; le combo e-ink + OLED est le plus lourd (deux écrans, un ticker) | 🔎 |
| C4 | **Banc d'essai d'animation** dans chaque port R4 (mêmes `pod_bench.h` + lecteur ; `pod_bench_esp.h` est propre à l'ESP8266 : utiliser la version R4 de `pod_uno_r4.ino`) | `pod_uno_r4.ino` (déjà fait pour le TFT 2.8") | OLED : `playBitmap` ; TFT 1.8" : `GeoOne<48>` ; ajouter les écrans à `lib/bench/screens.ts` si le préfixe de firmware change | ⏳ |
| C5 | Pour chaque port : **compilation arduino-cli**, mesure de la RAM (≤ 23 296 o de données statiques sur le R4), **avertissement « non testé »** en tête du `.ino`, de la doc et de la page | | ⏳ |
| C6 | Sauvegarde préalable de tout `.ino` modifié (`firmware-backups/<date>/`) | | ⏳ à chaque fois |

Précautions déjà apprises sur le R4 (à reprendre telles quelles) : pile principale de 1 Ko (Ed25519 ≈ 1,7 Ko → déborde dans le tas : ne rien allouer en pile de gros), `FRAME_BYTES`/`ROW_BYTES`
masquent les constantes de `pod_bench.h` si le sketch les définit déjà, `Adafruit_SPITFT::writePixels` envoie 2 octets par `SPI.transfer` sur la R4 (utiliser `SPI.transfer(buf, n)`).

### D. Notice « selon votre matériel » et archives à télécharger

Objectif du porteur : l'utilisateur **choisit ses éléments** (carte ESP8266 ou UNO R4 WiFi, écran, tactile / SD éventuels), reçoit **le câblage et le code**, et peut **télécharger un dossier ZIP complet**
pour n'importe quelle combinaison, comme aujourd'hui pour les ESP.

| # | Tâche | Détail | État |
|---|---|---|---|
| D1 | Modèle de données des combinaisons : `carte` (esp8266 / uno_r4) × `écran` (eink29bwr, eink27bw, eink27bw+oled, oled096, tft18, tft28) → dossier(s) de firmware, câblage, bibliothèques, version minimale, **statut de test** | étendre `app/learn/data/installProfiles.ts` (aujourd'hui : profils ESP seulement) | ⏳ |
| D2 | Archives : étendre `/api/esp-firmware` (variantes `?board=r4&screen=…`) ; chaque ZIP contient le dossier de firmware **autonome** (y compris `pod_bench*.h`, `secrets.h.example`), un `README.txt` propre à la combinaison (câblage, bibliothèques, carte à choisir, procédure), l'avertissement de test | les dossiers R4 (`arduino_uno_r4/…`) ne sont pas servis aujourd'hui | ⏳ |
| D3 | Page « Apprendre » : sélecteur de matériel → câblage (schéma existant `WiringDiagram`) + bibliothèques + téléchargement ; **bandeau d'avertissement** sur toute combinaison non testée, avec la date et ce qui est testé | | ⏳ |
| D4 | Tableau de compatibilité dans la doc (matériel × fonctions : image, validation, cartel, animations, tactile, SD) | | ⏳ |
| D5 | Test automatique des archives : chaque ZIP contient exactement les fichiers attendus, aucun identifiant Wi-Fi, aucun `secrets.h` | test jest/node | ⏳ |

### Avertissements « non testé » — où ils doivent apparaître
1. En-tête de chaque `.ino` / `.h` concerné (✅ fait pour `esp_tft1.8`, `esp_eink_2.7BW_OLED`, `pod_bench_esp.h`).
2. `README.txt` de chaque archive (D2).
3. Page « Apprendre » et page `/bench` (✅ pour le banc d'essai : bandeau orange par écran, piloté par `tested` dans `lib/bench/screens.ts`).
4. Journal série au démarrage : `[BENCH] … NON TESTÉ` (⏳ à ajouter aux ports R4).

## Hors périmètre / décisions à prendre
- 🔎 Faut-il animer aussi les **e-ink** (non : rafraîchissement de plusieurs secondes) ? Réponse proposée : non.
- 🔎 Animations comme **blocs minés** (« niveau C » de `BENCH_ANIMATION.md` : score Proof-of-Draw d'une animation, vote, diffusion) : à décider après les mesures.
- 🔎 Intervalle des écrans au repos (300 s → 600 s) pour réduire le coût Redis : voir `NOTE_BENCH_ET_QUOTAS_2026_10_03.md` § 7.4.
