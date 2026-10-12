# Lot 8B-2C — LOT8B2C-ESP8266-EINK29-CANARY-1 (12/10/2026)

| | |
|---|---|
| **Cible unique** | `esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino` (ESP8266 + e-ink 2,9″ BWR). Aucun autre ESP8266, aucun R4. |
| **Base** | `origin/main` `3239d2e` (contient `c5a9b7e` rendu v1 inactif, `089e2db`, `22c847e`, `265262c` — ces deux derniers sont **R4 seulement** et ne sont pas copiés) |
| **Branche** | `claude/esp8266-eink29-canary-8b2c`, isolée de la branche R4 (`0391c71`, « PRÊT — TEST MATÉRIEL REPORTÉ, carte indisponible ») |
| **Statut** | **Compilé (cœur 3.1.2, gcc 10.3) et testé sur l'HÔTE. JAMAIS FLASHÉ.** Aucun essai sur carte, aucun déploiement, aucune fusion dans `main`. |
| **Drapeaux au dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (testé). Le canari est un build LOCAL (`-DPOD_RENDER_V1=1 -DPOD_CANARY=1`, dossier `canary-builds/` ignoré par git : les binaires embarquent `secrets.h`). |
| **Budget** | Redis **+0**, Neon 0, aucune route, aucun polling, aucun changement serveur / protocole / vote / OTA. |
| **Suite** | arrêt pour audit GPT/Codex. |

## 1. R4/WiFiS3 contre ESP8266/BearSSL — ce qui n'est PAS transposable

| | UNO R4 WiFi (Renesas, WiFiS3) | ESP8266 (cœur 3.1.2, BearSSL) |
|---|---|---|
| TLS | dans un **coprocesseur** (ESP32-S3), commandes AT sur UART | **dans le MCU** : BearSSL, tampons et contexte sur le tas |
| Cause du blocage R4 | `_SSLCLIENTRECEIVE` à 1 023 o ⇒ `std::string` de 1 921 o > bloc contigu ⇒ `abort()` | **inexistante** : pas d'AT, pas de `buf_read` ; `PodBoundedSSL` n'a aucun sens ici |
| Pile | principale de **1 024 o** ⇒ piles dédiées (`podNetStack`, `podWifiRun`, `podWorkRun`, `PodEd`, trampolines) | tâche « cont » de ≈ 4 Ko + **pile de poussée BearSSL séparée de 6 200 o allouée au tas** (`StackThunk.cpp`) ; aucun trampoline à écrire |
| JSON | décodage déplacé sur pile de travail | pile de 4 Ko suffisante (les cadres sont de quelques centaines d'octets) : inchangé |
| Risque dominant | pile et allocation contiguë de la réponse AT | **tas** : BearSSL ≈ 27 Ko + deux plans de 4 736 o pendant le TLS, et chien de garde logiciel (≈ 3,2 s) |

Vérifié dans le code du cœur 3.1.2 (`WiFiClientSecureBearSSL.cpp`, `StackThunk.cpp`, `ESP8266HTTPClient.cpp`) : `WiFiClientSecure` alloue à la construction la pile de poussée (**6 200 o**, `abort()` si impossible) et au `connect()` `iobuf_in` **16 384 o** + `iobuf_out` **512 o** (IRAM si le tas IRAM existe, sinon DRAM) ; `HTTPClient::end()` → `stop()` libère les iobuf et la session ; **la pile de poussée n'est libérée qu'à la destruction du dernier `WiFiClientSecure`**. `HTTPClient::end()` **vide** (`read()`) tout octet restant avant `stop()` : un surplus serait avalé sans bruit.

Rien de `PodBoundedSSL`, `podNetStack`, `podWifiRun`, `podWorkRun`, des trampolines ni des hypothèses Renesas n'est copié (testé : aucun de ces noms dans le dossier ESP8266).

## 2. Modèle mémoire exact (frame personnelle)

Tas libre après Wi-Fi ≈ **38 000 o** (« [HEAP] après WiFi », CLAUDE.md règle 10). Séquence de `doPull` → `doFetchFrame` :

| Étape | Tas tenu (≈) | Remarque |
|---|---|---|
| `doPull` : libère `blackBuf` / `redBuf` (si alloués) | 0 | règle 1 |
| pull : TLS (BearSSL ≈ 27 Ko) + `DynamicJsonDocument(2048)` | ≈ 29 Ko | TLS fermé (portée) avant la suite |
| `doFetchFrame` : `malloc` 2 × 4 736 | **9 472** | **avant** le TLS (comme avant ; tampons de réception) |
| TLS du téléchargement : pile de poussée 6 200 + iobuf 16 384 + 512 + contextes (≈ 3,5 Ko, estimation) | 9 472 + ≈ 26,6 Ko | **pic ≈ 36 Ko sur ≈ 38 Ko** : marge d'**≈ 2 Ko seulement** — c'est le point à mesurer |
| `http.end()` puis fin de portée (`~WiFiClientSecure`) | 9 472 | BearSSL entièrement rendu **avant** le rendu |
| rendu v1 : hasheur (≈ 128 o de pile) + `PodEinkRenderer` (264 o de pile) + morceau de 32 o | 9 472 | **aucune allocation**, aucun tampon final, aucune grille |
| ACK : un second TLS complet (`httpPost`) | 9 472 + ≈ 26,6 Ko | même pic qu'au téléchargement (les plans sont encore tenus) |
| succès : plans **conservés** jusqu'au prochain `doPull`/`doValidate` | 9 472 | comportement existant ; échec : libérés immédiatement |

RAM statique (compilation, cœur 3.1.2) : OFF 34 812 · ON 35 056 · canari 35 052 (règle 8 : ≤ 40 000 respectée). Le canari **élimine** le chemin de vote (≈ 1,2 Ko de RAM statique en moins) ; un **ballast de 1 236 o** rétablit la RAM statique du build ON, sinon le tas mesuré serait optimiste de ≈ 1,2 Ko (le démarrage affiche la RAM statique réelle).

**Pré-vol TLS (canari seulement)** : avant de construire `WiFiClientSecure`, refus si `ESP.getFreeHeap() < 24 000` ou `getMaxFreeBlockSize() < 17 000` (BearSSL minimal 16 384 + 512 + 6 200 = 23 096 o) : le cœur appelle `abort()` si la pile de poussée ne peut pas être allouée. Refus ⇒ plans libérés, aucun ACK, nouvel essai au pull suivant (≥ 60 s). **Hypothèse de risque** : en production (OFF/ON) ce garde-fou n'existe pas (comportement d'avant conservé).

## 3. Ce que le canari ajoute (et rien d'autre) — `POD_RENDER_V1 && POD_CANARY`

| Élément | Rôle |
|---|---|
| `canaryBoot()` | empreinte `BUILD LOT8B2C… compile <date>`, **cause du dernier reset** (0 alim · 1 chien de garde matériel · 2 exception · 3 chien de garde logiciel · 4 redémarrage logiciel · 6 externe), **dernière phase en RTC**, RAM statique réelle ; reset 1/2/3 ⇒ « ALERTE » ; **deux resets anormaux consécutifs ⇒ ARRÊT sans réseau** |
| `canaryStep(phase, étiquette)` | écrit la phase en **mémoire RTC utilisateur** (survit à un reset logiciel / chien de garde / exception, pas à une coupure) puis journalise `+Δms tas maxBloc frag pile t` |
| phases | BOOT · WIFI · REGISTER · PULL · FETCH · PLANES · TLS_OUVERT · CORPS_LU · TLS_FERME · FRAMEHASH · PANNEAU_INIT · FLUX_PILOTE · RENDERHASH · ACK · TERMINE |
| `canaryTlsPreflight()` | voir § 2 |
| corps | `Content-Length` connu ≠ 9 472, ou octets en trop **déjà disponibles** ⇒ refus (aucun rendu, aucun ACK). `-1` (inconnu) accepté avec 9 472 octets exacts |
| `canaryAfterTls()` | après la fermeture de la portée TLS : le tas doit être revenu à ≤ 1 Ko du niveau d'avant connexion (rapport, pas arrêt) |
| producteur | `podRenderProduce` enveloppé (macro de renommage, texte d'origine intact) : nombre d'appels, plus long appel, **plus long intervalle entre deux appels** (alerte > 0,5 s ; le chien de garde logiciel est à ≈ 3,2 s), **pile « cont » minimale** |
| **vote interdit** | `doValidate()` : une ligne, `pendingCandidateId` oublié, retour **avant tout réseau** (pas de `/api/validate-candidate`, de lecture du candidat, de signature, de vote, de re-register, ni de `malloc`/`ESP.restart`). `doObsConfirm()` : aucune requête. Le serveur ré-annoncera le candidat au pull suivant (une ligne par pull). |

Tout est absent quand `POD_CANARY = 0`. Chaînes en flash (`F()` / `PSTR()`), statiques du canari ≈ 100 o + ballast.

## 4. Preuves (hôte et compilation)

**Compilation** — cœur 3.1.2, `xtensa-lx106-elf-gcc 10.3` (archive vérifiée par SHA-256, **la même** que celle du porteur), `--warnings all`, `-fstack-usage`. Calibrage : base `3239d2e` = 34 812 / 408 108 o (documenté au lot 8B-2A : 34 808 / 408 120 o). `docs/mesures/8B2C_2026_10_12/`.

| Build | RAM statique | Flash | IRAM | avertissements |
|---|---|---|---|---|
| base `3239d2e` | 34 812 | 408 108 | 60 827 | 4 (ArduinoJson déprécié) + 4 bibliothèques |
| **OFF** | **34 812** | **408 108** | 60 827 | **identiques** |
| ON (`POD_RENDER_V1=1`) | 35 056 (+244) | 417 696 (+9 588) | 60 907 | **identiques** |
| canari 1/1 | 35 052 | 408 564 | 60 919 | **identiques** |

* **OFF inchangé** : (a) RAM et flash identiques à l'octet ; (b) **désassemblage normalisé identique** (empreinte `fb40a24f3c64b136` des deux côtés) ; (c) test : retirer les blocs `#if POD_RENDER_V1 && POD_CANARY` et le drapeau redonne le sketch d'avant **au texte près** ; (d) tests existants `renderFirmware` (vue `POD_RENDER_V1 = 0` identique au firmware d'origine).
* Aucun avertissement nouveau (ensembles normalisés, sans numéros de ligne, identiques dans les 3 configurations).
* Cadres de pile statiques (`-fstack-usage`) : `doFetchFrame` 272 (OFF) → **448** (ON/canari) ; `podRenderProduce` 48 ; `Epd::DisplayStream` 80 ; `PodEinkRenderer::begin` 128 ; `byteAt` 80 ; `doPull` 560 ; `loop` 32. Chaîne de rendu estimée `loop` 32 + `doPull` 560 + `doFetchFrame` 448 + `DisplayStream` 80 + producteur 48 + `byteAt` 80 + SHA ≈ **1,4 Ko sur ≈ 4 Ko** (estimation par addition, non mesurée ; le canari relève la pile « cont » libre réelle).

**Hôte (code RÉEL extrait du sketch et du pilote, environnement ESP8266 simulé : `consensus-pod/host/esp_mock/`, `esp_frame_harness.cpp`)** — 3 configurations (OFF 75 contrôles, ON 116, canari 149) + vote :

| Exigence | Preuve |
|---|---|
| 9 472 o exacts, fragmentation variée | 18 découpages (1 / 7 / 239-241 / 1448 / 4 735+1 / …, lecture bloquante ou non) + 300 aléatoires |
| ordre noir puis rouge | `frameHash` recalculé indépendamment sur les octets reçus ; panneau : 0x24 puis 0x26, plan rouge ré-inversé |
| corps tronqué / erreur après le plan noir | refus, attente bornée ≈ 15 s virtuelles, plans libérés, aucun rendu, aucun ACK |
| corps trop long / surplus | canari : refus ; production : octets en trop vidés par `http.end()` (comportement existant, documenté) |
| allocation du 1er / 2e plan impossible | `false`, rien de tenu, **aucun TLS ouvert**, aucun ACK |
| fermeture TLS avant rendu | `tls_dtor` **avant** `epd_init` / première commande du panneau (aucune « VIOLATION » enregistrée par le panneau simulé) |
| erreur du rendu / du pilote ⇒ aucun ACK | `Init()` en échec ; producteur interrompu aux appels 1, 2, 100, 148, 296 (rafraîchissement **non** lancé) ; plans absents ⇒ `podRenderAndShow() == 0` |
| ACK uniquement après succès | un seul ACK, après `epd_refresh` ; zéro ACK sur tous les échecs ; échec d'ACK réseau : un seul essai |
| candidat en canari ⇒ aucun vote | zéro `httpGet` / `httpPost` / signature / vote v2 / re-register / `malloc` ; une ligne ; candidat oublié ; production : `doValidate` interroge `/api/validate-candidate` (inchangé) |
| image uniforme / quasi uniforme | blanc, noir, rouge, un pixel, noir+rouge partout : **296 appels du producteur de ≤ 32 o, `yield()` à chacun**, `renderHash` cohérent, rouge prioritaire, cartel gravé même sur image blanche |
| rollback / libération | 20 cycles : occupation constante 9 472 o ; échecs intercalés : tout libéré |
| RTC, reset, arrêt | phase RTC = TERMINE après succès, = FRAMEHASH après échec du panneau ; reset 3 ⇒ ALERTE ; second reset anormal ⇒ ARRÊT sans requête ; reset normal remet le compteur à zéro |
| contrôles négatifs | 21 mutants REFUSÉS (ACK avant rendu, résultat de l'ACK ignoré, pré-vol avant l'ACK supprimé, frame marquée acquittée avant l'ACK, rendu pendant TLS, plans non libérés, ACK malgré échec, garde de surplus supprimée, pré-vol supprimé, vote autorisé / non oublié, producteur sans `yield`, > 32 o, arrêt sur resets anormaux supprimé, RTC non écrite…) |

**Ce que l'hôte NE prouve PAS** : BearSSL réel, tas réel (fragmentation, taille des contextes), durées réelles, chien de garde matériel, panneau réel, orientation et couleurs à l'écran.

Tests : `npm test` = **790 / 790, aucun ignoré** (ArduinoJson 7.4.3 et Crypto fournis par variables d'environnement) ; `tsc` propre ; `git diff --check` propre **après FIX1** (la première version du lot annonçait « propre » à tort : le fichier de harnais, non suivi, n'était pas contrôlé et contenait un espace final ligne 110 ; contrôle refait sur les fichiers indexés, `git diff --check --cached`) ; ESLint 107 problèmes **avant et après**. Pour que `npm test` soit entièrement vert avec g++ 13, deux corrections d'infrastructure de test (déjà faites sur la branche R4) sont reprises ici : `-Wno-mismatched-new-delete` dans `tests/helpers/cppHarness.ts` (g++ ≥ 11 refuse le `new (std::nothrow)` des harnais d'extraction) et un dossier de travail distinct dans `tests/edStack.test.ts` (Linux). Sur `3239d2e` ces 7 tests échouent à l'identique.

### 4 bis. FIX1 (audit GPT de `01cafd0`)

1. **Le résultat de `ackFrame()` décide du succès (canari).** ACK refusé ou impossible ⇒ journal `[CANARY] ECHEC ACK` (l'écran a pu être physiquement affiché), plans libérés, **ni** `PCP_DONE`, **ni** « acquittée », **ni** `lastFrameId` mis à jour, `frameReady=false`, retour `false` : le serveur re-proposera la frame (aucun polling accéléré). Production inchangée.
2. **Pré-vol BearSSL avant l'ACK** (étape `pre-vol TLS avant l'ACK`, mêmes seuils que le téléchargement : les deux plans de 9 472 o sont encore vivants). Mémoire insuffisante ⇒ aucun TLS d'ACK, diagnostic `REFUS pre-vol TLS`, même sortie en échec.
3. Succès seulement après `ACK recu (HTTP 200)` : `PCP_DONE`, `lastFrameId`, `frameReady`.
4. Tests hôte ajoutés (canari) : ACK 200 ; ACK refusé ; mémoire insuffisante avant l'ACK (zéro POST) ; aucun faux `PCP_DONE` ; frame non acquittée ; une seule tentative réseau par chemin ; trois mutants de plus. RAM statique du canari recalée par le lest (35 052 o contre 35 056 o pour ON) ; OFF inchangé (RAM 34 812, flash 408 108, empreinte de désassemblage `fb40a24f3c64b136`, avertissements identiques).

### 4 ter. FIX2 — canari matériel VALIDÉ (12/10/2026, build `6ccb729`) et pull d'une frame déjà affichée

**Journal série brut** : `docs/mesures/8B2C_2026_10_12/journal-canari-materiel-2026_10_12.txt` (transcrit sans modification). Binaire confirmé par la ligne `BUILD LOT8B2C-ESP8266-EINK29-CANARY-1 … POD_RENDER_V1=1 POD_CANARY=1 … compile Oct 12 2026 09:50:11`.

**Verdict matériel : le chemin principal est VALIDÉ** (frame personnelle de 9 472 o → TLS fermé → rendu v1 en flux → affichage → ACK 200, sans vote, sans reset) :

| mesure | valeur relevée |
|---|---|
| tas après Wi-Fi | 43 752 o |
| plans alloués (2 × 4 736) | tas 42 840 → 33 352 o |
| **minimum pendant BearSSL** | **4 000 o libres, plus grand bloc 2 776 o** (l'estimation était ≈ 2 Ko : la marge existe, elle est mince) |
| après destruction du client TLS | **33 352 o, retour exact** (aucune fuite) ; 32 792 o après l'ACK |
| corps | Content-Length 9 472, noir 4 736 + rouge 4 736, surplus 0 |
| rendu | 296 appels du producteur, plus long appel 1 047 µs, plus long intervalle 2 896 µs (≪ 500 000 µs), pile cont minimale 992 o |
| hashes | `frameHash` 32f59527…8e, `renderHash` c5b123cd…a0 produits et journalisés |
| ACK | HTTP 200 `{"ok":true,"cleared":false}` après l'affichage (`cleared=false` est normal pour une frame personnelle) |
| cinq pulls ultérieurs | tas 42 968, plus grand bloc 41 568, fragmentation 4 %, pile 672 ; aucun reset, aucune fuite, aucun vote |
| image | **réellement affichée** (constat visuel du porteur) |

Ce que ce canari NE prouve pas : orientation et couleurs jugées au seul regard du porteur (pas de comparaison mesurée) ; un seul appareil, une seule frame (les images uniformes de l'étape 3 du protocole, le candidat de l'étape 4 et la robustesse sur des centaines de cycles restent à faire) ; le pré-vol (seuils 24 000 / 17 000) n'a pas été déclenché sur la carte, seulement sur l'hôte.

**Réserve matérielle — `e-Paper busy TIMEOUT` ×3 (archivée, NON corrigée).** L'initialisation du panneau a duré **45 408 ms** : trois `ReadBusy()` (les trois de `Epd::Init()` : après le reset, après SWRESET, en fin d'initialisation) ont atteint leur plafond de 15 000 ms (3 × 15 s = 45 s). Le rafraîchissement lui-même (`busy` puis `release`) s'est terminé normalement et l'image est apparue. Comparaison au pilote historique : `epd2in9b_V4.cpp` n'a reçu, depuis `3239d2e`, **que l'ajout** de `Epd::DisplayStream` (gardé par `POD_RENDER_V1`) — `Init()`, `ReadBusy()` (BUSY bas = occupé, plafond 15 s) et `initDisplayForRefresh()` sont **octet pour octet ceux de la production**, appelés par le chemin historique comme par le rendu v1 ; le commentaire du sketch (« jusqu'à ~3 s ») ne correspond pas au plafond réel de 3 × 15 s. Le dépôt ne contient aucun journal historique de cette carte qui dise si ces timeouts y existaient déjà : **pour trancher, le porteur doit relever le même démarrage avec le binaire OFF (`canary-builds/stable`, même frame)**. Si le OFF montre les mêmes timeouts, ils ne viennent pas du rendu v1 (câblage BUSY, tension, panneau) ; sinon, enquête séparée. **Aucune modification du pilote BUSY dans ce lot.** Conséquence opérationnelle : 45 s d'initialisation bloquent la boucle (chien de garde nourri par `delay()` des `DelayMs`, aucun reset observé).

**Défaut découvert par les pulls de stabilité, corrigé par FIX2.** La frame personnelle acquittée reste présente dans `/api/pull`. Le firmware écrivait « Frame déjà affichée » mais gardait `nextInterval=60s` malgré `retryAfter=300` puis `900` : dans `doPull`, toute `frameSource` différente de `none` imposait `PULL_INTERVAL`, avant que `newFrameId == lastFrameId` ne soit testé. Pulls observés toutes les ≈ 61 s. Correctif (production ET canari, un seul fragment, `tests/helpers/pullIdleFix.ts`) :

```cpp
bool sameFrameIdle = newFrameId.length() > 0 && newFrameId == lastFrameId;
if ((newFrameSource == "none" || sameFrameIdle) && newCandId.length() == 0) { nextPullIntervalMs = retryAfter × 1000; }   // sinon PULL_INTERVAL
```

Frame identique **et** aucun candidat ⇒ `retryAfter` du serveur. Candidat annoncé ⇒ rythme nominal (inchangé). Frame nouvelle ⇒ rythme nominal et téléchargement immédiat (inchangé). Frame absente, 429, erreurs HTTP/JSON/`begin()` : inchangés. Aucun changement de serveur, Redis, Neon, protocole, ACK, vote, OTA ni format de frame ; aucune requête ni commande de plus (le correctif en retire).

**Coût Redis évité** (estimation, ordre de grandeur) : un pull au repos coûte ≈ 1,5 commande (CLAUDE.md « Pull d'écran »). Avant : 60 pulls/h ≈ 90 commandes/h pour un appareil gardant une frame acquittée affichée ; après : 12 pulls/h (retryAfter 300) ≈ 18 ou 4 pulls/h (900) ≈ 6 commandes/h, soit **≈ 72 à 84 commandes/h évitées par appareil, ≈ 52 000 à 60 000 par mois** (24 h/24, 720 h) sur un plan de 200 000. Le pull toutes les 60 s dépassait aussi la limite de 2 pulls / 15 min par appareil (429 évités). Mesure réelle à faire côté serveur (non mesurée ici).

**Preuves FIX2** : le VRAI `doPull` est extrait dans le harnais hôte (`esp_pull.inc`, ArduinoJson réel, réponses `/api/pull` simulées) : frame identique + 900 ⇒ 900 s (un seul GET, aucun téléchargement), + 300 ⇒ 300 s, frame de consensus identique, frame nouvelle ⇒ 60 s + téléchargement, premier démarrage, candidat présent (avec ou sans frame), frame absente (300 / 900 / sans retryAfter), `frameSource` sans `frameId`, 429 (lastPullMs et plafond inchangés), HTTP 500, JSON invalide, `begin()` en échec, un GET et zéro POST. Trois mutants de plus REFUSÉS (correctif supprimé, frame nouvelle au rythme retryAfter, candidat ignoré) — 21 au total. Le test « chemin désactivé == firmware d'avant au texte près » annule exactement le fragment FIX2 avant de comparer ; sauvegarde du sketch d'avant : `firmware-backups/2026-10-12_avant-fix2-esp8266-eink29/`. L'assertion tautologique `… || true` du harnais (S10) est remplacée par un contrôle réel (le rapport de flux de succès n'est pas émis après un ACK refusé). Compilation cœur 3.1.2 : OFF RAM 34 812 o inchangée, flash 408 108 → 408 140 o (+32 o, `doPull`), cadre de `doPull` 560 o inchangé, avertissements identiques ; ON 35 056 o / 417 728 o ; canari 35 052 o / 409 076 o (`docs/mesures/8B2C_2026_10_12/build-fix2_*.txt`).

## 5. Protocole du canari matériel (à exécuter par le porteur, après audit)

**Préparation** : build local `arduino-cli compile … --build-property "compiler.cpp.extra_flags=-DPOD_RENDER_V1=1 -DPOD_CANARY=1"` (cœur esp8266 3.1.2, carte habituelle) dans `canary-builds/` ; **conserver le binaire OFF actuel** comme retour arrière (`canary-builds/stable`). Carte **appairée** (sinon le démarrage affiche clés + QR et attend 60 s).

1. **Démarrage sans frame** (EEPROM intacte) : attendre `[BOOT] Pret`. Lignes attendues : `[CANARY] BUILD LOT8B2C…`, `[CANARY] cause du dernier reset = 0|4|6 (…) | RTC absente|valide …`, `[CANARY] RAM statique=35052 o (reference ON non-canari : 35056 o …)`, `[HEAP] après WiFi: ≈ 38000`, `[CANARY] wifi connecte`, `register OK`, puis `[CANARY] pull: debut`, `[PULL] Aucune frame`. **Relever** `[HEAP] après WiFi` (≥ 36 000 attendu).
2. **Frame personnelle de test A** (« Afficher sur mon écran », UUID neuf, motif asymétrique : une flèche / la lettre F **noire** en haut à gauche, un carré **rouge** en bas à droite, texte) puis **un seul reset**. Attendu, dans l'ordre : `frame: debut du telechargement` → `planes allouees (9472 o), avant TLS` (tas ≈ 28 Ko, maxBloc > 17 000) → `[HTTP GET] /api/pull-frame → 200` → `TLS ouvert (BearSSL alloue)` (**tas minimal du lot ; à rapporter**) → `[CANARY] corps : Content-Length=9472 lus noir=4736 rouge=4736 surplus=0` → `corps lu (TLS encore ouvert)` → `TLS FERME (client detruit)` + `tas restitue apres la fermeture TLS` → `frameHash calcule` → `panneau initialise, flux vers le pilote` → `flux remis au pilote` + `[CANARY] flux pilote : 296 appels du producteur, plus long appel=…us, plus long intervalle entre appels=…us, pile cont minimale=… o` → `renderHash` → `[RENDER] calculé ET remis au pilote — mode=1 frameHash=… renderHash=…` → `rendu OK, ACK en cours` → `[HTTP POST] /api/ack-frame → 200` → `ACK envoye` → `[FETCHFRAME] ✅ affichée`. **Contrôle visuel** : orientation, noir/rouge, cartel haut (date + « #bloc ») et bas (artiste – titre), rouge prioritaire sur noir.
3. **Images défavorables** (une par reset, ≥ 15 s entre deux affichages) : **toute blanche**, **toute noire**, **presque uniforme** (un pixel), **toute rouge**. Mêmes lignes ; `plus long intervalle entre appels` ≪ 500 000 µs ; pas de reset.
4. **Candidat** : si une œuvre est soumise au réseau pendant le canari, attendre `[CANARY] candidat annonce : AUCUN vote en build canari…` (une ligne par pull) et **aucun** `[VALIDATE…]`, `[SIGN]`, `validation-result`.
5. **Stabilité** : 3 pulls sans frame (≈ 3 min) ; relever `maxBloc`/`frag` ; aucun reset.

**Critères d'ARRÊT (rapporter le journal brut, ne rien corriger à l'aveugle)** : `ALERTE` quelconque (reset anormal, tas non restitué, chien de garde, intervalle > 0,5 s) ; `REFUS pre-vol TLS` (le tas mesuré est alors trop juste pour la configuration ; fournir les valeurs) ; `ARRET : deux redemarrages anormaux` ; cause de reset 1 / 2 / 3 ; `Exception` ; `[HTTP GET] … → -1` répété ; image non conforme ; tout `VALIDATE` / `validation-result`.

## 6. Rollback

`git revert` du commit du lot : le sketch redevient celui de `3239d2e` (sauvegarde `firmware-backups/2026-10-12_avant-canari-esp8266-eink29/`). Retour matériel : reflasher le binaire OFF (`canary-builds/stable`) ; l'EEPROM (clés, onboarding) n'est jamais touchée par le canari (la RTC n'est pas persistante).

## 7. Limites restantes

1. **Rien n'est mesuré sur carte** : tas minimal pendant le TLS, taille réelle des contextes BearSSL, fragmentation, durées, chien de garde, rendu à l'écran, orientation et couleurs. La marge de tas pendant le TLS (≈ 2 Ko estimés) est le risque principal ; si le canari la mesure trop faible, le lot suivant devra réduire l'empreinte (par exemple recevoir le plan rouge sans tenir le noir, ou hacher/rendre en flux) — **non fait ici**.
2. Le canari lit le corps plus strictement que la production (Content-Length, surplus) et ajoute un pré-vol : il valide le **rendu v1**, pas ces gardes en production.
3. `ESP.getFreeContStack()` mesure la pile de la tâche principale, **pas** la pile de poussée BearSSL (6 200 o, au tas).
4. `HTTPClient::end()` vide les octets restants : un surplus **non encore arrivé** n'est détecté que par Content-Length.
5. Après un échec du rendu, l'écran n'est pas garanti inchangé (page blanche déjà affichée si une image l'était) : documenté au lot 8B-2A.
6. Pas de signature `pod-render-v1`, `cartelMode` non exposé, rapport de rendu non envoyé au serveur (inchangés).
7. Les trois autres ESP8266 (TFT 1,8″, e-ink 2,7″, 2,7″ + OLED) et tout le R4 : hors lot.
