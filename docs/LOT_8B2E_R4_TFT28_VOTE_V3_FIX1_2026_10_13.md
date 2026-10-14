# Lot 8B-2E V3-FIX1 — écriture PARTIELLE de la requête (13/10/2026)

Correctif minimal demandé par l'audit GPT/Codex de V3. **Hôte et compilation seulement : aucun vote, aucun flash, aucun déploiement.** Base : `58de797` (V3), branche `claude/r4-tft28-vote-audit-8b2e`, commit séparé.

## Défaut
`Conn::request` ignorait la valeur de retour de `client.print(req)`. Si `print` écrit moins d'octets que `req.length()` (connexion ouverte, des octets ont PU partir), la fonction lisait quand même la réponse et pouvait annoncer un succès, ou — pour un vote — laisser croire à une requête non émise.

## Correctif
```
const size_t sent = client.print(req);
if (sent != (size_t)req.length()) return -7;   // écriture PARTIELLE : connexion ouverte, des octets ont PU partir
```
- **`-7`** = écriture partielle. Distinct de `-6` (requête non construite : RIEN n'est émis, aucune connexion) et de `-2` (connexion impossible).
- `voteClassify` : `-7` ⇒ **`SENT_UNKNOWN`**, jamais `NOT_SENT` (la branche `code < 0` le couvre ; commentaire explicite ; la table de classement a une ligne `-7`).
- Conséquences d'un `SENT_UNKNOWN` (déjà garanties par V2/V3) : candidat DÉPENSÉ, journal « a PU atteindre le serveur », aucune ré-inscription, aucune répétition automatique.

## Preuves hôte (`tests/tft28VoteHarness.test.ts`, 32 tests, aucun ignoré)
| Scénario | Attendu | Observé |
|---|---|---|
| `partial-write` (POST du vote, `print` rend 9 octets de moins, le « serveur » reçoit la requête) | `SENT_UNKNOWN (-7)`, 1 POST vu par le serveur, candidat dépensé, aucun « Vote OK » / « BLOC MINÉ » / « non envoyé », aucune ré-inscription | conforme |
| `double-partial` (le pull ré-annonce le candidat) | aucune répétition : 1 validate, 1 lecture, 1 POST au total | conforme |
| `frame-nominal` (sensibilité) | image affichée (153 600 o sur le bus), 1 ACK, œuvre remplacée | conforme |
| `frame-partial` (requête `pull-frame` partielle) | **aucun affichage, aucun ACK**, œuvre courante inchangée, « image incomplète — pas d'ACK » | conforme |
| `ack-partial` (requête d'ACK partielle) | ACK journalisé **FAIL**, jamais OK | conforme (voir observation) |

**Chemins clip et canari — vérification statique** : les 4 appelants `c.request(` (image `pull-frame`, candidat, clip du banc d'essai, clip historique) n'agissent que sur HTTP 200 (donc jamais sur `-7`) ; le canari fait décider l'ACK (`const bool acked = ackFrame(frameId)` / `if (!acked)`). Les clips ne sont pas rejoués dynamiquement ici : même motif `code == 200`, vérifié par expression régulière sur chaque appelant.

**Mutants (2 nouveaux, 45 au total + 7 statiques, tous refusés)** : contrôle `-7` supprimé (⇒ `partialWrite` et `connPaths` échouent : le vote serait « ACCEPTED » malgré l'écriture partielle) ; `-7` classé `NOT_SENT` (⇒ `classify` et `partialWrite`).

## Observation (non modifiée, hors périmètre de ce correctif)
En **production**, `doFetchFrame` ignore le résultat de l'ACK (`ackFrame(frameId);` ligne de fin) : après `ack-partial`, l'image est affichée et considérée comme acquittée localement alors que l'ACK a pu ne pas être pris en compte (journal `[ACK] … -> FAIL`). C'est le comportement existant avant ce lot ; seul le **canari** fait décider l'ACK. À traiter dans un lot d'affichage séparé, pas dans la voie vote.

## Mesures (cœurs 1.5.3 et 1.6.0, `docs/mesures/8B2E_V3_FIX1_2026_10_13/`)
| Build | Flash | RAM statique | vs V3 |
|---|---:|---:|---|
| production (1.5.3 = 1.6.0) | 158 740 o | 21 532 o | flash +16 o, RAM identique |
| canari (1.5.3 = 1.6.0) | 149 704 o | 21 464 o | flash +16 o, RAM identique |

Avertissements identiques à V3 (production et canari, deux cœurs). **Pile principale (statique)** : inchangée — `doValidateV2` 408 o de marge, phases 448 – 504 o, `voteFinish` 544 o.

## Limites
Le canari d'affichage reçoit aussi ce contrôle (transport commun) : comportement nominal identique, échec plus sûr ; à revalider au prochain canari matériel d'affichage. Marge de pile toujours **statique**.

## Suite globale (même machine, mêmes outils : g++ 14.2 WinLibs, `CXX`, Crypto 0.4.0, ArduinoJson 7.4.3)

| | tests | réussis | échecs |
|---|---:|---:|---:|
| V3 (`58de797`) | 828 | 826 | 2 |
| V3-FIX1 (HEAD de ce lot) | 830 | 828 | 2 |

Différentiel : **+2 tests, 0 échec nouveau**. Les deux échecs sont **strictement identiques** à ceux de V3 : `boundedSsl` « cœur Renesas 1.5.3 / 1.6.0 (VRAI code) » (préexistants, harnais hôte sous Windows, non masqués, non corrigés ici). La suite n'est donc pas verte. `tsc` et ESLint propres, `git diff --check` propre.

## Rollback
`git revert` du commit : retour exact à `58de797`.

## Suite — V4 (après audit)
Build de vote distinct, strictement épinglé sur un candidat `tft28` précis (identifiant, écran, taille, hash) ; backend isolé obligatoire ; verrou EEPROM persistant versionné avec intégrité, écrit AVANT toute tentative de POST (au plus une tentative, même après reset) ; `g_voteScratch` supprimé dans ce seul build ; peinture et mesure réelle de la pile principale ; mesures du tas avant/après `VoteWork`, lecture, signature et POST ; arrêt définitif après l'unique résultat ; aucun affichage, ACK, geste tactile ni modification serveur ; aucun flash avant nouvel audit.
