# Note de mise à jour pour GPT — où en est le vote réel (14/10/2026, fin de journée)

À lire d'abord. Elle remplace de fait les consignes de prudence des jours précédents pour la campagne en cours (voir § 2). Rédigée par Claude à la demande du porteur, pour que l'orchestration reparte de l'état réel.

## 1. En une phrase
Le porteur a décidé de **sortir des canaris** : le **vrai système de vote** (calcul local de l'appareil, signature Ed25519, consensus) est lancé **directement sur la production** avec **4 appareils**, après un audit de Claude puis de GPT ; l'infrastructure Preview reste prête mais en sommeil.

## 2. Décisions du porteur (14/10/2026)
- **Production directe jusqu'à nouvel ordre** (projet expérimental, aucun utilisateur externe, reset global prévu avant exploitation réelle) : `docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md`. Phrase de bascule future : « réactiver les tests isolés ».
- **On passe du canari au vote complet** sur les 4 appareils (§ 4). Les canaris (drapeaux à 1) ne servent plus pour cette campagne.
- **Les appareils qui ne savent pas voter en v2 ne reçoivent plus rien et ne s'expriment plus** (dont l'appareil d'un ami, ancien firmware).
- **Aucun travail Preview n'est supprimé ni déprécié** (`TFT28-PREVIEW-ENROLL-1` `fb727d3`, protocole d'isolation, contrôles `NEXT_PUBLIC_BASE_URL`, secrets Preview).
- Rythme : « y aller à fond », moins de tests longs ; la suite complète n'a **pas** été rejouée sur la branche finale ; GPT audite ensuite.

## 3. Ce que Claude a fait (chronologie, tout est poussé sur `origin`)
| Lot | Commits | Résumé |
|---|---|---|
| TFT 2,8″ V4-FIX1 | `ead25cd`, `c52ecea` | le canari de vote n'initialise ni écran, ni tactile, ni SD ; preuve de portée (source + ELF) |
| V4-FIX2 | `4800451` | `setup()` sort aussitôt après l'arrêt définitif (plus de faux « [BOOT] prêt ») |
| Verdict matériel | `4e6f548` | **canari d'affichage TFT VERT sur la carte** (journal brut archivé) ; transport V4 revalidé |
| TFT28-PREVIEW-ENROLL-1 | `fb727d3` | mini-firmware d'appairage Preview (en sommeil) |
| TFT28-PROD-VOTE-CANARY-1 | `c23c328` | canari de vote unique autorisé sur la production par consentement local `POD_VOTE_ALLOW_PRODUCTION 1` ; vérificateur de sauvegarde du candidat. **Finalement non utilisé** : le porteur préfère le vote complet |
| Intégration | `7375675`, `788b23f` | fusion des branches TFT (vote-audit) et ESP8266 2,7″+OLED dans une branche basée sur `main` |
| Vote réel | `47b9b1e` | côté serveur : voir § 5 |
| Guide + audit des branches | `4e4ae7c` | `A_TELEVERSER/` (copies locales, ignorées par git), guide de téléversement, audit des branches |

Épisode instructif : un dessin envoyé alors que la TFT était hors ligne a été **miné par le seul autre appareil actif** (vote « écho » v1, quorum 1) — bloc #99. C'est ce qui a motivé `MIN_V2_APPROVALS=1`.

## 4. Les 4 appareils (firmwares de PRODUCTION, tous drapeaux à 0, vote v2 compilé)
| Appareil | Sketch | Firmware déclaré |
|---|---|---|
| UNO R4 + TFT 2,8″ tactile (`dev_7B4L17N3`) | `arduino_uno_r4/pod_uno_r4` | `r4tft28-2.5` |
| ESP8266 e-ink 2,7″ + OLED | `esp8266/esp_eink_2.7BW_OLED` | `multiscreen-2.5` |
| ESP8266 e-ink 2,9″ BWR | `esp8266/esp_eink_2.9BWR` | `eink29bwr-2.3` (était « 2.2 ») |
| UNO R4 + e-ink 2,9″ BWR | `arduino_uno_r4/pod_uno_r4_eink29` | `r4eink29-1.1` |

**`POD_CANARY = POD_RENDER_V1 = POD_VOTE_V1 = POD_VOTE_CANARY = POD_PREVIEW_ENROLL = 0` partout (aussi dans `esp8266/esp_eink_2.7BW_OLED/pod_canary_flags.h`) : le porteur ne touche à aucun drapeau.** Copies prêtes : `A_TELEVERSER/` (locales, avec `secrets.h`, jamais commitées) ; guide : `docs/GUIDE_TELEVERSEMENT_4_APPAREILS_2026_10_14.md`. Le vote v2 des ESP8266 et du R4 e-ink 2,9″ **n'a jamais tourné sur la carte** (⚠ NON TESTÉ dans les sources) ; celui du TFT est durci (V3-FIX1, V4, harnais hôte) mais n'a pas non plus été essayé sur la carte.

## 5. Côté serveur (branche `claude/integration-vote-reel-2026-10-14`, PAS ENCORE dans `main`)
`lib/voteCapability.ts` (`VOTE_V2_FIRMWARE`, par version de firmware déclarée) : seuls les firmwares qui savent voter en v2 comptent dans le quorum (`lib/deviceStore.ts`), reçoivent quelque chose de `/api/pull`, et peuvent voter (`/api/validation-result`, `/api/validate-candidate` : 403 sinon). Capteurs seuls hors mécanisme. Nouveaux **défauts dans le code** : `MIN_V2_APPROVALS` = 1 (`lib/chain.ts`), signature **stricte** (`STRICT_SIGNATURE`), `VOTE_ONLY_NETWORK` actif. Aucune commande Redis ajoutée. Diff total vs `main` hors firmwares/docs/tests : 7 fichiers (`docs/AUDIT_BRANCHES_2026_10_14.md` § 3).

## 6. ⚠ Production, Vercel et variables d'environnement — à ne pas confondre
- `origin/main` = `52bcc67` (inchangé depuis le 13/10). **Tant que l'intégration n'est pas fusionnée dans `main`, la production tourne avec l'ANCIEN serveur** : un vote « écho » v1 peut encore miner seul, la signature est permissive, aucun appareil n'est exclu. (Hypothèse à confirmer dans Vercel → Settings → Git : la *Production Branch* est `main`.)
- **Variables à ajouter MAINTENANT sur Vercel (environnement Production), puis redéployer** : `MIN_V2_APPROVALS` = **`1`** et `STRICT_SIGNATURE` = **`true`**. Ces deux variables existent déjà dans l'ancien code ; elles activent le vote réel sans déploiement de code. `VOTE_ONLY_NETWORK` n'existe pas dans l'ancien code (inutile avant la fusion).
- **Les valeurs `false` / `0` citées dans `docs/LOT_VOTE_REEL_COMPLET_2026_10_14.md` sont des INTERRUPTEURS D'ARRÊT** (`VOTE_ONLY_NETWORK=false`, `MIN_V2_APPROVALS=0`, `STRICT_SIGNATURE=false`) : elles DÉSACTIVENT le vote réel. Ne les ajouter qu'en cas de retour arrière. (Un malentendu a eu lieu sur ce point le 14/10 ; la note du lot a été clarifiée.)
- Après la fusion dans `main`, les deux variables (`1`, `true`) deviennent redondantes (ce sont les défauts du code) mais restent inoffensives.

## 7. Ordre de mise en service
1. Variables Vercel (§ 6) + redéploiement. 2. Téléverser les 4 appareils (les nouveaux firmwares marchent avec l'ancien serveur). 3. Journaux série + logs Redis Upstash (activés par le porteur) transmis à Claude. 4. Accord du porteur → fusion `claude/integration-vote-reel-2026-10-14` → `main` (déploiement) ; l'appareil de l'ami est alors coupé. 5. Dessin de test ; on cherche `v2 vérifié×N` ≥ 1 dans le fil d'activité.

## 8. À auditer / questions ouvertes pour GPT
1. Le vote v2 des ESP8266 et du R4 e-ink (jamais passé sur carte) : mémoire et pile pendant la lecture TLS du candidat et la signature.
2. Le firmware TFT de production (≈ 1 600 lignes d'écart avec `main`, drapeaux à 0) : code des canaris d'affichage (verts), mais chemin de vote jamais essayé sur carte.
3. Défaut connu `TFT28-ACK-STATE-FIX1` (ACK d'image ignoré en production) ; lot `REJECTED-CANDIDATE-ARCHIVE-1` (aucun code n'écrit `rejected:draws`) ; branche `claude/r4-tft28-touch-gestures-8b2e` non intégrée.
4. Choix de la liste `VOTE_V2_FIRMWARE` (versions minimales = versions actuelles du dépôt) et de l'exclusion totale (rien reçu) des firmwares sans vote v2.
5. Tests : seuls `voteCapability` (5), `castVote` (10), `eligibility` et `tsc` ont été rejoués ; test `learnRoadmap`, harnais C++ et suite complète non relancés depuis la fusion.
6. Quorum : `ceil(0,51 × appareils capables, appairés et actifs sous 45 min)` ; avec 4 appareils ⇒ 3 votes, dont au moins 1 v2.

## 9. Retour arrière
Tag `avant-vote-reel-2026-10-14` (= `main` `52bcc67`). Firmwares : `git checkout main`. Serveur après déploiement : variables d'arrêt (§ 6) ou `git revert -m 1` de la fusion. Aucune branche ni aucun dossier de travail n'a été supprimé.

## 10. Où lire
`docs/LOT_VOTE_REEL_COMPLET_2026_10_14.md` · `docs/GUIDE_TELEVERSEMENT_4_APPAREILS_2026_10_14.md` · `docs/AUDIT_BRANCHES_2026_10_14.md` · `docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md` · `docs/CANARY_R4_TFT28_AFFICHAGE_FIX2_VERDICT_2026_10_14.md` · `CLAUDE.md` (paragraphe « RÉSEAU DE VOTE RÉEL »).
