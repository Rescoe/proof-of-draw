# Lot 8B-2B-2 · DOPULL-JSON-STACK-FIX1 — le décodage de `/api/pull` sur une pile de travail dédiée

| | |
|---|---|
| **Date** | 10/10/2026 |
| **Statut** | **Correctif livré, COMPILÉ (cœurs 1.5.3 et 1.6.0), testé sur l'hôte contre ArduinoJson réel. JAMAIS flashé.** Aucune frame. Le canari sans frame est à refaire (§ 9). |
| **Origine** | canari matériel de `b03c0b4` (`docs/mesures/8B2B2_DOPULL_PHASE_AUDIT_2026_10_09/journal-b03c0b4-phase4-materiel.txt`) et audit `docs/AUDIT_GPT_B03C0B4_DOPULL_PHASE4_2026_10_10.md` |
| **Portée** | le seul sketch **UNO R4 e-ink 2,9″** (code de production, sans interrupteur, comme les correctifs de pile précédents) + `podNetStack.h` (une fonction et une constante ajoutées, copiée dans les cinq dossiers, **inutilisée** par les quatre autres firmwares) + tests, scripts, documentation. **Aucun** serveur, Redis (+0), Neon (0), protocole, vote, ACK, rendu, OTA, polling, ni taille des piles existantes. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

## 1. Ce que le canari de `b03c0b4` établit sur la carte

* Phases `1` (entrée de `doPull`), `2` (après l'appel HTTP) et `3` (après la création du document JSON) : **saines**.
* Phase `4` (après `deserializeJson(doc, resp)`) : **première phase fautive** — le marqueur (ou la longueur peinte) de la pile principale est détruit PENDANT le décodage de la réponse.
* Le réseau n'est pas en cause : sondes de phase de PodNet réellement actives dans ce build, aucune phase signalée, marge 848 o ; Wi-Fi 448–608 o utilisés (marges ≥ 864 o) ; Ed25519 ≥ 708 o ; journal sain ; `register` et `pull` HTTP 200.
* Le premier pull part de `setup` (cadre 224 o, 168 o de plus que `loop`) : 536 o de cadres (`hal_entry` 8 + `arduino_main` 16 + `setup` 224 + `doPull` 288) avant le décodeur ; l'analyse statique (352 o sous `doPull` pour `deserializeJson`, soit 888 o) **sous-estime** le chemin réel (appels indirects non suivis, récursion du décodeur sur les objets imbriqués, interruptions).

## 2. Décision

Décodage **entier** de la réponse sur une pile de travail dédiée, exécuté **après** la fermeture de TLS. Pas de déplacement du premier pull vers `loop` (gain de 168 o qui masquerait le symptôme : la branche « observation » resterait à 72 o de marge statique), pas d'augmentation d'une pile existante, pas de décodage pendant que TLS est vivant, pas de répartition partielle du décodeur entre les deux piles.

## 3. Architecture

```
doPull()                         pile principale (cadre 136 o en production, 264 o avant)
 ├─ httpCall(GET /api/pull)      transaction TLS sur la pile PodNet, FERMÉE (stop) au retour ; resp = String
 ├─ code ∉ {200, 429} → journal + retour false
 └─ doPullStage(resp, code, …)   noinline ; alloue PullParsed AU TAS (new (std::nothrow)) ; échec → rejet
     └─ doPullApply(*r, …)       noinline
         ├─ pullParseOnWorkStack(resp, code, r, ni)      noinline
         │    └─ podWorkRun(wk, &ni)  → PodNet::runSized(…, POD_WORK_STACK_TOTAL = 2048)   ← PILE DE TRAVAIL (tas, garde 64 o, filigrane, effacée avant free)
         │         └─ pullParseWork(resp, code, r)         TOUT le JSON : JSON_DOC, deserializeJson (429 ET réponse),
         │                                                  lectures, conversions JsonVariant → String, pendingObservation, ownedBlock ;
         │                                                  document DÉTRUIT avant le retour ; n'écrit QUE dans r
         ├─ if (!ran) { pullWorkFailed(ni); return 0; }   NOMEM / NESTED / GUARD / MARGIN : ÉCHEC FERMÉ, rien d'appliqué
         ├─ statuts : 429 (seul effet : lastPullMs) · JSON invalide · hors bornes / tas → rejet sans effet
         └─ effets, dans l'ordre d'AVANT : cartel + journal → observation → ownedBlock (mémoire non volatile)
                                           → intervalle → bloc (mémoire non volatile) + journal → candidat
```

Garanties :

| Exigence de l'audit | Réalisation |
|---|---|
| TLS fermé avant le travail | `httpCall` est revenu (`client.stop()` dans la transaction) ; `podWorkRun` n'apparaît que dans `pullParseOnWorkStack`, appelé depuis `doPullApply`, jamais dans une lambda `podNetRun` (test statique) |
| Tout le JSON sur la pile de travail | aucun jeton ArduinoJson (`deserializeJson`, `JSON_DOC`, `JsonObject`, `JsonArray`, `.as<String>()`) dans `doPull`/`doPullStage`/`doPullApply` (test statique + mutants) ; `pullParseWork` contient les deux décodages |
| Structure de résultat bornée | `PullParsed` (§ 4) ; allouée au tas pour ne pas grossir la pile principale |
| Aucun effet avant un retour valide | tous les effets de bord (état global, EEPROM) sont APRÈS `if (!ran)` et les contrôles de statut (test statique + test hôte « tout ou rien ») ; `pullParseWork` ne touche aucun état global (jetons interdits) |
| Échec fermé | NOMEM, NESTED, GUARD, MARGIN, JSON invalide, champ hors bornes, panne d'allocation d'une chaîne : `doPull` retourne `false`, ni frame, ni vote, ni ACK. GUARD : `logfSafeStop()` AVANT tout journal (le tas voisin peut être corrompu) |
| Pas d'imbrication | `runSized` refuse (NESTED) si SP n'est pas sur la pile principale |
| 2 048 o, garde 64, marge ≥ 128 (objectif 256) | `POD_WORK_STACK_TOTAL 2048u`, `static_assert` sur le pire cas ELF (§ 5) |
| Journal canari | `[CANARY] pull JSON : pile de travail dediee utilisee U o, marge M o (objectif >= 256 : OK), erreur E, statut S | tas libre avant X apres Y` ; verrou sur erreur de pile ou statut ∉ {OK, 429} |

## 4. Contrat des bornes (écrit)

| Champ | Borne | Au-delà |
|---|---|---|
| `blockHash`, `candidateId`, `frameId`, `ownedBlock`, `targetBlockHash`, chaque empreinte d'observation | ≤ 64 car. (`PULL_ID_MAX`) | **REFUSÉ** (`PULL_P_BOUNDS`) : pull rejeté, rien appliqué |
| `frameSource` | ≤ 16 car. | REFUSÉ |
| empreintes d'observation | ≤ 8 (`PULL_OBS_MAX`) ; le serveur en envoie ≤ 5 | REFUSÉ |
| `workTitle` | ≤ 255 o (le serveur : 80 car.) | **TRONQUÉ** à une frontière de caractère UTF-8 |
| `drawArtistName` | ≤ 127 o (le serveur : 40 car.) | TRONQUÉ (UTF-8) |
| `displayTs` | ≤ 63 o (≈ 24 car.) | TRONQUÉ (UTF-8) |
| corps entier | ≤ 3 071 o (`g_body[3072]`, refusé par `httpCall` avant le décodeur : « corps incomplet ») | `httpCall` retourne −3 |
| imbrication | 10 (défaut d'ArduinoJson, **inchangé**) | `TooDeep` → pull rejeté |

Les identifiants et empreintes sont refusés (une valeur tronquée serait fausse) ; les textes du cartel sont tronqués (un titre court reste lisible). Aucune troncature implicite ailleurs. Une copie de chaîne dont la longueur n'est pas celle attendue (tas épuisé : `String` n'échoue pas bruyamment) donne `PULL_P_HEAP` → rejet.

## 5. Dimensionnement de la pile de travail

`scripts/pull-work-stack-report.js` (ELF, cœurs 1.5.3 et 1.6.0, `docs/mesures/8B2B2_DOPULL_JSON_STACK_FIX1_2026_10_10/`) :

* cadre de `pullParseWork` 200 o ; pire chaîne **acyclique** 784 o (conversion `JsonVariant → String` : `convertFromJson > serializeJson > … > Writer > String::concat`) ;
* récursion du décodeur (`parseVariant ↔ parseObject`) : cycle de **72 o** par niveau d'imbrication ; limite d'imbrication 10 (défaut) → 784 + 9 × 72 = **1 432 o** au pire cas statique ;
* budget : 2 048 − garde 64 − cadre d'exception 104 − invocateur/trampoline 32 = **1 848 o** → marge au pire cas statique **416 o** (≥ 256 visés). `static_assert(POD_WORK_STACK_TOTAL >= 64 + POD_WORK_DEEPEST_CALL + 32 + 104 + 256)` dans `podNetStack.h`.
* 10 appels indirects atteignables ne sont pas suivis (allocateur, `Print`) : la taille définitive est celle que **le canari** mesure (« utilisée / marge »), pas l'ELF. La réponse réelle du pull a une profondeur d'imbrication de 2 à 3 (racine → `frame` / `cartelMeta` / `chain`).

Chaque pull alloue 2 048 o au tas pendant le décodage (puis efface et libère), plus `PullParsed` (≈ 170 o + chaînes), plus le document ArduinoJson. Le canari relève le tas libre avant et après.

## 6. Mesures ELF avant / après (cœur 1.6.0 ; 1.5.3 identique)

`scripts/dopull-chain-report.js`, chaînes statiques `setup → doPull` et `loop → doPull` sur la pile principale (1 024 o) :

| | avant (`b03c0b4`) | après | 
|---|---|---|
| cadre de `doPull` — production | 264 o | **136 o** |
| cadre de `doPull` — canari | 288 o | **192 o** |
| pire chaîne depuis `setup` — production | **1 096 o (marge −72)** via ArduinoJson | **704 o (marge 320)** |
| pire chaîne depuis `loop` — production | 928 o (marge 96) | **536 o (marge 488)** |
| pire chaîne depuis `setup` — canari | 1 120 o (marge −96) | 800 o (marge 224) |
| ArduinoJson dans les chaînes de la pile principale | oui (584 / 352 o sous `doPull`) | **non** |
| `doPull → doFetchFrame` (cadre de `doPull`) | −0 | **−128 o** (le chemin de l'image gagne 128 o) |

Les 10 appels indirects de `doPull` restent à zéro ; les nouvelles pires chaînes passent par `doPullStage > doPullApply > asciiFold` (production) ou le contrôle du canari. La marge principale à `doRegister` (144 o, étroite) n'est **pas** modifiée par ce lot.

## 7. Production : ce qui change et ce qui ne change pas

* **Change** : `doPull` (et son décodage) dans le seul sketch e-ink 2,9″ — **sans interrupteur** : c'est la correction d'un défaut préexistant du firmware stable, au même titre que PodEd, PodNet et les enveloppes Wi-Fi. Le chemin désactivé (`POD_RENDER_V1 = 0`) bénéficie donc aussi du correctif.
* **Table d'annulation exacte** (`tests/helpers/netStackEdits.json`, entrée `dopullJsonStack`) : en annulant les modifications, on retrouve **au texte près** le sketch de `b03c0b4` (sauvegarde `firmware-backups/2026-10-10_avant-dopull-json-stack-fix1/`).
* **Désassemblage** (`scripts/disasm-compare.js --pool`, `docs/mesures/8B2B2_DOPULL_JSON_STACK_FIX1_2026_10_10/production-comparaison-*.txt`, cœurs 1.5.3 et 1.6.0 identiques) : OFF 976 des 1 015 fonctions identiques (38 « différentes »), ON 985 des 1 026 (40). Les autres sont `doPull` (voulu), des instances de modèles ArduinoJson (le lecteur travaille désormais aussi sur `const String&`), des tables de données décodées comme du code (vtables, descripteurs USB, `__Vectors`, table de police), et des artefacts de disposition : chaîne du chemin de build (`arduino_main`), remplissage de fin de fonction (`operator delete[]`, `__ascii_mbtowc`, `analogReference`), tables de constantes dont les premiers octets contiennent des adresses (`tud_task_ext`, `R_SCI_UART_BaudCalculate`) ou référencées à l'alignement près (`SHA512::processChunk`). **Aucune autre fonction du firmware n'a changé d'instruction** — les « différences » restantes sont des mots de littéral dont l'adresse a bougé sans que leur cible change de sens.
* **Tailles** (cœur 1.6.0) : OFF 121 804 → 124 396 o (+2 592) ; ON 124 844 → 127 436 o (+2 592) ; canari 131 884 → 135 020 o ; RAM statique **inchangée** (22 768 o ; canari 22 784 o), marge 512–528 o.
* **Quatre autres firmwares R4** (`eink27`, `eink27_oled`, `tft18`, TFT 2,8″) : `.ino` inchangés au caractère près ; seul l'en-tête `podNetStack.h` (copie) gagne un modèle de fonction et une constante **non instanciés** : binaires comparés (§ 8) — **octet pour octet identiques** à ceux de `b03c0b4` hors la chaîne du chemin de build. Le correctif n'y est **pas propagé** (ordre fixé par l'audit : validation matérielle d'abord).

## 8. Tests

| Test | Contenu |
|---|---|
| `tests/dopullJsonStack.test.ts` (5) | **statique** : rien de JSON hors de la pile de travail, aucun effet de bord avant un retour valide, ordre des effets, `GUARD → arrêt sûr avant journal`, structure au tas, bornes — 15 mutants refusés ; **autres firmwares** inchangés, en-tête et copies ; **canari** ; **hôte** (ci-dessous) + 12 mutants du harnais |
| `consensus-pod/host/pull_work_harness.cpp` | le **code réel** extrait du sketch contre **ArduinoJson 7.4.3 réel** : 691 vérifications — réponses minimale / `retryAfter` / complète / `frame{}` / 429 (valide, illisible, 0) / tronquée / imbriquée à 12 / 3 Ko / bornes (65 car., 17 car., 8 et 9 empreintes) / UTF-8 / NOMEM / NESTED / GUARD / MARGIN / **panne d'allocation à chacun des 22 points du décodage : résultat complet et exact, ou AUCUN effet** |
| `tests/doPullPhases.test.ts` | neuf sondes silencieuses réajustées (3 → 7 dans `doPullApply`, 1, 2, 8, 9 dans `doPull`), permutations et suppressions refusées |
| `tests/netStack.test.ts`, `canaryPrep.test.ts` | exceptions explicites (`pullWorkFailed` vérifié par le nouveau test ; fonctions de canari non `void` marquées `noinline`) |

**Suite complète** : **716/716 depuis un clone propre** du commit ; dans l'arbre du porteur, 714/716 avec `POD_RENDER_V1`/`POD_CANARY` remis à 0 (les 2 échecs viennent de ses copies Arduino non suivies, `consensus-pod/examples/Ed25519StackProbeUnoR4/podRender*.h`, comme avant), et 709/716 avec ses `1`/`1` locaux (cinq tests de « défauts à 0 » le signalent, par conception). `tsc` et ESLint propres sur les fichiers du lot.

**Compilation** (cœurs 1.5.3 ET 1.6.0, `--warnings all`, aucun avertissement du sketch ni de `podNetStack.h`) : e-ink 2,9″ OFF / ON / canari (`-D`) et **forme IDE sans `-D` avec les `1`/`1` du fichier local : 135 004 o, RAM statique 22 784 o** (sondes présentes dans l'ELF) ; les quatre autres firmwares : § 7.

## 9. Canari à refaire (sans frame)

Même fichier local `1`/`1`. **Aucun dessin. Une seule carte, un seul canari.** À lire dans le journal :

1. au boot : Wi-Fi, Ed25519, `register` 200 comme avant (PodNet 1 136 / 848) ;
2. **à chaque pull** : `[CANARY] pull JSON : pile de travail dediee utilisee U o, marge M o (objectif >= 256 : OK), erreur 0, statut 1` (`statut 2` pour un 429), et `tas libre avant … apres …` stable ;
3. `P: apres l'analyse du pull (silencieux)` muet ; `7b apres doPull` : marge principale ≥ 128 o, **marqueur intact** ; aucune ligne `[CANARY] doPull : PREMIERE phase fautive` ;
4. trois pulls espacés (≥ 3 lignes `pull JSON`), A/B/C stables ;
5. s'arrêter au **premier verrou** et copier tout le journal. Ne **pas** envoyer de frame avant ce canari complet.

Ensuite seulement (ordre fixé par l'audit) : une frame personnelle unique, rendu / hashes / BUSY / ACK, puis propagation aux autres firmwares (le TFT 2,8″ reste BLOQUÉ : marge de vote 60 o).

## 10. Limites, dites sans détour

* **Jamais exécuté sur une carte.** L'hôte prouve la logique (tout ou rien, bornes, ordre, échec fermé, pannes d'allocation), pas le déplacement réel de SP ni la profondeur réelle du décodeur sur la carte.
* Le dimensionnement ELF ne suit pas 10 appels indirects ; 2 048 o laissent 416 o au pire cas statique, ce que le canari doit confirmer (« utilisée / marge »).
* La marge principale à `doRegister` (144 o) reste étroite et n'est pas traitée ici.
* Le pic de tas pendant le décodage augmente de ≈ 2 Ko (pile de travail) ; le canari le relève, aucune valeur matérielle n'existe encore.
* Les cartes déjà déployées (firmware stable) gardent le défaut tant que le correctif n'est pas flashé ; les quatre autres firmwares R4 aussi tant qu'il n'est pas propagé.
