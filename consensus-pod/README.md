# consensus-pod — noyau de consensus Proof-of-Draw (BROUILLON INTERNE, NON PUBLIÉ)

| | |
|---|---|
| **Version** | `0.0.1` — **interne** ; la publication ouverte (licence, dépôt, Library Manager) est une **décision du porteur**, prévue après le gel du protocole v3. **Aucun fichier de licence n'est ajouté ici.** |
| **Référence** | `lib/podProtocolV3.ts` (TypeScript) ; spécification `docs/SPEC_PROTOCOLE_V3.md`. |
| **Statut matériel** | **compilé** pour ESP8266 et UNO R4 (exemples `SelfTest*`) ; **jamais essayé sur une carte**. **Aucun firmware du dépôt ne l'utilise encore** (adoption au grand reflash). |

## Ce que contient `src/`
| Fichier | Rôle |
|---|---|
| `consensusPoD.h` | le noyau : règles N2, hash salé (nonce + flux), message de vote v3, feuille et racine de Merkle, graine/rang de comité, règle des sièges, mineur déterministe, hachage canonique du bloc v2. **Aucun** `String`, allocation, `printf`, STL, écran, Wi-Fi ni E/S ; tampons fournis par l'appelant. |
| `pod_metrics.h`, `pod_metrics_table.h` | métriques entières « pod-metrics-2 » en flux (**copies byte-identiques** de `esp8266/_shared`, déjà validées sur matériel ; `node scripts/sync-bench-header.js` les resynchronise, un test les surveille). |
| `adapters/crypto_posix.h` | SHA-256 portable (PC, Raspberry Pi, tests). |
| `adapters/crypto_esp8266.h` | SHA-256 BearSSL (ESP8266). |
| `adapters/crypto_uno_r4.h` | SHA-256 de la bibliothèque Crypto (UNO R4). |
| `consensusPoD_selftest.h` | jeu minimal d'auto-test, **généré** (ne pas éditer). |

La **signature Ed25519** n'est pas dans le noyau : elle reste dans le sketch (bibliothèque Crypto). Le SHA-256 est un **paramètre de modèle** (`Sha` : `begin()`, `update(const void*, size_t)`, `finish(uint8_t[32])`).

## Vérifier la parité avec la référence TypeScript
```
node --import tsx scripts/gen-consensus-pod-vectors.ts            # régénère test-vectors/vectors.txt (seulement pour un changement de protocole VOLONTAIRE)
g++ -std=c++11 -Wall -Wextra -Werror -O2 consensus-pod/host/core_harness.cpp -o core_harness
./core_harness consensus-pod/test-vectors/vectors.txt             # → PASS <n>
```
`tests/consensusPodCore.test.ts` le fait à chaque `npm test` (sans `g++` : test IGNORÉ et signalé, jamais vert).

## Compiler les exemples (aucune carte nécessaire)
```
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2:eesz=4M2M --library consensus-pod consensus-pod/examples/SelfTestEsp8266
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi        --library consensus-pod consensus-pod/examples/SelfTestUnoR4
```
Mesures du 07/10/2026 (surcoût par rapport à un sketch vide avec `Serial`, auto-test et chaînes de diagnostic compris) : **ESP8266 +656 o de RAM statique, +10 Ko de flash** ; **UNO R4 +796 o de RAM statique, +3,5 Ko de flash**.

## Ce qui n'y est PAS (volontairement)
Nœud « sans écran » et rôle `validator` côté serveur ; adoption par les 9 firmwares ; transport HTTP ; signature. Voir `docs/LOT_5_NOYAU_CONSENSUSPOD_2026_10_07.md`.
