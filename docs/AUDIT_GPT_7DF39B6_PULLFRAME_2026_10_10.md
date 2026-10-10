# Audit GPT — canari `7df39b6` : blocage après « nouvelle frame (personal) », avant `/api/pull-frame`

> Transcription fidèle de l'analyse transmise par le porteur le 10/10/2026 (aucun fichier source fourni par GPT). Les journaux bruts sont archivés dans `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT1_2026_10_10/`.

| Champ | Valeur |
|---|---|
| Commit essayé | `7df39b6`, drapeaux locaux `POD_RENDER_V1=1`, `POD_CANARY=1` |
| Verdict | **échec utile** : `register JSON` et `pull JSON` restent validés ; le blocage est dans le téléchargement binaire de la frame (premier morceau réellement non testé) |
| Redis / Neon | Redis +0, Neon 0 |

## Ce que prouvent les journaux (selon GPT)
* Le R4 reçoit la frame personnelle `6429e8f5…`, puis plus rien : aucune requête `/api/pull-frame` chez Vercel ; aucune ligne `[HTTP GET] /api/pull-frame`, `[FRAME]`, `frameHash`/`renderHash` ; aucun rafraîchissement e-ink ; aucun ACK.
* Il se bloque entre l'appel de `doFetchFrame()` et l'arrivée de la requête chez Vercel, « probablement dans `WiFiSSLClient::connect()` ou juste avant ». `HTTP_TIMEOUT_MS = 20 s` protège la lecture des en-têtes et du corps, pas clairement `client.connect()`.
* Dessin neuf : pool de 4 appareils, quorum `ceil(4 × 0,51) = 3`. Vercel montre `dev_T46HBXG1` → 1/3 et `dev_KAD6PKC4` → 2/3 ; le R4 `dev_W29I1TW7`, déjà bloqué, n'a pas voté ; sans troisième vote, pas de bloc ; le candidat expire (≈ 30 min).

## Décisions
1. Débrancher le canari ; ne renvoyer aucune image. La frame personnelle reste disponible (aucun ACK) : elle servira de test au prochain firmware.
2. Ne renvoyer un dessin au consensus qu'après validation téléchargement + rendu + ACK.

## Demande : `LOT8B2B2-PULLFRAME-PHASE-AUDIT1` (base `7df39b6`)
Instrumentation canari étroite pour localiser le dernier point atteint : avant l'appel de `doFetchFrame` ; entrée de `doFetchFrame` ; avant `podNetRun` ; entrée de la transaction ; construction de `Conn` ; avant/après `client.connect` ; avant/après l'envoi HTTP ; après lecture des en-têtes ; après chaque plan noir/rouge ; après `stop()` ; après retour de `podNetRun`. L'instrumentation ne doit pas introduire de dépassement (coût mesuré ou mécanisme à coût borné). Auditer la chaîne statique `loop/setup → doPull → doFetchFrame → podNetRun`. Vérifier dans les cœurs 1.5.3 et 1.6.0 si `WiFiSSLClient::connect()` a un délai borné ; documenter une récupération possible sans modifier l'architecture avant localisation matérielle. Archiver le journal série, l'absence de `/api/pull-frame` chez Vercel, les deux votes (1/3, 2/3) et l'absence du vote du R4. Contraintes : instrumentation canari seulement, drapeaux commités à `0/0`, serveur inchangé, Redis +0, Neon 0, aucun polling supplémentaire, aucun OTA, aucun flash, aucun push ; compiler les deux cœurs, tests, commit local, arrêt pour audit.

## Réserve de Claude (lot `PULLFRAME-PHASE-AUDIT1`)
La capture Vercel fournie commence à **13:41:00**, alors que la frame personnelle a été envoyée avant le dessin de 13:42:24 : l'absence de `/api/pull-frame` n'est établie que sur 13:41–14:11. La preuve de l'absence côté carte (journal série) est indépendante et suffit à localiser le blocage avant l'impression de `[HTTP GET] /api/pull-frame`.
