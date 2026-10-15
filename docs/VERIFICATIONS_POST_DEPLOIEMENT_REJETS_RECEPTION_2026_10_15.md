# Vérifications post-déploiement : archive des rejets et réception maintenue (15/10/2026)

Déployé : `main` à `f6f648e` (fusion de la branche d'intégration, GO de GPT à `ea7e79b` ; Vercel : succès). Ce document liste ce qui **ne peut pas être prouvé sans une action réelle**. **Rien n'a été fabriqué en production** : `GET /api/rejected-draws` répond `{"rejected":[],"total":0}` (constat du 15/10/2026 après déploiement) et aucune écriture de test n'a été faite.

## Ce que les tests ont déjà prouvé (hors production)
Archive : 25 tests dont le script Lua réel exécuté par fengari sur un mini-Redis ; réception : tests de structure des routes ; ACK du TFT : canari matériel du 15/10/2026. Reste à observer **sur Upstash**, avec un vrai candidat :

## Vérification 1 — un candidat perdu produit une entrée « Rejetés » (action réelle requise : ≈ 40 min)
Un refus par le réseau est difficile à provoquer honnêtement ; le cas **expiré sans quorum** est naturel et utilise le même script (état `expired`, motif « expiré ou remplacé sans quorum »).
1. Dessiner et envoyer une image depuis un appareil (profil du porteur).
2. **Dans la minute qui suit**, couper l'alimentation des autres appareils votants (de façon que le quorum ne soit pas atteint ; le TFT auteur vote seul).
3. Attendre 31 minutes (le candidat expire : `CANDIDATE_TTL_SEC` = 1800 s).
4. Rallumer les appareils, puis envoyer **un second dessin** : sa création réconcilie le précédent.
5. Contrôles dans Upstash (CLI ou Data Browser) :
   - `LRANGE rejected:draws 0 0` → une entrée avec `candidateId` et `reason` « expiré ou remplacé sans quorum » ;
   - `GET candidate:final:<id>` → `expired` (pour un refus par le réseau : `rejected`) ;
   - `GET candidate:archive:<id>` → la copie complète (JSON avec `payload`) existe, `TTL` ≈ 7 776 000 s ;
   - `GET candidate:last` → l'id du **second** dessin (jamais l'ancien) ;
   - l'onglet « Rejetés » de l'application affiche l'entrée.
Si l'intervention n'est pas souhaitée, cette vérification reste « non démontrée en production » sans aucun risque (le comportement par défaut est inchangé : le candidat expire comme avant).

## Vérification 2 — un candidat miné n'apparaît jamais dans les rejets (observation passive)
Au prochain bloc miné normalement : `GET candidate:final:<id du candidat>` → `mined` ; `candidate:archive:<id>` absent ; `LRANGE rejected:draws 0 -1` ne contient pas cet id.

## Vérification 3 — un appareil non votant reçoit les œuvres sans `pendingValidation` (action facultative)
Avec un appareil au firmware ancien ou inconnu (par exemple celui de l'ami, firmware `2.0`), pendant qu'un candidat est en attente : `curl "https://proof-of-draw.vercel.app/api/pull?deviceId=<ID>"` (compte comme un pull : limité à quelques appels par heure) doit répondre `pendingValidation: null` ; après un bloc miné, `frame` et `frameId` sont présents (réception maintenue) et l'appareil n'apparaît ni dans `candidate:votes` ni dans `poolSize`.

## Rollback si une anomalie apparaît
`git revert -m 1 f6f648e` sur `main` (annule toute la fusion) ; ou désactiver seulement l'archive en retirant les trois appels `.catch` (`submit-candidate`, `validation-result`). Les clés `candidate:*` écrites expirent d'elles-mêmes (TTL 90 j) ; la liste `rejected:draws` est bornée à 200.
