# Audit des branches avant tout push sur `main` (14/10/2026)

Objet : savoir **ce qui existe, ce qui part en production, ce qui reste de côté**, et comment revenir en arrière. **Rien n'est supprimé** : toutes les branches et tous les dossiers de travail (worktrees) restent en place.

## 1. État de `main`
`origin/main` = `52bcc67` (docs, 13/10/2026). Le `main` **local** est en retard d'un seul commit (`3239d2e`, contenu dans `52bcc67`) : aucune perte possible. **Tag de sécurité** : `avant-vote-reel-2026-10-14` sur `52bcc67` (créé et poussé) : c'est le point de retour de TOUT.

## 2. Les branches distantes
| Branche | Contenu | Dans l'intégration ? | Décision |
|---|---|---|---|
| `claude/integration-vote-reel-2026-10-14` | **LA branche à déployer** : `main` + les 4 branches ci-dessous + serveur « réseau de vote réel » | — | à fusionner dans `main` **après** le téléversement des 4 appareils et votre accord |
| `claude/r4-tft28-vote-audit-8b2e` | TFT 2,8″ : canari de vote V4 (verrou, épinglage, consentement production), canaris d'affichage, appairage Preview, outils, 26 commits | **oui** | conservée (travail Preview « en sommeil ») |
| `claude/r4-tft28-canary-8b2d` | TFT 2,8″ : canari d'affichage (client TLS borné, piles dédiées SD/JSON), animations en flux | **oui** (ancêtre) | conservée |
| `claude/esp8266-eink27-oled-canary-8b2c` | ESP8266 e-ink 2,7″ + OLED : canari, `pod_canary_flags.h` | **oui** | conservée |
| `claude/esp8266-eink29-canary-8b2c` | ESP8266 e-ink 2,9″ BWR : canari | **oui** (ancêtre) | conservée |
| `codex/cloud-handoff-pullframe-fix1` | notes de reprise | oui (ancêtre de `main`) | conservée |
| `claude/r4-tft28-touch-gestures-8b2e` | TFT 2,8″ : gestes tactiles (16 commits) — **modifie `pod_uno_r4.ino`** | **non** | **laissée de côté** : toucherait le sketch TFT à flasher et entrerait en conflit ; à traiter dans un lot séparé |
| `claude/hopeful-noether-ndz9ud` | **R4 e-ink 2,7″** (`pod_uno_r4_eink27*`) : client TLS borné | non | hors des 4 appareils ; laissée |
| `codex/local-snapshot-2026-10-11` | notes et sonde `Ed25519StackProbeUnoR4` | non | hors périmètre ; laissée |
| `claude/docs-etat-branches-2026-10-13` | document d'état des branches (docs seulement) | non | laissée (ce document le remplace pour l'usage courant) |
Dossiers de travail (worktrees) : `proof-of-draw-claude-vote-audit`, `…-esp27-oled-canary`, `…-touch-gestures`, `…-docs-etat`, `…-readme`, `…-claude-local-resume` : **conservés**, aucun retrait.

## 3. Ce qui part VRAIMENT en production (serveur, déployé par Vercel)
Différence `origin/main` → intégration, hors firmwares, docs et tests : **7 fichiers**, ~70 lignes.
| Fichier | Effet |
|---|---|
| `lib/voteCapability.ts` (nouveau) | liste des firmwares qui savent voter en v2 + interrupteur `VOTE_ONLY_NETWORK` |
| `lib/deviceStore.ts` | le quorum ne compte que les appareils capables de voter |
| `app/api/pull/route.ts` | un firmware sans vote v2 ne reçoit **rien** |
| `app/api/validation-result/route.ts` | 403 pour un firmware sans vote v2 ; **signature stricte par défaut** |
| `app/api/validate-candidate/route.ts` | 403 pour un firmware sans vote v2 |
| `lib/chain.ts` | **`MIN_V2_APPROVALS` = 1 par défaut** (un vote « écho » v1 ne mine plus seul) |
| `app/learn/data/roadmap.ts` | une ligne de texte (page « Apprendre ») |
Pas de changement de `package.json`, de configuration Next ni de Vercel. Aucune commande Redis ajoutée.
**Effets visibles au déploiement** : tout appareil dont le firmware n'est pas dans la liste (ancien firmware, version nue, inconnu — dont l'appareil de l'ami) cesse de recevoir et de voter ; un bloc n'est miné que si au moins un vote v2 est accepté.

## 4. Ce qui change dans les firmwares (par rapport à `main`)
| Sketch | Écart avec `main` | Remarque |
|---|---|---|
| `pod_uno_r4` (TFT 2,8″) | **fort** (≈ 1 600 lignes : client TLS borné, piles dédiées SD/réseau/JSON, vote durci, outils de canari, tous les drapeaux à 0) | **le plus gros risque** : code jamais tourné avec les drapeaux à 0 sur la carte ; les canaris d'affichage (mêmes bases) sont VERTS |
| `esp_eink_2.9BWR` (ESP8266) | moyen (instrumentation de canari inactive à 0, version `eink29bwr-2.3`) | vote v2 « NON TESTÉ sur le matériel » |
| `esp_eink_2.7BW_OLED` (ESP8266) | moyen (canari inactif à 0, `pod_canary_flags.h`) | idem |
| `pod_uno_r4_eink29` (R4) | **aucun** | firmware identique à `main` |
Le texte des sketches avec les drapeaux à 0 a été comparé à leurs sauvegardes d'avant (`firmware-backups/`) par des tests lors des lots précédents (TFT : identique à V3-FIX1).

## 5. Points d'attention
1. **Ordre** : flasher les 4 appareils d'abord ; déployer ensuite (voir `docs/GUIDE_TELEVERSEMENT_4_APPAREILS_2026_10_14.md`).
2. Le **vote v2 des ESP8266 et du R4 e-ink** n'a jamais tourné sur carte : si aucun bloc ne se mine, c'est l'information recherchée (journal série de l'appareil + logs Upstash).
3. **Suite complète de tests non rejouée** sur la branche finale (choix du porteur) ; tests ciblés OK (`voteCapability`, `castVote`, `eligibility`, `tsc`). Le test de la page « Apprendre » (`learnRoadmap`) et les tests C++ n'ont pas été relancés depuis la fusion.
4. Défaut connu hors périmètre : ACK d'image TFT en production (`TFT28-ACK-STATE-FIX1`).

## 6. Procédure de mise en production (après accord)
1. Les 4 appareils sont téléversés et les journaux relus.
2. `git checkout main && git pull && git merge --no-ff claude/integration-vote-reel-2026-10-14 && git push` ⇒ déploiement Vercel (fusion sans conflit : l'intégration part de `origin/main`).
3. Surveiller le fil d'activité (`v2 vérifié×N`) et les logs.
**Retour arrière** : `git revert -m 1 <fusion>` ou redéployer le tag `avant-vote-reel-2026-10-14` ; ou, sans code, variables Vercel `VOTE_ONLY_NETWORK=false`, `MIN_V2_APPROVALS=0`, `STRICT_SIGNATURE=false`.
