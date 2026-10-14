# Lot 8B-2E V4 — LOT8B2E-R4-TFT28-VOTE-V4-CANARY (13/10/2026)

**Préparation d'un canari matériel de vote du UNO R4 WiFi + TFT 2,8″ garantissant AU PLUS UNE tentative de vote, même après reset ou coupure pendant le POST.** Hôte et compilation seulement : **aucun flash, aucun vote, aucun déploiement**, aucune modification du serveur, de Redis, de Neon, du protocole ni de l'OTA. Base : `8c35bf0` (V3-FIX1), branche `claude/r4-tft28-vote-audit-8b2e`, commit séparé. Les drapeaux suivis par Git restent à `0` (`POD_CANARY`, `POD_RENDER_V1`, `POD_VOTE_V1`, **`POD_VOTE_CANARY`**).

## 1. Exigences de l'audit et réponse

| # | Exigence | Réalisation |
|---|---|---|
| 1 | Mode distinct `POD_VOTE_CANARY`, désactivé dans le commit | `#ifndef POD_VOTE_CANARY / #define POD_VOTE_CANARY 0`. Exige `POD_CANARY = 0` et `POD_VOTE_V1 = 0` (`#error` sinon). Test : jamais `1` dans le dépôt |
| 2 | Backend isolé uniquement | `SERVER_HOST` = `POD_VOTE_BACKEND_HOST` (obligatoire, `#error` si absent) ; la **porte de vote refuse** l'hôte `proof-of-draw.vercel.app` (journal « hote = PRODUCTION », aucune requête). Hôte, identifiant et hash viennent d'un en-tête LOCAL `pod_vote_pins.h` (ignoré par git, modèle `pod_vote_pins.h.example`) : rien de sensible sur la ligne de commande |
| 3 | Épinglage exact : candidateId, profil `tft28`, taille, hash | `votePinMatches` (id ∧ écran `tft28` ∧ 153 600 ∧ hash) ; `static_assert` : hash = 64 caractères, id = 8 à 64. Contrôlé **trois fois** : (a) identifiant annoncé par le pull (aucune requête sinon), (b) métadonnées de `validate-candidate` (aucune lecture sinon), (c) hash **recalculé** sur les octets lus (divergence ⇒ abstention définitive + arrêt). Toute divergence ⇒ abstention **sans POST** |
| 4 | Verrou persistant EEPROM | § 2 |
| 5 | Tests de coupures et états du verrou | § 4 |
| 6 | Mesures sur carte | instrument + protocole § 5 et § 7 (à exécuter par le porteur) |
| 7 | Arrêt après l'unique issue ; aucun affichage / ACK / tactile / animation / seconde tentative | § 3 |
| 8 | `g_voteScratch` retiré **seulement** du build de vote, avec preuve | § 6 |
| 9 | V2 seulement, aucune voie v1 | `POD_VOTE_V1 = 0` exigé par `#error` ; un candidat v1 est une abstention comptée |
| 10 | Production inchangée | § 4 (identité du texte) et § 5 (tailles) |

## 2. Le verrou persistant

**Emplacement** : deux enregistrements de 16 o dans **deux blocs de 1 Ko distincts** de la flash de données (octets **5120** et **6144** de l'EEPROM, blocs 5 et 6), loin des clés (bloc 0). Le pilote de l'EEPROM réécrit le bloc entier à chaque écriture : une coupure ne peut donc détruire que l'un des deux emplacements.
**Format** (`VoteLockRec`) : `magic 'VLK1'` (4) ∣ `version 1` ∣ `état` (`ATTEMPTED 0x5A` / `COMPLETED 0xC3`) ∣ `issue` ∣ `séquence` ∣ `empreinte de l'épinglage` (FNV-1a de id∣tft28∣153600∣hash, pour le diagnostic) ∣ `CRC-32 IEEE` (4). Octet vierge = `0xFF`.
**Règle de lecture (échec fermé)** : le verrou est **LIBRE** si et seulement si les **deux** emplacements sont **entièrement vierges**. **Tout autre contenu** — enregistrement valide, corrompu, tronqué, version inconnue, magic faux, état inconnu, CRC faux, **un seul octet** non vierge, un seul emplacement — est **PRIS**. EEPROM de moins de 7 168 octets ⇒ **INDISPONIBLE** (aucun vote).
**Séquence d'une tentative** (`votePhasePost`) :
1. corps du vote construit et contrôlé (longueur exacte) ;
2. `voteLockCommitAttempt()` : contrôle LIBRE ⇒ écriture de `ATTEMPTED` dans **A** puis **relecture comparée** (`put` du cœur ne dit rien si la page de 1 Ko ne peut pas être allouée : seule la relecture prouve) ⇒ écriture dans **B** puis relecture comparée ;
3. **seulement si les deux sont prouvés** : `g_vcAttempted = true` puis `httpCall(POST)` (la connexion n'est ouverte qu'à cet instant) ; sinon **AUCUN POST** (`NOT_SENT`) ;
4. issue classée (`voteFinish`) puis `voteLockRecordOutcome` : `COMPLETED` + code d'issue dans **A** seulement (meilleur effort : une coupure ici laisse B = `ATTEMPTED` valide, donc le verrou reste pris) ;
5. arrêt définitif.
**Aucun effacement automatique.** Remise à zéro manuelle : `consensus-pod/examples/VoteLockErase` (compilé sur les deux cœurs, « NE PAS DÉPLOYER ») : n'efface que les deux blocs, **seulement** si l'opérateur tape exactement `ERASE-VOTE-LOCK` dans le moniteur série.
**Au démarrage** : verrou PRIS ou EEPROM indisponible ⇒ `setup()` s'arrête **avant le Wi-Fi** : aucun réseau, jamais.

## 3. Comportement du canari

- `loop()` délègue à `voteCanaryLoop()` : enregistrement, pull (candidat seulement), validation. **Ni toucher, ni animation, ni banc d'essai, ni observation, ni ACK, ni `restoreLastFrame`** ; `doPull` ignore frame, animation et banc d'essai (le pull ne sert qu'à découvrir le candidat). **Correction V4-FIX1** : la version initiale de ce lot affirmait à tort « aucun affichage » alors que `setup()` appelait encore `tft.begin()`, `ts.begin()`, `initSD()` et `tftStatus()`, et que `doRegister()` dessinait ses états. Désormais **rien n'est dessiné ni initialisé** : voir `docs/LOT_8B2E_R4_TFT28_VOTE_V4_FIX1_2026_10_14.md`.
- Une **abstention** (pin, v1, VoteWork non allouable, lecture impossible) compte un passage ; **trois passages sans tentative arrêtent** le canari. Une abstention **définitive** (contenu dont le hash ≠ hash épinglé) l'arrête aussitôt. La tentative effectuée l'arrête quel que soit le résultat (`ACCEPTED`, refus, `SENT_UNKNOWN`…).
- Arrêt = `g_vcHalted` : la boucle n'a plus que `delay(1000)`. Après un reset, le verrou PRIS arrête le canari au démarrage.
- Instrument de pile principale (peinture 0x5A + marqueur « VOTE ») et de tas (libre, plus grand bloc par dichotomie malloc/free) ; marge < 128 o ou marqueur détruit ⇒ **verrou silencieux** (aucun vote après).

## 4. Preuves hôte (`tests/tft28VoteCanary.test.ts` : 17 tests, aucun ignoré — pré-vol de toolchain explicite)

**Production inchangée** : avec `POD_VOTE_CANARY = 0`, le texte du sketch (conditionnelles `#if POD_VOTE_CANARY` évaluées) est **identique** à V3-FIX1 (`firmware-backups/2026-10-13_avant-vote-v4-canary/`).
**Scénarios** (sketch complet compilé avec `-DPOD_VOTE_CANARY=1`, vraie crypto, EEPROM simulée qui **survit** aux redémarrages) :

| Scénario | Résultat vérifié |
|---|---|
| succès | 1 validate, 1 lecture, 1 POST conforme et **signature valide** ; B = `ATTEMPTED` valide (CRC recalculé **indépendamment** en TypeScript), A = `COMPLETED`/ACCEPTED ; 3 écritures de page exactement ; canari arrêté ; 9 mesures de pile et de tas journalisées |
| reject (422), refus (409), signature refusée (403) | 1 POST, verrou pris, issue enregistrée, arrêt |
| timeout, réponse perdue, écriture partielle (`-7`) | `SENT_UNKNOWN` enregistré, 1 POST, arrêt |
| reset **avant** le POST (coupure à la 1re écriture) | 0 POST au 1er démarrage, **exactement 1** au second (verrou resté vierge) |
| reset **pendant** le POST | 1 POST, verrou déjà prouvé ; au redémarrage : arrêt avant le Wi-Fi, **aucun** second POST, aucune requête |
| allocation de `VoteWork` impossible | aucune lecture, passage compté, la passe suivante vote une fois |
| EEPROM trop courte / écriture sans effet (page non allouable) | arrêt au démarrage sans réseau / relecture échoue ⇒ **aucun POST**, arrêt après 3 passages |
| verrou : vierge | vote permis, une fois |
| verrou : A seul, B seul, les deux, COMPLETED, octets aléatoires A ou B, **tronqué** (10 o), **un seul octet**, **version 2** (CRC valide), magic faux, état inconnu, CRC faux | **PRIS** : arrêt au démarrage, 0 requête, 0 POST |
| verrou pris **après** le démarrage | la porte de vote se ferme : 0 requête |
| candidat réannoncé après le vote | arrêt : 1 validate, 1 lecture, 1 POST au total |
| candidat différent (pull) / identifiant, écran, taille ou hash annoncés divergents / candidat OLED / v1 | abstention, **0 lecture**, 0 POST, verrou intact, arrêt après 3 passages |
| contenu altéré (hash annoncé = épinglé) | 1 lecture, hash recalculé ≠ épinglé ⇒ abstention définitive, 0 POST |
| marqueur de pile détruit | verrou silencieux avant toute lecture, 0 POST |
| hôte de production | porte fermée, 0 requête |

**Matrice de coupures** : coupure de courant à **chaque octet (0 à 16) de chacune des 3 écritures** du verrou, **deux modes de déchirure** (reste inchangé / reste mis à zéro) = **102 exécutions**, puis redémarrage et jusqu'à 4 passes. Invariants vérifiés sur toutes : jamais plus d'un POST au total ; un POST parti ⇒ aucun second au redémarrage ; **aucun POST avant que le verrou soit prouvé** (coupures des écritures 1 et 2 ⇒ 0 POST au premier démarrage) ; après le POST, B porte `ATTEMPTED` valide ; un vote au redémarrage n'a lieu que si les deux emplacements étaient **entièrement vierges**.
**Mutants exécutés (21) et statiques (8), tous refusés par la vérification visée** : persistance qui échoue sans empêcher le POST ; écriture non relue ; `ATTEMPTED` dans A seul ; **verrou écrit après le POST** ; verrou « pris » seulement par A / seulement si valide ; enregistrement corrompu traité comme vierge ; porte sans verrou ; démarrage qui ne s'arrête plus ; hôte de production accepté ; chacun des quatre éléments de l'épinglage supprimé ; candidat du pull non comparé ; pas d'arrêt après la tentative ; abstention définitive supprimée ; garde de pile supprimée ; issue non enregistrée ; allocation ignorée ; `g_voteScratch` réintroduit ; POST avant le verrou ; boucle qui appelle le toucher ; emplacements dans le même bloc ou dans le bloc 0 ; effacement automatique ; `restoreLastFrame` actif ; `doPull` qui traite les frames.

## 5. Mesures (cœurs 1.5.3 et 1.6.0 ; `docs/mesures/8B2E_V4_2026_10_13/`, mêmes résultats sur les deux cœurs)

| Build | Flash | RAM statique | Avertissements |
|---|---:|---:|---|
| production (V4 présent, drapeau 0) | 158 740 o | 21 532 o | identiques à V3-FIX1 |
| canari d'affichage (`POD_CANARY = 1`) | 149 704 o | 21 464 o | identiques à V3-FIX1 |
| **canari de vote** (`POD_VOTE_CANARY = 1`) | **134 264 o** (V4-FIX1 ; 145 708 o avant) | **15 824 o** (15 836 avant) | identiques à la production |

Production et canari d'affichage : **tailles identiques à V3-FIX1 à l'octet** (aucun octet de plus). Le build de vote est plus petit (chiffres corrigés par V4-FIX1 : 134 264 o de flash, 15 824 o de RAM statique). Cette différence N'EST PAS la preuve qu'aucun accès matériel n'est possible : la preuve est l'analyse de portée depuis `setup()` / `loop()` (V4-FIX1). `nm` : `g_voteScratch` = 0x1280 = **4 736 o** présent en production, **absent** du build de vote.
**Pile principale (analyse statique, build de vote 1.6.0 ; pile de 1 024 o ; `loop` 112 o, `setup` 232 o)** : `doValidateV2` marge **568 o** ; phases de lecture / signature / POST : 672 / 648 / 608 o ; `voteFinish` 712 o ; `httpCall` 664 o ; décodage 736 o ; `doRegister` depuis `setup` 312 o. ⚠ Statique : ni interruptions, ni appels indirects ; la mesure réelle est celle de l'instrument sur carte (§ 7).

## 6. `g_voteScratch` : retiré uniquement du build de vote — preuve
- **Pourquoi la production le garde** (V3, inchangé) : le serveur propose le candidat courant à tout appareil, sans filtrer par écran ; un TFT peut recevoir un candidat `oled096` (1 024 o) ou `eink29bwr` (4 736 o) qui exige ce tampon (`PodFeeder::begin`).
- **Pourquoi le build de vote peut s'en passer** : l'épinglage impose `tft28` ET 153 600 o ; `PodFeeder::need_ = 0` pour `tft28`. Le contrôle est redoublé avant la lecture (`kind != POD_TFT28 || bytes != 153600` ⇒ aucune lecture).
- **Preuves par tests** : (1) scénarios candidat OLED / écran / taille / v1 : abstention, **0 lecture** ; (2) **défense en profondeur** : même avec l'épinglage d'écran ET le contrôle de profil supprimés, un candidat `oled096` n'est **pas votable** (tampon nul ⇒ `PodFeeder::begin` refuse ⇒ aucun POST, verrou intact) ; (3) mutant « `g_voteScratch` réintroduit » refusé par les règles statiques ; (4) `nm` des deux ELF.
- **Gain** : 4 736 o de RAM statique (tas +4 736 o) **dans le build de vote seulement**.

## 7. Protocole du futur essai matériel (par le porteur, après audit GPT/Codex de ce commit)

**Pré-conditions** : (0) **PRÉCONDITION NON LOGICIELLE — isolation du backend prouvée HORS du firmware** : un nom d'hôte différent ne prouve RIEN. Avant tout flash, le porteur doit vérifier et consigner (captures de console) que le domaine de prévisualisation utilise un **Redis dédié** (variables d'environnement du déploiement : URL / jeton Upstash propres, distincts de la production ; aucune variable partagée entre environnements), que ce backend a ses propres Neon / secrets si utilisés, que le **candidat épinglé n'existe QUE sur ce backend** (introuvable côté production) et que le bloc miné par le vote y restera. Le firmware ne peut ni vérifier ni remplacer cette preuve ; (a) audit accepté ; (b) transport modifié revalidé sur carte avec le **canari d'affichage** : une frame personnelle **et** une animation (le correctif `Conn::request` de V3 et `-7` de FIX1 touchent tous les téléchargements) ; (c) **backend isolé** disponible (déploiement de prévisualisation, Redis dédié ; modes d'éligibilité / comité / reçus fixés ; un seul appareil actif ⇒ quorum 1 ⇒ **le vote minera un bloc dans CE backend**) ; (d) candidat `tft28` connu (153 600 o), son identifiant et son SHA-256 notés, **relevés auprès du backend isolé** (réponse de `validate-candidate` : `candidate.candidateId`, `candidate.v2.hash`) ; (e) carte appairée, clés présentes (démarrage normal déjà fait) ; (f) binaire de production (`stable`) conservé pour le retour arrière.
1. **Verrou vierge** : flasher `VoteLockErase`, relever « A vierge, B vierge » (sinon taper `ERASE-VOTE-LOCK`), retirer l'outil.
2. Créer `arduino_uno_r4/pod_uno_r4/pod_vote_pins.h` (copie de `.example`) : hôte isolé, identifiant, hash. Compiler **localement** (jamais commité) :
   `arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi --build-property "compiler.cpp.extra_flags=-DPOD_VOTE_CANARY=1" <dossier pod_uno_r4>` (`secrets.h` local). `POD_CANARY` et `POD_RENDER_V1` restent à 0.
3. **Démarrage sans candidat** : lignes attendues, dans l'ordre : `[VOTE-CANARY] BUILD …` (hôte, candidat épinglé), `boot : pile principale … (marge …)`, `verrou EEPROM au demarrage : LIBRE`, auto-test Ed25519 OK, `apres auto-test Ed25519 : …`, register, pulls sans `validate-candidate`.
4. **Soumettre le candidat épinglé** au backend isolé. Au pull suivant : `validate-candidate`, lecture (`[HTTP GET] /api/candidate-frame -> 200`), `avant VoteWork`, `apres VoteWork`, `apres lecture du candidat`, `apres signature`, `avant persistance ATTEMPTED`, `apres persistance ATTEMPTED (verrou verifie)` — chaque ligne donne **pile principale utilisée / marge** et **tas libre / plus grand bloc** —, un seul `POST /api/validation-result`, `issue du vote : …`, `apres POST et classement`, `fin du vote`, `ARRET DEFINITIF : tentative unique effectuee`.
5. **Critères** : marge de pile ≥ 128 o à chaque ligne (arrêt automatique sinon), objectif ≥ 256 o ; plus grand bloc libre cohérent avec la mémoire attendue (comparer avant/après `VoteWork`, lecture, signature, persistance, POST) ; **une seule** ligne `validation-result` ; côté serveur isolé : un seul vote v2, signature valide, `votes=1/1`, bloc miné dans ce backend.
6. **Test du reset** : couper l'alimentation après l'arrêt, rallumer : `verrou EEPROM au demarrage : PRIS`, `ARRET DEFINITIF`, **aucune** requête réseau, aucun Wi-Fi.
7. **Arrêts immédiats** : marge < 128 o ; reset imprévu avant l'arrêt ; plus d'un `validation-result` ; hôte ≠ backend isolé ; ligne « hote = PRODUCTION » (la porte a fonctionné : ne pas insister) ; tout affichage, ACK ou geste.
8. Archiver le journal brut, restaurer le binaire stable, réarmer le verrou **manuellement** avant tout nouvel essai.

## 8. Défaut connu, hors périmètre — lot séparé `TFT28-ACK-STATE-FIX1` (à réaliser AVANT l'intégration finale)
En **production**, `doFetchFrame` ignore le résultat de l'ACK (`ackFrame(frameId);` en fin de fonction) : si l'ACK échoue (par exemple écriture partielle, `-7`), l'image est affichée et considérée comme acquittée en local alors que le serveur ne l'a peut-être pas enregistrée (journal `[ACK] … -> FAIL` seulement). Seul le canari d'affichage fait décider l'ACK (`doFetchTailCanary`). **Non corrigé ici** (le build de vote n'a ni ACK ni affichage). Le lot `TFT28-ACK-STATE-FIX1` devra : faire décider l'ACK du succès en production, ne marquer `lastFrameId` et les métadonnées SD qu'après un ACK 200, et ajouter les scénarios hôte correspondants.

## 9. Limites
1. Aucune mesure sur carte : le verrou n'a jamais écrit la flash réelle ; le comportement exact de `EEPROM.put` (page de 1 Ko allouée au tas, effacement/programmation) est celui lu dans le cœur 1.6.0 — la relecture vérifiée couvre l'échec d'allocation silencieux ; une déchirure d'écriture est modélisée octet par octet, pas électriquement.
2. Un verrou PRIS à la suite d'une coupure pendant le **premier** `put` (A déchiré) interdit le vote tant que l'opérateur ne l'a pas effacé : choix délibéré (échec fermé).
3. Le moniteur de pile est un instrument de mesure : son propre cadre (≈ 40 o) est inclus dans les marges (pessimiste).
4. Le build de vote n'initialise ni écran, ni tactile, ni carte SD (V4-FIX1) : le TFT reste tel qu'à la mise sous tension ; seules la liaison série et le Wi-Fi sont utilisés.
5. `FIRMWARE_VERSION` inchangé ; le canari de vote s'annonce comme `r4tft28-2.5` au backend isolé.
6. Le correctif `Conn::request` (V3 / FIX1) touche aussi le chemin d'affichage : à revalider au prochain canari d'affichage (voir pré-condition b).

## 10. Toolchain et commandes (archivées : `docs/mesures/8B2E_V3_2026_10_13/TOOLCHAIN.txt`, inchangée)
g++ 14.2.0 (WinLibs UCRT, `CXX`, `PATH` avec son `bin`), Crypto 0.4.0, ArduinoJson 7.4.3, arduino-cli de l'IDE 2.x, cœurs `renesas_uno` 1.5.3 et 1.6.0 (répertoires dédiés), `arm-none-eabi-gcc` 7-2017q4. Tests : `node --import tsx --test tests/tft28VoteCanary.test.ts` ; suite : `npm test`. Le test « V4 — PRÉ-VOL » échoue explicitement (version de g++ < 11 ou Crypto non compilable) au lieu d'ignorer les scénarios.

## 11. Suite globale (même machine, mêmes outils : g++ 14.2 WinLibs, `CXX`, Crypto 0.4.0, ArduinoJson 7.4.3)

| | tests | réussis | échecs |
|---|---:|---:|---:|
| V3-FIX1 (`8c35bf0`) | 830 | 828 | 2 |
| V4 (HEAD de ce lot) | 847 | 845 | 2 |

Différentiel : **+17 tests, 0 échec nouveau**. Les deux échecs sont **strictement identiques** à ceux de V3-FIX1 : `boundedSsl` « cœur Renesas 1.5.3 / 1.6.0 (VRAI code) » (préexistants, harnais hôte sous Windows, non masqués, non corrigés ici). **La suite n'est donc pas verte.** `tsc` et ESLint propres ; `git diff --check` propre. Tests existants adaptés (ils lisaient tout le texte du sketch) : `tft28VoteHarness` et `podHeaderCopies` lisent la vue « POD_VOTE_CANARY = 0 » (`voteCanaryOffView`, `tests/helpers/tft28Source.ts`) — la production, strictement identique à V3-FIX1.

## 12. Rollback
`git revert` du commit V4 : retour exact à `8c35bf0`. Aucun état persistant n'est modifié par ce commit (le verrou n'existe que sur une carte flashée avec le build de vote).

## 13. Suite
Audit GPT/Codex de ce commit ; revalidation du transport sur carte (canari d'affichage : frame personnelle + animation) ; backend isolé et candidat épinglé ; puis **un** essai selon le § 7 ; lot séparé `TFT28-ACK-STATE-FIX1` avant l'intégration ; gestes tactiles réconciliés séparément après la voie vote.
