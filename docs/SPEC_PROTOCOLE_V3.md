# Spécification du protocole PoD v3 — BROUILLON À GELER

| | |
|---|---|
| **Statut** | **BROUILLON** (Lot 1). Rien n'est branché sur une route ni un firmware. À relire et **geler par GPT** puis par le porteur avant tout code de format dans le serveur ou les appareils. |
| **Date** | 07/10/2026 — base `831c717` |
| **Réalisateur** | Claude |
| **Référence exécutable** | `lib/podProtocolV3.ts` (pure, sans Redis ni réseau) |
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
| Rang de comité | — | `pod-committee-v3\|` |
| Graine du mineur | — | `pod-miner-v3\|` |
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

Hachage canonique : `JSON.stringify` d'un objet dont l'**ordre des clés est figé** :
```
blockVersion, metricsVersion, rulesVersion, parentHash, imageHash, actionsHash, deviceId, poolScreen,
validatorProfileIds (triés), scorePpm (ENTIER), minedAt, [animRoot], votesRoot, committeeMode, committeeK
```
- **`scorePpm` entier** (plus de flottant : une implémentation C++ ou Python doit reproduire le même texte).
- Les blocs v1 gardent leur format et leur hash ; un vérificateur choisit la règle selon `blockVersion`.
- Le bloc affiche son **niveau d'assurance** : `committeeMode` ∈ {`committee`, `bootstrap`, `none`}, `committeeK`, et le décompte accept/reject des reçus.

## 8. Éligibilité (une seule fonction partagée) [?]

Fonction unique `isEligibleVoter(device, candidate, now)`, utilisée par le **pool**, `validate-candidate` et `validation-result` (aujourd'hui incohérents : constat K4) :
- appareil **appairé** à un profil (`artistId`) ; **actif** (`lastPing` < 45 min) ; **clé publique épinglée** ;
- firmware déclarant `voteVersion ≥ 3` (v2 : « hérité », voir § 13) ;
- **ancienneté** du profil ≥ 24 h depuis l'appairage ; non blacklisté ;
- **profil ≠ profil de l'auteur** (et ≠ propriétaire de l'appareil prêté) ;
- **un vote par profil** : le premier vote valide d'un profil compte ; les autres appareils du même profil reçoivent un refus explicite (`409 profil déjà représenté`).

## 9. Comité, seuil, vagues [C]

- **Éligibles** = profils (dédoublonnés) − profil de l'auteur.
- **Rang** = `SHA-256("pod-committee-v3|" candidateId "|" parentHash "|" profileId)`, tri croissant (puis `profileId`). Imprévisible avant la publication du candidat ; rejouable par tout tiers.
- **K = min(7, n)** ; **seuil T = ⌈2K/3⌉** (K=7 → 5 ; K=3 → 2) ; tolérance de refus = **K − T**.
- **Mode** : `none` (aucun éligible : pas de bloc) ; **`bootstrap`** si n < 3 (**T = K** : tous les membres doivent approuver ; bloc étiqueté « validation partielle », jamais « validé par le réseau ») ; `committee` sinon.
- **Vague 1** = les K premiers rangs. **Vague 2** (repli séquentiel après un délai sans décision, **proposé : 10 min**, le TTL du candidat étant de 30 min) = jusqu'à **2K** premiers rangs. **Aucun vote hors fenêtre ne compte** : le coût est **borné à 2K = 14 votes** quel que soit le nombre d'appareils (testé avec 500 profils).
- **Décision** (`decide`) : `accept` ⇔ approbations ≥ T **et** refus ≤ K−T ; `reject` ⇔ refus ≥ K−T+1 ; sinon `pending`. Un bloc dont les **reçus enregistrés** ne satisfont pas ces conditions est **invalide**.
- **Le serveur est votant de référence** : il calcule hash/métriques du candidat et **ne compte pas** dans T ; il ne peut ni imposer un bloc ni en bloquer un à lui seul **[?]**.
- Limite connue : un attaquant qui crée des **profils** (pas seulement des appareils) peut « moudre » les rangs ; la parade est l'éligibilité (appairage vérifié, ancienneté 24 h, réputation), pas la cryptographie.

## 10. Mineur déterministe [C]

```
graine = SHA-256("pod-miner-v3|" candidateId "|" parentHash)
poids(profil) = ⌊ 1 000 000 / (blocsMinés + 1) ⌋          (équité conservée : poids inverse)
tirage : u = (8 premiers octets de la graine) mod Σ poids ; parcours des profils ayant APPROUVÉ, triés par profileId
```
Aucun `Math.random`, aucun horodatage (vérifié par test). Le bloc enregistre `blocsMinés` de chaque approbateur au moment du tirage (vérifiable par un nœud qui réplique la chaîne).

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

## 16. Ce que ce brouillon ne fait pas

Aucune route, aucun firmware, aucun format stocké n'est modifié ; le vote v2 et le quorum actuel fonctionnent comme avant. Les vecteurs d'or servent à **GPT** (seconde implémentation indépendante), au C++ hôte et aux firmwares du lot « noyau `consensusPoD` ».
