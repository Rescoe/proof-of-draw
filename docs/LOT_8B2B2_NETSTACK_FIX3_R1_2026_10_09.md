# Lot 8B-2B-2 · NETSTACK-FIX3-R1 — le marqueur est détruit DANS `macString()` ; sous-phases silencieuses ; arrêt sûr du journal réellement silencieux

| | |
|---|---|
| **Date** | 09/10/2026 (soir) |
| **Statut** | **Correctif étroit livré, COMPILÉ (cœurs 1.5.3 et 1.6.0), testé sur l'hôte. JAMAIS flashé.** Aucune frame, aucun dessin. **Aucun changement d'architecture définitif** : le correctif de fond (§ 6) attend la preuve matérielle des sous-phases. |
| **Origine** | journal matériel du canari NETSTACK-FIX3 (`docs/mesures/8B2B2_NETSTACK_FIX3_2026_10_09/journal-netstack-fix3-materiel.txt`) et verdict GPT « NETSTACK-FIX3-R1 » |
| **Portée** | 3 sous-phases silencieuses dans `macString()` (canari e-ink 2,9″ seulement), `logfSafeStop()` sans E/S (cinq firmwares), corrections de documentation, tests. **Aucun** serveur, Redis, Neon, ACK, protocole de vote, rendu, OTA, polling. Redis +0, Neon 0. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

## 1. Ce que le journal du canari FIX3 établit — et ce qu'il n'établit pas

| Établi (matériel) | Non établi |
|---|---|
| `R0` (entrée de `doRegister`) est **sain** ; `R1` (juste après `macString()`) est **en alerte** : pile max 1 048 = 1 024 + 24, marqueur détruit, longueur peinte incohérente. | Que le coupable soit `WiFi.macAddress()` : `macString()` contient **trois** étapes (appel au module, `snprintf`, construction du `String`) et `R1` ne les distingue pas. |
| Le dégât est donc causé **entre `R0` et `R1`**, c'est-à-dire dans `macString()` (inlinée dans `doRegister`). | Que **PodNet** soit hors de cause. **Aucune transaction PodNet n'avait eu lieu** : ses sondes de phase n'ont pas été exercées. L'analyse statique (épilogue ≤ 728 o) reste une analyse, pas une mesure. |
| Même signature que FIX1/FIX2 : 1 048 o, marqueur = pointeur de fonction thumb `__ssputs_r`+1 (`0x1D8B5`), `0x1D943` = adresse de retour dans `__ssputs_r` (+0x8e) — la chaîne `printf` de newlib. | Que les 24 o de FIX1 et FIX2 soient exactement le même code : ils portent la même signature, ce n'est pas une preuve d'identité. |

**Conséquence honnête** : la formulation « PodNet exonéré » des documents précédents est **retirée** ; elle devient « PodNet : innocent par l'analyse statique, non exonéré par le matériel ». Les documents FIX3 et `CLAUDE.md` sont corrigés.

> Limite de conception du canari à garder en tête : le verrou fatal s'enclenche à la **première** alerte. Tant que le défaut de `macString()` existe, la carte s'arrête avant d'atteindre une transaction PodNet ; les sondes de phase de PodNet ne pourront être exercées qu'**après** que ce défaut aura été contourné ou corrigé. Ce n'est pas une raison de les retirer.

## 2. Sous-phases de `macString()` (canari seulement, silencieuses)

Trois sondes, chacune dans un bloc `#if POD_RENDER_V1 && POD_CANARY` : le texte de `macString()` hors canari est **identique à celui d'avant** (testé).

| Sous-phase | Position | Si c'est la première où le marqueur est trouvé détruit |
|---|---|---|
| **1** | immédiatement après `WiFi.macAddress(m)` | l'appel au module (ou le marqueur déjà détruit à l'entrée : « cette sous-phase **ou avant** », `R0` étant sain, c'est l'appel) |
| **2** | immédiatement après `snprintf(...)` | `snprintf` |
| **3** | immédiatement après la construction du `String` retourné | le constructeur de `String` (allocation) |

* **Une sonde** = lecture d'un mot (le marqueur à `__StackLimit`) et d'un octet local `macPh` : aucun `Serial`, `logf`, `malloc`, `mallinfo`, `String` supplémentaire, aucun appel. La **première** sous-phase fautive est conservée (`macPh == 0` testé avant d'écrire).
* **Où elle est conservée** : dans le `String` retourné lui-même (`"!1"`, `"!2"`, `"!3"` écrasent ses deux premiers caractères, en place, sans allocation) — aucune variable globale (la marge statique du 2,9″ est de 528 o), aucun changement de signature. Une vraie adresse MAC ne commence jamais par `!`.
* **Le String est construit une seule fois** : en canari, `{ String s(b); … return s; }` remplace le `return String(b);` d'avant (qui reste, mort, sous le bloc) ; ce n'est pas un `String` supplémentaire.
* **Rapport après le retour** : `doRegister` appelle `podCanaryMacPhase(mac)` juste après `macString()` ; si le `String` commence par `!`, la fonction imprime — **sur la pile de journal dédiée** — `[CANARY] macString : PREMIERE sous-phase fautive = n`, puis pose le verrou fatal. Sinon elle retourne sans rien faire. Le point `R1` est conservé après (il rattrape une destruction qui surviendrait après la sonde 3, p. ex. dans la copie de retour) ; son libellé dit désormais qu'il **ne prouve pas à lui seul** le module Wi-Fi.

### 2.1 L'instrumentation n'alourdit pas le chemin mesuré (ELF)

Cœur 1.6.0, canari 1/1, avant (`prev`, commit `cf82fcc`) et après (`fix`) — `scripts/podnet-epilogue-report.js` et `-fstack-usage` :

| Mesure | Avant | Après |
|---|---:|---:|
| cadre de `setup` | 224 o | 224 o |
| cadre de `doRegister` (qui contient `macString()` en ligne) | 264 o | **264 o** |
| cumul `hal_entry → doRegister` | 512 o | 512 o |
| cumul jusqu'à `PodNet::runSized` | 688 o | 688 o |
| profondeur `WiFi::macAddress` / `snprintf` depuis `hal_entry` | 1 104 / 896 o | 1 104 / 896 o |
| symbole `macString` séparé | non (inlinée) | non (inlinée) |
| `podCanaryMacPhase` | — | cadre de 16 o, appelée **après** le retour de `macString`, hors du chemin mesuré |

La seule différence du rapport est la résolution d'une adresse de code (le binaire a bougé). Détail : `docs/mesures/8B2B2_NETSTACK_FIX3_2026_10_09/elf-fix3r1-canari-*.txt`.

## 3. `logfSafeStop()` : arrêt fatal silencieux immédiat

Avant : après `POD_NET_GUARD`, la fonction faisait un `Serial.println(F("[LOG] faute memoire …"))` **sur la pile principale, à la profondeur de l'appelant** — c'est précisément le genre d'appel (feuille `vsnprintf` + écriture USB, 270–430 o) qui déborde les 1 024 o. **Après** (cinq firmwares) :

```cpp
static void __attribute__((noinline, noreturn)) logfSafeStop() {
  for (;;) { __asm volatile("nop"); }
}
```

Aucune E/S, aucune allocation, aucun retour. Conséquence assumée : la carte **se tait** (pas de message) ; l'absence de tout pull, vote, ACK et affichage est le signal. Test (`tests/netStack.test.ts`) : le corps doit être *exactement* cette boucle ; aucun `Serial/logf/print*/malloc/free/new/String/mallinfo/delay/millis/return/break/goto/WiFi/Conn/PodNet` ; **7 mutants refusés** (impression avant la boucle, `logf`, allocation, `String`, retour, `delay` sans boucle, `noreturn` retiré).

## 4. Tests (hôte)

* `canary_check_harness.cpp` : **23 scénarios** (18 + 5 nouveaux). Le **code réel** de `macString()` extrait du sketch (blocs de canari activés) tourne contre un module et un `snprintf` simulés qui détruisent le marqueur à la sous-phase demandée : aucune destruction → adresse intacte, rapport muet ; destruction en 1, 2 ou 3 → `"!n"`, rapport `PREMIERE sous-phase fautive = n`, verrou fatal ; marqueur déjà détruit à l'entrée → sous-phase 1 ; **les sondes n'écrivent rien** sur la sortie avant le rapport.
* Contrôles négatifs (5 mutants de `macString` + 1 du rapport) : sonde 1, 2 ou 3 supprimée ; la 2e sonde qui écrase la 1re ; le `String` non marqué ; le rapport sans verrou → tous refusés.
* Test statique : trois blocs gardés, ordre appel < sonde 1 < `snprintf` < sonde 2 < `String s(b)` < sonde 3 ; contenu exact de chaque sonde ; interdits (`Serial`, `logf`, `printf`, `malloc`, `mallinfo`, `String` en plus, `delay`…) ; texte hors canari strictement inchangé ; aucun autre firmware ne porte les sondes.

* **Suite complète** : depuis un `git clone --local` du commit (sans les copies Arduino locales ni `secrets.h`, sans les drapeaux 1/1) : `npm test` **679 / 679**, `npx tsc --noEmit` propre. Dans l'arbre du porteur, 2 tests échouent uniquement à cause de ses copies Arduino non suivies de `consensus-pod/examples/Ed25519StackProbeUnoR4/podRender*.h` (contrôles de périmètre 8A et « sondes jamais déployées » de 8B-1) : défaut d'environnement connu, absent du dépôt.

## 5. Compilations — deux cœurs

Dix compilations par cœur (cinq firmwares × OFF/ON, TFT 2,8″ OFF seul, + canari 1/1), `--warnings all`, **cœurs 1.5.3 ET 1.6.0, toutes exit=0, aucun avertissement du projet**. Référence = le commit FIX3 `cf82fcc` (même procédure, mêmes drapeaux).

| Firmware | Rendu v1 | Flash, cœur 1.5.3 (FIX3 → FIX3-R1) | Flash, cœur 1.6.0 (FIX3 → FIX3-R1) | RAM statique FIX3-R1 (octets) | Marge statique (o) | Avertissements du projet (2 cœurs) |
|---|---|---|---|---|---|---:|
| R4 e-ink 2,9″ BWR | OFF | 120980 → 120796 (**-184**) | 120980 → 120796 (**-184**) | 22768 (**+0** sur FIX3) | 528 | 0 |
| R4 e-ink 2,9″ BWR | ON | 124012 → 123820 (**-192**) | 124012 → 123820 (**-192**) | 22768 (**+0** sur FIX3) | 528 | 0 |
| R4 e-ink 2,7″ | OFF | 120172 → 119948 (**-224**) | 120172 → 119948 (**-224**) | 19128 (**+0** sur FIX3) | 4168 | 0 |
| R4 e-ink 2,7″ | ON | 122892 → 122676 (**-216**) | 122892 → 122676 (**-216**) | 19128 (**+0** sur FIX3) | 4168 | 0 |
| R4 e-ink 2,7″ + OLED | OFF | 135016 → 134800 (**-216**) | 135016 → 134800 (**-216**) | 21500 (**+0** sur FIX3) | 1796 | 0 |
| R4 e-ink 2,7″ + OLED | ON | 137728 → 137528 (**-200**) | 137728 → 137528 (**-200**) | 21500 (**+0** sur FIX3) | 1796 | 0 |
| R4 TFT 1,8″ | OFF | 130816 → 130600 (**-216**) | 130816 → 130600 (**-216**) | 20864 (**+0** sur FIX3) | 2432 | 0 |
| R4 TFT 1,8″ | ON | 133440 → 133240 (**-200**) | 133440 → 133240 (**-200**) | 21424 (**+0** sur FIX3) | 1872 | 0 |
| R4 TFT 2,8″ tactile | OFF | 149628 → 149404 (**-224**) | 149628 → 149404 (**-224**) | 21444 (**+0** sur FIX3) | 1852 | 0 |
| R4 e-ink 2,9″ BWR | ON + CANARI (1/1) | 128652 → 128972 (**+320**) | 128652 → 128972 (**+320**) | 22768 (**+0** sur FIX3) | 528 | 0 |

Pile principale à la signature du vote (analyse statique de l'ELF, identique à FIX3) :

| Firmware | Pile principale à la signature du vote, cœur 1.5.3 (marge) | cœur 1.6.0 (marge) |
|---|---|---|
| R4 e-ink 2,9″ BWR | 740 o (284) | 740 o (284) |
| R4 e-ink 2,7″ | 716 o (308) | 716 o (308) |
| R4 e-ink 2,7″ + OLED | 724 o (300) | 724 o (300) |
| R4 TFT 1,8″ | 716 o (308) | 716 o (308) |
| R4 TFT 2,8″ tactile | 964 o (60) | 964 o (60) |

**Constat** : RAM statique **+0 o** (e-ink 2,9″ : marge 528 o inchangée) ; flash **−184 à −224 o** sur les builds de production (le message de `logfSafeStop()` disparaît) et **+320 o** sur le canari (les sondes et la fonction de rapport) ; marges de vote inchangées (284/308 o) ; TFT 2,8″ à 60 o, **toujours BLOQUÉ**. Les deux cœurs donnent des tailles identiques.

## 6. Lecture du prochain canari (sans frame, AVANT toute architecture)

Sketch : `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` avec les drapeaux locaux `1`/`1`. Moniteur 115200, aucun dessin, **~5 min** (register + 3 pulls si rien n'alerte). S'arrêter au premier `ALERTE`/`PREMIERE …` et copier les lignes.

| Premier signal | Lecture | Suite |
|---|---|---|
| `macString : PREMIERE sous-phase fautive = 1` | l'appel au module pour l'adresse MAC détruit le marqueur (hypothèse « `WiFi.macAddress()` » **prouvée**, pas avant) | choisir parmi A–D (`docs/LOT_8B2B2_NETSTACK_FIX3_2026_10_09.md` § 5) |
| `… = 2` | `snprintf` : l'hypothèse `macAddress` est **fausse** | le formatage de la MAC (cadre de `doRegister` + `sniprintf` 384 o) |
| `… = 3` | la construction du `String` (allocation) | analyser `String::reserve` / `malloc` |
| `R1` seul en alerte | destruction après la sonde 3 (copie / retour) | à reprendre plus finement |
| `R0` en alerte | dégât entre `6a` et `doRegister` | rapporter |
| `R2`, `PodNet : PREMIERE phase fautive = n`, `A`… | les sondes de PodNet sont enfin exercées | voir `docs/LOT_8B2B2_NETSTACK_FIX3_2026_10_09.md` § 3.3 |
| aucune alerte | la pile principale tient jusqu'au bout | poursuivre (≥ 3 pulls), puis audit |

## 7. Ce qui reste ouvert / bloqué

* **Hypothèse `WiFi.macAddress()`** : forte (analyse statique + décodage des octets), **non prouvée** ; les sous-phases la trancheront.
* **PodNet** : sondes de phase jamais exercées sur la carte ; non exonéré par le matériel.
* **Architecture** : aucune retenue (options A–D, FIX3 § 5). Toute option qui ajouterait de la RAM statique, retirerait la garde/le filigrane/l'effacement, ou ferait `free()` pendant que `SP` pointe dans le bloc est exclue.
* **TFT 2,8″ : toujours BLOQUÉ pour tout flash** (pile principale au vote : 964 o, marge 60 o).
* `logfSafeStop()` silencieux : une faute de la pile de journal n'est visible que par l'arrêt total de la carte.
