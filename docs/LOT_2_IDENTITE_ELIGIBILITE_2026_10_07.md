# Lot 2 — Identité et éligibilité des votants (serveur, sans reflash)

| | |
|---|---|
| **Date** | 07/10/2026 — base `93c2f97` |
| **Réalisateur** | Claude |
| **Statut** | **Code livré, ÉTEINT par défaut** (`ELIGIBILITY_MODE` absent = comportement historique **strictement inchangé**). Aucune variable Vercel modifiée, aucun déploiement, aucun firmware. |
| **Constats traités** | K3 (appareil non appairé qui vote, auteur non exclu), K4 (pool compté en appairés mais votes ouverts à tous), « vote par appareil » (audit GPT § 5.4). |
| **Non traité (volontairement)** | défi-réponse à l'enregistrement (K2) : il exige que le **firmware signe un nonce** → grand reflash ; voir « Reste ». |

## 1. Ce que fait le lot

| Fichier | Rôle |
|---|---|
| `lib/eligibility.ts` | **Fonction unique** d'éligibilité (pure) : profil d'un appareil, éligibilité (appairé, actif, ancienneté, clé si exigée, auteur), plan du pool (indépendant / bootstrap / aucun), porte de vote `voteGate`. |
| `lib/chain.ts` | `ValidationVote.profileId`, `Candidate.eligibility`, `Block.validation` (additifs) ; **comptage une voix par profil** (`countAccepts/Rejects/V2Accepts`, `countVoters`) ; un profil dont les cartes se contredisent **s'abstient**. |
| `lib/deviceStore.ts` | `getPoolSnapshot()` (même lecture que `getGlobalActiveCount`), `resetDeviceKey()`. |
| `app/api/submit-candidate` | calcule le plan ; en `enforce`, `poolSize` = nombre de **profils** éligibles. |
| `app/api/validate-candidate` | un appareil inéligible ne reçoit pas le candidat ; un profil déjà représenté reçoit `alreadyVoted`. |
| `app/api/validation-result` | **porte** avant tout vote : 403 inéligible, 409 profil déjà représenté ; le profil est estampillé dans le vote. |
| `app/api/pull` | en `enforce`, un appareil inéligible n'est plus invité à valider (évite une requête inutile par cycle). |
| `app/api/my-devices/[deviceId]/reset-key` | **récupération de clé par le propriétaire** (prérequis d'`PIN_DEVICE_KEY=true`). |
| `lib/validationWording.ts` + `BlockDetail` | libellé honnête : « Partielle — réseau trop petit » en bootstrap. |

## 2. Les trois modes (`ELIGIBILITY_MODE`)

| Mode | Effet | Usage |
|---|---|---|
| **absent / `off`** (défaut) | **aucun** : quorum, votes, pull identiques à avant | production actuelle |
| **`shadow`** | calcule le plan, **journalise** ce qui serait refusé (`[eligibility] SHADOW …`), quorum **inchangé**, aucun profil estampillé | première étape : observer sans risque |
| **`enforce`** | applique les règles ; quorum en **profils** | seulement après lecture des journaux « shadow » |

Réglages (facultatifs) : `ELIGIBILITY_MIN_AGE_HOURS` (24 ; `0` = aucune condition), `ELIGIBILITY_REQUIRE_KEY` (`true` = clé publique exigée ; défaut faux pour ne pas exclure les anciens firmwares), `ELIGIBILITY_BOOTSTRAP_BELOW` (3).
Un candidat porte le mode **au moment de son dépôt** : changer la variable ne rend pas contraignant un candidat déjà déposé en `shadow` (et un candidat antérieur à l'activation reste historique).

## 3. Règles en `enforce`
- **Éligible** = appairé (profil ou nom d'artiste) **ET** actif (< 45 min) **ET** ancien (`createdAt` ≥ 24 h) **ET** (si exigé) clé publique **ET** hors profil de l'auteur.
- **Une voix par profil** : le profil est `artistId`, sinon l'artiste implicite `esp_{deviceId}`. Cinq cartes d'un même profil = **une** voix ; deux cartes d'un profil qui se contredisent = **abstention** (indépendant de l'ordre d'arrivée).
- **Auteur exclu** : propriétaire de l'appareil qui reçoit le dessin, et artiste invité retrouvé **par son nom** (il n'existe pas d'identifiant de dessinateur : meilleure information disponible).
- **Bootstrap (étiqueté)** : sous 3 profils indépendants de l'auteur, ses propres profils sont **admis** ; sans cela un réseau d'un seul propriétaire ne pourrait plus miner. Le bloc porte `validation.plan = "bootstrap"` et l'interface affiche « **Partielle — réseau trop petit** ».
- **Aucun profil éligible** : refus (le candidat expire) — plus de vote « de dépannage » par un appareil non appairé.

## 4. Conséquence IMPORTANTE pour votre essai à 4 appareils
Si vos 4 cartes sont liées au **même profil** (`artistId`), elles comptent pour **UNE voix** en `enforce`, et le réseau est en **bootstrap** (< 3 profils indépendants) : un seul vote suffit à finaliser, étiqueté « partielle ». Si elles sont appairées **chacune par un nom différent sans profil**, ce sont 4 profils implicites distincts. **Pour tester le consensus à 4 cartes comme avant, laissez le mode `off`.** Le mode `enforce` n'a de sens qu'avec des profils réellement distincts.

## 5. Budget Redis / Neon (écrit avant le code, vérifié par test de câblage)

| Route | Avant | Après (`off`) | Après (`shadow`/`enforce`) |
|---|---|---|---|
| `submit-candidate` | `getGlobalActiveCount` : 1 SMEMBERS + 1 MGET | **identique** | `getPoolSnapshot` : 1 SMEMBERS + 1 MGET (**à sa place**, jamais en plus) |
| `validate-candidate` | 1 MGET (+ échantillon) | identique | **+0** (appareil, candidat, votes déjà lus) |
| `validation-result` | 1 MGET + 1 EVAL | identique | **+0** |
| `pull` | 1 MGET | identique | **+0** ; économise `validate-candidate` pour les appareils inéligibles |
| `reset-key` | — | 1 GET + 1 SET **sur action du propriétaire** seulement | idem |
| Stockage | — | — | +~150 o par candidat (`eligibility`), +~100 o par bloc (`validation`) |
Neon : 0. Aucun polling, aucun `SCAN`, aucun changement de cadence firmware.

## 6. Protocole d'activation proposé (à décider par le porteur)
1. **Déployer** : aucun effet (`off`).
2. **`ELIGIBILITY_MODE=shadow`** pendant quelques dessins ; lire dans les journaux Vercel les lignes `[eligibility]` : `plan=…`, `poolHistorique` vs `poolRetenu`, et les « SHADOW refuserait … raison=… ». Vérifier que **vos** appareils sont reconnus comme vous l'attendez.
3. Seulement ensuite : **`enforce`** ; retour à `off` immédiat si un problème apparaît (variable réversible, aucun état à défaire : les blocs minés gardent leur champ `validation`, additif).
4. **Ne pas activer `PIN_DEVICE_KEY`** avant d'avoir un bouton « réinitialiser la clé » dans l'interface (la route existe, **l'interface non**).

## 7. Tests (hostiles) — `tests/eligibility.test.ts` (20)
50 faux appareils non appairés (aucun profil ni voix) ; 5 cartes d'un même profil (1 voix, quorum non atteint à elles seules) ; profil trop jeune / inactif / sans clé ; bornes exactes (45 min, 24 h) ; auteur 403 ; profil déjà représenté 409 ; bootstrap (auteur admis, une seule voix) ; `shadow` ne refuse jamais et n'estampille rien ; candidat `shadow` non contraignant même si l'environnement passe en `enforce` ; contradiction entre cartes d'un profil ⇒ abstention quel que soit l'ordre ; **mode `off` identique à l'historique** (3 cartes d'un pool de 4) ; câblage des routes (aucun accès Redis ajouté, `getGlobalActiveCount` conservée en `off`) ; libellé « Partielle » ; `reset-key` (droits avant lecture, confirmation, clé seule).

## 8. Reste (non fait, à traiter)
| # | Point | Pourquoi pas ici |
|---|---|---|
| R1 | **Défi-réponse à l'enregistrement** (K2) : `register` renvoie un nonce, la carte signe | le firmware actuel ne signe pas de nonce → **grand reflash** ; la route pourra accepter une preuve **facultative** d'ici là |
| R2 | **Bouton « Réinitialiser la clé »** dans « Gérer » de la page profil | interface ; prérequis de `PIN_DEVICE_KEY=true` |
| R3 | **Ancienneté réelle d'appairage** : on utilise `createdAt` (1ʳᵉ inscription), il n'existe pas de `pairedAt` | champ à ajouter à l'appairage |
| R4 | **Sybil par profils** : créer des profils (≥ 24 h) reste possible ; parades : appairage vérifié, réputation (lot 4) | hors lot |
| R5 | **Auteur invité retrouvé par son nom** : deux artistes homonymes seraient confondus | pas d'identifiant de dessinateur |
| R6 | Interface Réseau/galerie : afficher le plan (indépendant/bootstrap) hors `BlockDetail` | confort |

## 9. Rollback
`ELIGIBILITY_MODE` absent ou `off` = comportement historique, **sans redéploiement de code**. Retour de code : `git revert` du commit du lot (fichiers additifs ; aucune migration). Les blocs/candidats déjà écrits avec les champs additifs restent lisibles par l'ancien code (ils les ignorent).

## 10. Étrangetés relevées
- Les appareils **non appairés** étaient déjà exclus du **dénominateur** du quorum (commentaire historique : éviter de bloquer le minage pendant l'appairage) mais **pas** du droit de voter : c'est le constat K4, désormais fermé en `enforce`.
- L'identifiant de profil implicite `esp_{deviceId}` fait qu'un propriétaire qui appaire ses cartes **une par une par nom** (sans profil) obtient autant de « profils » que de cartes : l'**anti-Sybil réel exige le profil** (`artistId`). À considérer au lot « réputation ».
