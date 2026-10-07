# Lot 5 — Noyau `consensusPoD` (extraction interne, sans reflash)

| | |
|---|---|
| **Date** | 07/10/2026 — base `c3c3c6b` |
| **Réalisateur** | Claude |
| **Statut** | **Noyau C++ livré, vérifié bit à bit contre la référence TypeScript ; aucun firmware modifié.** Compilé pour ESP8266 et UNO R4 (auto-test), **jamais essayé sur une carte**. **Non publié** : aucune licence ajoutée (décision du porteur, après le gel du protocole v3). |
| **Décision D10** | extraction **interne** maintenant, publication ouverte après stabilisation du v3 (version `0.0.x`). |

## 1. Ce qui est livré — `consensus-pod/`

| Élément | Contenu |
|---|---|
| `src/consensusPoD.h` | règles N2 ; hash salé **en flux** ; message de vote v3 ; feuille et racine de Merkle ; graine et rang du comité ; seuil et **règle des sièges** ; **mineur déterministe** ; **hachage canonique du bloc v2**. Sans `String`, allocation, `printf`, STL, E/S. SHA-256 fourni par l'appelant (paramètre de modèle). |
| `src/pod_metrics.h`, `pod_metrics_table.h` | métriques entières : **copies byte-identiques** de `esp8266/_shared` (déjà validées sur matériel), ajoutées à `scripts/sync-bench-header.js` et au test des copies. |
| `src/adapters/` | `crypto_posix.h` (SHA-256 portable, PC/Raspberry/tests), `crypto_esp8266.h` (BearSSL), `crypto_uno_r4.h` (bibliothèque Crypto). |
| `host/core_harness.cpp` | harnais PC : relit `test-vectors/vectors.txt` et compare **chaque valeur** au noyau C++. |
| `test-vectors/vectors.txt` | **468 lignes → 1 327 vérifications**, générées par la **référence TypeScript** (`scripts/gen-consensus-pod-vectors.ts`). |
| `examples/SelfTest*` | auto-test ESP8266 et R4 (compilables, avec un jeu minimal généré). |
| `library.properties`, `README.md` | structure de bibliothèque Arduino ; « BROUILLON INTERNE, NON PUBLIÉ ». |

## 2. Preuves (`tests/consensusPodCore.test.ts`, 7 tests)
- Le noyau compilé avec **`g++ -Wall -Wextra -Werror`** retrouve **toutes** les valeurs de la référence : SHA-256 aux bords de blocs (0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000 octets, mises à jour par morceaux irréguliers), règles (bornes comprises), nonce, hash salé en flux, message v3 (et refus de tampon trop petit), feuilles, **Merkle de 0 à 14 feuilles**, graine et rang, **260 situations de règle des sièges** (K de 1 à 7, vagues 1 et 2), **24 tirages de mineur**, **10 blocs v2** (avec/sans racine d'animation, 0 à 7 validateurs, dates sur 64 bits).
- **Contrôle négatif** : un caractère modifié dans une ligne de `merkle`, `block`, `decide`, `miner`, `message` ou `rule` est **détecté** ; une commande inconnue est une **erreur**, jamais ignorée. Le harnais n'est donc pas complaisant.
- Les fichiers de vecteurs commités sont **exactement** la sortie de la référence (tout changement de protocole doit les régénérer volontairement).
- **Portabilité** vérifiée par test : pas de `String`, `malloc`, `new`, `printf`, STL, `Serial`, `WiFi`, `delay` ; seuls `<stdint.h>`, `<stddef.h>`, `<string.h>` et `pod_metrics.h` sont inclus ; **aucun tampon statique** dans le noyau (les tampons appartiennent à l'appelant).
- Sans `g++`, la partie différentielle est **ignorée et signalée** (jamais verte). `tests/podHeaderCopies.test.ts` surveille les deux copies d'en-têtes.

## 3. Mesures de compilation (arduino-cli, 07/10/2026)
| Cible | RAM statique | Flash | Remarque |
|---|---|---|---|
| ESP8266 `nodemcuv2:eesz=4M2M` | **+656 o** (28 728 contre 28 072 pour un sketch vide avec `Serial`) | **+10 Ko** | l'auto-test inclut `printf_P` et ses chaînes ; le noyau seul est bien plus petit |
| UNO R4 WiFi | **+796 o** (7 536 contre 6 740) | **+3,5 Ko** | tampons statiques de l'auto-test inclus ; 1 Ko de pile principale respecté (aucun tableau local) |
Ces chiffres sont des **compilations**, pas des mesures de tas sur la carte (`[HEAP] après WiFi` à relever à l'adoption).

## 4. Budget
Redis : **0**. Neon : 0. Polling : 0. Cadence firmware : inchangée. **Aucun `.ino` ni en-tête de firmware modifié** (un test le vérifie : aucun firmware ne contient « consensusPoD »).

## 5. Rollback
Dossier `consensus-pod/` et fichiers de test/script ajoutés seulement ; deux lignes ajoutées au script de synchronisation et au test des copies. `git revert` du commit suffit.

## 6. Ce qui n'est PAS fait (et pourquoi)
| # | Point | Raison |
|---|---|---|
| R1 | **Adoption par les firmwares** (remplacer `podVerdict`, `podVoteMessage`, le hash salé…) | modifier un `.ino` demande sauvegarde, recompilation et **essai sur carte** ; regroupé dans le **grand reflash** (un seul cycle) |
| R2 | **Nœud sans écran** (`podnode`) et rôle `validator` côté serveur (`screens: []`) | change l'enregistrement en production ; lot suivant, **après le gel du v3** |
| R3 | Adaptateur **ESP32** (mbedtls) et **Raspberry Pi** natif | pas de carte ESP32 dans le parc d'essai ; le PC sert de référence |
| R4 | **Signature / vérification Ed25519** dans le noyau | elle reste dans le sketch (bibliothèque Crypto) ; une version PC existe côté TypeScript |
| R5 | **Licence et publication** | décision réservée au porteur |
| R6 | **Essai de l'auto-test sur carte** | à faire par le porteur, quand il le souhaite (aucun reflash du réseau n'est nécessaire : ce sketch est indépendant) |

## 7. Étrangetés relevées
- La bibliothèque **Crypto** de l'UNO R4 émet l'avertissement `no hardware random number source detected` (déjà présent pour les firmwares R4 du dépôt) : cela concerne la génération de clés (constat K5), pas le noyau.
- Le noyau doit **rester** sans tampon statique : l'ajout d'un tampon (par exemple pour trier) serait une régression pour l'ESP8266 (règle 8 de `CLAUDE.md`) ; le test le garde.
