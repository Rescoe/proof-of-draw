# Lot 8B-2A — Intégration INACTIVE du noyau de rendu dans quatre firmwares canaris (compilée, jamais flashée)

| | |
|---|---|
| **Date** | 08/10/2026 — base `5e703d4` (LOT 8B-1 gelé par GPT et poussé) |
| **Réalisateur** | Claude · **auditeur** : GPT |
| **Publication** | `c5a9b7e` est **poussé** (`origin/main` = `c5a9b7e`, constaté à l'audit ; le rapport initial du lot le disait local à tort) |
| **Statut** | **Quatre firmwares COMPILÉS chemin désactivé ET chemin activé** (ESP8266 e-ink 2,9″ BWR · ESP8266 TFT 1,8″ · UNO R4 e-ink 2,9″ BWR · UNO R4 TFT 1,8″). **Jamais flashés, jamais essayés sur une carte.** Le chemin v1 est protégé par `POD_RENDER_V1`, **égal à 0 par défaut**. |
| **Interdits respectés** | aucun flash, aucun déploiement, aucune variable Vercel, aucun secret ; ACK, routes, rapport de rendu, `cartelMode` (non exposé), signature `pod-render-v1`, `AnaWorkMeta.contentHash`, OTA : **inchangés / non commencés** ; quatre firmwares seulement (pas les huit) |
| **Budget** | Redis **+0**, Neon **0** (le chemin v1 ne parle pas au serveur ; aucune route modifiée) |
| **Rollback** | `git revert` du commit (les sauvegardes d'avant sont aussi dans `firmware-backups/2026-10-08_avant-rendu-v1-canaris/`) ; rien à défaire ailleurs |
| **Mise à jour (lot 8B-2B-1)** | la marge statique du R4 e-ink 2,9″ (184 o ci-dessous) a été **restituée à 528 o** : le renderer vit désormais dans la zone qui remplaçait `qrData[600]`, RAM statique ON == OFF == base — voir `docs/LOT_8B2B1_PROPAGATION_2026_10_08.md` § 3. Les chiffres de ce document restent ceux du lot 8B-2A |
| **Suite** | **arrêt pour audit GPT avant LOT8B-2B** |

## 1. Audit des API réelles des pilotes (avant tout code)

| Famille | API de sortie réelle | Ce que ça autorise | Stratégie retenue |
|---|---|---|---|
| **ESP8266 e-ink 2,9″** (`epd2in9b_V4`, dérivé Waveshare) | `epd.Display(black, red)` exige **deux plans COMPLETS** (boucle `SendData` octet par octet, `~octet` sur le plan rouge). Mais `SendCommand` / `SendData` existent, `Init()` retourne un `int`, `TurnOnDisplay()` est `void` | un flux direct est **possible** (le pilote ne mémorise rien, il envoie octet par octet) — mais **pas** via `Display()` | ajout d'une méthode **additive** `Epd::DisplayStream(produce, ctx)` : mêmes commandes (0x24 puis 0x26), mêmes octets, plan rouge inversé, par morceaux de 32 o ; `Display()` n'est pas touché |
| **UNO R4 e-ink 2,9″** (`epd29b.h`, pilote du dépôt) | `epd.display(black, red)` → `writeRam()` : boucle `SPI.transfer`, plan rouge `~octet` ; `init()` et `refresh()` **retournent un bool** (BUSY) | idem, et l'échec du panneau est **détectable** | ajout additif `Epd29b::displayStream(produce, ctx)` : 0 = rafraîchi · −1 = production interrompue (aucun rafraîchissement) · −2 = panneau resté BUSY |
| **ESP8266 TFT 1,8″** (`Adafruit_ST7735`, SPI **logiciel**, GFX 1.12.6) | `tft.writePixels(uint16_t*, len, block, bigEndian)` → **`void`** ; chemin générique : `SPI_WRITE16(mot)` envoie l'octet de poids FORT d'abord (relu dans `Adafruit_SPITFT.cpp`) | écriture ligne par ligne ; **aucune erreur remontée** | une ligne source + une ligne de sortie ; `writePixels(…, true, false)` |
| **UNO R4 TFT 1,8″** (`Adafruit_ST7735`, SPI matériel) | idem ; l'ancien chemin R4 appelait déjà `writePixels(g_rowPixels, IMG_W, true)` (`bigEndian` = faux) | idem | idem, avec les tampons `g_rowBytes` / `g_rowPixels` **existants** |

**Conséquences honnêtes** : (1) l'e-ink peut être alimenté **sans tampon final** parce que le pilote envoie octet par octet, pas parce que la bibliothèque le propose ; (2) sur le TFT et sur l'ESP8266 e-ink, **aucune erreur d'écriture n'est observable** (`writePixels`, `SendData`, `TurnOnDisplay` sont `void`) : seuls sont détectés — et provoquent l'abandon sans ACK — l'échec d'initialisation (`Init()` / `init()`), l'échec de lecture du flux, l'échec de composition, l'arrêt de la production ; (3) seule la R4 e-ink observe la broche BUSY : un BUSY qui ne retombe pas (code −2) signifie que **toutes les données et la commande de rafraîchissement ont été envoyées** mais que la **fin physique** du rafraîchissement n'est pas confirmée — l'image peut être affichée ou en cours d'affichage ; ce n'est **pas** « non remis ».

### Ordre des octets au TFT (preuve par la bibliothèque, pas par hypothèse)
Le noyau produit le RGB565 **petit-boutiste** (les octets hachés dans `renderHash`). ESP8266 : l'ancien code échangeait les octets à la main puis appelait `writePixels(…, bigEndian = true)` ; la bibliothèque rééchangeait (`__builtin_bswap16`) avant `SPI_WRITE16`. Le nouveau code passe les mêmes octets, lus comme mots natifs, avec `bigEndian = false` : `SPI_WRITE16(mot)` → **même signal sur le fil**, sans échange intermédiaire, et le tampon remis au pilote **est** celui qui alimente `renderHash`. Raisonnement valable pour le SPI **logiciel** de GFX 1.12.6 (version installée) ; à confirmer à l'œil sur le canari (couleurs inversées = octets échangés).

### Plan rouge de l'e-ink
Le pilote **inverse** le plan rouge (`~octet`) avant de l'envoyer au panneau (comportement d'origine, conservé). `renderHash` couvre donc les octets du **plan logique** remis à `produce` ; l'inversion du plan rouge est une transformation fixe du pilote, documentée, indépendante des données, et testée (émulation du pilote dans le harnais).

## 2. Stratégie mémoire et ordre exact des tampons

### E-ink (ESP8266 et R4) : AUCUN tampon final, AUCUNE grille
```
(existant, inchangé)   blackBuf 4 736 o + redBuf 4 736 o     ← reçus du serveur, JAMAIS modifiés par le chemin v1 (le fit et la priorité du rouge en ont besoin)
1. frameHash           hash des 2 × 4 736 octets REÇUS      (TLS déjà fermé)
2. begin()             PodEinkRenderer : 264 o (ESP8266) / 272 o (R4)
3. panneau             initDisplayForRefresh() / epd.init()  — échec => abandon, RIEN n'est envoyé
4. DisplayStream       produce() ≤ 32 o à la fois → SPI ; 0x24 (noir tel quel) puis 0x26 (rouge inversé)
5. finish()            renderHash = hash des octets remis    — faux si la production s'est arrêtée
```
**Pic ajouté** : ≈ 264 o (objet) + 32 o (morceau du pilote) + 128 o (hasheur, ESP8266, libéré avant la suite). Les plans existent déjà (ils sont la destination du téléchargement) : **ESP8266 — ils sont alloués par `doFetchFrame` AVANT le TLS, comme avant ce lot (9 472 o de tas, inchangé) ; le chemin v1 n'alloue RIEN, ni avant, ni pendant, ni après le TLS.** Aucun gros tampon pendant le TLS n'est ajouté.
**« Rendu calculé » vs « rendu remis au pilote »** : trois états explicites — 0 échec avant la fin de la remise · 1 **toutes les données et la commande de rafraîchissement envoyées, fin physique non confirmée** (R4 : BUSY expiré) · 2 calculé **et** remis, rafraîchissement confirmé (R4) ou lancé (ESP8266, qui ne peut pas le confirmer). Seul 2 mène au succès (donc à l'ACK existant, inchangé) ; 1 est traité prudemment comme un échec : **pas d'ACK, le serveur réessaiera**.

### État de l'écran après un échec — NON garanti inchangé
L'absence d'ACK protège le serveur (il renverra l'image), **pas l'écran** :

| Cas | Ce que montre l'écran |
|---|---|
| **TFT**, coupure du flux ou refus de composition en cours de route | les lignes déjà écrites sont **affichées** : image **partiellement redessinée** (comme avant ce lot, où le TFT était aussi écrit pendant la lecture) |
| **e-ink**, échec avant la remise (`Init()`/`init()`, `frameHash`, `begin`) après une page blanche | l'écran peut être **resté blanc** : la page blanche (`clearDisplayWhite()` sur ESP8266 quand une image était déjà affichée ; `CLEAR_BEFORE_IMAGE` sur R4) est affichée **avant** le rendu de la nouvelle image |
| **e-ink**, production interrompue pendant la remise | la RAM du panneau est partiellement écrite, mais le rafraîchissement **n'est pas lancé** : l'écran garde son **état physique du moment** (ancienne image, ou page blanche si elle vient d'être affichée) |
| **e-ink R4**, BUSY expiré (état 1) | données et commande envoyées ; l'image peut être **affichée ou en cours d'affichage** |

Le canari (8B-2B) devra observer ces cas sur la carte avant toute activation.

### TFT 1,8″ : une ligne source + une ligne de sortie
```
statique   PodTftRenderer 408 o (ESP8266) / 424 o (R4) + ligne source 256 o + ligne de sortie 256 o     (R4 : g_rowBytes / g_rowPixels existants, rien de plus)
boucle     [lire UNE ligne source du flux] → consumeSource() → emitRow() → writePixels() → yield()
fin        les lignes sources restantes sont lues et hachées EN ENTIER, puis finish()
```
Le TFT est écrit **pendant** la lecture TLS (comme avant) : le coût ajouté est statique (hors tas), le tas n'est pas touché.

### Constantes en flash (ESP8266)
`POD_FONT_5X7` (210 o) et la table de repli Latin-1 (64 o) passent en `PROGMEM` (macro `POD_PROGMEM` + lecture `POD_READ_U8`). Vérifié : le symbole est à une adresse `0x4023xxxx` (flash) dans l'ELF ESP8266, plus en RAM ; équivalence prouvée par les **mêmes vecteurs** (hôte) et par un build hôte avec un faux `Arduino.h` qui exerce le chemin `pgm_read_byte`.

## 3. Intégration inactive

* `#define POD_RENDER_V1 0` dans chaque `.ino` (surchargeable : `-DPOD_RENDER_V1=1`). À 0, **le noyau n'est même pas inclus**.
* `POD_RENDER_MODE_DEFAULT` = `POD_R_FIT` : constante de **compilation**, aucun réglage utilisateur, aucune interface, aucun champ serveur (`cartelMode` non exposé).
* **Preuve que le chemin désactivé n'a pas changé** (test `tests/renderFirmware.test.ts`) : chaque `.ino` et chaque pilote modifié, une fois retirés les blocs balisés `POD_RENDER_V1_BEGIN/END` et évaluées les conditionnelles `POD_RENDER_V1 = 0`, sont **identiques, au texte près (lignes vides ignorées), aux sauvegardes d'avant le lot**. `ackFrame` et les chemins `/api/*` sont comparés mot pour mot.
* Les en-têtes du noyau sont **copiés** dans les quatre dossiers (un dossier de firmware est autonome, zippé tel quel par `/api/esp-firmware`) : `node scripts/sync-bench-header.js`, test `benchHeaderCopies`. Conséquence à connaître : l'archive servie par cette route contiendra ces quelques fichiers en plus pour ces quatre variantes (inertes tant que `POD_RENDER_V1` reste 0).
* Chemin v1 ACTIVÉ : `frameHash` et `renderHash` sont **seulement journalisés** (Serial) ; aucune requête réseau supplémentaire.

## 4. Mesures de COMPILATION (arduino-cli 1.4.1, esp8266 3.1.2, renesas_uno 1.5.3 ; archivées `docs/mesures/8B2A_2026_10_08/`)

Outillage archivé (`versions.txt`) : `arduino-cli 1.4.1`, cœur `esp8266:esp8266 3.1.2` (xtensa-lx106-elf-gcc 10.3), cœur `arduino:renesas_uno 1.5.3` (arm-none-eabi-gcc 7-2017q4), `Adafruit GFX 1.12.6`. Chaque firmware compilé **avant le lot** (base), **chemin désactivé** (OFF) et **chemin activé** (ON, `-DPOD_RENDER_V1=1`), `--warnings all`.

| Firmware | RAM statique (o) base · OFF · ON | Δ ON | Flash (o) base · OFF · ON | Δ ON |
|---|---|---|---|---|
| ESP8266 e-ink 2,9″ BWR | 34 808 · **34 808** · 35 056 | **+248** | 408 120 · **408 120** · 417 708 | +9 588 |
| ESP8266 TFT 1,8″ | 36 064 · **36 064** · 37 116 | **+1 052** | 501 948 · **501 948** · 505 340 | +3 392 |
| UNO R4 e-ink 2,9″ BWR | 22 768 · **22 768** · 23 112 | **+344** | 118 444 · **118 444** · 121 444 | +3 000 |
| UNO R4 TFT 1,8″ | 20 864 · **20 864** · 21 424 | **+560** | 128 168 · 128 160 · 130 784 | +2 624 |

* **OFF == base** : RAM identique à l'octet près sur les quatre ; flash identique sur trois, **−8 o** sur la R4 TFT (écart d'origine non investiguée — très probablement le décalage des numéros de ligne dans des constantes du binaire ; le texte du firmware est identique, voir § 3).
* **ESP8266 : règle 8 du CLAUDE.md (≤ 40 000 o de RAM statique)** — 35 056 et 37 116 : respectée (marges 4 944 et 2 884 o). Les tables de police sont en flash (`0x4023xxxx`), les statiques ajoutés sont les objets du noyau et les tampons de ligne du TFT.
* **⚠ UNO R4 e-ink — marge statique très faible** : le cœur R4 réserve à l'édition de liens un tas de 8 192 o, une pile de 1 024 o et une table de vecteurs de 256 o (`fsp.ld`, `BSP_CFG_STACK_MAIN_BYTES = 0x400`), soit 9 472 o sur 32 768. Marge statique résiduelle de ce firmware : **528 o avant le lot, 184 o avec le rendu v1** (TFT : 2 432 → 1 872 o). Pendant ce lot, 130 o de variables statiques de trop ont fait ÉCHOUER l'édition de liens (« section .stack_dummy overlaps section .heap ») : un dépassement est donc détecté **à la compilation**, jamais à l'exécution, mais aucune nouvelle variable globale n'est possible sur ce firmware sans libérer de la RAM (le lot 8B-2B / une prochaine étape devra le traiter avant d'étendre le rendu v1 ou d'y ajouter autre chose).
* **Avertissements du dépôt** (`avertissements.txt`) : base · OFF · ON = 1·1·1 (ESP e-ink), 4·4·4 (ESP TFT), 0·0·0 (R4 e-ink), 0·0·0 (R4 TFT). Les avertissements existants (ArduinoJson déprécié, comparaison signée) sont **inchangés** ; **aucun avertissement nouveau** ni en OFF ni en ON. (Pendant le lot, les fonctions de gravure en place devenues inutiles en ON ont été placées sous `#if !POD_RENDER_V1` pour ne produire aucun avertissement « defined but not used ».)
* **Sondes du noyau seul** (`consensus-pod/examples/RenderProbe*`, recompilées) : objets inchangés par rapport au lot 8B-1 — `PodEinkRenderer` 264 o (ESP8266) / 272 o (R4), `PodTftRenderer` 408 / 424 o ; `POD_FONT_5X7` en flash sur les deux familles.

## 5. Pile et marges

Analyse **statique** (`-fstack-usage`, build optimisé, `pile_colle_firmwares.txt`) — **pas une mesure d'exécution**. Les fonctions de colle sont en grande partie inlinées dans leur appelant ; les cadres à comparer sont donc ceux de l'appelant.

| Appelant (cadre statique, octets) | OFF | ON | Δ |
|---|---|---|---|
| ESP8266 e-ink `doFetchFrame` | 272 | 448 (+ `podRenderProduce` 48) | +176 |
| ESP8266 TFT `doFetchFrame` | 576 | 512 (+ `podReadSourceRow` 32) | −64 (plus de `rowBuf` de 256 o sur la pile) |
| UNO R4 e-ink `doPull` (contient `doFetchFrame`) | 408 | 432 (+ `podRenderProduce` 80) | +24 |
| UNO R4 TFT `doPull` | 424 | 480 | +56 |

Chaînes les plus profondes du **noyau** (sonde `-fno-inline`, avec le SHA-256 de la bibliothèque `Crypto` sur R4) après le passage des préfixes de hash en alimentation par morceaux (plus aucun tampon de préfixe de 64–96 o) : début de rendu TFT ≈ 80 + 24 + 32 + 32 + 80 = **≈ 250 o** (avant : ≈ 304 o) ; lecture e-ink ≈ 24 + 40 + 16 ≈ 80 o (+ 112 o dans SHA-256 à chaque `update`).

**Somme R4 (estimation par addition des cadres statiques ; NON mesurée)** — pile principale de la R4 = **1 024 o** :

| Chemin R4 | Chaîne | Total estimé |
|---|---|---|
| e-ink ON, pendant le rendu | `loop` 56 + `doPull` 432 + pilote (`displayStream`, morceau de 32 o) ≈ 56 + `podRenderProduce` 80 + SHA-256 `update` + `processChunk` 112 | **≈ 736 o** |
| e-ink ON, début de rendu | 56 + 432 + noyau ≈ 224 | ≈ 712 o |
| TFT ON, pendant la lecture/composition | `loop` 56 + `doPull` 480 + `consumeSource` → SHA-256 112 (+ lecture HTTP et `writePixels`, non sommés) | ≈ 650 o + lecture réseau |

**Marge explicite pour interruptions et appelant** : il reste, au mieux, ≈ 290 o (e-ink) sous la pile de 1 024 o pour la pile des interruptions (Cortex-M33 : 32 o par exception, jusqu'à 104 o avec contexte flottant) et pour les bibliothèques (`WiFiS3`, `SPI`, Arduino core) non sommées. **C'est une marge faible et NON validée** ; les fonctions déjà présentes avant ce lot sont plus gourmandes (`doValidate` : 648 o de cadre, antérieur à ce lot, non modifié). Le lot **8B-2B doit mesurer la pile réelle sur la carte canari** (peinture de la pile, plus haut niveau atteint) avant toute décision d'activer `POD_RENDER_V1` sur R4.

Tous les objets lourds de la R4 sont **globaux** (`g_podEink`, `g_podTft`, tampons de ligne existants) ; aucun tableau local de plus de 32 o (morceau du pilote) n'est ajouté ; le frameHash de l'e-ink R4 réutilise le contexte SHA du renderer (`frameHash()`, un contexte de 136 o économisé) et le hash est un tampon statique de 65 o.
ESP8266 : pile de la tâche ≈ 4 Ko (pas de limite de 1 Ko) ; les cadres ci-dessus sont comparables aux plus gros cadres existants (`podFetchAndCheck` 944 o).

## 6. Ce que ce lot n'établit PAS

* **Aucun essai sur carte** : ni image affichée, ni couleurs (ordre des octets du TFT), ni temps de rendu, ni chien de garde, ni pile réelle, ni tas libre. Les cadres de pile sont une analyse statique, pas une mesure d'exécution.
* Les huit firmwares ne sont pas concernés (quatre canaris ; propagation = lot 8B-2B).
* Le rendu v1 n'est pas rapporté au serveur (ni dans l'ACK, ni signé) ; `cartelMode` n'est pas exposé ; `AnaWorkMeta.contentHash` n'est pas intégré ; pas d'OTA.
* Les erreurs d'écriture ne sont observables que là où l'API les expose (§ 1).
* Le firmware TFT 1,8″ local contenant le Wi-Fi n'est pas concerné : les identifiants restent dans `secrets.h` (ignoré par git) ; rien de ce lot ne les lit ni ne les copie.

## 7. Niveau d'assurance

Aucun niveau de la synthèse « Apprendre » ne change (aucune activation) : `roadmap.ts` et `SynthesisPath.tsx` inchangés.
