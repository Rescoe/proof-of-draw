# Lot 6C — Compilation et budgets mémoire de l'automate `pod-anim-v3` (ESP8266 et UNO R4), contrat d'intégration du lot 8, préparation de l'OTA

| | |
|---|---|
| **Date** | 07/10/2026 — base `8f1632f` (poussée) |
| **Réalisateur** | Claude · **auditeur** : GPT |
| **Statut** | **COMPILÉ sur les deux cartes, exécuté sur le PC. JAMAIS ESSAYÉ SUR UNE CARTE.** Aucun `.ino` de production, aucune variable, aucun secret, aucun ticket, aucune route de vote ou de finalisation, aucun chemin Redis modifié. Aucun flash. |
| **Décision du porteur** | **un seul grand flash, à la fin du lot 8** (noyau commun, calcul images + animations, cartels/rendu, portail Wi-Fi, OTA signée, TLS authentifié, anti-retour arrière). Rien de ce lot n'exige un flash intermédiaire. |
| **Mesures archivées** | `docs/mesures/6C_2026_10_07/` (commandes, versions, sorties de compilation, symboles de l'ELF, tailles d'objets, pile statique) |

## 0. Verdict par plateforme

| Plateforme | Verdict | Raison en une ligne |
|---|---|---|
| **ESP8266** | **VIABLE SOUS RÉSERVE** (stratégie « télécharger vers LittleFS, calculer TLS fermé ») ; **NON VIABLE** si l'on calcule *pendant* le TLS | L'automate fait **1 944 o** (< 2 Ko) et tient en RAM, mais il ne peut pas coexister avec BearSSL (≈ 35 Ko de tas requis sur ≈ 38 Ko disponibles : marge ≈ 3 Ko, soit moins que l'automate + hash salé + fragment ≈ 2,7 Ko). Calculé **après** la fermeture du TLS, avec le clip lu **depuis LittleFS**, il est confortable. À confirmer **sur carte** (`[HEAP]`). |
| **UNO R4 WiFi** | **VIABLE SOUS RÉSERVE** | 2,6 Ko de RAM statique (objet **global**), TLS déporté dans le coprocesseur Wi-Fi (pas de concurrence de RAM), clip lisible directement depuis le socket. **Réserve : la pile principale de 1 024 o** — chaîne d'appels de l'automate ≈ 270 o + appelant, analysée statiquement (≈ 544 o au total dans l'auto-test), **non mesurée**. |

Rien n'a été exécuté sur une carte : « viable » signifie ici « compile, budgets calculés, logique exécutée sur PC ».

## 1. Livrables

| Fichier | Rôle |
|---|---|
| `consensus-pod/examples/AnimSelfTestEsp8266/AnimSelfTestEsp8266.ino`, `…/AnimSelfTestUnoR4/AnimSelfTestUnoR4.ino` | auto-tests **séparés** des firmwares (exemples de la bibliothèque `ConsensusPoD`), « NE PAS DÉPLOYER », « COMPILÉ seulement » ; **tout l'état en objet global** (jamais sur la pile) |
| `consensus-pod/src/podAnimSelfTest.h` | logique d'auto-test **unique** (ESP8266, R4, PC) ; clip lu **depuis la flash par fragments de 1, 7, 61 et 256 octets** dans UN tampon de 256 o |
| `consensus-pod/src/podAnimV3_selftest.h` | clips + valeurs attendues, **générés** par la référence TypeScript (`scripts/gen-anim-selftest.ts`) |
| `consensus-pod/host/anim_selftest_host.cpp` | le même auto-test sur PC (`--bench` : temps **hôte**) |
| `consensus-pod/src/podAnimV3.h` | **allégé en pile** (voir § 4) sans changer un seul résultat (2 968 vérifications inchangées) |
| `consensus-pod/src/adapters/crypto_esp8266.h`, `crypto_uno_r4.h` | adaptateurs SHA-256 **existants** réutilisés, **non modifiés** |
| `tests/animSelfTest.test.ts`, `tests/helpers/animSelfTestHeader.ts` | 5 tests (en-tête généré, exécution hôte 36/36, contrôles négatifs, séparation des firmwares, aucun usage en production) |
| `docs/mesures/6C_2026_10_07/*` | mesures archivées |

## 2. Auto-test : cas et résultats attendus (référence TypeScript)

9 cas × 4 découpages du flux = **36 vérifications**. Chaque vérification compare une ligne `règle|images|E|T|R|S|affiche|statique|clipHash|framesRoot|animRoot|message pod-vote-v3-anim` à la valeur attendue.

| Cas | Contenu | Règle attendue | Taille du clip |
|---|---|---|---|
| c0 | valide, 2 images | `ok` | 1 145 o |
| c1 | valide, **64 images** (maximum) | `ok` | 2 919 o |
| c2 | statique (toutes les images identiques) | `static` | 1 058 o |
| c3 | **alternance noir/blanc** acceptée (images uniformes qui diffèrent) | `ok` (E = 0, T = 0) | **7 301 o** (le plus gros) |
| c4 | bruit (damier alterné) | `noise` | 3 136 o |
| c5 | CRC altérée (dernier octet) | `format` | 1 145 o |
| c6 | un octet du corps altéré, CRC d'origine | `format` | 1 145 o |
| c7 | flux tronqué à 600 octets | `format` | 600 o |
| c8 | racine d'animation **annoncée** fausse (un caractère) | `hash` | 1 145 o |

Chaque cas produit aussi le **message canonique `pod-vote-v3-anim`** (rejets `format` : `frames = 0` et métriques nulles ; `hash` : `frames` 2..64 et métriques nulles).
**Découpages** : 1 octet, 7 (impair), 61 (premier), 256 (taille maximale du tampon). Les quatre doivent donner **la même ligne** ; elle doit égaler la valeur TypeScript. En plus, `anim_harness` (lot 6B-1) rejoue les 260 clips de `anim-vectors.txt` avec 15 tailles de fragments irrégulières (1 à 1 024).
**Clip jamais complet en RAM** : le plus gros clip de l'auto-test (7 301 o) dépasse 4 Ko ; le seul tampon de flux est de 256 o (test : aucune constante de 9 216 dans le runner, aucun tableau > 768 o).

## 3. Mesures (distinction explicite : COMPILÉ / HÔTE / CARTE)

**Outillage** (archivé : `versions.txt`) : `arduino-cli 1.4.1` ; cœur `esp8266:esp8266 3.1.2` (xtensa-lx106-elf-gcc 10.3, nm 2.32) ; cœur `arduino:renesas_uno 1.5.3` (arm-none-eabi-gcc 7-2017q4, nm 2.29) ; bibliothèque `Crypto 0.4.0` (R4). PC : g++ 10.2.0 (MSYS2).

**Commandes exactes** (depuis la racine du dépôt ; `CLI` = `arduino-cli.exe` de l'Arduino IDE) :
```
CLI compile --fqbn esp8266:esp8266:nodemcuv2:eesz=4M2M --warnings all --build-path <tmp>/build_esp_baseline <tmp>/baseline
CLI compile --fqbn esp8266:esp8266:nodemcuv2:eesz=4M2M --library consensus-pod --build-property compiler.cpp.extra_flags=-fstack-usage --warnings all --build-path <tmp>/build_esp_anim consensus-pod/examples/AnimSelfTestEsp8266
CLI compile --fqbn arduino:renesas_uno:unor4wifi --warnings all --build-path <tmp>/build_r4_baseline <tmp>/baseline
CLI compile --fqbn arduino:renesas_uno:unor4wifi --library consensus-pod --build-property compiler.cpp.extra_flags=-fstack-usage --warnings all --build-path <tmp>/build_r4_anim consensus-pod/examples/AnimSelfTestUnoR4
# sonde de tailles exactes (tailles des objets lues dans l'ELF avec nm -S) :
CLI compile --fqbn <idem> --library consensus-pod --build-property compiler.cpp.extra_flags=-DPOD_ANIMTEST_SIZE_PROBE --build-path <tmp>/build_*_probe consensus-pod/examples/<exemple>
xtensa-lx106-elf-nm -S -C <elf>        arm-none-eabi-nm -S -C <elf>
# PC :
g++ -std=c++11 -Wall -Wextra -Werror -O1 -o anim_selftest_host consensus-pod/host/anim_selftest_host.cpp
```
Le « baseline » est un sketch de 3 lignes (`Serial.begin(115200); Serial.println("baseline");` + `loop` avec `delay`) : il donne le coût fixe du cœur. **0 avertissement ou erreur** dans `consensus-pod/` (`--warnings all`) sur les deux cartes ; les avertissements restants viennent du cœur Arduino R4.

### 3.1 Flash et RAM statique (COMPILÉ — chiffres de l'éditeur de liens)

| | ESP8266 baseline | ESP8266 auto-test | **Δ** | R4 baseline | R4 auto-test | **Δ** |
|---|---|---|---|---|---|---|
| **Flash** | 236 148 o | 278 372 o | **+42 224 o** | 52 000 o | 88 152 o | **+36 152 o** |
| **RAM statique** | 28 108 o (35 %) | 33 000 o (41 %) | **+4 892 o** | 6 740 o (20 %) | 11 296 o (34 %) | **+4 556 o** |
| RAM restante (rapport de l'éditeur) | 52 084 o | 47 192 o | | 26 028 o | 21 472 o | |

Décomposition de la **flash** (symboles de l'ELF) : données de test **24 179 o** (clips 17 849 + valeurs attendues 4 944 + hash annoncés 1 170 + table des cas 216) — *à déduire pour la production* — ; **table d'entropie `pod-metrics` 4 100 o** (déjà présente dans tout firmware qui vote) ; reste **≈ 13 945 o (ESP8266) / ≈ 7 873 o (R4)** de code, **borne haute** (inclut le rapport texte et les comparaisons de l'auto-test, `printf_P` côté ESP8266).
Décomposition de la **RAM statique** : objet de travail global `W` **4 192 o (ESP8266) / 4 216 o (R4)** (automate + hash salé + résultat + fragment 256 + message 512 + ligne observée 768 + hex/annonces) + tampon de compte rendu 160 o ; le reste (≈ 530 o ESP8266) = littéraux de texte. **L'objet de travail est du matériel d'auto-test** : l'intégration réelle n'a besoin que de ≈ 2,7 Ko (§ 3.2).

### 3.2 `sizeof` des objets (COMPILÉ — sonde `-DPOD_ANIMTEST_SIZE_PROBE`, lue dans l'ELF)

| Objet | ESP8266 (BearSSL) | UNO R4 (Crypto) | PC (hôte, SHA portable) |
|---|---|---|---|
| contexte SHA-256 | 112 o | 120 o | 112 o |
| **`PodAnimStream<Sha>`** | **1 944 o** | **1 960 o** | 1 944 o |
| `PodSalted<Sha>` (hash salé, 2ᵉ contexte) | 112 o | 120 o | 112 o |
| `PodAnimResult` | 244 o | 240 o | 244 o |
| `PodMerkleStack<Sha>` (inclus dans l'automate) | 236 o | 236 o | — |
| `PodMetrics` (inclus dans l'automate) | 272 o | 272 o | — |

Contenu de `PodAnimStream` : image courante **1 024 o**, métriques 272 o, Merkle 236 o, **deux contextes SHA-256** (clip + travail) 224/240 o, empreintes (image 0 et courante) 2 × 32 o, en-tête 20 o, CRC 4 o, compteurs ≈ 100 o. **Objectif « ≤ 2 Ko » tenu : 1 944 o et 1 960 o** (marge : 104 et 88 octets seulement — toute augmentation devra être arbitrée).
**Ensemble minimal vivant pendant le calcul** : automate + hash salé + résultat + 1 fragment de 128 à 256 o + hex du hash salé 65 o + hash annoncés 130 o ≈ **2,5 à 2,9 Ko** ; le tampon du message de vote (≈ 400 o) se construit **après** libération de l'automate.

### 3.3 Pile (ANALYSE STATIQUE `-fstack-usage` — pas une mesure d'exécution)

| Plateforme | Pile disponible | Chaîne d'appels de l'automate (octets de cadres) | Verdict |
|---|---|---|---|
| **UNO R4** | **`g_main_stack` = 1 024 o** (lu dans l'ELF) | `transitionDone` 16 → `frameDone` 80 → `node` 32 → `SHA256::update/finalize` + `processChunk` ≤ 120 ⇒ **≈ 250 o** ; avec le cadre de l'appelant de l'auto-test (`setup` 296, qui a inliné l'étape et le rapport) : **≈ 544 o** | **réserve** : il reste ≈ 480 o pour les interruptions et les appelants réels ; le firmware de production devra garder ses cadres sous ≈ 300 o autour de l'appel |
| **ESP8266** | pile « cont » de 4 Ko (loop) | même chaîne ≈ 500 o (cadres de 96 / 48 / 16 / 304) | confortable |

**Constat de ce lot** : la première version du noyau (6B-1) créait des contextes SHA-256 locaux (`Sha s;`, 110 à 120 o) à chaque niveau : la chaîne dépassait **1 100 o** sur R4, soit **plus que la pile principale**. Le noyau a été **allégé** : un contexte de travail et un tableau de 32 o **dans l'objet** (`scratch_`, `h_`), `pod_anim_leaf_with`, `PodMerkleStack::push/root/node` avec contexte fourni, aucun grand local. **Aucun résultat n'a changé** (2 968 vérifications du lot 6B-1 identiques, 36/36 de l'auto-test). C'est une erreur qui n'aurait été visible que sur carte.

### 3.4 Temps

| Nature | Valeur | Statut |
|---|---|---|
| **Temps sur PC (hôte)**, g++ `-O2`, clip de 64 images (c1, 2 919 o), fragments de 256 o | **≈ 1,9 à 2,4 ms** (3 exécutions) ; c3 (7 301 o, 6 images) ≈ 0,3 à 0,5 ms ; fragments de 1 octet au plus ≈ 1,5 × plus lents (bruit de mesure élevé) | **HÔTE — sans rapport avec les cartes** |
| **Opérations** du clip c1 (comptage exact) | SHA-256 : ≈ 78,5 Ko hachés (≈ 1 230 blocs : clip ×2, 64 × 1 024 o d'images, 64 feuilles, 63 nœuds) ; **524 288** pixels de métriques ; ≈ 23 300 pas de CRC | **comptage, pas un temps** |
| **Temps sur ESP8266 / R4** | **NON MESURÉ.** Les deux exemples affichent `us(frag1/7/61/256)=…` par cas via `micros()` : ce sont des **mesures matérielles** seulement quand le porteur les aura exécutés | **à produire sur carte** |

Aucune estimation en millisecondes pour les cartes n'est avancée. **Contrainte déjà certaine** : sur ESP8266 le calcul d'une image (8 192 pixels de métriques) se fait dans un seul appel `update` : le firmware doit appeler `yield()` entre fragments (≤ 256 o) pour nourrir le chien de garde.

## 4. Changement du noyau (sans effet sur les résultats)
`consensus-pod/src/podAnimV3.h` : `PodAnimStream` contient désormais `Sha scratch_` et `uint8_t h_[32]` ; `frameDone`/`transitionDone`/`finish` n'ont plus de tableau ni de contexte SHA locaux ; `pod_anim_leaf_with(Sha&, …)`, `pod_anim_root_with(Sha&, …)`, `PodMerkleStack::{node,push,root}(…, Sha&)` ; les anciennes signatures restent (surcharges) pour les vecteurs. Preuves : `tests/animV3Core.test.ts` (2 968 vérifications bit à bit TypeScript ↔ C++, contrôles négatifs), `tests/animSelfTest.test.ts`.

## 5. Contrat d'intégration pour le lot 8 (grand reflash unique)

### 5.1 Principes communs
1. **Vote d'animation = abstention plutôt que faux vote.** Manque de mémoire, délai dépassé, coupure réseau, clip incomplet *par la faute du transport* : **aucun vote**, jamais un `format` fabriqué (un faux refus abîmerait la réputation) et **jamais un redémarrage** pour s'en sortir. Le rejet `format` n'est émis que si l'automate a **conclu** à un clip invalide **après avoir reçu le flux complet annoncé**.
2. **Jamais de clip complet en RAM.** Fragment de 128 à 256 o ; le clip complet vit en flash (LittleFS ESP8266) ou n'existe pas (R4 : lu au fil du socket).
3. **Ordre** : lire le candidat annoncé (léger) → obtenir le clip → calculer → construire le message → signer → voter → (affichage) ; **un seul candidat à la fois**.
4. Le ticket HMAC (`candidate-clip`) n'est distribué qu'aux appareils **déclarant `anim-v3`** (lot 8, `caps` dans `/api/register`) ; aucun appareil actuel n'en reçoit.
5. Aucune nouvelle commande Redis au repos : l'annonce du candidat vit déjà dans le `MGET` du pull ; le clip passe par le CDN (§ `docs/LOT_6B2…`).

### 5.2 ESP8266 — stratégie « fichier d'abord, calcul TLS fermé »
| Étape | Mémoire | Détail |
|---|---|---|
| 1. **TLS ouvert** : `GET /api/candidate-clip?…` | pas d'automate, pas de tampon d'écran, 1 fragment ≤ 256 o | chaque fragment est **écrit dans un fichier LittleFS** (`/anim_cand.pbc`) ; on arrête si > 9 216 o ; `yield()` ; `http.end()` |
| 2. **TLS fermé** : calcul | `malloc(sizeof(PodAnimStream))` = **1 944 o** + `PodSalted` 112 o + résultat 244 o + fragment 256 o ≈ **2,6 Ko** | lecture du fichier **par fragments** → `stream.update` + `salted.update` ; `yield()` entre fragments ; **allocation APRÈS la libération des tampons d'écran**, **libérée avant** toute nouvelle connexion TLS |
| 3. Libération | tout est rendu | l'automate et le résultat ne vivent pas pendant le TLS suivant |
| 4. Message et signature | tampon ≈ 400 o | `pod_anim_vote_message` ; signature Ed25519 existante ; vérifier `ESP.getFreeHeap()` avant |
| 5. **TLS ouvert** : `POST /api/validation-result` | comme aujourd'hui | vote ; suppression du fichier |
- **Pourquoi pas en flux direct depuis le TLS** : le tas après Wi-Fi est ≈ 38 Ko, BearSSL demande ≈ 35 Ko (règles 1, 2, 8 de `CLAUDE.md`) ; 2,6 à 2,9 Ko vivants **pendant** le TLS consommeraient toute la marge. **Non viable** sans mesure contraire sur carte.
- **RAM statique** : **+0** (allocation dynamique) — objectif final ≤ 40 000 o conservé (firmwares actuels 34 240 à 36 064 o). Si l'automate était `static`, +2,6 Ko : 36,8 à 38,7 Ko, encore ≤ 40 000 mais en retirant autant de tas : **déconseillé**.
- **Mémoire insuffisante** : tester `ESP.getFreeHeap() ≥ 8 192` **et** `ESP.getMaxFreeBlock() ≥ 4 096` avant `malloc` ; sinon **s'abstenir** (une trace série, pas de vote, pas de redémarrage) et ne pas retenter à chaque pull (marquer le candidat comme vu).
- **Délai** : abandon propre après un plafond (proposé : 20 s de calcul, 30 s de téléchargement), libération, aucun vote.
- Clip déjà présent pour la lecture de l'animation (`pod_anim_esp.h`, LittleFS) : le fichier peut servir **les deux** usages.

### 5.3 UNO R4 WiFi — stratégie « objet global, flux direct »
| Point | Décision |
|---|---|
| Emplacement | **objet global** (`static PodAnimStream<PodSha256Rw>` + hash salé + résultat + 1 fragment global de 256 o) ≈ **2,7 Ko de RAM statique** ; **jamais** une variable locale ni un grand tableau local (pile principale de 1 024 o) |
| TLS | assuré par le **coprocesseur Wi-Fi** : pas de concurrence de RAM avec le calcul ; le clip peut être lu **directement** depuis `WiFiSSLClient` fragment par fragment |
| Pile | l'appel de `update()` doit se faire depuis un niveau d'appel **peu profond** (cadres appelants < ≈ 300 o) ; pas d'appel depuis une interruption ; à mesurer (`[MEM]` / marquage de pile) lors du premier essai |
| RAM | firmwares R4 actuels : 19 128 à 22 768 o statiques (32 768 au total) + ≈ 2,7 Ko ⇒ **≈ 21,8 à 25,5 Ko** : reste ≈ 7 Ko pour la pile et le tas ; à confirmer sur le TFT 2,8" (le plus gros) |
| Ordre | flux → calcul → message → signature → vote ; fragments globaux **réutilisés** par le téléchargement des images |
| Manque de ressource | abstention, aucune réinitialisation |
| Microcarte SD (TFT 2,8") | peut conserver le clip (déjà fait pour l'affichage) : utile mais **non requis** |

### 5.4 Ce qui ne demande PAS de flash intermédiaire
Tout ce qui précède s'ajoute au **firmware unique du lot 8**. Les auto-tests de ce lot sont des exemples jetables ; la logique de production sera le **même noyau** (`podAnimV3.h`), sans copie.

## 6. Préparation de l'OTA (rien n'est implémenté ; faits relevés dans les cœurs installés)

### 6.1 ESP8266 (cœur 3.1.2) — faisable
- **`ESP8266httpUpdate`** (bibliothèque du cœur) + **`Updater`** : l'écriture de l'image se fait dans une zone de transit ; la copie sur le firmware actif est faite par `eboot` **au redémarrage** (`UPDATE_ERROR_*` : écriture, taille, magie, signature). Carte `nodemcuv2:eesz=4M2M` : menu du cœur « **4 Mo (FS : 2 Mo, OTA : ≈ 1 019 Ko)** » — notre auto-test occupe 278 Ko ; l'image de production devra être **mesurée** (≤ ≈ 1 019 Ko, et libre ≥ taille de la nouvelle image).
- **Signature intégrée au cœur** : `Updater::installSignature(UpdaterHashClass*, UpdaterVerifyClass*)` avec `BearSSL::SigningVerifier(PublicKey*)` : **RSA (PKCS#1 v1.5, SHA-256) ou clé EC**, signature **ajoutée au binaire** avec sa longueur (outil `tools/signing.py`, `openssl dgst -sha256 -sign`). Le cœur vérifie **avant** de valider (`UPDATE_ERROR_SIGN`). La clé publique est compilée si un fichier de clé publique accompagne le sketch (`ARDUINO_SIGNING`) ; **la clé privée ne doit jamais être dans le dépôt ni dans Vercel**. Coût mémoire : `SigningVerifier` réserve la **seconde pile BearSSL de 6 200 o** (`StackThunk`, comptée par référence : déjà payée si un client TLS BearSSL existe).
- **Pas de double banque ni de retour automatique** : si le nouveau firmware plante, l'ancien n'existe plus (récupération par câble). Atténuation à concevoir au lot 8 : compteur de démarrages en échec ⇒ **mode sûr** (portail Wi-Fi + recherche de mise à jour seulement), canari par vagues, procédure de récupération par câble documentée.
- **Option B (à arbitrer au lot 8)** : un **manifeste signé en Ed25519** (même primitive/bibliothèque que les votes) contenant `seq`, carte, écran, `sha256` et taille du binaire ; le firmware hache le flux, **compare à la valeur signée**, et `Update.abort()` en cas d'écart *avant* `Update.end()`. Avantage : une seule primitive de signature ; inconvénient : plus de code propre à auditer que le mécanisme du cœur.
- **Anti-retour arrière** : le cœur ne le fournit **pas** : numéro de séquence **dans le manifeste signé**, mémorisé sur l'appareil (LittleFS/EEPROM), n'acceptant qu'un `seq` strictement supérieur.

### 6.2 UNO R4 WiFi (cœur 1.5.3) — **RIEN À PROMETTRE pour l'instant**
- La bibliothèque `OTAUpdate` du cœur n'est qu'une **interface par commandes AT** vers le coprocesseur (`+OTABEGIN`, `+OTADOWNLOAD`, `+OTAVERIFY`, `+OTAUPDATE`, `setCACert` pour valider le serveur TLS). **`verify()` s'exécute dans le firmware du coprocesseur, absent du dépôt et non auditable ici** : on ne peut **pas** affirmer qu'il authentifie l'émetteur (une somme de contrôle ou un en-tête valide ne prouve rien sur l'origine).
- À vérifier **avant** toute promesse : format `.ota` (en-tête, compression, CRC), ce que contrôle réellement `verify()`, limites de taille (flash 262 144 o, image TFT 2,8" actuelle ≈ 88 Ko + écran), comportement après coupure de courant pendant `update()`, procédure de récupération (double appui sur reset / DFU).
- Si `verify()` n'authentifie pas : une **signature propre** (manifeste Ed25519 vérifié par le sketch **avant** d'appeler `update()`) reste possible mais **n'empêche pas** un binaire hors manifeste d'être installé si l'attaquant contrôle le transport ; à traiter par TLS authentifié + `setCACert`.

### 6.3 Principes communs (décisions du porteur / GPT)
| Point | Proposition |
|---|---|
| Clé privée de signature | générée et gardée **hors dépôt et hors Vercel** (poste du porteur) ; seule la **clé publique** est embarquée |
| Manifeste | `{seq, version, carte, écran, taille, sha256, url immuable, vague, notBefore}` signé ; fichier **statique immuable** (CDN / GitHub Release) |
| Pointeur | quelques octets dans la réponse du **pull existant** (clé de plus dans le `MGET` déjà émis : **0 commande**, **0 polling**) ; le binaire n'est téléchargé que si `seq` > local |
| Canari par vagues | pourcentage `vague` et seau = `hash(deviceId) mod 100` : déterministe, **sans état serveur** |
| Réglage Manuel / Automatique | par appareil, **Manuel par défaut** pendant la phase d'essai ; stocké dans l'enregistrement d'appareil **déjà lu** par le pull |
| Anti-retour arrière | `seq` signé, strictement croissant, mémorisé sur l'appareil |
| Tout cela arrive avec le **grand flash du lot 8** | le premier firmware OTA ne peut pas être installé à distance : c'est le dernier flash par câble |

## 7. Limites et ce qui n'est pas fait
| # | Point |
|---|---|
| L1 | **Aucune exécution sur carte.** Temps, tas libre réel, pile réelle, comportement du chien de garde : à relever par le porteur avec les deux exemples (`[ANIMTEST] RESULTAT PASS 36/36` attendu). |
| L2 | Les chiffres de flash incluent des données de test (24 179 o) et le texte du rapport : **ne pas lire +42 Ko / +36 Ko comme le coût de la production** (≈ +14 Ko / +8 Ko de code, borne haute, plus la table d'entropie déjà présente). |
| L3 | La pile de la R4 est **analysée statiquement**, avec la bibliothèque `Crypto 0.4.0` : une autre version du cœur ou de la bibliothèque change les chiffres. |
| L4 | `PodAnimStream` n'a que **88 à 104 octets** de marge sous 2 Ko. |
| L5 | L'OTA n'est ni écrite ni essayée ; la R4 reste « à vérifier ». |
| L6 | La stratégie ESP8266 « fichier d'abord » suppose LittleFS monté et ≥ 12 Ko libres ; le multiscreen l'utilise déjà pour les clips. |
| L7 | Le journal `votersExpected` de `candidate-clip` (réserve de GPT) est à corriger **avant l'activation de `shadow`**, pas dans ce lot. |

## 8. Rollback
Fichiers ajoutés (auto-tests, en-tête généré, archive de mesures, tests) + refactorisation de `consensus-pod/src/podAnimV3.h` (aucun résultat modifié). `git revert` du commit suffit ; aucun état, aucune variable, aucun firmware.
