# Lot 8B-2E V3 — LOT8B2E-R4-TFT28-VOTE-V3-MEMORY (13/10/2026)

Marge mémoire de la **voie de vote** du UNO R4 WiFi + TFT 2,8″ : `doValidateV2` découpé en phases `noinline`, structure de travail `VoteWork` AU TAS, marge de la pile principale **152 o → 408 o** (statique). **Hôte et compilation seulement : aucun vote, aucun flash, aucun déploiement.** Base : `9514c7f` (V2), branche `claude/r4-tft28-vote-audit-8b2e`, worktree dédié ; les gestes tactiles ne sont pas intégrés (décision d'audit : réconciliation séparée après la voie vote).

## 1. Décisions d'audit appliquées

| Condition | Traitement |
|---|---|
| 1. `SIGNATURE_REFUSED` ⇒ candidat DÉPENSÉ | conservé ; seul le commentaire faux (« le prochain cycle votera ») est corrigé ; le journal le dit (« CE candidat reste dépensé, il ne sera pas revoté ») ; test statique + vérification dynamique (`serverRefusals`, `noRepeat`) |
| 2. Phases `noinline`, `VoteWork` au tas | § 2 |
| 3. Marge ≥ 256 o sur toutes les voies, viser 320 o | § 5 : 408 o sur le chemin nominal, ≥ 448 o sur les phases, test sur la mesure archivée |
| 4. `VoteWork` impossible à allouer ⇒ `NOT_SENT`, aucune lecture/signature/POST, nouvelle tentative permise | § 3 (scénarios `votework-fail`, `double-vwfail`) |
| 5. Trancher `g_voteScratch` / `g_voteChunk` | § 6 : **non modifiés** (utilisation démontrée) — blocage documenté pour V4 |
| 6. Archiver g++ 14.2, commande, `CXX`, variables ; pré-vol explicite | `docs/mesures/8B2E_V3_2026_10_13/TOOLCHAIN.txt` + test « V3 — PRÉ-VOL » (échoue avec la cause ; plus aucun test du fichier n'est ignoré silencieusement) |
| 7. Garanties V2 + allocation refusée, nettoyage partiel, aucune signature/POST | § 3 et § 4 |
| 8. Pas de gestes tactiles | respecté |
| 9. Un seul commit | oui |

## 2. Architecture

```
doValidate()            (inlinée dans loop) : porte, verrou « dépensé », GET validate-candidate, décodage — inchangé (V2)
  doValidateV2()        cadre 40 o : alloue VoteWork (new nothrow) — échec ⇒ NOT_SENT, RIEN d'autre — puis 3 phases, puis delete (tous les chemins)
    votePhaseRead()     cadre 72 o : écran connu ? → netReadCandidate (pile réseau FERMÉE au retour) → hash divergent = ABSTENTION (D-V2) → verdict
    votePhaseSign()     cadre 48 o : message signé (longueur EXACTE contrôlée) → PodEd::sign (pile dédiée, jamais imbriquée) → hexadécimal dans VoteWork
    votePhasePost()     cadre 56 o : corps JSON par ajouts CONTRÔLÉS (aucun temporaire, aucun snprintf) → httpCall POST → voteFinish (classement + journal)
```
`VoteWork` (≈ 300 o, au tas) : `PodCheck` (lecture, hash, métriques), `sig[64]`, `sigHex[129]`, verdict. Plus aucun gros objet sur la pile principale ; plus aucune `String` dans `doValidateV2`.

## 3. Échecs fermés et nettoyage (nouveau en V3)

| Situation | Comportement |
|---|---|
| `VoteWork` non allouable | `NOT_SENT` : **0 lecture** du candidat, 0 signature, 0 POST ; le candidat n'est pas dépensé ; la ré-annonce suivante réussit (testé : 2 allocations, 1 lecture, 1 POST) |
| lecture/abstention/signature qui échoue | `VoteWork` libéré (`delete w` unique, deux sorties seulement dans `doValidateV2`) |
| message à signer tronqué par manque de tas | longueur comparée à la longueur exacte attendue ⇒ « message incomplet » ⇒ `NOT_SENT` |
| corps JSON tronqué par manque de tas | chaque ajout vérifie la longueur obtenue ⇒ « corps incomplet » ⇒ `NOT_SENT` |
| **requête HTTP tronquée** (trouvaille de V3) | voir ci-dessous |
| `GUARD` | arrêt sûr silencieux (V2) ; `VoteWork` reste alloué mais la carte est figée par conception |

**Trouvaille : la requête HTTP pouvait partir tronquée.** La propriété « un échec de `String` à n'importe quel point ne produit jamais un POST non conforme » (56 points d'injection, `memoryFailures`) a mis à nu que `Conn::request` construisait la requête par concaténation silencieuse : un tas épuisé pouvait envoyer un POST **sans corps** (observé aux points 49, 51 et 52). Correctif : la requête est construite **en tout ou rien AVANT la connexion** (`strAppendChecked`, longueur comparée) ; sinon `request()` rend **-6** (rien n'est émis, aucune connexion) ⇒ `NOT_SENT`. ⚠ `Conn` est partagée par TOUS les téléchargements (image, clips, pull-frame) : le canari d'affichage reçoit aussi ce correctif (voir § 8).

## 4. Preuves hôte (`tests/tft28VoteHarness.test.ts`, 30 tests, aucun ignoré)

- les **18 scénarios de V2** inchangés (nominal vérifié contre la référence indépendante, porte, v1, lecture fermée, abstention, POST non exécuté / inconnu, refus, GUARD, pas de répétition) ;
- `voteWorkFail` : allocation refusée, nouvelle tentative ; `cleanup` : `vw_live == 0` sur 27 scénarios ; `memoryFailures` : **56 injections d'échec de `String`**, chaque POST émis est conforme et signé, jamais de fuite ; `scratchUsed` : un candidat `oled096` proposé au TFT est voté (hash et métriques == référence indépendante) ;
- **43 mutants exécutés** (34 hérités de V2, adaptés aux phases, **9 nouveaux** : `VoteWork` non libéré, échec d'allocation ignoré, signature tentée après un échec de lecture, longueur du message ou du corps non contrôlée, ajout non contrôlé, requête tronquée envoyée, `-6` confondu avec l'envoi, `g_voteScratch` réduit…) **+ 7 statiques** : tous refusés par la vérification visée ;
- vérifications statiques : phases `noinline`, une seule allocation de `VoteWork` avant la lecture, un seul `delete`, aucun gros objet ni appel profond dans `doValidateV2`, ni `snprintf` dans les phases, requête en tout ou rien, `g_voteChunk`/`g_voteScratch` statiques ;
- `classify` : 20 lignes (dont `-6 → NOT_SENT`).

## 5. Mesures (cœurs 1.5.3 et 1.6.0, `--warnings all` ; `docs/mesures/8B2E_V3_2026_10_13/`)

**Marge de la pile principale (statique, ELF de production 1.6.0, `scripts/tft28-stack-report.js`)** — pile 1 024 o :

| Étape | cadre | cumul depuis `loop` | **marge** | V2 |
|---|---:|---:|---:|---:|
| `doValidateV2` (chemin nominal, pire voie : `votePhasePost` → `httpCall`) | 40 | 616 | **408 o** | 152 o |
| `votePhaseRead` (lecture + `netReadCandidate`) | 72 | 520 | 504 o | — |
| `votePhaseSign` (inclut la barrière `PodEd`) | 48 | 544 | 480 o | 228 o (rapport Ed25519 de l'audit) |
| `votePhasePost` | 56 | 576 | 448 o | — |
| `voteFinish` | 32 | 480 | 544 o | 544 o |
| `doValidateDecode` / `httpCall` | 40 / 72 | 456 / 520 | 568 / 504 o | identique |

Exigence 256 o : **tenue sur toutes les voies du vote** ; objectif 320 o : **tenu** (408 o). Le test « V3 — MESURE ARCHIVÉE » lit ces lignes et échoue sous 256 o (320 o pour le chemin nominal). ⚠ Analyse **statique** : ni interruptions, ni appels indirects ; la marge réelle se mesurera au canari de vote (V4) par peinture de la pile. La voie de **ré-inscription** (`doRegister`, tour de `loop` suivant, hors du vote) garde sa marge de 264 o (inchangée).

| Build | Flash | RAM statique | vs V2 (`9514c7f`) |
|---|---:|---:|---|
| production V3 (1.5.3 = 1.6.0) | 158 724 o | 21 532 o | flash +720 o, RAM **identique** |
| canari V3 (1.5.3 = 1.6.0) | 149 688 o | 21 464 o | flash +96 o, RAM **identique** |

Avertissements du projet **identiques** à V2 (17 types préexistants), production et canari, sur les deux cœurs. Tas : `VoteWork` ≈ 300 o + `String` du message (≈ 190 o) puis du corps (≈ 480 o) — transitoires, libérés à chaque phase ; à mesurer sur la carte (tas autour de 5 944 o pendant l'animation).

## 6. `g_voteScratch` + `g_voteChunk` (4 992 o statiques) — décision : NON modifiés

- **Preuve d'utilisation** : (1) *références* — `podCheckStream(…, g_voteScratch, sizeof(g_voteScratch), g_voteChunk, …)` est l'unique appel ; `PodFeeder::begin` exige un tampon de **1 024 o (OLED)** ou **4 736 o (e-ink 2,9″)** et `false` sinon ; `g_voteChunk` (256 o) est le tampon de lecture de **tous** les écrans ; (2) *serveur* — `app/api/validate-candidate/route.ts` propose le candidat courant à tout appareil actif **sans filtrer par type d'écran** (« seul le broadcast d'affichage reste filtré ») : un TFT peut recevoir un candidat `oled096` ou `eink29bwr` ; (3) *tests* — scénario `oled-candidate` : le TFT vote un candidat OLED de 1 024 o avec les métriques de référence, et le mutant `g_voteScratch[1]` est refusé.
- Seul le canal `tft28` (153 600 o, `need_ = 0`) n'utilise pas `g_voteScratch` : l'absence d'utilisation n'est donc démontrée **que pour un candidat épinglé `tft28`**, ce que le canari V4 imposera (hash épinglé + écran `tft28`). Gain potentiel documenté pour V4 : **−4 736 o de RAM statique** (tas +4 736 o) pour un build épinglé, sans toucher à la production générale ; `g_voteChunk` ne peut pas être supprimé (il peut migrer dans `VoteWork`, +256 o de tas transitoire, −256 o statique : à décider avec la mesure du tas).
- Gain mesuré dans ce lot : **0 o** (volontairement).

## 7. Reproduction (archivée)
`docs/mesures/8B2E_V3_2026_10_13/TOOLCHAIN.txt` : g++ 14.2.0 (WinLibs UCRT), `CXX`, `PATH`, Crypto 0.4.0, ArduinoJson 7.4.3, arduino-cli, chaîne `arm-none-eabi-gcc` 7-2017q4, commande exacte des tests et des compilations. Environnement connu **incompatible** : g++ 10.2 (audit Codex) ne construit pas le harnais Crypto ⇒ le test « V3 — PRÉ-VOL » **échoue** avec la cause (version < 11 ou Crypto non compilable) au lieu d'ignorer les scénarios.

## 8. Limites restantes
1. Marge **statique** seulement ; aucune mesure sur carte (V4).
2. Le verrou « dépensé » reste en **RAM** (V4 : EEPROM).
3. Le correctif `Conn::request` (requête en tout ou rien, code -6) touche le **transport commun** : image, clips, pull-frame, ACK (via `httpCall`) et le canari d'affichage ; comportement nominal identique, échec plus sûr ; à revalider au prochain canari matériel d'affichage.
4. `NOT_SENT` après signature permet une nouvelle tentative à la ré-annonce (une par pull) ; pas de plafond de ré-inscription (R-M2).
5. `FIRMWARE_VERSION` inchangé (`r4tft28-2.5`).
6. Suite globale : voir § 9.

## 9. Suite globale (même machine, même environnement : g++ WinLibs 14.2, `CXX`, Crypto 0.4.0, ArduinoJson 7.4.3)

| | tests | réussis | échecs |
|---|---:|---:|---:|
| V2 (`9514c7f`) | 822 | 820 | 2 |
| V3 (HEAD de ce lot) | 828 | 826 | 2 |

Différentiel : **+6 tests, 0 échec nouveau**. Les deux échecs sont **strictement identiques** sur V2 et V3 : `boundedSsl` « cœur Renesas 1.5.3 (VRAI code) » et « 1.6.0 (VRAI code) » (harnais hôte contre les sources WiFiS3 tierces, sortie `0xC0000374` sous Windows) — préexistants, **non masqués, non corrigés ici**. La suite n'est donc pas verte. `npx tsc --noEmit` propre ; ESLint sur les trois fichiers de test modifiés : 0 avertissement ; `git diff --check` propre. Tests de texte adaptés (ils épinglaient l'ancien code) : `netStack` (phases lecture → signature), `tft28Canary` (`Conn` ajoutée aux fonctions d'origine modifiables).

## 10. Rollback
`git revert` du commit V3 : retour exact à `9514c7f`. Aucun état persistant modifié.

## 11. Prochaine étape — V4
Build « canari de vote » local (`-DPOD_VOTE_CANARY=1`) : candidat **épinglé** (écran `tft28` + hash), verrou EEPROM « un seul vote », arrêt sûr après le vote, instrument de pile (peinture) dans la voie vote, `g_voteScratch` exclu pour ce build épinglé (−4 736 o), décision D-V1 (backend isolé) — après audit GPT de V3.
