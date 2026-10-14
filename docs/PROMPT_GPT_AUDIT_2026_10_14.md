# Prompt à donner à GPT — audit du travail du 14/10/2026

> Copier-coller le bloc ci-dessous.

```
Tu reprends l'orchestration du projet Proof-of-Draw (dépôt : proof-of-draw). Ce 14/10/2026, le porteur et Claude ont quitté les canaris pour lancer le VRAI vote (v2 : recalcul local + signature Ed25519) en production directe, sur 4 appareils.

1. LIS D'ABORD, dans le dépôt, branche `claude/integration-vote-reel-2026-10-14` (HEAD à jour de la synthèse) :
   docs/SYNTHESE_VOTE_REEL_ET_PRODUCTION_DIRECTE_2026_10_14.md
   Puis, si besoin : docs/NOTE_POUR_GPT_ETAT_VOTE_REEL_2026_10_14.md, docs/LOT_VOTE_REEL_COMPLET_2026_10_14.md, docs/MESURES_DEMARRAGE_4_APPAREILS_VOTE_REEL_2026_10_14.md, docs/AUDIT_BRANCHES_2026_10_14.md, docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md.

2. CONTEXTE À RESPECTER : décision du porteur = production directe jusqu'à nouvel ordre (projet expérimental, reset global prévu, infrastructure Preview conservée en sommeil — ne rien supprimer ni déprécier). Le serveur « réseau de vote réel » (lib/voteCapability.ts, MIN_V2_APPROVALS=1 par défaut, signature stricte, exclusion des firmwares sans vote v2) est sur la branche mais PAS ENCORE DÉPLOYÉ (origin/main = 52bcc67). Les blocs #100 et #101 ont été minés par l'ancien serveur avec deux variables Vercel.

3. FAIS L'AUDIT DE CE TRAVAIL :
   a) Vérifie que les preuves de la synthèse (§ 4, blocs #99/#100/#101, votes v2 de R4 e-ink 2,9″, R4 TFT 2,8″ et ESP8266 e-ink 2,9″) sont cohérentes avec les relevés dans docs/MESURES_… et avec ce que le code peut produire ; signale toute affirmation non démontrée.
   b) Relis le code serveur ajouté (git diff 52bcc67..claude/integration-vote-reel-2026-10-14 -- app lib) : lib/voteCapability.ts, lib/deviceStore.ts, app/api/pull|validation-result|validate-candidate|ack-frame, lib/chain.ts, lib/personalFrame.ts, app/onboard, app/BlockDetail.tsx, app/network/SidePanel.tsx. Cherche : régressions, failles (contournement de l'exclusion, détournement du 403, DoS sur /api/pull), coût Redis, cas limites (appareil sans firmware, capteurs, versions « 2.10 » vs « 2.5 »), cohérence avec les tests.
   c) Relis les firmwares des 4 appareils compilés SANS drapeaux (arduino_uno_r4/pod_uno_r4, pod_uno_r4_eink29 ; esp8266/esp_eink_2.7BW_OLED, esp_eink_2.9BWR) : tous les drapeaux de canari doivent valoir 0 ; version déclarée de l'ESP 2,9″ = eink29bwr-2.3 ; le vote v2 des ESP8266 / R4 e-ink n'était jamais passé sur carte avant aujourd'hui.
   d) Évalue les risques listés au § 8 de la synthèse (auteur qui vote pour son propre candidat, éligibilité à off, appareils à classer qui seront coupés au déploiement, sommeil de 15 min des ESP, ACK TFT, archive des rejets) et propose un ordre de traitement.
   e) Donne un verdict explicite GO / GO SOUS CONDITIONS / NO-GO pour la fusion de la branche dans main (= déploiement Vercel production), avec la liste des conditions et des vérifications post-déploiement à faire.

4. FORMAT DE RÉPONSE : (1) verdict en une phrase ; (2) constats classés par gravité (bloquant / important / mineur) avec fichier:ligne ; (3) affirmations de la synthèse non prouvées ; (4) conditions du GO ; (5) prochains lots proposés. Sois concis et factuel. Aucun flash, aucun déploiement, aucun push : audit seulement.
```
