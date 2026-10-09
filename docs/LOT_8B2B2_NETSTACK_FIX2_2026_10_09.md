# Lot 8B-2B-2 · NETSTACK-FIX2 — la pile principale après la transaction : le journal sur pile dédiée

| | |
|---|---|
| **Date** | 09/10/2026 |
| **Statut** | **COMPILÉ (cœurs 1.5.3 ET 1.6.0) + testé sur l'hôte. JAMAIS flashé depuis ce lot.** Aucune frame, aucun dessin. Un nouveau canari **sans frame** (§ 6) précède tout le reste. |
| **Origine** | Retour matériel du canari NETSTACK-FIX1 (`docs/mesures/8B2B2_NETSTACK_FIX2_2026_10_09/journal-netstack-fix1-materiel.txt`) : la pile réseau dédiée est **validée** (1 172 o utilisés, 812 o de marge, erreur 0, `connect()` ne déborde plus) ; **nouvelle alerte** juste après : `pile max réelle 1048 o`, soit **24 o sous `__StackLimit`**, `SP` du contrôle `0x20007C20` ; le verrou fatal a fonctionné |
| **Portée** | `podNetStack.h` (pile de journal, prédicats), `logf` des 5 sketches R4, helper `netHttpRaw`, formulations d'échec, instrument du canari e-ink 2,9″. **Aucun** serveur, Redis, Neon, ACK, protocole de vote, consensus, rendu, OTA, polling. Redis +0, Neon 0. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

## 1. Lecture du journal : l'alerte n'est pas là où on l'a imprimée

* **Réussi** : `[CANARY] net http : pile reseau dediee utilisee 1172 o, marge 812 o (objectif >= 256 : OK), erreur 0 | tas libre 8220`. La pile dédiée de 2 048 o tient la transaction `register` avec 812 o de réserve.
* **L'alerte est calculée AVANT toute impression de ce point de contrôle** : `podCanaryCheck` lit `utilisee au plus 1016 o` et `pile max 1048` dans la peinture **à son entrée**, puis seulement imprime. Les 24 o écrits sous `__StackLimit` viennent donc d'un passage **antérieur** : le retour de `PodNet::run`, ou le rapport `podCanaryNet` (impressions `Serial`, `freeHeapBytes` → `mallinfo`) qui précède ce contrôle.
* **Profondeur** : `SP = 0x20007C20` → **736 o** de pile au contrôle. Les cadres au-dessus de lui : `hal_entry` 8 + `arduino_main` 16 + `setup` 224 + `doRegister` 264 + `httpCall` 96 = **608 o**, puis `podCanaryNet` (16) et `podCanaryCheck` (112). Le rapport `podCanaryNet` imprime donc depuis ≈ **620 o**.
* **Coût d'une impression USB, mesuré sur la carte** : `1b calibration` (même profondeur que `1 boot`, juste après un rapport) montre **648 − 376 = 272 o** sous le cadre du contrôle pour une ligne de ≈ 180 caractères (tampon USB non saturé). Avec un tampon USB saturé la chaîne descend plus bas (`tud_task`) : **1048 − 620 = 428 o** — exactement le dépassement observé.
* **Conclusion étayée (à confirmer par les points A/B/C)** : l'instrument qui imprime depuis un cadre à 620 o dépasse la pile principale. **Mais le firmware de production a le même défaut** : après la transaction, `httpCall` appelle `logf` à la même profondeur (608 o). Analyse statique de l'ELF : `logf` → `vsniprintf` → `_vsniprintf_r` → `_svfiprintf_r` → `__ssputs_r` → `_realloc_r` → `_malloc_r` → `_sbrk` = **416 o** sans la branche flottante (736 o avec), donc **608 + 416 = 1 024 o : marge nulle** avant même l'écriture USB (`Serial.println`, 272 – 428 o, appel virtuel invisible à l'analyse statique). Il n'y a donc **rien à gagner à supprimer la sonde** : la même séquence tourne en production.
* **Pourquoi la correction ne peut pas être « un cadre de moins »** : retirer la fermeture de `httpCall` (cadre 272 → 96 déjà obtenu en FIX1) ne fait pas gagner les ≈ 300 o qui manquent à une feuille d'E/S de 450 o posée sur 608 o de cadres. Le chemin `setup → doRegister → httpCall` pèse déjà 608 o avant la première feuille.

## 2. Distinguer, pas supposer : points A / B / C (sans repeindre)

Ajoutés dans `httpCall` (canari seulement), **silencieux** (rien n'est imprimé tant que tout va bien), la peinture n'est jamais refaite :

| Point | Où | Ce qu'une alerte à ce point désigne |
|---|---|---|
| **A** `A: apres la transaction (silencieux)` | immédiatement après `netHttpRaw()`, AVANT `podCanaryNet`, `Serial`, `logf`, `freeHeapBytes` | le retour de `PodNet::run` / de la transaction (rien d'autre n'a encore tourné) |
| **B** `B: apres le rapport PodNet (silencieux)` | à la fin de `podCanaryNet` | le rapport PodNet (impressions, `mallinfo`) |
| **C** `C: apres le journal HTTP (silencieux)` | après le `logf` HTTP normal de production | le journal de production |

Lecture : A sain + B sain + C sain = plus de problème sur ce chemin. Depuis FIX2 l'impression elle-même passe par la pile de journal (§ 3), donc **un point B ou C en alerte serait une régression de ce correctif** et non plus l'effet attendu de l'E/S.

## 3. Ce qui change

1. **Helper `netHttpRaw` (noinline)** : la fermeture, `PodNetInfo` et leur cadre n'existent que pendant la transaction ; `httpCall` ne porte plus qu'un cadre de **72 o** (production) / 80 o (canari) au moment du journal, contre 272 o avant NETSTACK-FIX1 et 96 o au canari FIX1 (`-fstack-usage`, cœur 1.6.0). `client.stop()` est **toujours** appelé, y compris si `request()` retourne un code négatif après l'ouverture du client (FIX1 sortait avant).
2. **Journal sur pile dédiée (`POD_LOG_STACK`)** : `logf` formate (`vsnprintf`) et écrit (`Serial.println`) sur une petite pile dédiée de **1 536 o** (`PodNet::runSized`, même trampoline que `PodEd`/`PodNet`, garde, marge, effacement) quand l'appelant est sur la pile principale ; **directement** sur une pile dédiée (dans une transaction) ; **ligne abandonnée** si `malloc`, la garde ou la marge échoue (un journal ne doit jamais arrêter le firmware). Tampon statique unique de 256 o, RAM statique inchangée. C'est le **correctif de production** : toute ligne de journal, à n'importe quelle profondeur, cesse de dépendre des 416 – 700 o de pile que la feuille d'E/S exige.
3. **Instrument du canari** : tout l'affichage (`podCanaryPrint`, `podCanaryPrintNet`, diagnostic d'alerte, verrou) passe par la même pile de journal ; `podCanaryCheck` ne fait que calculer ; si l'impression est impossible (mémoire) et qu'il y a alerte, le verrou est posé **en silence**. Nouvelle **sonde** `[CANARY] pile de journal (ligne de 250 caracteres) : utilisee N o, marge M o` (aux points `1c` et `7b`) : l'utilisation réelle de la pile de journal pour une ligne de 250 caractères.
4. **Formulations honnêtes** (`podNetExecuted` / `podNetWhy`) : `NOMEM` et `NESTED` → « transaction **NON exécutée** » (`fn` n'a pas tourné) ; `GUARD` et `MARGIN` → « transaction **EXÉCUTÉE** mais résultat local **REJETÉ** » : le contrôle a lieu après coup, un **POST, un vote ou un ACK a pu atteindre le serveur**. `httpCall` retourne `-4` (non exécutée) ou `-5` (exécutée, rejetée) et le journal dit « la requête a PU atteindre le serveur ». Sur **TFT** (1,8″ et 2,8″) l'écran est dessiné PENDANT la lecture : « image NON présentée » est supprimé, remplacé par « l'écran a pu être partiellement ou totalement redessiné » ; sur e-ink/OLED, où l'affichage n'a lieu qu'après, la formule « image NON présentée, pas d'ACK » reste exacte.
5. **Tests** : distinction exécutée / non exécutée prouvée sur l'hôte (`fn` a tourné pour `GUARD`/`MARGIN`, pas pour `NOMEM`/`NESTED`) et dans le texte des cinq sketches ; formulations TFT ; `logf` ; point silencieux A/B/C.

## 4. Taille de la pile de journal : 1 536 o (garde 64 o + 1 472 o)

| Grandeur | Valeur (o) | Origine |
|---|---:|---|
| Chaîne `vsnprintf`, pire cas statique avec la branche flottante (jamais exécutée : aucun `%f`) | 712 | ELF, `logfEmit` |
| Idem sans la branche flottante | 392 | ELF |
| Écriture USB `Serial.println` (appel virtuel, invisible à l'analyse statique) | 272 – 428 | carte (`1b` : 272 ; saturé : 428) |
| Cadre d'exception (FPU paresseux) | 104 | architecture |
| Objectif de marge | 256 | cahier des charges |

Pile utilisable 1 472 o. Reste après la chaîne `vsnprintf` du pire cas et un cadre d'exception : **656 o** ; après l'écriture USB saturée (428) et un cadre d'exception : **940 o**. Les deux chaînes ne s'empilent pas (formatage terminé avant l'écriture). La sonde mesure l'utilisation réelle sur la carte.

Tas : le journal alloue 1 536 o **le temps d'une ligne** (jamais pendant une transaction réseau ni une signature : `logf` y est direct ou, sur `PodEd`, n'est pas appelé). À l'alerte du 09/10, l'arène faisait 6 564 o pour 476 o utilisés ; le tas libre restait à 8 220 o. Pic ≈ 476 + 2 048 (réseau) ou + 1 536 (journal) ou + 2 304 (`PodEd`), jamais cumulés.

## 5. Ce que les tests prouvent

`tests/netStack.test.ts` (+ `consensus-pod/host/net_stack_harness.cpp`), `tests/canaryBootFix2.test.ts` (+ `canary_check_harness.cpp`), `tests/edStack.test.ts`, `tests/renderFirmware.test.ts` : transaction brute dans un helper noinline ; `client.stop()` inconditionnel (aucun `return` dans les lambdas) ; `logf` conforme dans les cinq sketches ; distinction non exécutée / exécutée-rejetée ; formulations TFT et e-ink ; instrument entièrement sur la pile de journal et verrou silencieux ; sonde de la pile de journal ; 6 mutations de `PodNet`, 6 de l'instrument refusées (dont « sans verrou » : le mutant tombe dans le verrou silencieux et est tué après 20 s).

**Limites** : l'hôte ne prouve ni le déplacement réel de `SP` pour le journal, ni la profondeur de la chaîne USB sur le Cortex-M4 (appels virtuels), ni les interruptions ; d'où le canari du § 6 et sa sonde.

## 6. Canari SANS frame (FIX2) — protocole et critères

**Sketch** : `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` (drapeaux locaux `1`/`1` ; le commit contient `0`/`0`), `podEdStack.h` et `podNetStack.h` à côté, `secrets.h` inchangé. Moniteur 115200. **Ne rien dessiner.** Laisser tourner **au moins 5 minutes** (register, pull de démarrage, puis ≥ 3 pulls à 60 s).

| Ligne / mesure | Seuil | Si non |
|---|---|---|
| `ecrit sous la limite ou pile max` (tous points) | **1024 constant** | alerte + verrou : arrêt, copier les 5 lignes |
| `[CANARY] net … pile reseau dediee … marge` | ≥ 128 o exigé, ≥ 256 souhaité (attendu ≈ 800 o) ; `erreur 0` | verrou |
| `[CANARY] pile de journal (ligne de 250 caracteres)` | `erreur 0`, marge ≥ 256 o, `(OK)` — **à rapporter** (fixe la taille définitive) | à rapporter |
| Pile principale (`pile utilisee au plus`) aux points A, B, C et suivants | marge ≥ 128 o (visée 256) ; elle ne doit PLUS croître à `6b` | alerte : rapporter quel point (A/B/C) |
| `tas libre` d'une transaction à l'autre | identique ± 64 o (le saut de `sbrk` à la première grosse allocation est normal, il ne doit pas croître) | dérive : arrêt |
| ≥ 3 pulls successifs `-> 200` après `prêt` | oui | rapporter |

Arrêts : toute ligne `ALERTE`, `ARRET FATAL`, redémarrage, blocage, absence de ligne `[CANARY] net` après un `[HTTP …]`. Rollback : firmware stable (EEPROM, clés, appairage jamais effacés).

**Attention au cœur** : le porteur a mesuré avec le cœur **1.5.3**. Le firmware est compilé et testé avec **1.5.3 et 1.6.0** (§ 7) ; les valeurs de pile peuvent différer de quelques dizaines d'octets, la sonde et les points A/B/C mesurent la réalité.

## 7. Compilations — deux cœurs

| Firmware | Rendu v1 | Flash, cœur 1.5.3 (avant → après) | Flash, cœur 1.6.0 (avant → après) | RAM statique (1.5.3 / 1.6.0) | Marge statique après (o) | Avertissements du projet (2 cœurs) |
|---|---|---|---|---|---|---:|
| R4 e-ink 2,9″ BWR | OFF | 119596 → 120780 (**+1184**) | 119596 → 120780 (**+1184**) | 22768 → 22768 / 22768 → 22768 (**+0**) | 528 | 0 |
| R4 e-ink 2,9″ BWR | ON | 122628 → 123804 (**+1176**) | 122628 → 123804 (**+1176**) | 22768 → 22768 / 22768 → 22768 (**+0**) | 528 | 0 |
| R4 e-ink 2,7″ | OFF | 118756 → 119948 (**+1192**) | 118756 → 119948 (**+1192**) | 19128 → 19128 / 19128 → 19128 (**+0**) | 4168 | 0 |
| R4 e-ink 2,7″ | ON | 121468 → 122660 (**+1192**) | 121468 → 122660 (**+1192**) | 19128 → 19128 / 19128 → 19128 (**+0**) | 4168 | 0 |
| R4 e-ink 2,7″ + OLED | OFF | 133384 → 134784 (**+1400**) | 133384 → 134784 (**+1400**) | 21500 → 21500 / 21500 → 21500 (**+0**) | 1796 | 0 |
| R4 e-ink 2,7″ + OLED | ON | 136096 → 137512 (**+1416**) | 136096 → 137512 (**+1416**) | 21500 → 21500 / 21500 → 21500 (**+0**) | 1796 | 0 |
| R4 TFT 1,8″ | OFF | 129368 → 130600 (**+1232**) | 129368 → 130600 (**+1232**) | 20864 → 20864 / 20864 → 20864 (**+0**) | 2432 | 0 |
| R4 TFT 1,8″ | ON | 131984 → 133224 (**+1240**) | 131984 → 133224 (**+1240**) | 21424 → 21424 / 21424 → 21424 (**+0**) | 1872 | 0 |
| R4 TFT 2,8″ tactile | OFF | 147812 → 149388 (**+1576**) | 147812 → 149388 (**+1576**) | 21444 → 21444 / 21444 → 21444 (**+0**) | 1852 | 0 |
| R4 e-ink 2,9″ BWR | ON + CANARI (1/1) | — → 127708 | — → 127708 | 22768 / 22768 | 528 | 0 |

RAM statique **inchangée à l'octet** sur les cinq firmwares et les deux cœurs (aucune variable globale ajoutée : le tampon du journal reste le `static char b[256]` d'avant). Flash : **+1 176 à +1 576 o** (journal sur pile dédiée, helper, sonde du canari). Les deux cœurs donnent exactement les mêmes tailles. Détail : `docs/mesures/8B2B2_NETSTACK_FIX2_2026_10_09/compilations.md`.

**Profondeur statique des transactions réseau** (pile dédiée de 1 984 o utilisables, cadre d'exception 104 o) : cœur 1.5.3 : pire cas avec %f 1456 o, sans %f 1136 o ; cœur 1.6.0 : pire cas avec %f 1456 o, sans %f 1136 o — soit un reste de 424 o dans le pire cas statique, 744 o sans la branche flottante (rapports `netstack-<cœur>-<firmware>.txt`).

**Pile principale à la signature du vote** (statique, 1 024 o disponibles) :

| Firmware | Pile principale à la signature du vote, cœur 1.5.3 : avant → après (marge) | cœur 1.6.0 : avant → après (marge) |
|---|---|---|
| R4 e-ink 2,9″ BWR | 868 o (156) → **740 o (284)** | 868 o (156) → **740 o (284)** |
| R4 e-ink 2,7″ | 868 o (156) → **716 o (308)** | 868 o (156) → **716 o (308)** |
| R4 e-ink 2,7″ + OLED | 876 o (148) → **724 o (300)** | 876 o (148) → **724 o (300)** |
| R4 TFT 1,8″ | 868 o (156) → **716 o (308)** | 868 o (156) → **716 o (308)** |
| R4 TFT 2,8″ tactile | 964 o (60) → **964 o (60)** | 964 o (60) → **964 o (60)** |

Les quatre premiers firmwares dépassent l'objectif de 256 o de marge ; **le TFT 2,8″ reste à 60 o (BLOQUÉ)**.

Cœur 1.5.3 : extrait de l'archive **déjà présente** dans le cache de l'IDE (`Arduino15/staging/packages/ArduinoCore-renesas_uno-1.5.3.tar.bz2`) dans un répertoire de données jetable (`%TEMP%\ac153`, outils par jonction vers `Arduino15/packages/arduino/tools`) : l'installation du porteur n'est pas modifiée. `arduino-cli` y a téléchargé automatiquement deux petits fichiers *dans ce répertoire jetable* (l'index des bibliothèques, 4,3 Mio, et l'outil de découverte `mdns-discovery`, 3,2 Mio) ; rien n'a été téléchargé dans `Arduino15`.

## 8. Suite de tests depuis un checkout propre

`git clone --local` du commit (donc SANS les copies Arduino locales du dossier de la sonde, SANS `secrets.h`, SANS les drapeaux locaux 1/1), `node_modules` relié par jonction, `npm test` : **673 tests, 673 réussis, 0 échec, 0 ignoré** ; `npx tsc --noEmit` propre.

**Constat corrigé au passage** : un PREMIER checkout propre faisait échouer **4 contrôles négatifs** déjà existants (`vectors.txt`, `render-vectors.txt`, `anim-vectors.txt`) : sous Windows avec `core.autocrlf=true`, Git livrait ces fichiers en **CRLF**, et les tests qui modifient « le dernier caractère d'une ligne » tombaient sur le ``. Ils passaient dans l'arbre du porteur parce que ses fichiers existants n'avaient jamais été reconvertis. Correction : `.gitattributes` (`consensus-pod/test-vectors/*.txt text eol=lf`) — l'index était déjà en LF, aucun contenu ne change.

## 9. Risques résiduels et ce qui reste bloqué

* **Jamais sur carte** : le journal sur pile dédiée (déplacement de `SP` à chaque ligne) est nouveau en production ; la taille de la pile de journal est une estimation étayée (sonde au canari).
* **Tas** : `logf` alloue 1 536 o par ligne ; si le tas est trop fragmenté, la ligne est abandonnée (journal incomplet, jamais d'arrêt).
* **`WiFi.begin` / `status` / `localIP`** restent sur la pile principale (864 o à `6a`, marge 160 o).
* **TFT 2,8″ : toujours BLOQUÉ pour tout flash** (pile de vote 964 o statiques, marge 60 o).
* **ESP8266** : non concerné.
