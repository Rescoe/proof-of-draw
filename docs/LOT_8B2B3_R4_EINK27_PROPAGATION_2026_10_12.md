# Lot 8B-2B-3 — LOT8B2B3-R4-EINK27-PROPAGATION-1 (12/10/2026)
> **PRÊT — TEST MATÉRIEL REPORTÉ, carte indisponible.** (12/10/2026) Code, compilations et canaris logiciels terminés au commit `0391c71` ; jamais flashé ; ne pas fusionner dans `main` ; ne pas poursuivre vers le TFT R4 dans cette branche.

Propagation **étroite** des mécanismes validés sur carte pour l'UNO R4 WiFi + e-ink 2,9″ vers **UNO R4 WiFi + e-ink 2,7″ (solo)** et **UNO R4 WiFi + e-ink 2,7″ + OLED**. Réalisé par Claude (implémenteur), à auditer par GPT/Codex. **Testé sur l'hôte seulement : jamais compilé pour la carte, jamais flashé.**

Branche de travail : `claude/r4-eink27-propagation-8b2b3` (depuis `origin/main` 3239d2e, qui contient 22c847e, 265262c, 3239d2e — vérifié). Poussée uniquement sur `claude/hopeful-noether-ndz9ud`. Sauvegardes : `firmware-backups/2026-10-12_avant-propagation-8b2b3/`.

## 1. Ce qui est propagé (et ce qui ne l'est pas)

| Mécanisme | 2,9″ (validé) | 2,7″ solo | 2,7″ + OLED | Remarque |
|---|---|---|---|---|
| Appels `WiFi.*` sur pile dédiée (`podWifiRun`) | oui | **déjà là** | **déjà là** | rien à faire (lot 8B-2B-1) |
| Ed25519 sur pile dédiée (`PodEd`) | oui | **déjà là** | **déjà là** | idem |
| HTTP/TLS sur pile dédiée (`podNetRun`) | oui | **déjà là** | **déjà là** | idem ; lecture du candidat fermée avant la signature |
| `_SSLCLIENTRECEIVE` borné (`PodBoundedSSL`) | oui | **NOUVEAU** | **NOUVEAU** | copie byte-identique de `pod_ssl_bounded.h` (testée) |
| Décodage JSON `register` sur pile de travail | oui | **NOUVEAU** | **NOUVEAU** | bloc identique au 2,9″ (texte, testé) |
| Décodage JSON `pull` sur pile de travail | oui | **NOUVEAU** | **NOUVEAU** | solo : identique ; OLED : + champ `screen` borné |
| Décodage JSON `validate-candidate` sur pile de travail | oui | **NOUVEAU** | **NOUVEAU** | identique |
| Lecture sans perte + `fault()` avant affichage/ACK | oui | **NOUVEAU** (`doFetchFrame`) | **NOUVEAU** (`doFetchFrame` e-ink) | OLED : voir § 4 |
| Rendu v1 (`POD_RENDER_V1`) | 0 par défaut | 0 | 0 | **inchangé** ; géométrie 2,7″ déjà dans le noyau (lot 8B-2B-1) |
| `POD_CANARY` | existe | **n'existe pas dans ces sketches** | idem | voir § 6 |

**Non touchés (par décision du lot)** : TFT 1,8″, TFT 2,8″ (marge de pile ~60 o : bloqué), ESP8266 (BearSSL : `PodBoundedSSL` est propre au cœur Renesas, ne doit jamais y être copié), serveur, routes, protocole, polling, vote, OTA, format de frame, firmware DHT22, fonctions web récentes. `FIRMWARE_VERSION` inchangée (`r4eink27-1.1`, `r4multiscreen-1.1`).

## 2. Inventaire des différences 2,9″ / 2,7″ solo / 2,7″ + OLED

| | 2,9″ BWR | 2,7″ BW solo | 2,7″ + OLED |
|---|---|---|---|
| Plans | noir 4 736 + rouge 4 736 = 9 472 o | **un plan 5 808 o** (22 o/ligne × 264) | e-ink 5 808 o + OLED 1 024 o |
| `doFetchFrame` | 2 `readBody` | 1 `readBody` ; `got = … && c.client.fault() == 0` | idem pour l'e-ink ; `doFetchFrameOLED` **inchangée** |
| Pilote | `Epd29b` ; BUSY borné | `epd2in7_V2` ; `ReadBusy()` **attend indéfiniment** (non modifié) | idem |
| `/api/pull` | ni `screen` | ni `screen` | **`screen`** (racine et `frame.screen`) |
| `PullParsed` | — | identique au 2,9″ | + `screen` (≤ 16 car. `PULL_SCR_MAX`, **refusé** au-delà, jamais tronqué) |
| ACK | `ackFrame(frameId)` | idem | `ackFrame(frameId, screen)` **inchangé** |
| Candidats | tout écran | idem | idem (`blackBuf` 5 808 o sert de tampon) |

Le rendu v1 (désactivé) et son noyau gèrent déjà la géométrie 2,7″ ; ce lot n'y touche pas.

## 3. Ce que le lot change dans les sketches (et rien d'autre)

`tests/r4Eink27Propagation.test.ts` retire du sketch d'après les **seules** régions du lot et exige que le reste soit la sauvegarde **au texte près** :

1. `#include "pod_ssl_bounded.h"` après `pod_http.h` ; 2. `#define WiFiSSLClient PodBoundedSSL` avant `struct Conn` ;
3. e-ink `doFetchFrame` : `&& c.client.fault() == 0` ; 4. bloc `REGISTER-JSON-STACK-FIX1` + une ligne dans `doRegister` ;
5. région `PULL` (blocs `DOPULL-JSON-STACK-FIX1` + `doPull`) ; 6. bloc `DOVALIDATE-JSON-STACK-FIX1` + en-tête de `doValidate`.

Pour l'OLED, le routage de `doPull` (OLED / e-ink / repli / écran inconnu) est comparé mot pour mot à la sauvegarde ; `saveOledFrame`, `restoreOledFrame`, `oledStatus`, `displayOnboardingOLED`, `doFetchFrameOLED`, `ackFrame` sont comparés **octet par octet**.

## 4. Chemin OLED

Aucune ligne de `doFetchFrameOLED` ne change. Conséquence **voulue** : son téléchargement de 1 024 o passe lui aussi par le client borné (la macro redirige `WiFiSSLClient` pour tout `Conn`). Son contrôle d'intégrité reste `n == OLED_BUF_SIZE && c.rd.complete()` ; un défaut du client (`connected()` = 0) empêche d'atteindre `Content-Length` exact ⇒ incomplet ⇒ ni affichage ni ACK. Je n'y ai **pas** ajouté `fault()` (« préserver le chemin OLED »). Le harnais hôte prouve l'image OLED de 1 024 o exacte sous la borne (scénario C3).

## 5. Preuves obtenues (hôte)

- `npm test` : **764 réussis, 0 échec, 11 ignorés** (ArduinoJson absent de la machine cloud ⇒ exécutions hôte JSON ignorées par défaut). Avec ArduinoJson 7.2.1 fourni (`ARDUINOJSON_DIR`) : 768 réussis ; les **4 échecs** restants sont les harnais `register`/`validate` du **2,9″** (inchangés) arrêtés par `-Werror=mismatched-new-delete` de **g++ 13.3** — problème de compilateur de l'environnement cloud, préexistant, sans lien avec ce lot ; le harnais `pull` du 2,9″ et les nouveaux passent.
- **Blocs identiques au 2,9″ validé sur carte** : register, pull, validate (solo : texte identique hors canari ; OLED : identique après retrait des 7 retouches `screen`, listées dans le test) + `doPull` solo identique.
- **Hôte, ArduinoJson réel** (`consensus-pod/host/pull_oled_harness.cpp`) : `screen` racine / `frame.screen` / absent / 16 car. accepté / 17 REFUSÉ sans aucun effet / NOMEM / 429 / JSON tronqué ; 3 contrôles négatifs refusés (borne supprimée, `frame.screen` ignoré, `screen` non transmis).
- **Vrai cœur Renesas 1.5.3 et 1.6.0** (`bounded_ssl_harness.cpp`, sources SHA-vérifiées) avec la copie de **chaque** dossier 2,7″ : 19 contrôles + **C2** (plan 5 808 o octet par octet, AT ≤ 240) + **C3** (image OLED 1 024 o) ; fragmentation, lecture partielle, délai, troncature (B3), 8 octets en trop (B4), module muet (B6), défaut d'intégrité (B7), réponse AT coupée (B8), allocation refusée (tas AUDIT5 : bloc contigu 1 888 o), 300 scénarios aléatoires. Le test d'ancien chemin reproduit l'allocation de 1 921 o.
- `deserializeJson` (inventaire formel `scripts/json-inventory.js`) : **12 sites sur pile de travail** (2,9″ + 2 × 2,7″ : 4 chacun), **0** sur la pile principale pour ces trois sketches ; 9 restent sur la pile principale (TFT 1,8″ : 4 ; `pod_uno_r4` : 5, dont `benchPollOnce`), hors lot.
- Aucun ACK après échec : `ackFrame` est unique, en dernier de `doFetchFrame`, après `if (!got)` et le rendu/affichage (testé statiquement) ; `fault()` collant testé dans le harnais (B7).
- Aucun `set_new_handler`, aucun `operator new` redéfini ; `POD_RENDER_V1`/`POD_CANARY` à 0 ; aucun secret, `secrets.h`, `.env` ni binaire.

## 6. Ce que je n'ai PAS pu faire au premier jet (commit 465c566) — SUPERSÉ pour les points 1 à 3 par le § 10 (FIX1)

1. **Aucune compilation ARM** (ni cœur 1.5.3 ni 1.6.0, ni OFF / ON / canari) : `arduino-cli` et les cœurs Renesas ne sont pas disponibles dans la session cloud. **Mesures flash / RAM statique / pile : absentes.** Attendu, non mesuré : RAM statique inchangée (aucun global ajouté : `PullParsed`, `RegisterParsed`, `ValidateParsed` sont au tas, 1 octet de plus par instance du client), flash +quelques Ko.
2. **Pas de « canari »** : les sketches 2,7″ n'ont **aucune instrumentation `POD_CANARY`** (elle n'existe que pour le 2,9″). `-DPOD_CANARY=1` n'y change rien. Les marges de pile de travail (128 / objectif 256) et de pile réseau **ne sont donc pas imprimées** : seule la marge réseau/travail minimale est imposée par le code (échec fermé en dessous de 128 o), pas rapportée. Si l'audit veut les valeurs, il faut un lot d'instrumentation (hors périmètre ici) ou lire `reportMem()` / les lignes `[HTTP …]`.
3. Marge de la **pile principale** (1 024 o) : l'analyse statique du 2,9″ donnait 704 o pour la pire chaîne ; **non recalculée** pour le 2,7″ (pas d'ELF). Le 2,7″ + OLED a des cadres supplémentaires (`displayOnboardingOLED`, `doFetchFrameOLED`) : **à mesurer** avant tout flash.
4. Réaction du matériel : durée du téléchargement 5 808 o sous 240 o/commande AT (≈ 25 commandes, non mesuré) ; `ReadBusy()` indéfini du 2,7″ non borné par ce lot.

## 7. Protocoles de canari (à exécuter par le porteur, séparément)

**Commun** : build **local** (dossier ignoré par git), `POD_RENDER_V1 = 0` (comme le dépôt) ; relever d'abord la compilation OFF puis ON des deux cœurs, la ligne « Variables and constants in RAM » (cible ≤ 40 000 o, valeur d'avant à comparer) et la taille du binaire. **Ne pas flasher si la RAM statique augmente** ou si la compilation émet un avertissement nouveau.

**A — 2,7″ solo** : (1) flasher ; (2) démarrage **sans frame** : `[BOOT]`, `[WIFI]`, `[ED25519] pile dédiée … sign/verify`, `/api/register` 200 + `deviceId=…`, ≥ 3 pulls (`[PULL] aucune frame`), aucun redémarrage ; (3) UNE frame **personnelle** (« Afficher sur mon écran », UUID neuf), un reset : `[HTTP GET] /api/pull-frame -> 200 (contenu 5808)`, `[FRAME] lu=5808 attendu=5808`, `[FRAME] OK …`, ACK ; image juste ; (4) **pas de vote** avant (2) et (3) validés ; puis un candidat réel avec `[VALIDATE2] … Vote OK`.

**B — 2,7″ + OLED** : même séquence, **puis** : (5) frame pour l'**OLED** (`[OLED] … OK`, ACK écran `oled096`, affichage conservé après reset : `restoreOledFrame`) ; (6) frame e-ink et frame OLED en alternance ; (7) écran absent → `[PULL] écran absent : repli e-ink` ; écran inconnu → `[PULL] écran inconnu : …`.

**Arrêt immédiat** si : `abort()`/gel, `GUARD`/`MARGIN`, `[REGISTER] … rejetée`, `[PULL] … hors bornes`, `reportMem` « zone 0xA5 » anormale. Ne rien corriger à l'aveugle : rapporter le journal.

## 8. Rollback

`git revert` du commit du lot : les deux sketches retrouvent leur texte d'avant (sauvegardes dans `firmware-backups/2026-10-12_avant-propagation-8b2b3/`), `pod_ssl_bounded.h` disparaît des deux dossiers, les tests reviennent à l'état précédent. Retour matériel : le binaire local précédent (`canary-builds/stable`) ou ré-flasher la sauvegarde.

## 9. Coûts et périmètre

Redis **+0**, Neon 0 ; serveur, routes, protocole, vote, OTA, format de frame inchangés. Les chemins `/api/pull` / `/api/register` / `/api/validate-candidate` / `/api/pull-frame` / `/api/candidate-frame` / `/api/validation-result` sont inchangés (testé : même nombre d'occurrences).

## 10. FIX1 (LOT8B2B3-R4-EINK27-PROPAGATION-FIX1, 12/10/2026) — compilations ARM réelles, mesures, canari minimal

Audit GPT/Codex de `465c566` : CORRECTIONS REQUISES (preuves de compilation et de pile manquantes). Même branche, aucun flash, aucun changement serveur / Redis / Neon / protocole / vote / polling / OTA / DHT22. `POD_RENDER_V1 = 0` et `POD_CANARY = 0` au dépôt (testé).

### 10.1 Chaîne de compilation obtenue (et ses écarts avec la vôtre)

La session cloud a pu obtenir : `gcc-arm-none-eabi` **13.2.1** (apt), `arduino-cli` 1.1.1 (release GitHub), `ArduinoCore-renesas` aux tags `1.5.3` (commit 63662f0) et `1.6.0` (commit 424e86e, dont `platform.txt` annonce `9.9.9`), ArduinoJson 7.4.3, Crypto (arduinolibs `libraries/Crypto`, étiquetée 0.4.0), QRCode, Adafruit GFX 1.12.6 / SSD1306 / BusIO. Procédure et scripts : `docs/mesures/8B2B3_FIX1_2026_10_12/cloud-build.sh` + `cloud-matrix.sh`.

**Écarts avec la chaîne officielle (à connaître avant de lire les chiffres)** : (1) le compilateur est **gcc 13.2**, pas l'`arm-none-eabi-gcc 7-2017q4` du paquet Arduino (téléchargement refusé par le proxy) ; (2) `-std=gnu++14` au lieu de `gnu++17` (gcc ≥ 9 rend `byte` ambigu dans `WiFiSSLClient.cpp` via `<memory_resource>` — l'erreur n'existe pas avec gcc 7) ; (3) préprocesseur `.ino` contourné (`universal-ctags` ne produit pas de prototypes compatibles) : le sketch est inclus tel quel depuis un `.ino` d'une ligne ; (4) `-fstack-usage` activé. **Calibrage** sur le 2,9″ validé sur carte (même procédure) : chaîne `register` 816 o (document gcc 7 : 824 o), chaîne `pull` 720 o (704 o), cadre de `doValidate` 416 o (424 o) → **écart ±16 o** sur les chaînes, RAM statique +1 % (23 040 o contre 22 792 o au dernier canari documenté, code non identique). **Les chiffres sont indicatifs ; refaire les mêmes rapports avec votre toolchain** : `scripts/r4-eink27-measure.sh <fichier.elf> [arm-none-eabi-objdump]`.

### 10.2 Compilations (aucune erreur ; aucun avertissement du sketch hors canari)

Matrice : {2,7″ solo, 2,7″ + OLED} × {cœur 1.5.3, cœur 1.6.0} × {OFF, `-DPOD_RENDER_V1=1`, `-DPOD_RENDER_V1=1 -DPOD_CANARY=1`} = 12 builds, plus l'AVANT (sauvegarde du premier jet : 8 builds OFF/ON) et le 2,9″ de calibrage (4 builds). **Les 24 builds réussissent**, les cœurs 1.5.3 et 1.6.0 donnent les mêmes tailles (`.text`/`.bss`) : détails bruts `docs/mesures/8B2B3_FIX1_2026_10_12/build-*.txt` et `pile-*.txt`.

| Firmware (gcc 13.2, indicatif) | Flash AVANT | Flash APRÈS | RAM statique AVANT | RAM statique APRÈS |
|---|---|---|---|---|
| 2,7″ solo OFF | 128 924 | 132 492 (**+3 568**) | 19 368 | 19 368 (**±0**) |
| 2,7″ solo ON | 131 476 | 135 044 (+3 568) | 19 376 | 19 376 (±0) |
| 2,7″ solo canari | — | 135 596 | — | 19 432 (+56 vs ON : relevés du canari) |
| 2,7″ + OLED OFF | 143 704 | 147 208 (**+3 504**) | 21 740 | 21 740 (**±0**) |
| 2,7″ + OLED ON | 146 256 | 149 760 (+3 504) | 21 748 | 21 748 (±0) |
| 2,7″ + OLED canari | — | 150 408 | — | 21 804 (+56) |
| (2,9″ OFF, calibrage) | — | 133 284 | — | 23 008 |

Maximum R4 : 262 144 o de flash, 32 768 o de RAM. Différence solo / + OLED : +14 716 o de flash et +2 372 o de RAM statique (SSD1306, GFX, tampon OLED 1 024 o + tampon de rendu) — identique avant et après le lot.

### 10.3 Marges de pile — analyse STATIQUE (octets, gcc 13.2 ; seuil impératif 128, objectif 256)

Pile principale (1 024 o), pire chaîne depuis `hal_entry` (`scripts/r4-eink27-chains.js`) :

| Chaîne | 2,7″ solo AVANT | solo APRÈS (OFF / ON) | + OLED AVANT | + OLED APRÈS (OFF / ON) | 2,9″ (validé) |
|---|---|---|---|---|---|
| register, depuis `setup` (hors QR d'appairage) | **−56** | 360 / 360 | −56 | 360 / 360 | 360 |
| register, depuis `loop` | 112 | 528 / 528 | 112 | 528 / 528 | 528 |
| pull + pull-frame + affichage + ACK, depuis `setup` | **−64** (ON −72) | 304 / 264 | **−104** (ON −96) | 264 / **232** | 304 |
| idem depuis `loop` | 104 (ON 96) | 472 / 432 | 64 (ON 72) | 432 / 400 | 472 |
| **vote → re-register** (clé publique refusée), depuis `loop` | **−376** | **136** / 136 | **−384** | **128** / 128 | **112** |

Lecture : avant le lot, **les chaînes register et pull de ces deux firmwares dépassaient statiquement la pile principale** (ArduinoJson sur la pile principale) ; après le lot elles ont ≥ 232 o. En revanche :

* **⚠ chaîne vote → re-register = 136 o (solo) et 128 o (+ OLED)** : au seuil, avec ±16 o d'incertitude de toolchain ; **le 2,9″ validé a 112 o dans la même chaîne** (préexistant, hors périmètre). Cette chaîne est `loop → doValidate (cadre 392–400 o) → doRegister (resynchronisation de la clé publique après un « Signature » refusé) → httpCall → String`. Elle n'est empruntée qu'après un **vote refusé pour signature**. Le canari **ne provoque aucun vote** (§ 10.6) ; **un lot séparé** devra détacher cette re-inscription du cadre de `doValidate` (par exemple en la déclenchant depuis `loop`) AVANT d'autoriser un candidat réel sur ces firmwares — je ne l'ai pas fait (« aucun changement de vote »).
* **2,7″ + OLED + rendu v1 : 232 o** (< objectif 256, ≥ 128) pour pull → rendu → affichage depuis `setup` (le premier pull) ; 400 o depuis `loop`.
* Le build de canari ajoute 8 o aux cadres (portées) : vote 120 / 112 o **dans le seul build de canari**.

Piles dédiées (statique, `reste` = marge restante dans la pile après cadre d'exception de 104 o) :

| Pile | taille | pire profondeur | marge statique (≥128 / obj. 256) | solo / + OLED |
|---|---|---|---|---|
| réseau (`podNetRun`) : candidat / HTTP / pull-frame (+ OLED) | 2 048 | 1 000–1 064 | **816 o** (sans `%f`) | identique |
| Wi-Fi (`podWifiRun`) | 1 536 | 664 | **672 o** (exigé 1 120 → réserve 416) | identique |
| travail JSON : pull / register / validate | 2 048 | 1 176 / 820 / 916 | **688 / 1 028 / 932 o** | OLED : pull **672 o** |
| Ed25519 (`PodEd`, vote) | 2 304 | 1 360 | principale au vote : 380 o (hors re-register) | OLED 372 o |

Mesures réelles : **non faites** (aucune carte) — c'est le rôle du canari ci-dessous.

### 10.4 Canari minimal (nouveau)

Les sketches 2,7″ n'avaient pas de `POD_CANARY` ; le protocole du premier jet parlait de marges qu'ils ne journalisaient pas. FIX1 ajoute **uniquement** (bloc `#if POD_RENDER_V1 && POD_CANARY`, éliminé à 100 % en production : testé) : peinture de la pile principale au démarrage ; ligne `[CANARY] pile principale apres <fonction> : marge >= N o (utilisee <= U o sur 1024)` à la SORTIE de register, pull, pull-frame (+ affichage + ACK), validate, obs-confirm (destructeur de portée) ; relevé SANS appel (`podCanaryNote`, feuille) de chaque exécution sur pile dédiée (Wi-Fi, HTTP, pull-frame, candidat, JSON register / pull / validate, OLED), rapporté à la sortie de la portée : `[CANARY] pile dediee <nom> : utilisee U o, marge M o, erreur E (OK | SOUS L'OBJECTIF 256 | ALERTE)` ; **arrêt fatal silencieux** si marqueur de fond détruit, marge principale < 128 o, erreur de pile dédiée (GUARD, MARGIN, NOMEM, NESTED) ou marge dédiée < 128 o ; `abort()` redéfinie (une écriture USB non bloquante `[CANARY] ABORT()`, jamais d'allocation, puis boucle) ; empreinte `[CANARY] BUILD LOT8B2B3-FIX1 | <firmware> | compile <date heure>`. Ni `new_handler`, ni `operator new`, ni réseau, ni EEPROM. Coût : +56 o de RAM statique (relevés), +3 Ko de flash, 5 avertissements `-Warray-bounds` sur `__StackLimit` (même famille que les 13 du canari 2,9″). Ne pas reproduire AUDIT1–5 : la cause SSL est établie (`PodBoundedSSL`).

### 10.5 ArduinoJson 7.4.3, tests sans masquage

* ArduinoJson **7.4.3** (version du projet) + Crypto fournis (`ARDUINOJSON_DIR`, `POD_CRYPTO_SRC`) : **plus aucun test ignoré** (780 / 780 réussis : `docs/mesures/8B2B3_FIX1_2026_10_12/npm-test-lot-sans-test-ignore.txt`).
* Les « 4 échecs préexistants » : même commande sur `3239d2e` puis sur le lot —

| Test (harnais hôte) | `3239d2e` | lot avant correctif du harnais | lot après |
|---|---|---|---|
| REGISTER-JSON (code réel) | ÉCHEC | ÉCHEC | réussi |
| REGISTER-JSON (contrôles négatifs) | ÉCHEC | ÉCHEC | réussi |
| DOVALIDATE-JSON (code réel) | ÉCHEC | ÉCHEC | réussi |
| DOVALIDATE-JSON (contrôles négatifs) | ÉCHEC | ÉCHEC | réussi |
| autres harnais (pull, bounded SSL, …) | réussis | réussis | réussis |

Cause identique des deux côtés : `g++ 13` + `-Werror=mismatched-new-delete` dans `compileHarness` (les opérateurs du shim hôte). Correctif : `-Wno-mismatched-new-delete` dans `tests/helpers/cppHarness.ts` (sans effet sur le code embarqué) ; appliqué aussi à `3239d2e` : 41 / 41 réussis (`arduinojson-743-base-3239d2e-harnais-corrige.txt`). Au passage, `tests/edStack.test.ts` écrasait son propre dossier de travail avec la sortie de l'éditeur de liens sous Linux (3 tests « ignorés » sans Crypto, en échec avec) : corrigé (dossier `*_src`), même résultat sur `3239d2e`. **Aucun nouvel échec.**
* `npx tsc --noEmit` propre ; `git diff --check` propre ; `npx eslint .` : 107 problèmes **avant et après** (67 erreurs, 40 avertissements préexistants, aucun dans les fichiers du lot).

### 10.6 Chemin OLED vérifié

Réception de 1 024 o exacte sous la borne (harnais C3, vrai cœur 1.5.3 et 1.6.0) ; défaut collant du client ⇒ corps incomplet ⇒ `doFetchFrameOLED` retourne avant affichage et ACK (**C4** : module défectueux, 1 024 o, `complete()` faux, `connected()` = 0, plus test statique de l'ordre garde → ACK) ; `saveOledFrame`, `restoreOledFrame`, `oledStatus`, `displayOnboardingOLED`, `doFetchFrameOLED` comparés octet par octet à la sauvegarde. L'alternance future e-ink / OLED reste à couvrir sur matériel : étapes 5 et 6 du protocole B ci-dessous.

### 10.7 Protocoles de canari mis à jour (rien n'est flashé avant l'audit GPT)

Pré-requis : refaire `scripts/r4-eink27-measure.sh` avec **votre** toolchain et vérifier : aucune chaîne de register / pull / pull-frame sous 128 o. **Aucun candidat / vote pendant les canaris** (chaîne vote → re-register à 128–136 o) : n'envoyer que des frames PERSONNELLES (« Afficher sur mon écran »), qui ne créent pas de candidat.

Build local (dossier ignoré par git) : `-DPOD_RENDER_V1=1 -DPOD_CANARY=1`. **A — 2,7″ solo** puis **B — 2,7″ + OLED** (jamais ensemble) : (1) démarrage sans frame : ligne `BUILD`, `[ED25519] pile dédiée …`, `register 200`, ≥ 3 pulls, lignes `[CANARY] pile dediee …` toutes « OK » ou « SOUS L'OBJECTIF » (jamais « ALERTE »), `[CANARY] pile principale apres register|pull … marge >= 128` ; (2) une frame e-ink personnelle : `pull-frame -> 200 (contenu 5808)`, `[FRAME] lu=5808`, rendu v1, `[FRAME] OK`, ACK, ligne `pile principale apres pull-frame + affichage + ACK e-ink` ; (3) **B seulement** : une frame OLED personnelle (`[OLED] … OK`, ACK `oled096`), reset (image OLED restaurée), puis alternance e-ink / OLED / e-ink ; (4) arrêt si `ARRET FATAL`, `ABORT()` ou silence. Journal brut à rapporter tel quel.

### 10.8 Reste ouvert

* Mesures réelles de pile (canari) et chiffres avec la toolchain officielle gcc 7.
* Vote → re-register à 128–136 o (2,9″ : 112 o) : lot séparé avant tout candidat réel.
* TFT 2,8″, TFT 1,8″, ESP8266 : inchangés, hors lot.

## 11. FIX2-CANARY-SAFETY (12/10/2026)

Audit GPT/Codex de `b7ea573` : lot fonctionnel accepté sous réserve ; deux corrections seulement.

1. **Aucun vote dans un build canari.** Avec `POD_RENDER_V1=1 && POD_CANARY=1`, `doValidate()` retourne juste après le contrôle `pendingCandidateId.length() == 0` : UNE ligne `[CANARY] candidat annonce : AUCUN vote en build canari … (le canari ne teste pas le consensus)`, `pendingCandidateId = ""` (le serveur ré-annonce le candidat au pull suivant s'il est toujours en attente : « oublié localement » est le comportement le plus sûr, identique aux échecs de lecture de la production), `return false`. Avant tout appel réseau : ni `/api/validate-candidate`, ni lecture du candidat, ni signature, ni `/api/validation-result`, ni `doRegister()`. Aucun ACK, aucun état de frame/bloc touché. Le canari ne teste que : register → pulls sans frame → frame personnelle → rendu → ACK. **Preuve binaire** : les ELF de canari ne contiennent plus les chaînes `validation-result` ni `validate-candidate` (le build OFF les contient) ; flash canari 124 740 o (solo) / 139 576 o (+ OLED), RAM 18 736 / 21 108 o (code de vote éliminé par le compilateur). Production (`POD_CANARY=0`) : texte inchangé (comparaison à la sauvegarde, tests « hors régions du lot »).
2. **Zéro avertissement du projet dans les trois configurations.** `__StackLimit` / `__StackTop` sont déclarés `char` par `podNetStack.h` (partagé) ; les adresses sont maintenant obtenues par `podLinkerAddr()` (asm vide : adresse opaque pour le compilateur) — correction locale, aucun `-Wno-array-bounds`, aucun autre avertissement masqué, aucun en-tête partagé modifié (une re-déclaration en tableau est refusée par le compilateur : conflit avec `podNetStack.h`).

Compilations (gcc 13.2, cœurs 1.5.3 et 1.6.0, résultats identiques) — `docs/mesures/8B2B3_FIX2_2026_10_12/build-*.txt` :

| Config | solo flash / RAM | + OLED flash / RAM | avertissements du projet |
|---|---|---|---|
| OFF | 132 500 / 19 368 | 147 216 / 21 740 | 0 |
| `POD_RENDER_V1=1` | 135 052 / 19 376 | 149 768 / 21 748 | 0 |
| canari 1/1 | 124 740 / 18 736 | 139 576 / 21 108 | 0 (5 avant FIX2) |

Production vs FIX1 : RAM identique ; flash +8 o (132 492 → 132 500 en OFF) **expliqué** : le désassemblage des instructions est identique (comparaison normalisée) ; seul diffère le chemin de construction (`/tmp/…/build/src.ino`) gravé en chaîne dans le binaire, de longueur différente selon le nom du dossier de build. Marge du pire chemin (canari + OLED, hors vote) : 224 o.

Tests : 785 / 785, aucun ignoré (ArduinoJson 7.4.3 + Crypto fournis), `tsc` et `git diff --check` propres, drapeaux 0/0. Nouveaux tests (`tests/r4Eink27Propagation.test.ts`) : voie atteignable du canari sans réseau / signature / vote / re-register / ACK / état de frame ; production inchangée ; symboles de l'éditeur de liens via `podLinkerAddr`, aucun `-Wno-array-bounds`. **Non traité (lot séparé après les canaris de frame)** : chaîne vote → re-register à 136 / 128 o.
