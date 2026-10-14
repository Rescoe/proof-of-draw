# Lot 8B-2E V2 — LOT8B2E-R4-TFT28-VOTE-V2-SAFETY (13/10/2026)

Sécurisation de la **voie de vote** du UNO R4 WiFi + TFT 2,8″ **sur l'hôte**. Aucun vote réel, aucun flash, aucun déploiement. Base : `2399c73` (branche `claude/r4-tft28-vote-audit-8b2e`, worktree dédié, propre au départ ; la branche tactile n'est pas fusionnée).
Ce lot implémente **uniquement** les protections « V2 » du plan de l'audit (`docs/AUDIT_VOTE_R4_TFT28_ET_PLAN_CANARI_VOTE_2026_10_13.md` § 8). Le canari d'affichage (`POD_CANARY = 1`) reste sans vote.

## 1. Défauts traités

| Réf. audit | Défaut (avant V2) | Correctif (V2) |
|---|---|---|
| R-H2 | La voie **v1** (écho du score du serveur, signature de `score_server`, `snprintf` flottant de 384 o de pile) était atteignable. | `POD_VOTE_V1 = 0` (défaut, testé) : un candidat v1 produit **zéro lecture du candidat, zéro signature, zéro POST** ; `doValidateV1`, `signED25519` et ses chaînes sont **hors du binaire** (`#if POD_VOTE_V1`). |
| R-H1 | L'auto-test Ed25519 journalisait « ECHEC » sans rien bloquer ; `keysLoaded` n'était jamais vérifié ; aucune vérification de l'enregistrement. | **Porte** `voteGate()` : clés chargées ∧ auto-test Ed25519 du boot réussi (`g_edSelfTestOk`, posé une fois par `selfTestEd25519`, jamais refait par vote) ∧ `registered` ∧ `paired`. Une condition manque ⇒ **aucune requête du tout** (ni `validate-candidate`, ni lecture, ni signature, ni POST) + une ligne `[VOTE] porte FERMEE : <cause>`. |
| R-H3 | `netReadCandidate` décidait sur « nombre d'octets == annoncé » sans regarder le défaut collant du client TLS ni la complétude du lecteur. | Candidat accepté **seulement si** pile dédiée saine (garde/marge) ∧ `chk.ok` ∧ `rd.complete()` ∧ `client.fault() == 0` ; sinon `chk` remis à zéro (« lecture du candidat REFUSEE »), zéro signature, zéro POST. |
| R-H4 | Le POST ne distinguait pas « non exécuté » (-4), « exécuté mais rejeté localement » (-5) ni l'issue inconnue ; message faux (« 403 = signature, 422 = … ») ; ré-inscription sur une simple sous-chaîne ; `pendingCandidateId` effacé avant la lecture. | **`VoteOutcome`** typé (§ 2) ; journal honnête ; ré-inscription **uniquement** sur HTTP 403 **et** corps « Signature » ; `pendingCandidateId` n'est effacé **qu'après le classement** de l'issue (vérifié : encore posé quand le POST arrive chez le serveur) ; verrou RAM « dépensé » : aucune nouvelle tentative automatique après toute issue qui a pu partir. |
| R-H5 / D-V2 | Hash reçu ≠ hash annoncé ⇒ refus **signé** « hash » envoyé. | **Abstention locale** (« ABSTENTION (aucun vote signé, aucun POST) »), avant le verdict et la signature. |
| R-M1 | Cinq gestionnaires d'échec de la pile réseau (`httpCall`, `doFetchFrame`, `netReadCandidate`, clip du banc d'essai, `netGetBlockClipToSd`) journalisaient sur `GUARD` au lieu de s'arrêter. | Gestionnaire **commun** `netStackFailed(tag, arg, ni, tail)` : sur `GUARD`, `logfSafeStop()` **avant** tout journal, `String` ou allocation ; les autres erreurs (NOMEM, NESTED, MARGIN) restent fermées et décrites comme avant. Les cinq sites l'utilisent (test statique : 1 définition + 5 appels). |

Non traités ici (hors périmètre, volontairement) : R-B1 (découpage mémoire V3 / `VoteWork`), R-B3 (verrou EEPROM persistant), R-M2 (plafond de ré-inscription), R-M3 (RAM statique du vote), canari de vote V4.

## 2. Table des `VoteOutcome`

| Issue | Condition (`voteClassify(code, corps)`) | Requête partie ? | Effets | Candidat dépensé ? |
|---|---|---|---|---|
| `NOT_SENT` | porte fermée, lecture/signature impossible, abstention (hash), `httpCall` **-4** (pile dédiée indisponible), **-2** (connexion TLS impossible) | **non** | journal « vote NON envoyé » | non (une ré-annonce peut ré-essayer) |
| `SENT_UNKNOWN` | **-1** (réponse illisible), **-3** (corps incomplet), **-5** (exécuté, résultat rejeté localement : MARGIN), **HTTP ≥ 500** | **a pu partir** | journal « a PU atteindre le serveur, issue INDÉTERMINÉE » ; **aucune ré-inscription** | **oui** |
| `ACCEPTED` | **HTTP 200** | oui | `blockMined:true` ⇒ bloc miné | oui |
| `REFUSED_BY_SERVER` | autre 4xx/3xx (400, 403 sans « Signature », 409, 429, 302…) | oui | journal ; aucune ré-inscription | oui |
| `SIGNATURE_REFUSED` | **HTTP 403 ET** corps contenant « Signature » | oui | `registered = false` ⇒ ré-inscription **au tour de `loop()` suivant** (jamais dans `doValidate`) | oui |
| `HASH_REFUSED` | **HTTP 422** | oui | journal ; aucune ré-inscription | oui |

`GUARD` (garde écrasée) n'a pas d'issue : l'arrêt sûr silencieux ne rend jamais la main (le POST a pu partir, aucune issue n'est classée).

## 3. Preuves hôte (`tests/tft28VoteHarness.test.ts` + `consensus-pod/host/tft28_vote_harness.cpp`)

Le harnais exécute le **sketch de production complet** (réseau scripté, piles dédiées réelles, VRAIE bibliothèque Crypto : SHA-256 et Ed25519 ; calcul de référence indépendant en Node/TS). Nouveautés : arrêt sûr **observable** (l'entrée de la boucle `for (;;)` lève une exception ; la dernière ligne du journal et la longueur du journal sont comparées), crochet MARGIN, table `classify`, états de la porte, `pending_at_post`, verrou « dépensé ».

| # | Scénario exigé | Vérification |
|---|---|---|
| 1 | vote v2 nominal | `nominal` : 1 validate, 1 lecture, 1 POST ; hash et métriques == référence indépendante ; **signature Ed25519 vérifiée** ; ACCEPTED ; `pendingCandidateId` encore posé au moment du POST ; bloc miné ; refus signé « blank » conforme |
| 2 | clés absentes | `gateKeys` : 0 requête, « porte FERMEE » |
| 3 | auto-test en échec | `gateSelfTest` |
| 4 | non enregistré | `gateRegistered` |
| 5 | non appairé | `gatePaired` |
| 6 | candidat v1 | `v1` : 1 validate, 0 lecture, 0 POST |
| 7 | candidat tronqué (+ silence, défaut en route) | `incomplete` : 0 POST, lecture tentée, candidat oublié |
| 8 | taille exacte, `fault() != 0` | `faultSticky` : 0 POST, « REFUSEE » |
| 9 | taille exacte, lecteur incomplet | `readerIncomplete` : 0 POST, « INCOMPLET » |
| 10 | hash divergent | `altered` : **0 POST**, abstention, 1 lecture |
| 11 | POST non exécuté | `postNotExecuted` : NOT_SENT (-4), « NON envoyé », candidat **non** dépensé |
| 12 | POST possiblement exécuté | `postUnknown` : SENT_UNKNOWN (-5 via MARGIN, et 500), le serveur voit 1 POST, « a PU atteindre le serveur », jamais « non envoyé », candidat dépensé, aucune ré-inscription |
| 13 | accepté | `nominal` |
| 14 | refus serveur | `serverRefusals` : REFUSED_BY_SERVER (409) |
| 15 | refus de signature | `serverRefusals` : SIGNATURE_REFUSED (403), 0 ré-inscription dans `doValidate`, 1 au tour de `loop()` |
| 16 | refus de hash | `serverRefusals` : HASH_REFUSED (422), 0 ré-inscription |
| 17 | GUARD | `guard` : arrêt sûr (lecture **et** POST), **aucune ligne après la cause**, jamais « pile réseau dédiée » journalisé |
| 18 | pas de répétition après SENT_UNKNOWN | `noRepeat` : ré-annonce ⇒ 1/1/1 (validate/lecture/POST) au total ; même avec un serveur sans mémoire ; après NOT_SENT une nouvelle tentative **est** permise |
| — | table des issues | `classify` : 19 lignes (dont « Signature » avec un autre code ⇒ jamais SIGNATURE_REFUSED) |
| S14 | invariant sur 27 scénarios | un vote ne produit ni affichage, ni écriture/ouverture de carte, ni ACK, ni téléchargement d'image, ni observation |

Vérifications statiques (`staticViolations`) : `netStackFailed` (arrêt sûr **avant** `logf`, sans allocation), exactement 5 appels + 1 définition, un seul message « pile réseau dédiée », `POD_VOTE_V1 = 0`, vue sans reste de la voie v1 (`doValidateV1`, `signED25519`, `entropy`, formatage `%d.%03d`), `g_edSelfTestOk = ok`, six issues, porte avant `/api/validate-candidate`.

## 4. Mutants (34 exécutés + 7 statiques, tous REFUSÉS par la vérification visée)

Exécutés : abstention sur hash supprimée ; `fault` ignoré ; `complete` ignoré ; les deux ignorés ; la porte ignore chacune de ses **quatre** conditions ; la porte n'est plus appelée ; **v1 réactivée** (`POD_VOTE_V1 = 1`) ; **SENT_UNKNOWN → NOT_SENT** ; -4 plus NOT_SENT ; 5xx plus indéterminé ; ré-inscription sur la seule sous-chaîne ; verrou « dépensé » non posé / consulté nulle part / consulté seulement après la requête ; NOT_SENT dépense aussi ; `pendingCandidateId` effacé avant le classement / jamais effacé ; **journal avant l'arrêt sûr** ; arrêt sûr supprimé ; `httpCall` et `netReadCandidate` qui contournent le gestionnaire commun ; lecture incomplète sans effet ; signature impossible sans effet ; verdict inversé ; métrique permutée ; ré-inscription dans `doValidate` ; plus de ré-inscription sur 403 ; SENT_UNKNOWN journalisé « non envoyé » ; ACK, écran, carte SD pendant un vote.
Statiques : les sites `doFetchFrame`, banc d'essai et `netGetBlockClipToSd` qui reprennent leur journal propre ; gestionnaire commun qui journalise avant l'arrêt ; `POD_VOTE_V1 = 1` ; auto-test muet ; `doValidateV1` hors de `#if POD_VOTE_V1`.

## 5. Mesures (cœurs Renesas 1.5.3 et 1.6.0, arduino-cli, `--warnings all`, `secrets.h.example` ; `docs/mesures/8B2E_V2_2026_10_13/`)

| Build | Flash | RAM statique | vs `2399c73` |
|---|---:|---:|---|
| production V2 (1.5.3 = 1.6.0) | 158 004 o | 21 532 o | flash +368 o ; RAM **+64 o** (verrou RAM du candidat, 65 o + 1 o) |
| production `2399c73` (1.6.0) | 157 636 o | 21 468 o | — |
| canari V2 (1.5.3 = 1.6.0) | 149 592 o | 21 464 o | flash −128 o (gestionnaire commun) ; RAM **identique** |
| canari `2399c73` (1.6.0) | 149 720 o | 21 464 o | — |

Avertissements du projet **identiques** (17 types, tous préexistants : bibliothèques tierces) entre V2 et la base, production et canari. **Pile principale (statique, `scripts/tft28-stack-report.js`)** : `doValidateV2` cadre 352 o, chaîne 568 o, cumul depuis `loop` 872 o, **marge 152 o — identique à la base** (V2 n'aggrave pas la marge de vote). Une première version de V2 (retour par référence `bool& mined` + journal d'issue dans `doValidateV2`) donnait 144 o ; le classement et le journal d'issue sont donc dans une fonction `noinline` séparée (`voteFinish`) : le cadre de la voie de vote retrouve 352 o. ⚠ Analyse **statique** (ni interruptions, ni appels indirects) : la marge réelle reste à mesurer au futur canari de vote ; l'objectif de 256 o est le lot V3.

## 6. Limites restantes
1. **Aucun vote réel, rien sur carte** : tout est hôte/compilation. Les piles dédiées sont simulées par la version hôte de `PodNet`/`PodEd` (garde et marge réelles, mais pas d'interruptions).
2. Le verrou « dépensé » est en **RAM** : perdu à un reset (un second vote reste possible après redémarrage si le serveur ne répond pas `alreadyVoted`). Le verrou EEPROM « un seul vote » est le lot **V4**.
3. La marge principale du vote reste **152 o** (≥ 128, < 256 visés) : lot **V3**.
4. `NOT_SENT` après une signature réussie permet une nouvelle tentative à la ré-annonce du candidat (pas de boucle serrée : une tentative par pull) ; plafond de ré-inscription (R-M2) non implémenté.
5. Le canari d'affichage bénéficie aussi du gestionnaire commun (GUARD ⇒ arrêt sûr silencieux sur les cinq sites) : comportement strictement plus sûr, mais **différent** du canari validé sur carte (flash −128 o) ; à re-valider au prochain canari matériel.
6. `FIRMWARE_VERSION` inchangé (`r4tft28-2.5`) : aucun firmware V2 n'est annoncé au serveur tant qu'il n'est pas flashé.
7. Deux échecs historiques `boundedSsl` (cœurs Renesas 1.5.3/1.6.0, harnais hôte sous Windows) : voir § 7.

## 7. Suite globale (même machine, même environnement : g++ WinLibs 14.2, `CXX`, Crypto 0.4.0, ArduinoJson 7.4.3)

| | tests | réussis | échecs |
|---|---:|---:|---:|
| `2399c73` (base) | 803 | 801 | 2 |
| V2 (HEAD de ce lot) | 822 | 820 | 2 |

Différentiel : **+19 tests, 0 échec nouveau**. Les deux échecs sont **strictement identiques** sur la base et sur V2 et ne viennent pas de ce lot : `boundedSsl` « cœur Renesas 1.5.3 (VRAI code) » et « 1.6.0 (VRAI code) » (harnais hôte compilé contre les sources WiFiS3 tierces, sortie `0xC0000374` = corruption de tas sous Windows). **La suite n'est donc pas verte** ; ils ne sont pas masqués. `npx tsc --noEmit` propre ; ESLint sur les quatre fichiers de test modifiés : 0 avertissement sur V2 comme sur la base ; `git diff --check` propre.
Tests de texte adaptés (ils épinglaient l'ancien code, pas un comportement) : `netStack` (gestionnaire commun, `doValidateV2` retourne `VoteOutcome`), `tft28Canary` (liste des fonctions d'origine modifiables, identité de `httpCall` et `doFetchFrame` au gestionnaire commun près), `tft28Host` (ancre de la région du décodeur).

## 8. Rollback
`git revert` du commit V2 : retour exact à `2399c73` (sketch, harnais et tests). Aucun état persistant (EEPROM, serveur) n'est modifié par ce lot ; aucune migration.

## 9. Prochaine étape — V3
Découpage de `doValidateV2` en phases `noinline` (`votePhaseRead` / `votePhaseSign` / `votePhasePost`) avec une structure `VoteWork` allouée au tas (`PodCheck`, `sig[64]`), cible **≥ 256 o** de marge principale (esquisse mesurée : 248 – 312 o), rapport de pile à jour ; puis V4 (canari de vote : épinglage du hash, verrou EEPROM, arrêt après un vote, instrument de pile) — après audit GPT de V2 et résultat matériel des gestes tactiles.
