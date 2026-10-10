# Résultat matériel PARTIEL — canari `231393d` (REGISTER-JSON-STACK-FIX1)

| | |
|---|---|
| **Date** | 10/10/2026 |
| **Matériel** | UNO R4 WiFi + e-ink 2,9″ BWR, build local `POD_RENDER_V1=1`, `POD_CANARY=1`, aucun dessin |
| **Journal** | `docs/mesures/8B2B2_REGISTER_JSON_STACK_FIX1_2026_10_10/journal-231393d-materiel.txt` (partiel : jusqu'à « 8 pret ») |
| **Verdict** | **Première validation matérielle des deux décodeurs JSON — réussie. Canari PAS terminé** (un seul pull observé, marge principale à 132 o) |

## 1. Ce que la carte a prouvé

| Point | `c19efb8` (avant) | `231393d` (mesuré) |
|---|---|---|
| `6b apres doRegister` | 948 / 1 024 o, marge **76** (arrêt préventif) | **784 / 1 024 o, marge 240** |
| `register JSON` (pile de travail 2 048 o) | jamais atteint | **448 o utilisés, marge 1 536**, erreur 0, statut 1, tas 6 476 → 6 476 |
| `pull JSON` | jamais atteint | **724 o utilisés, marge 1 260**, erreur 0, statut 1, tas 6 112 → 6 008 |
| `7b apres doPull` (marqueur) | (b03c0b4 : **détruit**, 1 016 / 1 024) | **892 / 1 024 o, marge 132, marqueur INTACT**, aucune alerte |
| PodNet | 1 148 / 836 | 1 140 / 844 (inscription), 1 136 / 848 (pull) |
| Wi-Fi, Ed25519, journal | sains | sains (marges ≥ 864 / ≥ 708 / 1 056) |
| Phase fautive de `doPull` | 4 (pendant `deserializeJson`) | **aucune** |

Le débordement réel de la pile principale (marqueur détruit pendant `deserializeJson`) a disparu : les deux décodeurs tiennent à 724 o et 448 o sur une pile de travail qui offre 1 984 o. C'est la cause racine confirmée par l'effet du correctif, pas seulement par l'analyse.

## 2. Ce qui n'est PAS encore acquis
1. **Un seul pull observé.** Les critères « trois pulls sans verrou, tas stable » ne sont pas vérifiables.
2. **Marge principale à `7b` : 132 o**, soit **4 o au-dessus du minimum de 128** (objectif 256). Pas de verrou, mais aucune réserve. L'analyse statique prévoyait ≈ 800 o pour le canari (892 mesurés, +90 o : interruptions, appels indirects). Elle a augmenté de 108 o entre `7a` (784) et `7b` (892) pendant `doPull`. Le premier pull part de `setup` (cadre 224 o) ; les suivants partent de `loop` (56 o) : **168 o de plus** attendus aux pulls suivants — à confirmer par la mesure.
3. **Tas** : 6 112 → 6 008 o autour du décodage du pull (−104 o : `PullParsed` et ses chaînes encore vivantes au moment du rapport). À confirmer stable au 2e et 3e pull.
4. Aucune frame, aucun vote : `doValidate` reste sur la pile principale (à migrer avant le premier vote réel).

## 3. Correction d'un protocole erroné (la nôtre)
Le protocole du canari annonçait « trois pulls en ~5 minutes » et le journal écrit « pull toutes les 60 s ». **C'est faux au repos** : sans frame ni candidat, la carte applique le `retryAfter` du serveur (`lib/pullBudget.ts` : **5 min si le réseau est « chaud », 15 min sinon**). Le 2e pull arrive donc entre 5 et 15 min après le 1er, le 3e autant après. Attendre 3 minutes sans second « pull JSON » est **normal**. Pour obtenir des échantillons plus vite : un reset de la carte (chaque démarrage = inscription + pull immédiat ; le limiteur 429 du serveur peut répondre — ce qui exerce aussi le chemin `statut 2`).

## 4. Suite
Audit GPT → compléter ce canari (≥ 2 pulls supplémentaires, tas stable, marge principale ≥ 128 partout, aucun `pendingValidation`) → migration de `doValidate` → UNE frame personnelle → propagation. Option à décider après audit (non faite) : lancer le premier pull depuis `loop` plutôt que `setup` (+168 o de marge principale).
