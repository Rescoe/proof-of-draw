# Lot correctif transversal — suites de l'audit GPT (lots 2 à 5)

| | |
|---|---|
| **Date** | 07/10/2026 — base `5049f0c` |
| **Demandeur** | audit GPT (« CORRECTIONS REQUISES avant activation du consensus v3 ou adoption dans les firmwares ») |
| **Réalisateur** | Claude |
| **État de production** | **inchangé** : tout reste éteint par défaut (`ELIGIBILITY_MODE`, `BLOCK_RECEIPTS`, `COMMITTEE_MODE` absents). Aucun bloc de format v2 n'a jamais été miné : le format v2 a donc pu être **corrigé en place**, sans migration. |
| **Firmwares** | `pod_metrics.h` durci (voir § 7) : les 9 firmwares **recompilent** à l'identique (RAM statique inchangée) ; aucun `.ino` modifié ; **aucun reflash nécessaire** (les profils d'écran actuels étaient déjà sûrs). |

## Tableau des constats

| # | Constat de l'audit | Correction | Preuve |
|---|---|---|---|
| **B1** | Le comité n'était pas engagé dans le hash du bloc (la liste pouvait être remplacée sans changer le hash). | Nouveau champ du hash canonique **`committeeRoot`** = SHA-256(mode, K, **seuil**, **vague**, liste **ordonnée** des ≤ 2K profils). Le vérificateur recalcule la racine depuis le document de reçus (contrôle `committee-commit`). Un comité « shadow » n'a pas siégé : ni dans les reçus ni dans le hash. | `tests/committee.test.ts` : liste remplacée par une autre liste cohérente, vague changée, K/seuil changés, rangs inversés → **échec** ; racine modifiée dans le bloc → c'est le **hash** qui échoue. |
| **B2** | Le mineur déterministe n'était pas engagé (résultat et compteurs hors hash). | Nouveau champ **`minerRoot`** = SHA-256(profil tiré, « profil:blocs » triés) : **résultat ET entrées** du tirage. `finalizeBlock` fonctionne en trois temps : reçus → tirage (qui a besoin de `votesRoot`) → scellement ; le hash final existe avant la tâche d'observation qui le cite. Contrôle `miner-commit`. | profil truqué, nombres de blocs truqués, tirage effacé → **échec**. |
| **B3** | Le grinding du comité reste exploitable (28 % / 93 %). | **Garde à double verrou** : `COMMITTEE_MODE=enforce` n'est effectif qu'avec **`COMMITTEE_GRINDING_ACK=true`** (accusé explicite du risque) ; sinon il est ramené à « shadow » avec un avertissement journalisé à chaque dépôt. Le comité reste **expérimental**. La **balise aléatoire postérieure à la soumission** reste à concevoir (décision GPT/porteur). | `tests/committee.test.ts` : « enforce » seul = shadow ; accusé invalide (`1`, `yes`, `TRUE`…) = shadow ; accusé seul = off. |
| **B4** | L'électorat n'était pas figé (éligibilité recalculée au vote). | Le candidat **fige la liste triée des profils éligibles** (≤ 64, ≈ 1,6 Ko) ; `voteGate` contrôle l'**appartenance** (`not-in-electorate`) ; l'activité et l'ancienneté ne sont **plus recalculées** ; le dénominateur du quorum = taille exacte de la liste. Au-delà de 64 profils (`overflow`) ou pour un candidat antérieur : contrôle dynamique comme avant (le comité, borné à 2K, protège à grande échelle). | `tests/eligibility.test.ts` : profil devenu actif après le dépôt **refusé** ; profil devenu inactif **reste électeur** ; auteur exclu ; profil déjà représenté 409 ; bootstrap ; overflow. |
| **B5** | Preuve servie sans reçus et mise en cache 24 h. | (1) `finalizeBlock` écrit les **reçus AVANT le bloc** ; (2) `/api/block-proof` répond **503 + `no-store` + `Retry-After`** pour un bloc v2 sans reçus. | tests de câblage (ordre des écritures, route). |
| **C1** | Poids du mineur nul à partir de 10⁶ blocs → division par zéro ; débordement 32 bits sur microcontrôleur. | TypeScript : `minerWeight ≥ 1`, entrées négatives ou non finies ramenées à 0 bloc. C++ : `pod_miner_weight` en **64 bits**, jamais nul. | vecteurs de blocs **extrêmes** (999 999 ; 10⁶ ; 10⁷ ; 4 294 967 295) vérifiés en TS **et** en C++ ; `drawMiner` ne lève plus. |
| **C2** | `PodMetrics::begin()` acceptait une largeur > 240 : `push()` débordait le tampon de ligne. | `begin()` refuse (`bad_`), `push()` sans effet, `finish()` renvoie faux ; garde `x_ < w_`. Copies resynchronisées dans les 9 firmwares + `consensus-pod`. | test **négatif** : avec l'ancien en-tête le harnais détecte l'écrasement du tampon voisin (2 écarts) ; avec le nouveau, 0. |
| **Q1** | `reset-key` annoncé 1 GET + 1 SET mais coût réel 1 GET + 3 SET (`saveDevice`). | utilise `writeDeviceKey()` (1 commande d'écriture). | test : `writeDeviceKey`, jamais `saveDevice`. |

## Format du bloc v2 après correction (jamais miné en production)
`blockVersion, metricsVersion, rulesVersion, parentHash, imageHash, actionsHash, contentHash, deviceId, poolScreen, validatorProfileIds, scorePpm, minedAt, [animRoot], votesRoot, committeeMode, committeeK, committeeRoot, minerRoot` (ordre figé). Le noyau C++ (`pod_block_canonical_v2`, `pod_committee_root`, `pod_miner_root`) produit exactement le même texte : **1 400 vérifications** (513 lignes) contre la référence TypeScript.

## Budget
Redis, Neon, polling, cadence : **inchangés** (aucun appel de plus). `reset-key` : 1 GET + 1 SET (corrigé). Stockage : +~1,6 Ko par candidat au plus (électorat figé) ; +2 racines de 64 caractères par bloc v2. Les reçus sont écrits avant le bloc (même nombre de commandes, ordre différent).

## Validations
`npm test` **517/517** (g++ présent, 0 ignoré) ; `tsc` 0 ; `git diff --check` 0 ; compilation **arduino-cli** des **9 firmwares** (ESP8266 : 34 240 / 35 200 / 34 808 / 36 064 o de RAM statique — identiques à avant ; R4 : 19 128 / 21 500 / 22 768 / 20 864 / 21 444 o) et des 2 auto-tests du noyau. **Aucun essai sur carte.**

## Reste (non corrigé, assumé)
| # | Point |
|---|---|
| R1 | **Balise aléatoire postérieure à la soumission** (ou tirage séquentiel) : seule parade solide au grinding ; la garde empêche seulement une activation involontaire. |
| R2 | **Complétude des éligibles** : l'électorat est maintenant figé et engagé côté candidat, mais **pas dans le hash du bloc** ; une racine de Merkle de l'électorat dans le bloc permettrait de le vérifier (spec § 16, point 1). |
| R3 | **Réplication des compteurs de blocs minés** : `miner.accepted` est engagé dans le hash mais déclaré par le serveur. |
| R4 | **Premier essai sur Upstash** (script de réputation, écriture reçus → bloc, route de preuve) : à faire avant toute activation. |
| R5 | `minedBlocks` utilise `LLEN` d'une liste tronquée à 100 : le poids ne distingue plus au-delà de 100 blocs minés (comportement hérité). |
