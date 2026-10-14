# Phase « backend Preview isolé » du vote unique TFT 2,8″ — préparation (14/10/2026)

Suite de `docs/CANARY_R4_TFT28_AFFICHAGE_FIX2_VERDICT_2026_10_14.md` (transport revalidé, VERT). **Préparation seulement : aucun flash du canari de vote, aucun vote, aucun déploiement, aucune écriture serveur par Claude.** Tout ce qui touche Vercel, Upstash et la carte est fait par le porteur. Compléments : `docs/PROTOCOLE_ISOLATION_ET_VERROU_VOTE_TFT28_2026_10_14.md` (preuves d'isolation, `pod_vote_pins.h`, `VoteLockErase`).

## 0. Constats issus du code (à connaître avant de commencer)
1. **Redis = deux variables : `KV_REST_API_URL` et `KV_REST_API_TOKEN`** (`lib/redis.ts`). **Neon n'est utilisé nulle part dans `lib/` ni `app/`** (recherche `DATABASE_URL`/`POSTGRES`/`neon` : aucun résultat) : le § 4 « Neon » du protocole d'isolation se réduit à constater l'absence de variable de base SQL sur le déploiement Preview.
2. **Le build de vote ne montre ni ne journalise le code d'appairage** (`registerLog` n'écrit que `deviceId` et `paired` ; aucun écran). Sur un Preview neuf, `register` crée une fiche **non appairée** (clé = adresse MAC) ⇒ le canari s'arrête (« appareil NON appairé ») **avant** tout pull, tout verrou, tout vote. L'appairage Preview ne peut donc pas se faire « par le canari ». Voir § 3.
3. **`candidate:current` est une clé unique et globale** (un seul candidat à la fois), **TTL 1 800 s** (`CANDIDATE_TTL_SEC`). Les épingles (`candidateId`, hash) doivent être connues **à la compilation** : le candidat doit exister **avant** de compiler et rester valable jusqu'au pull de la carte (§ 5).
4. Quorum : `poolSize` = nombre de profils/ESP actifs (`max(1, …)`) ; avec `ELIGIBILITY_MODE` et `COMMITTEE_MODE` à `off` (défauts), un seul appareil actif ⇒ quorum de 1 ⇒ **le vote mine un bloc dans CE backend**. `COMMITTEE_MODE=enforce` est refusé sans `COMMITTEE_GRINDING_ACK`.
5. La carte de production reste **inchangée** : le canari de vote est un binaire distinct, `SERVER_HOST` = hôte Preview ; le binaire stable (production) est conservé pour le retour arrière.

## 1. Portes (chaque porte exige la précédente ; consigner captures datées)
| # | Porte | Preuve exigée |
|---|---|---|
| G0 | Audit GPT/Codex de cette phase | acceptation écrite |
| G1 | Déploiement Preview dédié | identifiant de déploiement, environnement = Preview, branche notée |
| G2 | Isolation Redis (protocole d'isolation § 1 à 3) | variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` propres à Preview (hôte Upstash différent de la production), sonde croisée `nil` dans les deux sens |
| G3 | Réglages Preview figés (§ 2) | tableau des variables relevées sur le déploiement |
| G4 | Carte enregistrée et appairée sur Preview (§ 3) | fiche dans la base Preview, `paired=true`, absente de la production |
| G5 | Candidat créé et relevé (§ 5) | `candidateId`, `v2.screen = tft28`, `v2.rawBytes = 153600`, `v2.rawHash` lus dans la base Preview ; absents de la production |
| G6 | `pod_vote_pins.h` + contrôle (§ 6) | `node scripts/check-vote-pins.js` : OK |
| G7 | Verrou vérifié vierge (§ 7) | sortie de `VoteLockErase` « A vierge, B vierge » |
| G8 | Autorisation explicite du flash du canari de vote | **hors de ce document** |

## 2. Variables à relever et fixer sur le déploiement Preview (valeurs proposées, à valider à l'audit)
| Variable | Valeur proposée | Pourquoi |
|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | **propres à Preview** | isolation (G2) ; jamais « All Environments » |
| `ELIGIBILITY_MODE` | `off` (défaut) | pas de quorum de profils : un appareil ⇒ quorum 1 |
| `COMMITTEE_MODE` | `off` (défaut) | idem ; `BLOCK_RECEIPTS` non défini |
| `ANIM_V3_MODE` | `off` | aucune animation dans ce test |
| `BYPASS_VALIDATION` | **non défini** | le vote doit être réellement compté |
| `STRICT_SIGNATURE` | `true` (**décision d'audit**) | rend le critère « signature valide » vérifiable ; risque : un refus consomme l'unique tentative |
| `ENFORCE_V2_REJECTIONS`, `MIN_V2_APPROVALS` | défauts (`false`, `0`) | ne pas durcir ce premier test sans décision |
| `CANDIDATE_TTL_SEC` | `7200` (**Preview seulement, noté**) | laisse le temps de compiler et de flasher (le défaut est 1 800 s) |
| `SESSION_SECRET`, `NETWORK_ID_SECRET`, `INTERNAL_API_SECRET`, `CLIP_TICKET_SECRET`, `PIN_DEVICE_KEY` | **valeurs propres à Preview** (jamais celles de la production) | pas de cookie / jeton valable d'un environnement à l'autre |
| `ANA_ART_FEED_SECRET`, `ANA_API_URL` | non définis ou propres | éviter d'importer le flux externe en test |
| `MAX_ACTIVE_DEVICES`, limites de débit | défauts | noter les valeurs |
Toute variable modifiée exige un **redéploiement**, puis un nouveau relevé (G3).

## 3. Appairage de la carte sur Preview (point à trancher à l'audit)
Le canari de vote ne peut pas être appairé par lui-même (§ 0.2). Options :
- **Aucune option sans flash n'existe aujourd'hui** : le canari d'affichage a l'hôte de production codé en dur, et le build de vote exige des épingles valides.
- **Option A (nouveau mini-lot, recommandé)** : un build local « appairage Preview » = build d'affichage dont `SERVER_HOST` vient de `pod_vote_pins.h` (drapeau `POD_PREVIEW_HOST`, **absent de la production**, jamais commité à 1), **sans vote** (`POD_VOTE_CANARY = 0`, pas d'épingle de candidat), qui affiche le QR / code d'appairage normal. Procédure : flasher, appairer sur le site Preview (`/onboard?code=…`, avec un profil Preview), vérifier G4, **reflasher le stable**. **À faire dans un lot dédié, après audit** : cela modifie `pod_uno_r4.ino`, donc nouvelle revalidation de l'identité de production.
- **Option B′ (sans nouveau code)** : flasher le **canari de vote complet** une première fois, **avec les pins du vrai candidat**, **avant** l'appairage : la carte s'enregistre sur Preview, s'arrête « non appairé » (aucun pull, aucun verrou, aucun vote — testé), le porteur lit `pairCode` dans la base Preview (`GET device:<deviceId>` → champ `pairCode`), appaire sur le site Preview, puis **un reset** relance le même binaire, désormais appairé. Contrainte : le candidat doit déjà exister (§ 5) et le TTL couvrir cette étape ; **c'est un flash du canari de vote : G8 requis**.
Ne rien faire sans la décision A ou B′ du porteur et de l'audit. (Une option « B » avec épingles factices n'existe pas : la porte de vote refuserait un candidat différent, mais un build de vote exige de toute façon des épingles bien formées.)

## 4. Après l'appairage : vérifications Preview (lecture seule)
Fiche de la carte dans la base **Preview** (`mac`, `screens=["tft28"]`, `artistId` renseigné) ; **absence** de toute nouvelle fiche dans `devices:all` de la **production** ; `GET pair:<code>` n'existe que côté Preview.

## 5. Créer le candidat épinglé (backend Preview uniquement)
1. Depuis le **site Preview** (profil Preview, ESP appairé), dessiner une œuvre pour l'écran `tft28` et l'envoyer (`/api/draw` → `submit-candidate`). Un seul candidat à la fois.
2. Dans la console de la base **Preview** : `GET candidate:current` → relever `candidateId`, `v2.screen` (= `tft28`), `v2.rawBytes` (= `153600`), `v2.rawHash` (64 hexadécimaux = **`POD_VOTE_PIN_HASH`**), `poolSize` (= 1 attendu), `createdAt`. Refuser si l'un diffère. Recoupement : `GET /api/candidate-frame` (authentifié) ou journal d'un passage — le SHA-256 des 153 600 octets doit égaler `rawHash`.
3. Dans la base **production** : l'identifiant doit être introuvable (protocole d'isolation § 3).
4. **Horloge** : le candidat expire (7 200 s proposé). Compiler, vérifier, flasher et laisser la carte tirer **dans ce délai** ; sinon le candidat est perdu : recommencer en § 5.1 avec un **nouvel** identifiant (nouvelles épingles, nouvelle compilation).
5. Aucun autre validateur ne doit être actif sur Preview.

## 6. `pod_vote_pins.h` (checklist)
`cp pod_vote_pins.h.example pod_vote_pins.h` → hôte Preview (domaine seul), `candidateId`, `rawHash` relevés au § 5 → `node scripts/check-vote-pins.js` (doit répondre OK) → relecture croisée avec les captures → `sha256sum pod_vote_pins.h` consigné → compilation locale `-DPOD_VOTE_CANARY=1` (jamais commitée ; `POD_CANARY=0`, `POD_RENDER_V1=0`). Détails : protocole d'isolation § 6.

## 7. Contrôle du verrou avant le flash
Flasher `VoteLockErase`, relever « A vierge, B vierge » (sinon : archiver le journal de l'essai précédent, puis `ERASE-VOTE-LOCK`), retirer l'outil. Ce contrôle suit **immédiatement** la compilation, avant le canari de vote. Il ne touche pas aux clés (octets 0 – 96).

## 8. Arrêts immédiats de la phase
Hôte Preview ≠ déploiement relevé ; variable Redis commune à la production ; sonde croisée ≠ `nil` ; candidat trouvé en production ; `poolSize` ≠ 1 ; `rawBytes` ≠ 153 600 ou écran ≠ `tft28` ; `BYPASS_VALIDATION` défini ; secret commun aux deux environnements ; candidat expiré ; verrou non vierge sans journal archivé.

## 9. Questions ouvertes pour l'audit
1. Option d'appairage : A (mini-lot `POD_PREVIEW_HOST`) ou B′ (premier flash du canari de vote avant appairage) ?
2. `STRICT_SIGNATURE=true` sur Preview : oui / non ?
3. `CANDIDATE_TTL_SEC=7200` sur Preview : accepté ?
4. Qui relève les variables du déploiement et signe les captures (G2 / G3) ?
