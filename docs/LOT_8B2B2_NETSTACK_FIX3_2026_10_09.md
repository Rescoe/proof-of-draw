# Lot 8B-2B-2 · NETSTACK-FIX3 — localiser les 24 octets : l'épilogue de PodNet paraît innocent PAR L'ANALYSE STATIQUE (non exonéré par le matériel), `WiFi.macAddress()` est le suspect

> **Correction du 09/10/2026 (NETSTACK-FIX3-R1, `docs/LOT_8B2B2_NETSTACK_FIX3_R1_2026_10_09.md`)** : le canari FIX3 a donné `R1` en alerte (R0 sain). Cela prouve que le marqueur est détruit **dans `macString()`** (entre R0 et R1) ; cela ne prouve **pas encore** que c'est `WiFi.macAddress()` (il y a aussi `snprintf` et la construction du `String`), et cela **n'exonère pas PodNet par le matériel** : aucune transaction PodNet n'avait encore eu lieu quand l'alerte est tombée, les sondes de phase de PodNet n'ont donc **pas été exercées**. Les formulations « innocent » / « exonéré » ci-dessous désignent l'**analyse statique** uniquement.

| | |
|---|---|
| **Date** | 09/10/2026 |
| **Statut** | **Instrumentation + analyse de l'ELF livrées, COMPILÉES (cœurs 1.5.3 et 1.6.0), testées sur l'hôte. JAMAIS flashées.** Aucune frame, aucun dessin. **Aucune correction d'architecture n'est choisie** : elle attend la preuve matérielle (§ 5). **Retour matériel (R1)** : voir `docs/LOT_8B2B2_NETSTACK_FIX3_R1_2026_10_09.md`. |
| **Origine** | `docs/CORRECTIF_CANARI_R4_EPILOGUE_PODNET_FIX3_2026_10_09.md` ; journal matériel du canari NETSTACK-FIX2 : `docs/mesures/8B2B2_NETSTACK_FIX3_2026_10_09/journal-netstack-fix2-materiel.txt` |
| **Portée** | `podNetStack.h` (sondes de phase sans E/S), points silencieux de `doRegister`, arrêt sûr du journal, tests. **Aucun** serveur, Redis, Neon, ACK, protocole de vote, rendu, OTA, polling. Redis +0, Neon 0. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

## 1. Ce que le journal FIX2 établit

* Ed25519 reste sain (sign 1316/924, verify 1532/708). **L'alerte tombe au point A**, silencieux, immédiatement après `netHttpRaw()` : avant le rapport PodNet, avant le journal HTTP. **L'hypothèse « les 24 o viennent du journal » est réfutée** (la pile de journal reste utile : elle protège un chemin réellement risqué, § 6).
* Le dépassement est **identique et déterministe** au canari FIX1 : `pile max 1048 = 1024 + 24`. Un code déterministe, antérieur au point A.
* `tas libre` / `sbrk` : le tas n'est pas en cause (`sbrk(0) = 0x2000737C`, 1 924 o sous la limite ; l'écart `8532 → 6988` est la pile de journal temporaire de 1 536 o, pas une fuite).

## 2. Où est le code fautif ? Deux preuves indépendantes, l'une statique, l'autre dans les octets détruits

### 2.1 L'épilogue de PodNet ne peut pas atteindre 1 048 o — PAR L'ANALYSE STATIQUE (non confirmé par le matériel)

`scripts/podnet-epilogue-report.js` sur l'ELF (cœurs 1.5.3 et 1.6.0, `docs/mesures/8B2B2_NETSTACK_FIX3_2026_10_09/elf-*.txt`) :

| Cadre | Taille | Cumul depuis `hal_entry` |
|---|---:|---:|
| `hal_entry` | 8 | 8 |
| `arduino_main` | 16 | 24 |
| `setup` (canari) | 224 | 248 |
| `doRegister` | 264 | 512 |
| `httpCall` | 80 | 592 |
| `netHttpRaw` | 48 | 640 |
| `PodNet::runSized` | 48 | **688** |

Sous `runSized`, l'épilogue (après le retour du trampoline) n'appelle que `memset` (0 o), le contrôle `podEdOnMainStack` (8 o), `free` (→ `_free_r`, 16 o) et, avant le trampoline, `malloc` (→ `_malloc_r` → `_sbrk_r` → `_sbrk`, 40 o). **Pire cas statique : 688 + 40 = 728 o**, soit 296 o de marge. La boucle de scan de la garde/filigrane et `wipe` sont des boucles sans appel (en ligne). Les 24 o sous la limite ne peuvent pas venir de là **si l'analyse statique est exacte** (appels directs, cadres fixes, appels indirects non suivis) ; **le matériel n'a pas encore exercé les sondes de phase de PodNet** : l'exonération n'est pas acquise.

### 2.2 Les octets détruits sont des cadres de `printf`, pas de `PodNet`

Les 32 octets autour de `__StackLimit` (journal FIX2), en petit-boutiste :

| Adresse | Valeur | Lecture |
|---|---|---|
| `0x20007AF8` | `0x20000168` | RAM statique |
| `0x20007AFC` | `0x20007BF8` | adresse de **pile** |
| `0x20007B00` (= `__StackLimit`, le marqueur) | `0x0001D805` | **pointeur de fonction thumb = `__ssputs_r` | 1** |
| `0x20007B04` | `0x20007B3C` | adresse de pile |
| `0x20007B08` | `0x20007BF8` | adresse de pile |
| `0x20007B0C` | `0x0001D893` | **adresse de retour dans `__ssputs_r` (+0x8e)** |
| `0x20007B10` | `0x20007B70` | adresse de pile |

Résolution contre l'ELF du build flashé (commit `66d5b9d`, adresses identiques pour les cœurs 1.5.3 et 1.6.0 : `elf-fix2-flashe-*.txt`) : `0x1D804 = __ssputs_r`, `0x1D892` dans `__ssputs_r`. Ce sont l'objet `FILE` et les cadres de la chaîne **`vsniprintf` → `_vsniprintf_r` → `_svfiprintf_r` → `__ssputs_r` → `_realloc_r`** de newlib — la chaîne de formatage d'une commande AT du module Wi-Fi. La pile est donc descendue, dans un `printf`, jusqu'à 24 o sous la limite.

### 2.3 Quel appel ? `WiFi.macAddress()`, au tout début de `doRegister`

Candidats statiques (cumul depuis `hal_entry` s'ils étaient appelés par `doRegister`, cumul des cadres jusqu'à `doRegister` = **512 o**) :

| Appel | Profondeur propre (sans branche flottante) | Cumul |
|---|---:|---:|
| `WiFi.begin` (dans `setup`, pas dans `doRegister`) | 664 | — |
| **`WiFi.macAddress()`** | **592** | **1 104** |
| `WiFi.localIP()` | 592 | 1 104 (appelé dans `setup`) |
| `WiFi.status()` / `firmwareVersion()` | 576 | 1 088 (dans `setup`) |
| `WiFi.RSSI()` | 480 | 992 |
| `snprintf` direct | 384 | 896 |

`doRegister` appelle **directement `WiFi.macAddress()` (via `macString()`) puis `snprintf`**, **avant** sa transaction : `512 + 592 = 1 104` en statique, contre **1 048 mesurés** (l'écart de 56 o est la queue `_malloc_r → _sbrk_r → _sbrk`, non atteinte quand `realloc` ne grandit pas — cohérent avec un cadre `_realloc_r` au bord de la limite, § 2.2). C'est le **seul** chemin du code exécuté avant A qui atteigne la limite. Il explique aussi pourquoi FIX1 et FIX2 donnent *exactement* 1 048, et pourquoi les contrôles précédents ne le voyaient pas : **aucun point de contrôle n'existait entre `6a` (avant `doRegister`) et A**, et la peinture est cumulative.

**Statut de la preuve** : hypothèse **forte mais non prouvée sur la carte** (analyse statique + décodage des octets). C'est ce que l'instrumentation du § 3 doit trancher.

## 3. Instrumentation (sans E/S, sans repeindre)

### 3.1 Sondes de phase de `PodNet` (`POD_NET_PROBE`)

`POD_NET_PROBE(info, n)` est un no-op par défaut ; le build de canari de l'e-ink 2,9″ la définit (avant l'inclusion de `podNetStack.h`) pour **lire un seul mot** — le marqueur du canari — et mémoriser dans **`PodNetInfo::pad[0]`** la **première** phase où il est trouvé détruit. Aucun `Serial`, `logf`, `malloc`, `String`, `mallinfo` ni appel de bibliothèque ; aucune profondeur ajoutée.

| Phase | Où | |
|---|---|---|
| 1 | entrée de `runSized` | si 1 : le marqueur était **déjà** détruit avant PodNet (cause antérieure) |
| 2 | après `malloc` + peinture | |
| 3 | juste après `podNetCallOnStack` (retour du trampoline) | |
| 4 | après le scan de la garde / du filigrane | |
| 5 | après le calcul de marge | |
| 6 | après `wipe` | |
| 7 | après `free` | |
| 8 | retour de `podNetRun` | |
| A | retour de `netHttpRaw` (point silencieux existant) | |

La phase est contrôlée (`podCanaryPhase`) **avant** le point A et au début de `podCanaryNet` : une phase non nulle imprime le diagnostic — sur la pile de journal — puis pose le verrou fatal.

### 3.2 Points silencieux dans `doRegister` (avant la transaction)

| Point | Où |
|---|---|
| **R0** | entrée de `doRegister` |
| **R1** | juste après `macString()` (appel au module, `snprintf`, construction du `String` : **sans distinction** ; FIX3-R1 ajoute 3 sous-phases) |
| **R2** | corps construit, juste avant `httpCall` |

### 3.3 Lecture du prochain canari (premier signal)

| Premier signal | Conclusion | Suite |
|---|---|---|
| **R1** en alerte (R0 sain) | le marqueur est détruit **dans `macString()`** (appel au module, `snprintf` ou construction du `String`) : **ne prouve pas à lui seul `WiFi.macAddress()`** → sous-phases de FIX3-R1 ; **PodNet n'est pas exonéré par le matériel** (aucune transaction PodNet n'avait eu lieu) | sous-phases `macString` (FIX3-R1), puis correction du § 5 |
| R2 en alerte, R1 sain | la construction du corps (`loadOwnedHashesJson`, `bytesToHex`, EEPROM, `String`) | à localiser plus finement |
| R0 en alerte | dégât entre `6a` et `doRegister` (aucun appel théorique) | rapporter |
| `PodNet : PREMIERE phase fautive = 1` | marqueur déjà détruit à l'entrée de PodNet : cause antérieure (R0–R2 auraient dû le dire) | rapporter |
| phase 2…8 | l'épilogue de PodNet : **contredit** l'analyse statique ; indique laquelle | à corriger : ne jamais `free` pendant que `SP` pointe dedans, etc. |
| A en alerte, phase 0, R0–R2 sains | quelque chose entre `httpCall` et A hors PodNet (`netHttpRaw`, copie de `String`) | rapporter |
| aucune alerte | la pile principale tient jusqu'au bout : poursuivre (≥ 3 pulls) | — |

## 4. Réserve du journal (demande 4 du correctif)

* **Canari** : la sonde `[CANARY] pile de journal …` (aux points `1c`/`7b`) pose le **verrou fatal** si la pile de journal retourne `GUARD` ou `MARGIN` ; `logf` lui-même s'arrête (`logfSafeStop`) sur `GUARD` **et** `MARGIN` dans le build de canari.
* **Production** : `NOMEM` → ligne abandonnée (inchangé) ; **`GUARD` → ARRÊT SÛR définitif et SILENCIEUX** (`logfSafeStop`, boucle sans fin, **aucune E/S** : depuis FIX3-R1 la fonction n'imprime plus, car un `Serial.println` posé sur un cadre profond de la pile principale peut lui-même la déborder — la garde du journal écrasée signifie que le voisin au tas est corrompu : on ne continue pas) ; `MARGIN` (garde intacte, marge < 128 o) → la ligne est déjà écrite, on continue (non fatal en production, fatal au canari).

## 5. Choix d'architecture — comparés, NON retenus avant la preuve

| Option | Idée | Pour | Contre |
|---|---|---|---|
| **A. Envelopper chaque appel au module Wi-Fi** (`macAddress`, `status`, `localIP`, `RSSI`, `firmwareVersion`, `begin`) dans une courte pile dédiée | même mécanisme que `logf` (`PodNet::runSized`, 1 536 o) | traite la **classe** de défaut (toute feuille `vsnprintf` posée sur un cadre profond) ; pile de 1 536 o suffit (`begin` 664 + exception 104 + objectif 256 = 1 024 < 1 472) | un `malloc` de 1,5 Ko par appel ; ne couvre pas un appel de bibliothèque oublié |
| B. Calculer `macAddress` une fois dans `setup` (cumul 248 + 592 = 840) et le conserver | supprime l'appel de `doRegister` | zéro coût à l'exécution | +12 à 16 o de RAM statique (budget e-ink 2,9″ : 528 o) ; ne traite pas `status`/`localIP`/`RSSI`/`begin` |
| C. Alléger les cadres (`setup` 224, `doRegister` 264) | gagner 100–200 o | aucun mécanisme nouveau | marge toujours insuffisante (592 de feuille sur 512 de cadres) ; fragile |
| D. Exécuter chaque opération complète (`doRegister`, `doPull`…) sur une pile dédiée | structure unique | traite tout d'un coup | gros remaniement ; imbrication avec `PodEd`/affichage ; hors périmètre |

Contraintes de FIX3 respectées : `free()` jamais pendant que `SP` pointe dans le bloc (le trampoline rétablit `SP` avant tout), garde/filigrane/effacement conservés, marge ≥ 128 o (objectif 256), échec honnête `NOMEM/NESTED` ≠ `GUARD/MARGIN`, `client.stop()` conservé, pas d'imbrication, pas de RAM statique ajoutée (RAM inchangée, § 7). **Recommandation à confirmer par le canari : A**, pour tous les appels `WiFi.*` des cinq firmwares.

## 6. Ce que les tests prouvent (hôte)

* `net_probe_harness.cpp` : les 8 phases dans l'ordre ; pour chaque phase `k` destructrice, `pad[0] == k` ; marqueur déjà détruit → phase 1 ; **première** phase conservée ; `NOMEM` → phases 1 et 8 seulement ; la sonde 6 voit la zone effacée et non libérée, la sonde 7 la zone libérée ; sondes neutres (résultat inchangé). Mutations refusées : phase 3 supprimée, phase 7 avant `free`, phase 8 supprimée, sonde écrasante.
* `canary_check_harness.cpp` : `podCanaryPhase(0)` silencieux ; phase non nulle → diagnostic + verrou fatal (18 scénarios) ; tests statiques : R0 < `macString` < R1 < R2 < `httpCall`, phase contrôlée avant A, sonde du journal fatale sur `GUARD`/`MARGIN`, `logfSafeStop` sans sortie.
* Tests existants adaptés (sondes canari, `logf`).

**Limites** : l'hôte ne prouve pas l'état de la pile sur la carte ; l'hypothèse `WiFi.macAddress()` reste à confirmer par R1.

## 7. Compilations — deux cœurs

Quinze compilations par cœur (cinq firmwares × OFF/ON, TFT 2,8″ OFF seul, + canari 1/1), `--warnings all`, **cœurs 1.5.3 ET 1.6.0, toutes exit=0** (rapports : `compilations.md`, `pile-principale-*`, `netstack-*`). Référence « avant » = `1feb5cc` (avant toute la série NETSTACK).

| Firmware | Rendu v1 | Flash, cœur 1.5.3 (avant → après) | Flash, cœur 1.6.0 (avant → après) | RAM statique (1.5.3 / 1.6.0) | Marge statique après (o) | Avertissements du projet (2 cœurs) |
|---|---|---|---|---|---|---:|
| R4 e-ink 2,9″ BWR | OFF | 119596 → 120980 (**+1384**) | 119596 → 120980 (**+1384**) | 22768 → 22768 / 22768 → 22768 (**+0**) | 528 | 0 |
| R4 e-ink 2,9″ BWR | ON | 122628 → 124012 (**+1384**) | 122628 → 124012 (**+1384**) | 22768 → 22768 / 22768 → 22768 (**+0**) | 528 | 0 |
| R4 e-ink 2,7″ | OFF | 118756 → 120172 (**+1416**) | 118756 → 120172 (**+1416**) | 19128 → 19128 / 19128 → 19128 (**+0**) | 4168 | 0 |
| R4 e-ink 2,7″ | ON | 121468 → 122892 (**+1424**) | 121468 → 122892 (**+1424**) | 19128 → 19128 / 19128 → 19128 (**+0**) | 4168 | 0 |
| R4 e-ink 2,7″ + OLED | OFF | 133384 → 135016 (**+1632**) | 133384 → 135016 (**+1632**) | 21500 → 21500 / 21500 → 21500 (**+0**) | 1796 | 0 |
| R4 e-ink 2,7″ + OLED | ON | 136096 → 137728 (**+1632**) | 136096 → 137728 (**+1632**) | 21500 → 21500 / 21500 → 21500 (**+0**) | 1796 | 0 |
| R4 TFT 1,8″ | OFF | 129368 → 130816 (**+1448**) | 129368 → 130816 (**+1448**) | 20864 → 20864 / 20864 → 20864 (**+0**) | 2432 | 0 |
| R4 TFT 1,8″ | ON | 131984 → 133440 (**+1456**) | 131984 → 133440 (**+1456**) | 21424 → 21424 / 21424 → 21424 (**+0**) | 1872 | 0 |
| R4 TFT 2,8″ tactile | OFF | 147812 → 149628 (**+1816**) | 147812 → 149628 (**+1816**) | 21444 → 21444 / 21444 → 21444 (**+0**) | 1852 | 0 |
| R4 e-ink 2,9″ BWR | ON + CANARI (1/1) | — → 128652 | — → 128652 | 22768 / 22768 | 528 | 0 |

Pile principale à la signature du vote (analyse statique de l'ELF) :

| Firmware | Pile principale à la signature du vote, cœur 1.5.3 : avant → après (marge) | cœur 1.6.0 : avant → après (marge) |
|---|---|---|
| R4 e-ink 2,9″ BWR | 868 o (156) → **740 o (284)** | 868 o (156) → **740 o (284)** |
| R4 e-ink 2,7″ | 868 o (156) → **716 o (308)** | 868 o (156) → **716 o (308)** |
| R4 e-ink 2,7″ + OLED | 876 o (148) → **724 o (300)** | 876 o (148) → **724 o (300)** |
| R4 TFT 1,8″ | 868 o (156) → **716 o (308)** | 868 o (156) → **716 o (308)** |
| R4 TFT 2,8″ tactile | 964 o (60) → **964 o (60)** | 964 o (60) → **964 o (60)** |

Profondeur statique des transactions réseau (pile dédiée de 2 048 o) : cœur 1.5.3 : pire cas avec %f 1456 o, sans %f 1136 o ; cœur 1.6.0 : pire cas avec %f 1456 o, sans %f 1136 o.

**Constat** : RAM statique **+0 o** sur les cinq firmwares et les deux cœurs ; flash +1,4 à +1,8 Ko par rapport à `1feb5cc` (FIX2 : +1,2 à +1,6 Ko ; FIX3 ajoute donc **+200 à +240 o** de flash sur chaque firmware : arrêt sûr du journal `logfSafeStop()` sur GUARD et branches de sonde de PodNet — les sondes de phase elles-mêmes sont VIDES hors canari e-ink 2,9″) ; marges de vote identiques à FIX2 (284/308 o ; TFT 2,8″ inchangé à 60 o, **toujours BLOQUÉ**).

## 8. Suite de tests depuis un checkout propre

`git clone --local` du commit FIX3 (code identique au commit final ; seules des mises à jour de documentation ont suivi) (donc SANS les copies Arduino locales du dossier de la sonde, SANS `secrets.h`, SANS les drapeaux locaux 1/1), `node_modules` relié par jonction : `npm test` **676 tests, 676 réussis, 0 échec, 0 ignoré** ; `npx tsc --noEmit` propre. Dans l'arbre du porteur, 2 tests échouent uniquement parce que ses copies Arduino non suivies (`consensus-pod/examples/Ed25519StackProbeUnoR4/podRender*.h`) sont comptées comme « consommateurs » de `podRender.h` (contrôles de périmètre 8A et « sondes jamais déployées » de 8B-1) : défaut d'environnement local connu, absent du dépôt.

## 9. Procédure du prochain canari (sans frame) — diagnostic

Sketch : `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` (drapeaux locaux `1`/`1`). Moniteur 115200, aucun dessin. **S'arrêter au premier `ALERTE`** et copier les 5 lignes : le tag (`R0`, `R1`, `R2`, `phase PodNet`, `A`…) et les octets autour de `__StackLimit` désignent le fautif (§ 3.3). Sans alerte : laisser tourner 5 minutes (register + ≥ 3 pulls), rapporter la sonde `[CANARY] pile de journal` et les lignes `[CANARY] net`.
