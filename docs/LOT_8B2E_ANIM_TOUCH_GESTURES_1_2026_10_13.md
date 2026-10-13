# LOT8B2E — ANIM-TOUCH-GESTURES-1 : appui court / appui long pendant une animation (UNO R4 + TFT 2,8″) — 13 octobre 2026

**Base :** `1ed3393` (spécification `docs/SPEC_TFT28_GESTES_TACTILES_ANIMATION_2026_10_13.md`), branche `claude/r4-tft28-touch-gestures-8b2e`, worktree séparé. **Périmètre :** `arduino_uno_r4/pod_uno_r4/` SEUL. **État :** compilé (cœurs 1.5.3 et 1.6.0, production et canari) + hôte ; **JAMAIS flashé**. `POD_RENDER_V1 = 0`, `POD_CANARY = 0` dans le commit. Aucun changement de vote, serveur, protocole, Redis, Neon, OTA ni d'archive distribuée. Sauvegarde du `.ino` d'avant : `firmware-backups/2026-10-13_avant-gestes-tactiles-tft28/`.

## 1. Comportement

| Geste | Animation en lecture | Animation en pause | Image fixe |
|---|---|---|---|
| **appui court** (relâché avant 650 ms) | cartel affiché / masqué **sur place, la lecture continue** | cartel affiché / masqué, **sans reprendre** | cartel affiché / masqué |
| **appui long** (≥ 650 ms, agit dès le seuil) | pause sur l'affiche fixe + cartel (clip fermé avant la restauration SD) | **reprise**, cartel masqué (bandes restaurées depuis la carte avant la reprise) | une seule bascule du cartel |
| rien pendant 60 s en pause | — | reprise automatique (plein écran, sans cartel : comportement d'avant) | — |

Un contact = **une** action : le relâchement d'un appui long ne produit rien (verrou `touchHold` : ≈ 3 tours de `loop` de relâchement stable avant tout nouveau geste).

## 2. Conception
- `pod_touch_gesture.h` (NOUVEAU, propre à ce dossier) : classificateur **pur** `podTouchStep(état, posé?, maintenant)` → `PG_NONE / PG_SHORT / PG_LONG`, état de 12 o posé par l'appelant sur sa pile ; aucun `String`, aucune allocation, aucun état global ; temps en `uint32_t` (le dépassement de `millis()` est sans effet). Seuils : 650 ms (long), 20 ms (contact minimal), 30 ms (relâchement stable : anti-rebond), interrogation toutes les 20 ms. `podTouchAction(geste, animOn, animPaused)` décide l'action (12 combinaisons testées).
- **Pendant la lecture** (crochet de `runResidentAnim`, sur la pile SD dédiée) : interrogation toutes les 20 ms (200 ms avant), uniquement dans l'attente entre deux images — jamais pendant une transaction TFT. Court → `animCartelToggleLive()` : TFT seulement (cartel dessiné, ou bandes remises au fond de l'animation `animBg`), **aucune lecture SD, aucun journal, aucune allocation** ; compte rendu journalisé APRÈS la lecture. Long → `AE_TOUCH`, sortie de la lecture (fichier fermé), puis `loop()` appelle `onAnimTouch()` (restauration SD + cartel).
- **Bandes** : le cartel occupe `y 0..39` et `y 272..319`, l'animation `y 100..219` : jamais de chevauchement. Au démarrage d'une lecture, cartel visible → seule la zone centrale (`y 40..271`) est effacée ; sinon `fillScreen` comme avant.
- `serviceTouch()` (redéfini après `onAnimTouch`) : classe un contact entre deux lectures (image fixe, pause, contact encore posé à la fin d'un budget) ; tous les accès SD / TFT passent par `toggleCartel` / `onAnimTouch`, donc `onSd`. Un contact vu HORS lecture alors que l'animation est « en cours » (état de l'écran inconnu) donne la pause avec cartel, jamais une action hasardeuse sur l'écran.
- Modifications de fonctions existantes : `toggleCartelImpl` (masquer le cartel ne reprend plus l'animation), `onAnimTouchImpl` (message), `loop` (60 s : sans cartel), globales `animBg` (2 o) et `touchHold` (1 o).

## 3. Preuves
| Preuve | Résultat |
|---|---|
| `tests/touchGestures.test.ts` — harnais C++ exhaustif du classificateur (`consensus-pod/host/touch_gesture_harness.cpp`, modèle de référence indépendant, constantes de la spécification) | durées 0 – 2 500 ms au pas de 1 ms × 6 cadences (5 – 50 ms) × 3 phases × 4 bases dont le **dépassement de `millis()`** : au plus UNE action, égale au modèle ; seuil exact 649 / 650 ms ; rebonds < 30 ms = même contact, ≥ 100 ms = deux contacts ; parasite d'un échantillon = rien ; table des actions |
| mêmes tests — **12 mutants du classificateur** refusés | seuils 649 / 651, verrou « déjà agi » absent, court après long, anti-rebond absent, bruit accepté, dépassement de `millis()`, table inversée, etc. |
| mêmes tests — propriétés **statiques** du sketch + **14 mutants** refusés | classificateur local, crochet à 20 ms, long = sortie + verrou, court = bascule sur place sans SD ni journal ni tas, démarrage qui préserve le cartel, aucune restauration SD dans la lecture, `serviceTouch` sans accès direct SD / TFT, masquer ne reprend pas, 60 s sans cartel |
| `tests/tft28Host.test.ts` § 15c — firmware COMPLET, temps virtuel, contacts scriptés (mock `touched()` par intervalles, rebonds) | court pendant la lecture (la lecture continue, aucun fichier ouvert pour le cartel, aucune requête), second court (bandes au fond de l'animation), **long : clip fermé avant la restauration, `maxOpen ≤ 1`, relâchement sans seconde action**, pause + court (sans reprise), pause + long (reprise, bandes restaurées, verrou), image fixe (une seule bascule), seuil 600 / 700 ms, rebond, parasite, budget respecté sous contact maintenu, **bandes intactes à la lecture suivante** ; production **173** contrôles, canari **164** |
| mêmes tests — **8 mutants du firmware complet** refusés | court qui interrompt, cartel effacé au démarrage, long sans sortie, sans verrou (court fantôme), masquer qui reprend, reprise sans restauration des bandes, fond erroné, seuil ignoré |
| Compilations réelles (arduino-cli 1.4.1, chaîne Arduino gcc 7.2.1), 1.5.3 et 1.6.0, production et canari | OK, aucun avertissement du sketch ; flash +624 o ; RAM statique 21 468 / 21 464 o **inchangée** |
| Analyse statique de pile | lecture (pile SD, budget 1 344 o) : **792 → 816 o** ; validation 752 o et téléchargement 1 040 o inchangés ; pile principale : seul `runResidentAnim` change (marge 552 o) ; aucune voie de vote touchée |
| Suites statiques et classe (118 tests : tft28Canary / AnimStream / RegisterStack, netStack, wifiCalls, edStack, validate/dopull/registerJsonStack, benchHeaderCopies, animClip, touchGestures) | 118 / 118 |

Tests existants adaptés (intentionnellement) : `tft28Canary.test.ts` (liste des fonctions autorisées à changer : `serviceTouch`, `loop` ; corps de `toggleCartelImpl` et `onAnimTouchImpl` = original MOINS les deux modifications voulues, vérifiées), `tft28AnimStream.test.ts` (le compte rendu journalisé entre `free(work)` et le retour), `tft28Host.test.ts` (en-tête copié dans le harnais ; mutants ajoutés).

## 4. Ce qui N'EST PAS prouvé
1. **Rien n'a tourné sur la carte.** Débit de l'interrogation à 20 ms, ressenti des seuils (650 ms), fluidité de la lecture pendant l'affichage du cartel (un `drawCartel` en direct retarde UNE image ; l'horloge de lecture est absolue, elle rattrape), durée visible de la restauration SD à l'appui long (≈ 150 Ko relus), comportement du STMPE610 (rebonds réels).
2. **Marge de la pile SD pendant le geste** : 816 / 1 344 en statique ; les appels indirects (Adafruit, STMPE610) ne sont pas suivis ; le canari mesure `animPlay` (avant : 644 o de marge).
3. Un contact commencé juste avant la fin du budget de lecture (prochaine tâche réseau) peut être perdu si le doigt se lève pendant la tâche réseau.
4. Au redémarrage d'une lecture (à chaque cycle de pull, comme avant), l'animation repart à l'image 0 avec le cartel conservé ; un bref scintillement de la zone centrale est possible.
5. `tests/boundedSsl.test.ts` (2 échecs : `0xC0000374`, corruption de tas du harnais WiFiS3 compilé avec g++ 14.2) **échoue à l'identique sur la branche gelée** : indépendant de ce lot, non traité.

## 5. Protocole du canari tactile (porteur ; à n'exécuter qu'après audit GPT)
Build local `-DPOD_RENDER_V1=1 -DPOD_CANARY=1` (jamais commité) ; retour arrière : binaire du canari animation précédent. Sans vote, sans candidat.
1. Démarrage ; l'animation tourne 2 minutes sans toucher (rien ne doit changer).
2. **Appui court** : le cartel apparaît, l'animation continue ; relever `[TOUCH] appui court pendant la lecture : cartel affiché 1 fois…` (journalisé après la lecture, à la fin du budget). **Second appui court** : le cartel disparaît, l'animation continue.
3. **Appui long** (≈ 1 s) : l'animation s'arrête sur l'affiche, le cartel est affiché ; relever `[ANIM] pause (appui long)` et **l'absence** de `[TOUCH] cartel masqué` au relâchement.
4. En pause : appui court → cartel masqué/affiché, **toujours en pause** ; appui long → reprise, cartel masqué (`[ANIM] reprise (appui long)`).
5. En pause sans rien faire 60 s : `[ANIM] reprise (60 s)`.
6. Laisser 3 pulls en lecture, cartel affiché : il reste affiché à chaque redémarrage de lecture.
7. Relever : `[CANARY] pile sd/tft animPlay` (≥ 128 o, objectif 256), pile principale minimale, tas et plus grand bloc après chaque pull.
Arrêt immédiat : marge < 128 o, reset, écran corrompu, action double sur un seul contact, cartel qui chevauche l'animation.

## 6. FIX1 (audit GPT de `c98168e`) — 13 octobre 2026
**Deux défauts corrigés, un commit étroit.** Sauvegarde du `.ino` d'avant : `firmware-backups/2026-10-13_avant-gestes-tactiles-tft28-fix1/`.

1. **Un appui COURT hors du lecteur ne met plus l'animation en pause.** Avant : `serviceTouch` envoyait `PTA_TOGGLE_PLAYING` vers `onAnimTouch()` (pause). Maintenant `toggleCartelWhilePlaying()` : cartel basculé, `animPaused` **inchangé** (faux), l'animation continue au tour suivant. Deux cas, un seul `onSd` chacun : champ d'animation à l'écran (`animBgValid`, posé au démarrage de la lecture, retombé quand l'affiche le remplace : pause, nouvelle image, restauration au démarrage) → bascule **TFT seule** sur la pile SD dédiée (aucune carte, aucun réseau, aucune allocation, aucun journal ; chaîne statique 256 o sur 1 344) ; sinon l'écran montre l'affiche → bascule habituelle (`toggleCartel`, masquage depuis la carte). `onAnimTouch()` ne reste appelé que pour l'appui LONG.
2. **Verrou de relâchement TEMPOREL** (`PodTouchLatch`, 8 o, dans `pod_touch_gesture.h`) à la place de `touchHold` (« 3 tours de loop »). Il se lève sur le second échantillon « relâché » séparé d'au moins `POD_TOUCH_RELEASE_STABLE_MS` (30 ms) du premier, sans échantillon « posé » entre eux : **29 ms insuffisent, 30 ms suffisent** ; un rebond remet la série à zéro ; `uint32_t` (dépassement de `millis()` sans effet) ; un doigt maintenu ne le lève jamais.

**Preuves ajoutées.** Harnais pur : frontière 29 / 30 ms du classificateur et du verrou, rebonds, dépassement de `millis()` (base `0xFFFFFFF0` incluse), 7 mutants de plus refusés (19 au total). Firmware complet (temps virtuel, contacts scriptés ; mock en arithmétique modulaire 32 bits) : G12 appui court hors du lecteur, champ à l'écran (aucun fichier ouvert, aucune requête, cartel basculé, `animPaused` faux, lecture suivante avec cartel et bandes intactes, second appui masque) ; G13b idem avec l'affiche à l'écran ; G14 contact commencé pendant une fenêtre réseau (`doPull`) ; G15 rebond de 25 ms échantillonné après un appui long (aucune seconde action, verrou levé ensuite) et relâchement de 200 ms puis NOUVEL appui court (exactement une action) ; G16 appui court puis appui long de part et d'autre du dépassement de `millis()` ; 4 mutants de plus refusés (appui court = pause, verrou ignoré, `animBgValid` jamais posé, verrou levé dès le premier échantillon). Harnais : production **187** contrôles, canari **178**.

**Mesures (arduino-cli 1.4.1, gcc 7.2.1, cœurs 1.5.3 et 1.6.0, production et canari : 4 / 4 sans avertissement du sketch).** Flash 158 372 o production / 150 504 o canari (+192 o par rapport à `c98168e`) ; RAM statique **21 476 / 21 472 o (+8 o)** (verrou 8 o + `animBgValid`, moins `touchHold`). Piles : lecture 816 o, validation 752 o, téléchargement 1 040 o **inchangées** ; bascule en direct 256 o sur la pile SD ; pile principale : seul `toggleCartel` (désormais inliné) change dans le rapport. Tests : 136 sous-tests ciblés (dont tft28Host avec tous ses mutants, tft28Canary, tft28AnimStream, touchGestures, animStream, RegisterStack, netStack, wifiCalls, edStack, validate/dopull/registerJsonStack, benchHeaderCopies, animClip), 134 verts au premier passage + 2 tests d'identité du canari adaptés (les trois lignes `animBgValid = false` voulues) et relancés : verts. `POD_RENDER_V1 = 0` et `POD_CANARY = 0` au dépôt. Limites inchangées : rien n'a tourné sur la carte.
