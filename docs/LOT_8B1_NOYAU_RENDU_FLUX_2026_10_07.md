# Lot 8B-1 — Noyau de rendu en flux à mémoire bornée (hôte + compilé, jamais sur carte)

| | |
|---|---|
| **Date** | 07/10/2026 — base `2488775` (LOT 8A gelé par GPT et poussé) |
| **Réalisateur** | Claude · **auditeur** : GPT |
| **Statut** | **Noyau C++ vérifié sur l'HÔTE** (différentiel contre les 228 vecteurs d'or et contre la référence à grille) **et COMPILÉ pour ESP8266 et UNO R4. Jamais essayé sur une carte, branché sur aucun firmware.** |
| **Interdits respectés** | aucun `.ino` de production, aucun flash, aucune variable Vercel, aucun secret, aucune route, aucun Redis (+0), aucun Neon (0), pas d'OTA, pas de signature `pod-render-v1`, pas de réglage `cartelMode` exposé, référence TypeScript / hashes / police / géométrie / modes **inchangés** |
| **Rollback** | `git revert` du commit ; aucune donnée, aucun état à défaire |
| **Correctif** | **LOT8B1-FIX1** (audit GPT : accepté sous réserve) : sémantique de `read()` précisée, preuve sur plans BRUTS, avertissement sur `PodRenderSpec` — voir § 8 |
| **Suite** | **arrêt pour audit GPT avant LOT8B-2** |

## 1. Ce que livre le lot

| Fichier | Rôle |
|---|---|
| `consensus-pod/src/podRenderStream.h` | le noyau : `PodEinkRenderer`, `PodTftRenderer`, `PodFrameHasher`, `PodPassHasher` (C++11, sans STL, sans allocation, sans flottant, sans `virtual`) |
| `consensus-pod/src/podRender.h` | **seule modification** : `pod_render_bottom_line` n'a plus de tampons temporaires (2 × 64 o de pile en moins) — résultat identique, vérifié par les 495 contrôles de la référence |
| `consensus-pod/host/render_stream_harness.cpp` | harnais différentiel (3 823 vérifications dont 409 exécutions sur plans bruts) : vecteurs d'or, octets du pilote, paramètres invalides, entrées tronquées, ordre d'appels |
| `consensus-pod/examples/RenderProbeEsp8266`, `RenderProbeUnoR4` | **sondes d'encombrement** (« NE PAS DÉPLOYER ») compilées pour mesurer ; ce ne sont pas des tests d'exactitude |
| `docs/mesures/8B1_2026_10_07/*` | mesures archivées (versions, compilation, tailles `nm -S`, piles `-fstack-usage -fno-inline`) |
| `tests/renderStream.test.ts` | 5 tests (différentiel, contrôle négatif, portabilité, refactor, mesures archivées) |

## 2. Principe : le pixel final est une fonction du pixel source

La référence (8A) décode les plans en grille logique, applique fit / cartel, ré-encode. Ici, chaque **octet du pilote** est calculé à la demande :

* **e-ink** : l'octet `idx` du plan `p` couvre 8 pixels d'une colonne `x` du canvas ; chacun est évalué par `pixel(x, sx, y)` : ligne de bandeau → cartel (blanc, séparateurs noirs, texte noir) ; zone sûre → pixel source (`overlay`), ou pixel source projeté `sx, sy` (`fit`, formules entières du contrat) ; hors de l'image ajustée → blanc. Le rouge l'emporte sur le noir comme au décodage. **Aucune grille, aucun double tampon** : la source (plans reçus, qui existent de toute façon pour l'écran) n'est jamais modifiée, la sortie est le tampon de l'appelant.
* **TFT 1,8″** : compositeur ligne par ligne. Le fit est **strictement monotone** (131 lignes sûres < 160 : la ligne source nécessaire croît d'au moins 1 par ligne de sortie), donc l'appelant lit ses lignes source une seule fois, dans l'ordre, et ne garde que la dernière. **Une ligne source (256 o) + une ligne de sortie (256 o)**, point.
* **OLED, TFT 2,8″, mode `hidden`** : `PodPassHasher` alimente `frameHash` et `renderHash` avec les mêmes octets (aucun traitement, comme figé en 8A).
* **`frameHash`** = hash des octets **reçus**, alimenté par morceaux (`PodFrameHasher.update`) pendant le téléchargement ; **`renderHash`** = hash des octets **exactement remis au pilote** : chaque octet produit est haché avant que `read()` / `emitRow()` ne rende la main.

### Protocole d'appel

```
e-ink     fh.begin(spec); pour chaque morceau reçu : fh.update(morceau) ; fh.finish(frameHex)
          r.begin(spec, mode, meta, planeNoir, planeRouge, octetsParPlan)
          tant que (n = r.read(out, cap)) > 0 : envoyer out[0..n) au pilote ; yield() / chien de garde
          r.finish(renderHex)                               // faux tant que tout n'a pas été produit

TFT 1,8″  r.begin(spec, mode, meta)
          tant que !r.allRowsEmitted() :
             tant que r.needsSource() : lire UNE ligne source dans src ; r.consumeSource(src)
             r.emitRow(src, out) ; écrire out sur le pilote ; yield()
          tant que r.sourceRemaining() : lire la ligne suivante ; r.consumeSource(src)   // l'image reçue est hachée EN ENTIER
          r.finish(frameHex, renderHex)
```

Alimentation progressive : `read()` produit n'importe quelle quantité d'octets (≥ 1) ; le coût d'un appel est borné (≤ 8 pixels par octet, ≤ 128 pixels par ligne TFT), donc l'appelant règle sa granularité de `yield()` / chien de garde. Le critère obligatoire du lot 8 « chien de garde ESP8266 » reste à **démontrer sur carte** (tests de 64 images identiques / quasi identiques) ; ce lot fournit seulement la possibilité de rendre la main à chaque octet.

## 3. Équivalence : ce qui est prouvé (hôte) et comment

* **228 rendus d'or** (mêmes `rvec` que 8A : 8 motifs × 3 modes × 3 écrans à cartel, 16 cas de texte aux bornes × 3 modes × 3 écrans, OLED / TFT 2,8″ × 3 modes) : `frameHash` et `renderHash` retrouvés pour **chaque** ligne ; 444 exécutions en flux (e-ink sous **deux** découpages de lecture : 1, 2, 3, 5, 8, 13, 21, 34, 55 octets, puis 22, 16, 4096, 7 ; TFT ; sans traitement).
* **Octets du pilote identiques, un à un**, à ceux de la référence à grille (`pod_render_frame`) — plus fort que l'égalité des hashes.
* **Contrôle négatif** (`tests/renderStream.test.ts`) : hash, mode ou n° de bloc modifiés, commande inconnue, ligne mal formée, mode inconnu, fichier vide → détectés sur chacun des trois écrans à cartel.
* Retard maximal de lecture source observé en fit TFT : 14 lignes (la source avance de 14 lignes sur la sortie ; la mémoire reste d'**une** ligne car les lignes intermédiaires sont consommées et oubliées).

### Paramètres invalides, entrées tronquées (tous refusés, jamais un hash plausible)

plan nul / trop court / trop long / vide ; plan rouge nul en BWR (ignoré en BW) ; mode inconnu ou négatif ; écran de mauvais type (TFT dans le rendu e-ink, e-ink ou TFT 2,8″ dans le compositeur TFT) ; date / artiste / titre annoncés sans pointeur ; lecture avant `begin` ; sortie nulle ; `finish` avant la fin, `finish` deux fois, lecture après la fin ; `frameHash` : image tronquée (un plan sur deux, un octet manquant), octet en trop, donnée nulle ; `PodPassHasher` : cartel en `overlay` / `fit` refusé (seul `hidden` ou un écran sans cartel), OLED tronqué ; TFT : émission sans avoir lu la ligne source, source lue en avance, source nulle, entrée coupée à 100 lignes, ligne en trop, image reçue non drainée (le `frameHash` serait incomplet) — état `FAILED` sticky.

## 4. Mémoire (mesures de COMPILATION ; aucune exécution)

Outillage archivé : `arduino-cli 1.4.1`, `esp8266:esp8266 3.1.2` (xtensa-lx106-elf-gcc 10.3), `arduino:renesas_uno 1.5.3` (arm-none-eabi-gcc 7-2017q4), `Crypto 0.4.0`. Les valeurs hôte (pointeurs 64 bits) ne servent qu'aux `static_assert` de plafond.

### Tailles des objets (`nm -S` sur la sonde)

| Objet | ESP8266 | UNO R4 | Contenu |
|---|---|---|---|
| `PodEinkRenderer<Sha>` | **264 o** | 272 o | contexte SHA, géométrie, 2 lignes de texte (49 o chacune), pointeurs des plans, compteurs |
| `PodTftRenderer<Sha>` | **408 o** | 424 o | 2 contextes SHA (frame + render), 3 lignes de texte, compteurs |
| `PodFrameHasher<Sha>` | 128 o | 136 o | un contexte SHA + 2 compteurs |
| `PodPassHasher<Sha>` | 240 o | 256 o | 2 contextes SHA |
| `Sha` (BearSSL / Crypto) | 112 o | 120 o | |

### Mémoire maximale théorique par famille (hors pile)

| Cas | Référence 8A (grille) | Noyau en flux |
|---|---|---|
| e-ink 2,9″ BWR, fit | 2 grilles × 75 776 = **151 552 o** | plans reçus 9 472 o (déjà nécessaires) + 264 + 128 + tampon de sortie choisi par l'appelant (la sonde : 32 o) ≈ **+0,4 Ko** |
| e-ink 2,7″ BW, fit | 2 × 92 928 = 185 856 o | plan 5 808 o (déjà nécessaire) + ≈ 0,4 Ko |
| TFT 1,8″, fit | 2 × 40 960 = 81 920 o | 408 + 256 + 256 = **920 o** |
| OLED / TFT 2,8″ | — | 240 o (flux, rien en mémoire) |

ESP8266 : après la fermeture du TLS, les plans e-ink 2,9″ occupent 9 472 o de TAS (règle 2 du CLAUDE.md, inchangée) ; le noyau ajoute ≈ 0,4 Ko et peut être alloué à ce moment-là (aucun gros objet pendant le TLS).

### Empreinte du binaire (sonde complète, comparée à la base vide du lot 6C)

| | ESP8266 | UNO R4 |
|---|---|---|
| RAM statique | 30 160 o (base 28 108) → **+2 052 o** ; plafond de la règle 8 : 40 000 → **OK** | 8 552 o (base 6 740) → +1 812 o |
| Flash | 243 472 o (base 236 148) → +7 324 o | 58 768 o (base 52 000) → +6 768 o |

⚠ Ces écarts incluent le SHA-256 (BearSSL / Crypto), les affichages série de la sonde et ses tampons statiques (2 × 256 + 32 o + objets) : c'est une **borne haute** de l'encombrement du noyau, pas son coût net. Tables : police 210 o (`POD_FONT_5X7`) + 64 o (repli Latin-1) — **en RAM sur ESP8266** (`.rodata`, ≈ 274 o), en flash sur R4 ; les placer en `PROGMEM` est un point du 8B-2.

### Pile (analyse statique `-fstack-usage -fno-inline`, PAS une mesure d'exécution)

Chaînes les plus profondes (cadres statiques en octets ; hors cadre de l'appelant, hors pile des interruptions et du cœur) :

| Chaîne | UNO R4 | ESP8266 |
|---|---|---|
| `TftRenderer::begin` → `hash_begin_render` → `render_prefix` → `PodOut::u64` | 80+112+32+48 = 272 | 112+112+32+96 = 352 |
| …→ `hash_begin_render` → SHA-256 `update` → `processChunk` (Crypto) | 80+112+32+80 ≈ **304** (+ quelques octets de wrappers) | BearSSL précompilé : **non mesuré** |
| `EinkRenderer::read` → `byteAt` → `pixel` → `pod_rline_bit` | 24+40+16+8 = 88 | 48+64+16+48 = 176 |
| `read` → SHA-256 `update` → `processChunk` | 24+32+80 = 136 | non mesuré |
| `TftRenderer::emitRow` → `cartelWord` → `pod_rline_bit` | 32+16+8 = 56 | 48+32+48 = 128 |

Plus grand cadre de fonction du noyau : 112 o (R4) / 112 o (ESP). Pile principale de la R4 : 1 024 o → le noyau consomme au plus **≈ 304 o** de la bibliothèque, il reste ≈ 700 o pour l'appelant ; aucun tableau local de plus de 49 o hors lignes de texte et préfixes de hash (≤ 96 o), ligne TFT et tampon de sortie **fournis par l'appelant** (statiques sur R4). Le test de portabilité l'impose (aucun tableau > 256 o, aucune variable statique modifiable, aucun pointeur de grille).

## 5. Ce que ce lot n'établit PAS

* **Aucune mesure sur carte** : ni temps (µs par octet / par ligne), ni pile réelle, ni tas libre, ni comportement du chien de garde. Les chiffres ci-dessus sont des tailles de compilation et une analyse statique.
* **Aucun firmware** n'appelle le noyau ; le pilote e-ink actuel (`epd.Display(blackBuf, redBuf)`) prend des tampons entiers : l'intégration devra soit envoyer les morceaux produits à l'écran (boucle d'envoi SPI adaptée), soit les ranger dans un tampon de mise en page — décision du 8B-2 / 8C.
* Le rendu e-ink calcule chaque plan séparément (le plan rouge re-évalue les pixels) : ≈ 2 × 4 736 octets × 8 pixels ; une version qui produit les deux plans en un passage est une optimisation possible, non faite.
* Les cartels **gravés aujourd'hui** par les huit firmwares ne sont pas prouvés identiques à ce noyau (positions du texte, polices du TFT : voir lot 7) — ce sera l'objet de l'intégration, avec les mêmes vecteurs.
* Pas de signature `pod-render-v1`, pas de `cartelMode` exposé, pas d'OTA, pas de flash.
* Les vecteurs d'or sont ceux de 8A (motifs structurés, textes aux bornes) ; des octets pseudo-aléatoires pour les écrans à cartel pourront être ajoutés au 8B-2 (le noyau les accepte déjà : toute combinaison d'octets est une image valide).

## 6. Budget

Redis **+0**, Neon **0**, Vercel : aucune route, aucun octet servi. Aucune variable d'environnement, aucun secret. Le noyau n'est importé par aucun fichier de `app/` ni de `lib/` (testé).

## 7. Niveau d'assurance

Aucun niveau de la synthèse « Apprendre » ne change (rien n'est branché) : `roadmap.ts` et `SynthesisPath.tsx` inchangés.

## 8. LOT8B1-FIX1 (réserves de l'audit GPT)

**1. Sémantique de `PodEinkRenderer::read`** (ce n'est plus ambigu entre erreur et no-op) :

| Appel | Retour | État |
|---|---|---|
| `cap == 0` (sortie valide **ou nulle**) | 0 | **inchangé** (no-op) |
| `out == nullptr` avec `cap > 0` | 0 | **FAILED** (erreur de l'appelant ; plus rien ne sort, `finish()` refusé) |
| lecture après la fin (DONE / FINISHED), ou hors état de marche | 0 | **inchangé** — le résultat reste récupérable par `finish()` |
| appel valide en cours de rendu | ≥ 1 octet | RUNNING, puis DONE quand tout est produit |

Tests d'état ajoutés au harnais (no-op au début, au milieu et après la fin ; sortie nulle au début et en cours de route ; hash identique à une lecture sans incident ; second `finish` refusé).

**2. Preuve sur plans BRUTS pseudo-aléatoires** (409 exécutions, indépendantes du fichier de vecteurs) : octets arbitraires dans **chaque plan** e-ink (donc des pixels « noir ET rouge » simultanés : 6 graines × 3 densités — uniforme, surtout blanc, surtout coloré), mots RGB565 arbitraires sur le TFT 1,8″ (plus tout à 0x00, tout à 0xFF, alternance 0x55 / 0xAA), `eink29bwr` + `eink27bw` + `tft18` × `overlay` / `fit` / `hidden`, trois découpages de sortie e-ink dont un à **1 octet** et un dont le deuxième appel **traverse la frontière entre le plan noir et le plan rouge** (`n−3`, 7, `n+1`, 1). Chaque exécution compare (a) les octets du pilote à ceux de la **référence à grille**, octet par octet, (b) `frameHash` et `renderHash`, et (c) un **oracle indépendant** (formules du contrat recalculées dans le harnais, sans `podRender.h`) pixel par pixel sur la zone sûre — toute l'image en `hidden` : **priorité du rouge** (un pixel noir+rouge efface le plan rouge et laisse le plan noir à 1 en `overlay` / `fit`, garde ses deux bits en `hidden`), projection du `fit`, blanc hors de l'image ajustée. Des centaines de milliers de pixels sont ainsi contrôlés ; le harnais exige d'avoir rencontré des collisions noir+rouge.

**Contrôle négatif du code** (`tests/renderStream.test.ts`) : trois altérations du noyau — priorité du rouge inversée, `read()` qui n'échoue plus sur sortie nulle, frontière entre les plans décalée d'un octet — sont **refusées** par le harnais compilé sur une copie mutante.

**3. `PodRenderSpec`** provient **uniquement** des profils compilés (`pod_render_spec()`), jamais d'une valeur réseau, d'un JSON ou d'un champ non validé : le noyau suppose une géométrie cohérente (largeur, hauteur, bandes, nombre de plans) et ne la revalide pas ; seuls les **arguments d'appel** (plans, longueurs, mode, métadonnées, tampons) sont contrôlés. Un écran inconnu se refuse **avant**, au choix du profil. L'avertissement figure dans `podRender.h` et `podRenderStream.h`.

**Recompilation** : le header ayant changé, les sondes ESP8266 / R4 ont été recompilées et les mesures ré-archivées — **mêmes tailles d'objets, même RAM / flash, mêmes cadres de pile** (seuls les numéros de ligne des fichiers d'analyse changent). Aucun avertissement des fichiers du dépôt.

Rien d'autre n'a changé : aucun firmware, route, secret, variable ; Redis +0, Neon 0 ; toujours jamais essayé sur une carte.
