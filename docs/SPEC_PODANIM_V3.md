# Spécification `pod-anim-v3` — validation CALCULÉE des animations — BROUILLON À GELER (Lot 6A)

| | |
|---|---|
| **Statut** | **BROUILLON R1 (amendé après l'audit GPT de `139b0c5`), spécification seulement.** Aucun code de format, aucune route, aucun firmware, aucune variable n'est modifié par ce document. À **geler par GPT** puis par le porteur avant tout code 6B. |
| **Révision R2** | 3 corrections de l'audit GPT de `bb2a61f` : **ticket HMAC** `candidate-clip-v1\|candidateId\|exp` vérifié avant Redis (le rate-limit de `validate-candidate` ne protège pas un appel direct ; l'affirmation correspondante est **supprimée**) ; **un seul appareil représentant par profil**, figé au dépôt (≤ 64 téléchargements) ; `frames = 0` **seulement** pour `reject/format` d'un clip illisible ; ancien bloc sans `rulesVersion` ⇒ 1 sans toucher son hash. §§ 3 bis, 4 bis, 7, 7 bis, 11. |
| **Révision R1** | 7 corrections de l'audit GPT : (1) message de vote **propre** `pod-vote-v3-anim` ; (2) `rulesVersion` **variable par bloc** (changement du canonique TS/C++ listé § 4 bis) ; (3) **`S` signé** ; (4) budget Redis **recalculé sans comité** (jusqu'à 64 demandeurs) + comptage des défauts de cache ; (5) règles : **`uniform` retiré**, `noise` sur **agrégats** ; (6) `enforce` **techniquement impossible** en 6B (modes `off`/`shadow` seulement) ; (7) vecteurs de Merkle pour **tous** les N de 2 à 64 et **validation des identifiants avant tout accès Redis**. Décisions A1–A7 : propositions de GPT reprises (§ 11). |
| **Date** | 07/10/2026 — base `42945c3` (FIX2 accepté) |
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
| Règles | **`rulesVersion = 2`** = jeu « animation A1 » (§ 6) ; `rulesVersion = 1` reste le jeu « image fixe N2 ». **Le bloc porte sa propre `rulesVersion`** (§ 4 bis) |
| Vote | **message PROPRE `pod-vote-v3-anim`** (§ 3 bis) : le type de contenu est **explicite et signé** (clip, racine, hash salé, E/T/R/S) ; il n'est **plus déduit** de `rulesVersion` (**A2 gelé**) |
| Racine d'animation | **`animRoot`** (§ 4) = `contentHash` du bloc (déjà prévu : spec v3 § 7) |
| Préfixes de domaine ajoutés | `pod-vote-v3-anim\|` (message de vote), `pod-anim-v3\|pbc1\|` (racine), feuille d'image `0x02` (§ 4) |

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

## 3 bis. Message de vote d'animation `pod-vote-v3-anim` (R1 · points 1 et 3)

```
pod-vote-v3-anim|deviceId|candidateId|parentHash|metricsVersion|rulesVersion|clipHash|animRoot|saltedHash|frames|E|T|R|S|verdict|ruleCode|vclass
```
- **17 éléments** séparés par `|` (préfixe + 16 champs). `metricsVersion = 2`, `rulesVersion = 2` (jeu A1 : un message d'animation dont `rulesVersion ≠ 2` est **invalide**) ; `frames` = N (2..64) ; `E, T, R, S` entiers 0…1 000 000 ; hashes en hexadécimal minuscule de 64 caractères ; `verdict`, `ruleCode`, `vclass` comme spec v3 § 3, avec `ruleCode` ∈ {`ok`, `format`, `hash`, `static`, `noise`, `rules`} (**pas** `uniform`, § 6).
- **Domaine séparé** : le **premier élément** (`pod-vote-v3-anim`) diffère de `pod-vote-v3` ; chaque parseur n'accepte **que** son préfixe exact et la forme **canonique** (le message reconstruit doit être identique). Un message d'image ne peut donc pas être rejoué comme message d'animation, ni l'inverse (test 6B-T8 : parse croisé = refus, 0 faux positif sur les vecteurs).
- **`S` est signé** (audit GPT) : `S = ⌊Σ s_i / N⌋` n'est **pas** reconstructible depuis `E, T, R` seuls (la moyenne des `s_i` plafonnés n'est pas une fonction des moyennes). Le serveur compare **les quatre** (`E, T, R, S`) à sa référence, comme pour une image fixe ; un écart rend un `accept` **invalide**.
- **Représentation UNIQUE de chaque rejet (6B1-FIX1, audit GPT)** — un même rejet n'a qu'UN message valide :

  | `ruleCode` | `frames` | `E, T, R, S` |
  |---|---|---|
  | `format` | **toujours 0** (le nombre d'images n'est jamais déclaré, même s'il était lisible dans l'en-tête) | **toujours 0** |
  | `hash` | **2..64** (le clip est lisible : il a un format valide) | **0** |
  | `static`, `noise`, `ok`, `rules` | **2..64** | recalculés (0…10⁶) |

  Tout autre message — `frames = 0` hors `format`, `format` avec `frames ≠ 0` ou métriques non nulles, `hash` avec `frames = 0` ou métriques non nulles, `frames` ∉ [2, 64] pour les autres — est **invalide** (refusé par le parseur TypeScript ET par le constructeur C++, qui retourne −1). Cela correspond au comportement naturel des références (`analyzeClip` renvoie `N = 0` pour tout échec de format).
- **Refus sans calcul complet** (`format`, `hash`) : `E = T = R = S = 0` ; `clipHash` = hash des octets **effectivement lus** ; `animRoot` = la racine **annoncée** par le candidat (le vote reste lié au candidat) ; `saltedHash` = hash salé des octets lus. Le détail binaire est figé en 6B-1 (vecteurs).
- **Hash salé** : `saltedHash = SHA-256(nonce ‖ octets du clip)`, `nonce = SHA-256("pod-nonce-v3|" candidateId "|" parentHash "|" deviceId)` (spec v3 § 5, **inchangé**).
- La signature Ed25519 porte sur l'UTF-8 du message, **obligatoire**, comme en v3.
- **Reçus** : `message|signature|clé` (feuille de Merkle des votes, spec v3 § 6, **inchangée**) ; le vérificateur reconnaît le type par le **préfixe** du message.

## 4. Engagements (ce que le hash du bloc couvre)

Tous les entiers sont **big-endian de largeur fixe** pour que le C++ (flux, sans `String`) reproduise l'octet près ; les chaînes textuelles sont de l'UTF-8 ASCII.

```
frameLeaf_i = SHA-256( 0x02 ‖ frameHash_i (32 o) ‖ u32 e_i ‖ u32 t_i ‖ u32 r_i ‖ u8 délai_i )        46 octets hachés
framesRoot  = Merkle des frameLeaf_0..N-1   (les frameLeaf SONT les feuilles, sans second hachage 0x00 ; nœud = SHA-256(0x01 ‖ gauche ‖ droite), nœud impair PROMU, comme spec v3 § 6 ; N ≥ 2 : jamais vide)
animRoot    = SHA-256( "pod-anim-v3|pbc1|" clipHash "|" framesRoot "|" N "|" loops "|" fg "|" bg )         texte ASCII, entiers en décimal canonique
```
- **`délai_i`** = unité de 10 ms **telle que stockée par PBC1** (u8, 2..255) : le délai est **engagé image par image** (le rythme fait partie de l'œuvre) ; `loops` vaut **0 imposé** (boucle sans fin) ; `fg ≠ bg` imposé (§ 6).
- Modifier **un octet du clip, un délai, une couleur, l'ordre ou le contenu d'une image, N ou `loops`** change `clipHash` et/ou `animRoot` : testé en 6B (T4).
- Le **bloc v2** d'une animation v3 porte `contentHash = animRoot` (la graine du comité et du mineur le référencent déjà), `rulesVersion = 2`, `scorePpm = S`. `imageHash` conserve la valeur actuelle (racine v1) **uniquement par compatibilité** (A3 gelé : `contentHash = animRoot` fait foi) : le vérificateur recalcule les deux.
- Les **reçus** (spec v3 § 6) et `votesRoot`, `committeeRoot`, `minerRoot` ne changent pas.
- **Validateurs (6B2-FIX1)** : un reçu d'une autre classe (écho v1, vote v2, vote v3-image) reste dans `votesRoot` (audit) mais n'est **jamais** un validateur d'animation : `validatorProfileIds` (hash) et `validatorIds` (bloc) ne contiennent que les approbations d'animation (`animValidatorKeys` / `animValidatorDevices`, lib/podVerifyAnim.ts ; le producteur futur DOIT les utiliser). Un bloc qui présente un écho comme validateur est refusé (hash et contrôle `validators`).
- **`animRoot` du hash canonique = `contentHash`** (racine v3) pour `rulesVersion = 2` ; `toProofBlock` le reconstruit ainsi (`anim.root` v1 reste dans `imageHash`). **Vérification (6B2-FIX1)** : avec le clip fourni, le vérificateur recalcule l'ancienne racine v1 et exige `imageHash` égal (contrôle `anim-image-hash`) ; sans clip, ce contrôle n'est pas annoncé.

### 4 bis. `rulesVersion` VARIABLE par bloc (R1 · point 2 — changement du canonique)

Aujourd'hui `rulesVersion` est une **constante globale** (`PROTOCOL.rulesVersion = 1` dans `lib/podProtocolV3.ts` ; `POD_RULES_VERSION` dans `consensus-pod/src/consensusPoD.h`) écrite dans le texte canonique du bloc : la valeur 2 n'est donc **pas réalisable** en l'état. Changement requis en **6B-1** :
- `BlockCanonicalV2` (TypeScript) et `PodBlockV2` (C++) reçoivent un champ **`rulesVersion`** ∈ {1, 2} lu **depuis le bloc** (même position dans l'ordre figé des clés) ; `1` pour une image fixe, `2` pour une animation v3 ;
- `blockCanonicalV2` et `pod_block_canonical_v2` l'écrivent tel quel ; les constantes globales deviennent des **valeurs par défaut** ;
- **les vecteurs des images fixes ne changent pas** (valeur 1 : texte canonique identique : test de non-régression) ; de nouveaux vecteurs couvrent `rulesVersion = 2` ;
- le vérificateur **impose la cohérence** : `rulesVersion = 2` ⇔ `contentHash` est une racine d'animation ⇔ les reçus approuvés sont des `pod-vote-v3-anim` ; toute autre combinaison **échoue** ;
- **ancien bloc sans champ `rulesVersion`** (blocs v1 historiques ; tout bloc v2 de test antérieur) : interprété comme **`rulesVersion = 1`** à la lecture (`block.rulesVersion ?? 1`) ; **son hash historique n'est PAS modifié** (le hash v1 ne contient pas ce champ ; le canonique v2 l'écrivait déjà avec la valeur 1) — test de non-régression : mêmes hashes qu'avant pour tous les vecteurs d'images et les blocs v1 ;
- aucun bloc v2 n'a jamais été miné en production (`BLOCK_RECEIPTS` éteint) : pas de migration ; **le format de bloc v2 est donc encore modifiable** (à geler après 6B-1).

## 5. Agrégats entiers (reproductibles)

Pour N images : `E = ⌊Σ e_i / N⌋`, `T = ⌊Σ t_i / N⌋`, `R = ⌊Σ r_i / N⌋` ; `s_i = min(10⁶, ⌊(4e_i + 4t_i + 2r_i)/10⌋)` ; `S = ⌊Σ s_i / N⌋`. Les sommes tiennent en `u32` (≤ 64 × 10⁶). Le vote signe **E, T, R et S** (§ 3 bis : `S` n'est pas déductible de `E, T, R`) ; `scorePpm = S` du bloc est **recalculable** par n'importe qui depuis les images (vérifiées par `framesRoot`).
**Affiche** : `posterIndex` = premier indice maximisant `s_i` (déterministe, vérifiable) ; le **rendu** de l'affiche par écran n'est **pas** engagé (même statut que le rendu e-ink : lot 7, `renderHash`).
**Changement assumé** : le score d'une animation passe de la moyenne de flottants v1 à des **ppm entiers `pod-metrics-2`** : les nouveaux blocs ne sont pas comparables aux anciens ; les anciens blocs d'animation restent affichés et marqués « v1 : non recalculée ».

## 6. Règles d'animation A1 (`rulesVersion = 2`) — ordre FIGÉ

| # | `ruleCode` | Condition (objectivement vérifiable) |
|---|---|---|
| 1 | `format` | clip non conforme PBC1 v1 : CRC, structure, 2 ≤ N ≤ 64, taille ≤ 9 216 o, **`loops = 0`**, **`fg ≠ bg`**, délais 2..255, durée d'un tour ≤ 120 s, **retour à l'image 0** exact |
| 2 | `hash` | `clipHash` ou `animRoot` recalculés ≠ annoncés |
| 3 | `static` *(nouveau)* | **toutes les images sont identiques** (aucun changement dans le temps ; couvre aussi « toutes vides » ou « toutes pleines » fixes) |
| 4 | `noise` | **agrégats** : `E > 980 000` **et** `T > 900 000` (bornes strictes, mêmes seuils que N2) — **A1 gelé** |
| 5 | `ok` | sinon |

**Pas de règle `uniform` pour les animations** (R1 · point 5) : une alternance **noir ↔ blanc** (images uniformes qui **diffèrent**) est une animation temporelle légitime (clignotement, flash) et **est acceptée** ; seules les animations **statiques** (aucune différence entre images) sont rejetées. Un refus signé `uniform` sur une animation est donc **toujours invalide** (équivalent à un silence, `falseReject` en réputation).
`accept ⇔ ok`. Le serveur **réapplique la même fonction** et **valide les refus** comme pour une image fixe (un refus n'est compté que si son motif objectif est vrai pour le clip connu : `static`, `noise` ; sinon `dispute`). Nouveau `ruleCode` : **`static`** (`format`, `hash`, `noise`, `ok`, `rules` existent déjà ; `uniform` reste réservé aux images fixes). Table de versions : `rulesVersion 1` = N2 (images), `rulesVersion 2` = A1 (animations) ; toute évolution incrémente **sa** version.

## 7. Distribution du clip du candidat (route à créer en 6B)

`GET /api/candidate-clip?candidateId=…&exp=…&t=…` : corps = **octets exacts du clip** (≤ 9 216 o), en-têtes `X-Clip-Hash`, `X-Anim-Root`, `X-Metrics-Version` ; mêmes règles que `/api/candidate-frame` (réponse 200 **immuable** par URL, erreurs `no-store`).

**Ticket HMAC (R2 · point 1)** : la route peut être appelée **directement**, sans passer par `validate-candidate` : son coût ne peut donc **pas** s'appuyer sur le rate-limit de ce dernier. Le ticket est :
```
ticket = HMAC-SHA256( secret serveur, "candidate-clip-v1|" candidateId "|" exp )        exp = expiration du candidat (secondes Unix, ≤ 30 min)
```
- **commun à tous les validateurs d'un candidat** (même URL ⇒ une seule entrée de cache CDN par région) ; calculé **sans Redis** (le serveur connaît déjà `candidateId` et `expiresAt` quand il annonce le candidat) et remis **uniquement** par `validate-candidate`/`pull` aux appareils **représentants** (§ 7 bis) ;
- vérifié **avant toute lecture Redis**, en temps constant : `candidateId` conforme (UUID), `exp` entier non expiré, `t` hexadécimal de 64 caractères et égal au HMAC recalculé ; sinon **403/410 `no-store` sans aucune lecture** (donc un appel direct sans ticket valide **ne coûte aucune commande Redis**) ;
- secret : variable serveur dédiée **`CLIP_TICKET_SECRET`** (≥ 32 octets aléatoires, **jamais** dans le dépôt, la sortie ou les journaux) ; **absente ⇒ route inactive et aucun ticket émis** (`shadow` ne sert aucun clip) ; sa création et sa rotation sont une **décision du porteur** (aucune variable n'est posée par 6B-1) ;
- limite assumée : un ticket **divulgué** permet de demander le clip jusqu'à `exp` ; le contenu n'a rien de secret (publié dans la galerie après le bloc) et, **200 immuable**, le CDN absorbe les répétitions : seul un défaut de cache lit Redis (1 lecture). Le ticket n'authentifie **pas** un appareil et n'est **pas** une preuve d'identité.

**Coût Redis HONNÊTE (R1 · point 4, précisé R2)** : chaque **exécution de la route avec ticket valide** (défaut de cache CDN) lit le candidat : **1 lecture** (`getCurrentCandidate`). Les requêtes sans ticket valide : **0 lecture**. Le CDN regroupe les demandes **par région** :

| Hypothèse | Lectures de candidat par animation |
|---|---|
| Typique [E] (2 à 10 représentants, 1 à 3 régions) | **1 à 3** |
| **Borne haute** (électorat figé ≤ 64 profils, **un seul appareil représentant par profil** § 7 bis, aucune mise en cache utile) | **≤ 64 appels de téléchargement** par candidat (un par représentant), plus les **rejeux d'un ticket valide** qui ne sont pas absorbés par le CDN (non bornés par la route elle-même : **journal MISS** + alerte, § ci-dessous ; mesuré en `shadow` avant toute décision) |
| Ticket valide, candidat non courant ou expiré (404/410, `no-store`) | **+1 lecture par requête** possédant un ticket valide ; le rate-limit de `validate-candidate` **ne s'applique pas** à un appel direct : seul le ticket (non émis pour un candidat expiré, expiration courte) limite le périmètre |

### 7 bis. Un seul appareil représentant par profil (R2 · point 2)

Pour une animation v3, le dépôt du candidat **fige**, pour chaque profil de l'électorat, **un appareil représentant** : parmi les appareils **éligibles et actifs** du profil, le **plus petit `deviceId`** (ordre lexicographique, règle déterministe rejouable). La liste `{profileId → deviceId}` (≤ 64 entrées, ≈ 0,8 Ko) est stockée **dans le candidat** (champ additif, animations v3 seulement, aucune commande de plus). **Seul le représentant** reçoit le ticket et peut voter ; un autre appareil du même profil est refusé (`not-representative`, 409) **avant** tout téléchargement. Conséquences : **au plus 64 téléchargements autorisés par candidat** (un par profil), même quand un artiste possède plusieurs cartes ; si le représentant est hors ligne, **le profil s'abstient** (aucun remplaçant : c'est le prix de la borne). Pas de lien avec le comité (aucun comité d'animation, § 8).

**Électorat non figeable (`overflow`, > 64 profils)** : une animation v3 n'est **pas** proposée (retour au chemin v1 actuel, § 8) ; la borne ci-dessus reste donc définie. Le journal `votersExpected` indique **appareils actifs** et **profils** de l'électorat figé. Aucune lecture par image, par boucle ni par vote. **Aucun polling.** Le `validate-candidate` existant (1 MGET) annonce le candidat ; le « pointeur » ajoute **≈ 120 o** (`clipHash`, `animRoot`, N, taille) au candidat, pas une commande.
**Instrumentation des défauts de cache (sans commande Redis)** : chaque exécution de la route journalise **une ligne** `[candidate-clip] MISS candidate=<8 premiers caractères> votersExpected=<taille de l'électorat figé>` ; le **nombre de lignes MISS par candidat** (journaux Vercel) est comparé à la borne ci-dessus lors de l'essai en `shadow` ; **aucun compteur Redis** (ce serait une commande de plus). Seuil d'alerte proposé : **> 8 MISS** pour un candidat à ≤ 10 votants ⇒ revoir le cache.
**Validation avant tout accès Redis (R1 · point 7, complété R2)** : `candidateId` (regex UUID), `exp`, ticket `t` (HMAC) et les autres identifiants qui interviendraient (`deviceId` `dev_[A-Z0-9]{8}`, hashes hexadécimaux de 64 caractères) sont validés **avant** d'être utilisés dans une clé Redis. Test 6B-T7 : identifiants invalides (vides, trop longs, avec `:`/`*`/`|`/retours à la ligne, Unicode), **ticket absent, altéré, expiré, d'un autre candidat** ⇒ **0 appel Redis** (compteur de l'accès simulé).
**Stockage** : le candidat porte déjà le clip (≤ 12 Ko en base64) ; aucune écriture de plus. Après le bloc : `chain:anim:{hash}` (existant) + reçus (`chain:receipts:{hash}` existant).

## 8. Compatibilité et cohabitation (point demandé par GPT)

| Situation | Règle |
|---|---|
| **Anciens firmwares** (vote v1 écho, `multiscreen-2.x`, `tft18-2.x`, `r4tft28-2.x`) | continuent d'**afficher** les animations ; **ne votent pas** une animation v3 : le serveur **n'invite pas** un appareil qui ne déclare pas la capacité (champ `caps` de `/api/register`, lot 8) ; ils **s'abstiennent**. |
| **Aucun vote v1 ne valide un bloc animation v3** | un bloc animation v3 exige **uniquement des reçus `pod-vote-v3-anim`** (`rulesVersion = 2`) ; le **vérificateur** compte les reçus v1/v2/v3-image en `warn` et les **exclut** du quorum/comité (test 6B-T6 : un bloc dont le quorum n'est atteint qu'avec des échos est **refusé**). |
| **Avant tout firmware C0/C1 capable** | les animations restent sur le chemin **actuel** (candidat v1, quorum historique, étiquette « non recalculée »). |
| **`ANIM_V3_MODE` : seulement `off` et `shadow` en 6B** (R1 · point 6) | `off` (défaut) → comportement actuel **strict** ; `shadow` → le serveur calcule la référence v3 (`framesRoot`, `animRoot`, E/T/R/S) et la **journalise sans aucun effet** (aucun vote v3 n'est accepté, aucune route d'écriture). **`enforce` n'existe pas dans le code 6B** : la valeur `enforce` **seule** est **ramenée à `shadow`** avec un avertissement ; **toute autre valeur inconnue (faute de frappe comprise) donne `off`** (6B2-FIX1 : l'activation du calcul ne doit pas résulter d'une faute de frappe) ; aucun chemin de code « strict » n'est livré. Il ne sera **écrit qu'au lot 8**, avec la **déclaration réelle des capacités** par les firmwares (`caps` dans `/api/register`) : sans elle, le serveur ne peut pas savoir quels appareils savent voter une animation. Test : `ANIM_V3_MODE=enforce` ⇒ `shadow`, aucun écart de comportement par rapport à `shadow` ; aucune production en mode strict. |
| **Blocs animation existants** | inchangés (`blockVersion` absent) ; affichés « v1 : non recalculée » ; jamais réécrits. |
| **Classes de calcul** | C0 (ESP8266) : flux complet, §3 ; C1 (R4) : idem + marge mémoire ; C2 (hôte) : idem + rejeu du clip complet. Un comité peut exiger ≥ 1 attestation C1/C2 **[?] A5**. |
| **Grinding** | la graine d'un comité d'animation = `parentHash` + `animRoot` : **calculable par l'auteur avant la soumission** comme pour une image ; **aucun comité d'animation** tant que la balise postérieure n'existe pas ; la décision d'une animation v3 reste le **quorum** (profils éligibles figés). |

## 9. Vérificateur public (6B)

Nouveaux contrôles de `lib/podVerify.ts` pour un bloc animation v3 : `anim-clip` (CRC, structure, `clipHash`), `anim-frames` (images décodées → `frameHash_i`, `e_i,t_i,r_i`, `framesRoot`), `anim-root` (= `animRoot` = `contentHash` du bloc), `anim-metrics` (E,T,R **et S** recalculés = signés par chaque reçu approuvé ; S = `scorePpm`), `anim-poster` (indice), `anim-receipts-class` (aucun reçu v1 / image compté), `anim-rules` (`rulesVersion = 2` du bloc ⇔ racine d'animation ⇔ reçus `pod-vote-v3-anim`). Niveau `content` atteint si le clip fourni redonne tout. **Ne prouve toujours pas** : identité d'un appareil, geste humain, complétude des éligibles.

## 10. Plan 6A → 6C et critères

| Étape | Contenu | Acceptation | Reflash |
|---|---|---|---|
| **6A-R1** *(ce document)* | spécification amendée | relue et **gelée** par GPT **avant tout code** | non |
| **6B-1** | **référence pure** TypeScript (`lib/animV3.ts` : décodage, `frameLeaf`, `framesRoot`, `animRoot`, E/T/R/S, règles A1, message `pod-vote-v3-anim`) + **noyau C++ hôte** (`pod_anim_*` dans `consensus-pod/src`) + `rulesVersion` variable (§ 4 bis) + **vecteurs** + tests différentiels ; **aucune route, aucun serveur, aucun firmware** | ≥ **200 clips** différentiels TS ↔ C++ (2 images, 64 images, identiques, noir↔blanc alternés, vide, plein, bruit, runs de 255, délais extrêmes, fg=bg, loops≠0, CRC faux, retour ≠ image 0) ; **T3** layout pages/lignes ; **T4** : modifier 1 octet / un délai / un ordre d'images / fg / bg / N → rejet ou racine différente (TS **et** C++) ; **T8** parse croisé image/animation refusé ; **vecteurs de Merkle pour CHAQUE N de 2 à 64** (impairs compris : N = 3, 5, 7… 63 : promotion du nœud impair, jamais de duplication) en TS **et** C++ ; régression : vecteurs des images fixes **inchangés** | non |
| **6B-2** | route `candidate-clip` (validation des identifiants **avant** Redis, journal MISS), `ANIM_V3_MODE` **`off` / `shadow` seulement**, vérificateur (§ 9), tests de câblage et de budget | **T6** échos non comptés ; **T7** identifiants invalides ⇒ 0 appel Redis ; `enforce` ⇒ `shadow` ; `off` = **0 différence** ; budget § 7 écrit et testé (1 lecture par MISS, borne 64) | non |
| **6C** *(RÉALISÉ le 07/10/2026 : `docs/LOT_6C_COMPILATION_ANIMATION_2026_10_07.md` — compilé sur ESP8266 et UNO R4, jamais essayé sur carte)* | préparation firmware : démonstrateur C++ **hôte** du décodage image par image (tampon 1 Ko) et des mesures de mémoire/temps simulées ; auto-test compilable ESP8266/R4 (comme le lot 5) ; **aucun `.ino` de production** | auto-test compile ; RAM statique mesurée ; budgets § 3 documentés | non (essai porteur facultatif) |
| **Adoption** | firmwares C0/C1 : lot 8 (grand reflash) | traces par variante | oui |

## 11. Décisions à trancher (GPT / porteur)

| # | Question | Proposition de Claude |
|---|---|---|
| **A1** | Règles : `static`, `uniform`, `noise` | **GELÉ (proposition GPT)** : `static` rejette les images **toutes identiques** mais **pas** une alternance uniforme noir/blanc ; **pas de `uniform`** ; `noise` sur les **agrégats** `E > 980 000` et `T > 900 000` |
| **A2** | Distinguer image/animation | **GELÉ** : domaine signé propre **`pod-vote-v3-anim`** (§ 3 bis), plus de déduction par `rulesVersion` ; `rulesVersion` devient variable par bloc (§ 4 bis) |
| **A3** | `imageHash` d'un bloc animation v3 | **GELÉ** : racine v1 conservée **uniquement par compatibilité** ; `contentHash = animRoot` fait foi |
| **A4** | `fg ≠ bg` et `loops = 0` | **GELÉ** |
| **A5** | Attestation C1/C2 obligatoire | **GELÉ** : **aucune** obligation au démarrage |
| **A6** | Score en ppm `pod-metrics-2` | **GELÉ**, avec étiquette « v1 / v3 » dans la galerie |
| **A7** | Délai engagé par image | **GELÉ** (feuille de 46 o) |
| **A8** | Politique d'électorat pour une animation v3 | **GELÉ (R2)** : électorat **figé ≤ 64** exigé ; `overflow` ⇒ chemin v1 actuel (§ 7) |
| **A9** *(R2)* | Ticket HMAC de `candidate-clip` | **GELÉ (proposition GPT)** : `HMAC-SHA256(secret, "candidate-clip-v1|candidateId|exp)`, commun au candidat, vérifié **avant** Redis ; variable **`CLIP_TICKET_SECRET`** à créer par le porteur (non posée par 6B-1) |
| **A10** *(R2)* | Un appareil représentant par profil | **GELÉ (proposition GPT)** : plus petit `deviceId` actif éligible, figé au dépôt, ≤ 64 téléchargements ; profil absent = abstention |

*Statut « GELÉ » : reprend les propositions de l'audit GPT du 07/10/2026 ; le gel **formel** reste à prononcer par GPT sur cette révision, puis par le porteur.*

## 12. Ce que cette spécification NE fait PAS

Elle ne spécifie pas le **rendu par écran** (affiche, ×1,875, centrage : lot 7 / `renderHash`), la **validation du geste** (animation faite à la main : audit N3), ni la **balise** contre le grinding ; elle ne change **aucun** firmware, route ni variable. Elle ne prétend pas que l'animation est « jugée » : elle fait **recalculer** par des appareils des mesures **entières** sur des **octets précis**, et rend ce calcul **vérifiable**.
