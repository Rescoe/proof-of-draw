# État des branches et des canaris — 13/10/2026

Document de référence unique, **établi sans fusion ni suppression** : aucune branche, aucun worktree, aucun fichier n'a été supprimé ; rien n'est poussé sur `main`. Chaque travail récent est sauvegardé sur sa propre branche GitHub.
Source des faits matériels : le porteur (journaux série) et les verdicts GPT/Codex. « Validé matériellement » = observé sur la carte par le porteur ; « hôte » = harnais/tests sur PC ; « compilé » = compilation seule.

## 1. Branches (état au 13/10/2026, après `git fetch origin --prune`)

`origin/main` = `3239d2e` (`feat(mesures): lecture 30 min / envoi 1 h…`) ; `main` local = identique, propre.

| Branche | HEAD | Distance à main | Remote | Contenu |
|---|---|---|---|---|
| `main` | `3239d2e` | — | `origin/main` | production (R4 e-ink 2,9″ canari 8B2B2 validé, capteur DHT22…) |
| `claude/r4-tft28-touch-gestures-8b2e` | `89b93cc` | +16 | **poussée, upstream posé** | TFT 2,8″ : chaîne canari + animation en flux + gestes tactiles |
| `claude/r4-tft28-vote-audit-8b2e` | `2399c73` | +16 | **poussée, upstream posé** | TFT 2,8″ : chaîne canari + animation en flux + audit/harnais du vote |
| `claude/esp8266-eink27-oled-canary-8b2c` | `b94bfb9` | +7 | **poussée, upstream posé** (l'ancien upstream pointait à tort vers la branche 2,9″) | ESP8266 : canari 2,9″ (validé) + canari 2,7″ + OLED |
| `origin/claude/esp8266-eink29-canary-8b2c` | `e059db3` | +3 | distante | ESP8266 e-ink 2,9″ : canari validé (sous-ensemble de la branche 2,7″) |
| `origin/claude/r4-tft28-canary-8b2d` | `480eacd` | +7 | distante | TFT 2,8″ historique (s'arrête à l'animation FIX1 ; FIX2 est sur les deux branches 8b2e) |
| `codex/claude-local-resume-2026-10-12` | `c4bbeda` | +17 | **locale seulement** | reprise Codex, GELÉE (canari animation) ; contient 0059f74 + docs |
| `origin/claude/hopeful-noether-ndz9ud` | `1a68a49` | +4 | distante | R4 e-ink 2,7″ (solo + OLED) : PRÊT, test matériel reporté |
| `codex/cloud-handoff-pullframe-fix1` | `e5c185f` | +1 / −9 | locale + distante (`01c74f7`) | docs d'orchestration (historique) |
| `codex/local-snapshot-2026-10-11` | `3795242` | +1 / −10 | locale + distante | archive de notes (historique) |
| `codex/archive-nifty-hamilton-2026-10-12`, `claude/nifty-hamilton-67f2fa` | `9e62f95`, `db024c9` | −233 | locale seulement | archives d'un ancien worktree (mai 2026) — **ne pas supprimer sans décision** |
| `claude/integration-validated-2026-10-13` | `3239d2e` | 0 | locale | branche d'intégration **vide** (= `origin/main`), voir § 4 |
| `claude/docs-etat-branches-2026-10-13` | — | +1 | à pousser | ce document |

Les deux branches 8b2e partagent le même tronc de 12 commits (jusqu'à `3f9b35e`, voir § 4) ; elles ne diffèrent que par leurs 4 commits propres : audits + gestes tactiles (`a88d582`, `1ed3393`, `c98168e`, `89b93cc`) **ou** audit/vote (`4d00aae`, `a83b5d4`, `9977183`, `2399c73`). Elles ne doivent pas être fusionnées l'une dans l'autre avant décision.

## 2. Worktrees

| Chemin | Branche | État |
|---|---|---|
| `…\App-Rescoe\proof-of-draw` | `main` | propre (dossiers ignorés : `.env.local`, `.next`, `secrets.h` R4…) |
| `…\worktrees\proof-of-draw-claude-esp27-oled-canary` | `claude/esp8266-eink27-oled-canary-8b2c` | propre ; ignorés : `canary-builds/`, `secrets.h`, caches |
| `…\worktrees\proof-of-draw-claude-local-resume` | `codex/claude-local-resume-2026-10-12` | propre (gelé) |
| `…\worktrees\proof-of-draw-claude-touch-gestures` | `claude/r4-tft28-touch-gestures-8b2e` | propre |
| `…\worktrees\proof-of-draw-claude-vote-audit` | `claude/r4-tft28-vote-audit-8b2e` | propre |
| `…\worktrees\proof-of-draw-docs-etat` | `claude/docs-etat-branches-2026-10-13` | ce document |

Fichiers locaux ignorés notables (jamais commités) : `canary-builds/` (binaires + `secrets.h`), `esp8266/esp_eink_2.7BW_OLED/secrets.h`, `arduino_uno_r4/*/secrets.h`, `.env.local`.
`node_modules` des worktrees `resume`, `touch-gestures`, `vote-audit` est **partagé par lien** avec `resume` ; ne jamais supprimer un worktree avec `--force` tant que ces liens existent (un nettoyage a vidé ces dossiers le 13/10 ; restaurés par `npm ci`, aucun fichier suivi touché).

## 3. État par installation

| Setup | Branche / commit | Remote | Code | Hôte | Matériel | Vote | Prochaine action | Fichier à flasher |
|---|---|---|---|---|---|---|---|---|
| ESP8266 + e-ink 2,9″ BWR | `origin/claude/esp8266-eink29-canary-8b2c` @ `e059db3` (aussi dans la branche 2,7″) | distante | instrumentation canari (`POD_CANARY`) + production inchangée | oui (harnais + mutants) | **frame, rendu, ACK validés** | non validé | décider l'intégration (§ 4, groupe A) | non applicable (validé) |
| UNO R4 + e-ink 2,9″ BWR | `main` @ `3239d2e` (lots 8B2B2, BOUNDED-SSL-FIX1) | oui | production | oui | **frame, rendu, ACK validés** (pile réseau dédiée, `PodBoundedSSL`) | non validé | garde-fous avant vote : migrer `doValidate` | `canary-builds/` du worktree principal (`canary/` et `stable/`, voir `MANIFEST.txt`) |
| UNO R4 + TFT 2,8″ + SD | `claude/r4-tft28-touch-gestures-8b2e` @ `89b93cc` ; `claude/r4-tft28-vote-audit-8b2e` @ `2399c73` ; base validée `0059f74` | poussées | canari sans vote + animation en flux ; gestes tactiles (non essayés) | oui | **images fixes, cache SD, ACK, animation SD validés** ; pause/reprise tactile et reprise auto 60 s **observées** (sur la version avant gestes) ; pile animPlay 828 o (marge 644), tas ≈ 5 944 stable | **non validé** | canari des gestes (89b93cc) ; vote : lots issus de l'audit | copie de canari non répertoriée ici (à confirmer dans le worktree concerné) |
| ESP8266 + e-ink 2,7″ BW + OLED | `claude/esp8266-eink27-oled-canary-8b2c` @ `b94bfb9` | poussée | canari sans vote, rendu v1, BUSY/Content-Length fail-closed, drapeaux en source unique | oui (6 configurations, 24 mutants, build IDE-style) | **canari non exécuté** (code compilé et audité ; FIX1 en audit GPT) | non (aucun vote dans le canari) | flasher après verdict GPT, protocole du lot (§ 4 du doc de lot) | `canary-builds\esp27-oled-canary-fix1\esp_eink_2.7BW_OLED\esp_eink_2.7BW_OLED.ino` (copie IGNORÉE, drapeaux 1/1 dans **`pod_canary_flags.h`**, pas dans le `.ino`) |
| UNO R4 + e-ink 2,7″ (solo/+OLED) | `origin/claude/hopeful-noether-ndz9ud` @ `1a68a49` | distante | propagation étroite, canari sans vote | oui | **reporté (cartes indisponibles)** | non | attendre les cartes | aucune |

Règle commune : la source suivie par Git reste à `POD_RENDER_V1 = 0` et `POD_CANARY = 0` ; les copies de canari sont ignorées par git.

## 4. Proposition de contenu pour `main` (NON appliquée — à auditer par GPT/Codex)

Branche préparée : `claude/integration-validated-2026-10-13` = `origin/main` (`3239d2e`), **vide** : aucun cherry-pick ni fusion.

### Groupe A — validés matériellement, intégrables
- **ESP8266 e-ink 2,9″** : `01cafd0`, `6ccb729`, `e059db3` (canari + FIX1 + FIX2, verdict matériel dans `e059db3`).
- **TFT 2,8″ — canari sans vote** (verdicts matériels : démarrage, frames, SD, ACK) : `2abc358` (test infra), `266b40f`, `cab924b`, `30dc304`, `f1471d4`, `1bb2512`.
- **TFT 2,8″ — animation en flux (validée sur carte)** : `480eacd` (FIX1), `0059f74` (FIX2, validé).

### Groupe B — documentation / tests seulement (aucun code firmware)
- `f8657d8` (cadrage mesures et modèle économique), `224a164` (orchestration), `685b1a0` (audit 480eacd), `3f9b35e` et `a88d582` (audits : autorisation puis validation du canari animation), `1ed3393` (spécification appui court/long).
- Branche vote : `4d00aae`, `a83b5d4` (audit de la chaîne de vote, cadrage SD), `9977183`, `2399c73` (harnais de vote hôte, D-V2 appliquée — **tests/docs, aucun changement de firmware**). À intégrer éventuellement après relecture des écarts R-H1…R-M1.

### Groupe C — en attente de canari matériel, EXCLUS de main
- `c98168e`, `89b93cc` : gestes tactiles du TFT (firmware modifié, **jamais essayé sur la carte**).
- `6a988a1`, `5986582`, `275f82c`, `b94bfb9` : canari ESP8266 2,7″ + OLED (canari non exécuté ; FIX1 en audit).
- `465c566`, `b7ea573`, `0391c71`, `1a68a49` : R4 e-ink 2,7″ (cartes indisponibles).
- Tout futur vote réel (aucun n'est validé).

### Points d'attention avant toute fusion
1. Les groupes A et B de la branche TFT forment un tronc commun de 12 commits aux deux branches 8b2e (`2abc358` … `3f9b35e`) ; l'intégrer **une seule fois** (cherry-pick du tronc, ou fusion d'une branche tronquée au commit `3f9b35e`).
2. Deux tests de `npm test` échouent à l'identique sur `e059db3` et sur HEAD (`boundedSsl`, cœurs Renesas 1.5.3/1.6.0, harnais hôte sous Windows, code 0xC0000374) : à traiter ou à documenter avant de déclarer la suite propre.
3. `codex/claude-local-resume-2026-10-12` (`c4bbeda`) n'existe qu'en local : à sauvegarder sur GitHub si on veut la conserver (non fait : non demandé).

## 5. Habitudes de travail à partir de maintenant
Une branche par lot ; jamais de mélange de sources (TFT, ESP8266, R4) dans un même lot ; branche poussée et upstream vérifié dès qu'un lot est validé ou audité ; document d'état mis à jour à chaque verdict matériel ; aucune suppression sans accord explicite.
