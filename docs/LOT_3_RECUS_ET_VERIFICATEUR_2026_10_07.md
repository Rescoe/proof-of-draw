# Lot 3 — Reçus signés dans le bloc et vérificateur public (serveur, sans reflash)

| | |
|---|---|
| **Date** | 07/10/2026 — base `0003d93` |
| **Réalisateur** | Claude |
| **Statut** | **Code livré, ÉTEINT par défaut** : sans `BLOCK_RECEIPTS=true`, `finalizeBlock` produit exactement le bloc d'avant (hash v1, aucun reçu). Aucune variable Vercel modifiée, aucun firmware. |
| **Constat traité** | K1 : les votes signés étaient supprimés après le minage ; un bloc n'était pas vérifiable hors du serveur. |
| **Non fait (voir § 7)** | PoDScan (explorateur) : reporté après la fermeture des lots 1 à 5, comme l'a décidé GPT ; liaison des votes à `parentHash` (exige le vote v3, donc le firmware) ; second vérificateur indépendant (GPT). |

## 1. Ce que fait le lot

| Fichier | Rôle |
|---|---|
| `lib/blockReceipts.ts` | **Reçus** : message exact signé (vote v2 reconstruit, ou vote hérité `appareil:candidat:score`), clé publique au moment du vote, signature ; **racine de Merkle** `votesRoot` ; `buildBlockV2` (hash et champs du bloc v2). Pur. |
| `lib/chain.ts` | `finalizeBlock(…, allVotes)` : avec `BLOCK_RECEIPTS=true`, hash v2 qui **s'engage sur tous les reçus** (acceptations ET refus) ; reçus écrits sous `chain:receipts:{hash}` dans la même rafale ; `getBlockProofData`. |
| `app/api/validation-result` | estampille la clé publique et le hash brut signé dans le vote (seulement si `BLOCK_RECEIPTS`) et transmet **tous** les votes à `finalizeBlock`. |
| `lib/podVerify.ts` | **Vérificateur public** pur : hash (v1 et v2), chaînage, racine, signatures Ed25519, liaison candidat/appareil/contenu de chaque reçu, quorum historique, validateurs, et — si l'image est fournie — hash et métriques recalculés. |
| `app/api/block-proof?hash=` | bloc (**champs immuables seulement**) + reçus, cache CDN immuable. |
| `scripts/verify-block.ts` | outil en ligne de commande : `--base <url> --hash <blockHash>` ou `--file proof.json` (hors ligne). Code de sortie 0 / 1 / 2. |
| `lib/podProtocolV3.ts` | le mode de comité transitoire `"quorum"` (règle historique) est admis dans le hash canonique v2. |

## 2. Ce que le vérificateur dit — et ne dit pas
Il ne dit **jamais** « validé » : il liste des contrôles (✔ ok · ✘ échec · ⚠ avertissement · – non vérifiable) et le **niveau atteint** :
`rien` → `chain` (hash recalculé ; le chaînage n'est annoncé que si le bloc précédent est fourni — `levelLabel`) → `receipts` (au moins un appareil a signé CE contenu pour CE candidat) → `content` (l'image fournie redonne le hash et les métriques signés).

**Il ne prouve pas** (affiché à chaque exécution) : qu'une clé publique est celle d'un **appareil réel** ; que l'ensemble des profils éligibles était **complet** ; que le **geste** est humain ; ni la **position** du vote dans la chaîne (les votes v2 déjà déployés ne signent pas `parentHash` : contrôle « ⚠ non vérifiable »).
Un **vote hérité** (écho du score du serveur) apparaît en ⚠ : sa signature ne couvre **aucun contenu**. Un bloc mêlant votes v2 et hérités vérifie, mais n'est **jamais** présenté comme entièrement recalculé (le décompte `v2 / hérités / refus` est toujours affiché).

## 3. Falsifications testées (`tests/podVerify.test.ts`, 14 tests, vraies signatures Ed25519)
Reçu modifié · clé publique remplacée · reçu supprimé ou ajouté · reçu fabriqué avec une fausse clé · **serveur malhonnête mais cohérent** (il recalcule racine et hash) qui rejoue un reçu avec un autre candidat, un autre contenu, un autre appareil, un verdict retourné ou une signature copiée · champs du bloc (score, date, parent, actions, image) · validateurs incohérents · quorum non atteint · image différente ou un octet changé · métriques signées fausses · bloc v1 modifié · CLI (code 0 / 1 / 2).

## 4. Budget Redis / Neon (écrit avant le code)

| Moment | Avant | Après (`off`) | Après (`BLOCK_RECEIPTS=true`) |
|---|---|---|---|
| Vote (`validation-result`) | 1 MGET + 1 EVAL | **identique** | identique (clé publique et hash déjà en mémoire ; +~140 o par vote dans la carte des votes) |
| Finalisation d'un bloc | ~11 commandes | **identique** | **+1 SET** (document de reçus, ≈ 1,7 Ko pour 3 votes, < 4,5 Ko pour 7) |
| Lecture d'une preuve | — | — | 1 MGET (bloc + reçus) à la 1ʳᵉ requête par bloc, puis CDN |
| Repos / pull | 0 | 0 | 0 |
Neon : 0. Aucun polling, aucun `SCAN`. Pas de reçus dans `chain:block:{hash}` : les listes de blocs (galerie) ne grossissent pas.

## 5. Activation proposée
**Prérequis : que GPT gèle les § 6 et 7 de `SPEC_PROTOCOLE_V3.md`** (racine de Merkle des reçus et hachage canonique du bloc v2) : dès qu'un bloc v2 est miné, ce format est **permanent** (un bloc n'est jamais réécrit).
1. Déployer : aucun effet.
2. `BLOCK_RECEIPTS=true` : les **nouveaux** blocs sont v2. Les anciens restent v1 (jamais réécrits).
3. Après le premier bloc : `node --import tsx scripts/verify-block.ts --base <site> --hash <blockHash>` — doit afficher le niveau « contenu » (ou « reçus » si l'image est absente) et **aucun ✘**. **Ce premier essai sur Upstash n'a pas été fait** : seuls le calcul et le vérificateur sont testés (Redis réel non exercé : l'écriture du document de reçus et le `MGET` de la route restent à constater).
4. Retour arrière : retirer la variable ; les blocs v2 déjà minés restent valides et vérifiables.

## 6. Compatibilité
Les lecteurs existants ignorent les champs additifs (`blockVersion`, `votesRoot`, `committeeK`, …). Le hash d'un bloc v2 est différent par construction (autre format canonique) : tout outil qui **recalculerait** le hash v1 d'un bloc v2 échouerait — aucun outil du dépôt ne le fait (le seul calcul est `finalizeBlock` ; le vérificateur choisit le format selon `blockVersion`).

## 7. Reste / décisions
| # | Point | Remarque |
|---|---|---|
| R1 | **PoDScan v0** (page de lecture seule) | décalé après les lots 1 à 5 (arbitrage GPT) ; la route `block-proof` et `podVerify` en seront la base |
| R2 | **Liaison à `parentHash`** | vote v3 signé par le firmware (grand reflash) ; entre-temps un reçu v2 est rejouable sur une autre position seulement si le même candidat existait — impossible (UUID unique) mais **non prouvé par la signature** |
| R3 | **Second vérificateur indépendant** (GPT) | à écrire sur les mêmes entrées ; les falsifications de `podVerify.test.ts` servent de cas |
| R4 | **Essai sur Upstash** du premier bloc v2 | à faire par le porteur après activation |
| R5 | **Ordre des reçus** | ordre canonique (profil, puis appareil) ; l'ordre des rangs du comité le remplacera (lot 4) |
| R6 | **Bouton « Vérifier ce bloc »** dans la page de détail | interface ; la route et le vérificateur sont prêts |
| R7 | **Unicité du vote par appareil dans les reçus** | la carte des votes est indexée par appareil ; en mode `enforce`, plusieurs cartes d'un profil figurent dans les reçus (le vérificateur compte les profils distincts) |

## 8. Étrangetés relevées
- Le **hash v1 d'un bloc** ne couvrait ni le contenu des votes, ni leurs signatures, ni `candidateId` : un bloc v1 est vérifiable seulement comme chaîne de hachages (niveau `chain`), jamais comme attestation.
- `validatorIds` est trié mais `votesSummary` reste **hors hash** (additif) : il ne faut pas s'y fier ; les reçus le remplacent.
- Un vote **v1 sans clé publique** (firmware ancien) est accepté tel quel en mode permissif : son « reçu » n'a aucune valeur cryptographique — le vérificateur le signale (⚠ + compté dans `signatures invalides`).
