# Lot 8B-2B-2 · NETSTACK-WIFI-CALLS-FIX3 — le contrôle « B » ne se mesure plus depuis un cadre trop profond

| | |
|---|---|
| **Date** | 09/10/2026 (nuit) |
| **Statut** | **Correctif étroit de l'instrument livré, COMPILÉ (cœurs 1.5.3 et 1.6.0), testé sur l'hôte. JAMAIS flashé.** Aucune frame. Le canari sans frame est à refaire (même fichier local 1/1). |
| **Origine** | canari matériel de `cf276b5` : `docs/mesures/8B2B2_NETSTACK_WIFI_CALLS_FIX2_2026_10_09/journal-wifi-calls-fix2-materiel.txt` ; audit `docs/AUDIT_GPT_WIFI_CALLS_FIX2_2026_10_09.md` |
| **Portée** | le seul sketch **UNO R4 e-ink 2,9″** (blocs `POD_RENDER_V1 && POD_CANARY` et un commentaire de ces blocs), tests, documentation. **Aucun changement de code de production** (`POD_CANARY = 0`), aucun serveur, Redis (+0), Neon (0), protocole, taille de pile dédiée. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

## 1. Ce que le canari de `cf276b5` établit sur la carte

| Chemin | Utilisé / marge | Erreur |
|---|---:|---:|
| Wi-Fi `status` / `firmwareVersion` / `begin` / `localIP` / `macAddress` | 608 / 864 · 448 / 1 024 · 536 / 936 · 568 / 904 · 520 / 952 o | 0 |
| Ed25519 `sign` / `verify` | 1 316 / 924 · 1 532 / 708 o | 0 / 0 |
| PodNet — inscription | 1 140 / 844 o, `POST /api/register → 200` | 0 |
| PodNet — premier pull | 1 136 / **848** o | 0 |
| Pile principale après `doRegister` (`6b`) | 880 / 1 024 o, marge **144 o**, affichée « SOUS L'OBJECTIF 256 » **sans arrêt** | — |

Le faux positif de `6b` est bien corrigé (FIX2). Le point silencieux **A** (juste après la transaction du pull, avant tout rapport) est passé. Puis le verrou a tiré au point **B** :

```
B: apres le rapport PodNet : ALERTE PILE utilisee au plus 900 / 1024 o (marge 124 o) | SP=0x20007C08
marqueur=0x434E5259 (OK) · longueur peinte=0x00000250 (OK) · plus bas octet modifié : marqueur + 124
```

Marqueur et longueur **intacts**, aucun octet sous `__StackLimit` : **ce n'est ni un débordement ni une faute de PodNet**.

## 2. Cause : l'instrument se mesurait lui-même depuis un cadre trop profond

`podCanaryCheck("B…")` était appelé **à l'intérieur de `podCanaryNet()`**, dont le cadre était encore vivant (≈ 20 o) : la marge principale passait de 144 à **124 o** (< 128, seuil fatal) uniquement parce que la mesure était prise un niveau plus bas. Les deux autres contrôles (A et C) sont appelés par `httpCall` lui-même et ne portent pas ce surcoût. Même chose, par construction, pour les deux autres appelants de `podCanaryNet` (lecture de l'image, lecture du candidat).

Conséquence à garder en tête : les **144 o** relevés à `6b` (inscription) viennent eux aussi d'un contrôle B imbriqué ; la marge **réelle de la production** est donc probablement **supérieure d'une vingtaine d'octets**. À confirmer par le prochain canari (rien n'est affirmé ici).

## 3. Correctif

| | Avant | Après |
|---|---|---|
| corps de `podCanaryNet()` | phase → rapport → verrou si erreur → **`podCanaryCheck(B)`** | phase → rapport → verrou si erreur — **plus aucun `podCanaryCheck`** (commentaire explicatif) |
| `httpCall` | A → rapport → *(B dans le rapport)* → journal HTTP → C | A → rapport → **B** (`  B: apres le rapport PodNet (silencieux)`) → journal HTTP → C |
| lecture de l'image (`pull-frame`) | B dans le rapport | rapport → **B** (`  B (pull-frame): apres le rapport PodNet (silencieux)`) |
| lecture du candidat (`candidate-frame`) | B dans le rapport | rapport → **B** (`  B (candidate-frame): apres le rapport PodNet (silencieux)`) |
| commentaire de l'instrument | « Toute ANOMALIE (marqueur détruit, marge < 128 o, **écriture sous `__StackLimit`**, SP hors pile) … verrou fatal » | « marqueur **ou longueur** détruits, marge **principale** < 128 o, SP hors pile — **PAS la zone 0xA5 peinte sous `__StackLimit`**, qui n'est plus qu'un indicateur depuis WIFI-CALLS-FIX2 » |

**Inchangés** : A avant le rapport, C après le journal HTTP, les lignes `[CANARY] net …`, la phase de PodNet, le verrou fatal, les tailles des piles dédiées (PodEd 2 304 · PodNet 2 048 · Wi-Fi 1 536 · journal 1 536), le seuil 128 o, l'objectif 256 o. Le contrôle intégré à `podCanaryWifi` (pile principale vérifiée juste après un appel au module) est hors périmètre : les chemins Wi-Fi sont peu profonds (marge ≥ 428 o relevée).

**Production inchangée** : seul `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` change, **uniquement dans des blocs gardés `#if POD_RENDER_V1 && POD_CANARY`** (et le commentaire d'un tel bloc) ; les quatre autres sketches sont inchangés au caractère près ; les tests de non-régression (texte hors canari identique à la sauvegarde) passent.

## 4. Tests

* **`tests/canaryBootFix2.test.ts`** — règle exécutable `podCanaryNetViolations` : (a) **aucun `podCanaryCheck` dans le corps de `podCanaryNet`** ; (b) pour `http`, `pull-frame` et `candidate-frame`, le contrôle B suit **immédiatement** le retour de `podCanaryNet` (blocs gardés adjacents, rien entre les deux) et existe exactement une fois ; (c) ordre dans `httpCall` : **A < rapport < B < journal HTTP < C**. **5 mutants refusés** : B remis dans `podCanaryNet` ; B supprimé de `pull-frame` ; B supprimé de `candidate-frame` ; B supprimé de `httpCall` ; B placé **avant** le rapport.
* Le commentaire obsolète est interdit par expression régulière ; la nouvelle formulation est exigée.
* Aucun autre firmware ne porte de `podCanaryCheck`.
* Les harnais hôtes de l'instrument (`canary_check_harness.cpp`, 33 scénarios) et des enveloppes Wi-Fi sont inchangés et verts.
* **Suite complète** : `npm test` **702 / 704** dans l arbre du porteur (les 2 échecs viennent uniquement de ses copies Arduino non suivies de `consensus-pod/examples/Ed25519StackProbeUnoR4/podRender*.h`) ; depuis un `git clone --local` du commit (sans copies locales, sans `secrets.h`, sans drapeaux 1/1) : **704 / 704**, `tsc` propre ; `npx eslint` et `git diff --check` propres.

## 5. Compilations — deux cœurs (sketch modifié : e-ink 2,9″)

Trois compilations par cœur (OFF, ON, canari 1/1), `--warnings all`, **cœurs 1.5.3 ET 1.6.0, 6 / 6 exit=0, aucun avertissement** (un premier lancement a perdu deux builds par une course entre compilations parallèles — « exit status 1 » sans message — relancés seuls : verts).

| Build (e-ink 2,9″) | Flash 1.5.3 | Flash 1.6.0 | RAM statique | Marge statique |
|---|---:|---:|---:|---:|
| OFF (`POD_RENDER_V1=0`, `POD_CANARY=0`) | 121 852 | 121 852 | 22 768 | 528 o |
| ON (`POD_RENDER_V1=1`, `POD_CANARY=0`) | 124 892 | 124 892 | 22 768 | 528 o |
| canari (1/1) | 130 844 | 130 844 | 22 768 | 528 o |

**Production inchangée — preuve par témoin** : le sketch du commit `cf276b5` et le sketch corrigé, compilés **dans des chemins de build de même longueur**, donnent la **même taille (121 852 o en OFF)**, la **même table de symboles** (1 250 symboles, mêmes tailles) et des binaires qui ne diffèrent que de 48 octets : la chaîne du chemin de build embarquée (`…\head_pod_uno_r4_eink29_0/…` contre `…\fix_pod_uno_r4_eink29_0/…`). (Une première comparaison avait montré +24 o : c'était la longueur du chemin de build, pas le code. Les tailles « avant » du lot précédent ne sont pas comparables non plus : le porteur a modifié `secrets.h` entre-temps — fichier non lu, jamais copié ni commité.)

**Canari** : 130 700 o (`cf276b5`, chemin de même longueur) → **130 844 o (+144 o)** : deux appels de contrôle supplémentaires (un par appelant de `podCanaryNet` autre que `httpCall`) et leurs libellés. RAM statique inchangée (22 768 o ; marge 528 o).

Les quatre autres firmwares (e-ink 2,7″, 2,7″ + OLED, TFT 1,8″, TFT 2,8″) sont **inchangés au caractère près** : leurs compilations de `cf276b5` (20/20 sur les deux cœurs, `docs/mesures/8B2B2_NETSTACK_WIFI_CALLS_FIX2_2026_10_09/`) restent valables ; marges de vote inchangées (284/308 o, TFT 2,8″ à 60 o, **toujours BLOQUÉ**).

## 6. Canari à refaire (APRÈS audit GPT) — même fichier local `1`/`1`, aucun dessin

Moniteur 115200 ; **register puis au moins trois pulls (≈ 5 min)** ; copier TOUT le journal, de `[BOOT]` après le troisième pull.

| À observer | Critère |
|---|---|
| `A`, `B`, `C` (et `B (pull-frame)` / `B (candidate-frame)` s'ils s'exécutent) | **stables, silencieux** à chaque pull |
| marge principale à tous les points | **≥ 128 o** (≈ 144 o, peut-être davantage, attendus ; « sous l'objectif 256 » signalé sans arrêt) |
| marqueur et longueur | intacts ; aucun octet sous `__StackLimit` |
| piles dédiées | erreurs 0 ; marges Wi-Fi ≥ 256 o ; PodNet ≈ 848 o ; aucune phase fautive |
| tas libre | stable entre les pulls |

**Aucune frame avant trois pulls avec A/B/C stables et marge principale ≥ 128 o.** Arrêt immédiat à la moindre alerte.

## 7. Ce qui reste ouvert / bloqué

* Marge principale de `doRegister` (≈ 144 o, objectif 256 o) : à améliorer avant la production, hors de ce lot.
* **TFT 2,8″ : toujours BLOQUÉ pour tout flash** (pile principale au vote : 964 o, marge 60 o).
* Jamais flashé : toute la chaîne reste « compilée + hôte » tant que le canari ci-dessus n'a pas été relu.
