# LOT8B2D-R4-TFT28-CANARY-1 — canari SANS VOTE pour l'UNO R4 WiFi + TFT 2,8″ tactile (12/10/2026)

| | |
|---|---|
| **Cible unique** | `arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino` — UNO R4 WiFi + shield TFT 2,8″ (ILI9341 240×320, tactile STMPE610, microSD). Aucune autre carte, aucun autre dossier de firmware. |
| **Base** | `origin/main` `3239d2e` (sauvegarde du sketch d'avant : `firmware-backups/2026-10-12_avant-canari-tft28/pod_uno_r4.ino`, SHA-256 figé par test). Branche `claude/r4-tft28-canary-8b2d`, isolée des branches ESP8266 et R4 e-ink 2,7″. |
| **Statut** | **Compilé (cœurs Renesas 1.5.3 ET 1.6.0) et exécuté sur l'HÔTE contre le vrai code. JAMAIS FLASHÉ.** Aucun essai sur carte, aucun déploiement, aucune fusion dans `main`. |
| **Drapeaux au dépôt** | `POD_CANARY = 0`, `POD_RENDER_V1 = 0` (testé). `POD_RENDER_V1` est **sans effet** sur ce firmware : le TFT 2,8″ n'a pas de cartel gravé ni de rasteriseur v1. |
| **Budget** | Redis **+0**, Neon 0, aucune route, aucun polling, aucun changement serveur / protocole / vote / ACK / OTA. |
| **Suite** | arrêt pour audit GPT/Codex ; canari matériel **sans vote** ensuite (§ 6) ; le vote est un lot ultérieur (§ 9). |

## 1. Ce que le lot fait, et ce qu'il ne fait pas

**Fait** — préparer un canari **sans vote** capable de recevoir une frame personnelle réelle, de l'afficher en 240×320 RGB565, de la ranger sur la carte SD, de gérer le toucher (cartel) et les animations, et de l'acquitter — avec la mémoire de pile sécurisée sur tous les chemins que ce canari exerce.

**Ne fait pas** — aucun vote (ni v1 ni v2), aucune confirmation d'observation, aucun changement de polling, aucune correction du défaut connu « frame déjà affichée ⇒ pull toutes les 60 s » (§ 7), aucune propagation aux autres cartes, aucun flash.

## 2. Constat initial MESURÉ (analyse statique de l'ELF d'origine, `docs/mesures/8B2D_2026_10_12/pile-principale-statique.txt`)

`scripts/tft28-stack-report.js` suit les appels **directs** depuis `hal_entry → arduino_main → setup | loop` ; les lambdas confiées à une pile dédiée (`podNetRun`, `podWifiRun`, `podWorkRun`, `onSd`, journal, `PodEd`) sont des barrières. La pile principale du cœur R4 fait **1 024 o** et sa protection est désactivée (un dépassement descend dans le haut du tas, sans signal).

| chemin (pile principale) | firmware d'origine | après le lot (production) | après le lot (canari) |
|---|---|---|---|
| `doRegister` | −72 o (loop) / −88 o (setup) | marge 208 / 264 o | 208 / 264 o |
| `doPull` (dont création du clip d'animation sur la carte) | **−352 o / −368 o** | 264 / 320 o | 272 / 328 o |
| `restoreRows` (masquage du cartel depuis la carte) | **24 o / 8 o** | 640 / 696 o | 616 / 672 o |
| voie vote (`doValidate*`) | **−576 o / −592 o** (le « 964/1024 » du cahier des charges vient d'une mesure plus ancienne de la voie vote ; l'analyse statique de l'ELF d'origine, plus pessimiste, donne −576 o) | `doValidateV2` : **120 o / 176 o** (< 128 o : **vote toujours bloqué**) | *non compilée* |

Deux causes, deux corrections :

1. **JSON** (register, pull, validate, sondage du banc d'essai) sur la pile principale — corrigé comme sur le e-ink 2,9″ (`podWorkRun`, § 3.2).
2. **Carte SD sur la pile principale** — constat **nouveau**, absent du cahier des charges : `SD.open → … → Sd2Card::cardCommand → ArduinoSPI::beginTransaction → configSpiSci → R_SCI_SPI_CalculateBitrate → __aeabi_ldivmod` descend de 650 à 700 o ; `restoreRows` (toucher « masquer le cartel ») laissait 24 o, la création du clip d'animation dépassait la pile (−160 o) en théorie. Les opérations de haut niveau passent maintenant par `onSd()` (§ 3.3).

Pile **réseau** (2 048 o) : pire chaîne statique de la transaction d'image 1 072 o hors branche flottante de `printf` (jamais exécutée), 1 432 o avec elle ; garde 64 + exception 104 + marge exigée 128 ⇒ 1 728 o au pire : tient dans les 2 048 o.

## 3. Changements (liste exhaustive des fonctions touchées)

Preuve « chemin désactivé = production » (`tests/tft28Canary.test.ts`, `docs/mesures/8B2D_2026_10_12/off-sans-crochets.txt`) : le texte du sketch avec `POD_CANARY = 0`, comparé à l'original par `diff`, ne perd ni ne modifie de ligne d'origine **hors des fonctions listées ci-dessous** ; vingt-trois fonctions critiques (`streamFrame`, `pushRow`, `swapRowBytes`, `fastPixels`, `drawCartel`, `serviceTouch`, `ackFrame`, `saveOwnedBlockHash`, …) et le corps de huit fonctions renommées `…Impl` sont **identiques au texte près**. Au désassemblage, les 1 370 fonctions du binaire de production sont identiques à celles du même sketch dont les crochets du canari sont retirés (seules trois tables de données diffèrent).

### 3.1 Client TLS borné
`pod_ssl_bounded.h` (**copie identique** à celle du e-ink 2,9″, validée sur la carte le 11/10/2026) : la commande `_SSLCLIENTRECEIVE` demande ≤ 240 o, la chaîne de réponse est réservée une fois (cause d'`abort()` du cœur WiFiS3, `docs/LOT_8B2B2_PULLFRAME_BOUNDED_SSL_FIX1_2026_10_11.md`). `#define WiFiSSLClient PodBoundedSSL` avant `Conn` : toute lecture TLS (image, clips, candidat en production) passe par lui. Un **défaut collant** refuse l'image et les clips (pas d'affichage annoncé, pas d'ACK). **Non validé sur cette carte** (§ 7).

### 3.2 JSON sur la pile de travail (`podWorkRun`, 2 048 o au tas, garde 64 o, marge ≥ 128 o, échec fermé)
`registerParseWork`, `pullParseWork` (429 et réponse), `validateParseWork`, `benchPollParseWork` : après la fermeture de TLS, résultat **borné** et **tout ou rien** (identifiants ≤ 64 car., source ≤ 16, observation ≤ 8 empreintes : refusés au-delà ; textes du cartel 255 / 127 o tronqués à une frontière UTF-8), limite d'imbrication explicite (8), `GUARD` ⇒ arrêt sûr silencieux **avant** tout journal. Ordre des effets du pull = celui d'avant ; **le cartel n'est appliqué que si le pull apporte une nouvelle image** (comme avant).

### 3.3 Carte SD / TFT sur pile dédiée (`onSd`, 1 536 o, SD-STACK-FIX1)
`initSD`, `restoreRows`, `saveMeta`, `restoreLastFrame`, `toggleCartel`, `animForget`, `animLoadMarker`, `onAnimTouch` sont des **enveloppes** autour de leurs corps d'origine (`…Impl`, inchangés) ; `fetchAnimToSd` (rangement) et `runResidentAnim` (taille puis lecture du clip) y confient seulement leurs accès à la carte, le clip étant alloué **entre les deux** comme avant. Déjà sur une pile dédiée (`streamFrame` dans la transaction d'image) : exécution directe, jamais d'imbrication. Pire chaîne statique sur cette pile (journal compris) : 848 o en production, 896 o en canari, soit une marge statique de 472 à 520 o sur 1 536 o. Échec (NOMEM, MARGIN) : l'opération n'est **pas** faite ou son résultat est rejeté, et le journal le dit ; `GUARD` ⇒ arrêt sûr. *Coût :* 1,5 Ko de tas pendant une opération SD ; un clip d'animation proche du plafond de 9 216 o peut donc, faute de tas, être refusé à la lecture (« mémoire insuffisante » existait déjà : le tas libre est d'environ 10 Ko).

### 3.4 Voie vote (production seulement)
`doValidate` scindé (`doValidateV1`, `doValidateV2` en `noinline`), et la ré-inscription sur « signature refusée » est **différée** (`registered = false`, `loop()` s'en charge au tour suivant) au lieu d'imbriquer `doRegister()` et son écran d'appairage sous le cadre de 416 o du vote. Reste **120 o** de marge statique au vote v2 : à traiter dans le lot de vote (§ 9).

## 4. Le canari (`-DPOD_RENDER_V1=1 -DPOD_CANARY=1`)

**Aucun vote compilé.** Le texte compilé ne contient ni `validate-candidate`, ni `validation-result`, ni `candidate-frame`, ni `obs-confirm`, ni `pod-vote`, ni `signED25519`, `doValidateV2`, `netReadCandidate`, `podVoteMessage`, `podCheckStream`, `pod_vote_r4.h` ; **l'ELF des deux cœurs ne contient aucune de ces chaînes ni aucun de ces symboles** (`docs/mesures/8B2D_2026_10_12/elf-routes-symboles.txt`). `doValidate` / `doObsConfirm` sont des coquilles sans requête. Un candidat ou une observation annoncés par le pull sont **oubliés localement** (une ligne de journal par pull) ; **aucune ré-inscription ne part de `doValidate`**. La seule signature restante est l'**auto-test Ed25519 du démarrage** (message fixe `pod-r4-selftest`, aucun vote). Le banc d'essai annoncé par le serveur est ignoré. Preuve d'exécution : 40 tours de boucle (10 minutes virtuelles) avec un candidat, une observation et un banc d'essai annoncés ⇒ zéro requête de vote ; la même exécution en production interroge bien `/api/validate-candidate` et `/api/obs-confirm` (le test est sensible).

**ACK honnête.** En canari le résultat de l'ACK décide du succès : image complète à l'écran + ACK HTTP 200 ⇒ `lastFrameId`, métadonnées SD, « ACK recu (HTTP 200) ». ACK refusé ou impossible (réponse ≠ 200, connexion refusée, pile indisponible, `frameId` vide) ⇒ `[CANARY] ECHEC ACK : l'image est COMPLETE a l'ecran …`, retour `false`, frame **non** marquée acquittée, métadonnées SD **non** écrites (le cache d'image reste valide, le cartel reste masquable), **une seule** requête (aucune boucle) ; le serveur re-proposera la frame. Production : comportement d'origine (résultat de l'ACK ignoré).

**Instrument** (tout sort par la pile de journal dédiée ; aucune requête, aucun `delay`, aucun polling accéléré) :
- marqueur « CNRY » + zone peinte de la pile principale, contrôle **après le retour** des étapes (boot, Wi-Fi, auto-test Ed25519, register, restauration SD, premier pull, chaque pull, transaction d'image/affichage, ACK) ; critères **fatals** : marqueur ou longueur détruits, SP hors pile, **marge < 128 o** ; objectif ≥ 256 o signalé « SOUS L'OBJECTIF » sans arrêt ;
- pour chaque pile dédiée, une ligne `[CANARY] pile <réseau|wifi|travail|ed25519|sd/tft> … utilisée / marge / erreur` ; **toute erreur** (NOMEM, NESTED, GUARD, MARGIN) est **fatale** (`podCanaryHalt`, silencieux si le tampon USB est plein) ; la marge minimale de la pile de journal est suivie (MARGIN fatal en canari) ;
- tas libre, **plus grand bloc** (sonde malloc par dichotomie) et fragmentation au boot, après le Wi-Fi, après le register, après chaque pull, après la transaction d'image, après l'ACK ;
- **lest** de 5 416 o (`g_canBallast`) : le canari ne compile pas `g_voteScratch` + `g_voteChunk`, le tas serait sinon 5,4 Ko plus grand que celui de la production ; RAM statique canari **21 672 o** contre **21 676 o** (production et sketch d'origine).

## 5. Preuves

| preuve | résultat |
|---|---|
| Compilation Renesas 1.5.3 **et** 1.6.0 (`docs/mesures/8B2D_2026_10_12/compilations.txt`) | d'origine 158 388 o flash / 21 676 o RAM · production 163 452 / 21 676 · canari 155 552 / 21 672 (identiques sur les deux cœurs) ; aucun avertissement nouveau dans le code du projet (`avertissements.txt` : 5 avertissements de plus dans `FifoBuffer.h` du cœur, tirés par `pod_ssl_bounded.h`) |
| Inventaire formel (`scripts/tft28-inventory.js`, `docs/mesures/8B2D_2026_10_12/inventaire.md`, figé par test) | `WiFi.*` : 6, tous dans une enveloppe `podWifiRun` ; `Conn` : 5 (production) / 4 (canari), tous dans un `auto tx` de `podNetRun` ; `deserializeJson` : 5 / 4, tous sur la pile de travail ; Ed25519 : uniquement via `PodEd` ; accès SD : seulement dans les fonctions listées |
| Harnais hôte du **firmware complet** (`consensus-pod/host/tft28_harness.cpp`, 116 vérifications en production, 113 en canari ; bibliothèques simulées : réseau scripté, TFT à mémoire d'image, microSD en mémoire avec pannes, tactile, piles dédiées réelles en mode hôte) | image 240×320 **octet par octet** (octet haut en premier sur le bus, exactement 153 600 octets SPI) ; cache `/pod/frame.bin` == octets reçus ; métadonnées écrites APRÈS l'image ; 7 motifs de fragmentation ; corps tronqué (à la ligne 200 et à 1 octet de la fin), silence du serveur (attente bornée), taille annoncée ≠ 153 600, 404, défaut collant (milieu et dernier octet) : **jamais d'ACK, jamais « réussi », image partielle jamais déclarée inchangée** ; sans carte, carte pleine, ouverture impossible, lecture en échec ; **ACK 200 / 500 / connexion refusée / pile indisponible / `frameId` vide** ; cartel : afficher, masquer (88 lignes exactement, œuvre restaurée octet pour octet), 6 bascules de plus, sans SD, lecture SD en échec, fichier disparu, tactile absent, `serviceTouch` ; restauration au démarrage ; clip d'animation reçu, validé, rangé (clip puis marqueur), joué en boucle sans requête, interrompu au toucher, pause + cartel, effacé ; clip tronqué / corrompu / carte pleine / sans carte ; `doPull` bout en bout ; `setup()` + 40 tours de `loop()` |
| Arrêt sûr (processus qui **se fige**, tué par le test) | garde écrasée (réseau), NOMEM (image, SD, ACK), MARGIN (réseau, SD), marge de la pile principale < 128 o, marqueur détruit ; la commande de contrôle se termine |
| Décodeurs JSON contre **ArduinoJson réel** (`tests/tft28Host.test.ts`) | register (harnais du e-ink 2,9″ appliqué au code TFT), validate (idem), **pull TFT** (nouveau harnais : bornes, 429, cartel seulement pour une nouvelle image, panne d'allocation à chaque point, NOMEM / NESTED / GUARD / MARGIN) — en production et en canari |
| Contrôles négatifs | 17 mutants du firmware complet + 10 du pull + 5 register/validate : tous REFUSÉS (ACK malgré image incomplète, défaut collant ignoré, octets non permutés, cache SD non écrit, ligne incomplète non signalée, masquage partiel, cartel qui déborde, métadonnées sans image, ACK ignoré en canari, frame acquittée avant l'ACK, **requête de vote atteignable**, candidat retenu, observation confirmée, banc d'essai non ignoré, échec de pile SD ignoré, exécution directe sur la pile principale) |
| Tests des lots précédents | adaptés (`pod_uno_r4` migré : `tests/helpers/tftLot.ts`) ; sept tests d'infrastructure en échec sur `main` (g++ ≥ 11, dossier de travail Linux) corrigés dans un commit séparé |

**Ce que l'hôte NE prouve PAS** : la profondeur réelle des piles et le déplacement réel de SP sur la carte, le tas réel (fragmentation, plus grand bloc), le débit (≈ 20 s par image), l'ILI9341 et la carte SD physiques (l'écriture au TFT n'a **aucun** chemin d'erreur : une panne du pilote ne peut pas être détectée par le firmware), le vrai `PodBoundedSSL` contre cette carte, la gigue des interruptions.

## 6. Protocole du canari matériel (à exécuter par le porteur, APRÈS l'audit)

**Préparation.** Build **local**, jamais commité (`canary-builds/` est ignoré par git : le binaire embarque `secrets.h`) :
`arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi --build-property "compiler.cpp.extra_flags=-DPOD_RENDER_V1=1 -DPOD_CANARY=1" arduino_uno_r4/pod_uno_r4 --output-dir canary-builds/tft28-canary`. **Garder le binaire stable** (`POD_CANARY=0`, déjà flashé avant) pour le retour arrière. Carte déjà appairée (`deviceId`, `paired`), microSD FAT32 insérée, moniteur série à 115 200 bauds, bibliothèques du lot (ILI9341, GFX, BusIO, STMPE610, ArduinoJson, QRCode, Crypto, SD), **noter la version du cœur Renesas (1.5.3 ou 1.6.0) et du module Wi-Fi**.

1. **Démarrage sans frame.** Lignes attendues : `[CANARY] BUILD LOT8B2D-R4-TFT28-CANARY-1 | base 3239d2e | POD_CANARY=1 | AUCUN VOTE | compile …` · `[CANARY] validate : routes de vote ABSENTES …` · `[CANARY] boot : avant tout : pile principale utilisee au plus N o / 1024 (marge M o)` · `[CANARY] tas au boot : libre … plus grand bloc … fragmentation …` · `[CANARY] pile wifi … utilisee … marge … erreur 0` · `[CANARY] pile ed25519 sign|verify …` · `[SELFTEST] Ed25519 … -> OK` · `[CANARY] pile travail register JSON …` · `[CANARY] pile reseau http …` · `[CANARY] pile travail pull JSON …` · `[SD] carte lisible …` · `[TOUCH] STMPE610 détecté`. **Critères** : aucune ligne `ALERTE` ni `ARRET FATAL` ; toutes les marges de pile dédiée ≥ 128 o (objectif 256) ; marge principale ≥ 128 o à chaque point.
2. **Frame personnelle de test** (« Afficher sur mon écran », UUID neuf, image asymétrique avec coins colorés et texte), puis **un seul reset**. Attendu : `[PULL] nouvelle frame … (personal)` → `[HTTP GET] /api/pull-frame -> 200 (contenu 153600)` → `[FRAME] 80/320 … 320/320 lignes` → `[CANARY] pile reseau pull-frame (reseau + SD + TFT)` (marge ≥ 128) → `[CANARY] pull-frame/affichage : retour de la transaction : pile principale …` → `[ACK] … -> OK` → `[FRAME] OK en N ms … — ACK recu (HTTP 200)` → `[CANARY] tas apres l'ACK …`. **Visuel** : image complète, couleurs et orientation justes, aucune bande ni décalage ; noter la durée (≈ 15–25 s).
3. **Toucher** (10 fois) : le premier affiche le cartel (bande haute « RESCOE · #bloc », bande basse « titre · artiste », pastille « SD ok »), le suivant le masque ; l'œuvre doit redevenir identique à l'écran (comparaison à l'œil, photo avant/après) ; lignes `[TOUCH] cartel affiché / masqué en N ms`.
4. **Carte SD retirée** puis nouvelle frame : image affichée, `[SD] carte absente …`, pastille rouge « SD absente », cartel affichable mais non masquable, ACK OK. **Carte remise** : la frame suivante est mise en cache (`cache SD: oui`).
5. **Redémarrage** : `[SD] dernière œuvre réaffichée en N ms (frameId=…)` ; l'œuvre revient depuis la carte sans télécharger.
6. **Candidat** (une œuvre soumise au réseau pendant le canari) : une ligne `[CANARY] candidat annonce : AUCUN vote en build canari` par pull ; **aucune** ligne `[VALIDATE…]` ; côté serveur, aucun vote de cet appareil.
7. **Animation** (si un bloc animation existe pour `tft28`) : `[ANIM] clip reçu en N ms, … images, rangé sur la carte` ; toucher = pause + cartel, re-toucher = reprise ; relever les marges `sd/tft`.
8. **Stabilité** : au moins cinq pulls (≥ 5 minutes) : tas libre et plus grand bloc stables, aucun reset, aucune ligne `ALERTE`.

**Arrêt immédiat et rapport brut (ne rien corriger à l'aveugle)** : `ALERTE`, `ARRET FATAL`, `ECHEC d'une pile dediee`, `SOUS L'OBJECTIF` répété sous 128, reset ou gel, `ECHEC ACK` (garder le journal), image incorrecte, tas qui décroît à chaque pull. **À renvoyer** : journal série brut du démarrage au cinquième pull, photo de l'image et du cartel, taille des fichiers `/pod/*`, versions du cœur et du module Wi-Fi, durée mesurée.

## 7. Limites et risques restants

1. **Rien n'est mesuré sur la carte.** Toutes les marges ci-dessus sont des analyses statiques pessimistes (sans interruptions) ; le canari les remplace par des mesures.
2. **`PodBoundedSSL` n'a jamais tourné sur cette carte** ; il est validé sur le e-ink 2,9″ (1 seul essai, réserves dans `docs/CANARY_R4_EINK29_BOUNDED_SSL_FIX1_VERDICT_2026_10_11.md`). L'image de 153 600 o est une lecture TLS bien plus longue que celle de 9 472 o.
3. **Pile dédiée de la carte SD** : 1,5 Ko de tas pendant les opérations ; le tas libre est d'environ 10 Ko (21 676 o de RAM statique). Les clips d'animation proches de 9 Ko peuvent être refusés faute de tas (déjà vrai avant le lot, aggravé de 1,5 Ko pendant la lecture).
4. **Voie vote non traitée** (marge statique 120 o au vote v2, tampon statique de 4 736 o) : volontairement exclue du canari ; **ne pas flasher la production** (`POD_CANARY=0`) tant que le lot de vote n'est pas fait si l'on veut que le vote soit exercé.
5. **Défaut connu, NON corrigé (aucun changement de polling)** : une frame déjà affichée et toujours présente dans `/api/pull` impose `PULL_INTERVAL` (60 s) au lieu du `retryAfter` du serveur (même formule que celle corrigée sur l'ESP8266 par FIX2). Coût Redis : ≈ 1,5 commande × 60 pulls/h par appareil ; à traiter dans un lot dédié.
6. **ACK refusé après un affichage complet** (canari) : l'image est à l'écran et le cache SD valide, mais la frame n'est pas tenue pour acquittée ; au redémarrage suivant l'œuvre ne reviendra pas depuis la carte tant que la frame n'est pas acquittée (métadonnées non écrites). C'est le choix « honnête » du canari.
7. Écriture au TFT : aucun chemin d'erreur ; une panne du pilote ou du bus ne peut pas être détectée ni journalisée. Après une panne **partielle** du réseau ou de la carte, l'écran montre une image partiellement redessinée : le firmware le dit (`image incomplète`, `l'écran a pu être partiellement ou totalement redessiné`) et ne déclare jamais l'écran inchangé ni l'affichage réussi.
8. L'instrument lit les symboles de l'éditeur de liens (`__StackLimit`, `__StackTop`) : trois avertissements `-Warray-bounds` propres au canari (hors production).
9. Bibliothèques tierces (Adafruit ILI9341 / STMPE610, SD) non versionnées par le dépôt ; build d'essai fait avec leur dernière version.

## 8. Retour arrière

Reflasher le binaire stable (`POD_CANARY=0`) construit avant le canari. L'EEPROM (clés, onboarding) n'est pas touchée par le canari ; la carte SD peut garder `/pod/*` (le firmware stable les relit ou les recrée). Dépôt : `git revert` des commits du lot ; le sketch redevient celui de `3239d2e` (sauvegarde `firmware-backups/2026-10-12_avant-canari-tft28/`).

## 9. Inventaire du lot suivant (non commencé) — vote contrôlé sur le TFT 2,8″

Seulement **après** audit de ce lot et canari matériel vert :
1. ramener la marge statique du vote v2 à ≥ 256 o (`PodCheck` au tas, frame de `doValidateV2`, tampon `g_voteScratch` de 4 736 o à rendre dynamique ou retirer pour `tft28`), puis re-mesurer ;
2. valider `PodBoundedSSL` sur la lecture du candidat (153 600 o) ; signature `PodEd` hors de toute transaction ; aucun appel direct à `WiFi.*` ;
3. vote **unique et contrôlé** (un appareil, un candidat, journal complet, arrêt sûr conservé) ; observation et re-register à reprendre un par un ;
4. corriger la cadence « frame déjà affichée » comme sur l'ESP8266 (FIX2), avec ses tests ;
5. tests : vote accepté / refusé / signature refusée / 422, ré-inscription différée, candidat de chaque écran.

## 10. FIX1 (13/10/2026) — compilation avec le vrai pipeline Arduino

Audit de `cab924b` : le sketch **ne compilait pas** avec la chaîne du porteur (arduino-cli 1.4.1, cœur 1.6.0, SD 1.3.0) — `pod_uno_r4.ino:377:36: error: 'F' is not a type`. Cause : le générateur de prototypes d'Arduino traite les fichiers `.ino` et donne à un **template défini dans le .ino** un prototype sans `template <typename F>`. Mes compilations de `cab924b` passaient par une enveloppe qui contournait ce générateur : elles ne pouvaient pas voir l'erreur (corrigé : les builds de référence sont désormais ceux du dossier du sketch tel quel).

- **Correction.** `onSd` / `onSdDirect` déplacés dans `arduino_uno_r4/pod_uno_r4/pod_sd_stack.h`, inclus par le `.ino` après `sdStackFailed`, `POD_SD_STACK_TOTAL` et `POD_CANARY_SD`. Texte des gabarits inchangé : mêmes tailles de pile (1 536 o), mêmes échecs fermés. Un test interdit désormais tout `template <` dans le `.ino` et vérifie l'ordre d'inclusion et que toute fonction du `.ino` dont la signature cite un type défini dans le `.ino` porte `__attribute__` (le générateur ne lui fait alors pas de prototype avant la définition du type).
- **Compilations réelles** (`docs/mesures/8B2D_2026_10_12/arduino-reel/`, commandes et sorties brutes) : production et canari × cœurs 1.6.0 et 1.5.3, **OK** ; la même erreur `377:36` est reproduite sur `cab924b`. Production 163 460 o / 21 676 o ; canari 155 560 o / 21 672 o. Différences de chaîne avec le porteur : voir `LISEZ-MOI.md` du dossier.
- **Portabilité Windows des tests.** Empreinte SHA-256 de la sauvegarde calculée sur le texte normalisé en LF (stable sous `core.autocrlf`) et `.gitattributes` impose LF à la sauvegarde et au harnais ; la comparaison avec l'original utilise `git diff --no-index --unified=0` (plus l'exécutable Unix `diff`) ; tous les chemins transmis au g++ MSYS (harnais JSON et firmware complet) sont normalisés en `/`.
- Aucun changement de logique, de vote, de serveur, de Redis, de polling ni d'OTA ; drapeaux à 0/0 ; aucun flash.

## 11. REGISTER-STACK-FIX2 (13/10/2026) — marge de la pile principale après `doRegister`

**Mesure matérielle (premier canari TFT 2,8″, verdict GPT/Codex).** Appareil déjà appairé, `POST /api/register` = 200, aucun pull : pile principale avant/après Wi-Fi **788 / 1 024 o (marge 236)** ; `PodEd` sain (sign 1 316 / marge 924, verify 1 532 / marge 708) ; `PodNet` register sain (1 180 o utilisés, marge 804) ; JSON de `/api/register` sain (496 o utilisés, marge 1 488, statut 1) ; **au retour de `doRegister` : 916 / 1 024 o utilisés, marge 108 o (< 128)**, marqueur et longueur intacts, SP dans la pile. Le canari s'est arrêté préventivement, sans corruption. Aucune frame envoyée ni testée. Archivage : `docs/mesures/8B2D_2026_10_12/fix2/journal-materiel-verdict.md` — ⚠ le **texte brut** du journal série n'a pas été transmis dans la demande : seuls les chiffres du verdict sont archivés (et dits tels).

**Ce que l'on sait, et ce que l'on ne sait pas.** 916 − 248 (`hal_entry` + `arduino_main` + `setup`) − 144 (ancien cadre de `doRegister`) = **524 o sous le cadre de `doRegister`** : l'analyse statique ne voit que ≈ 268 o (chaîne `httpCall`/`String`/`malloc`) à 232 o (`tftStatus`) sous cet appel. **L'écart statique ↔ matériel d'environ 250 o s'explique par ce que l'analyse ne suit pas** : appels indirects/virtuels (Adafruit_GFX `print` → `write` → `drawChar`, `fillScreen` → `fillRect` → SPI `beginTransaction` → `configSpiSci` → `R_SCI_SPI_CalculateBitrate` → `__aeabi_ldivmod`), temporaires des `String`, **interruptions** (SysTick, USB, SCI : elles s'empilent sur la même pile). **Le pic exact n'a pas été localisé sur la carte** (la mesure est un filigrane, pas une trace) : on ne prétend donc PAS savoir lequel de `tftStatus("Connecte")` ou de la construction du corps l'a produit. La correction traite les deux.

**Correction (un seul fichier firmware : `arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino`).** `doRegister` n'est plus qu'un pilote (cadre 144 → 8 o), en phases `noinline` dont les cadres et les objets meurent avant la suivante :
1. `registerExchange` : `registerReadMac` (le `String` de `macString()` meurt ; seule survit la MAC dans `g_regMac[18]`, vidée avant lecture) → `registerPost` (corps construit par **ajouts successifs avec une seule réservation**, sans concaténation en chaîne ; le corps **meurt** au retour de la requête) → `doRegisterDecode` (inchangé : l'état n'est inscrit que sur réponse complète et valide) ;
2. (retour : mac, corps, réponse, temporaires détruits) ;
3. `registerLog` (journal `[REGISTER]`) ;
4. écran : appairé → `registerShowConnected` et échec → `registerShowFailure` dessinent **sur la pile dédiée** (`onSd`, 1 536 o, jamais imbriquée : déjà sur une pile dédiée = exécution directe ; indisponible = **écran non redessiné**, journal `[SD] pile dédiée (…)`, l'inscription reste valable) ; non appairé → `registerShowOnboarding`, **chemin d'avant conservé** (clés une seule fois puis QR, sur la pile principale, sans `onSd`).
Échec fermé : MAC absente (aucune requête), HTTP ≠ 200, réponse refusée → retour `false` immédiat, **aucune suite** (ni journal `[REGISTER] deviceId`, ni écran « Connecte », aucun état inscrit). Texte JSON de la requête identique à l'ancienne expression (ordre mac, screens, firmware, publicKey, ownedHashes). Aucun vote, aucune route ajoutée, aucun changement de serveur / Redis / Neon / protocole / polling / OTA / rendu / SD / tactile ; `POD_RENDER_V1 = 0`, `POD_CANARY = 0`.

**Non-imbrication.** Les phases réseau (`registerPost` → `httpCall` → `podNetRun`) ne touchent à aucune autre pile ; la MAC passe par `podWifiRun` et le décodage par `podWorkRun`, tous refermés avant l'écran ; l'écran passe par `onSd`, qui exécute directement s'il est déjà sur une pile dédiée (`podNetOnMainStack()`). Hôte : la section 17b du harnais compte les dessins faits pendant que SP est sur la pile principale (**0** pour « Connecte » et « Register echoue », > 0 pour l'onboarding).

**Analyse ELF (cœur 1.6.0, canari ; `docs/mesures/8B2D_2026_10_12/fix2/`).** Pile principale, cumul depuis `hal_entry`, statique (sans indirects ni interruptions) :

| chemin | avant (30dc304) | après |
|---|---|---|
| appairé : échange (MAC, corps, requête, décodage) | `doRegister` 144 + 268 + 248 → ≥ 660 | **604** |
| appairé : écran « Connecte » | `tftStatus` sur la pile principale (232 + indirects non suivis) | **328** (cadre 40 + barrière : le dessin est sur la pile dédiée) |
| non appairé : onboarding (QR) | 760 | **704** |

**Calibration, honnête.** Ces chiffres sont des *prévisions statiques*. La mesure matérielle de 916 o dépassait la prévision statique du chemin direct d'environ 250 o : cette « dette de calibration » doit être ajoutée à toute prévision. Estimation prudente de la nouvelle marge matérielle au retour de `doRegister` : (a) si le pic venait de l'écran « Connecte » (appels indirects Adafruit/SPI) : il quitte la pile principale, marge attendue **> 300 o** ; (b) si le pic venait de l'échange (corps/`String`/`httpCall`) : gain statique de 56 à 100 o, soit une marge attendue de **≈ 160 – 210 o**, au-dessus de 128 o mais **sous l'objectif de 256 o**. Les deux sont des estimations, **pas des mesures** : l'objectif ≥ 256 o n'est PAS démontré. Le canari doit rapporter la ligne `register : retour : pile principale`.

**Reste ouvert / non traité.** Le parcours non appairé (QR) n'a jamais été mesuré sur cette carte (statique 704 o, marge 320 o, indirects inconnus) ; `setup` garde 224 o de cadre ; les `tftStatus` directs de `setup` (Wi-Fi) restent sur la pile principale (788 o mesurés avant/après le Wi-Fi). Aucun flash avant audit.
