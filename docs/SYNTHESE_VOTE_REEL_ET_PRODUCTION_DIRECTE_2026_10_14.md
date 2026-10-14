# Synthèse — vote réel sur matériel, production directe (14/10/2026)

**À lire en premier pour reprendre l'orchestration.** Elle résume tout ce qui a été accompli le 14/10/2026 par le porteur et Claude, avec les preuves, l'état exact du code et de la production, les décisions, et ce qu'il reste à auditer. Les documents détaillés sont listés au § 10. Tout ce qui est affirmé ici vient du dépôt, de journaux série ou de l'export Redis (`MONITOR`) ; ce qui est une hypothèse est marqué « hypothèse ».

## 1. Résumé en cinq lignes
1. Le **vote réel** (chaque appareil recalcule le contenu, signe en Ed25519, le serveur compare à ses propres chiffres) **fonctionne sur le matériel** : **deux blocs consécutifs (#100 et #101) ont été minés avec des votes v2 de trois familles d'appareils** — R4 e-ink 2,9″, R4 TFT 2,8″ et ESP8266 e-ink 2,9″.
2. Les canaris (une semaine de travail, de nombreux lots) sont **abandonnés pour cette campagne** : on teste en **production directe** avec les **firmwares de production** (tous drapeaux de canari à 0, vote v2 compilé).
3. Le code serveur « réseau de vote réel » est **prêt mais PAS ENCORE DÉPLOYÉ** : `origin/main` = `52bcc67` (inchangé). Les blocs #100 et #101 ont été minés par l'**ancien serveur** avec deux variables Vercel (`MIN_V2_APPROVALS=1`, `STRICT_SIGNATURE=true`, posées par le porteur).
4. Le déploiement est la dernière étape : fusion locale faite dans `main` (`6688456`), **push refusé par l'outil de permissions de Claude Code** ; le porteur doit lancer `git push origin main` (ou autoriser la règle).
5. Rien n'a été supprimé : toutes les branches, le travail Preview « en sommeil » et le tag de retour arrière `avant-vote-reel-2026-10-14` (= `main` `52bcc67`) existent.

## 2. Décisions du porteur
- **Production directe jusqu'à nouvel ordre** (projet expérimental, aucun utilisateur externe, reset global des données prévu avant exploitation) : `docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md`. Phrase de bascule : « réactiver les tests isolés ».
- **Vote complet sur 4 appareils** plutôt que canari à tentative unique : TFT 2,8″ tactile (R4), multiscreen (ESP8266 e-ink 2,7″ + OLED), ESP8266 e-ink 2,9″ BWR, R4 e-ink 2,9″ BWR.
- **Les appareils qui ne savent pas voter en v2 ne reçoivent plus rien et ne s'expriment plus** (dont l'ancien appareil d'un ami).
- **Aucun travail Preview supprimé ni déprécié** (`TFT28-PREVIEW-ENROLL-1`, protocole d'isolation, contrôles `NEXT_PUBLIC_BASE_URL`, secrets Preview).
- Rythme : moins de précautions, pas de grandes suites de tests ; **audit de GPT après coup**.

## 3. Chronologie de ce qui a été fait (commits poussés sur `origin`)
| Étape | Commits | Résumé |
|---|---|---|
| Canari de vote V4 durci (TFT) | `ead25cd`, `c52ecea`, `4800451` | pas d'écran / tactile / SD dans le build de vote (preuve de portée source + ELF), arrêt propre sur carte non appairée, 27 mutants de test |
| Canari d'affichage TFT : **VERT sur la carte** | `4e6f548` | frame personnelle 153 600 o, animation 18 images, toucher, marges de pile ≥ 192 o ; journal brut archivé |
| Appairage Preview (en sommeil) | `fb727d3` | mini-firmware sans écran ni vote, hôte dans un fichier local |
| Canari de vote sur la production (consentement local) | `c23c328` | `POD_VOTE_ALLOW_PRODUCTION`, vérificateur de sauvegarde du candidat ; **finalement non utilisé** |
| Intégration des branches | `7375675`, `788b23f` | TFT (vote-audit) + ESP8266 2,7″+OLED dans une branche basée sur `main` |
| **Réseau de vote réel (serveur)** | `47b9b1e` | voir § 5 |
| Guide, audit des branches, mesures | `4e4ae7c`, `3393603`, `4ec96e0`, `979a5f5`, `26dc6f5` | `docs/GUIDE_TELEVERSEMENT_…`, `docs/AUDIT_BRANCHES_…`, `docs/MESURES_DEMARRAGE_…` |
| Correctifs d'affichage et d'appairage | `e5adea1` | voir § 6 |
| Fusion dans `main` (locale) | `6688456` | **non poussée** |
Branche d'intégration : `claude/integration-vote-reel-2026-10-14`. Les dossiers `A_TELEVERSER/` (copies locales des 4 sketches avec `secrets.h`) sont **ignorés par git**.

## 4. Preuves sur le matériel (export Redis `MONITOR`, 15:14 → 18:08, ~2 050 commandes)
| Bloc | Candidat | Quorum | Votes (heure) | Résultat |
|---|---|---|---|---|
| **#99** | dessin envoyé alors que la TFT était hors ligne | poolSize 1 | un seul appareil (ancien firmware de l'ami), vote **écho v1** | miné par un simple écho : c'est l'épisode qui a motivé `MIN_V2_APPROVALS=1` |
| **#100** | « Vote fleur », OLED, créé par le multiscreen 15:56:52 | poolSize 3 → **2** | **R4 e-ink 2,9″ v2** (+42 s), **TFT 2,8″ v2** (+4 min 40) | miné 16:01:33, `votesSummary {v2:2, v1:0}`, validateurs = TFT + R4 e-ink ; réobservation de 5 blocs confirmée |
| **#101** | « 101 », e-ink 2,9″, créé par le R4 e-ink 16:56:15 | poolSize 5 → **3** | R4 e-ink **v2** (16:57:48, l'auteur lui-même), ancien appareil de l'ami **écho v1** (17:03:01), **ESP8266 2,9″ BWR v2** (17:04:09) | miné 17:04:10, `votesSummary {v2:2, v1:1}`, `obsConfirmed:true` à 17:06:14 |
- Dans les blocs #100 et #101, **les chiffres recalculés par les appareils (entropie, transitions, RLE, score en ppm) sont strictement égaux à ceux du serveur** ; chaque vote porte `v:2`, `verdict:accept` et une signature Ed25519 (la vérification stricte côté serveur n'est pas observable dans Redis ; elle est en vigueur si `STRICT_SIGNATURE=true` l'est, ce que le porteur dit avoir réglé).
- **Premier vote v2 d'un ESP8266 sur la carte** : `dev_MN67OG7R` (e-ink 2,9″) a tiré à 17:03:34 (réveil après un sommeil de 15 min), puis voté 35 s plus tard (`VALIDATE_INTERVAL` 30 s). Le multiscreen n'a pas encore voté (auteur du #100, endormi pendant le #101).
- **Diffusion du #101** : frames posées pour 13 entrées de pools (dont 9 autres e-ink 2,9″, un TFT 1,8″), frames personnelles de ces pools supprimées (17:04:12). Les 4 appareils du porteur ont **tous accusé l'affichage** : OLED du multiscreen 17:05:00, R4 e-ink 17:05:11, ESP 2,9″ 17:06:00, e-ink 2,7″ 17:06:07, **TFT 17:08:19** (4 min après la pose de sa frame : cause non étudiée), ancien appareil de l'ami 17:09:50.
- **Démarrage des 4 appareils** (journaux série) : tous reconnus par le serveur avec leurs versions (`r4tft28-2.5`, `multiscreen-2.5`, `eink29bwr-2.3`, `r4eink29-1.1`) ; `register` 200, auto-test Ed25519 OK (TFT 177 ms), premier pull, ACK 200. Détails : `docs/MESURES_DEMARRAGE_4_APPAREILS_VOTE_REEL_2026_10_14.md`.
- **Budget Redis** : 621 / 1 118 / 259 / 51 commandes par heure (15h – 18h), les pics viennent de pages web ouvertes (lectures `chain:image`) ; au repos ≈ 50 – 260 par heure pour ~13 appareils.

## 5. Côté serveur (sur la branche, **pas encore en production**)
- `lib/voteCapability.ts` : liste `VOTE_V2_FIRMWARE` (préfixe → version minimale : `r4tft28` 2.5, `multiscreen` 2.5, `eink27bw` 2.1, `eink29bwr` 2.3, `tft18` 2.4, `r4eink29` / `r4eink27` / `r4multiscreen` / `r4tft18` 1.1). Un firmware absent de la liste (ancien, version nue, inconnu) :
  - n'est **plus compté dans le quorum** (`lib/deviceStore.ts`) ;
  - **ne reçoit rien** de `/api/pull` (`app/api/pull/route.ts` : pas d'image, pas de bloc, pas de candidat, `retryAfter` 1 800) ;
  - **ne peut pas voter** (`/api/validation-result`, `/api/validate-candidate` : 403 `firmware-not-vote-capable`).
  Capteurs seuls hors mécanisme. Interrupteur : `VOTE_ONLY_NETWORK=false`.
- **Défauts du vote réel** (dans le code) : `MIN_V2_APPROVALS` = **1** (`lib/chain.ts` : un vote écho v1 ne suffit plus à miner un candidat porteur d'une spécification v2), `STRICT_SIGNATURE` = **strict**.
- **Variables Vercel actuelles côté porteur** : `MIN_V2_APPROVALS=1`, `STRICT_SIGNATURE=true` (équivalent des défauts, valable aussi pour l'ancien code). ⚠ Les valeurs `false` / `0` citées dans certains documents sont les **interrupteurs d'arrêt**, à ne pas poser (malentendu corrigé le 14/10).
- Aucune commande Redis ajoutée par ces contrôles. Diff serveur total vs `main` : 7 fichiers hors firmwares/docs/tests (`docs/AUDIT_BRANCHES_2026_10_14.md` § 3).

## 6. Correctifs d'affichage et d'appairage (commit `e5adea1`, pas encore en production)
- **Dessin privé qui revenait / restait bloqué** : `lib/personalFrame.ts` + `/api/pull` (un e-ink qui a déjà reçu sa frame personnelle ne la reçoit plus après un Reset ; plus de repeinture inutile ni de réapparition d'un vieux dessin) ; `/api/ack-frame` (l'accusé d'une frame du consensus supprime la frame personnelle obsolète, 0 commande s'il n'y en a pas). Un écran sans « conversion 1/1 » ne reçoit pas les blocs d'autres écrans : réglage de l'appareil, pas un défaut.
- **Votes visibles** : ligne « Votes : v2 vérifié ×N · écho ×M · refus ×K » dans le détail d'un bloc et le panneau réseau (à partir de `votesSummary` déjà stocké dans le bloc).
- **Appairage depuis un navigateur intégré** (Snapchat, Instagram, Facebook, TikTok…) : avertissement sur `/onboard` ; la récupération d'un profil avec le code de jumelage existait déjà côté serveur. Le cookie de session est correct (400 jours).
- Tests ciblés ajoutés ou ajustés ; `tsc` propre.

## 7. Firmwares (les 4 appareils)
Sketches compilés **sans aucun drapeau** (`POD_CANARY`, `POD_RENDER_V1`, `POD_VOTE_V1`, `POD_VOTE_CANARY`, `POD_PREVIEW_ENROLL` = 0, dont `esp8266/esp_eink_2.7BW_OLED/pod_canary_flags.h`) : `arduino_uno_r4/pod_uno_r4` (TFT), `esp8266/esp_eink_2.7BW_OLED`, `esp8266/esp_eink_2.9BWR` (déclare désormais `eink29bwr-2.3`, était « 2.2 »), `arduino_uno_r4/pod_uno_r4_eink29`. Le texte du firmware TFT avec les drapeaux à 0 est identique à V3-FIX1 (test d'identité). Écart du TFT avec l'ancien `main` : ≈ 1 600 lignes (client TLS borné, piles dédiées, vote durci).

## 8. Ce qu'il reste à auditer ou à faire (par ordre d'importance)
1. **Déployer** (`git push origin main`) puis vérifier dans Vercel que la *Production Branch* est bien `main`, que le déploiement passe, et que `v2 vérifié` / `écho` s'affichent. **Effet attendu à l'instant du push** : les appareils hors liste (au moins `dev_T46HBXG1` firmware `2.0`, probablement aussi `dev_WZ0U0514`, `dev_7GUJIOCM`, `dev_HF615EF9`, `dev_YIALM6LG`, `dev_0HWXIKJM`, `dev_3XLCW1KO` — e-ink 2,9″ —, `dev_VIRBQRV1` — TFT 1,8″ —, plusieurs OLED) cessent de recevoir et de voter ; ils gardent leur dernière image. À classer (à qui, quel firmware) ; retour en une variable (`VOTE_ONLY_NETWORK=false`).
2. **Auteur qui vote pour son propre candidat** : dans le #101 le R4 e-ink est auteur ET validateur ; l'éligibilité (`ELIGIBILITY_MODE`) est à `off` en production. Tous les appareils du porteur partagent un même profil : la notion de profils indépendants n'est pas évaluable.
3. **Vote des deux familles encore non observées** : multiscreen (OLED + e-ink 2,7″) n'a jamais voté. Le vote du TFT a eu lieu mais plus de 4 minutes après le candidat ; son affichage du #101 a pris ≈ 4 minutes (causes non étudiées).
4. **Rythme de réveil** : au repos le serveur répond `retryAfter` 900 s (`PULL_DORMANT_SEC`) ; les ESP8266 ne voient donc un candidat qu'au bout de 5 à 15 min (il vit 30 min). Levier non touché : `PULL_DORMANT_SEC=300` (≈ ×3 de pulls de repos).
5. Défauts connus hors périmètre : ACK d'image TFT ignoré en production (`TFT28-ACK-STATE-FIX1`) ; aucune archive des candidats refusés (`rejected:draws` n'a pas d'écrivain, `REJECTED-CANDIDATE-ARCHIVE-1`) ; ESP 2,9″ : `e-Paper busy TIMEOUT` ×3 au rafraîchissement (l'image s'affiche) ; branche des gestes tactiles non intégrée.
6. **Tests** : la suite complète n'a **pas** été rejouée sur la branche finale (choix du porteur) ; tests ciblés rejoués (`voteCapability`, `castVote`, `personalFrame`, `displayState`, `esp8266Eink29Canary`, `renderFirmware`, `tft28Canary`, `eligibility`) et `tsc` propres. Le test `learnRoadmap` et les harnais C++ n'ont pas été relancés depuis la fusion.
7. Liste `VOTE_V2_FIRMWARE` : à mettre à jour pour toute nouvelle version de firmware qui sait voter (sinon l'appareil est coupé).

## 9. Retour arrière
Tag `avant-vote-reel-2026-10-14`. Firmwares : `git checkout main` rétablit les anciens sketches (les `secrets.h` ignorés ne bougent pas). Serveur après déploiement : variables Vercel `VOTE_ONLY_NETWORK=false`, `MIN_V2_APPROVALS=0`, `STRICT_SIGNATURE=false` + redéploiement, ou `git revert -m 1` de la fusion. Aucune donnée n'est supprimée par ces changements.

## 10. Où lire (dans le dépôt)
`docs/NOTE_POUR_GPT_ETAT_VOTE_REEL_2026_10_14.md` (note de situation, § 11 correctifs) · `docs/LOT_VOTE_REEL_COMPLET_2026_10_14.md` (serveur, appareils, ordre de mise en service) · `docs/GUIDE_TELEVERSEMENT_4_APPAREILS_2026_10_14.md` · `docs/AUDIT_BRANCHES_2026_10_14.md` · `docs/MESURES_DEMARRAGE_4_APPAREILS_VOTE_REEL_2026_10_14.md` (relevés §§ 1 – 7) · `docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md` · `docs/CANARY_R4_TFT28_AFFICHAGE_FIX2_VERDICT_2026_10_14.md` · `docs/LOT_TFT28_PREVIEW_ENROLL_1_2026_10_14.md` · `docs/LOT_TFT28_PROD_VOTE_CANARY_1_2026_10_14.md` · `CLAUDE.md` (paragraphe « RÉSEAU DE VOTE RÉEL »).
