# Lot 8B-2B-2 · NETSTACK-WIFI-CALLS-FIX1 — tout appel direct au module Wi-Fi sur une pile dédiée

| | |
|---|---|
| **Date** | 09/10/2026 (nuit) |
| **Statut** | **Livré, COMPILÉ (cœurs 1.5.3 et 1.6.0), testé sur l'hôte. JAMAIS flashé.** Aucune frame, aucun vote, aucun OTA. Le canari sans frame est à refaire APRÈS l'audit GPT. |
| **Origine** | canari NETSTACK-FIX3-R1 : `macString : PREMIERE sous-phase fautive = 1`, R0 sain (`docs/mesures/8B2B2_NETSTACK_WIFI_CALLS_FIX1_2026_10_09/journal-netstack-fix3r1-materiel.txt`) |
| **Portée** | `podNetStack.h` (`podWifiRun`), les cinq firmwares UNO R4, canari e-ink 2,9″ (relevé de la pile Wi-Fi), tests, scripts d'ELF. **Aucun** serveur, Redis, Neon, ACK, vote, rendu, OTA, polling. Redis +0, Neon 0. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

## 1. Ce qui est maintenant PROUVÉ sur la carte — et ce qui ne l'est pas

* **Prouvé (matériel)** : `WiFi.macAddress()`, appelé depuis `doRegister` (cadres cumulés 512 o), détruit le marqueur de pile : 24 o sous `__StackLimit`, signature identique aux canaris FIX1, FIX2 et FIX3. La chaîne `ModemClass → vsnprintf → _svfiprintf_r → __ssputs_r → _realloc_r` pose une feuille de 400 – 600 o sur le cadre de l'appelant (592 o statiques depuis `macAddress`).
* **Non exécutés avant l'arrêt, donc NON prouvés** : le `snprintf` de la MAC, le constructeur de `String` et **toute transaction PodNet** (les sondes de phase de PodNet n'ont jamais été exercées sur la carte). Le prochain canari doit les exercer ; leurs phases doivent rester à zéro.
* Conséquence : la même classe de défaut menace **tout appel au module** posé sur un cadre profond (`status`, `localIP`, `firmwareVersion`, `RSSI`, `begin`). Aucun n'est mesuré fautif, tous sont désormais traités.

## 2. Audit des appels directs au module Wi-Fi (cinq firmwares)

Recherche exhaustive de `WiFi.<méthode>(` dans les cinq `.ino` et les en-têtes (aucun appel dans les `.h`) :

| Appel | Où (avant) | Pile (avant) | Traitement |
|---|---|---|---|
| `WiFi.macAddress()` | `macString()` ← `doRegister` ; `gatherEntropy()` ← `generateKeys()` ← `setup()` | principale, jusqu'à 1 104 o statiques (**fautif prouvé**) | `wifiMac()` |
| `WiFi.RSSI()` | `gatherEntropy()` | principale | `wifiRssi()` |
| `WiFi.status()` | `setup()` : test « module absent », boucle de connexion (≈ 80 appels), test final | principale (584 o + cadres) | `wifiStatus()` / `wifiStatusT()` |
| `WiFi.firmwareVersion()` | `setup()` (journal) | principale (600 o) | `wifiFirmware()` |
| `WiFi.begin()` | `setup()` (boucle de 4 tentatives) | principale (**664 o**, le plus profond) | `wifiBegin()` |
| `WiFi.localIP()` | `setup()` (journal, et affichage TFT) | principale (632 o) | `wifiIpString()` |
| `WiFiSSLClient` (`connect`, `print`, `read`, `stop`…) | `Conn`, **toujours** dans une lambda `podNetRun` | pile réseau dédiée (FIX1, validée) | **inchangé — non ré-enveloppé** (pas d'imbrication) |

Aucun autre appel direct au module n'existe (pas de `disconnect`, `SSID`, `gatewayIP`, `getTime`…). Vérification **dans l'ELF** (`scripts/wifi-stack-report.js`, § 6) : les seuls appelants directs des méthodes de `CWifi` sont les six invocateurs de `podWifiRun`.

## 3. Mécanisme : `podWifiRun` (pile de 1 536 o)

`consensus-pod/src/adapters/podNetStack.h` (copié dans les cinq dossiers par `scripts/sync-bench-header.js`) :

```cpp
#define POD_WIFI_STACK_TOTAL 1536u
template <typename F> static bool podWifiRun(F& f, PodNetInfo* info = nullptr);   // = PodNet::runSized(…, POD_WIFI_STACK_TOTAL, info)
```

Même mécanisme, mêmes garanties que `PodNet` (validé sur la carte : 1 172 o utilisés / 812 o de marge) : bloc pris un instant au tas, **garde de 64 o** (0xC3), pile peinte (0xA5, **filigrane**), trampoline Thumb de 8 instructions, **marge ≥ 128 o exigée**, **objectif 256 o** (`PodNetInfo::low`), effacement complet avant `free`, **jamais imbriqué** (`NESTED`), échec fermé (`NOMEM`, `NESTED`, `GUARD`, `MARGIN`). Les sondes `POD_NET_PROBE` (phases 1 à 8) sont **conservées** : elles s'exécutent aussi pour chaque appel au module, ce qui exerce enfin `runSized` sur la carte.

### 3.1 Taille 1 536 o — confirmée par l'ELF

`scripts/wifi-stack-report.js` sur l'ELF du canari (analyse statique, branche flottante de `printf` exclue, jamais exécutée : aucun `%f`) :

```
# NETSTACK-WIFI-CALLS-FIX1 — ELF de pod_uno_r4_eink29, cœur 1.6.0, rendu v1 ON (statique ; rien n'a été flashé). Code de sortie du contrôle : 0 (0 = t
# 1. Appels au module Wi-Fi sur la pile dédiée (6 invocateurs trouvés) — taille totale 1536 o, garde 64 o
  wifiBegin        profondeur  664 o   appels indirects atteignables 30   Z10podWifiRunIZL9wifiB > CWifi5beginEPKcS1_(88) > CWifi6statusEv(56) > Modem
  wifiIpString     profondeur  640 o   appels indirects atteignables 30   Z10podWifiRunIZL12wifi > CWifi7localIPEv(72) > ModemClass5beginEii(96 > Mode
  wifiFirmware     profondeur  600 o   appels indirects atteignables 30   Z10podWifiRunIZL12wifi > CWifi15firmwareVersion > ModemClass5beginEii(96 > M
  wifiMac          profondeur  592 o   appels indirects atteignables 30   Z10podWifiRunIZL7wifiM > CWifi10macAddressEPh(7 > ModemClass5beginEii(96 > M
  wifiStatusT      profondeur  584 o   appels indirects atteignables 30   Z10podWifiRunIZL11wifi > CWifi6statusEv(56) > ModemClass5beginEii(96 > Modem
  wifi             profondeur  488 o   appels indirects atteignables 28   Z10podWifiRunIZL8wifiR > CWifi4RSSIEv(56) > ModemClass5writeERKNSt > vsnipri
=> pire cas statique 664 o ; exigé = 64 (garde) + 664 + 32 (réserve) + 104 (cadre d'exception) + 256 (objectif de marge) = 1120 o ; taille 1536 o → SU
# 2. Audit : qui appelle directement le module Wi-Fi (méthodes de CWifi) ?
  OK  Z10podWifiRunIZL11wifi         → statusEv
  OK  Z10podWifiRunIZL12wifi         → firmwareVersionEv
  OK  Z10podWifiRunIZL12wifi         → localIPEv
  OK  Z10podWifiRunIZL7wifiM         → macAddressEPh
  OK  Z10podWifiRunIZL8wifiR         → RSSIEv
  OK  Z10podWifiRunIZL9wifiB         → beginEPKcS1_
=> 6 appelants du module, dont 0 hors invocateur de podWifiRun (AUCUN : tout appel direct passe par la pile dédiée)
```

Exigé = garde 64 + pire appel **664** (`WiFi.begin`) + 32 (réserve invocateur/lambda) + cadre d'exception 104 + objectif de marge 256 = **1 120 o** ; **1 536 o** laissent 416 o de réserve. Un `static_assert` dans `podNetStack.h` interdit toute réduction sous 1 120 o. 1 536 o est aussi la taille de la pile de journal (même marge visée). **Le canari mesure l'utilisation réelle** (ligne `[CANARY] wifi …`) : si `marge < 256`, la taille sera revue — pas avant.

## 4. Enveloppes (production, cinq firmwares)

Six fonctions `noinline`, définies avant la section des clés ; chacune pose ses variables chez elle, appelle `podWifiRun` sur une lambda `wx` qui n'écrit que dans ces variables, puis **n'expose le résultat que si l'exécution a réussi** :

| Enveloppe | Succès | Échec (`NOMEM`, `NESTED`, `GUARD`, `MARGIN`) |
|---|---|---|
| `wifiStatusT(tag)` / `wifiStatus()` | état `WL_*` | **`0xFE` (« inconnu »)** : ni `WL_CONNECTED` ni `WL_NO_MODULE` |
| `wifiFirmware()` | version | `"?"` |
| `wifiBegin()` | — | journalisé ; la boucle de connexion décide sur le statut |
| `wifiMac(m)` | `true`, octets chez l'appelant | `m` remis à zéro, **`false`** |
| `wifiRssi(r)` | `true`, valeur | `r = 0`, **`false`** |
| `wifiIpString()` | « a.b.c.d » | `"?"` |

Échec → `wifiFailed()` : journal **honnête** (`podNetWhy` : *NON exécutée (mémoire/imbrication)* ≠ *EXÉCUTÉE mais résultat local REJETÉ (garde/marge)*, erreur, marge) ; **`GUARD` → `logfSafeStop()`** (garde écrasée = voisin du tas corrompu : arrêt sûr silencieux, comme pour la pile de journal).

### 4.1 Échec fermé aux sites d'appel

* **Inscription** : `macString()` rend une chaîne **vide** si `wifiMac` échoue ; `doRegister` la refuse (`return false`, journal « inscription ANNULÉE ») **avant** de construire le corps et d'appeler `httpCall` : aucun `POST /api/register` fondé sur une MAC absente ou partielle. L'inscription sera retentée au cycle suivant.
* **Clés** : `gatherEntropy` retourne `false` (entropie remise à zéro) si le module échoue ; `generateKeys` annule (clé privée effacée, **aucune clé enregistrée**, aucune dérivation).
* **Connexion** : un statut « inconnu » n'est jamais traité comme connecté ; après les tentatives, le chemin existant « échec — redémarrage » s'applique ; il n'est **pas** pris pour « module absent ».
* **Vote, ACK, affichage** : aucun ne dépend d'un appel au module (ils passent par `httpCall`, déjà fermé) ; rien n'est fondé sur un résultat partiel.
* **Imbrication** : aucune enveloppe n'est appelée depuis une transaction PodNet (test statique : aucune lambda `tx` ne contient d'appel au module ni `podWifiRun`) ; un appel qui s'exécuterait quand même sur une pile dédiée serait refusé (`NESTED`) au lieu d'être ré-enveloppé.

## 5. Adresse MAC : hexadécimal manuel borné

`snprintf("%02x:…")` est remplacé par `macHexDigit()` + une boucle de six tours dans un `char b[18]` (17 caractères + NUL, indices ≤ 17) :

```cpp
for (uint8_t i = 0; i < 6; i++) { b[3*i] = macHexDigit(m[i] >> 4); b[3*i+1] = macHexDigit(m[i] & 15); b[3*i+2] = (i < 5) ? ':' : '\0'; }
```

Ce n'était pas le coupable mesuré, mais cela retire une chaîne `printf` inutile (`sniprintf`, 384 o) d'un chemin dont la marge statique n'est que de 128 o. **Test** : le résultat est identique à `"%02x:%02x:%02x:%02x:%02x:%02x"` pour 256 motifs d'octets dans toutes les positions ; toujours 17 caractères.

## 6. Instrumentation du canari (e-ink 2,9″), conservée et étendue

* **Conservées** : sondes de phase de PodNet (`POD_NET_PROBE`, `pad[0]`), points `R0`, `R1`, `R2`, sous-phases de `macString()` (1 : après l'appel au module — désormais sur pile dédiée ; 2 : après l'encodage hexadécimal ; 3 : après la construction du `String`), points A/B/C, sonde de la pile de journal.
* **Ajoutée — relevé de la pile Wi-Fi** : `podCanaryWifi(tag, ni, ran, verbose)` après chaque appel au module : ligne `[CANARY] wifi <appel> : pile Wi-Fi dediee utilisee N o, marge M o (objectif >= 256 : OK|SOUS L'OBJECTIF), erreur E | tas libre T`. Le statut en boucle reste silencieux (une seule ligne étiquetée au premier appel). Toute erreur de la pile (NOMEM, NESTED, GUARD, MARGIN) pose le **verrou fatal** ; la **phase de PodNet** (`pad[0]`) est contrôlée comme pour une transaction réseau ; la **pile principale** est contrôlée juste après (silencieux) : le marqueur doit rester intact.
* Aucune variable globale ajoutée (RAM statique identique, § 7).

## 7. Compilations — deux cœurs

Dix compilations par cœur (cinq firmwares × OFF/ON, TFT 2,8″ OFF seul, + canari 1/1), `--warnings all`, **cœurs 1.5.3 ET 1.6.0, 20 / 20 exit=0, aucun avertissement du projet**. Référence = le commit FIX3-R1 `4abafc3` (mêmes drapeaux).

| Firmware | Rendu v1 | Flash, cœur 1.5.3 (FIX3-R1 → WIFI-CALLS-FIX1) | Flash, cœur 1.6.0 | RAM statique (o) | Marge statique (o) | Avertissements du projet (2 cœurs) |
|---|---|---|---|---|---|---:|
| R4 e-ink 2,9″ BWR | OFF | 120796 → 121796 (**+1000**) | 120796 → 121796 (**+1000**) | 22768 → 22768 (**+0**, 2 cœurs) | 528 | 0 |
| R4 e-ink 2,9″ BWR | ON | 123820 → 124812 (**+992**) | 123820 → 124812 (**+992**) | 22768 → 22768 (**+0**, 2 cœurs) | 528 | 0 |
| R4 e-ink 2,7″ | OFF | 119948 → 120956 (**+1008**) | 119948 → 120956 (**+1008**) | 19128 → 19128 (**+0**, 2 cœurs) | 4168 | 0 |
| R4 e-ink 2,7″ | ON | 122676 → 123676 (**+1000**) | 122676 → 123676 (**+1000**) | 19128 → 19128 (**+0**, 2 cœurs) | 4168 | 0 |
| R4 e-ink 2,7″ + OLED | OFF | 134800 → 135784 (**+984**) | 134800 → 135784 (**+984**) | 21500 → 21500 (**+0**, 2 cœurs) | 1796 | 0 |
| R4 e-ink 2,7″ + OLED | ON | 137528 → 138512 (**+984**) | 137528 → 138512 (**+984**) | 21500 → 21500 (**+0**, 2 cœurs) | 1796 | 0 |
| R4 TFT 1,8″ | OFF | 130600 → 131584 (**+984**) | 130600 → 131584 (**+984**) | 20864 → 20864 (**+0**, 2 cœurs) | 2432 | 0 |
| R4 TFT 1,8″ | ON | 133240 → 134208 (**+968**) | 133240 → 134208 (**+968**) | 21424 → 21424 (**+0**, 2 cœurs) | 1872 | 0 |
| R4 TFT 2,8″ tactile | OFF | 149404 → 150396 (**+992**) | 149404 → 150396 (**+992**) | 21444 → 21444 (**+0**, 2 cœurs) | 1852 | 0 |
| R4 e-ink 2,9″ BWR | ON + CANARI (1/1) | 128972 → 130468 (**+1496**) | 128972 → 130468 (**+1496**) | 22768 → 22768 (**+0**, 2 cœurs) | 528 | 0 |

Pile principale à la signature du vote (analyse statique de l'ELF, **identique** à FIX3-R1) :

| Firmware | Pile principale à la signature du vote, cœur 1.5.3 (marge) | cœur 1.6.0 (marge) |
|---|---|---|
| R4 e-ink 2,9″ BWR | 740 o (284) | 740 o (284) |
| R4 e-ink 2,7″ | 716 o (308) | 716 o (308) |
| R4 e-ink 2,7″ + OLED | 724 o (300) | 724 o (300) |
| R4 TFT 1,8″ | 716 o (308) | 716 o (308) |
| R4 TFT 2,8″ tactile | 964 o (60) | 964 o (60) |

**Audit de l'ELF des appelants du module** (`scripts/wifi-stack-report.js`, rapports `wifi-stack-<cœur>-<firmware>.txt`) :

| Firmware | Cœur | Pire appel au module (o) | Appelants directs du module | Dont HORS pile dédiée | Contrôle |
|---|---|---:|---:|---:|---|
| R4 e-ink 2,9″ BWR | 1.5.3 | 664 | 6 | **0** | OK |
| R4 e-ink 2,7″ | 1.5.3 | 664 | 6 | **0** | OK |
| R4 e-ink 2,7″ + OLED | 1.5.3 | 664 | 6 | **0** | OK |
| R4 TFT 1,8″ | 1.5.3 | 664 | 6 | **0** | OK |
| R4 TFT 2,8″ tactile | 1.5.3 | 664 | 6 | **0** | OK |
| R4 e-ink 2,9″ BWR | 1.6.0 | 664 | 6 | **0** | OK |
| R4 e-ink 2,7″ | 1.6.0 | 664 | 6 | **0** | OK |
| R4 e-ink 2,7″ + OLED | 1.6.0 | 664 | 6 | **0** | OK |
| R4 TFT 1,8″ | 1.6.0 | 664 | 6 | **0** | OK |
| R4 TFT 2,8″ tactile | 1.6.0 | 664 | 6 | **0** | OK |

**Profondeur du chemin sur la pile principale** (ELF e-ink 2,9″, les deux cœurs identiques) : un appel au module coûte désormais **≤ 160 o** sous son appelant (enveloppe + `runSized`), contre **592 – 664 o** avant ; cumulé depuis `hal_entry → setup` (248 o) : **≤ 408 o**, et depuis `doRegister` (cumul 512 o) : **≈ 632 o** pour `wifiMac`, contre 1 104 o. Le chemin d'ÉCHEC (journal) est surestimé par l'analyse statique, qui suit la branche directe de `logf` ; en exécution `logf` bascule sur la pile de journal.

**Constat** : RAM statique **+0 o** (e-ink 2,9″ : marge 528 o inchangée) sur les cinq firmwares et les deux cœurs ; flash **+968 à +1 008 o** en production et **+1 496 o** au canari (relevé Wi-Fi) ; marges de vote inchangées (284/308 o) ; TFT 2,8″ à 60 o, **toujours BLOQUÉ**. Les deux cœurs donnent des tailles identiques.

## 8. Tests (hôte)

* **`tests/wifiCalls.test.ts` (22 tests)** — statique, pour chacun des cinq firmwares : aucune ligne `WiFi.<méthode>(` hors d'une enveloppe `auto wx = [&]() {…}` ; exactement une enveloppe par méthode (`status`, `firmwareVersion`, `begin`, `macAddress`, `RSSI`, `localIP`) ; `podWifiRun` n'est utilisé que par les six enveloppes ; **aucune enveloppe ni `podWifiRun` à l'intérieur d'une transaction PodNet** (lambda `tx`) ; échec fermé aux sites d'appel (statut `0xFE`, `"?"`, MAC vide, entropie annulée, `generateKeys` sans clé, `doRegister` refuse la MAC vide AVANT `httpCall`) ; `GUARD` → `logfSafeStop` ; hexadécimal manuel dans `char[18]`, plus de `snprintf` ; en-tête : 1 536 o, `static_assert`, copies identiques.
* **Exécution hôte du code RÉEL des enveloppes** (`consensus-pod/host/wifi_calls_harness.cpp`, extrait de CHACUN des cinq sketches, module simulé, logique réelle de `podNetStack.h`) : chaque appel s'exécute sur une pile de 1 472 o utilisables (7 exécutions) ; résultats chez l'appelant ; `NOMEM` et `NESTED` → le module n'est **jamais** appelé, tout est « inconnu / vide / false » ; `MARGIN` → le module est appelé mais **tout résultat est rejeté**, y compris la MAC qu'il a écrite ; `GUARD` → les six enveloppes déclenchent l'arrêt sûr ; journaux honnêtes (*NON exécutée* ≠ *EXÉCUTÉE mais résultat local REJETÉ*) ; **MAC hexadécimale == `%02x:…` pour 256 motifs**, 17 caractères.
* **Contrôles négatifs (10 mutants refusés)** : statut / firmware / IP / RSSI rendus malgré l'échec, MAC rendue malgré `MARGIN`, `GUARD` sans arrêt sûr, `macString` non vide en cas d'échec, chiffres hexadécimaux en majuscules, quartets permutés, appel au module **sans** `podWifiRun`.
* **`consensus-pod/host/net_stack_harness.cpp` (43 vérifications)** : `podWifiRun` — pile de 1 536 o, zone effacée avant `free`, `NOMEM` / `NESTED` (module non appelé), `GUARD` et `MARGIN` (appelé mais rejeté), marge 128 acceptée / 100 refusée / 256 = objectif, aucune dérive du tas.
* **`consensus-pod/host/canary_check_harness.cpp` (30 scénarios, +12)** : le **code réel** de `macHexDigit` + `macString` (sous-phases 1, 2, 3, marqueur déjà détruit, format, **échec du module → chaîne vide, aucun rapport**) ; relevé de la pile Wi-Fi : ligne utilisé/marge/erreur, silence si sain et non verbeux, **verrou fatal** sur `MARGIN`, phase de PodNet fautive pendant un appel Wi-Fi, pile **principale** contrôlée après l'appel (marqueur détruit → alerte + verrou) ; mutants des sous-phases refusés.
* **`tests/netStack.test.ts`, `canaryBootFix2.test.ts`, `canaryPrep.test.ts`** adaptés : les lambdas du module s'appellent `wx` (les tests comptent `tx` = une par `Conn`) ; aucune variable globale dans le canari ; texte hors canari strictement inchangé.
* **Suite complète** : `npm test` **700 / 702** dans l'arbre du porteur (les 2 échecs viennent uniquement de ses copies Arduino non suivies de `consensus-pod/examples/Ed25519StackProbeUnoR4/podRender*.h`, comptées comme « consommateurs » de `podRender.h`) ; depuis un `git clone --local` du commit (sans copies Arduino locales, sans `secrets.h`, sans drapeaux 1/1) : **702 / 702**, `tsc` propre ; `npx tsc --noEmit` et `npx eslint` propres ; `git diff --check` propre.

## 9. Lecture du prochain canari (sans frame, après audit)

Sketch : `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` avec `1`/`1` ; moniteur 115200 ; aucun dessin ; **register + 3 pulls, ~5 min** ; copier TOUT le journal.

| À observer | Attendu |
|---|---|
| `[CANARY] wifi firmwareVersion/begin/localIP/macAddress/RSSI … erreur 0` | utilisé ≲ 700 o, **marge ≥ 256 o** (sinon revoir la taille) |
| `[CANARY] 6a avant doRegister …` puis R0, R1, R2 | **aucune alerte** ; plus de `macString : PREMIERE sous-phase …` |
| `[CANARY] net http … / pull-frame …` | **PodNet enfin exercé** : `erreur 0`, **aucune** ligne `PodNet : PREMIERE phase fautive` |
| 3 pulls | `/api/register` 200, `/api/pull` ×3, pile principale saine, aucun verrou |

Si une phase de PodNet apparaît, c'est le premier relevé matériel de l'épilogue de `runSized` : le rapporter tel quel, sans corriger d'avance.

## 10. Ce qui reste ouvert / bloqué

* La taille 1 536 o est confirmée **statiquement** ; la mesure réelle viendra du canari.
* Les appels indirects (pointeurs de fonction) de la bibliothèque ne sont pas suivis par l'analyse statique ; le canari mesure l'utilisation réelle.
* **PodNet** : jamais exercé sur la carte avec le correctif ; ses phases doivent rester à zéro.
* Les ESP8266 ne sont pas concernés. **TFT 2,8″ : toujours BLOQUÉ pour tout flash** (pile principale au vote : 964 o, marge 60 o).
