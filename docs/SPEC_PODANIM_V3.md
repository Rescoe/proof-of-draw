# Spécification `pod-anim-v3` — validation CALCULÉE des animations — BROUILLON À GELER (Lot 6A)

| | |
|---|---|
| **Statut** | **BROUILLON, spécification seulement.** Aucun code de format, aucune route, aucun firmware, aucune variable n'est modifié par ce document. À relire et **geler par GPT** puis par le porteur avant le 6B. |
| **Date** | 07/10/2026 — base `a677311` + FIX2 |
| **Réalisateur** | Claude · **orchestrateur/auditeur** : GPT |
| **S'appuie sur** | `docs/SPEC_PROTOCOLE_V3.md` (vote v3, règles, Merkle, bloc v2 : **réutilisés tels quels**), `lib/bench/clip.ts` (format PBC1, inchangé), `lib/anim/block.ts` (empreintes et scores v1 actuels), `lib/podMetrics.ts` (`pod-metrics-2`, inchangé) |
| **Numérotation** | **Lot 6 = animations** (canonique : `PLAN_DE_TRAVAIL_CONSENSUS_FINAL_2026_10_06.md`) ; e-ink/cartels = lot 7 ; grand reflash = lot 8 ; concordance avec le plan GPT en fin de `PLAN_COLLABORATION_GPT_CLAUDE_POD.md` |
| **Non-objectifs** | pas de nouveau format de clip ; pas de validation esthétique ; pas de comité d'animation tant que le grinding n'est pas traité (balise) ; pas de reflash avant le lot 8 |

**Niveaux** : **[C]** déjà vérifié par test dans le dépôt · **[E]** estimation à mesurer · **[?]** décision à prendre (§ 11).

## 1. Constat de départ (état réel, 07/10/2026) [C]

| Aujourd'hui | Conséquence |
|---|---|
| Une animation est votée en **v1 : écho du score du serveur** (`deviceId:candidateId:score`) | un vote ne prouve **rien** sur le contenu : aucun appareil ne regarde les images |
| Le score d'animation est une **moyenne de flottants** (`computeComplexity`, métriques **v1**, 4 décimales) et la racine (`root`) un `JSON.stringify` de flottants et de listes | non reproductible en C++/ESP8266 (flottants, ordre des clés) ; **pas** `pod-metrics-2` |
| Le clip PBC1 (≤ **9 216 o**, 2 à 64 images 128×64, 1 bit) est servi par `/api/block-clip` après le bloc | un appareil ne peut pas relire le clip **avant** le vote : il n'existe pas de route de contenu **du candidat** pour une animation |
| `imageHash` d'un bloc animation = `root` v1 | engage les empreintes d'images, **pas** les métriques e/t/r |

But du 6A : définir **ce qu'un appareil recalcule**, **ce que le bloc engage**, **ce qu'un tiers vérifie**, et **comment cela cohabite** avec les anciens firmwares.

## 2. Objet voté et domaine

Le vote porte sur le **clip PBC1** (octets exacts), jamais sur l'affiche par écran. Un clip = 1 contenu, quel que soit l'écran de diffusion (oled096, tft18, tft28 : même clip, rendu différent côté appareil).

| Élément | Valeur |
|---|---|
| Format de clip | `PBC1` version 1 (128×64, 1 bit, 2..64 images, ≤ 9 216 o, CRC32) — **inchangé** |
| Métriques | `pod-metrics-2` (**inchangées**) appliquées **à chaque image** |
| Règles | **`rulesVersion = 2`** = jeu « animation A1 » (§ 6) ; `rulesVersion = 1` reste le jeu « image fixe N2 » |
| Vote | **`pod-vote-v3`** (14 champs, § 3 de la spec v3) **sans changement de format** ; la classe de contenu se déduit de `rulesVersion` **[?] A2** |
| Racine d'animation | **`animRoot`** (§ 4) = `contentHash` du bloc (déjà prévu : spec v3 § 7) |
| Préfixes de domaine ajoutés | `pod-anim-v3\|` (racine), feuille d'image `0x02` (§ 4) |

## 3. Ce qu'un appareil recalcule (flux, sans tampon de clip)

Un appareil lit le clip **une seule fois, en flux** (`readFull()`), et calcule en même temps :

1. **`clipHash`** = SHA-256 des **octets du clip** (en-tête, corps et CRC compris) ; la **CRC32** du pied est contrôlée en flux ;
2. **`saltedHash`** = SHA-256(`nonce` ‖ octets du clip) — **même définition que pour une image fixe** (spec v3 § 5), le nonce contient `deviceId` : preuve de lecture complète ;
3. les **images décodées** une à une : image 0 entière, puis chaque transition applique ses **runs** (`décalage, longueur, octets`) sur **une seule copie de l'image courante (1 024 o)** ; à la fin de chaque image :
   - `frameHash_i` = SHA-256 des 1 024 octets de l'image courante (ordre PBC1 : lignes de 16 octets, MSB = pixel de gauche) ;
   - `e_i, t_i, r_i` = `pod-metrics-2` sur la **grille logique 128×64** (ligne par ligne, gauche → droite ; pixel allumé = bit à 1) ;
   - `leaf_i` (§ 4), empilée dans l'accumulateur de Merkle (≤ 7 hachages de 32 o en attente pour 64 images) ;
4. la **transition de retour** (image N−1 → image 0, imposée par le format) est **appliquée et vérifiée** : elle doit redonner **exactement** l'image 0 (déjà exigé par `decodeClip`) ;
5. les agrégats entiers `E, T, R, S` (§ 5), `framesRoot` et `animRoot`.

**Mémoire appareil [E]** : 1 024 o (image courante) + ~300 o (accumulateur de métriques, une ligne) + ≤ 7×32 o (Merkle) + 2 contextes SHA-256 (clip et salé) ≈ **1,8 Ko**, tampon alloué **après** la fermeture du TLS ou lu en flux (règles 1, 2 et 8 de `CLAUDE.md`). Le clip entier (≤ 9 Ko) n'a **pas** besoin d'être en mémoire.
**Temps [E]** : jusqu'à 64 images × (SHA-256 de 1 Ko + 8 192 pixels de métriques) — **à mesurer** sur ESP8266 et R4 (aucune mesure à ce jour).
**Équivalence de mise en page [E → 6B]** : `pod-metrics-2` d'un écran `oled096` lit un tampon **en pages** ; le clip est en **lignes**. Les métriques portent sur la **grille logique** : un test 6B (T3) comparera `metricsFromRaw("oled096", pages(image))` avec les métriques de l'image PBC1.

## 4. Engagements (ce que le hash du bloc couvre)

Tous les entiers sont **big-endian de largeur fixe** pour que le C++ (flux, sans `String`) reproduise l'octet près ; les chaînes textuelles sont de l'UTF-8 ASCII.

```
frameLeaf_i = SHA-256( 0x02 ‖ frameHash_i (32 o) ‖ u32 e_i ‖ u32 t_i ‖ u32 r_i ‖ u8 délai_i )        46 octets hachés
framesRoot  = Merkle des frameLeaf_0..N-1   (les frameLeaf SONT les feuilles, sans second hachage 0x00 ; nœud = SHA-256(0x01 ‖ gauche ‖ droite), nœud impair PROMU, comme spec v3 § 6 ; N ≥ 2 : jamais vide)
animRoot    = SHA-256( "pod-anim-v3|pbc1|" clipHash "|" framesRoot "|" N "|" loops "|" fg "|" bg )         texte ASCII, entiers en décimal canonique
```
- **`délai_i`** = unité de 10 ms **telle que stockée par PBC1** (u8, 2..255) : le délai est **engagé image par image** (le rythme fait partie de l'œuvre) ; `loops` vaut **0 imposé** (boucle sans fin) ; `fg ≠ bg` imposé (§ 6).
- Modifier **un octet du clip, un délai, une couleur, l'ordre ou le contenu d'une image, N ou `loops`** change `clipHash` et/ou `animRoot` : testé en 6B (T4).
- Le **bloc v2** d'une animation v3 porte `contentHash = animRoot` (la graine du comité et du mineur le référencent déjà), `rulesVersion = 2`, `scorePpm = S`. `imageHash` conserve la valeur actuelle (racine v1) **[?] A3** : le vérificateur recalcule les deux.
- Les **reçus** (spec v3 § 6) et `votesRoot`, `committeeRoot`, `minerRoot` ne changent pas.

## 5. Agrégats entiers (reproductibles)

Pour N images : `E = ⌊Σ e_i / N⌋`, `T = ⌊Σ t_i / N⌋`, `R = ⌊Σ r_i / N⌋` ; `s_i = min(10⁶, ⌊(4e_i + 4t_i + 2r_i)/10⌋)` ; `S = ⌊Σ s_i / N⌋`. Les sommes tiennent en `u32` (≤ 64 × 10⁶). Le vote signe **E, T, R** dans les champs `e, t, r` ; `scorePpm = S` est **recalculable** par n'importe qui depuis `framesRoot`+images.
**Affiche** : `posterIndex` = premier indice maximisant `s_i` (déterministe, vérifiable) ; le **rendu** de l'affiche par écran n'est **pas** engagé (même statut que le rendu e-ink : lot 7, `renderHash`).
**Changement assumé** : le score d'une animation passe de la moyenne de flottants v1 à des **ppm entiers `pod-metrics-2`** : les nouveaux blocs ne sont pas comparables aux anciens ; les anciens blocs d'animation restent affichés et marqués « v1 : non recalculée ».

## 6. Règles d'animation A1 (`rulesVersion = 2`) — ordre FIGÉ

| # | `ruleCode` | Condition (objectivement vérifiable) |
|---|---|---|
| 1 | `format` | clip non conforme PBC1 v1 : CRC, structure, 2 ≤ N ≤ 64, taille ≤ 9 216 o, **`loops = 0`**, **`fg ≠ bg`**, délais 2..255, durée d'un tour ≤ 120 s, **retour à l'image 0** exact |
| 2 | `hash` | `clipHash` ou `animRoot` recalculés ≠ annoncés |
| 3 | `static` *(nouveau)* | toutes les images identiques (aujourd'hui `animRefusal`) |
| 4 | `uniform` | **toutes** les images ont `e_i = 0` **et** `t_i = 0` (vide ou plein) |
| 5 | `noise` | **toutes** les images ont `e_i > 980 000` **et** `t_i > 900 000` **[?] A1** (alternative : agrégats `E`, `T`) |
| 6 | `ok` | sinon |

`accept ⇔ ok`. Le serveur **réapplique la même fonction** et **valide les refus** comme pour une image fixe (un refus n'est compté que si son motif objectif est vrai : `static`, `uniform`, `noise` ; sinon `dispute`). `ruleCode` ajouté à l'ensemble de la spec v3 § 3 : **`static`** (seule nouveauté ; `format`, `hash`, `uniform`, `noise`, `ok` existent déjà). `rules` reste le code des règles inconnues.

## 7. Distribution du clip du candidat (route à créer en 6B)

`GET /api/candidate-clip?candidateId=…` : corps = **octets exacts du clip** (≤ 9 216 o), en-têtes `X-Clip-Hash`, `X-Anim-Root`, `X-Metrics-Version` ; mêmes règles que `/api/candidate-frame` (réponse 200 **immuable** par `candidateId`, erreurs `no-store`).
**Coût Redis HONNÊTE** : **1 lecture du candidat par candidat ET par région CDN avant mise en cache** (pas « zéro ») ; avec K ≤ 7 votants de classe C0/C1 répartis sur 1 à 3 régions [E] : **1 à 3 lectures** par candidat. Aucune lecture par image, par boucle ni par vote. **Aucun polling.** Le `validate-candidate` existant (1 MGET) annonce le candidat ; le « pointeur » ajoute **≈ 120 o** (`clipHash`, `animRoot`, N, taille) au candidat, pas une commande.
**Stockage** : le candidat porte déjà le clip (≤ 12 Ko en base64) ; aucune écriture de plus. Après le bloc : `chain:anim:{hash}` (existant) + reçus (`chain:receipts:{hash}` existant).

## 8. Compatibilité et cohabitation (point demandé par GPT)

| Situation | Règle |
|---|---|
| **Anciens firmwares** (vote v1 écho, `multiscreen-2.x`, `tft18-2.x`, `r4tft28-2.x`) | continuent d'**afficher** les animations ; **ne votent pas** une animation v3 : le serveur **n'invite pas** un appareil qui ne déclare pas la capacité (champ `caps` de `/api/register`, lot 8) ; ils **s'abstiennent**. |
| **Aucun vote v1 ne valide un bloc animation v3** | un bloc animation v3 exige **uniquement des reçus v3 de rulesVersion 2** ; le **vérificateur** compte les reçus v1/v2 en `warn` et les **exclut** du quorum/comité (test 6B T6 : un bloc dont le quorum n'est atteint qu'avec des échos est **refusé**). |
| **Avant tout firmware C0/C1 capable** | les animations restent sur le chemin **actuel** (candidat v1, quorum historique, étiquette « non recalculée ») ; le mode `ANIM_V3_MODE` (6B) est **éteint par défaut** : `off` → comportement actuel strict ; `shadow` → le serveur calcule la référence v3 (`framesRoot`, `animRoot`, e/t/r) et la **journalise sans effet** ; `enforce` → n'accepte que des votes v3. |
| **Blocs animation existants** | inchangés (`blockVersion` absent) ; affichés « v1 : non recalculée » ; jamais réécrits. |
| **Classes de calcul** | C0 (ESP8266) : flux complet, §3 ; C1 (R4) : idem + marge mémoire ; C2 (hôte) : idem + rejeu du clip complet. Un comité peut exiger ≥ 1 attestation C1/C2 **[?] A5**. |
| **Grinding** | la graine d'un comité d'animation = `parentHash` + `animRoot` : **calculable par l'auteur avant la soumission** comme pour une image ; **aucun comité d'animation** tant que la balise postérieure n'existe pas ; la décision d'une animation v3 reste le **quorum** (profils éligibles figés). |

## 9. Vérificateur public (6B)

Nouveaux contrôles de `lib/podVerify.ts` pour un bloc animation v3 : `anim-clip` (CRC, structure, `clipHash`), `anim-frames` (images décodées → `frameHash_i`, `e_i,t_i,r_i`, `framesRoot`), `anim-root` (= `animRoot` = `contentHash` du bloc), `anim-metrics` (E,T,R recalculés = signés par chaque reçu approuvé ; S = `scorePpm`), `anim-poster` (indice), `anim-receipts-class` (aucun reçu v1 compté). Niveau `content` atteint si le clip fourni redonne tout. **Ne prouve toujours pas** : identité d'un appareil, geste humain, complétude des éligibles.

## 10. Plan 6A → 6C et critères

| Étape | Contenu | Acceptation | Reflash |
|---|---|---|---|
| **6A** *(ce document)* | spécification | relue et **gelée** par GPT | non |
| **6B** | référence TypeScript (`lib/animV3.ts`), noyau C++ hôte (`pod_anim_*` dans `consensus-pod/src`), vecteurs, route `candidate-clip`, mode `ANIM_V3_MODE` (off/shadow/enforce), vérificateur, tests ; **aucun firmware de production** | ≥ **200 clips** différentiels TS ↔ C++ (cas limites : 2 images, 64 images, identiques, plein, vide, bruit, runs de 255, délais extrêmes, fg=bg, loops≠0, CRC faux, retour ≠ image 0) ; **T4** : modifier 1 octet / un délai / un ordre d'images / fg / bg / N → rejet ou racine différente, sur TS **et** C++ ; **T6** : échos v1 non comptés ; coût Redis écrit et testé ; `ANIM_V3_MODE=off` = **0 différence** | non |
| **6C** | préparation firmware : démonstrateur C++ **hôte** du décodage image par image (tampon 1 Ko) et des mesures de mémoire/temps simulées ; auto-test compilable ESP8266/R4 (comme le lot 5) ; **aucun `.ino` de production** | auto-test compile ; RAM statique mesurée ; budgets § 3 documentés | non (essai porteur facultatif) |
| **Adoption** | firmwares C0/C1 : lot 8 (grand reflash) | traces par variante | oui |

## 11. Décisions à trancher (GPT / porteur)

| # | Question | Proposition de Claude |
|---|---|---|
| **A1** | `uniform`/`noise` : sur **toutes** les images, sur au moins une, ou sur les agrégats ? | **toutes** (le plus conservateur et le plus objectif : une seule bonne image sauve l'animation) ; `noise` à rediscuter après mesure |
| **A2** | Distinguer image/animation par `rulesVersion` (2) ou par un nouveau préfixe `pod-vote-v3a` ? | **`rulesVersion`** : format de vote et noyau C++ inchangés ; risque : confusion si un jour `rulesVersion` évolue pour les images (le préciser par table de versions) |
| **A3** | `imageHash` d'un bloc animation v3 : garder la racine v1 ou la remplacer par `animRoot` ? | **garder la racine v1** (compatibilité des vues et de `block-anim`) ; `contentHash = animRoot` fait foi pour le protocole |
| **A4** | `fg = bg` interdit, `loops = 0` imposé : acceptable ? | oui (une animation invisible n'a pas de sens ; le serveur impose déjà `loops = 0`) |
| **A5** | Exiger ≥ 1 attestation C1/C2 par bloc d'animation ? | **non** au démarrage (le parc n'a que des C0/C1) ; à réévaluer avec les nœuds hôtes |
| **A6** | Score d'animation en ppm `pod-metrics-2` (rupture avec le score v1 affiché) | oui, avec étiquette claire « v1 / v3 » dans la galerie |
| **A7** | Délai engagé **par image** (dans la feuille) ou seulement dans `animRoot` ? | **par image** (la feuille reste de taille fixe — 46 o —, un seul hachage par image) |

## 12. Ce que cette spécification NE fait PAS

Elle ne spécifie pas le **rendu par écran** (affiche, ×1,875, centrage : lot 7 / `renderHash`), la **validation du geste** (animation faite à la main : audit N3), ni la **balise** contre le grinding ; elle ne change **aucun** firmware, route ni variable. Elle ne prétend pas que l'animation est « jugée » : elle fait **recalculer** par des appareils des mesures **entières** sur des **octets précis**, et rend ce calcul **vérifiable**.
