# Lot 8B-2B-2 · REGISTER-JSON-STACK-FIX1 — la réponse de `/api/register` sur la pile de travail dédiée

| | |
|---|---|
| **Date** | 10/10/2026 |
| **Statut** | **Correctif livré, COMPILÉ (cœurs 1.5.3 et 1.6.0), testé sur l'hôte contre ArduinoJson réel. JAMAIS flashé.** Aucune frame. Canari sans dessin à refaire UNE fois (§ 8). |
| **Origine** | canari matériel de `c19efb8` (`docs/mesures/8B2B2_DOPULL_JSON_STACK_FIX1_2026_10_10/journal-c19efb8-register-margin-materiel.txt`) et audit `docs/AUDIT_GPT_C19EFB8_REGISTER_MARGIN_2026_10_10.md` |
| **Portée** | le seul sketch **UNO R4 e-ink 2,9″** (correctif de production inconditionnel, comme le lot précédent) + tests, scripts, documentation. `podNetStack.h` **n'est pas modifié** : les copies des cinq dossiers et les quatre autres firmwares sont identiques à `c19efb8`. **Aucun** serveur, Redis (+0), Neon (0), protocole, vote, ACK, rendu, OTA, polling, taille de pile. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

> **Résultat du canari de ce lot (partiel)** : `register JSON` 448 o / marge 1 536, `pull JSON` 724 o / marge 1 260, `6b` 784 o (marge 240), `7b` 892 o (marge 132, marqueur intact), aucune alerte — voir `docs/RESULTAT_CANARI_231393D_PARTIEL_2026_10_10.md`.

## 1. Ce que le canari de `c19efb8` établit sur la carte

* Tous les contrôles précédents passent : `6a` 440 o de marge, R0/R1/R2 muets, Wi-Fi 448–608 o utilisés (marges ≥ 864 o), Ed25519 ≥ 708 o, PodNet 1 148 / **836** o, `POST /api/register` 200, journal 416 o. Le `podWorkRun` du pull n'est **pas** atteint : le premier pull n'a jamais démarré.
* `6b apres doRegister` : **948 / 1 024 o utilisés, marge 76 o** (< 128 exigés). Marqueur `CNRY` et longueur peinte (`0x250`) **exacts** : ce n'est pas une corruption mais un arrêt **préventif**, correct.
* La zone fautive est **après** le dernier contrôle de `httpCall` et **avant** le retour de `doRegister` : `JsonDocument`, `deserializeJson`, `deviceId.as<String>()`, `pairCode.as<String>()` — le même parseur ArduinoJson, historique, que celui du pull. La marge de `doRegister` est passée de 144 o (canari précédent) à 76 o d'un démarrage à l'autre sans changement de ce chemin : 144 o n'était pas une réserve robuste.
* Observation (non traitée) : `[WIFI] IP: 0.0.0.0` sur ce démarrage (192.168.1.21 sur le précédent) alors que `register` répond 200 : l'IP est lue juste après `WiFi.begin`, avant la fin du DHCP ; sans effet sur le protocole.

## 2. Architecture

```
doRegister()                       pile principale (cadre 240 o avant -> 176 o en production)
 ├─ httpCall(POST /api/register)   transaction TLS sur la pile PodNet, FERMÉE (stop) au retour ; resp = String
 ├─ doRegisterDecode(resp)         noinline ; RegisterParsed (28 o) allouée AU TAS (new nothrow ; échec = rejet)
 │    ├─ registerParseOnWorkStack  → podWorkRun → PodNet::runSized(… 2048 o …)     ← PILE DE TRAVAIL (la même que le pull ; jamais imbriquée)
 │    │      └─ registerParseWork  JsonDocument (768), deserializeJson, lectures const char*, validation, copie bornée ; n'écrit QUE dans r
 │    ├─ canari : [CANARY] register JSON …  puis  Q: (contrôle silencieux de la pile principale, APRÈS le retour du rapport)
 │    ├─ !ran → registerWorkFailed (GUARD : logfSafeStop() AVANT tout journal) · JSON invalide · valeur refusée → rien d'inscrit
 │    └─ SEULE branche valide : deviceId, pairCode, paired, registered = true
 └─ journal "[REGISTER] deviceId=…", puis (non appairé) le QR d'appairage, comme avant
```

| Exigence de l'audit | Réalisation |
|---|---|
| Après fermeture complète de TLS, jamais imbriqué avec PodNet | `httpCall` est revenu ; `podWorkRun` n'apparaît que dans `registerParseOnWorkStack` (et `pullParseOnWorkStack`), jamais dans une lambda `podNetRun` ; NESTED refuse un appel depuis une pile dédiée |
| `JsonDocument`, `deserializeJson` et conversions sur la pile de travail | plus aucun jeton ArduinoJson dans `doRegister`/`doRegisterDecode` (test statique + mutant) ; les valeurs sont lues en `const char*` puis validées : plus de `.as<String>()` |
| Structure bornée hors pile principale | `RegisterParsed` : 28 o, au tas |
| Refuser sans troncature | `deviceId` = `dev_` + 8 car. `[A-Z0-9]` exactement (contrat serveur : `lib/deviceStore.ts`, `lib/podProtocolV3.ts`) ; `pairCode` = 8 car. de l'alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, obligatoire si non appairé, facultatif sinon ; toute autre valeur (absente, courte, longue, hors alphabet, mauvais type) est **refusée**, jamais coupée. `paired` absent ou non booléen → `false` (comme avant) |
| Rien avant résultat complet | `deviceId`, `pairCode`, `paired`, `registered` ne sont écrits que dans la branche finale valide (test statique : chaque affectation exactement une fois, après l'échec de pile, le JSON et le statut) |
| Échec fermé | NOMEM, NESTED, GUARD, MARGIN, JSON invalide, valeur refusée, allocation de la structure impossible : `doRegister` retourne `false` (« nouvel essai dans 5 s » comme pour toute inscription échouée) |
| Canari | `[CANARY] register JSON : pile de travail dediee utilisee U o, marge M o (objectif >= 256 : OK), erreur E, statut S | tas libre avant X apres Y` ; verrou sur erreur de pile ou statut ≠ OK ; contrôle `Q:` après le retour du rapport |

## 3. Mesures ELF (identiques sur les deux cœurs)

`scripts/dopull-chain-report.js <dis> doRegister`, pire chaîne statique sur la pile principale (1 024 o) :

| | avant (`c19efb8`) | après |
|---|---|---|
| cadre de `doRegister` — production / canari | 240 / 240 o | **176 / 176 o** |
| pire chaîne depuis `setup` — production | **1 096 o (marge −72) via ArduinoJson** | **824 o (marge 200)** via l'affichage du QR (voie non appairée) |
| pire chaîne depuis `loop` — production | 928 o (marge 96) | **656 o (marge 368)** |
| ArduinoJson dans les chaînes de la pile principale | oui | **non** |

* Cohérent avec la mesure matérielle (948 o utilisés) : l'analyse statique donnait déjà −72 o depuis `setup`.
* La nouvelle pire chaîne est le dessin du QR d'appairage (`displayOnboardingQR`, 400 o sous `doRegister`), exécuté seulement si l'appareil **n'est pas appairé** : marge statique 200 o (> 128, < 256). Votre carte est appairée (`paired=oui`) ; ce chemin n'est pas modifié ici.
* Pile de travail : `registerParseWork` cadre 120 o, pire cas statique **1 072 o** (limite d'imbrication 10) sur 1 848 o disponibles → marge **776 o** ; le pull reste à 1 400 o (marge 448 o ; `POD_WORK_DEEPEST_CALL = 1432` toujours valide). Les 10 appels indirects ne sont pas suivis : la taille définitive est celle du canari.
* Tailles (1.5.3 = 1.6.0) : OFF 124 364 → 125 092 o ; ON → 128 140 o ; canari 134 988 → 136 220 o ; forme IDE `1`/`1` : 136 212 o ; RAM statique **inchangée** (22 768 o ; canari 22 784 o). Aucun avertissement du sketch.

## 4. Tests

| Test | Contenu |
|---|---|
| `tests/registerJsonStack.test.ts` | **statique** : rien de JSON dans `doRegister`/`doRegisterDecode`, code de la pile de travail sans état global ni journal, deux `podWorkRun` exactement, ordre `httpCall` → décodage → journal, inscription dans la seule branche valide, GUARD → arrêt avant journal, contrat des valeurs — **13 mutants refusés** ; **canari** (ligne, règle A/B/C, aides de tas définies une fois) ; **hôte** + **12 mutants du harnais** ; **inventaire formel** |
| `consensus-pod/host/register_work_harness.cpp` | le **code réel** extrait du sketch contre **ArduinoJson 7.4.3 réel** (109 vérifications) : appairé / non appairé / `paired` absent ou mal typé / `pairCode` absent (appairé accepté, non appairé refusé) / `deviceId` absent, court, long (13 et 300), minuscules, sans préfixe, caractère interdit, nombre, `null` / `pairCode` court, long, hors alphabet (O, 0, minuscule, I, 1, l), invalide même si appairé / objet vide, tableau, corps vide / JSON tronqué à 4 longueurs / HTML / NOMEM, NESTED, GUARD (arrêt sûr, **zéro journal**), MARGIN / allocation de la structure impossible / les 32 caractères de l'alphabet / réponse réelle du serveur — tout ou rien |
| `tests/dopullJsonStack.test.ts` | `podWorkRun` : exactement deux appels (pull et register) |

## 5. Ce que l'hôte ne prouve pas

* Le déplacement réel de SP et la profondeur du décodeur sur la carte (canari).
* La panne d'allocation **interne** d'ArduinoJson : elle passe par `malloc`, que le harnais ne détourne pas ; elle produit `NoMemory` (JSON invalide → rejet). Les pannes simulées sont celles de la structure (`new`) et de la pile (`malloc` de `PodNet::runSized`).

## 6. Inventaire formel des `deserializeJson` (cinq firmwares R4)

> **Mis à jour par `DOVALIDATE-JSON-STACK-FIX1`** (`docs/LOT_8B2B2_DOVALIDATE_JSON_STACK_FIX1_2026_10_10.md` § 7) : `doValidate` du e-ink 2,9″ est migré ; il reste 4 sites sur la pile de travail et 17 sur la pile principale (autres firmwares). Le tableau ci-dessous est celui de CE lot (avant la migration).

`scripts/json-inventory.js` → `docs/mesures/8B2B2_REGISTER_JSON_STACK_FIX1_2026_10_10/inventaire-deserializejson.md` ; figé par un test (tout ajout, déplacement ou migration non classé échoue).

| firmware | pile de travail | pile principale (À MIGRER) |
|---|---|---|
| **e-ink 2,9″** | `pullParseWork` ×2, `registerParseWork` | **`doValidate` (768)** |
| e-ink 2,7″, e-ink 2,7″ + OLED, TFT 1,8″ | — | `doRegister`, `doPull` ×2, `doValidate` |
| TFT 2,8″ (`pod_uno_r4`) | — | `doRegister`, `doPull` ×2, `doValidate`, `benchPollOnce` — firmware **bloqué** pour tout flash |

Total : 21 sites ; 3 sur la pile de travail, **18 sur la pile principale**.

**`doValidate` (e-ink 2,9″) est le dernier parseur de la voie vote.** Mesure statique (`dovalidate-chain-production-*.txt`, ligne « loop ») : cadre de `doValidate` **520 o**, plus 400–576 o dessous ; sans la voie de ré-inscription, la chaîne `sniprintf` laisse 40 o et la chaîne ArduinoJson 120 o — **sous le minimum de 128 o**. Il doit être migré (même modèle : `ValidateParsed` bornée, `podWorkRun`, tout ou rien) **avant le premier vote réel**. Il n'est pas touché ici (consigne), et il n'est atteint que si un candidat est en attente pour l'appareil (`pendingValidation` dans la réponse du pull) : voir la réserve du § 8.

## 7. Limites, dites sans détour

* **Jamais exécuté sur une carte.** Le pull non plus (`c19efb8` ne l'a jamais atteint) : les deux nouvelles piles de travail restent à mesurer.
* Le correctif est **inconditionnel** sur le seul e-ink 2,9″ (pas d'interrupteur) ; les quatre autres firmwares ne sont pas modifiés.
* La voie « non appairé » (QR) garde 200 o de marge statique ; la voie « appairé » (votre carte) est plus courte.
* La marge à `doRegister` avant correction variait de 144 à 76 o selon les démarrages : seule une mesure répétée (trois démarrages) dira la marge réelle après correctif.

## 8. Canari à refaire — UNE fois, sans dessin

Même fichier local `1`/`1`. À lire, dans cet ordre :

1. `[CANARY] register JSON : … erreur 0, statut 1` (marge ≥ 128, 256 visés) ; `6b apres doRegister` **sans alerte**, marge principale ≥ 128 o ;
2. `[CANARY] pull JSON : … erreur 0, statut 1` (ou 2) à chaque pull ; `7b` sans alerte ;
3. au moins trois pulls sans verrou, A/B/C stables, tas libre stable ; aucune ligne « PREMIERE phase fautive ». **Cadence réelle : au repos le pull suivant arrive après 5 min (réseau chaud) ou 15 min (sinon), pas 60 s** (`lib/pullBudget.ts`) ; un reset donne un pull immédiat ;
4. s'arrêter au premier verrou et copier TOUT le journal.

**Réserve** : `doValidate` reste sur la pile principale (§ 6) ; si la réponse d'un pull annonce un `pendingValidation`, la boucle principale lancera une validation (et un vote réel) sans instrument. Si le journal montre `pendingValidation`/un candidat avant les trois pulls, débrancher plutôt que de laisser voter. Ensuite seulement, et dans cet ordre : migration de `doValidate`, une frame personnelle unique, propagation aux autres firmwares.
