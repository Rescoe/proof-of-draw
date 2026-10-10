# Lot 8B-2B-2 · PULLFRAME-PHASE-AUDIT1 — localiser le blocage qui suit « nouvelle frame (personal) »

| | |
|---|---|
| **Date** | 10/10/2026 |
| **Statut** | **Instrumentation seule livrée, COMPILÉE (cœurs 1.5.3 et 1.6.0), testée sur l'hôte. JAMAIS flashée.** Aucune correction : la décision attend la localisation matérielle. Aucune frame, aucun dessin, aucun vote. |
| **Origine** | canari matériel de `7df39b6` (`docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT1_2026_10_10/`) et analyse GPT `docs/AUDIT_GPT_7DF39B6_PULLFRAME_2026_10_10.md` |
| **Portée** | le seul sketch **UNO R4 e-ink 2,9″**, uniquement dans des blocs `#if POD_RENDER_V1 && POD_CANARY` (production : code **identique**, § 6) + tests + scripts + documentation. **Aucun** serveur, Redis (+0), Neon (0), protocole, vote, ACK, rendu, OTA, polling, taille de pile, ni changement d'architecture. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

## 1. Ce que le canari de `7df39b6` établit
* Piles dédiées, register JSON et trois pull JSON **sains** (register 496 o / marge 1 488 ; pull 700, 748, 756 o / marges 1 284, 1 236, 1 228 ; PodNet 812 – 848 o de marge ; tas libre stable à ≈ 100 o près).
* Au **troisième pull** (cartel « La chute de WallStreet / Neo », bloc 87) : `[PULL] nouvelle frame 6429e8f5-9ed8-427c-9c3e-018b4e820c05 (personal)` — **puis plus rien** pendant ≈ 30 minutes : aucun `[HTTP GET] /api/pull-frame`, `[FRAME]`, `[CANARY] net pull-frame`, `[RENDER]`, `[EINK]`, ACK ; aucun redémarrage visible.
* Le dessin neuf (`/api/submit-candidate` 13:42:24) a reçu **deux votes seulement** (1/3 `dev_T46HBXG1`, 2/3 `dev_KAD6PKC4`) ; le R4 `dev_W29I1TW7`, bloqué, n'a pas voté (quorum = `ceil(4 × 0,51)` = 3) : aucun bloc, le candidat expire. Conséquence normale du blocage, pas une anomalie de consensus.
* **Réserve** : la capture Vercel fournie couvre **13:41 → 14:11** alors que la frame personnelle a été envoyée **avant** le dessin de 13:42:24. L'absence de `/api/pull-frame` y est donc établie pour cette fenêtre seulement ; la preuve côté carte (journal série) est indépendante et suffit : la ligne qui suit la requête (`[HTTP GET] /api/pull-frame -> code`) n'a jamais été imprimée. À compléter par un extrait Vercel filtré sur `/api/send-to-screen` et `/api/pull-frame` pour 13:00 → 13:45.

## 2. Ce que le code des cœurs permet (audit demandé)
Cœurs Renesas **1.5.3 et 1.6.0** : `libraries/WiFiS3/src/*` identique (seul `WiFi.h` diffère), `Modem.cpp` identique.

| Opération | Borne dans le code | Borne maximale |
|---|---|---|
| chaque commande AT du module (`ModemClass::buf_read`) | `MODEM_TIMEOUT` = **10 000 ms**, test `millis() - start_time > _timeout` en tête de boucle | 10 s |
| `WiFiSSLClient::connect(host, 443)` | `getSocket()` (`connected()` + `stop()` + `SSLBEGINCLIENT`) + `SETCAROOT` + `SSLCLIENTCONNECTNAME` : cinq commandes AT au plus ; `_connectionTimeout` vaut 0 (l'hôte n'envoie aucun délai au module) | ≈ 50 s |
| `client.print(req)` | une commande AT + `passthrough` | ≈ 10 s |
| lecture des en-têtes (`podhttp::Reader`) | `HTTP_TIMEOUT_MS` = 20 s **par ligne** (`available()` = une commande AT, ≤ 10 s) | ≈ 30 s par ligne |
| `SerialUSB::write` (cœur 1.6.0) | **aucune** : `while (to_send) { if (!space) { flush; continue; } … }` boucle **sans limite** tant que l'hôte est « connecté » (DTR) mais ne vide pas le tampon | **illimité** |
| `malloc` (tas corrompu) | aucune | illimité |
| HardFault | le cœur 1.6.0 appelle `cm_backtrace_fault`, qui imprime puis boucle | — |

Conclusions, sans extrapolation :
1. **`client.connect()` ne peut pas, par lecture du code, bloquer 30 minutes** : tout est borné par `millis()` à ≈ 50 s. `HTTP_TIMEOUT_MS` ne couvre en effet que `podhttp::Reader`, mais le module borne le reste à 10 s par commande.
2. Un blocage de plusieurs minutes suppose donc (a) `millis()` figé (interruptions masquées, faute), (b) une boucle sans limite hors de ces chemins — dont **l'écriture USB** — ou (c) un tas corrompu. Le journal série n'a affiché aucun rapport de HardFault du cœur 1.6.0 (si c'est bien ce cœur qui a été flashé : **à confirmer par le porteur**).
3. ⚠ **Risque pour l'instrument lui-même** : une ligne de journal peut bloquer indéfiniment si le moniteur série est ouvert mais cesse de lire. Une marque imprimée en bloquant ferait croire que le blocage est APRÈS elle. C'est pourquoi les marques ci-dessous n'impriment que s'il y a de la place dans le tampon USB (attente bornée à 200 ms) et comptent les lignes perdues (§ 3).

## 3. Instrumentation (canari seulement)
15 marques de phase, chacune dans un bloc `#if POD_RENDER_V1 && POD_CANARY` qui ne contient qu'elle. Chaque ligne : `[CANARY] FF n : <libellé> | marqueur OK|DETRUIT | perdues=k | t=<ms>`. **La dernière ligne imprimée est le dernier point atteint.**

| n | Où | Pile | Libellé |
|---|---|---|---|
| 1 | `doPull`, juste avant `doFetchFrame` | principale | avant l'appel de doFetchFrame (depuis doPull) |
| 2 | entrée de `doFetchFrame` | principale | entree de doFetchFrame |
| 3 | juste avant `podNetRun` | principale | avant podNetRun (pile reseau dediee) |
| 4 | première instruction de la transaction | **dédiée** | transaction : entree sur la pile reseau dediee |
| 5 | après la construction du client TLS | dédiée | connexion TLS construite (client cree), avant la requete |
| 6 | `Conn::request`, avant `client.connect` | dédiée | avant client.connect |
| 7 | après `client.connect` réussi | dédiée | apres client.connect : connecte |
| 8 | requête construite, avant `client.print` | dédiée | requete construite, avant client.print |
| 9 | après `client.print`, avant `readHeaders` | dédiée | apres client.print, avant la lecture des en-tetes |
| 10 | après `readHeaders` | dédiée | apres la lecture des en-tetes |
| 11 | après le plan noir | dédiée | plan noir lu |
| 12 | après le plan rouge | dédiée | plan rouge lu |
| 13 | avant `stop()` | dédiée | avant stop |
| 14 | après `stop()` | dédiée | apres stop |
| 15 | après le retour de `podNetRun` (puis arrêt du traçage) | principale | retour de podNetRun |

Mécanisme : `g_podFfPhase` (0 = inactif ; sinon dernière phase), `g_podFfDrop` (lignes perdues) — **+2 o de RAM statique** (canari uniquement, RAM mesurée inchangée : 22 784 o) ; `podFfSay()` attend au plus 200 ms une place d'au moins 120 o dans le tampon USB (`Serial.availableForWrite()`), sinon perd la ligne (et la compte) ; sinon `logf`. Aucune allocation, aucun `String`. Toute autre transaction (register, pull, ACK, vote…) reste **muette** (`g_podFfPhase == 0`). Si `connect` échoue, la ligne existante `[HTTP GET] /api/pull-frame -> -2` le dit déjà (la marque 7 n'est pas imprimée).

**Coût dans la pile réseau dédiée** (`scripts/net-stack-report.js`, statique, cœur 1.6.0) : lambda de `doFetchFrame` 240 → 248 o de cadre, pire cas statique 1 312 → 1 320 o (sans branche flottante 992 → 1 000 o) : reste **880 o** (avant : 888 o) sur les 1 984 o utilisables, cadre d'exception compris ; les impressions se font aux niveaux superficiels (jamais dans `connect`, qui reste le point le plus profond : 1 136 – 1 172 o mesurés).

## 4. Chaîne statique `setup/loop → doPull → doFetchFrame → podNetRun` (pile principale)
`scripts/dopull-chain-report.js` (`doFetchFrame` est inlinée dans `doPull`) : **identique** en production et en canari par rapport à `7df39b6` — cadre de `doPull` 136 o (production) / 192 o (canari), pire chaîne depuis `setup` 704 / 800 o, depuis `loop` 536 / 632 o ; chaîne de l'image (`displayStream` 216 o, `persistFrameId` 184 o, `refreshPanel` 184 o, `logf` 136 o) : marge statique ≥ 224 o depuis `setup`. Les marques de la pile principale appellent `logf` (pile de journal) : aucun cadre de plus dans `doPull`. Le premier pull (depuis `setup`) est 168 o plus profond que les suivants (depuis `loop`) : **la frame personnelle restée en attente sera téléchargée dès le premier pull du prochain démarrage, donc par la voie la plus profonde**.

## 5. Récupération possible (documentée, NON implémentée — attendre la localisation)
| Cause localisée | Pistes (à décider après audit) |
|---|---|
| bloqué dans `connect` / une commande AT (millis() continue) | n'arrive pas par lecture du code (≤ 50 s) ; si observé : le module est désynchronisé → `WiFi.disconnect()`/réinitialisation du modem puis nouvel essai au pull suivant ; `setConnectionTimeout()` pour borner le côté module |
| bloqué avec `millis()` figé / faute | seul un chien de garde matériel récupère : celui du RA4M1 est court (quelques secondes) et doit être rafraîchi dans **toute** attente longue (rafraîchissement e-ink ≈ 15 – 20 s, Ed25519, TLS) — chantier à part |
| bloqué dans l'écriture USB | borner `logf` (ne pas écrire quand le tampon est plein) : changement de production, à décider |
| tas corrompu / `malloc` | audit du tas (canaris de tas) ; rien à corriger à l'aveugle |

## 6. Production inchangée — preuves
* Table d'annulation exacte (`tests/helpers/netStackEdits.json`, neu de `requestConnect`, `requestSend`, `fetchOpen`, `fetchClose`, `dopullJsonStack` mis à jour) : l'annulation restitue **au texte près** le sketch de `7df39b6` (hors blocs du canari).
* Désassemblage normalisé (`scripts/disasm-compare.js --pool`, cœurs 1.5.3 et 1.6.0) : **production (`-DPOD_RENDER_V1=0 -DPOD_CANARY=0`) : 1 031 des 1 036 fonctions identiques** ; les 5 « différentes » sont des artefacts de données et de chemin de build (`arduino_main`, descripteurs USB, tables) — aucune instruction de firmware modifiée.
* Tailles (cœurs 1.5.3 = 1.6.0, `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT1_2026_10_10/tailles-*.txt`) : production OFF 124 580 → 124 612 o (+32 o = longueur du chemin de build gravé, code identique), canari 136 188 → 136 460 o (+272 o), forme IDE `1`/`1` 136 452 o ; **RAM statique inchangée** (22 768 o ; canari 22 784 o) ; aucun avertissement du sketch.
* Les quatre autres firmwares R4 : aucun changement (le fichier de l'en-tête non plus).

## 7. Tests
| Test | Contenu |
|---|---|
| `tests/pullFramePhases.test.ts` | les 15 marques présentes **une fois**, **seules** dans leur bloc gardé, dans l'ordre de `Conn::request`, de `doFetchFrame` et de `doPull` ; macro et `podFfSay` au texte exact (attente USB **bornée**, ligne perdue comptée, marqueur ET longueur exacts, `logf` seulement) ; aucune marque hors canari ; quatre autres firmwares inchangés — **15 suppressions + 10 mutants** refusés (garde retirée, attente non bornée, ligne imprimée sans place, compteur supprimé, impression directe par `Serial`, marqueur affaibli, arrêt du traçage supprimé, marque 3 déplacée, marques 6/7 permutées, marque en production) |
| `tests/canaryPrep.test.ts` | exactement **quatre** statiques de canari (deux ajoutés), fonction non `void` marquée `noinline` |
| `tests/netStack.test.ts` | le texte de PRODUCTION de chaque transaction se termine toujours par `stop()` (les marques de canari sont ignorées) |

## 8. Prochain canari (après audit GPT)
Même fichier local `1`/`1`. **La frame personnelle `6429e8f5…` est toujours en attente** (aucun ACK) : le premier pull du démarrage la trouvera et lancera `doFetchFrame` — aucun renvoi d'image, aucun dessin. Copier TOUT le journal, y compris le silence final. Lecture :

| Dernière ligne `FF n` imprimée | Interprétation |
|---|---|
| 1 sans 2 | blocage dans l'appel de `doFetchFrame` lui-même (impossible par lecture du code : à examiner) |
| 2 sans 3 ou 3 sans 4 | blocage **avant** la pile dédiée : `malloc(2048)`, peinture, trampoline (`PodNet::runSized`) |
| 4 ou 5 sans 6 | construction du client TLS ; tas |
| 6 sans 7 | **`client.connect`** (un `[HTTP GET] … -> -2` indiquerait un échec rapide, pas un blocage) |
| 7/8 sans 9 | construction de la requête, ou `client.print` |
| 9 sans 10 | **lecture des en-têtes** (borne 20 s/ligne : un blocage > 2 min contredirait le code) |
| 10 sans 11 | corps / plan noir (le journal `[HTTP GET] … -> 200` et `[FRAME] lu…` doivent apparaître) |
| 11 sans 12, 12 sans 13 | lecture du plan rouge, avant `stop()` |
| 13 sans 14 | `client.stop()` (commande AT de fermeture) |
| 14 sans 15 | retour de la pile dédiée / effacement / `free` |
| 15 imprimé mais pas `[CANARY] net pull-frame` | rapport PodNet |
| `marqueur DETRUIT` | première phase où la pile principale est touchée |
| `perdues=k` > 0 | le canal USB était saturé : les lignes manquantes ne sont **pas** des points non atteints ; croiser avec les journaux Vercel (`/api/pull-frame` puis `/api/ack-frame` ⇒ le firmware a avancé malgré le silence) |
| aucune ligne `FF` après « nouvelle frame » | blocage dans `logf` lui-même (USB) ou dans la ligne `FF 1` ; vérifier le moniteur série (fermer/rouvrir) |

Ne pas renvoyer de dessin avant : téléchargement + rendu + ACK validés.

## 9. Limites
* Jamais exécuté sur une carte. La cause du blocage n'est **pas** connue ; ce lot ne la corrige pas.
* L'écriture USB sans borne du cœur est un risque de production (moniteur ouvert mais figé) non traité ici.
* Le cœur flashé par le porteur (1.5.3 ou 1.6.0) n'est pas confirmé par les journaux.
