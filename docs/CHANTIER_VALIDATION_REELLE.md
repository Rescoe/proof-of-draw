# Chantier « Validation réelle » — rendre le Proof-of-Draw vérifiable par les appareils

| | |
|---|---|
| **Statut** | Dossier de cadrage et d'analyse — **aucun code écrit**. À lire en entier avant d'ouvrir le chantier. |
| **Date** | 05/10/2026 (état du dépôt : `main`, commits jusqu'à `df9ffb9`) |
| **Décision du porteur** | « Notre Proof-of-Draw ne doit pas être que sur le papier : qu'elle soit réelle. » → option **« rendre la validation réelle »** retenue (l'autre option, renommer le produit, est écartée). |
| **Origine** | Analyse du code par Claude, commandée par le porteur. Les décisions de conception ci-dessous sont des **propositions** à valider (voir § 10). |
| **Effort estimé** | 8 à 11 sessions, dont 3 à 4 avec le matériel en main (voir § 8). Estimation, pas un engagement. |

**Légende des niveaux de preuve** (convention du vault : ne jamais laisser une affirmation monter en « fait » sans source)
- **[C]** confirmé par lecture directe du code le 05/10/2026 (fichier et ligne cités) ;
- **[D]** déclaré dans une documentation du dépôt, non revérifié ;
- **[E]** estimation de l'analyste (ordre de grandeur, à mesurer) ;
- **[P]** proposition de conception, non décidée.

---

## 0. Résumé exécutif

**Verdict.** Aujourd'hui la « validation par les ESP » est **cosmétique** [C]. Un ESP reçoit du serveur le score que le serveur a calculé, le **renvoie tel quel** dans les trois métriques et le signe ; il n'a **jamais vu l'image**. Le quorum compte des votes, jamais des désaccords : aucun appareil ne peut refuser un bloc. Le serveur reste donc le seul juge, et l'identité des appareils peut être usurpée avec une requête HTTP. Ce que le produit appelle « consensus » est, en l'état, une **confirmation de présence** de N appareils.

**Ce qui est déjà réel et à conserver** [C] : liaison par hash du dessin (`imageHash`), des actions (`actionsHash`) et du replay enrichi ; rejet serveur des séquences automatisées ; chaîne de blocs chaînée par SHA-256 ; moteur de dessin dont le replay reproduit l'image au pixel près (testé) ; signature Ed25519 effectivement produite par les firmwares.

**Faisabilité.** Oui, **sans changer de matériel**. Les calculs à faire (SHA-256, entropie, transitions, RLE) sont linéaires en nombre de pixels (≤ 153 600) et peuvent se faire **en flux, sans tampon** : l'ESP8266 n'a donc pas besoin de plus de mémoire qu'aujourd'hui [E]. Le goulot est le réseau (TLS, liaison série de la R4) et la discipline d'ingénierie (calculs **entiers déterministes** identiques sur serveur, ESP8266 et R4), pas la puissance de calcul.

**Ce qui ne peut pas être rendu vrai avec ce matériel** (à dire honnêtement) : un ESP8266 n'a pas d'élément sécurisé ni de démarrage sécurisé ; sa clé privée est lisible par son propriétaire. L'identité est donc **liée à un propriétaire (profil)**, pas à un matériel certifié. La résistance aux faux appareils repose sur l'appairage, le vote **par profil** (pas par appareil), un **comité tiré au sort** et la réputation — pas sur la cryptographie seule. Et aucun appareil ne peut vérifier qu'un dessin a été fait **à la main** (le replay est trop lourd) : cette partie reste une **vérification serveur**, éventuellement doublée par des auditeurs plus puissants (navigateur, Raspberry Pi).

**Recommandation.** Procéder par **niveaux d'assurance** (§ 3) et par phases livrables et réversibles (§ 8). Les phases P0 à P2 sont **côté serveur uniquement**, corrigent immédiatement les failles d'identité, et n'exigent aucun reflash. Le basculement « strict » n'intervient qu'après déploiement des firmwares.

**Décision immédiate hors chantier** : la page Apprendre (`ExpertDocumentation.tsx`, rôle « Validateur ») affirme que l'ESP « calcule des métriques visuelles et vote ». C'est inexact aujourd'hui. À reformuler tant que le chantier n'est pas livré (règle de vocabulaire honnête, `BRIEF_GPT_PAGE_RESEAU_ET_ACCUEIL.md` § 8).

---

## 1. Ce qui a déjà été dit et décidé (historique de la recherche)

| Source | Ce qu'elle établit | Niveau |
|---|---|---|
| `CLAUDE.md` (« Ce qui reste à faire ») | « V2 : calcul local de métriques ESP, signature ED25519 réelle » reporté après la V1 multi-écrans | [D] |
| Vault, `Proof of Draw.md` (§ avancement) | « V2 : calcul local de métriques ESP — non démarré » | [D] |
| Vault, `Proof of Draw.md` (idée Raspberry Pi) | Un Pi n'a aucune contrainte mémoire de l'ESP8266 ; il pourrait calculer les métriques plus finement et porter ce chantier | [D] |
| Vault, `PoD - État des lieux, dette et pistes business (octobre 2026)` | Question ouverte n° 3 : « Trancher l'honnêteté de la validation : la rendre réelle (vérification locale, signatures obligatoires — possible sur R4, pas sur ESP8266) ou renommer le produit » ; constat : `STRICT_SIGNATURE`, quorum 51 %, candidat unique | [D], recoupé ici |
| `docs/UNO_R4_EINK29.md` l. 37 | « Pas de calcul de métriques local (le vote reprend `score_server`, comme les firmwares actuels) » | [C] |
| `docs/ANIMATIONS_PIPELINE.md` § score | Pour une animation, le score signé est la **moyenne des scores de ses images**, recalculable depuis le bloc : première forme de vérifiabilité a posteriori | [C] |
| `docs/BRIEF_GPT_PAGE_RESEAU_ET_ACCUEIL.md` § 8 | Règle : pas de « blockchain / preuve / consensus » tant que la validation est cosmétique | [C] |
| Session du 05/10/2026 (analyse sécurité) | Les `deviceId` sont déjà publics (snapshot, blocs) alors qu'ils servent d'identifiants aux routes firmware ; signatures permissives ; ajout de `deviceRef` (identifiant public) comme **mitigation partielle** | [C] |
| Décision du porteur, 05/10/2026 | Rendre la validation **réelle** | — |

**Correction d'une hypothèse antérieure.** L'état des lieux écrit « possible sur R4, pas sur ESP8266 ». L'analyse ci-dessous montre que l'**ESP8266 peut** vérifier intégrité et métriques **en flux** ; ce qui lui est interdit, c'est le replay (vérification du geste) et toute garantie matérielle de la clé. La nuance est importante : elle évite d'exclure 90 % du parc.

---

## 2. État actuel — constats vérifiés

### F1 — Le vote est un écho du score du serveur [C]
`esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino` l. 1313-1326 : `score = cand["score_server"]`, puis `entropy`, `transitions`, `rle` et `score` reçoivent **la même valeur** (`scoreStr`). Le serveur fournit le candidat **sans image** (`app/api/validate-candidate/route.ts` l. 83-86 : l'image épuiserait le tas TLS). Aucun firmware ne peut donc calculer quoi que ce soit.
La fonction de métriques existe dans le firmware 2.9 BWR (`computeComplexityScore`, l. 413) mais **n'est appelée nulle part** [C] (code mort). Elle utilise un ET logique de bits e-ink (0 = actif) là où le serveur utilise un OU sur des pixels 1 = actif : ses conventions ne sont pas celles du serveur.

### F2 — Aucun désaccord n'est possible [C]
`lib/chain.ts` l. 161 et 353-354 : `QUORUM_RATIO = 0.51`, `quorumReached = voteCount >= max(1, ceil(poolSize × 0.51))`. Un vote **est** une approbation ; il n'existe ni champ « refus » ni motif. Le score final est la moyenne `(score serveur + moyenne des scores votés) / 2` (l. 417-418) : avec des échos, il est égal au score serveur. `app/api/validation-result/route.ts` l. 92-95 ne fait que **journaliser** une dérive > 0,4.

### F3 — Les signatures sont permissives et ne couvrent pas le contenu [C]
`validation-result/route.ts` l. 103-129 : en l'absence de `STRICT_SIGNATURE=true`, une signature invalide, de mauvaise longueur ou absente **ne bloque pas** le vote. Le message signé est `deviceId:candidateId:score` (l. 108) : il ne contient **ni le hash de l'image, ni les métriques détaillées**. Une signature valide n'atteste donc pas que l'appareil a vu quoi que ce soit.

### F4 — L'identité d'un appareil est usurpable et fabricable en série [C]
`app/api/register/route.ts` : l'appareil s'identifie par une **adresse MAC déclarée** (l. 34, 41), non secrète ; la clé publique est **écrasée à chaque register** (l. 101-103) sans preuve de possession de l'ancienne. Un script peut (a) prendre la place d'un appareil existant en re-enregistrant sa MAC avec sa propre clé, (b) créer des appareils fictifs jusqu'au plafond global (`isDeviceCapReached`) ; seule limite par IP : 5 register/min (l. 27). Un appareil fictif devient « actif » par ses pulls et pèse dans le quorum (`getGlobalActiveCount`, `lib/deviceStore.ts` l. 388). **Conséquence : un attaquant peut, avec `curl`, voter en majorité et miner.**

### F5 — Les seuils de qualité ne rejettent rien [C]
`app/api/submit-candidate/route.ts` l. 128-159 : le commentaire déclare « le réseau ESP vote », mais seules les séquences automatisées (`automationRatio` > `MAX_AUTOMATION_RATIO`) sont rejetées ; durée, traits, couverture et complexité ne produisent que des **avertissements**. Comme les ESP n'évaluent rien (F1), **personne ne juge** : ni le serveur, ni le réseau.

### F6 — Pas d'exclusion de l'auteur [C partiel]
Ni `validate-candidate` ni `validation-result` n'écartent les appareils du **même profil** que l'auteur du candidat (`castVote` dans `lib/chain.ts` n'a pas été relu intégralement : à confirmer). Un artiste peut valider sa propre œuvre avec ses ESP.

### F7 — La géométrie des métriques n'est pas exacte pour l'e-ink 2,9″ [C côté serveur, E côté effet]
`submit-candidate/route.ts` l. 74-77 décode les tampons `eink29bwr` comme **296 × 128** ; le tampon pilote est **128 colonnes × 296 lignes** (`bytesPerRow = 16`, voir `CLAUDE.md`). Les pixels sont les mêmes, mais **adjacences et runs sont calculés avec un mauvais pas de ligne** : « transitions » et « RLE » ne mesurent pas les contours réels. L'impact sur le score est faible mais **toute spécification doit figer la géométrie** (§ 5.2). Pour `eink27bw` (176 × 264, 22 octets/ligne) la géométrie est cohérente.

### F8 — Débit, latence, disponibilité [C]
- **Un seul candidat à la fois** (`submit-candidate` l. 162-169, HTTP 409 sinon).
- `poolSize` = **tous** les appareils « actifs » (fenêtre 45 min, `lib/pullBudget.ts` l. 14) tous écrans confondus ; quorum = 51 % de ce nombre.
- Latence = cadence de pull : 5 min si le réseau est actif, 15 min au repos (`retryAfter`, `app/api/pull/route.ts` l. 211) ; TTL du candidat 30 min par défaut.
- Un candidat est donc finalisé quand **51 % de tous les appareils actifs** ont poussé un vote, ce qui est fragile dès que des appareils sont actifs mais lents ou éteints.

### F9 — Ce qui est déjà vérifié par le serveur (à conserver) [C]
Rejet des séquences automatisées ; calcul du `drawScore` depuis le replay (moteur pur, déterministe, `lib/drawEngine/scoring.ts`) ; `imageHash`, `actionsHash`, `podHashEnriched` liés au candidat ; chaîne `parentHash` + `blockHash` SHA-256 (`lib/chain.ts` l. 415-435) ; pour une animation, empreintes par image et racine recalculées **depuis le clip** (`lib/anim/block.ts`).
Limite : ces garanties sont **« le serveur a vérifié »**. Elles ne sont pas répliquées chez des tiers.

---

## 3. Ce que « réel » doit vouloir dire — niveaux d'assurance

Définir précisément ce qu'on promet évite de remplacer un mensonge par un autre.

| Niveau | Promesse | Ce que doit faire un validateur | Qui peut le tenir |
|---|---|---|---|
| **N0** (actuel) | « N appareils étaient en ligne » | rien | tous |
| **N1 — Intégrité attestée** | « N appareils **indépendants** ont reçu **ces octets exacts** (hash), recalculé **ces métriques** et signé cet hash » | SHA-256 du flux, métriques entières, comparaison, signature Ed25519 sur le contenu | ESP8266 et R4 (§ 4) |
| **N2 — Règles objectives** | N1 + « les règles de format/anti-spam du réseau sont respectées » (non vide, pas de bruit pur, géométrie valide, limites d'animation) | N1 + application d'un jeu de règles **public et versionné** | ESP8266 et R4 |
| **N3 — Authenticité du geste** | N2 + « le replay reproduit l'image et le rythme est humain » | rejouer le replay (moteur de dessin) | **navigateur / Raspberry Pi / serveur** — **pas** ESP8266 ni R4 |

**Principe directeur** : les appareils attestent N1-N2 (objectif, calculable, reproductible). N3 est assuré par le serveur et des **auditeurs** plus puissants. Le réseau **ne juge pas le goût** : aucun refus pour « laid » ou « simple », seulement pour des critères objectifs. C'est cohérent avec la décision déjà actée (« le serveur n'est pas juge de la qualité artistique »).

Ce que la blockchain/consensus **ne prétendra jamais** tant que N3 n'est pas assuré par des tiers : « dessiné à la main, vérifié par le réseau ».

### Modèle de menace

| # | Menace | Aujourd'hui | Réponse visée |
|---|---|---|---|
| T1 | Sybil : créer de faux appareils pour atteindre le quorum | possible (F4) | un vote **par profil**, appairage exigé, ancienneté, comité tiré au sort, plafonds |
| T2 | Usurpation : prendre l'identité d'un appareil | possible (F4) | clé épinglée au premier enregistrement ; remplacement seulement avec preuve (ancienne clé ou session du profil) |
| T3 | Vote forgé / rejoué | possible (F3) | signature **stricte** couvrant `candidateId`, `imageHash`, métriques, verdict ; liaison à un candidat unique |
| T4 | Auto-validation / collusion de proches | possible (F6) | exclusion des appareils du profil auteur ; comité tiré au sort publiquement vérifiable |
| T5 | Serveur malhonnête ou compromis | confiance totale | votes signés **publiés dans le bloc** ; vérificateur public indépendant (§ 5.7) ; ancrage optionnel de la tête de chaîne |
| T6 | Divergence numérique → faux refus | non applicable | calculs **entiers** + vecteurs de test communs (§ 5.2) |
| T7 | Saturation par candidats invalides (bande passante, quota Redis) | limité (un candidat à la fois) | contrôles à l'admission inchangés ; image servie via CDN (§ 5.3) |
| T8 | Extraction de clé sur ESP8266 (flash lisible, pas de démarrage sécurisé) | non traité | **non résoluble** sans matériel sécurisé : l'identité est liée au propriétaire ; réputation et vote par profil bornent l'impact |

---

## 4. Capacités matérielles — ce que chaque carte peut réellement calculer

| | ESP8266 (NodeMCU / D1 mini) | UNO R4 WiFi (RA4M1 + ESP32-S3 modem) |
|---|---|---|
| Calcul | 80 MHz, SHA-256 (BearSSL), Ed25519 (bibliothèque Crypto, déjà utilisée) | Cortex-M4 48 MHz ; **32 Ko de SRAM** ; **pile principale 1 Ko** (`BSP_CFG_STACK_MAIN_BYTES`, `docs/UNO_R4_TFT28.md`) |
| Mémoire utile | ≈ 47 Ko de tas, **TLS ≈ 16 Ko d'un bloc** | tampons statiques uniquement |
| Réseau | TLS direct | Wi-Fi via **liaison série 115 200 bauds** vers l'ESP32-S3 : **153 600 octets ≈ 15 à 25 s** [C, mesuré, `docs/UNO_R4_TFT28.md` l. 42] |
| Peut vérifier N1/N2 | **Oui, en flux** [E] | **Oui**, mais 15-25 s pour une image TFT 2,8″ si on la télécharge entière |
| Peut vérifier N3 (replay) | Non | Non |
| Sécurité de la clé | EEPROM/flash lisible | flash lisible |

### Tailles des tampons natifs (octets)

| Écran | Tampon pilote | Pixels |
|---|---|---|
| OLED 0,96″ | 1 024 | 8 192 |
| E-ink 2,7″ BW | 5 808 (22 × 264) | 46 464 |
| E-ink 2,9″ BWR | 9 472 (2 × 4 736) | 37 888 |
| TFT 1,8″ | 40 960 (RGB565) | 20 480 |
| TFT 2,8″ | 153 600 (RGB565) | 76 800 |

**Calcul en flux.** Entropie : deux compteurs. Transitions : une ligne précédente (≤ 37 octets en 1 bit). RLE : un compteur de runs. SHA-256 : état de 32 octets + bloc de 64. **Aucun tampon d'image n'est nécessaire** : cela **respecte et simplifie** les règles mémoire absolues de `CLAUDE.md` (plus de `malloc` de buffers pixel autour du TLS pour la validation). Coût CPU : quelques dizaines de milliers de pixels × quelques dizaines de cycles ≈ **quelques dizaines de ms** [E] ; la signature Ed25519 est déjà exécutée aujourd'hui. Les durées réelles sont à **mesurer** (§ 9, critère d'acceptation).

**Candidats « lourds » (TFT).** Le serveur calcule déjà les métriques sur un **masque 1 bit** « pixel ≠ blanc pur » (`submit-candidate` l. 83-94). Proposition [P] : servir ce masque (2 560 octets pour TFT 1,8″, 9 600 pour TFT 2,8″) pour les métriques, avec son hash signé (`maskHash`) ; l'image RGB565 complète n'est vérifiée que par les validateurs capables (ESP8266 à la demande, auditeurs) et par le serveur. Compromis assumé et documenté dans le bloc.

---

## 5. Conception cible

### 5.1 Le vote v2 (remplace l'écho)
```
POST /api/validation-result
{ "v":2, "deviceId":"dev_…", "candidateId":"uuid",
  "imageHash":"<sha256 hex>",            // recalculé par l'appareil sur le flux reçu
  "metricsVersion":2,
  "e": 61234, "t": 48112, "r": 30456,    // métriques ENTIÈRES en parties par million
  "verdict":"accept" | "reject",
  "reason": "ok|hash|metrics|blank|noise|format|rules",
  "fw":"…", "sig":"<ed25519 hex 128>" }
```
Message signé, canonique et lisible :
`pod-vote-v2|<deviceId>|<candidateId>|<imageHash>|<metricsVersion>|<e>|<t>|<r>|<verdict>`
La signature lie **l'appareil, le candidat, le contenu et le jugement**. Elle est **obligatoire** pour un vote v2 (aucun mode permissif).

### 5.2 Spécification des métriques « pod-metrics-2 » — calculs entiers déterministes
Objectif : **zéro divergence** entre Node.js, ESP8266 (float 32 bits) et R4. On bannit `float` des chemins de vote.
- **Géométrie figée par écran** (largeur de ligne en pixels, ordre des bits) — corrige F7 pour l'e-ink 2,9″ (pas de 128). Les blocs existants restent en `metricsVersion: 1` (aucune réécriture de l'historique).
- `n` = nombre de pixels ; `ones` = pixels actifs.
- **Entropie** : `q = round(1024 × ones / n)` en entier ; `e = H[q]` lu dans une **table de 1 025 valeurs** (parties par million, générée une fois, publiée, incluse en `PROGMEM` : 1 025 × `uint32`, ≈ 4 Ko). Pas de `log2` à l'exécution.
- **Transitions** : compte entier d'adjacences horizontales + verticales différentes ; `t = round(1 000 000 × T / total)` par division entière.
- **RLE** : `runs` en ordre ligne par ligne ; `r = isqrt(1 000 000² × runs / n)` (racine entière).
- **Score** : `s = (4e + 4t + 2r) / 10`, entier ppm ; `min(s, 1 000 000)`.
- **Vecteurs de test** : un fichier unique (`tests/fixtures/pod-metrics-vectors.json`) généré par le serveur ; chaque firmware est **validé en différentiel sur PC** avec `g++`, sur le modèle déjà utilisé par `tests/podBenchR4.test.ts`. Un firmware ne part pas sur la carte si ses sorties diffèrent d'un seul ppm.
- **Tolérance : zéro.** Le vote est refusé si les métriques de l'appareil diffèrent de celles du serveur, au ppm près (le calcul est déterministe).

### 5.3 Servir le contenu au validateur
`GET /api/candidate-frame?candidateId=…&fmt=bin` — **octet-stream brut**, comme `pull-frame` : tampon natif du candidat (ou masque, § 4), en-têtes `X-Screen-Type`, `X-Image-Hash`, `X-Metrics-Version`. Contraintes firmware inchangées : `useHTTP10(true)`, `readFull()` en boucle, jamais de payload dans `validate-candidate` ni `pull`.
**Quota** : la réponse est **immuable par `candidateId`** (`Cache-Control: public, s-maxage=…, immutable`), donc servie par le CDN après le premier accès : le coût Redis ne dépend pas du nombre de validateurs (même principe que `/api/block-clip`). Coût d'origine : 1 lecture du candidat par candidat.

### 5.4 Règles de verdict (N2) — objectives seulement [P]
Un validateur **refuse** (`reject`) uniquement si : `imageHash` reçu ≠ annoncé ; métriques recalculées ≠ annoncées ; format/dimensions invalides ; image **vide** (aucun pixel actif) ; **bruit pur** (entropie et transitions au-dessus de seuils publiés, ex. > 0,98 et > 0,9) ; pour une animation, limites de durée/poids dépassées. Les seuils sont **versionnés** (`rulesVersion`) et publiés. **Aucun critère esthétique.**
Les « avertissements » actuels de `submit-candidate` (durée, traits, couverture, complexité) **restent informatifs** : ils ne deviennent pas des motifs de refus des appareils.

### 5.5 Comité, quorum, liveness
- **Éligibilité** : appareil appairé à un **profil**, clé publique épinglée, firmware déclarant `voteVersion ≥ 2`, ancienneté minimale (ex. 24 h), actif.
- **Un vote compté par profil**, jamais par appareil (un artiste avec 4 ESP pèse 1).
- **Exclusion de l'auteur** : aucun appareil du profil auteur (ni du propriétaire de l'ESP prêté) n'est éligible.
- **Comité** : `K = min(éligibles, 7)` ; classement par `SHA-256(candidateId ‖ hashDuBlocPrécédent ‖ clé publique)` — **vérifiable publiquement** a posteriori, imprévisible avant la publication du candidat. Liste ordonnée : si un membre ne répond pas dans le délai, on passe au suivant (liveness).
- **Seuil** : acceptation si `accepts ≥ ceil(2K/3)` ; rejet si `rejects > K − ceil(2K/3)`. Un refus **signé et motivé** est conservé (utile à l'audit et à la réputation).
- **Réseau petit (cas réel aujourd'hui : 3 artistes)** : politique d'**amorçage** [P], à trancher (§ 10) — par exemple, sous 3 profils éligibles non-auteurs, le bloc est miné en mode `bootstrap` avec **badge explicite** « validation partielle (k/K) » et le serveur compte comme **référence** sans jamais être seul. Le bloc enregistre toujours `validation: { mode, committee, accepts, rejects, rulesVersion, metricsVersion }`. Principe : **ne jamais afficher « validé par le réseau » quand ce ne l'est pas**.
- **Latence** : cadence de pull (5 min actif) + calcul (< 1 min). Le TTL du candidat suit la décision déjà évoquée (15 min au lieu de 30).

### 5.6 Identité et anti-Sybil
1. **Épinglage de clé** : la première clé publique enregistrée est **fixée**. Un nouveau `register` avec une autre clé est refusé, sauf (a) signature de la nouvelle clé par l'ancienne ou (b) action authentifiée du propriétaire dans son profil (session) pour « réinitialiser la clé » (cas du changement de carte).
2. **Signature stricte** (`STRICT_SIGNATURE`) activée **par version de firmware** (même mécanisme que `ANIM_POINTER_FIRMWARE`), avec période de coexistence : un appareil v1 continue d'**afficher** mais n'est plus **validateur**.
3. **Appairage obligatoire** pour voter ; limite de nouveaux profils votants par période ; ancienneté.
4. **Réputation** : compteurs de divergences/absences par profil → sortie du comité (la liste noire existante sert de mécanisme).
5. **Limite assumée** : un propriétaire déterminé peut faire tourner un « faux ESP » logiciel avec sa propre clé. On borne l'impact par le vote par profil et le comité ; on ne prétend pas l'empêcher (T8).

### 5.7 Vérifiabilité publique (ce qui fait que ce n'est plus « sur le papier »)
- Le bloc **embarque les votes signés** (appareil publié sous son identifiant public, clé publique, hash, métriques, verdict, signature) — quelques centaines d'octets.
- **Vérificateur indépendant** `scripts/verify-block` (Node, sans accès Redis) : prend un bloc et l'image, recalcule hash et métriques, vérifie chaque signature Ed25519 et la **sélection du comité**. Fonction pure, couverte par les tests, réutilisable par un tiers.
- Page de bloc : « Validé par k appareils / profils distincts · vérifiable » avec le lien de vérification. Vocabulaire strictement aligné sur le niveau réellement atteint (N1, N2).

### 5.8 Auditeurs pour N3 (phase ultérieure)
Le moteur de dessin est **pur et déterministe** et son replay reproduit l'image au pixel près (testé). Un **auditeur navigateur** (ou Raspberry Pi) peut rejouer le replay d'un bloc, vérifier `replay == image`, le `drawScore` et le rythme humain, puis publier une **signature d'audit** non bloquante qui relève le niveau de confiance du bloc. Aucun coût matériel supplémentaire.

---

## 6. Impact sur les quotas, la bande passante et l'énergie (règle primordiale du dépôt)

Estimation par bloc, comité de 7 [E] :
- **Redis** : par validateur ≈ 1 `MGET` (validate) + 1 `MGET` + 1 écriture (vote) ≈ 3 à 4 commandes ; la lecture du contenu passe par le CDN. ≈ **25 à 30 commandes par bloc**, plus la finalisation existante. À 20 blocs/jour : ≈ 600/jour ≈ **18 000/mois**, soit < 10 % de l'objectif 200 k (`docs/PLAN_REDIS_200K.md`). **À mesurer** avant bascule.
- **Invocations Vercel** : +1 (candidate-frame, majoritairement servi par le CDN) par validateur et par bloc.
- **Bande passante ESP** : 1 à 9,5 Ko par validation (hors TFT/masque 2,6-9,6 Ko). Négligeable.
- **Énergie** : quelques secondes de CPU et de radio par bloc ; **sans effet mesurable** sur la consommation 24 h/24 (voir l'estimation par montage dans la page Apprendre, parcours Consommation).
- **Risque** : si `poolSize` actif dépasse quelques dizaines, le **comité borné** (K ≤ 7) évite que le coût croisse avec le réseau — c'est aussi une raison d'architecture, pas seulement de sécurité.

---

## 7. Compatibilité et migration

- **Versionnage** : le serveur annonce `voteVersion` et `metricsVersion` dans `validate-candidate` ; les firmwares anciens répondent en v1. Passage en v2 **par type d'écran**, piloté par la **version de firmware déclarée** à `register` (précédent : `lib/anim/pointer.ts`).
- **Coexistence** : en phase P2, le serveur accepte v1 (compté « hérité », non comptabilisé dans le comité) et v2. Le comité n'est actif qu'au-delà d'un seuil de validateurs v2 ; avant, mode `bootstrap` étiqueté.
- **Historique intact** : les blocs existants gardent `metricsVersion: 1` ; aucune ré-écriture, aucun recalcul.
- **Firmware** : **sauvegarde obligatoire** dans `firmware-backups/<date>/` avant toute modification d'un `.ino` (règle du dépôt). Les en-têtes partagés (`pod_*` en copies identiques par dossier) se synchronisent par `node scripts/sync-bench-header.js` (test `benchHeaderCopies`). Toute fonctionnalité non essayée sur la carte porte l'avertissement « non testé ».
- **Rollback** : chaque phase est désactivable par variable d'environnement (`VOTE_V2_ENABLED`, `STRICT_SIGNATURE`, `COMMITTEE_ENABLED`) ; l'ancien chemin reste en place jusqu'à validation sur matériel.

---

## 8. Plan par phases (livrables, tests, critères d'acceptation)

| Phase | Contenu | Matériel requis | Critère d'acceptation | Effort [E] |
|---|---|---|---|---|
| **P0 — Identité et sémantique (serveur)** | Épinglage de clé et refus de remplacement ; `STRICT_SIGNATURE` **par version** ; vote par profil ; exclusion de l'auteur ; champ `verdict` accepté (v1 = « accept » implicite) ; tests hostiles | non | un faux appareil ne peut ni écraser une clé ni atteindre le quorum seul ; l'auteur ne vote pas | 1 session |
| **P1 — Spécification des métriques** | `pod-metrics-2` (entier), table d'entropie, géométrie figée, vecteurs de test, implémentation serveur + vérificateur Node + tests différentiels `g++` d'un **prototype C++** | non | mêmes sorties au ppm sur serveur et C++ pour ≥ 200 vecteurs (dont cas limites : image vide, pleine, damier, bruit) | 1 session |
| **P2 — Contenu et vote v2 (serveur)** | `/api/candidate-frame` immuable (CDN) ; `validation-result` v2 (hash, métriques, verdict, signature stricte) ; stockage des votes dans le bloc ; coexistence v1/v2 | non | tests d'intégration : vote forgé, rejoué, hash faux, métriques fausses, candidat différent → tous refusés | 1 session |
| **P3 — Firmware ESP8266** | e-ink 2,9″, e-ink 2,7″ (seul et + OLED), TFT 1,8″ : validation en flux, vote v2, verdict ; mémoire et durées mesurées | **oui** (3 à 4 cartes) | `[VALIDATE]` au Serial : hash + métriques recalculés ; refus d'une image corrompue volontairement ; tas stable ; durée < 60 s | 2 sessions + essais |
| **P4 — Firmware UNO R4** | TFT 2,8″ et e-ink 2,9″ : mêmes règles, tampons statiques, pile 1 Ko ; masque pour les candidats lourds | **oui** | `[SELFTEST]`/`[MEM]` ; mêmes résultats que le serveur ; durée mesurée (série 115 200) | 1 à 2 sessions |
| **P5 — Comité et quorum** | sélection vérifiable, seuil 2/3, délais, mode `bootstrap` étiqueté, réputation ; interface (bloc, galerie, réseau) alignée | non (tests avec appareils simulés) | simulations : 3 / 10 / 100 / 500 appareils, dont 30 % fictifs : aucun bloc finalisé sans quorum de profils réels | 1 à 2 sessions |
| **P6 — Bascule stricte et audit** | `STRICT_SIGNATURE=true` pour les versions v2 ; auditeur navigateur (replay) ; vérificateur public ; mise à jour Apprendre/CLAUDE/vault | quelques cartes | un bloc se vérifie intégralement hors serveur ; documentation honnête | 1 à 2 sessions |

**Ordre recommandé** : P0 → P1 → P2 d'abord (aucun reflash, gain de sécurité immédiat), puis P3 → P4 en regroupant les essais matériel, puis P5 → P6.
**Point de non-retour à surveiller** : ne **pas** activer le mode strict avant que les firmwares v2 soient déployés sur le parc réel, sous peine d'empêcher tout minage.

---

## 9. Plan de test (preuves attendues)

| Famille | Cas | Résultat attendu |
|---|---|---|
| Identité | re-register d'une MAC avec une autre clé | refusé ; clé d'origine conservée |
| Sybil | 50 appareils fictifs enregistrés, 3 vrais profils | aucun quorum atteint par les fictifs ; non appairés non éligibles |
| Signature | vote sans signature, signature d'un autre candidat, signature sur un score modifié | refusé |
| Rejeu | même vote renvoyé pour un autre candidat | refusé (liaison `candidateId` + `imageHash`) |
| Contenu | image modifiée d'un bit entre candidat et validateur | `reject` motivé `hash` |
| Métriques | métriques annoncées altérées d'un ppm | `reject` motivé `metrics` |
| Équité | l'auteur vote avec son propre ESP | vote non compté |
| Comité | tirage rejoué par un tiers | même liste, même ordre |
| Numérique | 200 vecteurs sur Node, C++ (x86), cartes | sorties identiques au ppm |
| Charge | 500 appareils simulés | ≤ K validateurs sollicités ; commandes Redis par bloc dans la fourchette annoncée |
| Régression | `npm test`, `npx tsc --noEmit`, essais d'affichage (images, animations) | inchangés |

---

## 10. Décisions à prendre par le porteur avant P0

1. **Périmètre de la promesse** : adopter les niveaux N1-N2 (appareils) et N3 (serveur + auditeurs) et **l'écrire ainsi** publiquement (recommandé) ?
2. **Réseau petit** : accepter un mode `bootstrap` étiqueté tant qu'il y a moins de 3 profils éligibles non-auteurs (recommandé), ou bloquer le minage tant que le comité n'est pas complet ?
3. **Comité** : taille maximale K = 7 et seuil 2/3 conviennent-ils ?
4. **Règles N2** : valider la liste d'objectifs (vide, bruit pur, format, limites d'animation) et refuser tout critère esthétique ?
5. **Ancienneté et appairage** : exiger l'appairage à un profil et 24 h d'ancienneté pour voter ?
6. **Parc** : combien de cartes, de quels types, disponibles pour les essais P3-P4 ? Accepte-t-on qu'un firmware v1 cesse d'être validateur (il reste afficheur) ?
7. **Réinitialisation de clé** : par le profil du propriétaire (session) — acceptable ?
8. **Vérification publique** : publier un vérificateur ouvert (CLI) et l'ancrage optionnel de la tête de chaîne ?
9. **Reformulation immédiate de la page Apprendre** (rôle « Validateur ») en attendant la livraison ?

---

## 11. Risques

| Risque | Gravité | Parade |
|---|---|---|
| Régression mémoire ESP8266 (déjà « au bord » : TLS 16 Ko, clip + TLS ne tiennent pas) | élevée | validation **en flux**, aucun tampon pixel ; mesures `ESP.getFreeHeap()` en critère d'acceptation ; sauvegarde du `.ino` |
| Divergence numérique entre plateformes | élevée | entiers uniquement + vecteurs + test différentiel obligatoire |
| Blocage du minage au basculement strict | élevée | activation **par version** ; coexistence ; rollback par variable |
| Réseau trop petit pour un comité | moyenne | mode `bootstrap` étiqueté, jamais présenté comme « validé » |
| Quota Redis | moyenne | CDN immuable, comité borné, mesure avant bascule |
| Verrouillage de propriétaires de cartes anciennes | moyenne | cartes v1 conservées comme afficheurs |
| Sur-promesse marketing | moyenne | vocabulaire aligné sur le niveau atteint (§ 3, § 5.7) |
| Absence de matériel sécurisé (T8) | structurelle | assumée, bornée par vote par profil ; piste future : cartes avec élément sécurisé pour une classe « validateur certifié » |

---

## 12. Instructions de démarrage pour la prochaine session

1. Lire, dans l'ordre : ce document ; `CLAUDE.md` (règles mémoire ESP, quotas Redis, conversions) ; `lib/chain.ts` (`castVote`, `finalizeBlock`) ; `app/api/validation-result/route.ts` ; `app/api/validate-candidate/route.ts` ; `app/api/register/route.ts` ; `lib/crypto.ts` ; `lib/ed25519.ts` ; `esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino` (l. 272-436, 1290-1360).
2. Commencer par **P0** (serveur seul). Ne **pas** toucher aux firmwares avant la validation de la spécification P1.
3. Respecter : TypeScript strict, règles ESP absolues (`CLAUDE.md`), coût Redis écrit dans chaque commit, `npm test` et `npx tsc --noEmit` avant commit, sauvegarde `firmware-backups/` avant tout `.ino`.
4. Ne jamais commiter `esp8266/esp_tft1.8/esp_tft1.8.ino` s'il contient des identifiants Wi-Fi en clair.
5. Maintenir la cohérence du vocabulaire public avec le niveau d'assurance réellement atteint.

---

## Annexe A — Pseudo-code des métriques entières (référence de P1)

```
inputs: bits[] en ordre ligne par ligne, largeur W, hauteur H (géométrie figée par écran)
n = W*H ; ones = popcount(bits)
q = (1024*ones + n/2) / n                         // entier
e = H_TABLE[q]                                    // ppm, table fixe de 1025 entrées
T = Σ [bits[i] != bits[i+1] sur la ligne] + Σ [bits[i] != bits[i+W]]
total = (W-1)*H + W*(H-1) ; t = (1_000_000*T + total/2) / total
runs = 1 + Σ [bits[i] != bits[i-1]] (ordre ligne par ligne)
r = isqrt( (1_000_000 * 1_000_000 * runs) / n )
s = min(1_000_000, (4*e + 4*t + 2*r) / 10)
```
Les opérations intermédiaires tiennent en `uint64` (`1e12 × runs` ≤ 1e12 × 153 600 < 2⁶⁴) ; sur ESP8266/R4, utiliser `uint64_t` pour l'étape RLE.

## Annexe B — Fichiers à connaître

| Rôle | Fichier |
|---|---|
| Candidat, quorum, bloc | `lib/chain.ts` |
| Admission d'un dessin | `app/api/submit-candidate/route.ts` |
| Métadonnées pour le validateur | `app/api/validate-candidate/route.ts` |
| Réception des votes, minage | `app/api/validation-result/route.ts` |
| Enregistrement et clés | `app/api/register/route.ts`, `lib/deviceStore.ts`, `lib/ed25519.ts` |
| Métriques serveur | `lib/crypto.ts` |
| Seuils adaptatifs (informatifs) | `lib/adaptiveValidation.ts` |
| Budget de pull, fenêtre d'activité | `lib/pullBudget.ts` |
| Firmware de référence (vote) | `esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino` l. 1290-1360 |
| Précédent de test différentiel C++ | `tests/podBenchR4.test.ts` |
| Précédent de version de firmware | `lib/anim/pointer.ts` |

## Annexe C — Classes de validateurs par capacité (ajout du 05/10/2026 : ESP, Arduino, bientôt Raspberry Pi et autres cartes)

Le protocole de vote v2 (§ 5.1) est **indépendant du matériel** : tout appareil qui sait calculer `pod-metrics-2`, hacher en SHA-256 et signer en Ed25519 peut voter. Le vote déclare sa **classe** (`vclass`) ; le comité peut exiger au moins un membre de classe supérieure.

| Classe | Matériel | Peut attester | Remarques |
|---|---|---|---|
| **A** | ESP8266, UNO R4 (RA4M1) | N1 + N2 (intégrité, métriques, règles objectives) | en flux, sans tampon (§ 4) |
| **B** | ESP32 (≈ 520 Ko de RAM), cartes équivalentes | N1 + N2, images lourdes entières, plus de marge TLS | candidat d'implémentation du mode « image complète » (TFT) |
| **C** | Raspberry Pi, PC, navigateur | N1 + N2 + **N3** (replay pixel-exact via le moteur de dessin, rythme humain) | auditeurs ; signatures d'audit non bloquantes puis, si le porteur le décide, membres du comité |

Conséquences : un seul format de vote et un seul vérificateur public pour toutes les cartes ; ajouter une carte = fournir une implémentation de `pod-metrics-2` validée sur les vecteurs de test (§ 5.2). Pistes commerciales/recherche triées dans le vault : `PoD - Pistes de monétisation et de recherche (tri du 05-10-2026)`.

## Annexe D — Avancement
- **05/10/2026, P0 amorcé** : `lib/keyPinning.ts` (+ `tests/keyPinning.test.ts`), branché dans `/api/register` **derrière `PIN_DEVICE_KEY=true`** (désactivé par défaut pour ne pas bloquer un propriétaire qui efface l'EEPROM). **À faire pour clore P0** : réinitialisation de clé par le profil, vote par profil, exclusion de l'auteur, champ `verdict`, `STRICT_SIGNATURE` par version de firmware, tests hostiles (§ 8, § 9).

## Annexe E — Nouveaux constats et avancement (05/10/2026, session de démarrage)

**Constats découverts en implémentant (niveau [C], reproduits par des tests)**
- **F10 — Le score serveur de l'e-ink 2,9″ BWR était ≈ 0,001 pour TOUT dessin** (noir ou rouge) : la V1 fusionnait les canaux par OU des bits bruts (1 = blanc), si bien qu'un pixel n'était « actif » que s'il était noir ET rouge. Corrigé en V2 (actif = noir OU rouge). Les blocs déjà minés gardent leurs scores V1 (non réécrits).
- **F11 — `verifyEd25519` (serveur) refusait TOUTES les signatures, même valides** : `createVerify("ed25519")` ne fonctionne pas, il faut `crypto.verify(null, …)`. C'est ce qui rendait `STRICT_SIGNATURE` inutilisable (« incompatibilité de librairie » supposée) et le mode permissif trompeur. **Corrigé** (`lib/ed25519.ts`, `tests/ed25519.test.ts`). Conséquence : la signature V1 `deviceId:candidateId:score` peut maintenant être réellement vérifiée ; **lire les journaux Vercel** (« signature ED25519 valide » / « invalide ») pour savoir si les firmwares actuels signent un message conforme avant de toucher à `STRICT_SIGNATURE`.
- **F12 — Course sur les votes** : `castVote` relit/modifie/réécrit toute la table des votes (`lib/chain.ts`) ; deux votes simultanés peuvent s'écraser. À corriger avant la bascule stricte (écriture atomique par appareil : `HSET`, ou script).

**Livré**
- **P0 (partiel)** : `lib/keyPinning.ts` (derrière `PIN_DEVICE_KEY`), `verifyEd25519` réparée.
- **P1 (livré)** : `lib/podMetrics.ts` + `lib/podMetricsTable.ts` (généré par `scripts/gen-pod-metrics-table.js`), `esp8266/_shared/pod_metrics.h` (+ table, harnais `host/metrics_harness.cpp`). Compilation vérifiée avec les chaînes **xtensa (ESP8266)** et **arm-none-eabi (R4)** (`-Wall -Wextra -Werror`) ; **le test différentiel g++ n'a pas pu s'exécuter ici (aucun g++ hôte)** : il s'active seul dès que `g++` est disponible (`CXX=…`), à lancer avant le premier flash.
- **P2 (serveur, livré)** : `lib/podVote.ts` ; `candidate.v2` (hash brut + métriques entières) calculé à la soumission des dessins statiques ; `GET /api/candidate-frame?candidateId=…` (octet-stream, immuable, CDN) ; `validate-candidate` annonce `v2 {screen, bytes, hash}` ; `validation-result` accepte le **vote v2** (signature Ed25519 obligatoire, accept exact au hash/ppm près, refus signé recevable, quorum sur les approbations seulement, candidat refusé quand le quorum devient inatteignable). Les votes v1 restent acceptés (compatibilité). Score d'un candidat statique = score V2.
- Tests : 300 (299 passent, 1 ignoré : g++), `tsc` propre.

**Reste (ordre)** : **P3 firmware ESP8266** (validation en flux : SHA-256 BearSSL + `PodFeeder`, vote v2, `[VALIDATE]` au Serial — sauvegarde `firmware-backups/` d'abord ; essai matériel requis) ; puis P0 restant (vote par profil, exclusion de l'auteur, réinitialisation de clé), F12, P5 (comité), P6 (bascule stricte).

## Annexe F — P3 démarré : firmware e-ink 2,9″ BWR v2.1 (05/10/2026) — ⚠ NON TESTÉ sur le matériel
- **Fichiers** : `esp8266/_shared/pod_vote_esp.h` (lecture en flux + SHA-256 BearSSL + verdict objectif + message signé) et copies dans `esp8266/esp_eink_2.9BWR/` (`pod_metrics.h`, `pod_metrics_table.h`, `pod_vote_esp.h`, synchronisées par `node scripts/sync-bench-header.js`). `esp_eink_2.9BWR.ino` : `doValidateV2()` (avant `doValidate()`), crochet dans `doValidate()` (si la réponse porte `v2`), version déclarée **2.1**, `DynamicJsonDocument` 512 → 768. Sauvegarde : `firmware-backups/2026-10-05_avant-validation-v2/`.
- **Compilation** : `xtensa-lx106-elf-g++ -fsyntax-only -Wall` avec le noyau ESP8266 3.1.2 (ArduinoJson et Crypto réels) sur la fonction et les en-têtes : **0 erreur**. La compilation complète du croquis et l'exécution restent à faire dans l'IDE Arduino.
- **Mémoire** : aucun tampon d'image ; `malloc(4 736)` temporaire pendant la lecture (déjà libérés : `blackBuf`/`redBuf`) ; pile : un morceau de 256 o. Le TLS reste un bloc de ≈ 16 Ko (règle existante).
- **Essai à faire (critères d'acceptation P3)** : au Serial, `[VALIDATE2] eink29bwr 9472 o en … ms | e=… t=… r=… s=… | verdict=accept` puis `Vote OK` ; `[MEM]` stable avant/après (`VALIDATE2-BEFORE/AFTER`) ; durée < 60 s ; relever `ms` ; **forcer un refus** (modifier un octet côté serveur) et vérifier `reject hash`. En cas de `422` : les métriques du serveur et de la carte diffèrent → copier la ligne `[VALIDATE2]` et la réponse serveur.
- **Compatibilité** : un firmware ≤ 2.0 continue de voter en v1 ; un candidat sans `v2` (animation) reste voté en v1.
- **Reste P3** : même intégration sur e-ink 2,7″ (seul et + OLED) et TFT 1,8″ (après l'essai de la 2,9″), puis P4 (R4).

## Annexe G — Reprise du 06/10/2026 : G1, G2, G4 faits, canari préparé
- **G1 (rejets v2 non bloquants)** : `app/api/validation-result/route.ts` — un refus v2 est conservé dans la carte des votes, journalisé (`REFUS v2 OBSERVÉ (non bloquant)`, avec `bloquerait=`) et signalé dans la réponse (`rejectObserved`), mais ne supprime plus le candidat. Le comportement bloquant n'existe qu'avec `ENFORCE_V2_REJECTIONS=true` (absente par défaut).
- **G2 (vote atomique, constat F12 corrigé)** : `lib/chain.ts` — `castVote` fait lecture + test « a déjà voté » + écriture dans UN script Lua (`VOTE_SCRIPT`, 1 `EVAL` par vote, soit la commande que remplace l'ancien `SET`) ; format stocké inchangé ; repli sur l'ancien chemin si le script est indisponible (journalisé). Tests : `tests/castVote.test.ts` (câblage et repli avec un faux Redis qui ÉMULE le script ; **la sémantique réelle du Lua/cjson reste à constater sur Upstash** : au premier vote réel, chercher `[castVote] script atomique indisponible` dans les journaux Vercel — son absence = le script a fonctionné).
- **G4 (parité numérique)** : le test différentiel C++/TypeScript tournait « ignoré » à cause d'un chemin Windows mal échappé dans `tests/podMetrics.test.ts` (`"C:\msys64\…"` : `\b` = retour-arrière). Corrigé (`C:/msys64/mingw64/bin/g++.exe`) : **firmware = TypeScript au ppm près pour les 5 écrans**, 0 ignoré.
- **Compilation complète** du firmware 2,9″ v2.1 avec `arduino-cli` (esp8266 3.1.2, `nodemcuv2:eesz=4M2M`) : 0 erreur, RAM statique 34 664 / 80 192 o (jusqu'ici : syntaxe seulement). `POD_TEST_FLIP_BYTE` (refus forcé, désactivé par défaut) ajouté à `pod_vote_esp.h` (copie `_shared` et 2,9″ identiques).
- **Protocole d'essai** : `docs/CANARI_2_9_PROTOCOLE.md` (G5).
- **Non fait volontairement avant l'essai** : le reste de P0 (voix par profil, auteur exclu, éligibilité, récupération de clé) — voir la fin du protocole : il exige un mode `bootstrap` pour ne pas empêcher une carte unique de miner.
- **À ne pas confondre** : correctif multiscreen du même jour (tri `storedAt`/`createdAt`, tampons statiques, `multiscreen-2.3`) — commit `eb68a3d`, indépendant de la validation.
