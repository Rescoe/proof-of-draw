# REJECTED-CANDIDATE-ARCHIVE-FIX1 + audit explicite de RECEPTION-MAINTENUE (15/10/2026)

Demande de GPT (audit du 15/10/2026) : borner l'archive des rejets, supprimer la course sur `candidate:last`, rendre toutes les transitions idempotentes ; auditer la réception maintenue. Code : `lib/rejectedArchive.ts` ; tests : `tests/rejectedArchive.test.ts`, `tests/pullReception.test.ts`. Le firmware source TFT est modifié par ACK-STATE-FIX1 (commit `c4be328`), mais aucun nouveau flash n'est requis car cette version a déjà été validée matériellement (canari ACK du 15/10/2026 : `docs/mesures/TFT28_ACK_BLOC104_2026_10_15/`). `PULL_DORMANT_SEC` est inchangé.

## 1. Ce que 8a7adfe avait de faux (constats de GPT, tous exacts)
1. **Copies non bornées** : `candidate:archive:<id>` (copie COMPLÈTE avec image, sans expiration) était conservée à chaque rejet, alors que la liste `rejected:draws` est tronquée à 200 : les copies des entrées sorties de la liste restaient pour toujours.
2. **Course sur le pointeur global** : `dropArchive`/`recordRejected` supprimaient `candidate:last` sans vérifier qu'il appartenait au candidat qui se termine ; la fin tardive de A pouvait effacer le pointeur de B.
3. **Faux rejet possible** : un candidat miné dont la suppression de copie/pointeur avait échoué était, au candidat suivant, enregistré « expiré ou remplacé sans quorum ».
4. **Transitions non atomiques** (SET, SET, LPUSH, LTRIM, DEL séparés) : une panne au milieu laissait un état partiel.

## 2. Conception de FIX1
Toutes les transitions sont des **scripts Lua** (Upstash `EVAL`, déjà utilisé par le limiteur de débit et la réputation), donc atomiques côté Redis :

| Transition | Script | Effet |
|---|---|---|
| création | `CREATE_SCRIPT` | copie complète **avec TTL 90 j** + pointeur, ensemble |
| fin de vie | `FINALIZE_SCRIPT` (`mined` / `rejected` / `expired`) | `SET candidate:final:<id> <état> NX EX 90j` : **le premier état gagne pour toujours** ; seulement si ce `SET` réussit : miné ⇒ copie supprimée ; refusé/expiré ⇒ `LPUSH` de l'entrée, **suppression des copies des entrées qui sortent de la liste (`LRANGE keep -1` puis `DEL candidate:archive:<id>`) dans la même transaction**, TTL de sécurité ; le pointeur n'est supprimé **que s'il contient cet id** |
| pointeur orphelin | `CAD_SCRIPT` | compare-et-supprime par `candidateId` |

Propriétés (toutes testées) :
- **Bornes** : liste ≤ 200 entrées ; copies complètes ≤ 200 (une par entrée) + 1 (pointeur) + orphelins éventuels, **tous avec TTL 90 j** (`ARCHIVE_TTL_SEC`) ; `candidate:final:<id>` ≈ 10 o, même TTL (pas de croissance non bornée). Coût Redis : création +1 EVAL ; fin de vie +1 EVAL ; réconciliation +3 commandes, **une fois par dessin** ; rien au repos.
- **Jamais de faux rejet** : un candidat déjà `mined` ne peut plus être `rejected`/`expired` ; la réconciliation n'enregistre pas un candidat qui est encore `candidate:current`, ni un candidat dont `candidate:finalizing:<id>` (posé par `claimFinalization` avant le minage) existe.
- **Idempotence** : répéter une finalisation ne change rien (retour 0) ; une réconciliation répétée n'écrit qu'une entrée.
- **Pointeur** : jamais supprimé s'il appartient à un autre `candidateId`.
- **Panne** : un `EVAL` perdu avant exécution ne laisse rien d'appliqué (la reprise finalise une seule fois) ; création atomique : jamais une copie sans pointeur ni l'inverse ; le candidat courant (`candidate:current`) n'est jamais touché par l'archive (les appelants rattrapent toute erreur).

Hypothèses assumées : (a) Redis NON clusterisé (le script construit la clé `candidate:archive:<id>` à partir d'une entrée de liste ; vrai pour Upstash) ; (b) un `EVAL` est tout-ou-rien du point de vue du client (connexion perdue = rien ou tout appliqué, et la reprise est idempotente) ; (c) les entrées de liste écrites par 8a7adfe n'existent pas en production (non déployé).
Choix de politique : une entrée refusée de plus de 90 jours perd sa **copie complète** (son entrée dans la liste est conservée jusqu'à la 200ᵉ suivante).

## 3. Preuves
- `tests/rejectedArchive.test.ts` : **25 tests** : chaque scénario tourne contre un **miroir JavaScript** (toujours) ET contre le **vrai script Lua exécuté par fengari** (VM Lua en JS, dossier `FENGARI_DIR`, **absent du dépôt** : ces tests sont ignorés proprement s'il n'est pas installé). Couverts : plus de 200 rejets (liste ET copies bornées, chaque entrée garde sa copie, les 60 plus anciennes sont supprimées), nouveau candidat créé pendant la finalisation de l'ancien (dans les deux sens), répétition de la même finalisation, panne partielle (EVAL perdu, création et réconciliation), candidat miné jamais ajouté (y compris marqueur `mined` posé et suppression non faite), candidat expiré ajouté une seule fois, aucune suppression du pointeur d'un autre id, candidat courant / en cours de finalisation jamais déclaré perdu, câblage des routes.
- **Mutants** vérifiés contre le Lua réel : suppression des copies sorties de la liste retirée ⇒ le test de borne échoue ; suppression inconditionnelle du pointeur ⇒ le test de course échoue (et le test statique des scripts échoue dans les deux cas).
- Limite : le Lua a tourné sur un **mini-Redis de test** (GET, SET NX EX, DEL, EXISTS, LPUSH, LRANGE, LTRIM, EXPIRE) et fengari (Lua 5.3), **pas sur Upstash** (Lua 5.1 / cjson réel). Les scripts n'utilisent que `redis.call`, `cjson.decode` (sous `pcall`), `tonumber`, `ipairs`, `type`, `#` : sémantique identique en 5.1. À vérifier une fois en production avec un rejet réel (une entrée dans `rejected:draws`, la clé `candidate:final:<id>` à `rejected`).

## 4. Audit explicite de RECEPTION-MAINTENUE (2093adc)
Résultat : **conforme**, avec une réserve documentée.
- **Reçoit images et blocs** : le retour anticipé « à vide » des firmwares sans vote v2 a disparu de `/api/pull` ; `mayVote` n'apparaît que 2 fois dans la route (définition + condition d'invitation) : frames consensus/personnelles, animations et observations n'en dépendent pas (test `audit : mayVote ne conditionne QUE pendingValidation`).
- **Jamais de `pendingValidation`** : l'unique création (`pendingValidation = {`) est derrière `!alreadyVoted && !notEligible && mayVote`.
- **Ne vote pas** : `/api/validate-candidate` répond 403 `firmware-not-vote-capable` ; `/api/validation-result` passe par `voteAdmission` (firmware, v1 refusé, appairage, activité `lastPing`) avant d'enregistrer. **Ne compte pas dans le quorum** : `getGlobalActiveCount` et `getPoolSnapshot` filtrent par `participatesInVoteNetwork` (tests `voteCapability`, `pullReception`).
- **`obs-confirm` reste autorisé** pour un non-votant, comme **simple confirmation de réception** : la route n'a aucune porte de capacité, n'accède ni aux votes ni au quorum, et son seul effet est d'ajouter le `deviceId` à `revalidated[].observerIds` du bloc (`obsConfirmed` = réception confirmée, **pas** vérification : voir `lib/observationWording.ts`). Test `audit : obs-confirm …` (aucune référence à `voteAdmission`, `candidate:votes`, `poolSize`, `quorum`).
- **Réserve (préexistante, non introduite par ce lot)** : `obs-confirm` n'exige ni appairage ni signature : tout `deviceId` connu peut s'ajouter comme observateur. Sans effet sur le consensus ; à traiter dans un lot d'identité (chantier E de `docs/RESTE_A_FAIRE_2026_10_14.md`).
- Limite de la méthode : les tests de route sont des tests de **structure du code** (la route n'est pas exécutée contre Redis) ; le comportement a été observé en production pour le vote (bloc #104), pas pour un appareil non votant avec ces lots (non déployés).
