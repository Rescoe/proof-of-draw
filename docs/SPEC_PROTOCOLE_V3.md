# Spécification du protocole PoD v3 — BROUILLON À GELER

| | |
|---|---|
| **Statut** | **BROUILLON** (Lot 1). Rien n'est branché sur une route ni un firmware. À relire et **geler par GPT** puis par le porteur avant tout code de format dans le serveur ou les appareils. |
| **Date** | 07/10/2026 — base `831c717` |
| **Réalisateur** | Claude |
| **Référence exécutable** | `lib/podProtocolV3.ts` (pure, sans Redis ni réseau) |
| **Simulation (S1)** | `docs/SIMULATION_PROTOCOLE_V3_2026_10_07.md` (générée par `scripts/sim-pod-v3.ts`, reproductible) : ses résultats ont **modifié** ce brouillon (règle des sièges § 9, validation des refus § 4) et fixé une **réserve majeure** sur le grinding (§ 9, § 15). |
| **Vecteurs d'or** | `tests/fixtures/pod-v3-vectors.json` (générés par `tests/helpers/podV3Vectors.ts`, régénérables par `node --import tsx scripts/gen-pod-v3-vectors.ts`) ; `tests/podProtocolV3.test.ts` exige que le fichier commité soit **identique** à la sortie du code. |
| **Remplace** | rien : le vote v2 (`pod-vote-v2`) et les blocs v1 restent valides (§ 13). |
| **Source des décisions** | `PLAN_DE_TRAVAIL_CONSENSUS_FINAL_2026_10_06.md` (D1-D12), `PLAN_COLLABORATION_GPT_CLAUDE_POD.md`, audits GPT et Claude du 06/10. |

**Niveaux de preuve** : **[C]** vérifié par test dans ce dépôt · **[E]** estimation à mesurer · **[?]** point ouvert à trancher (§ 15).

## 1. Objectifs et non-objectifs

**Objectifs** : (1) un bloc **vérifiable hors du serveur** (reçus signés engagés dans le hash) ; (2) un vote **lié à la position dans la chaîne** (`parentHash`) ; (3) un motif de refus **signé** et des règles **versionnées** ; (4) un comité **déterministe et rejouable**, un vote par **profil**, auteur exclu ; (5) un mineur **rejouable** ; (6) des événements de réputation **uniquement démontrables** ; (7) le tout **borné en coût** (≤ 2K votes par candidat).

**Non-objectifs** : pas de PoW ; pas de VRF (piste ultérieure) ; pas de réplication multi-serveurs (lot « nœuds ») ; pas de jugement esthétique ; pas de réécriture des blocs existants.

## 2. Versions et domaine

| Objet | Version | Préfixe de domaine |
|---|---|---|
| Message de vote | **3** | `pod-vote-v3` (un vote v2 ne peut pas être rejoué comme v3 : préfixe différent) |
| Métriques | **2** (inchangées : `pod-metrics-2`) | — |
| Règles | **1** | — |
| Bloc | **2** | — |
| Nonce | — | `pod-nonce-v3\|` |
| Graine du comité | — | `pod-committee-seed-v3\|` (parentHash, contentHash) |
| Rang de comité | — | `pod-committee-v3\|` (graine, profileId) |
| Graine du mineur | — | `pod-miner-v3\|` (graine du comité, votesRoot) |
| Merkle | — | octets `0x00` (feuille) / `0x01` (nœud) ; vide : `pod-merkle-v3-empty` |

Tout changement d'un de ces éléments incrémente sa version et **régénère les vecteurs** (changement volontaire, visible dans le diff).

## 3. Message de vote v3 [C]

```
pod-vote-v3|deviceId|candidateId|parentHash|metricsVersion|rulesVersion|rawHash|saltedHash|e|t|r|verdict|ruleCode|vclass
```
- 14 champs séparés par `|` ; entiers en décimal **canonique** (pas de zéro en tête, 0…1 000 000 pour e/t/r) ; hashes en hexadécimal **minuscule** de 64 caractères ; `deviceId` = `dev_` + 8 caractères `[A-Z0-9]` ; `candidateId` = UUID minuscule.
- `verdict` ∈ {`accept`, `reject`} ; `ruleCode` ∈ {`ok`, `hash`, `metrics`, `uniform`, `noise`, `format`, `rules`} ; **`accept` ⇔ `ok`** ; `vclass` ∈ {`C0`, `C1`, `C2`}.
- La **signature** Ed25519 (64 octets, 128 caractères hex) porte sur l'UTF-8 du message. Elle est **obligatoire** (aucun mode permissif en v3).
- Lecture : `parseVoteMessageV3` n'accepte **que** la forme canonique (le message reconstruit doit être identique).
- **Nouveautés vs v2** : `parentHash` (position), `rulesVersion`, `saltedHash` (§ 5), **`ruleCode` signé** (le motif n'était pas signé en v2 : constat K14), `vclass`.
- Le serveur vérifie la signature avec `verifyEd25519` (`lib/ed25519.ts`) : **compatibilité prouvée par test** [C].

## 4. Règles N2 (rulesVersion 1) [C]

`evaluateRules({formatOk, hashOk, e, t})`, ordre **figé** :
1. `format` si la taille/le format du contenu est invalide ;
2. `hash` si le SHA-256 recalculé diffère de l'annonce ;
3. **`uniform`** si `e = 0` **et** `t = 0` (image toute blanche **ou toute pleine** ; remplace le motif v2 `blank`) ;
4. **`noise`** si `e > 980 000` **et** `t > 900 000` (bornes strictes) ;
5. sinon `ok`.

**Le serveur valide aussi les REFUS (résultat du simulateur, modèle M1b)** : un `reject` n'est compté que si son motif objectif est **vrai pour le contenu connu du serveur** (`uniform`, `noise`). Un refus au motif faux est **invalide** (il ne compte pas : équivalent à un silence) et alimente la réputation (`falseReject`) ; un refus `hash` dont le hash signé diffère de la référence est un `dispute` : **il n'est pas compté pour bloquer** (le contenu est immuable et servi en TLS : une vraie divergence est quasi impossible). Sans cette validation, 20 % de profils malhonnêtes faisaient refuser **16 à 32 %** des bons contenus (SIMULATION § 1) ; avec, **0 %**. Conséquence assumée : un refus du comité n'ajoute pas de jugement au serveur, il **corrobore** ; un contenu objectivement mauvais est de toute façon déjà refusé à l'admission.

Aucune règle esthétique. **Le serveur réapplique exactement cette fonction** : un `accept` dont les valeurs signées violent une règle est **invalide** (constat K15). Les seuils de qualité informatifs (durée, traits, couverture) ne sont **pas** des règles N2.

## 5. Hash salé par appareil (preuve de lecture) [C]

```
nonce      = SHA-256("pod-nonce-v3|" candidateId "|" parentHash "|" deviceId)      (32 octets)
saltedHash = SHA-256( nonce ‖ contenuBrut )                                         (hex minuscule)
```
Un appareil ne peut pas recopier la réponse d'un autre (le nonce contient son `deviceId`) ni répondre sans avoir lu **tout** le contenu. Coût appareil : un second contexte SHA-256 (~100 octets de RAM) calculé **dans la même lecture en flux** ; coût serveur : un SHA-256 du contenu par vote (≤ 153,6 Ko × ≤ 14 votes ≈ 2 Mo hachés par candidat) [E].
**Limite assumée** : le contenu est public ; un PC qui connaît la clé reste capable de produire ce hash (pas de preuve « fait sur un microcontrôleur »). Il détecte les paresseux et les copies, pas les attaquants dotés d'un PC.

## 6. Reçus et racine de Merkle (`votesRoot`) [C]

```
feuille = SHA-256( 0x00 ‖ UTF-8( message "|" signatureHex "|" clePubliqueHex ) )
nœud    = SHA-256( 0x01 ‖ gauche ‖ droite )          nœud impair : PROMU tel quel (aucune duplication)
vide    = SHA-256("pod-merkle-v3-empty")
```
- Ordre des feuilles = **ordre des rangs du comité** (déterministe). La racine est **incluse dans le `blockHash`** (§ 7).
- Le bloc **stocke les reçus complets** (`votes[]` : profil, appareil, clé publique, message, signature) : ≈ 130 octets de signature+clé + ≈ 250 octets de message par vote, **≈ 2,7 Ko pour K = 7** [E], dans le **même `SET`** que le bloc (aucune commande de plus).
- Preuve d'inclusion (`merkleProof` / `verifyMerkleProof`) : testée pour 1 à 9 feuilles ; refusée si feuille, racine ou côté changent. Pas de duplication du dernier nœud : `[a,b,c] ≠ [a,b,c,c]`.

## 7. Bloc v2 [C]

> **Transition (Lot 3, 07/10/2026)** : le bloc v2 est **déjà produit** par `finalizeBlock` quand `BLOCK_RECEIPTS=true` (éteint par défaut), avec les votes **v2 actuels** (`pod-vote-v2`) et le mode de décision `committeeMode = "quorum"` (⌈0,51 × électorat⌉, `committeeK` = taille de l'électorat) — le comité (lot 4) le remplacera. Les reçus vivent dans `chain:receipts:{blockHash}` ; le hash s'engage sur leur racine. Le vérificateur est `lib/podVerify.ts` (CLI `scripts/verify-block.ts`, route `/api/block-proof`). Les votes v2 ne signent pas `parentHash` : le contrôle de **position** reste « non vérifiable » jusqu'au vote v3. Détails : `docs/LOT_3_RECUS_ET_VERIFICATEUR_2026_10_07.md`.

Hachage canonique : `JSON.stringify` d'un objet dont l'**ordre des clés est figé** :
```
blockVersion, metricsVersion, rulesVersion, parentHash, imageHash, actionsHash, contentHash, deviceId, poolScreen,
validatorProfileIds (triés), scorePpm (ENTIER), minedAt, [animRoot], votesRoot, committeeMode, committeeK
```
- **`scorePpm` entier** (plus de flottant : une implémentation C++ ou Python doit reproduire le même texte).
- **`contentHash`** (`rawHash` ou `animRoot`) est **dans le bloc** pour qu'un tiers recalcule la graine du comité et celle du mineur sans accès au serveur.
- Les blocs v1 gardent leur format et leur hash ; un vérificateur choisit la règle selon `blockVersion`.
- Le bloc affiche son **niveau d'assurance** : `committeeMode` ∈ {`committee`, `bootstrap`, `none`}, `committeeK`, et le décompte accept/reject des reçus.

> **Transition (Lot 4, 07/10/2026)** : le comité, la règle des sièges, le refus objectif, le mineur déterministe et la réputation sont **implémentés côté serveur** derrière `COMMITTEE_MODE` (éteint par défaut) — `docs/LOT_4_COMITE_MINEUR_REPUTATION_2026_10_07.md`. Le **vote v2 actuel** siège (le vote v3 n'existe pas encore côté firmware) ; le bloc de comité porte `committeeMode` ∈ {`committee`, `bootstrap`} et `committeeK` dans son hash ; les rangs, le comité et le tirage du mineur sont **rejoués** par `lib/podVerify.ts`. La **réserve sur le grinding** (§ 9) reste entière.

> **Transition (Lot 5, 07/10/2026)** : les calculs de ce protocole existent aussi en **C++ portable** (`consensus-pod/src/consensusPoD.h`, règles, hash salé, message de vote v3, Merkle, graine/rang, sièges, mineur, bloc v2 canonique) et sont **vérifiés bit à bit** contre `lib/podProtocolV3.ts` (1 327 vérifications, `tests/consensusPodCore.test.ts`). Aucun firmware ne l'utilise encore. `docs/LOT_5_NOYAU_CONSENSUSPOD_2026_10_07.md`.

## 8. Éligibilité (une seule fonction partagée) [?]

Fonction unique `isEligibleVoter(device, candidate, now)`, utilisée par le **pool**, `validate-candidate` et `validation-result` (aujourd'hui incohérents : constat K4) :
- appareil **appairé** à un profil (`artistId`) ; **actif** (`lastPing` < 45 min) ; **clé publique épinglée** ;
- firmware déclarant `voteVersion ≥ 3` (v2 : « hérité », voir § 13) ;
- **ancienneté** du profil ≥ 24 h depuis l'appairage ; non blacklisté ;
- **profil ≠ profil de l'auteur** (et ≠ propriétaire de l'appareil prêté) ;
- **un vote par profil** : le premier vote valide d'un profil compte ; les autres appareils du même profil reçoivent un refus explicite (`409 profil déjà représenté`).

## 9. Comité, seuil, vagues [C]

- **Éligibles** = profils (dédoublonnés) − profil de l'auteur.
- **Graine** = `SHA-256("pod-committee-seed-v3|" parentHash "|" contentHash)` où `contentHash` = `rawHash` (image fixe) ou `animRoot` (animation) ; **rang** = `SHA-256("pod-committee-v3|" graine "|" profileId)`, tri croissant (puis `profileId`). **La graine ne dépend ni du `candidateId` (UUID que le serveur choisit : il aurait pu en essayer plusieurs) ni d'un horodatage** (correction demandée par GPT) : elle dérive de la **chaîne** et du **contenu** que les appareils recalculent ; tout tiers qui a le bloc précédent et l'image la retrouve (test : aucune des fonctions de graine ne mentionne `candidateId`) [C].
- **Grinding de l'auteur (limite assumée)** : l'auteur peut modifier quelques pixels pour changer la graine et donc le comité. Il est **exclu du comité**, ne connaît pas d'avance quels profils éligibles sont complices, et chaque essai coûte un dessin ; la parade est l'**éligibilité** (appairage vérifié, ancienneté 24 h, réputation), pas la cryptographie. Une balise aléatoire publique externe (type drand) fermerait cette porte mais ajoute une dépendance réseau : **[?] point ouvert**.
- **K = min(7, n)** ; **seuil T = ⌈2K/3⌉** (K=7 → 5 ; K=3 → 2) ; tolérance de refus = **K − T**.
- **Mode** : `none` (aucun éligible : pas de bloc) ; **`bootstrap`** si n < 3 (**T = K** : tous les membres doivent approuver ; bloc étiqueté « validation partielle », jamais « validé par le réseau ») ; `committee` sinon.
- **Vague 1** = les K premiers rangs. **Vague 2** (repli séquentiel après un délai sans décision, **proposé : 10 min**, le TTL du candidat étant de 30 min) = jusqu'à **2K** premiers rangs **comme suppléants** : **règle des sièges** — parmi les votants, seuls les **K premiers rangs** comptent (`effectiveVoters`), l'électorat effectif ne grossit jamais. (Première version : tous les votants de la fenêtre comptaient avec la même tolérance de refus ; le simulateur a montré que cela **doublait** la nuisance des refus malveillants.) **Aucun vote hors fenêtre ne compte** : le coût est **borné à 2K = 14 votes** quel que soit le nombre d'appareils (testé avec 500 profils).
- **Décision** (`decide`) : `accept` ⇔ approbations ≥ T **et** refus ≤ K−T ; `reject` ⇔ refus ≥ K−T+1 ; sinon `pending`. Un bloc dont les **reçus enregistrés** ne satisfont pas ces conditions est **invalide**. **Les reçus d'un bloc sont exactement les votants effectifs** (≤ K, dans l'ordre des rangs) ; un vote reçu après la finalisation est ignoré.
- **RÉSERVE MAJEURE — grinding (SIMULATION § 3)** : la graine (chaîne + contenu) est **calculable par l'auteur avant la soumission** ; avec 20 % de profils éligibles complices, **28 %** de réussite pour choisir son comité avec 100 variantes de l'image et **93 %** avec 1 000 (n = 50). **Tant qu'une balise aléatoire postérieure à la soumission (ou un tirage séquentiel) n'existe pas, le comité ne peut pas être présenté comme résistant aux profils malhonnêtes** : la protection réelle reste la validation par le serveur (M1b). Recommandation : balise publique type drand dans la graine (point ouvert 10).
- **Le serveur est votant de référence** : il calcule hash/métriques du candidat et **ne compte pas** dans T ; il ne peut ni imposer un bloc ni en bloquer un à lui seul **[?]**.
- Limite connue : un attaquant qui crée des **profils** (pas seulement des appareils) peut « moudre » les rangs ; la parade est l'éligibilité (appairage vérifié, ancienneté 24 h, réputation), pas la cryptographie.

## 10. Mineur déterministe [C]

```
graine = SHA-256("pod-miner-v3|" graineDuComité "|" votesRoot)     — dépend des REÇUS finalisés
poids(profil) = ⌊ 1 000 000 / (blocsMinés + 1) ⌋          (équité conservée : poids inverse)
tirage : u = (8 premiers octets de la graine) mod Σ poids ; parcours des profils ayant APPROUVÉ, triés par profileId
```
Aucun `Math.random`, aucun horodatage (vérifié par test). La graine inclut `votesRoot` : ni le serveur ni l'auteur ne peuvent viser un mineur avant que les votes existent [C]. Le bloc enregistre `blocsMinés` de chaque approbateur au moment du tirage (vérifiable par un nœud qui réplique la chaîne).

## 11. Réputation (événements démontrables uniquement) [C]

`classifyVote(vote, référence)` ∈ {`validAccept`, `validReject`, `falseAccept`, `falseReject`, `dispute`} :
- `accept` conforme (hash, e/t/r, règles) → `validAccept` ; sinon `falseAccept` (la signature atteste une valeur fausse).
- `reject` dont le motif est **vrai pour la référence** → `validReject`.
- `reject` dont les valeurs **signées par l'appareil lui-même infirment son motif** (ex. `hash` en signant le même hash que la référence ; `uniform` avec les mêmes mesures non uniformes) → `falseReject`.
- Tout désaccord **cohérent en interne** (autre hash signé, autres mesures) → **`dispute`, neutre, aucune pénalité** (contenu corrompu, CDN périmé…).
- `invalidSignature` et `timeout` sont comptés **séparément** par le serveur ; **jamais** « minoritaire ⇒ menteur ».
Agrégation **une seule fois à la finalisation** (un script Redis), échantillon minimal, décroissance dans le temps ; **aucun effet bloquant** avant une phase d'observation.

## 12. Classes de calcul (D3)

`vclass` : **C0** (ESP8266 : noyau obligatoire), **C1** (R4 : même noyau + contrôles supplémentaires), **C2** (hôte/Raspberry/navigateur : replay). **La puissance ne donne aucun poids de vote supplémentaire** : elle ajoute des attestations. Un comité peut exiger au moins une attestation C1/C2 **[?]**.

## 13. Compatibilité et transition

| Phase | Vote v2 | Vote v3 | Comité | Rejets |
|---|---|---|---|---|
| **T0 (aujourd'hui)** | accepté, compté | inconnu | quorum 51 % des appairés actifs | non bloquants |
| **T1 « ombre »** | accepté | accepté et stocké | calculé et **journalisé**, non contraignant | non bloquants |
| **T2** | « hérité » : compté seulement hors comité | requis pour le comité (appareils `voteVersion ≥ 3`) | contraignant | bloquants (comité ≥ v3) |
| **T3 strict** | refusé | seul accepté | contraignant | bloquants |
Chaque phase est pilotée par une variable d'environnement **réversible** ; un ancien appareil reste afficheur. Les blocs v1/v2 ne sont jamais réécrits.

## 14. Budget Redis (estimation à mesurer [E])

Cible : **≤ 30 commandes par bloc pour K = 7** (pire cas vague 2 : ≈ 41).
| Étape | Commandes |
|---|---|
| Soumission : liste des profils éligibles + écriture du comité dans le candidat | +1 lecture groupée, +0 écriture (même `SET` du candidat) |
| Chaque vote (MGET existant + script de vote existant) | 2 × K = 14 |
| Finalisation : bloc **avec reçus** (même `SET`), index, notifications (existant) | ≈ 12 |
| Réputation (un script, à la finalisation) | +1 |
Total ≈ 28. Aucun polling, aucun `SCAN` ; contenu et preuves servis par le CDN ; comité borné à 2K. Fixtures locales 1/5/20/100/500 pour les simulations.

## 15. Points ouverts pour GPT / le porteur

1. **Vague 2** : délai (10 min proposé) et si le serveur déclenche la vague 2 par le prochain `pull` d'un membre ou par la 1ʳᵉ requête après expiration (sans cron).
2. **Rôle du serveur** : votant de référence non comptant (proposé) ou membre à part entière.
3. **Bootstrap** : seuil de 3 profils, T = K ; que fait-on avec **un seul** profil éligible non-auteur (mode `none` = pas de bloc, ou bloc `bootstrap` T = 1) ?
4. **Grinding de profils** : exiger un appairage « vérifié » (au-delà d'un simple nom d'artiste) avant d'être éligible.
5. **Profil représenté par quel appareil** : le premier qui vote (proposé) ou le plus ancien ?
6. **`vclass` exigée** : au moins une attestation C1/C2 par comité ?
7. **Stockage des reçus** : +2,7 Ko par bloc dans Redis (blocs permanents) : acceptable vis-à-vis du stockage Upstash, ou reçus sur stockage froid avec seule racine dans Redis ?
8. **Migration du type `Block`** : champs additifs `blockVersion`, `votes`, `votesRoot` (le code de lecture actuel les ignore).
9. **Nom du motif** : `uniform` (proposé) remplace `blank` **uniquement** en v3.
10. **Grinding de l'auteur** : **recommandation du simulateur : balise aléatoire publique postérieure à la soumission (drand) incluse dans la graine** — vérifiable par tout tiers, une requête par candidat (0 commande Redis, valeur stockée dans le candidat) ; alternative : tirage séquentiel. Sinon, **ne pas annoncer** de tolérance aux profils malhonnêtes (§ 9).
11. **Ensemble éligible** : engager une racine de Merkle de l'instantané des profils éligibles dans le bloc (§ 16, point 1) ?
12. **v3 = v2 pour le quorum pendant E2** : valider que le serveur traite un vote v3 conforme comme un vote v2 conforme (§ 18).

## 16. Ce qui est vérifiable par un tiers — avant et après la v3

« Vérifiable » = un tiers qui dispose du bloc, de l'image et des actions peut le contrôler **sans faire confiance au serveur**.

| Propriété | Blocs v1 (historique) | Aujourd'hui (vote v2, bloc v1) | Bloc v2 (v3) |
|---|---|---|---|
| Chaînage `parentHash` → `blockHash` | ✔ recalculable | ✔ | ✔ |
| `imageHash` correspond à l'image | ✔ | ✔ | ✔ (+ `contentHash`) |
| `actionsHash` correspond aux actions ; le **replay** redonne l'image | ✔ (moteur pur ; vérification du geste N3 par n'importe qui, pas par le réseau) | ✔ | ✔ |
| **Qui** a validé | ✘ identifiants non signés | ✘ identifiants + simple décompte (`votesSummary`, hors hash) | ✔ **reçus signés**, engagés dans `votesRoot` |
| Le contenu de chaque vote (hash, e/t/r, verdict, motif) | ✘ | ✘ (supprimés après le minage) | ✔ |
| Le **quorum** a bien été atteint | ✘ | ✘ | ✔ (rejouable depuis les reçus : seuil ⌈2K/3⌉, refus ≤ K−T) |
| Le comité et le **mineur** ont été tirés selon la règle | ✘ (`Math.random` serveur) | ✘ | ✔ (graine = chaîne + contenu + reçus) |
| Un vote n'a pas été **rejoué** sur une autre position | — | ✘ | ✔ (`parentHash` signé) |
| Le motif d'un refus n'a pas été **modifié** | — | ✘ | ✔ (`ruleCode` signé) |

**Reste CENTRALISÉ même après la v3 (à dire publiquement)** :
1. **L'ensemble des profils éligibles** : le serveur atteste la liste ; un tiers vérifie que les membres du comité sont **cohérents entre eux** (rangs) mais pas qu'**aucun meilleur rang n'a été omis**. Piste : engager une racine de Merkle de l'ensemble éligible (instantané) dans le bloc **[?]**.
2. **L'identité** : une clé publique n'est pas la preuve d'un appareil réel (aucun élément sécurisé sur ces cartes) ; elle est liée à un profil appairé, c'est tout.
3. **L'ordre des blocs et la disponibilité** : un seul registre ; un serveur peut refuser d'écrire ou **omettre** un bloc (il ne peut pas en falsifier un sans les clés de 2/3 du comité). Réponse : ancrage externe et nœuds miroirs (lots ultérieurs).
4. **Le geste** : N3 reste refaisable par un tiers mais **pas attesté par le réseau**.

Tant que ces quatre points ne sont pas traités, la formulation reste : « chaîne **centralisée** liée par hachage, avec attestations distribuées **signées et vérifiables** » (R5 du plan de collaboration).

## 17. Simulation : ordre simulateur / nœud hôte

Le plan initial faisait dépendre le simulateur du nœud hôte (`podnode`). **Décision proposée** : deux niveaux, dans cet ordre.
- **S1 — simulateur en mémoire** (TypeScript, Lot « comité ») : n profils/appareils simulés appelant directement `lib/podProtocolV3.ts` (comité, vote, décision, reçus, mineur, réputation), avec une fraction f de comportements malhonnêtes (hash faux, métriques fausses, clones, silence, double vote, auteur votant) et des tailles 3/10/100/500. **Sans réseau, sans Redis, sans nœud hôte** : il produit les **vrais chiffres** de tolérance et de coût (nombre de votes comptés ≤ 2K) avant tout reflash.
- **S2 — nœud hôte `podnode`** (Lot « noyau ») : même protocole, **bout en bout** contre un serveur de test ; sert de test de **non-régression** et de validateur sans écran. Il ne bloque pas S1.
Conséquence : aucune dépendance du Lot « comité » envers le Lot « noyau ».

## 18. Déploiement du firmware v3 par étapes canari

Contraintes : **un seul grand reflash** (plan, lot 8), mémoire ESP8266 serrée (pas de double requête TLS), retour arrière par la sauvegarde `firmware-backups/` et par variables serveur.

| Étape | Qui | Serveur | Condition de passage |
|---|---|---|---|
| **E0** | personne | T0 (vote v2) | spécification gelée, vecteurs passants sur TypeScript, C++ hôte et **seconde implémentation (GPT)** |
| **E1 « ombre serveur »** | personne | **T1** : accepte et stocke les votes v3 reçus ; comité **calculé et journalisé**, non contraignant | simulateur S1 concluant ; budget Redis mesuré |
| **E2 canari carte** | porteur : **une carte par famille** (jusqu'à 9 variantes), flashée par câble | le serveur accepte un vote **v3 comme équivalent d'un vote v2** pour le quorum (mêmes hash et métriques vérifiés **exactement**) : **aucune double requête** de la carte | trace archivée par carte ; `[HEAP] après WiFi` ≥ 38 Ko ; aucun 4xx sur ses votes pendant 24 h |
| **E3 famille** | porteur : toutes les cartes d'une famille | idem | idem sur 48 h ; aucune régression d'affichage |
| **E4 comité** | — | **T2** : le comité v3 devient contraignant **pour les appareils `voteVersion ≥ 3`** ; les v2 votent « hérité » (hors comité) ; rejets bloquants | au moins 3 profils éligibles v3 non-auteurs, sinon `bootstrap` étiqueté |
| **E5 strict** | porteur | **T3** : v2 refusé | tout le parc compatible ; décision explicite du porteur |
Chaque étape est **réversible** par une variable d'environnement (retour à l'étape précédente sans reflash) ; le retour **matériel** se fait par réflashage de la sauvegarde. Aucune étape n'est automatisée ; l'OTA n'intervient qu'après le premier reflash universel (lot 8) et ne s'applique pas à E2.

## 19. Ce que ce brouillon ne fait pas

Aucune route, aucun firmware, aucun format stocké n'est modifié ; le vote v2 et le quorum actuel fonctionnent comme avant. Les vecteurs d'or servent à **GPT** (seconde implémentation indépendante), au C++ hôte et aux firmwares du lot « noyau `consensusPoD` ».
