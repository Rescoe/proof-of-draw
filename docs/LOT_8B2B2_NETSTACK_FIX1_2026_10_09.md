# Lot 8B-2B-2 · NETSTACK-FIX1 — toute transaction réseau/TLS des UNO R4 sur une pile dédiée

| | |
|---|---|
| **Date** | 09/10/2026 |
| **Statut** | **Pile réseau dédiée VALIDÉE sur carte** (canari du 09/10/2026 : 1 172 o utilisés, 812 o de marge, erreur 0) ; l'alerte qui a suivi (24 o sous `__StackLimit` après la transaction, E/S de journal) est traitée par `docs/LOT_8B2B2_NETSTACK_FIX2_2026_10_09.md`. Aucune frame, aucun dessin. |
| **Origine** | Retour matériel du canari BOOT-FIX2 (`docs/mesures/8B2B2_NETSTACK_FIX1_2026_10_09/journal-bootfix2-materiel.txt`) : **`WiFiSSLClient::connect()` descend de 456 o sous `__StackLimit`** (pile max réelle 1 480 o), tas exclu, `PodEd` toujours validé (sign 1316/924, verify 1532/708, erreurs 0/0), verrou fatal efficace |
| **Portée** | `consensus-pod/src/adapters/podNetStack.h` (nouveau, copié dans les 5 dossiers R4) ; les sites réseau des 5 sketches R4 ; contrôle d'imbrication ajouté à `podEdStack.h`. **Aucun** serveur, Redis, Neon, ACK, protocole, consensus, rendu, OTA, polling. Redis +0, Neon 0. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). L'arbre local du porteur garde `1`/`1` (jamais commité). |
| **Cœur Arduino** | ⚠ **Écart d'environnement à connaître.** La note du porteur (`docs/NOTE_PILE_TLS_UNO_R4_WIFI_2026_10_09.md`) mesure sur un cœur Renesas **1.5.3** (module Wi-Fi 0.5.2) ; la machine de build de ce lot n'a plus que la **1.6.0** (arduino-cli). Réglages vérifiés identiques dans les deux : `BSP_CFG_STACK_MAIN_BYTES = 0x400`, `BSP_CFG_HEAP_BYTES = 0x2000`, `R_MPU_SPMON->SP[0].CTL = 0` dans `arduino_main()`. Les profondeurs STATIQUES ci-dessous viennent d'ELF 1.6.0 ; la chaîne `connect → … → vsnprintf` y est identique à la mesure faite en 1.5.3 (≈ 656 o statiques contre ≈ 632 mesurés), mais **la taille de la pile dédiée doit être confirmée par le canari sur le cœur réellement flashé** (le firmware est compatible avec les deux). Les « avant » ont été recompilés avec le même cœur 1.6.0. |

## 1. Ce que la carte a prouvé (journal archivé)

| Mesure | Valeur | Lecture |
|---|---|---|
| `6a avant doRegister` | pile 864/1024, marge 160, `pile max sous limite` = 1024 | avant le réseau, rien n'a débordé |
| **`http: apres connect/TLS`** | pile utilisée 1016/1024 (marge 8), **pile max réelle = 1480** | connect() a écrit **456 o sous `__StackLimit`** |
| Tas | `__HeapLimit = 0x20007B00`, `sbrk(0) = 0x200066D8`, distance **5 160 o**, `mallinfo` utilisé 1 544 | le tas est exclu (il est à 5 Ko de la limite) |
| Marqueur | valeurs ressemblant à des cadres/pointeurs | écriture de pile |
| `PodEd` | sign 1316/924, verify 1532/708, erreurs 0/0 | inchangé, validé |
| Verrou | aucun pull, vote, ACK ni affichage après l'alerte | le verrou de BOOT-FIX2 a fonctionné |

Au moment de `connect()`, les cadres au-dessus de la chaîne TLS valent `hal_entry` 8 + `arduino_main` 16 + `setup` 224 + `doRegister` 264 + `httpCall` 272 + `Conn::request` 64 = **848 o** ; la chaîne `connect → getSocket → ModemClass::begin/write → vsnprintf` en ajoute **≈ 632** (mesuré : 1 480 − 848), pour 656 o statiques sans la branche flottante de `printf`. **L'analyse statique de BOOT-FIX2 est confirmée**, branche flottante exclue (aucun format `%f` n'est utilisé). Le défaut est **préexistant** : le firmware stable parcourait déjà cette chaîne à chaque requête.

## 2. Audit : où passe le réseau dans les cinq firmwares

`WiFiSSLClient` n'est instancié que dans `struct Conn`, et `Conn` que dans `httpCall()` (register, pull, ACK, observation, vote v1/v2 : **tout le JSON**) et dans des lectures dédiées. Chaque ligne ci-dessous est désormais une **transaction sur pile dédiée** :

| Firmware | `httpCall` | image (pull-frame) | candidat (`candidate-frame`) | autres |
|---|:-:|:-:|:-:|---|
| R4 e-ink 2,9″ | ✓ | ✓ | ✓ | |
| R4 e-ink 2,7″ | ✓ | ✓ | ✓ | |
| R4 e-ink 2,7″ + OLED | ✓ | ✓ ×2 (e-ink, OLED) | ✓ | |
| R4 TFT 1,8″ | ✓ | ✓ (le TFT est dessiné PENDANT la lecture, dans la transaction) | ✓ | |
| R4 TFT 2,8″ | ✓ | ✓ (idem) | ✓ | clip du banc d'essai, clip d'animation de bloc |

Les tests (`tests/netStack.test.ts`) interdisent tout `Conn` hors d'une lambda `auto tx = [&]() {…}` lancée par `podNetRun`, toute requête hors de ces lambdas, tout `connect()` ailleurs que dans `Conn::request`, et exigent que le résultat de `podNetRun` soit exploité (`if (!ran)`).

**Ce qui reste hors pile dédiée** (appels au module Wi-Fi qui ne sont pas une « transaction ») : `WiFi.begin`, `WiFi.status`, `WiFi.localIP`, `WiFi.macAddress`, `WiFi.RSSI`, `WiFi.firmwareVersion` (dans `setup()` et `gatherEntropy`). Mesure : **864 o à `6a` (marge 160 o ≥ 128 o, objectif 256 o non atteint)**, sans débordement. À surveiller par le canari ; les envelopper dans `PodNet::run` serait la suite naturelle si le point `3 wifi connecte` ou `6a` se dégrade.

## 3. Conception : `PodNet` (même principe que `PodEd`)

* `PodNet::run(fn, ctx, &info)` : **`malloc` temporaire** de `POD_NET_STACK_TOTAL` octets ; garde basse 64 o peinte `0xC3` + pile peinte `0xA5` (watermark) ; trampoline Thumb de **8 instructions, identique à celui de `PodEd` validé sur la carte** (le test compare les deux textes) qui met `SP` sur la pile dédiée — **les interruptions s'y empilent aussi**, leur coût est donc mesuré dans la marge — appelle `fn(ctx)`, rétablit `SP` ; puis contrôle de la garde (`GUARD`), de la marge ≥ 128 o (`MARGIN`), indicateur `low` si marge < 256 o ; **effacement** de tout l'espace ; `free`.
* **Échec fermé** : `run()` retourne `false` pour `NOMEM` (fn non appelée), `NESTED` (fn non appelée), `GUARD`, `MARGIN` ; l'appelant traite alors la transaction comme **échouée** et ignore tout résultat partiel.
* **Aucun pointeur ni référence vers une variable de la pile dédiée n'en sort** : `fn` est une lambda `[&]` qui écrit dans des variables de l'**appelant** (`code`, `complete`, `got`, `shown`, `noFrame`, `chk`…) et dans des tampons déjà existants (`g_body`, `blackBuf`/`redBuf`, `g_voteScratch`, `clip`). Le `Conn` (client TLS, lecteur) et les `String` temporaires de la requête naissent **et meurent** à l'intérieur de la lambda ; `stop()` est appelé avant de la quitter.
* **Jamais imbriquée** : `podNetOnMainStack()` (SP dans `[__StackLimit, __StackTop]`) est vérifié **avant** toute allocation ; faux sur une pile dédiée → `NESTED`. Le même contrôle est ajouté à `PodEd` (`POD_ED_NESTED`). Dans `doValidateV2`, la lecture du candidat (pile réseau) est **terminée et fermée** avant `PodEd::sign` ; l'ACK et le vote partent ensuite par `httpCall`, séquentiellement.
* **Échec réseau ou mémoire** (tableau des sites) :

| Site | Si `run()` échoue |
|---|---|
| `httpCall` | `return -4` (« transaction ÉCHOUÉE ») : register → nouvel essai dans 5 s ; pull/ACK/vote → échec journalisé, aucune réponse exploitée |
| image (pull-frame) | `got/shown = false`, `noFrame = false` → le traitement d'échec existant : **pas d'ACK, pas d'affichage**, nouvel essai au prochain pull (e-ink 2,9″ : `return false`) |
| candidat | `chk` remis à zéro (`chk.ok = false`) → « calcul impossible », **pas de vote** |
| clips (TFT 2,8″) | `got = false` → « clip refusé / téléchargement incomplet » |

  Aucun de ces chemins ne redémarre la carte ni ne boucle plus vite qu'avant. Note : si la transaction a bien eu lieu mais que la garde/marge échoue **après coup**, la requête est tout de même déclarée échouée (le serveur a pu la traiter, comme pour un coupure réseau après envoi).
* **Aucune variable globale** : RAM statique inchangée (voir § 7).

## 4. Taille de la pile dédiée : 2 048 o (garde 64 o + 1 984 o) — justification

Mesures et bornes (octets) :

| Grandeur | Valeur | Origine |
|---|---:|---|
| Chaîne TLS mesurée sur la carte, sous `Conn::request` | ≈ 632 | journal (1 480 − 848) |
| Même chaîne, statique, **sans** branche flottante | 656 | ELF (`connect` 96 + `getSocket` 72 + `begin` 96 + `write` 40 + `vsniprintf` 16 + `_vsniprintf_r` 120 + `_svfiprintf_r` 152 + `request` 64) |
| Pire transaction, statique, **sans** `%f` | 992 – 1 136 | `scripts/net-stack-report.js` (lambda comprise : `Conn`, `String`, logs) |
| Pire transaction, statique, **avec** `_printf_float` (jamais exécutée : aucun `%f`) | 1 312 – 1 456 | idem |
| Cadre matériel d'exception (contexte FPU paresseux) | 104 | architecture |
| Interruptions : écart mesuré entre statique et carte | ≈ 40 | 1 480 − 1 440 |
| Marge exigée / objectif | 128 / 256 | cahier des charges |

Profondeur statique des transactions (extraits ; un fichier par firmware dans `docs/mesures/8B2B2_NETSTACK_FIX1_2026_10_09/netstack-<firmware>.txt`) :
**R4 e-ink 2,9″ BWR** (ON)

```
# Profondeur statique des transactions réseau (octets) — pile dédiée de 1984 o utilisables, cadre matériel d'exception 104 o
# site (lambda)              cadre pire cas (avec %f) sans %f reste (pire cas) reste (sans %f)
netReadCandidate               272               1344    1024              536             856
httpCall                       240               1312     992              568             888
doFetchFrame                   240               1312     992              568             888
```

**R4 TFT 1,8″** (ON)

```
# Profondeur statique des transactions réseau (octets) — pile dédiée de 1984 o utilisables, cadre matériel d'exception 104 o
# site (lambda)              cadre pire cas (avec %f) sans %f reste (pire cas) reste (sans %f)
doFetchFrame                   384               1456    1136              424             744
netReadCandidate               272               1344    1024              536             856
httpCall                       240               1312     992              568             888
```

**R4 TFT 2,8″ tactile** (ON)

```
# Profondeur statique des transactions réseau (octets) — pile dédiée de 1984 o utilisables, cadre matériel d'exception 104 o
# site (lambda)              cadre pire cas (avec %f) sans %f reste (pire cas) reste (sans %f)
doFetchFrame                   328               1400    1080              480             800
netReadCandidate               272               1344    1024              536             856
httpCall                       240               1312     992              568             888
netGetBlockClip                240               1312     992              568             888
netGetBenchClip                240               1312     992              568             888
```

Pile utilisable = 2 048 − 64 = **1 984 o**. Reste après le pire cas **avec** la branche flottante et un cadre d'exception : **424 o** (TFT 1,8″), 480 o (TFT 2,8″), 536–568 o ailleurs ; **sans** elle : **744 – 888 o**. Ces restes absorbent le gestionnaire d'interruption (mesuré ≈ 40 o) **et** laissent la marge visée de 256 o dans tous les cas. 1 536 o auraient laissé 0 – 100 o dans le pire cas statique ; 2 304 o (valeur de `PodEd`) n'apportent rien au-delà. Les lectures de corps ne changent pas la profondeur (boucles sans récursion).

Tas : région de 8 696 o ; à l'alerte, utilisé 1 544 o et 5 160 o libres jusqu'à la limite. La pile dédiée (2 048 o) est **transitoire** et jamais simultanée avec celle de `PodEd` (2 304 o, vote) : pic ≈ 1 544 + 2 304 = 3,9 Ko, soit **≥ 4,8 Ko de tas libre** dans le pire cas. Si `malloc` échoue, la transaction échoue **fermée**.

## 5. Ce qui change dans les sketches

Table exacte et annulable : `tests/helpers/netStackEdits.json` (ancien/nouveau texte par site). En annulant ces modifications, chaque sketch redevient — au texte près, hors blocs du canari — celui de `firmware-backups/2026-10-09_avant-netstack-fix1/` (test `tests/netStack.test.ts`). Dans le canari e-ink 2,9″, les points « silencieux » placés **à l'intérieur** des transactions sont retirés (SP y est hors de la pile principale) ; à leur place, `podCanaryNet` imprime après **chaque** transaction une ligne `[CANARY] net … pile reseau dediee utilisee N o, marge M o (objectif >= 256 : OK|SOUS L'OBJECTIF), erreur E | tas libre T` puis contrôle la **pile principale** (`podCanaryCheck`). Un échec de la pile dédiée (malloc, garde, marge < 128 o, imbrication) pose le **verrou fatal** du canari.

## 6. Canari SANS frame — protocole et critères

**Sketch** : `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` (drapeaux locaux `1`/`1` ; le commit contient `0`/`0`), `podEdStack.h` et `podNetStack.h` à côté, `secrets.h` inchangé. Moniteur série 115200. **Ne rien dessiner, ne pas envoyer de frame.** Laisser tourner **au moins 5 minutes** : le registre, le pull de démarrage, puis les pulls toutes les 60 s (≥ 3).

Lignes attendues (dans l'ordre) : bannière `[CANARY]` ; `[ED25519] … erreurs 0/0` ; points `1` à `5` ; `6a avant doRegister` ; `[CANARY] net http : pile reseau dediee utilisee <N> o, marge <M> o (objectif >= 256 : OK), erreur 0 | tas libre <T>` ; `[HTTP POST] /api/register -> 200` ; `6b apres doRegister` ; `[CANARY] net http …` + `[HTTP GET] /api/pull… -> 200` + `[PULL] aucune frame` ; `7b` ; `8 pret` ; puis, **chaque minute**, `[CANARY] net http …` suivi de `[HTTP GET] /api/pull… -> 200`.

| Critère | Seuil | Si non |
|---|---|---|
| `ecrit sous la limite ou pile max` (tous points) | **1024 constant** (aucune écriture sous `__StackLimit`) | alerte + verrou : **arrêt** |
| Pile principale (`pile utilisee au plus`) | marge ≥ 128 o ; attendue = celle de `6a` (≈ 864 o, le réseau n'y ajoute plus rien) | alerte + verrou |
| Pile réseau dédiée, `erreur` | 0 à chaque transaction (garde intacte) | verrou |
| Pile réseau dédiée, `marge` | ≥ 128 o exigé ; ≥ 256 o souhaité (`SOUS L'OBJECTIF` = à rapporter, pas un arrêt) | < 128 : verrou |
| Utilisation de la pile dédiée | attendue ≈ 700 – 1 100 o ; **à rapporter** (elle fixe la taille définitive) | — |
| `tas libre` d'une transaction à l'autre | identique (± 32 o) : aucune dérive | dérive croissante : **arrêt**, rapporter |
| Au moins **3 pulls** successifs après `prêt`, tous `-> 200` | oui | rapporter |

Arrêts : toute ligne `ALERTE`, `ARRET FATAL`, redémarrage de la carte, blocage, absence de ligne `[CANARY] net` après un `[HTTP …]`. Rollback : le firmware stable ; EEPROM, clés et appairage ne sont jamais effacés.

## 7. Compilations (arduino-cli, `--warnings all`, cœur 1.6.0)

| Firmware | Rendu v1 | Flash avant | Flash après | Δ flash | RAM statique avant | RAM statique après | Δ RAM | Marge statique après (o) | Avertissements du projet |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| R4 e-ink 2,9″ BWR | OFF | 119588 | 120388 | **+800** | 22768 | 22768 | **+0** | 528 | 0 |
| R4 e-ink 2,9″ BWR | ON | 122620 | 123420 | **+800** | 22768 | 22768 | **+0** | 528 | 0 |
| R4 e-ink 2,7″ | OFF | 118748 | 119564 | **+816** | 19128 | 19128 | **+0** | 4168 | 0 |
| R4 e-ink 2,7″ | ON | 121460 | 122276 | **+816** | 19128 | 19128 | **+0** | 4168 | 0 |
| R4 e-ink 2,7″ + OLED | OFF | 133384 | 134384 | **+1000** | 21500 | 21500 | **+0** | 1796 | 0 |
| R4 e-ink 2,7″ + OLED | ON | 136096 | 137112 | **+1016** | 21500 | 21500 | **+0** | 1796 | 0 |
| R4 TFT 1,8″ | OFF | 129360 | 130176 | **+816** | 20864 | 20864 | **+0** | 2432 | 0 |
| R4 TFT 1,8″ | ON | 131976 | 132816 | **+840** | 21424 | 21424 | **+0** | 1872 | 0 |
| R4 TFT 2,8″ tactile | OFF | 147812 | 148948 | **+1136** | 21444 | 21444 | **+0** | 1852 | 0 |
| R4 e-ink 2,9″ BWR | ON + CANARI (1/1) | — | 126572 | — | — | 22768 | — | 528 | 0 |

Marge statique = 32 768 − 9 472 (tas 8 192 + pile 1 024 + vecteurs 256 réservés) − RAM statique : **inchangée à l'octet sur les 5 firmwares** (aucune variable globale ajoutée). Flash : **+800 à +1 136 o**. Détail : `docs/mesures/8B2B2_NETSTACK_FIX1_2026_10_09/compilations.md`.

Les « avant » sont les sketches de `HEAD` (commit `1feb5cc`) recompilés avec le cœur 1.6.0. Binaires hors dépôt (`/tmp`) ; `canary-builds/` reste ignoré par git.

## 8. Preuves hôte

`tests/netStack.test.ts` + `consensus-pod/host/net_stack_harness.cpp` (`g++ -Wall -Wextra -Werror`) : `fn` appelée **une fois** et résultats chez l'appelant ; marge 255 → réussie mais `low` ; **127 refusée, 128 acceptée** ; garde écrasée (premier et dernier octet) refusée ; `malloc` impossible et imbrication → **`fn` non appelée** ; imbrication tentée depuis `fn` refusée sans casser la transaction externe ; effacement complet avant `free` ; aucune fuite après échec ; 4 transactions sans dérive du tas ; **6 mutations refusées** (garde, marge, imbrication, malloc, effacement, objectif). `consensus-pod/host/ed_stack_harness.cpp` : `PodEd` refuse l'imbrication (`NESTED`, sortie à zéro, jamais « valide »). `tests/canaryBootFix2.test.ts` : le code réel de `podCanaryNet` (rapport, `SOUS L'OBJECTIF` sans verrou, échec ou malloc impossible → verrou fatal). **Limites** : l'hôte ne prouve ni le déplacement réel de `SP`, ni la profondeur de la chaîne Wi-Fi sur le Cortex-M4, ni le comportement des interruptions ; d'où le canari du § 6.

## 9. Risques résiduels et état du TFT 2,8″

* **Jamais sur carte** (déplacement de `SP` pour le réseau). Le trampoline est celui de `PodEd`, validé ; mais le contenu exécuté dessus (client TLS, modem) est nouveau pour cette pile : si le module Wi-Fi gardait un pointeur vers une variable automatique de la transaction au-delà de son retour, l'effacement de la pile le révélerait — le canari le verra (erreur Wi-Fi, `-1`/`-2`).
* **Appels Wi-Fi hors transaction** (§ 2) : marge principale de 160 o à `6a`.
* **TFT 2,8″ : reste BLOQUÉ pour tout flash.** Le réseau y est corrigé de la même façon (compilé), mais sa pile principale **au vote** est de 964 o statiques (marge 60 o) à cause du cadre de `doValidate` — non traité dans ce lot (rapport avant/après dans `docs/mesures/8B2B2_NETSTACK_FIX1_2026_10_09/`).
* **ESP8266** : non concerné.
* **Pile principale au moment de la signature du vote** (statique, `loop → doValidate → PodEd::sign`, 1 024 o disponibles) : la lecture du candidat est une fonction à part (`netReadCandidate`, noinline) qui ne vit plus pendant la signature ; son cadre quitte celui de `doValidate`.

| Firmware | avant | après |
|---|---|---|
| R4 e-ink 2,9″ | 868 o (marge 156 o) | **740 o (marge 284 o)** |
| R4 e-ink 2,7″ | 868 o (marge 156 o) | **716 o (marge 308 o)** |
| R4 e-ink 2,7″ + OLED | 876 o (marge 148 o) | **724 o (marge 300 o)** |
| R4 TFT 1,8″ | 868 o (marge 156 o) | **716 o (marge 308 o)** |
| R4 TFT 2,8″ | 964 o (marge 60 o) | **964 o (marge 60 o)** |

  Les quatre premiers dépassent désormais l'objectif de 256 o. **Le TFT 2,8″ reste à 60 o** : ses deux téléchargements de clip (banc d'essai, clip de bloc) sont inlinés dans `loop()`, qui porte `doValidate` ; ils ont donc été sortis eux aussi dans des fonctions noinline (`netGetBenchClip`, `netGetBlockClip`) pour ne PAS aggraver (premier essai : 988 o), mais le cadre résiduel de `doValidate`/`loop` n'est pas traité ici.
