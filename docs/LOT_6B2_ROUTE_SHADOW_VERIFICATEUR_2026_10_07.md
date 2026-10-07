# Lot 6B-2 — Route `candidate-clip` (ticket HMAC), mode `shadow`, représentants, vérificateur d'animation v3

| | |
|---|---|
| **Date** | 07/10/2026 — base `34999ba` (6B1-FIX1) |
| **Réalisateur** | Claude · **auditeur** : GPT |
| **Spécification** | `docs/SPEC_PODANIM_V3.md` (R2) ; référence `docs/LOT_6B1_REFERENCE_ANIMATION_2026_10_07.md` |
| **Statut** | **Code livré, INACTIF par défaut.** Sans `ANIM_V3_MODE=shadow` **et** sans `CLIP_TICKET_SECRET` (≥ 32 caractères), la route répond 404 sans toucher Redis et aucun comportement ne change. **Aucune variable n'est posée par ce lot** ; aucun firmware ; **aucun ticket n'est distribué** à qui que ce soit ; aucun vote d'animation v3 n'est accepté. |
| **Rollback** | variables absentes = comportement actuel (aucun redéploiement) ; `git revert` du commit (fichiers ajoutés + 3 champs optionnels). |

## 1. Livré

| Fichier | Rôle |
|---|---|
| `lib/animV3Mode.ts` | `ANIM_V3_MODE` : **`off` / `shadow` seulement**. `enforce` n'existe pas : la valeur est **ramenée à `shadow`** (avertissement journalisé par la route de dépôt) ; toute autre valeur, faute de frappe comprise, = `off`. |
| `lib/clipTicket.ts` | ticket `HMAC-SHA256(secret, "candidate-clip-v1\|candidateId\|exp")`, **commun au candidat**, `exp = ⌊candidate.expiresAt / 1000⌋` (**expiration unique dérivée du candidat**), vérification en **temps constant**, secret ≥ 32 caractères sinon route inactive ; `parseClipQuery` : **exactement `candidateId`, `exp`, `t`, dans cet ordre**, formats stricts, chaîne de requête **brute canonique** (un paramètre en plus, un autre ordre, un nom ré-encodé `%74=`, une casse différente = refus : sinon on contournerait le cache CDN) ; `clipPointer` : fonction **pure jamais appelée** par une route de distribution. |
| `lib/animClipResponse.ts` + `app/api/candidate-clip/route.ts` | `GET /api/candidate-clip?candidateId=…&exp=…&t=…`. Ordre : inactif (404) → requête (400) → ticket (403) → expiration (410) → **seulement alors UNE lecture** du candidat → 404 si autre candidat / sans clip / `exp` ≠ celui du candidat → 200 = **octets exacts du clip**, `Cache-Control: public, s-maxage=<restant ≤ 1 800 s>, immutable`, `X-Clip-Hash`, `X-Anim-Root`, `X-Clip-Frames`, `X-Metrics-Version`. Chaque exécution journalise `[candidate-clip] MISS candidate=<8 car.>`. |
| `lib/animShadow.ts` + 1 bloc de `app/api/submit-candidate/route.ts` | en `shadow`, après `setCandidate`, **une ligne de journal** (`[anim-v3] SHADOW … règle, images, E/T/R/S, affiche, framesRoot, animRoot, clipHash`). **Aucun effet** : 0 commande Redis, rien d'écrit, quorum/vote/bloc inchangés, ne lève jamais. |
| `lib/animReps.ts` | **un seul appareil représentant par profil** : plus petit `deviceId` parmi les appareils éligibles, actifs **et déclarant la capacité `anim-v3`** ; `null` au-delà de 64 profils ; `isRepresentative`. **Non branché.** Aucun firmware actuel ne déclare la capacité ⇒ liste **vide** : personne n'est représentant, personne ne reçoit de ticket. |
| `lib/podVerifyAnim.ts` + aiguillage dans `lib/podVerify.ts` | vérificateur d'un bloc **`rulesVersion = 2`** : hash recalculé avec le jeu de règles 2 et `animRoot = contentHash` ; reçus `pod-vote-v3-anim` (v = 3) signés, liés au candidat, à l'appareil, à la racine d'animation **et à la position (`parentHash` signé)** ; **échos v1 et reçus d'une autre classe EXCLUS du quorum** (avertissement) ; **pas de comité ni de mineur déterministe** ; avec le clip : `anim-clip`, `anim-frames`, `anim-root`, `anim-metrics` (E/T/R/S, nombre d'images, `scorePpm`), `anim-rule` (A1 = `ok`), `anim-poster` (si l'indice est fourni). Un bloc sans `rulesVersion` passe par le vérificateur historique ; une valeur inconnue est un **échec explicite**. |
| `lib/blockReceipts.ts`, `lib/chain.ts`, `lib/podVerify.ts` | champs **optionnels** : `Receipt.v` accepte 3, `Block.rulesVersion?`, `ProofBlock.rulesVersion?`. |

## 2. Garde-fous demandés par GPT — état
| Garde-fou | Réalisé |
|---|---|
| Ticket HMAC vérifié **avant** Redis | oui : 200 appels directs avec faux tickets = **0 lecture** (test) |
| Paramètres **exactement** `candidateId`, `exp`, `t` ; tout autre refusé avant Redis | oui, plus : **ordre et forme brute canoniques** (un seul URL par ticket) |
| Expiration unique dérivée de `candidate.expiresAt` | oui (`clipTicketExp`) ; `exp` ≠ celui du candidat = 404 |
| Route inactive sans `CLIP_TICKET_SECRET` | oui (404, 0 lecture) ; secret < 32 caractères = inactive |
| Modes `off` et `shadow` seulement | oui ; `enforce` ramené à `shadow` |
| **Aucun ticket distribué** aux firmwares actuels | oui : `pull`, `validate-candidate`, `validation-result`, `register`, `ack-frame` ne référencent ni ticket ni route (test à liste blanche) |
| Représentant parmi les appareils **déclarant `anim-v3`** | oui, la liste est vide aujourd'hui |
| Une lecture Redis **uniquement par défaut de cache**, aucun polling | oui : 1 lecture par exécution avec ticket valide, 0 sinon |

## 3. Budget Redis / Neon
| Chemin | Commandes |
|---|---|
| Tout actuel (variables absentes) | **inchangé** |
| `shadow`, dépôt d'une animation | **+0** (calcul local, journal) |
| `/api/candidate-clip` refusée (inactive, requête, ticket, expiration) | **0** |
| `/api/candidate-clip` valide | **1 lecture** du candidat courant par exécution (défaut de cache CDN) ; le 200 est immuable jusqu'à l'expiration. Borne : ≤ 64 demandeurs (électorat figé, un représentant par profil) × régions ; **non mesurée** : à lire dans les journaux (`MISS`) pendant l'essai `shadow`. |
| `getCurrentCandidate` | helper existant : il supprime lui-même un candidat expiré (comportement hérité) ; l'expiration du ticket est contrôlée avant, donc ce cas est rare. |
Neon : 0. Polling : 0.

## 4. Tests (`tests/animClip.test.ts`, `tests/podVerifyAnim.test.ts`, `tests/animV3.test.ts`)
Mode (valeurs, `enforce` impossible) · ticket (recalcul indépendant, temps constant, secrets, autres candidats/expirations) · **26 formes de requête refusées** · route : inactive, **0 lecture** pour 200 faux tickets + 9 familles de refus, 1 lecture pour une requête valide, octets exacts, en-têtes, cache borné par l'expiration, 404 `no-store` · shadow (ligne, jamais d'exception, 0 Redis, câblage, aucun effet sur vote/pull) · représentants (min `deviceId`, ineligibles écartés, > 64 → `null`, 64 max) · **vérificateur** : bloc honnête niveau `reçus` puis `contenu`, position vérifiée, jeu de règles engagé, falsifications (message, signature, racine, `parentHash`, E/T/R/S/N faux, score faux, autre clip, clip statique, reçus supprimés), **échos v1 exclus du quorum** (un bloc dont le quorum n'est atteint qu'avec eux est refusé), aucun comité ni mineur.

## 5. Décisions prises ici (à confirmer par GPT)
1. **`animRoot` du hash canonique = `contentHash`** pour un bloc animation v3 (la clé `animRoot` existante du canonique reçoit la racine v3, pas l'ancienne racine v1 qui reste dans `imageHash`) : cohérent avec la spec § 4 (A3).
2. **Valeur inconnue d'`ANIM_V3_MODE` = `off`** (et non `shadow`) : un « toute autre valeur → shadow » activerait le calcul sur une faute de frappe ; `enforce` seul est ramené à `shadow`.
3. **Ticket en clair dans l'URL** (pas de cookie, pas d'en-tête) : requis pour qu'une URL = une entrée de cache ; divulguer le ticket n'ouvre que le téléchargement d'un contenu appelé à devenir public.
4. **`CLIP_TICKET_SECRET`** : à créer **par le porteur** (≥ 32 caractères aléatoires) ; rotation = tickets en cours invalidés (30 min au plus).

## 6. Reste / limites
| # | Point |
|---|---|
| R1 | `scripts/verify-block.ts` ne récupère pas encore le **clip** d'un bloc d'animation (la CLI vérifie hash, reçus, quorum, position ; le niveau « contenu » demande le clip via `input.clip`). |
| R2 | Aucun producteur de bloc animation v3 : `finalizeBlock` n'écrit ni `rulesVersion = 2` ni reçus `v = 3` (lot 8, avec les firmwares). Le vérificateur est donc testé sur des blocs **construits par les tests**, jamais sur le réseau réel. |
| R3 | Lecture Redis `getCurrentCandidate` : **un seul candidat courant** ; deux animations successives dans les 30 min rendent le ticket du premier inutilisable (404). Comportement voulu (un ticket = un candidat courant). |
| R4 | Aucun essai sur Upstash/Vercel ; aucun essai sur carte ; mesures mémoire/temps des appareils = **6C**. |
