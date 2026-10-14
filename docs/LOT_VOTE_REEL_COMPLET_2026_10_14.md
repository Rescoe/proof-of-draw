# Lot « vote réel complet » — réseau de vote réel sur les 4 appareils (14/10/2026)

Décision du porteur : après une semaine de canaris, on passe à la vitesse supérieure. On lance le **vrai système de vote** (calcul local, signature, consensus) directement sur la **production**, avec les 4 appareils de test, et on audite ensuite. Cadre : `docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md` (production directe, reset global prévu, infrastructure Preview conservée en sommeil).

## 1. Ce qui est livré
**Branche d'intégration** `claude/integration-vote-reel-2026-10-14` (base : `main`), qui contient :
- le travail TFT 2,8″ (`claude/r4-tft28-vote-audit-8b2e`, V4 durci, canaris d'affichage et de vote, outils `VoteLockErase`, appairage Preview, tests) ;
- le travail ESP8266 e-ink 2,7″ + OLED (`claude/esp8266-eink27-oled-canary-8b2c`, fichier `pod_canary_flags.h` des drapeaux, build canari) ;
- les changements serveur ci-dessous.
Un seul conflit de fusion (`CLAUDE.md`, deux paragraphes ajoutés des deux côtés) : les deux conservés. La branche des gestes tactiles n'est **pas** intégrée (hors périmètre).

**Aucun drapeau de canari à régler** : tous valent 0 dans le dépôt (`POD_CANARY`, `POD_RENDER_V1`, `POD_VOTE_V1`, `POD_VOTE_CANARY`, `POD_PREVIEW_ENROLL`). Compiler les sketches **tels quels** produit le firmware de production, qui **contient le vote v2** (`doValidateV2` : recalcul du hash et des métriques sur l'appareil, signature Ed25519, POST `/api/validation-result`). Les canaris (qui retiraient le vote) ne sont plus utilisés pour cette campagne.

## 2. Les 4 appareils à flasher (dossier principal, avec vos `secrets.h` déjà en place)
| Appareil | Sketch (Arduino IDE) | Firmware déclaré |
|---|---|---|
| UNO R4 + TFT 2,8″ tactile | `arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino` | `r4tft28-2.5` |
| ESP8266 e-ink 2,7″ + OLED | `esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino` | `multiscreen-2.5` |
| ESP8266 e-ink 2,9″ BWR | `esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino` | `eink29bwr-2.3` (était « 2.2 » : version nue, non reconnaissable) |
| UNO R4 + e-ink 2,9″ BWR | `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` | `r4eink29-1.1` |
Cartes : « Arduino UNO R4 WiFi » pour les deux R4, « NodeMCU 1.0 (ESP-12E) » ou équivalent habituel pour les ESP8266.

## 3. Ce qui change côté app (serveur)
Nouveau module `lib/voteCapability.ts` (pur, testé). Un appareil est **capable de voter** si son **firmware déclaré** (champ de `/api/register`) est dans `VOTE_V2_FIRMWARE` à une version ≥ la minimale (celle du dépôt aujourd'hui : `r4tft28` 2.5, `multiscreen` 2.5, `eink27bw` 2.1, `eink29bwr` 2.3, `tft18` 2.4, `r4eink29` / `r4eink27` / `r4multiscreen` / `r4tft18` 1.1). Un appareil **non capable** (ancien firmware, version nue, inconnu) :
- **n'est plus compté dans le quorum** (`getGlobalActiveCount`, `getPoolSnapshot`) ;
- **ne reçoit plus rien de `/api/pull`** : pas d'image, pas de bloc, pas de candidat, `retryAfter` 1 800 s et la note « firmware sans vote v2 : mise à jour requise » ; aucune écriture de présence ;
- **ne s'exprime plus** : `/api/validation-result` et `/api/validate-candidate` répondent **403** (`firmware-not-vote-capable`).
Les **capteurs seuls** (`screens = ["sensor"]`) sont hors de ce mécanisme.
Valeurs par défaut du **vote réel** (variables Vercel facultatives, retour arrière instantané) :
| Réglage | Nouveau défaut (dans le code) | Avant | Valeur qui DÉSACTIVE (interrupteur d'arrêt : NE PAS l'ajouter, sauf retour arrière) |
|---|---|---|---|
| `VOTE_ONLY_NETWORK` | actif | (n'existait pas) | `false` |
| `MIN_V2_APPROVALS` | **1** : un bloc exige au moins une approbation v2 (vote recalculé) ; un « écho » v1 ne suffit plus | 0 | `0` |
| `STRICT_SIGNATURE` | **strict** : signature Ed25519 invalide = vote refusé | permissif | `false` |
⚠ **Variables Vercel à ajouter MAINTENANT (avant la fusion dans `main`, ancien serveur) : `MIN_V2_APPROVALS=1` et `STRICT_SIGNATURE=true`, puis redéployer.** Les valeurs `false` / `0` de la dernière colonne désactivent le vote réel : ne les ajouter qu'en cas de retour arrière. Voir `docs/NOTE_POUR_GPT_ETAT_VOTE_REEL_2026_10_14.md` § 6.
Coût Redis : **aucune commande ajoutée** (les contrôles utilisent le `MGET` déjà fait).

## 4. Ordre de mise en service (important)
1. **Flasher d'abord les 4 appareils** (§ 2) : leurs nouveaux firmwares fonctionnent avec l'ancien serveur.
2. **Puis déployer** la branche d'intégration (fusion dans `main` ⇒ déploiement Vercel). Dès le déploiement, tout appareil au firmware **plus ancien** (dont celui de l'ami) est coupé ; un des 4 non reflashé le serait aussi.
3. Envoyer un dessin ; suivre le journal série de chaque appareil et le fil d'activité de l'app : `PULL … v2 vérifié×N · v1 écho×M`.

## 5. Ce qu'on doit observer
- Sur chaque appareil : `[VALIDATE2]` (ou `[VALIDATE]` + `candidat v2`), lecture du candidat, `vote envoyé`, puis le bloc affiché.
- Dans l'app : `v2 vérifié×N` > 0 (au moins 1) ; bloc miné quand `votes ≥ ceil(0,51 × appareils capables actifs)`.
- Si **aucun** bloc ne se mine : le candidat expire (30 min) — cause probable : aucun vote v2 accepté (signature refusée 403 sur un ESP8266, métriques différentes 422, appareil non reconnu). Le journal série de l'appareil donne la raison (`[VALIDATE2] Echec vote …`). Réglage d'urgence : `STRICT_SIGNATURE=false` puis, si besoin, `MIN_V2_APPROVALS=0`.

## 6. Limites connues (assumées, on ajuste ensuite)
- Les chemins de vote v2 des **ESP8266** et des **R4 e-ink** ne sont **jamais passés sur la carte** (marqués ⚠ NON TESTÉ dans les sources) ; seul le vote du **TFT 2,8″** est durci (V3-FIX1, V4, harnais hôte, mais non essayé sur la carte non plus). C'est précisément ce que ce test révèle.
- **TFT 2,8″, défaut d'ACK de production** (lot `TFT28-ACK-STATE-FIX1`, non corrigé) : si l'ACK d'une image échoue, l'écran la considère acquittée localement. Sans conséquence sur le vote.
- L'appareil de l'ami (ancien firmware) est exclu, volontairement.
- Pas d'archive des candidats rejetés (lot `REJECTED-CANDIDATE-ARCHIVE-1`) : un candidat refusé disparaît.
- Vérifications faites : `tests/voteCapability.test.ts` (5), `tests/castVote.test.ts` (10, mis à jour pour le nouveau défaut), `tests/eligibility.test.ts`, `tsc` propre. **La suite complète et les harnais C++ n'ont pas été rejoués** (choix du porteur : vitesse) ; le seul changement de firmware est la chaîne de version de l'ESP 2,9″ BWR (une ligne, non recompilée ici).

## 7. Retour arrière
Serveur : variables Vercel `VOTE_ONLY_NETWORK=false`, `MIN_V2_APPROVALS=0`, `STRICT_SIGNATURE=false` (redéploiement) ; ou `git revert` du commit du lot. Firmware : reflasher la version précédente du sketch.
