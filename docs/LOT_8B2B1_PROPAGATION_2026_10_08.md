# Lot 8B-2B-1 — Propagation INACTIVE du rendu v1 aux quatre derniers firmwares à cartel gravé (compilée, jamais flashée)

| | |
|---|---|
| **Date** | 08/10/2026 — base `089e2db` (LOT 8B-2A-FIX1 accepté par GPT) |
| **Réalisateur** | Claude · **auditeur** : GPT |
| **Statut** | **Huit firmwares à cartel gravé portent désormais l'option `POD_RENDER_V1` (0 par défaut) ; la matrice complète — 8 firmwares × chemin désactivé / activé = 16 compilations — passe.** Jamais flashé, jamais essayé sur une carte. |
| **Interdits respectés** | aucun flash, aucune activation (`POD_RENDER_V1 = 0` partout), aucune modification serveur, aucun ACK / route / rapport de rendu / `cartelMode` / signature / `AnaWorkMeta.contentHash` / OTA ; Redis **+0**, Neon **0** |
| **Règle R4 e-ink respectée** | **aucune variable globale ajoutée** : le renderer vit dans la zone qui remplaçait `qrData[600]` → RAM statique ON == OFF == base **à l'octet** sur les trois R4 e-ink (voir § 3) |
| **Rollback** | `git revert` du commit ; sauvegardes d'avant dans `firmware-backups/2026-10-08_avant-propagation-8b2b1/` |
| **Suite** | **arrêt pour audit GPT** |

## 1. Périmètre : quels firmwares, lesquels non

Les huit firmwares dont le cartel est **gravé dans l'image** (liste de `lib/cartelZones.ts`) :

| # | Firmware | Lot |
|---|---|---|
| 1-4 | ESP8266 e-ink 2,9″ BWR · ESP8266 TFT 1,8″ · UNO R4 e-ink 2,9″ BWR · UNO R4 TFT 1,8″ | 8B-2A |
| 5 | ESP8266 e-ink 2,7″ (`esp_eink_2.7BW`) | **8B-2B-1** |
| 6 | ESP8266 multiscreen e-ink 2,7″ + OLED (`esp_eink_2.7BW_OLED`) | **8B-2B-1** |
| 7 | UNO R4 e-ink 2,7″ (`pod_uno_r4_eink27`) | **8B-2B-1** |
| 8 | UNO R4 e-ink 2,7″ + OLED (`pod_uno_r4_eink27_oled`) | **8B-2B-1** |

**Non concernés, volontairement** : UNO R4 TFT 2,8″ (`pod_uno_r4`, cartel affiché / caché au toucher, jamais gravé) et les écrans OLED (aucun cartel gravé) : pour eux le rendu v1 est un passage sans traitement (`PodPassHasher`), sans objet à intégrer. Dans les deux firmwares « + OLED », **seul le chemin e-ink est modifié ; le chemin OLED est inchangé** (texte identique).

## 2. Audit des pilotes e-ink 2,7″ (avant tout code)

Les quatre `epd2in7_V2.cpp/.h` sont la **même copie** du pilote Waveshare (à une ligne vide finale près).

| Constat | Détail |
|---|---|
| API de sortie | `Display(const unsigned char* Image)` : `SendCommand(0x24)` puis `Width × Height` octets (`pgm_read_byte`), puis `TurnOnDisplay()` — **un seul plan**, **sans inversion** (différent du 2,9″ BWR) |
| `SendCommand` / `SendData` | publics → flux direct possible (même raisonnement qu'au 8B-2A) |
| `Init()` | retourne un `int` (0 = ok) |
| **`ReadBusy()`** | `while (busy == 1) DelayMs(100)` : **attend indéfiniment, sans délai maximal** ; `TurnOnDisplay()` est `void` → **aucun « BUSY expiré » n'existe** sur ce pilote : deux états seulement, « échec avant la fin de la remise » (0) et « calculé ET remis, rafraîchissement terminé » (2). Un câble BUSY débranché bloquerait le firmware — **comportement antérieur, non modifié, à connaître** |
| Modification apportée | ajout **additif** `Epd::DisplayStream(produce, ctx)` (balisé `POD_RENDER_V1_BEGIN/END`, identique dans les quatre copies, testé) : `0x24`, octets tels quels par morceaux de 32 o, `TurnOnDisplay()` seulement si la production a tout rendu |
| ESP8266 multiscreen | `displayE27Buffer()` termine par `SPI.endTransaction(); SPI.end(); lastScreenWasSPI = false; oledReady = false;` (l'OLED partage GPIO12) : la remise en flux **reproduit exactement ce nettoyage** |
| R4 | `refreshPanel()` enveloppe `Init() + Display() + Sleep()` dans `SPI.begin()` + `SPI.beginTransaction(2 MHz, MODE0)` : la remise en flux reproduit cette transaction |
| Allocation (ESP8266 multiscreen) | le tampon e-ink est alloué **après** la fermeture du TLS (via un fichier LittleFS) : le chemin v1 n'ajoute **aucune allocation** |

Conséquences d'écran après un échec : identiques à celles du lot 8B-2A (aucun ACK ; écran **non** garanti inchangé — page blanche éventuellement affichée avant, RAM du panneau partiellement écrite si la production s'interrompt, sans rafraîchissement).

## 3. Règle de mémoire du R4 e-ink : zéro variable globale ajoutée

Marge statique d'un R4 : 32 768 − 9 472 (tas 8 192 + pile 1 024 + vecteurs 256 réservés par l'éditeur de liens) − RAM statique. Au lot 8B-2A le R4 e-ink 2,9″ était tombé à **184 o** (le renderer, 272 o, et un hash de 65 o étaient des statiques).

**Solution retenue** : `g_podScratch[600]` **remplace** `qrData[600]` (tableau statique local de `displayOnboardingQR`, devenu une **référence** `uint8_t (&qrData)[600] = g_podScratch` sous `POD_RENDER_V1`) et héberge, par `new` **placé**, `struct PodScratch { PodEinkRenderer r; char hex[65]; }` (337 o, `static_assert ≤ 600`). Le QR d'appairage et le rendu d'une image ne sont jamais vivants en même temps (l'appairage précède tout pull de frame ; chaque rendu reconstruit son objet, la zone pouvant contenir un QR périmé). Ce n'est **pas** une allocation dynamique (aucun tas) : c'est le même octet statique, réutilisé.

| R4 e-ink | RAM statique base · OFF · ON | Marge statique (OFF → ON) |
|---|---|---|
| 2,9″ BWR | 22 768 · 22 768 · **22 768** | 528 → **528** (au 8B-2A : 184) |
| 2,7″ | 19 128 · 19 128 · **19 128** | 4 168 → **4 168** |
| 2,7″ + OLED | 21 500 · 21 500 · **21 500** | 1 796 → **1 796** |

Le firmware R4 e-ink 2,9″ du lot 8B-2A est **rétro-ajusté** par cette même technique : il restitue les 344 o consommés. Le chemin désactivé garde son `qrData[600]` d'origine (texte identique, testé).

## 4. Intégration (même schéma que le lot 8B-2A)

* `POD_RENDER_V1 = 0` par défaut, `POD_RENDER_MODE_DEFAULT = POD_R_FIT` (constante de compilation, aucun réglage exposé) ; à 0, le noyau n'est même pas inclus.
* ESP8266 : `podRenderAndShowE27()` — `PodEinkRenderer` sur la pile (264 o) ; le `frameHash` est calculé avec le contexte du renderer (`frameHash()`), puis `begin()`, `initE27ForRefresh()`, `DisplayStream`, `Sleep`. Retour 0 / 2.
* R4 : `podRenderAndShow()` — mêmes étapes dans `PodScratch`, avec la transaction SPI de `refreshPanel()`. Retour 0 / 2 (2,7″) ; 0 / 1 / 2 (2,9″, seul pilote qui observe BUSY).
* Les fonctions de gravure en place devenues inutiles (`burnCartel`, `whiteRows`) sont sous `#if !POD_RENDER_V1` : aucun avertissement « defined but not used ».
* Quand le rendu v1 est actif sur le multiscreen ESP8266, le cartel est **toujours** rendu (repli « PROOF-OF-DRAW » si les métadonnées sont vides), alors que l'ancien chemin gravait le cartel seulement si au moins une métadonnée existait : différence assumée du contrat `layoutVersion = 1`.
* Les copies du noyau (`consensusPoD.h`, `podRender.h`, `podRenderStream.h`, adaptateur SHA-256) sont dans les **huit** dossiers : `node scripts/sync-bench-header.js`, test `benchHeaderCopies`.
* **Preuve que le chemin désactivé n'a pas changé** (`tests/renderFirmware.test.ts`) : pour les huit `.ino` et tous les pilotes modifiés, la vue « POD_RENDER_V1 = 0 » est **identique, au texte près, aux sauvegardes** (lignes vides et espaces finaux ignorés) ; `ackFrame` et les chemins `/api/*` sont comparés mot pour mot.

## 5. Mesures de COMPILATION (matrice complète, archivées `docs/mesures/8B2B1_2026_10_08/`)

Outillage : `arduino-cli 1.4.1`, `esp8266:esp8266 3.1.2`, `arduino:renesas_uno 1.5.3`, Adafruit GFX 1.12.6 (`versions.txt`). `--warnings all`, `-fstack-usage`.

| Firmware | RAM statique base · OFF · **ON** | Δ ON | Flash base · OFF · **ON** | Δ ON |
|---|---|---|---|---|
| ESP8266 e-ink 2,9″ | 34 808 · 34 808 · 35 056 | +248 | 408 120 · 408 120 · 417 708 | +9 588 |
| ESP8266 TFT 1,8″ | 36 064 · 36 064 · 37 116 | +1 052 | 501 948 · 501 948 · 505 340 | +3 392 |
| ESP8266 e-ink 2,7″ | 34 240 · 34 240 · 34 352 | +112 | 413 920 · 413 920 · 417 148 | +3 228 |
| ESP8266 e-ink 2,7″ + OLED | 35 200 · 35 200 · 35 316 | +116 | 473 820 · 473 820 · 476 956 | +3 136 |
| UNO R4 e-ink 2,9″ | 22 768 · 22 768 · 22 768 | **0** | 118 444 · 118 444 · 121 476 | +3 032 |
| UNO R4 TFT 1,8″ | 20 864 · 20 864 · 21 424 | +560 | 128 168 · 128 168 · 130 792 | +2 624 |
| UNO R4 e-ink 2,7″ | 19 128 · 19 128 · 19 128 | **0** | 117 572 · 117 572 · 120 284 | +2 712 |
| UNO R4 e-ink 2,7″ + OLED | 21 500 · 21 500 · 21 500 | **0** | 132 192 · 132 184 · 134 896 | +2 712 |

* **OFF == base** : RAM identique à l'octet sur les huit ; flash identique sur sept, **−8 o** sur le R4 e-ink 2,7″ + OLED (écart non investigué — très probablement des constantes de numéros de ligne ; le texte est identique).
* **ESP8266 (règle 8 du CLAUDE.md, ≤ 40 000 o)** : tous respectent (35 056 et 37 116 au plus). Le surcoût est une pile (renderer 264 o), pas du tas.
* **Avertissements du dépôt** (`avertissements.txt`) : base · OFF · ON identiques sur les huit (1, 4, 1, 4 pour les ESP8266 — avertissements antérieurs inchangés —, 0 pour les R4) ; **aucun avertissement nouveau**, en OFF comme en ON (16 / 16).

### Pile (analyse STATIQUE `-fstack-usage` ; pas une mesure d'exécution)

| Cadre de l'appelant (octets) | OFF | ON | Δ |
|---|---|---|---|
| ESP8266 e-ink 2,9″ `doFetchFrame` | 272 | 448 | +176 |
| ESP8266 TFT 1,8″ `doFetchFrame` | 576 | 512 | −64 |
| ESP8266 e-ink 2,7″ `doFetchFrame` | 304 | 512 | +208 |
| ESP8266 e-ink 2,7″ + OLED `doFetchFrameE27` | 624 | 672 | +48 |
| UNO R4 e-ink 2,9″ `doPull` | 408 | 432 | +24 |
| UNO R4 TFT 1,8″ `doPull` | 424 | 480 | +56 |
| UNO R4 e-ink 2,7″ `doPull` | 416 | 424 | +8 |
| UNO R4 e-ink 2,7″ + OLED `doPull` | 440 | 440 | 0 |

**Somme R4 e-ink (estimation par addition des cadres statiques, NON mesurée)** : `loop` 56 + `doPull` ON (432 / 424 / 440) + pilote (morceau de 32 o + appel) ≈ 56 + `podRenderProduce` 80 + SHA-256 `update` + `processChunk` 112 ≈ **728 à 744 o sur 1 024 o**, soit ≈ 280–296 o pour les interruptions et les bibliothèques. **Marge faible et NON validée** ; elle doit être mesurée sur carte (peinture de pile) avant toute activation. Les 2,7″ ne sont pas plus favorables que le 2,9″ côté pile (seule la marge statique l'est).

## 6. Ce que ce lot n'établit PAS

* **Aucun essai sur carte** : ni image, ni orientation du 2,7″ (plan en colonnes, jamais vu à l'écran), ni temps, pile réelle, tas libre, chien de garde ; `ReadBusy()` sans délai maximal non testé.
* Les autres limites du lot 8B-2A restent vraies (erreurs d'écriture non observables sauf là où l'API les expose ; écran non garanti inchangé après un échec).
* Aucune activation : `POD_RENDER_V1` reste 0 ; l'archive servie par `/api/esp-firmware` contiendra quelques fichiers de plus (inertes) pour ces huit variantes.
* Rapport de rendu non signé, non envoyé ; `cartelMode` non exposé ; pas d'OTA.
* **Avant toute activation** : canari matériel obligatoire (une carte ESP8266 et une UNO R4), pile et BUSY compris.

## 7. Niveau d'assurance

Aucun niveau de la synthèse « Apprendre » ne change (aucune activation) : `roadmap.ts` et `SynthesisPath.tsx` inchangés.

## 8. LOT8B2B1-FIX1 — cycle de vie de `g_podScratch` (audit GPT)

**Constat** : `SHA256` (bibliothèque Crypto) a un destructeur non trivial et probablement un alignement de 8 octets ; `alignas(4)` ne le garantissait pas (les ELF plaçaient la zone sur des multiples de 8 « par chance »), et l'objet n'était jamais détruit avant que le QR d'appairage réutilise la zone.

| Correction (les trois R4 e-ink : 2,9″, 2,7″, 2,7″ + OLED) | Détail |
|---|---|
| **Alignement garanti par le type** | `alignas(PodScratch) static uint8_t g_podScratch[600];` (plus aucun nombre magique) |
| **Destruction explicite sur tous les chemins** | la logique à sorties multiples est dans `podRenderRun(void* scratch)` ; le **point d'entrée unique** `podRenderAndShow()` fait exactement : `new (g_podScratch) PodScratch()` → `podRenderRun(S)` → `S->~PodScratch()` → `return code` (**sortie unique**, un seul `return`) |
| Aucune allocation dynamique, aucune nouvelle variable globale | le `new` est PLACÉ dans la zone existante ; `g_podScratch` est toujours le tableau qui remplace `qrData[600]` |
| Piège évité | le préprocesseur Arduino génère les prototypes **en tête de fichier** : une fonction à paramètre `PodScratch*` ne compilait pas (« 'PodScratch' was not declared ») — d'où le paramètre `void*` converti dans le corps |

**Gardes** : (1) `tests/renderFirmware.test.ts` impose, pour les trois firmwares, `alignas(PodScratch)` (ni `alignas(4)` ni `alignas(8)`), **un seul** `new (g_podScratch)` et **un seul** `->~PodScratch()`, le wrapper réduit à ses quatre instructions, `podRenderRun()` sans construction ni destruction et appelée uniquement par le wrapper ; (2) `consensus-pod/host/scratch_cycle_test.cpp` exécute le **même schéma** avec un SHA-256 de type Crypto (destructeur non trivial, alignement 8) : alignement vérifié, 4 tours sur une zone remplie de débris (0xA5, 0xFF, 0x00, pseudo-aléatoire), `ctor == dtor` à chaque tour, résultats identiques à chaque tour, oubli de destruction détecté, zone réutilisable comme tableau de 600 octets.

**Recompilation des trois R4 e-ink OFF / ON** (`--warnings all`, `-fstack-usage`) : **RAM statique inchangée à l'octet** (22 768 / 19 128 / 21 500 en OFF et en ON) ; **chemin désactivé inchangé** (flash et cadre `doPull` identiques, texte identique aux sauvegardes) ; chemin activé : flash +32 o sur le 2,9″, inchangé sur les 2,7″ ; cadre de `doPull` identique (2,9″) ou en baisse de 8 o (2,7″) ; **aucun avertissement du dépôt**. Aucun autre changement ; aucun flash, serveur, Redis, Neon, ACK ni OTA. Toujours jamais essayé sur une carte.
