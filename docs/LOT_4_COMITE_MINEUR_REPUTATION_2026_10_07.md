# Lot 4 — Comité, mineur déterministe, réputation (serveur, sans reflash)

| | |
|---|---|
| **Date** | 07/10/2026 — base `6fea4c6` |
| **Réalisateur** | Claude |
| **Statut** | **Code livré, ÉTEINT par défaut** : sans `COMMITTEE_MODE`, le quorum historique ⌈0,51 × électorat⌉ et le tirage aléatoire du mineur sont **strictement inchangés**. Aucune variable Vercel modifiée, aucun firmware. |
| **Dépend de** | Lot 2 (`ELIGIBILITY_MODE=enforce` : le comité tire parmi les **profils** éligibles) et Lot 3 (`BLOCK_RECEIPTS=true` : sans reçus le comité n'est pas vérifiable et le mineur ne peut pas être rejoué). |
| **Réserve MAJEURE** | **grinding** (`SIMULATION_PROTOCOLE_V3_2026_10_07.md` § 3) : la graine est calculable par l'auteur avant la soumission. **Ne pas annoncer de tolérance aux profils malhonnêtes** tant qu'une balise aléatoire postérieure à la soumission (ou un tirage séquentiel) n'existe pas : la protection réelle reste la validation par le serveur. |

## 1. Ce que fait le lot

| Fichier | Rôle |
|---|---|
| `lib/committee.ts` | plan du comité au dépôt (`CandidateCommittee`, ≤ 2K = 14 profils mémorisés), vague courante, **porte de vote** (membre de la fenêtre, vote v2 seulement), **refus objectif**, décision rejouable (`committeeOutcome`). |
| `lib/podProtocolV3.ts` | `selectCommittee(…, bootstrap)` : bootstrap forcé quand le plan d'éligibilité a dû admettre les profils de l'auteur. |
| `lib/reputation.ts` | 6 compteurs par profil (`validAccept`, `validReject`, `falseAccept`, `falseReject`, `dispute`, `timeout`) ; **une seule commande Redis** (script de `HINCRBY` dans le hash `rep:v1`) ; ne lève jamais. |
| `lib/chain.ts` | `Candidate.committee`, `ValidationVote.disputed`, `Block.miner` ; les votes « disputed » ne comptent pas ; **mineur déterministe** (`drawMiner`) sous comité « enforce » ; `castVote` expose `map` et `added`. |
| `lib/blockReceipts.ts` | reçus **dans l'ordre des rangs**, comité (rangs, K, seuil) dans le document de reçus, `committeeMode`/`K` dans le **hash** du bloc. |
| `lib/podVerify.ts` | 4 nouveaux contrôles : rangs recalculés (graine = chaîne + contenu du bloc), reçus = membres du comité (un par profil, ≤ K, ordre des rangs), **décision rejouée** (seuil ⌈2K/3⌉, règle des sièges), **mineur rejoué**. |
| `submit-candidate`, `validate-candidate`, `pull`, `validation-result` | plan au dépôt ; un non-membre n'est pas invité ; porte de vote ; décision par le comité ; refus « disputed » ; réputation à la finalisation ou au refus. |

## 2. Modes (`COMMITTEE_MODE`) et conditions
| Mode | Effet |
|---|---|
| absent / `off` | **aucun** (quorum 51 %, mineur aléatoire) |
| `shadow` | le comité est calculé et **journalisé** (`[committee] SHADOW …`, avec le quorum historique pour comparaison) ; aucun effet |
| `enforce` | **effectif seulement si** `ELIGIBILITY_MODE=enforce`, `BLOCK_RECEIPTS=true` **et** `COMMITTEE_GRINDING_ACK=true` (accusé explicite du risque de grinding, ajouté après l'audit GPT) ; sinon le plan reste en `shadow` avec un avertissement dans les journaux |

Le comité n'existe que pour une **image fixe à contenu v2** : une **animation** (vote encore v1) suit toujours le quorum historique.
Réglage : `COMMITTEE_WAVE2_MINUTES` (10 par défaut ; le TTL du candidat est de 30 min).

## 3. Règles en `enforce`
- **K = min(7, profils éligibles)**, seuil **T = ⌈2K/3⌉** (K=7 → 5 approbations, 2 refus tolérés) ; **bootstrap** (profils de l'auteur admis, réseau trop petit) : **tous** les membres doivent approuver, bloc étiqueté « partiel ».
- **Vague 1** = K premiers rangs ; **vague 2** après le délai = jusqu'à 2K, comme **suppléants** : règle des sièges (au plus K votants effectifs, par rang).
- **Seuls les votes v2 siègent** ; un vote hérité (écho du score) est refusé (409). Un profil dont les cartes se contredisent **s'abstient**.
- **Un refus ne compte que s'il est objectivement vrai** (image uniforme ou bruit pur, avec les **mêmes mesures** que la référence du serveur) ; sinon il est enregistré en « disputed » (neutre). Sans cela, 20 % de profils malhonnêtes faisaient refuser 16 à 32 % des bons dessins.
- **Décision** : accepté dès T approbations avec ≤ K−T refus ; refusé dès K−T+1 refus ; le serveur n'est **pas** un votant du comité (il valide les votes, il ne vote pas).
- **Mineur** : tirage déterministe pondéré (poids ⌊10⁶/(blocs minés+1)⌋) parmi les profils approbateurs, graine = `SHA-256(graine du comité, votesRoot)` ; le bloc enregistre `miner.accepted` (profils et nombres de blocs minés **déclarés par le serveur**, non vérifiables sans réplication de la chaîne).
- **Réputation** : un événement par vote v2 effectif jugé contre la **référence du serveur**, `dispute` pour un refus non objectif, `timeout` pour un titulaire resté **sans aucun vote**. **Aucun effet bloquant** ; taux de faux affiché seulement après 10 jugements.

## 4. Budget Redis / Neon (écrit avant le code)
| Moment | Avant | `off` | `enforce` |
|---|---|---|---|
| Dépôt du candidat | pool : 1 SMEMBERS + 1 MGET | identique | + **1 GET** (tête de chaîne pour la graine) ; +~700 o dans le candidat (≤ 14 profils) |
| Vote | 1 MGET + 1 EVAL | identique | identique (la décision se calcule sur la carte des votes renvoyée par le script) |
| `pull` / `validate-candidate` | — | identique | **+0** (candidat et appareil déjà lus) ; un non-membre n'est plus invité (économie de requêtes) |
| Finalisation | ~11 + 1 (reçus) | identique | + **1 EVAL** (réputation) ; mineur : 1 LLEN par approbateur (**comme avant**) |
| Refus du candidat par le comité | — | — | 1 EVAL (réputation) + `clearCandidate` (existant) |
Total estimé pour K = 7 : ≈ 14 (votes) + 12 + 1 + 1 ≈ **28–30 commandes par bloc**, conforme à la cible du plan (≤ 30), **à mesurer**. Neon : 0. Aucun polling, aucun `SCAN`.

## 5. Activation proposée (à décider par le porteur, après le gel de la spec par GPT)
1. Déployer : aucun effet (`off`).
2. `ELIGIBILITY_MODE=shadow` puis `COMMITTEE_MODE=shadow` : lire `[committee] SHADOW mode=… K=… rangs=[…]` et le comparer au quorum historique.
3. **Avec des profils réellement distincts** seulement : `ELIGIBILITY_MODE=enforce` + `BLOCK_RECEIPTS=true` + `COMMITTEE_MODE=enforce`. **Votre réseau de test à 4 cartes d'un seul profil sera en bootstrap (1 voix)** : gardez `off` pour tester le consensus à 4 cartes.
4. Après le premier bloc : `node --import tsx scripts/verify-block.ts --base <site> --hash <hash>` doit afficher les contrôles `committee-*` et `miner` en ✔ (**non essayé sur le réseau réel**).
5. Retour arrière : retirer la variable ; les blocs déjà minés restent valides.

## 6. Tests (`tests/committee.test.ts`, 13)
Modes et délais ; plan (K ≤ 7, 500 profils → 14 mémorisés, bootstrap forcé, aucun profil) ; porte (non-membre 403, vague 2 non ouverte 403, v1 409, off/shadow) ; refus objectif ; décision (accepter/refuser/abstention/« disputed »/hors comité/hérité/cartes jumelles) ; vague 2 et suppléants ; **hostile : 3 profils qui refusent à tort ne bloquent pas** ; réputation (événements, une commande, panne ignorée, échantillon minimal) ; **bloc de comité vérifié** (rangs, membres, décision, mineur) ; **falsifications** (rangs réordonnés, K/seuil changés, non-membre, trop peu d'approbations, mineur truqué) ; câblage et budget.

## 7. Reste / limites
| # | Point |
|---|---|
| R1 | **Grinding** (réserve majeure) : balise aléatoire publique postérieure à la soumission — décision GPT/porteur. |
| R2 | **Complétude des éligibles** non vérifiable par un tiers (un serveur pourrait omettre un profil mieux classé) : engager une racine de Merkle de l'ensemble éligible (spec § 16). |
| R3 | **`minedBlocks`** du tirage du mineur : déclarés par le serveur ; vérifiables seulement par un nœud qui réplique la chaîne. |
| R4 | **Décroissance de la réputation** et seuils d'exclusion : volontairement non faits (phase d'observation). |
| R5 | **Animations** : pas de comité tant que `pod-anim-v2` n'existe pas (lot 6). |
| R6 | **Interface** : afficher comité, vague, réputation (aujourd'hui seulement le libellé de validation du lot 2). |
| R7 | **Essai sur Upstash** du script de réputation (`HINCRBY` dans un hash) et du premier bloc de comité : à constater. |
| R8 | **`uniform`/`blank`** : le vote v2 nomme encore le motif `blank` ; la réputation et le comité le traduisent (renommage en v3). |

## 8. Rollback
`COMMITTEE_MODE` absent ou `off` = historique, sans redéploiement ; `git revert` du commit. Les champs additifs (`committee`, `disputed`, `miner`) sont ignorés par l'ancien code.
