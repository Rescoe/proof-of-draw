# Phase « backend Preview isolé » du vote unique TFT 2,8″ — protocole (révision du 14/10/2026 après l'audit de `4e6f548`)

Suite de `docs/CANARY_R4_TFT28_AFFICHAGE_FIX2_VERDICT_2026_10_14.md` (transport revalidé, VERT). **Préparation seulement : aucun flash, aucun vote, aucun déploiement.** Compléments : `docs/PROTOCOLE_ISOLATION_ET_VERROU_VOTE_TFT28_2026_10_14.md` (preuves d'isolation, `pod_vote_pins.h`, `VoteLockErase`) et `docs/LOT_TFT28_PREVIEW_ENROLL_1_2026_10_14.md` (build d'appairage).

## 0. Décisions de l'audit (14/10/2026)
- **Option B′ REFUSÉE telle qu'écrite** : elle était **circulaire**. Elle exigeait un vrai candidat pour compiler le premier binaire, or `/api/draw` exige que la session possède l'appareil ; l'appareil doit donc être appairé **avant** de pouvoir créer normalement un candidat.
- **Option retenue** : un **mini-firmware d'appairage Preview**, sans écran et sans vote (`POD_PREVIEW_ENROLL`, lot `TFT28-PREVIEW-ENROLL-1`).
- `STRICT_SIGNATURE=true` : **accepté**. `CANDIDATE_TTL_SEC=7200` : **accepté, Preview seulement**.
- Captures Vercel / Upstash : **faites par le porteur** ; auditées par Claude et par GPT.

## 1. Ordre sûr (chaque étape exige la précédente ; aucune n'est exécutée par Claude)
1. **Prouver l'isolation Preview / Redis** (§ 3 et protocole d'isolation § 1 à 4).
2. **Flasher le mini-firmware d'appairage** (`POD_PREVIEW_ENROLL = 1`, hôte Preview dans le fichier local `pod_preview_host.h`).
3. **Récupérer le `pairCode`** (journal série) **et appairer sur Preview** (`https://<hôte Preview>/onboard?code=…`, avec un profil Preview). Reflasher le binaire stable.
4. **Créer le candidat depuis Preview** (§ 5).
5. **Relever son identifiant et son hash** (§ 5).
6. **Compiler le vrai canari de vote** (`pod_vote_pins.h`, § 6).
7. **Vérifier le verrou vierge** (`VoteLockErase`, § 7).
8. **Obtenir l'autorisation finale** (GPT / Codex et porteur).
9. **Effectuer le vote unique.**

## 2. Constats issus du code
1. **Redis = deux variables : `KV_REST_API_URL` et `KV_REST_API_TOKEN`** (`lib/redis.ts`). **Neon n'est utilisé nulle part dans `lib/` ni `app/`.**
2. **Le build de vote ne montre ni ne journalise le code d'appairage** ; sur un Preview neuf, `register` crée une fiche **non appairée** (clé = adresse MAC) et le canari de vote s'arrête avant tout pull, tout verrou, tout vote. D'où le mini-firmware d'appairage, qui **journalise** `deviceId` et `pairCode`.
3. **`candidate:current` est une clé unique et globale**, **TTL `CANDIDATE_TTL_SEC`** (1 800 s par défaut). Les épingles doivent être connues **à la compilation** : le candidat doit exister avant de compiler et rester valable jusqu'au pull de la carte.
4. Quorum : `poolSize` = `max(1, profils actifs)` ; avec `ELIGIBILITY_MODE` et `COMMITTEE_MODE` à `off` (défauts), un seul appareil actif ⇒ quorum de 1 ⇒ **le vote mine un bloc dans CE backend**.
5. **Appels internes entre routes (faille d'isolation possible)** : `/api/draw` appelle `${base}/api/submit-candidate` (`app/api/draw/route.ts`, `getBaseUrl`), et `/api/validation-result` appelle `${base}/api/submit-candidate` pour traiter la file d'attente (`app/api/validation-result/route.ts`). **Dans les deux cas `base` = `NEXT_PUBLIC_BASE_URL` s'il est défini, sinon l'hôte courant.** Si cette variable Preview pointe vers la production, un dessin ou la file d'attente du vote peut appeler la **mauvaise** production. Deux détails : une valeur **vide** n'est **pas** « absente » (dans `validation-result` elle donne une base vide et un appel qui échoue) ; et comme le nom commence par `NEXT_PUBLIC_`, Next.js peut **l'inliner au build** : toute modification exige un **redéploiement**. Seconde protection : ces appels portent `x-internal-secret` = `INTERNAL_API_SECRET` ; avec un secret **propre** à Preview, un appel mal dirigé vers la production serait refusé.

## 3. Variables critiques à relever et fixer sur le déploiement Preview
| Variable | Valeur exigée | Pourquoi |
|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | **propres à Preview** | isolation Redis ; jamais « All Environments » |
| **`NEXT_PUBLIC_BASE_URL`** | **ABSENTE** (hôte courant) **ou égale exactement à l'URL du déploiement Preview**, jamais à la production, **jamais vide** | appels internes `/api/draw` → `submit-candidate` et `/api/validation-result` → `submit-candidate` (§ 2.5) |
| `INTERNAL_API_SECRET` | **propre à Preview** | protège ces appels internes |
| `SESSION_SECRET`, `NETWORK_ID_SECRET`, `CLIP_TICKET_SECRET`, `PIN_DEVICE_KEY` | **propres à Preview** | aucun cookie ni jeton valable d'un environnement à l'autre |
| `ELIGIBILITY_MODE`, `COMMITTEE_MODE` | `off` (défauts) ; `BLOCK_RECEIPTS` non défini | quorum de 1 |
| `ANIM_V3_MODE` | `off` | aucune animation |
| `BYPASS_VALIDATION` | **non défini** | le vote doit être réellement compté |
| **`STRICT_SIGNATURE`** | **`true`** (accepté) | rend le critère « signature valide » vérifiable ; un refus consommerait l'unique tentative |
| **`CANDIDATE_TTL_SEC`** | **`7200`, Preview seulement** (accepté) | temps de compiler et de flasher |
| `ENFORCE_V2_REJECTIONS`, `MIN_V2_APPROVALS` | défauts (`false`, `0`) | ne pas durcir ce premier test |
| `ANA_ART_FEED_SECRET`, `ANA_API_URL` | non définis ou propres | pas d'import du flux externe |
Toute variable modifiée exige un **redéploiement**, puis un nouveau relevé. **Vérification des appels internes** : après le déploiement, constater dans les journaux Preview (Vercel → Logs) qu'un dessin de test (ou la soumission du candidat, § 5) n'apparaît que dans les journaux du déploiement Preview, jamais dans ceux de la production.

## 4. Portes (preuves exigées, captures datées faites par le porteur)
| # | Porte | Preuve |
|---|---|---|
| G0 | Audit de ce protocole et du lot d'appairage | acceptation écrite |
| G1 | Déploiement Preview dédié | identifiant, environnement = Preview, branche |
| G2 | Isolation Redis | variables `KV_REST_API_*` propres, sonde croisée `nil` dans les deux sens |
| G3 | Variables du § 3 relevées | tableau + captures (dont `NEXT_PUBLIC_BASE_URL` : absente ou égale à l'URL Preview) |
| G4 | Appairage (étapes 2 – 3) | `[ENROLL]` dans le journal ; fiche `paired=true` dans la base Preview, absente de la production |
| G5 | Candidat créé et relevé (étapes 4 – 5) | `candidateId`, `v2.screen = tft28`, `v2.rawBytes = 153600`, `v2.rawHash`, `poolSize = 1` ; absents de la production |
| G6 | `pod_vote_pins.h` | `node scripts/check-vote-pins.js` : OK |
| G7 | Verrou vierge | `VoteLockErase` : « A vierge, B vierge » |
| G8 | Autorisation finale du vote | hors de ce document |

## 5. Appairage puis candidat (backend Preview uniquement)
**Appairage (étapes 2 – 3)** : `pod_preview_host.h` (hôte Preview) → `node scripts/check-vote-pins.js arduino_uno_r4/pod_uno_r4/pod_preview_host.h` → compilation locale `-DPOD_PREVIEW_ENROLL=1` (voir le lot d'appairage) → flash → lecture de `[ENROLL] NON appaire sur <hôte> : deviceId=… pairCode=… -> ouvrir https://<hôte>/onboard?code=…` → appairage sur le site Preview. Le build s'arrête alors définitivement (aucun pull) : **reflasher le binaire stable**. Un code d'appairage expire (`pair:<code>` suit le TTL de la fiche) : appairer sans attendre.
**Candidat (étapes 4 – 5)** : depuis le **site Preview** (profil Preview, ESP appairé), dessiner pour `tft28` et envoyer (`/api/draw` → `submit-candidate`). Console de la base **Preview** : `GET candidate:current` → `candidateId`, `v2.screen` (= `tft28`), `v2.rawBytes` (= `153600`), `v2.rawHash` (= `POD_VOTE_PIN_HASH`), `poolSize` (= 1). Base **production** : l'identifiant doit être introuvable. **Horloge** : le candidat expire (7 200 s) ; compiler, vérifier le verrou, flasher et laisser la carte tirer dans ce délai, sinon recommencer avec un **nouvel** identifiant.

## 6. `pod_vote_pins.h` (checklist)
`cp pod_vote_pins.h.example pod_vote_pins.h` → hôte Preview, `candidateId`, `rawHash` → `node scripts/check-vote-pins.js` (OK) → relecture croisée avec les captures → `sha256sum` consigné → compilation locale `-DPOD_VOTE_CANARY=1` (jamais commitée). Détails : protocole d'isolation § 6.

## 7. Contrôle du verrou avant le flash
`VoteLockErase` : « A vierge, B vierge » (sinon : archiver le journal précédent, puis `ERASE-VOTE-LOCK`), puis retirer l'outil. Ne touche pas aux clés (octets 0 – 96).

## 8. Arrêts immédiats
Hôte Preview ≠ déploiement relevé ; variable Redis ou secret commun à la production ; **`NEXT_PUBLIC_BASE_URL` pointant la production ou vide** ; sonde croisée ≠ `nil` ; candidat trouvé en production ; `poolSize` ≠ 1 ; `rawBytes` ≠ 153 600 ou écran ≠ `tft28` ; `BYPASS_VALIDATION` défini ; candidat expiré ; verrou non vierge sans journal archivé ; un dessin de test visible dans les journaux de la production.
