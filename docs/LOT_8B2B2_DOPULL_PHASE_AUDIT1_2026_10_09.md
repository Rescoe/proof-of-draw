# Lot 8B-2B-2 · DOPULL-PHASE-AUDIT1 — localiser, par phases, le débordement du traitement local de `doPull`

| | |
|---|---|
| **Date** | 09/10/2026 (nuit) |
| **Statut** | **Instrumentation seule livrée, COMPILÉE (cœurs 1.5.3 et 1.6.0), testée sur l'hôte. JAMAIS flashée.** Aucune correction : la décision (noinline, pile de travail dédiée, réduction des temporaires) attend la nouvelle mesure matérielle. Aucune frame. |
| **Origine** | canari matériel de `e99f77e` (`docs/mesures/8B2B2_DOPULL_PHASE_AUDIT_2026_10_09/journal-e99f77e-materiel.txt`) et audit `docs/AUDIT_GPT_E99F77E_DOPULL_2026_10_09.md` |
| **Portée** | le seul sketch **UNO R4 e-ink 2,9″**, uniquement dans des blocs `#if POD_RENDER_V1 && POD_CANARY`, plus deux déplacements de texte de production sans effet sur le code compilé (§ 6), tests, `scripts/dopull-chain-report.js`, documentation. **Aucun** serveur, Redis (+0), Neon (0), protocole, OTA, polling, taille de pile (principale ou dédiée), ni déplacement du JSON dans la transaction TLS. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

## 1. Ce que le canari de `e99f77e` établit sur la carte

* Le correctif B (`e99f77e`) fonctionne : le premier pull HTTP 200 revient, son rapport s'imprime et l'exécution atteint la fin de `doPull`.
* Piles dédiées saines : journal 416 / 1 056 o, Wi-Fi 448–608 / ≥ 864 o, Ed25519 ≥ 708 o, PodNet 1 136 / **848** o (inscription et pull), erreurs 0.
* **Défaut réel** : après `[PULL] cartel: …`, `[PULL] nouveau bloc #95`, `[PULL] aucune frame`, le contrôle `7b` (après le retour de `doPull`, appelé depuis `setup`) donne **1 016 / 1 024 o, marge 8 o, marqueur `CNRY` DÉTRUIT** (`0x16FF8788`). Ce n'est ni la zone 0xA5 indicative, ni une marge « sous l'objectif » : c'est un vrai débordement de la pile principale, **indépendant du réseau, de TLS, des signatures et du rendu** (le point A, juste après la transaction, était sain).
* **Trompeur** : `longueur peinte=0x000001A1 (OK)` alors que le boot avait écrit `0x00000250`. Le contrôle ne vérifiait qu'une **plage** (16–1 024) : une longueur altérée mais plausible passait pour « OK ».

## 1 bis. Découverte : les sondes de phase de PodNet étaient INACTIVES dans les builds de l'IDE Arduino

Le bloc de sondes (`podNetProbe`, `POD_NET_PROBE`) était placé **avant** la définition des drapeaux du fichier (`#ifndef POD_RENDER_V1 … #define POD_RENDER_V1 1`, ligne ≈ 56). Or `#if POD_RENDER_V1 && POD_CANARY` avec des macros **non encore définies** vaut `0` : dans un build qui règle les drapeaux **dans le fichier** (le cas du porteur, depuis l'IDE) le bloc était **exclu en silence** et `POD_NET_PROBE` restait le no-op par défaut de `podNetStack.h`. Seuls mes builds `-DPOD_RENDER_V1=1 -DPOD_CANARY=1` les voyaient. Conséquences, dites sans détour :

* **les canaris matériels FIX3 → `e99f77e` n'ont jamais exercé les sondes de phase de PodNet** ; l'absence de « `PodNet : PREMIERE phase fautive` » dans leurs journaux ne prouve **rien** sur les phases de PodNet (les points `R0`–`R2`, `A`/`B`/`C`, `macString`, les relevés Wi-Fi/réseau, eux, sont dans des fonctions situées après les drapeaux : actifs) ;
* le build IDE du canari était plus petit (130 644 o) que le build `-D` (130 844 o) pour cette raison ;
* le nouveau bloc de statiques/macro de `doPull` aurait cassé la compilation de l'IDE (`g_podPaintLen` non déclaré) — détecté à la compilation du fichier local 1/1, pas par les builds `-D`.

**Correction** : pour le seul sketch e-ink 2,9″, le bloc de sondes **et** l'inclusion de `podNetStack.h` (qui doit le suivre) passent juste **après** `// POD_RENDER_V1_END`, donc après les drapeaux. Compilé en IDE-form (drapeaux 1/1 dans le fichier) : 131 876 o, RAM 22 784 o — sondes actives. Test dédié : aucun bloc de canari avant la définition des drapeaux (+ mutant). **À partir du prochain canari, les phases de PodNet sont enfin réellement observées.**

## 2. Instrumentation (canari e-ink 2,9″ seulement)

### 2.1 Longueur peinte : comparaison EXACTE

`podCanaryPaint()` mémorise la longueur initiale (`g_podPaintLen`). `podCanaryCheck` exige désormais `painted == g_podPaintLen` (en plus de la plage) ; le diagnostic dit `(OK : identique a l'initiale)` ou `(INCOHERENTE : initiale 0x…)`. Effet : **tous** les points de contrôle voient une longueur altérée de 1 bit, ce que l'ancien test jugeait « OK ».

### 2.2 Dix sondes silencieuses dans `doPull`

Chaque sonde est un bloc `#if POD_RENDER_V1 && POD_CANARY` contenant **uniquement** la macro :

```cpp
#define POD_DP_PROBE(n) do { if (g_podDpPhase == 0 && (*(volatile uint32_t*)&__StackLimit != 0x434E5259UL
                          || *((volatile uint32_t*)&__StackLimit + 1) != g_podPaintLen)) g_podDpPhase = (n); } while (0)
```

Lecture de deux mots de la pile et d'un octet : **aucune E/S, allocation, `String`, `logf`, `mallinfo`, ni appel** ; comparaison **exacte** (marqueur `!= 'CNRY'`, longueur `!= initiale`), sans plage ; la **première** phase fautive est conservée (`g_podDpPhase == 0` avant d'écrire).

| Phase | Position dans `doPull` | Si c'est la première où l'instrument voit une différence |
|---|---|---|
| **1** | entrée (`g_podDpPhase = 0` puis sonde, avant les `String` de résultat) | le cadre de `doPull` lui-même (prologue) ou l'appel depuis `setup` |
| **2** | juste après `httpCall` | la chaîne HTTP/TLS (déjà couverte par A/B/C : peu probable) |
| **3** | après `JSON_DOC(doc, 2048)` | l'allocation du document JSON (tas) |
| **4** | après `deserializeJson` et le test d'erreur | ArduinoJson (analyse) |
| **5** | après l'extraction bloc / candidat / frame | conversions `JsonVariant` → `String` |
| **6** | après le cartel et son journal | `asciiFold` ×2 et `logf` avec ses temporaires |
| **7** | après l'observation et `ownedBlock` | la branche observation (sérialisation en `String`), EEPROM du bloc possédé |
| **8** | après la fermeture du bloc (destruction de `doc` et `resp`) | les destructeurs |
| **9** | après la mise à jour du bloc (EEPROM, journal « nouveau bloc ») et du candidat | `saveBlockHashToEEPROM`, `logf` |
| **10** | après le journal « aucune frame », juste avant `return true` | ce `logf` |

Lecture : **phase n = la destruction a eu lieu entre la phase n−1 (saine) et la phase n.** Si aucune phase ne s'allume mais que `7b` alerte, la destruction est dans l'épilogue de `doPull` (destructeurs des quatre `String` de résultat, retour) ou dans le rapport.

### 2.3 Rapport APRÈS le retour de `doPull`

`podCanaryDoPull()` (noinline) est appelé **par l'appelant** juste après `doPull()` — dans `setup` (avant le contrôle `7b`) et dans la boucle principale. S'il y a une phase, il imprime `[CANARY] doPull : PREMIERE phase fautive = n (…)` **sur la pile de journal dédiée**, puis pose le verrou fatal ; sinon il ne fait rien. Aucun rapport n'est émis depuis le cadre de `doPull` (leçon de WIFI-CALLS-FIX3 : une mesure prise depuis un cadre profond fausse la mesure). **Limite** : le troisième appel (`doPull()` après une validation minée, ligne unique de la boucle) n'est pas rapporté ; la phase serait écrasée à la prochaine entrée.

### 2.4 Coût de l'instrument — dit honnêtement

* **RAM statique** : +16 o mesurés (22 768 → 22 784 : deux statiques, `uint32_t` + `uint8_t`, avec l'alignement) ; marge statique 528 → **512 o**. Exception documentée et testée à la règle « aucune variable globale dans le canari » (`tests/canaryPrep.test.ts` : exactement ces deux).
* **Cadre de `doPull`** : 280 o (production) → **288 o** (canari) : les sondes ajoutent 8 o. L'instrument mesure donc un chemin légèrement plus profond que la production ; la marge de production est ≥ celle du canari.
* **Flash du canari** : 130 844 → 131 884 o (+1 040 o).

## 3. Analyse ELF : `setup → doPull` et `loop → doPull`

`scripts/dopull-chain-report.js` (analyse **statique** : appels directs, cadres fixes ; branche flottante de `printf` et `logfEmit` exclus — `logfEmit` tourne sur la pile de journal ; appels indirects non suivis). Rapports complets, deux cœurs identiques : `docs/mesures/8B2B2_DOPULL_PHASE_AUDIT_2026_10_09/dopull-chain-{canari,production-on}-{1.5.3,1.6.0}.txt`.

| Chaîne (ELF canari, cœurs 1.5.3 = 1.6.0) | Cadres | Cumul jusqu'à `doPull` | Reste pour les appelés |
|---|---|---:|---:|
| `hal_entry → arduino_main → setup → doPull` | 8 + 16 + **224** + 288 | **536 o** | 488 o |
| `hal_entry → arduino_main → loop → doPull` | 8 + 16 + **56** + 288 | **368 o** | 656 o |

**Constat structurant** : le premier pull part de `setup` (cadre de 224 o), les suivants de `loop` (56 o) — **168 o de moins**. Le canari sans frame s'arrête au premier pull, c'est-à-dire sur le chemin le plus profond ; la production y passe aussi à chaque démarrage.

Pire chaîne sous `doPull`, par catégorie (statique) :

| Catégorie | Sous `doPull` | Cumul depuis `setup` | Cumul depuis `loop` |
|---|---:|---:|---:|
| **ArduinoJson** — conversion `JsonVariant` → `String` par sérialisation (584 o) | 584 | **1 120 o (dépasse 1 024)** | 952 o (marge 72) |
| ArduinoJson — `deserializeJson` / analyse (352 o) | 352 | 888 o (marge 136) | 720 o |
| `httpCall` (String, copies) | 216 | 752 o | 584 o |
| affichage e-ink (`displayStream`) | 216 | 752 o | 584 o |
| EEPROM (`persistFrameId`, hashes) | 184 | 720 o | 552 o |
| `asciiFold` | 152 | 688 o | 520 o |
| journal (`logf`, hors `logfEmit`) | 136 | 672 o | 504 o |

Lecture : **la sérialisation JSON → `String` (584 o) dépasse la pile depuis `setup` à elle seule** (1 120 o statiques) ; elle n'est atteinte que par la branche observation (`hArr[i].as<String>()`), non exécutée dans le pull « aucune frame » du canari. Le chemin exécuté ressemble plutôt à `deserializeJson` (888 o) + conversions + journaux + EEPROM, sans dépassement statique évident : **l'analyse statique ne suffit pas à désigner la cause** (appels indirects d'ArduinoJson non suivis, cadres variables), d'où les sondes. Aucune cause n'est affirmée ici.

## 4. Tests (hôte)

* **`tests/doPullPhases.test.ts` (6 tests)** : (a) les **dix** blocs de sonde existent, dans l'ordre 1–10, chacun **immédiatement après** son ancre de production (`httpCall`, `JSON_DOC`, test d'erreur, extraction, cartel, `ownedBlock`, fermeture du bloc, candidat, journal « aucune frame ») et ne contient **que** la macro (la sonde 1 : aussi la remise à zéro) ; (b) la sonde 10 précède immédiatement `return true; }` ; (c) rapports **après** `doPull()` dans `setup` (avant `7b`) et dans la boucle ; (d) macro **exacte** (aucune plage, aucun appel) ; statiques : exactement deux ; `podCanaryPaint` mémorise la longueur ; contrôle de longueur exact ; rapport sur la pile de journal puis verrou. **Contrôles négatifs refusés** : chacune des **10 sondes supprimée**, chacune des **8 paires adjacentes permutées**, la sonde 10 placée avant le journal, le rapport du `setup` supprimé, le rapport de la boucle supprimé.
* **Harnais hôte du code réel** (`canary_check_harness.cpp`, **40 scénarios**, +7) : une « fausse `doPull` » enchaîne la **vraie** macro de 1 à 10 en altérant le marqueur ou la longueur avant la sonde k : doPull saine → aucune phase, rapport muet ; marqueur détruit avant la sonde 6 → phase 6 rapportée, verrou ; **longueur modifiée d'un seul bit (donc plausible) → détectée à la phase 4** ; première phase conservée malgré une altération postérieure ; l'entrée remet la phase à zéro ; `podCanaryCheck` refuse une longueur **plausible mais modifiée** (`INCOHERENTE : initiale 0x…`), que l'ancien test de plage acceptait.
* **Suite complète** : `npm test` **709 / 711** dans l arbre du porteur (les 2 échecs viennent uniquement de ses copies Arduino non suivies de `consensus-pod/examples/Ed25519StackProbeUnoR4/podRender*.h`) ; depuis un `git clone --local` du commit (sans copies locales, sans `secrets.h`, sans drapeaux 1/1) : **711 / 711**, `tsc` propre ; `npx eslint` et `git diff --check` propres.

## 5. Compilations — deux cœurs (sketch modifié : e-ink 2,9″)

Trois compilations par cœur (OFF, ON, canari 1/1), `--warnings all`, lancées **l'une après l'autre** (les lancements parallèles perdent parfois un build sans message), **cœurs 1.5.3 ET 1.6.0, 6 / 6 exit=0, aucun avertissement**.

| Build (e-ink 2,9″) | Flash 1.5.3 | Flash 1.6.0 | RAM statique | Marge statique |
|---|---:|---:|---:|---:|
| OFF (`POD_RENDER_V1=0`, `POD_CANARY=0`) — avant : 121 852 | 121 852 | 121 852 | 22 768 | 528 o |
| ON (`POD_RENDER_V1=1`, `POD_CANARY=0`) — avant : 124 892 | 124 892 | 124 892 | 22 768 | 528 o |
| canari (1/1) — avant : 130 844 / 22 768 | **131 884** | **131 884** | **22 784 (+16)** | **512 o** |
| canari, **drapeaux dans le fichier** (build IDE, sans `-D`) — avant : 130 644 (sondes exclues, § 1 bis) | — | **131 876** | **22 784** | **512 o** |

Les quatre autres firmwares (e-ink 2,7″, 2,7″ + OLED, TFT 1,8″, TFT 2,8″) sont **inchangés au caractère près** : leurs compilations (20/20 sur les deux cœurs, `docs/mesures/8B2B2_NETSTACK_WIFI_CALLS_FIX2_2026_10_09/`) restent valables ; marges de vote inchangées (284/308 o, TFT 2,8″ à 60 o, **toujours BLOQUÉ**).

## 6. Production inchangée — preuve

Avec `POD_CANARY = 0`, le **code** compilé est identique à celui de `e99f77e` :

| Build (cœur 1.6.0, chemins de build de même longueur) | Taille avant → après | Fonctions de code identiques (désassemblage normalisé) | Table de symboles (noms, tailles) |
|---|---|---|---|
| OFF (`POD_RENDER_V1=0`) | 121 852 → 121 852 | **1 014 / 1 015** (la seule « différente » est la chaîne de données `__FUNCTION__.N` décodée comme du code par `objdump`) | identique, hors 2 suffixes de compteurs GCC |
| ON (`POD_RENDER_V1=1`, canari éteint) | 124 892 → 124 892 | **1 025 / 1 026** (idem) | identique, hors 6 suffixes de compteurs GCC |

(`scripts/disasm-compare.js` : comparaison **fonction par fonction** après normalisation des adresses absolues et des compteurs `.isra.N`/`.part.N`/`CSWTCH.N` ; résultats archivés `docs/mesures/8B2B2_DOPULL_PHASE_AUDIT_2026_10_09/production-inchangee-{off,on}-1.6.0.txt`.) **Ce n'est plus une identité « octet pour octet »** : la correction du § 1 bis déplace l'inclusion de `podNetStack.h` après les drapeaux, ce qui change l'**ordre** d'émission de quatre fonctions de `pod_vote_r4.h` (`PodMetrics::push`, `PodFeeder::feed`/`finish`, `podVoteMessage`) et donc des adresses (≈ 2 500 octets d'image diffèrent) — aucune instruction ne change. Avant ce déplacement, la preuve était plus forte (1 seul octet différent : le nom du dossier de build).

Dans les sources, les seules lignes de **production** touchées sont : (a) la ligne « aucune frame » de `doPull`, répartie sur deux lignes pour loger la sonde 10 ; (b) la position de la ligne `#include "podNetStack.h"` dans le sketch e-ink 2,9″ (déplacée après `// POD_RENDER_V1_END`). Tout le reste est dans des blocs gardés. Les quatre autres sketches sont inchangés au caractère près (testé).
## 7. Canari à refaire (APRÈS audit GPT) — même fichier local `1`/`1`, aucun dessin

Moniteur 115200 ; **s'arrêter au premier verrou**, copier TOUT le journal.

| À observer | Lecture / suite |
|---|---|
| `[CANARY] doPull : PREMIERE phase fautive = n` | la destruction est survenue entre la phase n−1 et n (tableau § 2.2) → décide entre : refactorisation `noinline` du bloc fautif, traitement JSON sur une pile de travail dédiée (hors transaction TLS), réduction des temporaires. **Aucune correction avant cette mesure.** |
| aucune phase, mais `7b` en alerte | la destruction est dans l'épilogue de `doPull` (destructeurs des `String`) ou dans le rapport ; à reprendre plus finement |
| aucune alerte jusqu'au 3ᵉ pull | `A`, `B`, `C` stables, marge principale ≥ 128 o à chaque point : le défaut du pull n'est alors pas reproduit |

**Aucune frame** avant correction et canari complet. Le TFT 2,8″ reste **BLOQUÉ**.

## 8. Ce qui reste ouvert

* Cause du débordement de `doPull` : **inconnue** (instrumentée, non mesurée).
* La chaîne la plus profonde (`setup → doPull → sérialisation JSON`) dépasse la pile statiquement : à traiter même si le pull du canari ne l'exécute pas (branche observation).
* Le pull minée de la boucle n'est pas rapporté (§ 2.3).
