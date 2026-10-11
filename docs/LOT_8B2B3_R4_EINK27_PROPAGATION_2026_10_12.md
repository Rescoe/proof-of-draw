# Lot 8B-2B-3 — LOT8B2B3-R4-EINK27-PROPAGATION-1 (12/10/2026)

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

## 6. Ce que je n'ai PAS pu faire (à ne pas considérer comme fait)

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
