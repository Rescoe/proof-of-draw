# Vercel et réseau — essai du canari 3628b3d (10/10/2026)

Transmis par le porteur (analyse GPT) :

- `POST /api/send-to-screen` → 200 le 10/10/2026 à **18:04:40** pour `dev_W29I1TW7`, écran `eink29bwr`, bloc `26c4f1b82f3d`.
- Dans la fenêtre fournie (jusqu'à 18:08) : AUCUN `/api/pull`, `/api/pull-frame` ni `/api/ack-frame` après cet envoi. Cela prouve la mise en file, pas une tentative de livraison (la carte pouvait attendre son prochain pull, 5 ou 15 minutes).
- Après UN Reset sans nouvel envoi : la carte a fait register (200) puis pull (200) — vus au port série — puis s'est tue après « [PULL] nouvelle frame 6429e8f5-… (personal) ». Le porteur n'a rien vu côté Vercel pour cet essai (journaux non rafraîchis ou filtrés : le port série prouve que `/api/register` et `/api/pull` ont reçu 200).

Observation à vérifier (NON expliquée) : `send-to-screen` fabrique un `frameId` neuf (`crypto.randomUUID()`) à chaque envoi et REMPLACE `personal:frame:{deviceId}` ; or le pull qui a suivi le Reset annonce le MÊME identifiant `6429e8f5-9ed8-427c-9c3e-018b4e820c05` que celui du blocage du canari `7df39b6`. Soit le Reset a eu lieu avant l'envoi de 18:04:40 (ordre des événements à confirmer par le porteur), soit cet envoi n'a pas remplacé la clé. Aucun code serveur modifié.

Aucun vote du R4 n'a eu lieu. Redis +0, Neon 0.
