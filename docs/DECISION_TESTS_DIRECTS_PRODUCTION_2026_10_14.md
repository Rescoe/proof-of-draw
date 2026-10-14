# Décision : tests directs sur la production, jusqu'à nouvel ordre (14/10/2026)

Décision opérationnelle **du porteur, validée par GPT**. Elle change l'**environnement** des canaris matériels autorisés ; elle ne change **aucun garde-fou matériel ni cryptographique**.

## 1. Décision
- **Production directe jusqu'à nouvel ordre.** Les canaris autorisés (dont le vote unique V4 du TFT 2,8″, lot `TFT28-PROD-VOTE-CANARY-1`) s'exécutent directement contre **`proof-of-draw.vercel.app`** et la **base principale** (Redis de production).
- **Pourquoi** : Proof-of-Draw est encore **expérimental**, **sans utilisateurs externes**, et un **reset global des données est prévu** avant toute exploitation réelle. Rien d'irremplaçable n'est en jeu ; la vitesse prime sur l'isolation à ce stade.
- On ne crée plus, on n'exige plus de **backend Preview** ni de **Redis isolé** pour la campagne actuelle ; le mini-firmware d'appairage Preview n'est **pas** utilisé pour cette campagne.

## 2. Reset global prévu
Les données de la base principale (chaîne, appareils, profils, candidats, mesures) seront **réinitialisées globalement avant l'exploitation réelle**. Tout bloc miné pendant la campagne de canaris disparaîtra à ce reset ; c'est accepté.

## 3. L'infrastructure Preview est « prête mais mise en sommeil » — jamais supprimée, jamais dépréciée
Sont **conservés tels quels** et restent valides :
- le lot **`TFT28-PREVIEW-ENROLL-1`** (commit `fb727d3`, drapeau `POD_PREVIEW_ENROLL`, `docs/LOT_TFT28_PREVIEW_ENROLL_1_2026_10_14.md`) ;
- le **protocole d'isolation Redis** et les preuves croisées Upstash (`docs/PROTOCOLE_ISOLATION_ET_VERROU_VOTE_TFT28_2026_10_14.md`) ;
- le protocole de phase Preview (`docs/PHASE_BACKEND_PREVIEW_ISOLE_VOTE_TFT28_2026_10_14.md`), y compris les contrôles **`NEXT_PUBLIC_BASE_URL`**, les **secrets propres à Preview** (`INTERNAL_API_SECRET`, `SESSION_SECRET`, …), `STRICT_SIGNATURE=true` et `CANDIDATE_TTL_SEC=7200` (Preview seulement) ;
- le refus **par défaut** de la production dans le canari de vote : il ne se lève que par un **consentement local explicite** (§ 5).
Ils serviront dès que Proof-of-Draw aura des **utilisateurs, des clients, des pilotes muséaux ou hôteliers, ou une exploitation commerciale**.

## 4. Phrase de bascule future
> **« réactiver les tests isolés »**
Cette phrase, dite par le porteur, remet en vigueur l'obligation d'un backend Preview isolé et de ses preuves (Redis dédié, sonde croisée, `NEXT_PUBLIC_BASE_URL`, secrets propres, appairage par le mini-firmware, candidat créé depuis Preview). Rien n'est à reconstruire : tout est conservé. Tant qu'elle n'a pas été prononcée, la production directe s'applique.

## 5. Garde-fous OBLIGATOIRES conservés (production ou non)
- **Consentement explicite et local** : le canari de vote refuse la production par défaut ; il ne l'accepte qu'avec `#define POD_VOTE_ALLOW_PRODUCTION 1` dans le fichier **local** `pod_vote_pins.h` (ignoré par git), **uniquement** si l'hôte est exactement `proof-of-draw.vercel.app` et si `POD_CANARY = POD_RENDER_V1 = POD_VOTE_V1 = POD_PREVIEW_ENROLL = 0`. Le script `scripts/check-vote-pins.js` affiche alors « **ATTENTION : VOTE RÉEL SUR PRODUCTION** ».
- **Candidat épinglé** : identifiant, écran `tft28`, taille 153 600 octets et `rawHash` exacts ; le contenu reçu est re-haché sur l'appareil, un contenu différent est une **abstention définitive**.
- **Verrou EEPROM écrit et relu AVANT le réseau du POST** ; **une seule tentative**, **un seul POST au maximum** ; arrêt définitif après l'issue ; aucun effacement automatique.
- **Signature Ed25519 réelle**, mesures de pile et de tas à chaque étape, **échec fermé** (marge < 128 o ⇒ verrou silencieux), aucun écran, tactile, carte SD, animation ni ACK dans le build de vote.
- Drapeaux à **0** dans le dépôt ; **aucun secret, `pod_vote_pins.h`, `secrets.h` ni binaire commité** ; sauvegarde du binaire stable pour le retour arrière.
- Règle **primordiale** du dépôt sur les quotas Upstash (commandes Redis par heure et par acteur) : elle s'applique aussi en production directe.
- **Précondition de sauvegarde du candidat avant le vote** : `docs/LOT_TFT28_PROD_VOTE_CANARY_1_2026_10_14.md` § 5.

## 6. Une œuvre « minée dans la chaîne » n'est pas une œuvre « rejetée archivée »
- **Minée dans la chaîne** : le candidat a atteint le quorum, un **bloc** est créé et ajouté à la **chaîne principale** ; il est diffusé aux écrans, apparaît dans la galerie, **jusqu'au reset global**. C'est ce que produit un vote **accepté**.
- **Rejetée archivée** : un candidat refusé (ou expiré, ou dont le test échoue) **n'entre pas** dans la chaîne. L'onglet « Rejetés » lit la liste Redis `rejected:draws` (`GET /api/rejected-draws`), **mais aucun code n'écrit aujourd'hui dans `rejected:draws`** (constat de GPT du 14/10/2026, confirmé par recherche dans `app/` et `lib/` : seul le lecteur existe). Un candidat refusé disparaît donc avec `candidate:current` (TTL `CANDIDATE_TTL_SEC`, ou suppression à la clôture) : **son contenu n'est PAS récupérable** sans sauvegarde préalable.
- **Conséquence** : avant un vote réel sur la production, le contenu complet du candidat doit être **sauvegardé à la main** (précondition du lot `TFT28-PROD-VOTE-CANARY-1`) ; le futur lot **`REJECTED-CANDIDATE-ARCHIVE-1`** alimentera réellement l'onglet « Rejetés ». Ne pas confondre « le bloc existe dans la chaîne » (accepté) et « une trace du candidat existe » (archive, aujourd'hui inexistante).
