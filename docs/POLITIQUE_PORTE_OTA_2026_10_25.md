# Politique de la porte OTA (`ota:kill`) — peut-on la laisser ouverte ? (25/10/2026)

Réponse courte : **oui, tant que le dépôt ne contient que des releases canari ciblées sur des appareils nommés** ; la porte reste alors un **interrupteur d'urgence**, pas une formalité à chaque mise à jour. Une garde de test (`tests/otaReleasesPolicy.test.ts`) fait respecter cette condition.

## Ce que la porte contrôle exactement
`ota:kill` (clé Redis lue dans le `MGET` de `/api/pull`, 0 commande de plus) coupe deux choses : **l'annonce** d'une release dans la réponse de `/api/pull` et le **téléchargement** de `/firmware/<release>/image.bin` (503). Elle ne vérifie ni la signature ni le ciblage : ceux-ci s'appliquent même porte ouverte.

## Ce qui protège la flotte porte ouverte
1. **Signature RSA** : l'image et le manifeste sont signés hors ligne (clé privée de publication jamais sur le serveur) ; la carte vérifie avant d'écrire, le serveur vérifie avant d'annoncer.
2. **Ciblage** : une release de canal `canary` n'est annoncée qu'aux appareils listés dans `canaryDevices` (`eligibleForRelease`) ; un défi HMAC par appareil et par release, une signature Ed25519 de l'appareil pour télécharger, 3 téléchargements par heure et par appareil.
3. **Anti-retour** : jamais une séquence inférieure ou égale à celle installée.
4. **Une release n'existe que si elle est fusionnée dans `main`** (fichiers de `ota-releases/`) : la revue de la PR est le vrai déclencheur.

## Le seul risque réel porte ouverte : une release « stable »
Une release de canal `stable` avec une vague à 100 % est annoncée à **toutes les cartes de sa famille** capables d'OTA. Garde : `tests/otaReleasesPolicy.test.ts` refuse toute release `stable` qui n'est pas listée dans `ota-releases/STABLE_APPROVED.txt` (fichier absent = aucune) et tout canari de plus de 3 appareils. L'ajout de ce fichier est visible dans la PR : c'est l'approbation explicite.

## Quand fermer la porte quand même
- **Urgence** : une image mauvaise est déjà annoncée → `SET ota:kill 1` coupe annonce et téléchargement immédiatement.
- **Première release d'une famille ou changement de mécanisme** (par exemple un téléchargeur par plages) : ouvrir seulement pendant la fenêtre d'essai.
- Le jour où le **consentement du propriétaire** (`docs/SECURITE_OTA_CONSENTEMENT_PROPRIETAIRE_2026_10_23.md`) existera, la porte pourra rester ouverte par défaut sans réserve : la mise à jour exigera un accord par appareil.

## Ce qui ne se rattrape pas à distance
Une release canari mauvaise **sur la seule carte ciblée** peut la rendre inutilisable (un seul emplacement d'application, pas de retour arrière automatique). La porte ouverte n'aggrave pas ce risque : il vient du contenu de la release et de la marge mémoire (voir `docs/MARGE_MEMOIRE_ESP8266_TLS_2026_10_24.md`). Recommandation : un canari à la fois, jamais sur une carte qu'on ne peut pas reflasher dans la semaine sans l'avoir essayé sur le banc.
