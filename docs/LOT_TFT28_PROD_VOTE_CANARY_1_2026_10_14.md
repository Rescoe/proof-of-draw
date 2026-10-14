# Lot TFT28-PROD-VOTE-CANARY-1 — autoriser le canari de vote unique V4 contre la production (14/10/2026)

Mise en œuvre de la décision `docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md` : le canari de vote unique V4 peut viser **`proof-of-draw.vercel.app`**, mais **seulement** avec un **consentement explicite et local**. Hôte et compilation seulement : **aucun flash, aucun vote, aucun déploiement, aucune fusion**. Rien du travail Preview n'est supprimé ni déprécié (`TFT28-PREVIEW-ENROLL-1`, `fb727d3`, protocole d'isolation : conservés, « prêts mais en sommeil »).

## 1. Ce qui change (uniquement quand `POD_VOTE_CANARY = 1`)
- **Par défaut la production reste REFUSÉE** : la porte de vote répond « `hote = PRODUCTION (backend isole obligatoire)` » (aucune lecture de candidat, aucune signature, aucun POST). Correction au passage : la comparaison ignore maintenant la **casse** (`strcasecmp`), le DNS l'ignorant — avant ce lot, `PROOF-OF-DRAW.VERCEL.APP` aurait passé la porte.
- **Consentement local** : la ligne `#define POD_VOTE_ALLOW_PRODUCTION 1` dans `pod_vote_pins.h` (ignoré par git ; le modèle `.example` ne la propose qu'en **commentaire**). Valeur : `0`/absent ou exactement `1` (`#error` sinon).
- **La production n'est acceptée que si** (vérifié à la **compilation**, `#error` / `static_assert`) : `POD_VOTE_CANARY = 1` ; `POD_VOTE_ALLOW_PRODUCTION = 1` ; `POD_CANARY = POD_RENDER_V1 = POD_VOTE_V1 = POD_PREVIEW_ENROLL = 0` ; hôte **exactement** `proof-of-draw.vercel.app` (le consentement avec un autre hôte, un alias ou une autre casse est **refusé à la compilation**, et refusé encore à l'exécution par la porte : ceinture et bretelles) ; identifiant, écran `tft28`, taille 153 600 et `rawHash` épinglés (inchangé : `POD_VOTE_PIN_*`).
- **Bandeau au démarrage** : `[VOTE-CANARY] ATTENTION : VOTE REEL SUR PRODUCTION (POD_VOTE_ALLOW_PRODUCTION=1) …`.
- `POD_VOTE_CANARY` exige désormais aussi `POD_PREVIEW_ENROLL = 0` (`#error`).
- **`scripts/check-vote-pins.js`** : production **sans** consentement : refusée ; **avec** consentement local : acceptée avec le cadre « **ATTENTION : VOTE RÉEL SUR PRODUCTION** » ; consentement + autre hôte, valeur invalide, alias, majuscules : refusés ; `pod_preview_host.h` : la production n'y est **jamais** admise ; contrôles UUID, hash 64 hexadécimaux minuscules, fichier ignoré et non suivi **conservés**.
- **`scripts/verify-candidate-backup.ts`** (nouveau, hors ligne) : vérifie la sauvegarde du candidat (§ 5).

## 2. Ce qui ne change pas
Verrou EEPROM (deux emplacements, écrit **et relu avant** la connexion du POST) ; **une seule tentative, un POST au maximum**, arrêt définitif après l'issue ; mesures de pile et de tas à chaque étape, marge < 128 o ⇒ verrou silencieux ; échec fermé ; **aucun écran, tactile, carte SD, animation ni ACK** dans le build de vote (preuve FIX1 refaite sur le build avec consentement). **Production (`POD_VOTE_CANARY = 0`) : texte du sketch identique à V3-FIX1** (test d'identité). Drapeaux committés à 0 : `POD_CANARY`, `POD_RENDER_V1`, `POD_VOTE_V1`, `POD_VOTE_CANARY`, `POD_PREVIEW_ENROLL`; `POD_VOTE_ALLOW_PRODUCTION` n'est **défini nulle part** dans le dépôt (valeur par défaut 0 dans le bloc du canari de vote).

## 3. Tests (`tests/tft28VoteCanary.test.ts`, `tests/voteProductionConsent.test.ts`)
- **Production refusée sans consentement** (3 casses de l'hôte) : 0 requête de vote, 0 POST, verrou intact, pas de bandeau.
- **Production acceptée avec le consentement local** : le vote unique complet se déroule (1 validate, 1 lecture, 1 POST signé, verrou ATTEMPTED/COMPLETED, arrêt), bandeau journalisé depuis le **vrai** `setup()`.
- **Toute la batterie V4 rejouée sur le build « production + consentement »** : issues (refus, timeout, écriture partielle, réponse perdue), reset avant / pendant le POST, allocation impossible, EEPROM (courte, sans allocation), états du verrou, épinglage, alerte de pile, démarrage nominal / register échoué / carte non appairée, **matrice de 102 coupures du verrou**.
- **Autre hôte incohérent refusé** : consentement + hôte isolé / majuscules / alias ⇒ échec de compilation (`static_assert`) ; valeurs `2`, `-1`, `10` ⇒ `#error` ; consentement + `POD_CANARY`, `POD_RENDER_V1`, `POD_VOTE_V1` ou `POD_PREVIEW_ENROLL` à 1 ⇒ `#error`.
- **Défense en profondeur** : sans le `static_assert`, la porte d'exécution refuse encore le consentement avec un autre hôte ; sans les deux, un vote partirait — le test détecte ce mutant.
- **Script des épingles** (8 tests) et **vérificateur de sauvegarde** (3 tests, 14 cas de refus).
- Portée source (écran / tactile / SD / ACK inatteignables) : refaite sur le build avec consentement.
- Résultats globaux, compilations ARM : § 7 et § 8.

## 4. Procédure du porteur (rien n'est exécuté par Claude)
1. `cp pod_vote_pins.h.example pod_vote_pins.h` ; hôte `proof-of-draw.vercel.app`, `candidateId`, `rawHash` relevés (§ 5) ; décommenter `#define POD_VOTE_ALLOW_PRODUCTION 1`.
2. `node scripts/check-vote-pins.js` → doit afficher le cadre « ATTENTION : VOTE RÉEL SUR PRODUCTION » puis `OK`. `sha256sum` du fichier consigné.
3. **Sauvegarde du candidat** (§ 5) puis `node --import tsx scripts/verify-candidate-backup.ts <export.json> arduino_uno_r4/pod_uno_r4/pod_vote_pins.h` → `OK`.
4. Compiler **localement** `-DPOD_VOTE_CANARY=1` (`POD_CANARY = POD_RENDER_V1 = 0`), jamais commité (ni les épingles, ni le binaire). Vérifier la ligne de démarrage `[VOTE-CANARY] ATTENTION : VOTE REEL SUR PRODUCTION`.
5. `VoteLockErase` : « A vierge, B vierge » (protocole d'isolation § 7), puis flash du canari. Protocole matériel et critères d'arrêt : `docs/LOT_8B2E_R4_TFT28_VOTE_V4_CANARY_2026_10_13.md` § 7 (étapes 3 à 8). **Rien n'est flashé avant l'audit de ce lot.**

## 5. Précondition OBLIGATOIRE : sauvegarder le candidat AVANT le vote
Aucun code n'écrit aujourd'hui dans `rejected:draws` (l'onglet « Rejetés » ne lit qu'une liste vide) : un candidat refusé disparaît avec `candidate:current` (TTL, ou `clearCandidate` à la clôture). Sans sauvegarde, son contenu est **perdu**.
1. Après la création du candidat et **avant** le flash : console Upstash de la base **principale** → `GET candidate:current` ; copier le JSON **complet, payload compris**, dans un fichier **hors du dépôt** (`candidate-<candidateId>.json`). Dupliquer aussi dans Redis : `COPY candidate:current candidate:backup:<candidateId>` puis `PERSIST candidate:backup:<candidateId>` (si `COPY` n'est pas disponible : `SET candidate:backup:<candidateId> '<json>'` **sans** `EX`). Coût Redis : quelques commandes, une fois.
2. **Vérifier** `node --import tsx scripts/verify-candidate-backup.ts candidate-<id>.json pod_vote_pins.h` : candidateId (UUID), `v2.screen = tft28`, `v2.rawBytes = 153600`, **contenu recalculé depuis le payload** (même fonction que `/api/candidate-frame`) = 153 600 octets dont le SHA-256 égale `v2.rawHash` **et** `POD_VOTE_PIN_HASH`, métadonnées présentes (`deviceId`, `poolScreen`, `imageHash`, `actionsHash`, `submittedAt`, `expiresAt`, `poolSize`), candidat non expiré. **Ne voter qu'après un `OK`.**
3. Issue : accepté ⇒ le candidat devient un **bloc de la chaîne principale** (jusqu'au reset global) ; refusé ou échec du test ⇒ le contenu complet reste récupérable dans la sauvegarde. Le futur lot **`REJECTED-CANDIDATE-ARCHIVE-1`** alimentera réellement l'onglet « Rejetés » (non construit ici).

## 6. Particularités de la production (à relever avant le vote)
- **Quorum** : `max(1, ceil(QUORUM_RATIO × appareils actifs))` ; les **autres appareils actifs** de la production valident aussi le candidat courant (clé `candidate:current` unique et globale) et peuvent le finaliser **avant** le vote de la TFT, qui recevrait alors un refus ou « aucun candidat » **en consommant l'unique tentative**. Relever le nombre d'appareils actifs ; idéalement la TFT est le seul validateur actif.
- **Modes de production** à relever (valeurs réelles, non supposées) : `ELIGIBILITY_MODE`, `COMMITTEE_MODE`, `BLOCK_RECEIPTS`, `STRICT_SIGNATURE`, `ENFORCE_V2_REJECTIONS`, `MIN_V2_APPROVALS`, `QUORUM_RATIO`, `CANDIDATE_TTL_SEC` (défaut 1 800 s : compiler et flasher dans ce délai, sinon candidat perdu et nouvelles épingles).
- **Appairage** : la carte est déjà appairée en production (canari d'affichage VERT du 14/10/2026) ; le build de vote s'arrête sur « non appairé » sinon.
- Règle primordiale des quotas Redis : le build de vote ne fait qu'un `register`, des `pull` de candidat et un vote ; aucune boucle nouvelle.

## 7. Suite globale
Suite complète : 885 tests, 882 réussis, **2 échecs préexistants** (`boundedSsl`, cœurs Renesas 1.5.3 / 1.6.0, identiques à la base) et **1 échec nouveau corrigé aussitôt** : `tft28Canary` comptait les occurrences de `POD_RENDER_V1` dans le texte brut du sketch, où le bloc du canari de vote (garde-fous de consentement) en cite désormais deux dans ses `#error` ; le test lit maintenant la **vue production** (`voteCanaryOffView`, comme les autres), 14/14 après correction (la suite complète n'a pas été rejouée une seconde fois : seul ce fichier a changé depuis). `tsc --noEmit` propre ; eslint propre sur les fichiers du lot. Dossiers temporaires : `ownTmp` (aucun reste) ; builds ARM et sources factices supprimés.

## 8. Compilation ARM (cœurs 1.5.3 et 1.6.0 identiques ; `docs/mesures/TFT28_PROD_VOTE_CANARY_1_2026_10_14/`)
| Build | Flash | RAM statique | Avertissements du sketch |
|---|---:|---:|---|
| production (`POD_VOTE_CANARY = 0`) | 158 620 o | 21 532 o | 0 (même taille qu'avant ce lot) |
| canari d'affichage | 149 584 o | 21 464 o | 0 (inchangé) |
| appairage Preview | 111 536 o | 15 016 o | 0 |
| canari de vote, hôte isolé | 134 224 o | 15 824 o | 0 |
| **canari de vote, production + consentement** | **134 336 o** | **15 824 o** | 0 (liste complète identique à la production) |
Le vote gagne 64 o (bandeau, `strcasecmp`), 176 o avec le consentement. **Refus vérifié avec la chaîne ARM** (GCC 7) : consentement + hôte `iso.example.test` ⇒ `static assertion failed: POD_VOTE_ALLOW_PRODUCTION = 1 n'est valable QUE pour proof-of-draw.vercel.app` (`refus-compilation-consentement-autre-hote-1.6.0.txt`). **Portée ELF du build « production + consentement »** : 232 fonctions atteignables, aucune d'écran / tactile / SD / animation / ACK ; constructeurs statiques sans accès au bus ; pile principale inchangée (pire chaîne sous `setup()` : 608 o).

## 9. Limites
Jamais flashé ni exécuté sur la carte. Le consentement est une garde **locale** : quiconque édite `pod_vote_pins.h` peut l'accorder — c'est voulu (décision du porteur) ; le garde-fou est qu'il soit explicite, local, non commité et affiché. Les 36 appels indirects de l'analyse ELF ne sont pas suivis. Aucune isolation en production : un bloc miné y reste jusqu'au reset global.

## 10. Rollback
`git revert` du commit : retour à `fb727d3` (la production reste refusée par défaut).
