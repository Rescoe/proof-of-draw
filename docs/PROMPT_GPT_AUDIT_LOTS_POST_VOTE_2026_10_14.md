# Demande d'audit — lots du soir du 14/10/2026 (branche `claude/lots-post-vote-reel-2026-10-14`)

Contexte : le vote réel v2 est en production (blocs #100, #101, #103). Décisions du porteur ce soir : (1) **pas de reset global — la chaîne est conservée à jamais ; toute évolution incompatible sera un fork** ; (2) **la réception des images et blocs est maintenue** pour les appareils qui ne savent pas voter (sans vote, hors quorum) ; (3) traiter les défauts connus.

Tête de la branche : à lire avec `git log main..claude/lots-post-vote-reel-2026-10-14`. **Rien n'est poussé sur `main` ni déployé** avant votre GO.

## Lots à auditer
| Commit | Lot | Ce qui change | Risque principal |
|---|---|---|---|
| `2093adc` | RECEPTION-MAINTENUE | `/api/pull` n'interrompt plus la réponse pour un appareil non capable : il reçoit frame/bloc, mais **aucune invitation à valider** (`pendingValidation` absent) ; `validate-candidate` renvoie 403 `firmware-not-vote-capable` ; `getGlobalActiveCount`/`getPoolSnapshot` filtrent par `participatesInVoteNetwork` (quorum inchangé). `voteAdmission` reste la barrière côté `validation-result`. | un appareil non capable ne doit ni voter ni compter dans `poolSize` |
| `8a7adfe` | REJECTED-CANDIDATE-ARCHIVE-1 | `lib/rejectedArchive.ts` : copie complète `candidate:archive:{id}` + pointeur `candidate:last` à la création ; supprimés au minage ; entrée dans `rejected:draws` au refus (comité/réseau) ; un candidat expiré est réconcilié à la création du suivant. Tout est « au mieux » (`.catch`). | coût Redis (+2 par dessin, +3 par refus) ; jamais bloquant |
| `e9368f1` | TFT28-ACK-STATE-FIX1 | queue de `doFetchFrame` du TFT 2,8″ en production : l'ACK décide (`lastFrameId`, `pendingCandidateId`, métadonnées SD écrits seulement après ACK 200). Même sémantique que le canari d'affichage validé sur carte. Sauvegarde : `firmware-backups/2026-10-14_avant-ack-state-fix1/`. | firmware jamais flashé : **à flasher et vérifier par le porteur** |
| `591a8d8` | docs | CLAUDE.md, DECISION §2 (reset abandonné → fork), RESTE_A_FAIRE | aucun code |

## Points d'attention demandés
1. RECEPTION-MAINTENUE : confirmer qu'aucun chemin ne permet à un appareil non capable de **voter** ou d'**augmenter le quorum** (cf. `voteAdmission`, `participatesInVoteNetwork`, `deviceStore`).
2. L'ordre `reconcileLostCandidate` → `setCandidate` → `archiveOnCreate` (submit-candidate) : un échec de l'archive peut-il bloquer un dépôt ? (réponse attendue : non, `.catch`).
3. L'archive ne doit pas apparaître comme « rejet » pour un bloc miné (`dropArchive` après `clearCandidate`).
4. TFT : en cas d'ACK perdu, l'image reste à l'écran mais la frame est re-annoncée au pull suivant (nouvel essai) — comportement voulu et déjà celui du canari.

## Preuves
- Tests ciblés : `voteCapability`, `pullReception`, `personalFrame`, `rejectedArchive`, `castVote`, `displayState` ; `tft28Host`, `tft28VoteHarness`, `netStack`, `tft28Canary`, `tft28VoteCanary`, `tft28PreviewEnroll`, `podHeaderCopies`, `learnRoadmap`, `lot0sWording` : **tous verts**. `tsc --noEmit` propre.
- Lancement des 39 fichiers de tests touchant le TFT : 471 tests, 469 réussis, **2 échecs `boundedSsl` préexistants** (cœurs Renesas 1.5.3/1.6.0), inchangés.
- Remarque d'outillage : les harnais C++ plantent (accès mémoire) quand ils sont lancés depuis Git Bash (mélange de runtimes) ; ils passent depuis PowerShell/cmd. Sans lien avec ces lots.

## Ce que ces lots ne prouvent pas
Aucun essai sur carte du firmware TFT modifié ; aucun essai de vote des familles `eink27bw`, `tft18`, `r4eink27`, `r4multiscreen`, `r4tft18` (listées « capables » mais jamais vues voter) ; coût Redis réel de l'archive non mesuré en production.

## Question ouverte
Faut-il retirer de `VOTE_V2_FIRMWARE` les familles jamais essayées en réel (elles gonflent `poolSize` si elles échouent) ou les garder en attendant leurs essais ? Recommandation de l'auteur : les garder tant qu'aucun appareil de ces familles n'est apparié (aucun effet), les essayer dès qu'un exemplaire est disponible.
