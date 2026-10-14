# Protocole : isolation du backend, pins du vote et verrou (TFT 2,8″) — 14/10/2026

Compagnon de `docs/LOT_8B2E_R4_TFT28_VOTE_V4_FIX2_2026_10_14.md`. **Rien de ce document n'est exécuté par le firmware ni par Claude** : tout est fait par le porteur, hors logiciel, avant le moindre flash du canari de vote. Un nom d'hôte différent ne prouve **jamais** l'isolation ; seules comptent les preuves 1 à 5 ci-dessous.

## 0. Principe
Le vote unique minera un bloc (quorum 1) dans le backend ciblé. Il ne doit donc être possible **sous aucune hypothèse** que ce backend écrive dans le Redis / la base de **production**. On le prouve par les **jetons d'accès réellement utilisés par le déploiement**, pas par son adresse.

## 1. Preuve des variables du déploiement (Vercel)
1. Ouvrir le déploiement exact qui servira (celui dont l'hôte ira dans `POD_VOTE_BACKEND_HOST`), noter son **identifiant de déploiement**, son **environnement** (Preview, jamais Production) et sa branche.
2. *Project → Settings → Environment Variables* : pour **chaque** variable d'accès à Redis (URL REST + jeton, quelle que soit la forme : `KV_*`, `UPSTASH_*`, …), à une base SQL éventuelle (`DATABASE_URL`…), aux secrets de signature (`CLIP_TICKET_SECRET`, `INTERNAL_API_SECRET`, `SESSION_SECRET`, `NETWORK_ID_SECRET`, `PIN_DEVICE_KEY`) **et à `NEXT_PUBLIC_BASE_URL`** (elle oriente les appels internes `/api/draw` → `/api/submit-candidate` et `/api/validation-result` → `/api/submit-candidate` : absente, ou égale EXACTEMENT à l'URL Preview, jamais à la production, jamais vide) : relever **les environnements cochés**. Aucune ne doit être cochée à la fois Preview **et** Production ; sinon, la valeur Preview doit être une valeur **propre** distincte.
3. Capture datée des deux colonnes (Preview / Production) **avec les valeurs masquées sauf les 6 derniers caractères du hôte Upstash** (le sous-domaine du point d'accès REST identifie la base).
4. Toute variable modifiée **après** le déploiement n'y est pas appliquée : **redéployer** puis refaire l'étape 1.

## 2. Preuve côté base (Upstash, console)
1. *Upstash → Redis* : lister les bases ; la base utilisée par Preview doit avoir un **identifiant, un nom et un point d'accès REST différents** de la production. Capture des deux fiches.
2. **Sonde croisée**, faite directement dans la console de chaque base (pas par l'application) : dans la base Preview, `SET iso:probe:<aléa de 12 caractères> 1 EX 900` ; dans la base **production**, `GET iso:probe:<même aléa>` doit répondre `nil`. Inverser (sonde posée côté production, lecture côté Preview) → `nil`. Les deux clés expirent seules.
3. Ne **jamais** exécuter d'écriture dans la base de production pour cette preuve autre que la sonde ci-dessus (ou mieux : poser seulement côté Preview et lire côté production).

## 3. Le candidat épinglé n'existe que sur ce backend
1. Le dessin / candidat est soumis **uniquement** au domaine Preview. Relever `candidateId` et `hash` (§ 5).
2. Dans la console de la base **production**, chercher l'identifiant : `SCAN 0 MATCH *<candidateId>* COUNT 1000` itéré jusqu'au curseur 0 (lecture seule) → **aucune clé**. Dans la base Preview : la ou les clés du candidat existent.
3. Vérifier sur le site de **production** (galerie, vue réseau) que ni le candidat ni son futur bloc n'y apparaissent.

## 4. Autres canaux
- **Neon / base SQL** : aucune variable de base SQL n'est lue par `lib/` ni `app/` (recherche `DATABASE_URL`, `POSTGRES`, `neon` : aucun résultat) ; le Redis est désigné par `KV_REST_API_URL` et `KV_REST_API_TOKEN`. Constater que le déploiement Preview ne définit aucune variable de base SQL inattendue.
- **Appareil** : le canari de vote exige une carte **déjà appairée sur le backend Preview** (sinon `register` répond non appairé ⇒ arrêt définitif, voir FIX1). Le `register` du build de vote crée la fiche de la carte dans la base Preview ; l'appairage (profil Preview) se fait AVANT, avec le **build d'appairage Preview** (`POD_PREVIEW_ENROLL`, lot `TFT28-PREVIEW-ENROLL-1`, qui journalise le `pairCode`) ; l'option « premier flash du canari de vote » a été REFUSÉE à l'audit (circulaire). Vérifier que la fiche de l'appareil est dans la base Preview et que `devices:all` de la production n'a pas changé. Le canari d'affichage de transport peut tourner sur le backend de production ou sur Preview selon le `secrets.h` du porteur : le consigner dans le rapport.
- **Alias** : l'hôte de `pod_vote_pins.h` est l'URL propre du déploiement Preview, jamais un alias qui pourrait être réaffecté à la production.

## 5. Obtenir `candidateId` et `hash`
Sources acceptées (une seule suffit, une deuxième sert de recoupement) : (a) réponse de `/api/validate-candidate` du backend Preview (`candidate.candidateId`, `candidate.v2.hash`) relevée par un client authentifié du porteur ; (b) journal série d'un passage du **canari d'affichage** ou du binaire stable branché sur le backend Preview, quand il annonce le candidat. Le hash est le SHA-256 des **153 600 octets bruts** du candidat (jamais d'une copie PNG ou JSON). Format : UUID de 36 caractères, 64 hexadécimaux minuscules.

## 6. Génération de `pod_vote_pins.h` (checklist)
1. `cp arduino_uno_r4/pod_uno_r4/pod_vote_pins.h.example arduino_uno_r4/pod_uno_r4/pod_vote_pins.h` (fichier **ignoré par git**).
2. Renseigner les trois valeurs : hôte du déploiement Preview (domaine seul), `candidateId`, `hash`.
3. `node scripts/check-vote-pins.js` doit afficher `OK (formats seulement)` : refuse les valeurs modèle, l'hôte de production, un identifiant ou un hash mal formés, un fichier non ignoré ou suivi par git. **Il ne prouve pas l'isolation** : c'est l'objet des § 1 à 4.
4. Relire à l'œil les trois lignes contre les relevés des § 1 et 5 ; consigner l'empreinte du fichier (`sha256sum pod_vote_pins.h`).
5. Compiler **localement** avec `-DPOD_VOTE_CANARY=1` (`POD_CANARY=0`, `POD_RENDER_V1=0`) ; vérifier dans le journal de démarrage la ligne `[VOTE-CANARY] BUILD …` (hôte, candidat épinglé) ; **ne rien commiter** (ni le fichier, ni le binaire).
6. Retour arrière : binaire stable conservé ; supprimer `pod_vote_pins.h` après l'essai.

## 7. `VoteLockErase` (checklist)
Outil manuel, `consensus-pod/examples/VoteLockErase/VoteLockErase.ino`, **jamais laissé flashé** :
1. **Avant** le premier essai : flasher l'outil, ouvrir le moniteur série à 115 200 bauds, lire `etat : A vierge, B vierge`. Si « NON vierge » : relever le journal d'un éventuel essai précédent, **puis seulement** taper `ERASE-VOTE-LOCK` + Entrée ; relire `A vierge, B vierge`.
2. Reflasher le binaire (canari de vote) : au démarrage `verrou EEPROM au demarrage : LIBRE`.
3. **Après** l'essai (verrou pris, arrêt définitif) : archiver le journal brut **avant** tout effacement. Un nouvel essai exige une **nouvelle décision** (nouveau lot), jamais un effacement de routine.
4. L'outil n'efface que les blocs 5 et 6 de la flash de données (octets 5120 et 6144) ; les clés (0–96) restent. Ne jamais l'exécuter pour « débloquer » une carte dont l'état de verrou est inexpliqué sans avoir joint le journal à l'audit.

## 8. Critères de refus (NO-GO)
Une seule variable d'accès (Redis, Neon, secret de signature) commune aux deux environnements ; sonde croisée qui répond autre chose que `nil` ; candidat trouvé dans la base de production ; hôte épinglé = alias de production ; captures manquantes ou non datées ; déploiement modifié après les relevés sans nouvelle preuve.
