# Lot 8B-2B-2 · DOVALIDATE-JSON-STACK-FIX1 — la réponse de `/api/validate-candidate` sur la pile de travail dédiée

| | |
|---|---|
| **Date** | 10/10/2026 |
| **Statut** | **Correctif livré, COMPILÉ (cœurs 1.5.3 et 1.6.0), testé sur l'hôte contre ArduinoJson réel. JAMAIS flashé.** Aucune frame, aucun vote. Dernier parseur ArduinoJson de la voie vote du e-ink 2,9″ déplacé. |
| **Origine** | canari matériel de `231393d` (register + trois pulls, `docs/AUDIT_GPT_231393D_CANARI_3_PULLS_2026_10_10.md`, `docs/mesures/8B2B2_REGISTER_JSON_STACK_FIX1_2026_10_10/journal-231393d-trois-pulls-materiel.txt`) : **register JSON et pull JSON validés sur la carte**, trois pulls sans verrou, tas stable ; GPT impose la migration de `doValidate` avant tout dessin. |
| **Portée** | le seul sketch **UNO R4 e-ink 2,9″** + deux constantes dans `podNetStack.h` (§ 4) + tests, scripts, documentation. Les quatre autres firmwares : `.ino` inchangés au caractère près. **Aucun** serveur, Redis (+0), Neon (0), protocole, vote, ACK, rendu, OTA, polling, taille de pile. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

## 1. Pourquoi `doValidate`
`doValidate` exécutait sur la pile principale `JsonDocument` (768), `deserializeJson` et les lectures de la réponse du serveur, puis, en v2, la lecture du candidat (PodNet), la signature (PodEd) et le vote. Son cadre faisait **520 o** avant les chaînes ArduinoJson ; l'analyse statique donnait 904 o pour la chaîne ArduinoJson (marge 120 o) et 984 o pour une autre chaîne (marge 40 o), sous le minimum de 128 o. Il n'est atteint que si un candidat est annoncé à l'appareil (`pendingValidation` dans la réponse du pull) — c'est-à-dire dès qu'un dessin est soumis au réseau.

## 2. Architecture

```
doValidate()                          pile principale (cadre 520 -> 424 o)
 ├─ { httpCall(GET /api/validate-candidate)     transaction TLS sur la pile PodNet, FERMÉE (stop) au retour ; resp = String
 │    └─ doValidateDecode(resp, sorties…)       noinline ; ValidateParsed (≈ 170 o) AU TAS (new nothrow ; échec = rejet)
 │         ├─ validateParseOnWorkStack → podWorkRun → PodNet::runSized(… 2048 o …)   ← PILE DE TRAVAIL (la même que pull et register ; jamais imbriquée)
 │         │      └─ validateParseWork   JsonDocument (768), deserializeJson (limite d'imbrication 8), const char*, validation, copie bornée ; n'écrit QUE dans r
 │         ├─ canari : [CANARY] validate JSON …  puis  V: (contrôle silencieux de la pile principale, APRÈS le retour du rapport)
 │         └─ sorties (identifiant, écran, hash, taille, score) écrites SEULEMENT dans les deux branches valides ; retour 0 / 1 (v2) / 2 (v1)
 │   }                                          resp libérée ICI (avant la lecture du candidat, la signature et le vote)
 ├─ mode 0 → pendingCandidateId = "" ; retour false (aucun vote)
 ├─ mode 1 (v2) → pendingCandidateId = "" ; doValidateV2(…)  [lecture du candidat PodNet → signature PodEd → POST /api/validation-result]
 └─ mode 2 (v1) → signature PodEd, POST /api/validation-result            (inchangés)
```

| Exigence de l'audit | Réalisation |
|---|---|
| Transaction fermée avant le parseur | `httpCall` est revenu ; `podWorkRun` n'apparaît que dans `validateParseOnWorkStack` (exactement 3 appels dans le fichier : pull, register, validate), jamais dans une lambda `podNetRun` ; NESTED refuse un appel depuis une pile dédiée (PodNet, PodEd, journal, Wi-Fi) |
| `JsonDocument`, `deserializeJson`, lectures, conversions sur la pile de travail | plus aucun jeton ArduinoJson dans `doValidate`/`doValidateDecode` (test statique + mutant) ; aucune `String` dans `validateParseWork` |
| Sortie bornée hors pile principale | `ValidateParsed` : tampons `char[65]`, `char[17]`, `char[65]`, au tas |
| Rien avant résultat complet | aucune signature, métrique, requête GET du candidat ni POST avant le retour valide ; les paramètres de sortie ne sont écrits que dans les branches valides (test statique + test hôte « tout ou rien ») |
| Échec fermé | NOMEM, NESTED, GUARD, MARGIN, JSON invalide, valeur invalide, allocation impossible → mode 0, **aucun vote** ; GUARD : arrêt sûr AVANT tout journal |
| Chemins v1, v2, déjà voté, candidat absent, réponse malformée | tous couverts par le harnais hôte (§ 5) |
| Ligne canari | `[CANARY] validate JSON : pile de travail dediee utilisee U o, marge M o (objectif >= 256 : OK), erreur E, statut S | tas libre avant X apres Y` ; verrou sur erreur de pile ou statut ≠ OK |

**`pendingCandidateId` — précision.** Il n'est **jamais** modifié avant le retour du décodeur. Après lui, tout résultat sans vote (déjà voté, pas de candidat, réponse refusée, échec de pile) l'efface, **comme avant ce lot** : sinon la boucle (`VALIDATE_INTERVAL` 30 s) interrogerait indéfiniment le serveur (limite 4 requêtes/min) pour un candidat que le firmware refuse de voter. Le serveur ré-annonce le candidat au pull suivant s'il est toujours valable.

## 3. Contrat des valeurs (refus, jamais de troncature)
| Champ | Contrat | Sinon |
|---|---|---|
| `candidateId` | 8 à 64 caractères `[0-9A-Za-z-]` (le serveur : `crypto.randomUUID()`) | **refusé** ; vide, absent ou de type non chaîne : « rien à voter », silencieux (comme avant) |
| `v2.screen` | 1 à 16 caractères `[a-z0-9_]` | refusé |
| `v2.hash` | **exactement 64** caractères hexadécimaux (SHA-256) | refusé |
| `v2.bytes` | entier de 1 à 262 144 | refusé |
| `score_server` (v1) | absent = 0,5 (comme avant) | — |
| `alreadyVoted` vrai, `candidate` nul | rien à voter, silencieux | — |

Un identifiant n'entre jamais dans une URL (`/api/candidate-frame?candidateId=…`) ni dans le corps JSON du vote sans avoir été validé (guillemet, espace, `&` refusés — testé). Cas limite assumé : un hash annoncé de mauvaise forme donnait avant un vote « reject » (différence de hash) ; il donne maintenant **aucun vote** (fail-closed).

## 4. Limite d'imbrication explicite (effet sur les TROIS décodeurs)
La mesure ELF de ce lot a montré que l'instance du décodeur partagée par les trois travaux coûte désormais **112 o par niveau d'imbrication** (cycle `parseVariant` / `parseObject` / `parseArray`, au lieu de 72 o) : à la limite par défaut d'ArduinoJson (10), le pull atteint **1 760 o** statiques pour 1 848 o de budget (marge 88 o < 128). Le défaut n'est pas atteignable par une réponse réelle (profondeur 2 à 4), mais un serveur hostile ou défaillant pouvait le provoquer. Correctif :

* `POD_WORK_JSON_NESTING = 8` dans `podNetStack.h` ; chaque `deserializeJson` des trois travaux porte `DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING)` ; une réponse plus profonde est **refusée** (`TooDeep`), rien n'est appliqué.
* `POD_WORK_DEEPEST_CALL` passe de 1 432 à **1 536 o** (pull : 752 + 7 × 112) ; le `static_assert` de la pile de 2 048 o tient (64 + 1 536 + 32 + 104 + 256 = 1 992). Marge au pire cas : pull **312 o**, register 592 o, validate 512 o. (Borne exacte = cycle simple le plus lourd ; la « borne haute » du rapport, somme de tous les cadres de la composante, n'est pas atteignable.)
* Testé : 1 à 8 niveaux acceptés, 9 et 10 refusés sans effet (harnais du pull).
* `podNetStack.h` n'est changé que par ces deux constantes (copies synchronisées dans les cinq dossiers) ; les quatre autres firmwares ne les utilisent pas.

## 5. Tests
| Test | Contenu |
|---|---|
| `tests/validateJsonStack.test.ts` | **statique** : aucun jeton ArduinoJson hors du travail, code de la pile de travail sans état global ni journal, trois `podWorkRun` exactement, ordre `httpCall` → décodage → resp libérée → mode 0 → v2 → signature v1 → vote, sorties seulement dans les branches valides, GUARD → arrêt avant journal, contrat des valeurs — **14 mutants refusés** ; autres firmwares inchangés ; **canari** ; **hôte** + **13 mutants du harnais** |
| `consensus-pod/host/validate_work_harness.cpp` | le **code réel** extrait du sketch contre **ArduinoJson 7.4.3 réel** (70 vérifications) : v2 (UUID, écrans, hash minuscules/majuscules, 153 600 o), v1 (score, défaut 0,5), déjà voté / candidat absent ou nul / identifiant vide, absent ou numérique (silencieux), 19 refus (identifiant court, 65 car., guillemet, espace, `&` ; écran vide, 17 car., majuscules, `-` ; hash 63/65/non hexadécimal/vide ; taille 0, négative, 262 145, absente, chaîne ; `v2` vide), JSON tronqué à 4 longueurs, HTML, corps vide, NOMEM, NESTED, GUARD (zéro journal), MARGIN, allocation impossible, réponse réelle du serveur — tout ou rien |
| `tests/dopullJsonStack.test.ts`, `registerJsonStack.test.ts` | trois `podWorkRun` ; `NestingLimit` sur chaque appel ; constantes de l'en-tête ; inventaire formel mis à jour |
| `pull_work_harness.cpp` | +12 vérifications de la limite d'imbrication (703 au total) |

## 6. Mesures ELF (cœurs 1.5.3 et 1.6.0)
`scripts/dopull-chain-report.js <dis> doValidate` (section « loop » seule : `doValidate` n'est appelé que par la boucle ; le libellé « doPull » du rapport désigne la racine analysée) :

| | avant (`81fb2e2`) | après |
|---|---|---|
| cadre de `doValidate` | 520 o | **424 o** |
| chaîne ArduinoJson sur la pile principale | 904 o (marge 120) | **absente** |
| chemin nominal v2 (`httpCall`, lecture du candidat, `podVoteMessage`) | — | 680 – 720 o (marge **304 – 344**) |
| chaîne v1 (`snprintf`, ancien serveur uniquement) | 984 o (marge 40) | 888 o (marge 136) |
| pire chaîne statique | 1 176 o (marge −152) via la ré-inscription | **1 080 o (marge −56)** via la ré-inscription |

* La pire chaîne restante est la **ré-inscription** déclenchée par une signature refusée (`doRegister` → dessin du QR d'appairage, 400 o dessous). Le QR n'est dessiné que si l'appareil n'est pas appairé **et** que l'écran d'appairage n'a pas déjà été dessiné depuis le démarrage (`!paired && !onboardingDrawn`) : chemin inatteignable pour une carte appairée ou déjà passée par l'inscription, mais l'analyse statique ne le sait pas. Non modifié ici.
* L'analyse statique sous-estime d'environ 90 o (canari `231393d` : 892 mesurés pour ≈ 800) : la marge nominale v2 est donc de l'ordre de 200 o, à mesurer avec un vrai vote.
* Tailles (1.5.3 = 1.6.0) : OFF 125 060 → 124 612 o, canari 136 188 → 136 220 o, forme IDE `1`/`1` 136 212 o ; RAM statique **inchangée** (22 768 o ; canari 22 784 o) ; aucun avertissement du sketch.
* Pile de travail de `validateParseWork` : cadre 200 o, chaîne acyclique 552 o ; pire cas (limite 8) 1 336 o sur 1 848 → marge **512 o**.

## 7. Inventaire formel (`scripts/json-inventory.js`, figé par test)
21 `deserializeJson` dans les cinq firmwares R4 : **4 sur la pile de travail** (e-ink 2,9″ : `pullParseWork` ×2, `registerParseWork`, `validateParseWork`), **17 sur la pile principale** (`doRegister`, `doPull` ×2, `doValidate` des quatre autres firmwares, plus `benchPollOnce` du TFT 2,8″ — bloqué). **Plus aucun parseur de la voie vote du e-ink 2,9″ sur la pile principale.** La propagation aux autres firmwares viendra après validation matérielle complète (frame, rendu, ACK).

## 8. Limites, dites sans détour
* **Jamais exécuté sur une carte** : ni `validate JSON` ni un vote. La ligne `validate JSON` n'apparaît **que lorsqu'un candidat est annoncé** : le prochain canari sans dessin ne l'exercera pas (il confirmera seulement que `register JSON` et `pull JSON` restent sains avec ce binaire).
* La marge principale à `7b` était de 132 o au canari précédent (4 o au-dessus du minimum) ; ce lot ne l'améliore pas (le cadre de `doPull` n'est pas touché). Option non faite : premier pull depuis `loop` (+168 o).
* Une frame **personnelle** (`send-to-screen`) ne crée pas de candidat : elle n'exerce pas `doValidate`. Un dessin soumis au réseau (`/api/draw`) en crée un : à ne faire qu'après un canari de la voie vote.
* Le correctif est inconditionnel sur le seul e-ink 2,9″ (pas d'interrupteur).

## 9. Suite (ordre fixé par l'audit)
Audit GPT → flash du nouveau canari (même fichier local `1`/`1`) → démarrage de contrôle (lire `register JSON`, `pull JSON`, marge principale ≥ 128 o) → UNE frame personnelle (rendu, `frameHash`, `renderHash`, BUSY, ACK) → canari de la voie vote avec un candidat → propagation aux autres firmwares.
