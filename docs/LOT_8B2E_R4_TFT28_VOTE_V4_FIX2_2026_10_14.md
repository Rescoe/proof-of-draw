# Lot 8B-2E V4-FIX2 — sortie immédiate de `setup()` après l'arrêt définitif, et préparation du canari (14/10/2026)

Suite de l'audit GPT de V4-FIX1 (`ead25cd`, `c52ecea`), accepté sur la sécurité. Hôte et compilation seulement : **aucun flash, aucun vote, aucun déploiement, aucune fusion**, historique non réécrit. Drapeaux à `0` dans le dépôt.

## 1. Défaut
Carte non appairée : `doRegister()` appelle `vcHalt(...)` puis retourne `true` ; `setup()` poursuivait donc (aucun pull, `paired` faux) jusqu'à `logf("[BOOT] prêt — pull toutes les … s")` — un **faux message de réussite** après un arrêt définitif. Aucun accès réseau, périphérique ni vote n'en résultait (la boucle est gelée par `g_vcHalted`), mais le journal mentait.

## 2. Correctif (un seul ajout, build de vote seulement)
Dans `setup()`, juste après la boucle de register : `#if POD_VOTE_CANARY if (g_vcHalted) return; #endif`. Verrou EEPROM, épinglage, ordre verrou/POST, vote et production : **inchangés** (le texte du sketch avec `POD_VOTE_CANARY = 0` est identique à V3-FIX1 : test d'identité inchangé).

## 3. Tests
- Le harnais recopie désormais aussi les lignes `[BOOT…` (jusqu'ici invisibles, ce qui aurait masqué le défaut).
- `bootUnpaired` exige : **aucune** ligne `[BOOT] pr…` ni `premier pull imm…`, la ligne `ARRET DEFINITIF` présente, ainsi que tout ce qu'exigeait FIX1 (0 pull, 0 validate, 0 lecture, 0 POST, compteurs écran / tactile / SD / onSd à zéro, verrou intact).
- Nouveau mutant « `setup()` continue après l'arrêt définitif » : **refusé** par `bootUnpaired` (le mutant n'était pas détecté avant l'ajout de `[BOOT` au filtre : vérifié). 27 mutants au total.
- Ciblés (`tft28VoteCanary`, `tft28VoteHarness`, `podHeaderCopies`, `tft28RegisterStack`) : 96/96. Suite complète : voir § 6.

## 4. Mesures (cœurs 1.5.3 et 1.6.0 ; `docs/mesures/8B2E_V4_FIX2_2026_10_14/`)
| Build | Flash | RAM statique |
|---|---:|---:|
| production | 158 620 o | 21 532 o |
| canari d'affichage | 149 584 o | 21 464 o |
| canari de vote | 134 160 o | 15 824 o |

Les flashs sont 120 o sous les mesures de FIX1 **parce que le dossier de compilation est plus court** (chaînes de chemin) : le sketch du commit FIX1 compilé dans les mêmes conditions donne 158 620 o (`build-f1ref_off_160.txt`). RAM identique à FIX1. Les avertissements du build de vote sont identiques à ceux de la production. Portée ELF du build de vote refaite (`portee-elf-vote-1.6.0.txt`) : 232 fonctions atteignables, aucune d'écran / tactile / SD / animation / ACK ; constructeurs statiques sans accès au bus. `VoteLockErase` est inchangé (compilé en FIX1).

## 5. Préparation, sans rien flasher
1. **Copie locale du canari d'affichage** (`POD_VOTE_CANARY = 0`, frame personnelle puis animation) : `bash scripts/prepare-local-canary-tft28.sh` crée `canary-builds/tft28-display-canary/pod_uno_r4/` (dossier ignoré par git) avec `POD_CANARY = 1`, `POD_RENDER_V1 = 1`, `POD_VOTE_V1 = 0`, `POD_VOTE_CANARY = 0` (seules deux lignes diffèrent du dépôt, vérifié par `diff`) ; le script refuse si un drapeau du dépôt n'est pas à 0, **ne lit ni ne copie `secrets.h` ni `pod_vote_pins.h`** : le porteur y place son propre `secrets.h`. Protocole matériel : `docs/LOT_8B2D_R4_TFT28_CANARY_2026_10_12.md` § 6, étapes 1, 2 (frame personnelle, UUID neuf, **un seul reset**) et 7 (animation), plus stabilité (étape 8). Critères d'arrêt inchangés (`ALERTE`, `ARRET FATAL`, marge < 128 o…). Ce canari ne vote pas : il revalide le transport modifié par V3 / FIX1 (`Conn::request` tout-ou-rien, écriture partielle `-7`).
2. **Isolation du backend et de Redis, pins, verrou** : `docs/PROTOCOLE_ISOLATION_ET_VERROU_VOTE_TFT28_2026_10_14.md` (preuves par variables du déploiement, console Upstash avec sonde croisée, candidat absent de la production, Neon, appareil appairé côté Preview, critères NO-GO).
3. **Génération de `pod_vote_pins.h` et `VoteLockErase`** : mêmes protocole (§ 6 et 7) ; nouveau `scripts/check-vote-pins.js` (hors ligne : refuse valeurs modèle, hôte de production, identifiant / hash mal formés, fichier non ignoré ou suivi par git ; **ne prouve pas l'isolation**). Essayé à la main sur le modèle (refusé), sur un fichier factice valide (accepté) et avec l'hôte de production (refusé).

## 6. Suite globale
Suite complète sur la révision de travail : 853 tests, 851 réussis, **2 échecs préexistants** (`boundedSsl`, cœurs Renesas 1.5.3 / 1.6.0, identiques à la base). `tsc --noEmit` et eslint propres. Après l'ajout du nettoyage (§ 7), `tft28VoteCanary` + `tft28VoteHarness` : 55/55 (une première exécution complète avait été tuée avec son shell, relancée à l'identique).

## 7. Dossiers temporaires
`tests/helpers/ownTmp.ts` : `ownTmp(prefix)` crée un dossier privé et le supprime à la sortie du processus (`exit`, y compris après échec d'assertion ou exception ; `SIGINT` / `SIGTERM`) ; il ne supprime **que** les dossiers qu'il a créés, jamais de purge globale de `%TEMP%`. Utilisé par `tft28VoteCanary` et `tft28VoteHarness` (vérifié : 0 dossier `tft28vc-*` / `tft28vote-*` après exécution). Dossiers de compilation et copies de ce lot (`r4out_f2`, sources factices) supprimés. **Reste hors périmètre** : une trentaine d'autres tests historiques créent encore leur dossier par `fs.mkdtempSync` sans nettoyage ; migration mécanique vers `ownTmp` à faire dans un lot dédié.

## 7bis. Prochain canari d'affichage — quoi préparer
`bash scripts/prepare-local-canary-tft28.sh` (déjà exécuté ici) → `canary-builds/tft28-display-canary/pod_uno_r4/pod_uno_r4.ino` ; y copier SOI-MÊME `secrets.h` ; configuration : `POD_CANARY = 1`, `POD_RENDER_V1 = 1`, `POD_VOTE_V1 = 0`, `POD_VOTE_CANARY = 0`, **pas de `pod_vote_pins.h`** ; conserver le binaire stable pour le retour arrière.

## 8. Suite (14/10/2026)
Canari d'affichage **VERT** sur la carte : `docs/CANARY_R4_TFT28_AFFICHAGE_FIX2_VERDICT_2026_10_14.md` ; préparation de la phase Preview : `docs/PHASE_BACKEND_PREVIEW_ISOLE_VOTE_TFT28_2026_10_14.md`.

## 8bis. Limites et ordre
Rien de ce lot n'a tourné sur une carte. Ordre recommandé du porteur, après audit : canari d'affichage (frame personnelle puis animation) → preuves d'isolation → pins + `VoteLockErase` → vote unique (protocole V4 § 7). Le défaut d'ACK de la production reste pour le lot `TFT28-ACK-STATE-FIX1`.

## 9. Rollback
`git revert` du commit : retour à FIX1.
