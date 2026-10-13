# LOT V1 (+ V1-FIX1) — harnais de vote de bout en bout du R4 + TFT 2,8″ (état de référence, sans correction) — 13 octobre 2026

**Base :** `a83b5d4` (branche `claude/r4-tft28-vote-audit-8b2e`, firmware identique à `0059f74`) ; V1 = `9977183`, **V1-FIX1** = audit GPT de V1. **Périmètre :** tests, maquettes hôte et documentation SEULEMENT. **Aucun** changement du firmware, du serveur, du protocole, de Redis, de Neon, de l'OTA, du polling ; aucun vote réel, aucun flash, aucun backend. Les branches du canari animation et des gestes tactiles ne sont pas touchées.

## 1. Ce que le lot ajoute
| Fichier | Rôle |
|---|---|
| `consensus-pod/host/tft28_vote_harness.cpp` | exécute le sketch TFT COMPLET (production : le vote existe) sur l'hôte : réseau scripté, piles dédiées réelles (PodNet, PodEd), SD et TFT simulés, **vraie bibliothèque Crypto** (SHA-256 et Ed25519), vrai `podCheckStream` / métriques sur 153 600 octets. 20 scénarios. Il imprime des FAITS ; il ne juge pas. |
| `tests/tft28VoteHarness.test.ts` | rend les verdicts avec un calcul **indépendant** : contenu et SHA-256 (Node), métriques (`lib/podMetrics.ts`), message signé (`lib/podVote.ts`), signature (`lib/ed25519.ts`, OpenSSL). 5 tests, dont 11 mutants. |
| `consensus-pod/host/tft28/tft28_mock.h` | les maquettes factices d'Ed25519 / SHA-256 sont désactivées par `-DPOD_HOST_REAL_CRYPTO=1` (le harnais de vote seulement ; les autres harnais gardent leurs maquettes). |

## 2. Résultats sur le code ACTUEL
### 2.1 Tenu (verrouillé par les mutants)
Candidat valide : exactement **1** `validate`, **1** lecture, **1** POST ; `rawHash`, `e`, `t`, `r` identiques à la référence TypeScript ; verdict `accept` ; **signature Ed25519 valide** pour le message `pod-vote-v2|…` ; candidat oublié ; bloc miné seulement si le serveur le dit. Image uniforme : refus signé `blank`. Lecture tronquée / silencieuse / défaut TLS à mi-chemin : **aucun POST**. Signature impossible : **aucun POST**. Écran inconnu : ni lecture ni vote. 403 « Signature » : aucune ré-inscription dans `doValidate`, une seule au tour de `loop()` suivant. 422 : aucune ré-inscription. **Tous les scénarios, y compris ceux des écarts : ni affichage, ni écriture ou ouverture de fichier de la carte, ni ACK, ni téléchargement d'image, ni observation, œuvre courante inchangée.**

**Clarification — « un seul vote ».** Quand le pull annonce de nouveau le même candidat, le firmware n'envoie qu'**un** POST parce que le serveur SIMULÉ répond `alreadyVoted` au second `validate-candidate`. **Ce n'est pas le verrou local persistant « une seule tentative » exigé pour le canari de vote.** Le test « OBSERVATION R-B3 » le met à nu : avec un serveur simulé qui ne se souvient pas du vote (`double-forgetful`), le firmware relit le candidat, signe et **vote de nouveau** (2 POST). Ce verrou (drapeau « dépensé » en EEPROM, écrit avant l'envoi) reste à implémenter au lot V4 ; ce n'est pas l'un des écarts R-H / R-M ci-dessous.

### 2.2 Écarts de l'audit CONFIRMÉS sur le firmware réel (8)
| Id | Constat observé aujourd'hui |
|---|---|
| R-H1 | clés non chargées : le firmware **vote quand même**, avec une signature invalide |
| R-H2 | candidat v1 : un vote v1 (écho du score serveur) est envoyé |
| R-H3a | défaut collant du client TLS posé avec le dernier octet : le vote part |
| R-H3b | réponse plus longue que la taille annoncée : le vote part |
| R-H4a | POST NON exécuté (`-4`) : le journal dit « 403 = signature, 422 = hash » |
| R-H4b | POST exécuté mais rejeté localement (`-5`) : même message ; le serveur a pourtant compté le vote |
| **R-H5** | **hash reçu ≠ hash annoncé** : la décision GELÉE **D-V2** est l'**ABSTENTION (zéro POST)** ; le firmware envoie aujourd'hui un **refus signé « hash »** portant le hash réel du contenu reçu |
| R-M1 | garde de la pile réseau écrasée pendant la lecture du candidat : aucun arrêt sûr |

**D-V2 appliquée exactement :** une divergence de hash signifie que l'identité du contenu n'est pas établie ; le comportement cible est l'abstention, aucun `reject` signé « hash » n'est déclaré conforme. Le scénario `altered` n'est donc plus dans la liste « tenu » : il est dans la liste des écarts (observé aujourd'hui : refus signé « hash », signature valide, métriques de la référence). La liste exacte, figée par le test : **R-H1, R-H2, R-H3a, R-H3b, R-H4a, R-H4b, R-H5, R-M1**. Le lot V2 qui corrige l'un d'eux fera échouer ce test, qui devra être mis à jour (écart retiré, assertion durcie). Aucun correctif n'est fait ici.

## 3. Mutants refusés (11)
hash annoncé non comparé · lecture incomplète sans effet sur le vote · échec de signature ignoré · candidat non oublié (second vote) · verdict envoyé inversé · métrique `e` remplacée par `t` · ré-inscription DANS `doValidate` · 403 sans ré-inscription · ACK après le vote · écran touché par le vote · carte SD touchée par le vote. L'évaluation d'un mutant est celle du comportement tenu **plus** celle des écarts (un mutant qui fait disparaître ou changer un écart documenté est refusé, p. ex. la comparaison de hash supprimée change l'observation de R-H5).

## 4. Ce que ce harnais ne prouve pas
Les piles réelles du Cortex-M4 (le déplacement de `SP` est simulé : seule la logique d'échec fermé l'est), le débit TLS, le temps de lecture de 153 600 octets sur la carte, les interruptions, le comportement du serveur sous quorum > 1. Les scénarios de garde (R-H4b, R-M1) injectent l'écrasement de la garde par un crochet hôte. Les 8 écarts ci-dessus restent à corriger (V2) avant tout canari de vote.

## 5. Vérifications
`tests/tft28VoteHarness.test.ts` : 5 / 5 (comportement tenu, 8 écarts exacts, observation R-B3, 11 mutants refusés, périmètre). Aucun autre fichier de firmware ou de test modifié ; `POD_RENDER_V1 = 0`, `POD_CANARY = 0`. Vraie cryptographie et références indépendantes conservées.

## 6. Suite (non commencée)
V2 : `POD_VOTE_V1=0`, `g_voteGate` (clés, auto-test), exigence `fault()` / `complete()`, **abstention sur divergence de hash (D-V2)**, `VoteOutcome` (`-4` / `-5` honnêtes), `netStackFailed` avec arrêt sûr sur `GUARD`. V4 : verrou local persistant « une seule tentative » (R-B3), candidat épinglé. Arrêt ici pour l'audit GPT.

**PBC1 — recherche des bornes d'animation : NON COMMENCÉE.** Le cadrage `docs/CADRAGE_BORNES_ANIMATIONS_ET_FORMATS_VARIABLES_2026_10_13.md` (branche `codex/claude-local-resume-2026-10-12`) n'a donné lieu à aucun essai, aucun clip de test et aucune modification dans ces deux lots.
