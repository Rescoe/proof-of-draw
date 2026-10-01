# Compatibilité écrans / équipements × fonctionnalités

Tableau de suivi tenu à la main, mis à jour le **01/10/2026**. Légende des niveaux de preuve :
✅ vérifié dans le code **et** couvert par un test automatique · 🔎 vérifié dans le code seulement ·
🧪 testé sur matériel réel par le porteur (déclaratif) · ❔ non vérifié · ❌ absent.

Source de vérité du matériel : `lib/screenProfiles.ts` (`SCREEN_PROFILES`). Les 4 types d'écrans ci-dessous sont les seuls
connus du serveur ; ajouter un écran = nouveau profil **puis une colonne dans ce tableau**.

## 1. Matériel

| | OLED 0.96" | E-ink 2.7" BW | E-ink 2.9" BWR | TFT 1.8" |
|---|---|---|---|---|
| Identifiant (`ScreenId`) | `oled096` | `eink27bw` | `eink29bwr` | `tft18` |
| Résolution canvas | 128 × 64 | 264 × 176 | 296 × 128 | 128 × 160 |
| Couleurs | noir / blanc | noir / blanc | noir / blanc / rouge | 16 bits (RGB565) |
| Format du payload | 1 bit, page-major (`buffer`) | 1 bit, rotation 90° (`buffer`) | 2 buffers 1 bit (`black` + `red`) | RGB565 little-endian (`buffer`) |
| Taille du payload | 1 024 o | 5 808 o | 2 × 4 736 o | 40 960 o |
| Firmware (dossier `esp8266/`) | `esp_eink_2.7BW_OLED` (multi-écran, `multiscreen-2.0`) | `esp_eink_2.7BW` (`eink27bw-2.0`) ou la carte combinée | `esp_eink_2.9BWR` (`2.0`) | `esp_tft1.8` (`tft18-1.0`) |
| Carte combinée | OLED + e-ink 2.7" sur un même ESP | idem | — | — |

## 2. Fonctionnalités

| Fonctionnalité | OLED | 2.7" BW | 2.9" BWR | TFT | Preuve / remarque |
|---|---|---|---|---|---|
| Afficher un dessin d'artiste validé (pull-frame binaire) | ✅ | ✅ | ✅ | ✅ | `pull-frame` + `ack-frame` présents dans les 4 firmwares ; encodage/décodage testés (`tests/screenConvert.test.ts`) |
| Participer à la validation (vote, `validate-candidate`) | 🔎 | 🔎 | 🔎 | 🔎 | appel présent dans les 4 firmwares ; quorum multi-ESP jamais testé (`poolSize > 1`) |
| Paire de clés ED25519 générée au démarrage | 🔎 | 🔎 | 🔎 | 🔎 | `Ed25519.h` dans les 4 ; signature des votes encore « V1 simplifiée » : ❔ |
| Rouge | ❌ | ❌ | ✅ (canal `red`) | ✅ (pixel rouge) | conservé par les conversions (testé) |
| Vraie opacité des pinceaux | ❌ | ❌ | ❌ | ✅ | seul le RGB565 la porte ; ailleurs, trames de points (Bayer 8×8) |
| Studio de dessin (3 boîtes à outils) | ✅ | ✅ | ✅ | ✅ | canvas aux dimensions de l'écran ; palette limitée à ce que l'écran affiche |
| **Réception des œuvres d'agents IA** (`acceptsAnaArt`) | 🔎 🧪 | 🔎 🧪 | 🔎 🧪 | 🔎 🧪 | une œuvre = un bloc par type d'écran (`ANA_ENCODABLE_SCREENS = SCREEN_IDS`), diffusion live seulement aux appareils opt-in |
| **Réception de dessins conçus pour un autre écran** (conversion à la volée) | ✅ | ✅ | ✅ | ✅ | les 12 conversions croisées et l'aller-retour natif sont testés ; rouge BWR ↔ TFT conservé ; réglage par écran, activé par défaut (`convertedScreensOf`) |
| **Poèmes d'agents IA** (texte rendu en pixels) | ✅ | ✅ | ✅ | ✅ | `lib/poemRender.ts`, testé sur les 4 ; **statique** (pas de défilement) ; poème long tronqué par « ... » |
| Portrait 40×40 du Normie auteur sur l'écran | ✅ ×1, à gauche | ✅ ×2, à gauche | ✅ ×2, à gauche | ✅ ×1, en haut | source : `api.normies.art/normie/{id}/pixels` ; le texte ne l'empiète jamais (testé sur l'OLED) |
| Défilement du texte | ❌ | ❌ (rafraîchissement lent) | ❌ (idem) | ❌ | demande plusieurs frames : voir mémoire ESP8266 (étude du 26/09) |
| Œuvres perso envoyées à son propre écran (« Afficher sur mon écran ») | 🔎 | 🔎 | 🔎 | 🔎 | route `send-to-screen`, conversion incluse |
| Prêt public de l'écran (`publicMode`) | 🔎 | 🔎 | 🔎 | 🔎 | réglage par appareil (pas par écran) |
| Dernière image conservée hors tension | ❔ | ✅ (e-ink) | ✅ (e-ink) | ❔ | e-ink : bistable ; OLED : 1 frame en EEPROM (étude du 26/09) ; TFT : persistance SD désactivée (mémoire insuffisante) |
| Carte SD | ❌ | ❌ | ❌ | 🔎 câblée, non utilisée pour les frames | |
| Boucles / GIF (frame par frame) | ❌ | ❌ | ❌ | ❌ | moteur de dessin prêt (`frame` par entrée), firmware et pipeline à faire |

## 3. Matrice des conversions (testée)

Chaque case est une conversion `lib/screenConvert.ts` → `encodeForScreen`, vérifiée par `tests/screenConvert.test.ts`
(dimensions de la cible, image non vide, rouge conservé là où la cible le porte). Une source monochrome n'invente jamais de rouge.

| de ↓ / vers → | OLED | 2.7" BW | 2.9" BWR | TFT |
|---|:-:|:-:|:-:|:-:|
| OLED | = | ✅ | ✅ | ✅ |
| 2.7" BW | ✅ | = | ✅ | ✅ |
| 2.9" BWR | ✅ (rouge → encre) | ✅ (rouge → encre) | = | ✅ (rouge conservé) |
| TFT | ✅ (seuil de luminance) | ✅ | ✅ (rouge conservé) | = |

Le redimensionnement conserve les proportions (bandes blanches) et prend le pixel le plus sombre au sous-échantillonnage pour ne pas
perdre les traits fins.

## 4. Appareils connus en production (01/10/2026, lecture seule)

| Appareil | Écrans | Réception IA |
|---|---|---|
| `dev_KAD6PKC4` | OLED + e-ink 2.7" BW | activée |
| `dev_VIRBQRV1` | TFT 1.8" | activée |
| `dev_MN67OG7R` | e-ink 2.9" BWR | activée |
| `dev_T46HBXG1` | e-ink 2.9" BWR | — (hors ligne, sans profil) |

## 5. À noter

- Le firmware 2.9" BWR envoie déjà à l'enregistrement la liste de ses blocs possédés (`ownedHashes`) : le serveur l'**ignore**
  aujourd'hui (`app/api/register/route.ts`). Piste pour la récupération de blocs côté ESP.
- Mise à jour de ce document : à chaque nouveau firmware, nouvel écran ou nouvelle fonctionnalité, modifier la ligne concernée **et**
  le niveau de preuve. Les cellules ✅ doivent pointer vers un test existant ; sinon passer en 🔎.
