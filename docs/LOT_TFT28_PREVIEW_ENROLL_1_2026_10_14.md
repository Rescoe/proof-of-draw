# Lot TFT28-PREVIEW-ENROLL-1 — build d'appairage Preview, sans écran, sans vote (14/10/2026)

Suite de l'audit de `4e6f548` : l'option B′ (premier flash du canari de vote avant l'appairage) est **circulaire** et refusée — le vrai candidat est requis pour compiler, mais `/api/draw` exige une session propriétaire, donc un appareil **déjà appairé**. Ce lot ajoute le **minuscule firmware d'appairage Preview** décidé par l'audit. Hôte et compilation seulement : **aucun flash, aucun vote, aucun déploiement, aucun candidat préparé, aucune fusion**. L'affichage validé n'est pas modifié.

## 1. À quoi sert ce build, en clair
Sur un Preview neuf, la carte n'existe pas : il faut qu'elle s'y **enregistre** puis qu'on l'**appaire** avec le code qu'elle reçoit. Ni le canari d'affichage (hôte de production codé), ni le canari de vote (aucun écran, code non journalisé) ne le permettent. Le build d'appairage fait seulement : Wi-Fi → `POST /api/register` → écrit sur le port série le `deviceId` et le `pairCode` → s'arrête pour toujours.

## 2. Ce que fait le build (`POD_PREVIEW_ENROLL = 1`)
- Drapeau **à 0 dans le dépôt** (jamais commité à 1, testé). Exige `POD_CANARY = 0`, `POD_VOTE_V1 = 0`, `POD_VOTE_CANARY = 0` (`#error` sinon).
- **Hôte** fourni par le fichier local `arduino_uno_r4/pod_uno_r4/pod_preview_host.h` (ignoré par git, **distinct de `pod_vote_pins.h`**, modèle `pod_preview_host.h.example`). `#error` s'il manque (aucun repli sur la production). **`proof-of-draw.vercel.app` est refusé à la compilation** (`static_assert` sur `__builtin_strcmp` — aucune fonction avant les `#include`, le générateur de prototypes de l'IDE Arduino y insérerait tous les prototypes) **et à l'exécution** (`strcasecmp`, avant le Wi-Fi : une casse différente ne contourne pas la garde).
- `setup()` : les trois CS restent à HIGH ; **ni `tft.begin`, ni `ts.begin`, ni `initSD`, ni dessin** ; Wi-Fi ; clés déjà présentes (auto-test Ed25519 comme avant) ; puis **au plus 6 essais** de `/api/register` espacés de 15 s (sous la limite serveur de 5 / min / IP) ; puis `enrollHalt` et **fin de `setup()`** : la suite (restauration, pull, « `[BOOT] prêt` ») **n'existe pas** dans ce build.
- **Non appairé** : `[ENROLL] NON appaire sur <hôte> : deviceId=… pairCode=… -> ouvrir https://<hôte>/onboard?code=… avec la session Preview`. **Déjà appairé** : `[ENROLL] appareil DEJA appaire … (rien a faire)` (sans `pairCode`). Dans les deux cas : `[ENROLL] ARRET DEFINITIF … plus aucun reseau, aucun pull, aucun vote, aucun ACK`.
- `loop()` = `delay(1000)` seulement. `doPull` / `doValidate` restent compilés mais **jamais appelés** (référencés par une fonction jamais appelée, supprimée à l'édition de liens, pour n'ajouter aucun avertissement).
- Production : avec les drapeaux à 0, **le texte du sketch est identique à V3-FIX1** (vue de test, `firmware-backups/2026-10-13_avant-vote-v4-canary/`) ; sauvegarde d'avant ce lot : `firmware-backups/2026-10-14_avant-preview-enroll/`. Une macro interne `POD_NOHW` (= vote ∨ appairage) remplace `POD_VOTE_CANARY` aux endroits « aucun matériel » ; les endroits propres au vote (verrou, épinglage, `voteCanaryLoop`) sont inchangés.

## 3. Preuves
- **Hôte, VRAI `setup()` + 200 tours de `loop()`** (`consensus-pod/host/tft28_enroll_harness.cpp`, `tests/tft28PreviewEnroll.test.ts`, 13 tests) : non appairé → **1 seule requête** (`/api/register`), pairCode et lien journalisés, arrêt ; déjà appairé → 1 requête, **pas de pairCode** ; register jamais accepté (aucune réponse / HTTP 500) → **6 essais exactement** puis arrêt ; hôte de production (casse différente) → **0 requête, aucun Wi-Fi**. Dans tous les cas : compteurs **écran, tactile, carte SD, `onSd` = 0**, aucune requête de pull / candidat / vote / ACK / image / clip / observation / banc d'essai, **verrou de vote (octets 5120 – 7167) intact**, aucune écriture EEPROM, **aucun faux `[BOOT] prêt`**. Sensibilité vérifiée : une variante qui initialise écran, tactile et SD fait bien monter les compteurs.
- **Portée source** (`reachFrom(…, "enroll")`) : depuis `setup()` / `loop()`, aucune fonction d'écran / tactile / SD / animation / ACK / pull / candidat / vote / verrou atteignable ; `doRegister`, `enrollReport`, `enrollHalt`… atteignables (analyse non vide) ; `doPull`, `doValidate`, `ackFrame`, `initSD`… non atteignables. 5 mutants de portée refusés.
- **9 mutants dynamiques refusés** : arrêt non posé, `tft.begin`, `initSD`, échec de register dessiné, onboarding dessiné, `loop()` qui reprend le pull, boucle de register non bornée, production non refusée à l'exécution, pairCode non journalisé.
- **ELF (cœur 1.6.0)** (`docs/mesures/TFT28_PREVIEW_ENROLL_1_2026_10_14/portee-elf-appairage-1.6.0.txt`, `scripts/vote-canary-elf-reach.js … --enroll`) : 189 fonctions atteignables par appels directs, **aucune** d'écran, de tactile, de SD, d'animation / ACK / image, **ni de pull / candidat / vote / verrou** ; constructeurs statiques sans accès au bus ; 35 appels indirects non suivis (limite de l'analyse).
- **Pile principale** (analyse statique, 1.6.0) : pire chaîne sous `setup()` = 584 o (+ 24 o de `hal_entry` / `arduino_main`) ⇒ **≈ 416 o de marge** sur 1 024 o (le build de vote : 608 o, ≈ 392 o). Statique, jamais mesurée sur la carte.

## 4. Compilation (cœurs 1.5.3 et 1.6.0, identiques ; `docs/mesures/TFT28_PREVIEW_ENROLL_1_2026_10_14/`)
| Build | Flash | RAM statique | Avertissements du sketch |
|---|---:|---:|---|
| **appairage** (`POD_PREVIEW_ENROLL = 1`) | **111 544 o** | **15 016 o** | 0 (liste complète identique à la production) |
| production | 158 620 o | 21 532 o | 0 |
| canari de vote | 134 160 o | 15 824 o | 0 |
| canari d'affichage | 149 584 o | 21 464 o | 0 |
Production, vote et affichage : **mêmes tailles qu'avant ce lot** (FIX2, même dossier de compilation). Hôtes et épingles de compilation factices.

## 5. Procédure du porteur (rien n'est fait par Claude)
1. `cp pod_preview_host.h.example pod_preview_host.h`, renseigner l'hôte Preview ; `node scripts/check-vote-pins.js arduino_uno_r4/pod_uno_r4/pod_preview_host.h` doit répondre `OK (format seulement)` (refuse le modèle non renseigné, la production, un fichier non ignoré ou suivi par git).
2. Compiler **localement** avec `-DPOD_PREVIEW_ENROLL=1` (`secrets.h` local ; jamais commité, ni le binaire). Garder le binaire stable pour le retour arrière.
3. Flasher, ouvrir le moniteur série (115 200 bauds), relever la ligne `[ENROLL] …`. Critères d'arrêt : une ligne `hote = PRODUCTION`, une requête autre que register, un affichage, un reset en boucle.
4. Appairer sur le site Preview ; **reflasher le stable**. La suite est dans `docs/PHASE_BACKEND_PREVIEW_ISOLE_VOTE_TFT28_2026_10_14.md`.
**Rien ne se flashe avant l'audit de ce lot et la preuve d'isolation du backend (étape 1 de l'ordre sûr).**

## 6. Limites
Jamais flashé ni exécuté sur la carte. Le `pairCode` est écrit en clair sur le port série (demande de l'audit) ; il expire avec la fiche. Le code reste dans `pod_uno_r4.ino` (drapeau), donc toute modification ultérieure du fichier exige de rejouer l'identité de la production (test inclus). `register` envoie la clé publique et le firmware `r4tft28-2.5` : la fiche Preview est créée avec ces valeurs.

## 7. Suite globale
Suite complète sur l'état final : 866 tests, 864 réussis, **2 échecs préexistants** (`boundedSsl`, cœurs Renesas 1.5.3 / 1.6.0, identiques à la base). Une exécution intermédiaire montrait 4 échecs de plus dans `tft28VoteCanary` : ses règles statiques cherchaient l'ancien texte (`#if POD_VOTE_CANARY` à `doPull`, `SERVER_HOST`, bandeau de `setup()`), que la macro `POD_NOHW` a déplacé ; motifs mis à jour, aucune règle assouplie (les mêmes mutants sont refusés). `tsc --noEmit` propre ; eslint propre sur les fichiers du lot (une erreur `prefer-const` PRÉEXISTANTE dans `tests/helpers/animV3Vectors.ts`, non touché). Dossiers temporaires : `ownTmp` (aucun `tft28en-*` restant), builds ARM supprimés.

## 8. Rollback
`git revert` du commit : retour à `4e6f548`.
