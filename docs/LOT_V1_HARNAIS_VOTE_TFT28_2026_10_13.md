# LOT V1 — harnais de vote de bout en bout du R4 + TFT 2,8″ (état de référence, sans correction) — 13 octobre 2026

**Base :** `a83b5d4` (branche `claude/r4-tft28-vote-audit-8b2e`, firmware identique à `0059f74`). **Périmètre :** tests et maquettes hôte SEULEMENT. **Aucun** changement du firmware, du serveur, du protocole, de Redis, de Neon, de l'OTA, du polling ; aucun vote réel, aucun flash, aucun backend. La branche du canari animation et celle des gestes tactiles ne sont pas touchées.

## 1. Ce que le lot ajoute
| Fichier | Rôle |
|---|---|
| `consensus-pod/host/tft28_vote_harness.cpp` | exécute le sketch TFT COMPLET (production : le vote existe) sur l'hôte : réseau scripté, piles dédiées réelles (PodNet, PodEd), SD et TFT simulés, **vraie bibliothèque Crypto** (SHA-256 et Ed25519), vrai `podCheckStream` / métriques sur 153 600 octets. 18 scénarios. Il imprime des FAITS ; il ne juge pas. |
| `tests/tft28VoteHarness.test.ts` | rend les verdicts avec un calcul **indépendant** : contenu et SHA-256 (Node), métriques (`lib/podMetrics.ts`), message signé (`lib/podVote.ts`), signature (`lib/ed25519.ts`, OpenSSL). 4 tests, dont 11 mutants. |
| `consensus-pod/host/tft28/tft28_mock.h` | les maquettes factices d'Ed25519 / SHA-256 sont désactivées par `-DPOD_HOST_REAL_CRYPTO=1` (le harnais de vote seulement ; les autres harnais gardent leurs maquettes). |

## 2. Résultats sur le code ACTUEL
### 2.1 Tenu (verrouillé par 11 mutants refusés)
Candidat valide : exactement **1** `validate`, **1** lecture, **1** POST ; `rawHash`, `e`, `t`, `r` identiques à la référence TypeScript ; verdict `accept` ; **signature Ed25519 valide** pour le message `pod-vote-v2|…` ; candidat oublié ; bloc miné seulement si le serveur le dit. Image uniforme : refus signé `blank`. Contenu altéré : refus signé `hash` portant le hash RÉEL du contenu reçu. Lecture tronquée / silencieuse / défaut TLS à mi-chemin : **aucun POST**. Signature impossible : **aucun POST**. Écran inconnu : ni lecture ni vote. Candidat ré-annoncé : **un seul** POST. 403 « Signature » : aucune ré-inscription dans `doValidate`, une seule au tour de `loop()` suivant. 422 : aucune ré-inscription. **Tous les scénarios : ni affichage, ni écriture ou ouverture de fichier de la carte, ni ACK, ni téléchargement d'image, ni observation, œuvre courante inchangée.**

### 2.2 Écarts de l'audit CONFIRMÉS sur le firmware réel (7)
| Id | Constat observé aujourd'hui |
|---|---|
| R-H1 | clés non chargées : le firmware **vote quand même**, avec une signature invalide |
| R-H2 | candidat v1 : un vote v1 (écho du score serveur) est envoyé |
| R-H3a | défaut collant du client TLS posé avec le dernier octet : le vote part |
| R-H3b | réponse plus longue que la taille annoncée : le vote part |
| R-H4a | POST NON exécuté (`-4`) : le journal dit « 403 = signature, 422 = hash » |
| R-H4b | POST exécuté mais rejeté localement (`-5`) : même message ; le serveur a pourtant compté le vote |
| R-M1 | garde de la pile réseau écrasée pendant la lecture du candidat : aucun arrêt sûr |

Le test affirme que ces 7 écarts sont observés **aujourd'hui, et que la liste est exacte** : le lot V2 qui en corrige un fera échouer ce test, qui devra être mis à jour (écart retiré, assertion durcie). Aucun correctif n'est fait ici.

## 3. Mutants refusés (11)
hash annoncé non comparé · lecture incomplète sans effet sur le vote · échec de signature ignoré · candidat non oublié (second vote) · verdict envoyé inversé · métrique `e` remplacée par `t` · ré-inscription DANS `doValidate` · 403 sans ré-inscription · ACK après le vote · écran touché par le vote · carte SD touchée par le vote.

## 4. Ce que ce harnais ne prouve pas
Les piles réelles du Cortex-M4 (le déplacement de `SP` est simulé : seule la logique d'échec fermé l'est), le débit TLS, le temps de lecture de 153 600 octets sur la carte, les interruptions, le comportement du serveur sous quorum > 1. Les scénarios de garde (R-H4b, R-M1) injectent l'écrasement de la garde par un crochet hôte. Les 7 écarts ci-dessus restent à corriger (V2) avant tout canari de vote.

## 5. Vérifications
Test `tft28VoteHarness` : 4 / 4. Aucun autre fichier de firmware ou de test modifié ; `POD_RENDER_V1 = 0`, `POD_CANARY = 0`.

## 6. Suite (non commencée)
V2 : `POD_VOTE_V1=0`, `g_voteGate` (clés, auto-test), exigence `fault()` / `complete()`, `VoteOutcome` (`-4` / `-5` honnêtes), `netStackFailed` avec arrêt sûr sur `GUARD`. Arrêt ici pour l'audit GPT.
