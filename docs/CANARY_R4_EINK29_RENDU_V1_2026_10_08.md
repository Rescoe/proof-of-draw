# Canari du rendu v1 — UNO R4 WiFi + e-ink 2,9″ BWR (procédure, 08/10/2026)

| | |
|---|---|
| **⚠ MISE À JOUR 09/10/2026 (NETSTACK-WIFI-CALLS-FIX2)** | Le canari WIFI-CALLS-FIX1 a **validé sur la carte** les piles dédiées (Wi-Fi 448 – 608 o utilisés / marges ≥ 864 o, PodNet 812 o de marge, Ed25519 ≥ 708 o, erreurs 0, `/api/register` 200, marqueur intact) mais s'est arrêté à `6b` sur un **faux positif** de l'instrument (zone 0xA5 sous la limite, recouverte par les piles temporaires). FIX2 : seuls critères fatals = marqueur/longueur, SP, marge principale < 128 o ; plus de « pile max » ; 144 o = « sous l'objectif 256 » sans arrêt ; `wifiFailed` s'arrête avant tout journal sur GUARD. **À refaire APRÈS audit GPT : le même canari 1/1, SANS dessin, register puis 3 pulls pendant 5 min** ; si la marge principale reste ≥ 128 o, les marqueurs intacts et aucune phase PodNet/Wi-Fi fautive, une seule frame personnelle sera ensuite autorisée. Voir `docs/LOT_8B2B2_NETSTACK_WIFI_CALLS_FIX2_2026_10_09.md`. |
| **⚠ MISE À JOUR 09/10/2026 (NETSTACK-WIFI-CALLS-FIX1)** | Le canari FIX3-R1 a **prouvé** `macString : PREMIERE sous-phase fautive = 1` (R0 sain) : `WiFi.macAddress()` est la cause du dépassement de 24 o. Tous les appels directs au module Wi-Fi (`begin`, `status`, `localIP`, `firmwareVersion`, `RSSI`, `macAddress`) passent maintenant par une pile dédiée de 1 536 o (`podWifiRun`), échec fermé ; MAC en hexadécimal manuel. **À refaire APRÈS audit GPT : le canari SANS frame (register + 3 pulls, ~5 min) ; lire les lignes `[CANARY] wifi … utilisé/marge` (marge ≥ 256 attendue), l'absence de `macString : PREMIERE sous-phase …`, et PodNet enfin exercé (aucune `PodNet : PREMIERE phase fautive`).** Voir `docs/LOT_8B2B2_NETSTACK_WIFI_CALLS_FIX1_2026_10_09.md`. |
| **⚠ MISE À JOUR 09/10/2026 (NETSTACK-FIX3 → FIX3-R1)** | Le canari NETSTACK-FIX2 (sans frame) a VALIDÉ la pile réseau dédiée et PodEd mais relevé 24 o sous `__StackLimit` au point A, avant tout journal. Le canari FIX3 a ensuite donné **R0 sain, R1 en alerte** : le marqueur est détruit **dans `macString()`**, avant toute transaction PodNet (**PodNet non exonéré par le matériel**, ses sondes n'ont pas été exercées). FIX3-R1 ajoute trois sous-phases silencieuses dans `macString()` (appel au module · `snprintf` · construction du `String`) et rend `logfSafeStop()` silencieux. **À refaire APRÈS audit GPT : le canari SANS frame (register + 3 pulls, ~5 min) ; lire la ligne `macString : PREMIERE sous-phase fautive = n` (ou `R1`/`R2`/`phase`).** Voir `docs/LOT_8B2B2_NETSTACK_FIX3_R1_2026_10_09.md`. |
| **⚠ MISE À JOUR (même jour, après rédaction)** | **Le porteur a flashé un build local équivalent et seulement DÉMARRÉ la carte (aucune frame envoyée).** Le journal montre `[MEM] après Ed25519: … pile max ~1732 o` puis `[CANARY] prêt: ALERTE PILE — marqueur de fond écrasé…` : **la pile principale (1 024 o) est dépassée par l'auto-test Ed25519 de démarrage — défaut PRÉEXISTANT au rendu v1, révélé par l'instrumentation du canari.** Carte débranchée, aucune œuvre envoyée. **Toute la procédure ci-dessous est SUSPENDUE** : ne pas envoyer de frame, ne pas reprendre le canari avant la correction et l'audit GPT (`docs/CORRECTIF_CANARI_R4_PILE_ED25519_2026_10_08.md`). **Correctif livré en local, compilé, testé sur l'hôte, JAMAIS sur une carte** : `docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md` (Ed25519 sur pile dédiée, `PodEd`). **Mise à jour NETSTACK-FIX2 (09/10/2026)** : la pile réseau dédiée est VALIDÉE sur carte ; l'alerte suivante venait des E/S de journal posées sur 608 o de cadres — `logf` et l'instrument passent désormais par une pile de journal dédiée, points silencieux A/B/C, sonde `[CANARY] pile de journal …` ; protocole et critères : `docs/LOT_8B2B2_NETSTACK_FIX2_2026_10_09.md` § 6. **Mise à jour NETSTACK-FIX1 (09/10/2026)** : le second canari a PROUVÉ le débordement (`connect()` : 1 480 o sur 1 024 o) ; toute transaction réseau passe désormais par une pile dédiée — protocole du canari sans frame (register + ≥ 3 pulls) et critères : `docs/LOT_8B2B2_NETSTACK_FIX1_2026_10_09.md` § 6 ; les points « http: apres … » à l'intérieur des transactions sont remplacés par les lignes `[CANARY] net …` (après chaque transaction). **Mise à jour BOOT-FIX2** : `PodEd` est validé sur carte, mais le démarrage complet détruit encore le marqueur avant « prêt » ; nouvel instrument (points de contrôle cumulatifs, verrou fatal) et protocole de démarrage SANS frame : `docs/LOT_8B2B2_BOOTFIX2_2026_10_08.md`. Les binaires `canary-builds/` actuels sont ANTÉRIEURS au correctif et ne doivent plus être flashés : après audit GPT, les reconstruire, puis d'abord le micro-canari `Ed25519StackProbeUnoR4`, puis un démarrage complet sans frame (nouvelle ligne `[ED25519] pile dédiée …`), et seulement alors une frame. |
| **Statut (avant la mise à jour)** | **PRÉPARATION seulement : rien n'a été flashé.** Le dépôt garde `POD_RENDER_V1 = 0` ; le canari est un **build local temporaire** (`-DPOD_RENDER_V1=1 -DPOD_CANARY=1`), jamais commité. |
| **Périmètre** | **un seul** firmware : `arduino_uno_r4/pod_uno_r4_eink29` (cas mémoire / pile le plus critique). Pas de canari TFT, pas de canari 2,7″ dans ce document. |
| **Aucun changement** | serveur, Redis, Neon, ACK, vote, OTA, fréquence de polling : **inchangés**. Le firmware annoncé au serveur reste `r4eink29-1.1` (le canari se reconnaît au moniteur série, pas côté serveur). |
| **Ce qui change dans le firmware** | l'image reçue est rendue par le noyau v1 (cartel + `fit`) et remise au panneau par morceaux de 32 o ; `frameHash` / `renderHash` sont journalisés ; l'instrumentation `[CANARY]` mesure la **pile réelle** (peinture de la pile principale). |
| **Durée d'un essai** | ≈ 25 min (flash, boot, une frame, vérification, retour au stable). **Un seul affichage réel** est suffisant. |

## 1. Pré-vol : ce qu'on sait, ce qu'on ne sait pas

* **Compilé seulement.** Jamais exécuté sur une carte : ni la pile réelle, ni les couleurs, ni l'orientation, ni les durées, ni le comportement de BUSY avec ce chemin n'ont été observés.
* **Constat matériel (premier démarrage du canari) : la pile de 1 024 o est dépassée au démarrage, avant tout rendu** — `pile max ~1732 o` (≈ 708 o écrits sous la limite, dans le haut du tas réservé) et marqueur de fond détruit, après `[SELFTEST] Ed25519` ; la bibliothèque Crypto 0.4.0 demande ≈ 1,5 Kio de pile pour Ed25519. L'estimation « ≈ 736 o » ci-dessous ne concerne que le chemin de rendu et **ne tient donc pas** tant que ce défaut n'est pas corrigé. Les mesures `[CANARY]` ci-dessous détectent exactement ce cas (`ALERTE PILE`).
* Mémoire (compilation) : RAM statique **22 768 o** (identique au firmware stable : le renderer vit dans la zone qui remplace `qrData[600]`) ; marge statique 528 o ; **pile estimée par addition des cadres statiques ≈ 736 o sur 1 024 o, NON mesurée** — c'est ce que le canari mesure.
* Le firmware stable sert de **retour arrière** (§ 7) : il est compilé dans le même état de dépôt.
* Si le canari échoue, **ne pas laisser la carte tourner** (retour immédiat, § 7) : une frame personnelle non acquittée est re-proposée à chaque pull (60 s : une boucle de tentatives) et chaque tentative rafraîchit le panneau (§ 6).

## 2. Les deux binaires locaux

Générés depuis le **même** état du dépôt (`git rev-parse HEAD` noté dans `canary-builds/MANIFEST.txt`), avec **votre** `secrets.h` local ⇒ **les binaires contiennent vos identifiants Wi-Fi** : dossier `canary-builds/` **ignoré par git** (`.gitignore`, testé), **jamais commité** ni partagé.

```
canary-builds/stable/   pod_uno_r4_eink29.ino.{bin,hex,elf}   ← POD_RENDER_V1=0 : RETOUR ARRIÈRE
canary-builds/canary/   pod_uno_r4_eink29.ino.{bin,hex,elf}   ← POD_RENDER_V1=1 + POD_CANARY=1 : le CANARI
canary-builds/MANIFEST.txt                                     ← commit, empreintes SHA-256, tailles
```

Commandes (depuis la racine du dépôt ; `arduino-cli` = celui de l'IDE Arduino) :

```bash
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi --build-property "compiler.cpp.extra_flags=-DPOD_RENDER_V1=0" --output-dir canary-builds/stable arduino_uno_r4/pod_uno_r4_eink29
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi --build-property "compiler.cpp.extra_flags=-DPOD_RENDER_V1=1 -DPOD_CANARY=1" --output-dir canary-builds/canary arduino_uno_r4/pod_uno_r4_eink29
sha256sum canary-builds/stable/*.bin canary-builds/canary/*.bin
```

Mesures de compilation (`--warnings all`, aucun avertissement du dépôt) : stable **118 436 o** de flash, canari **122 508 o** ; RAM statique **22 768 o** dans les deux cas ; cadre de `doPull` 408 o (stable) / 440 o (canari : +8 o d'instrumentation) ; `podCanaryReport` 40 o. Les symboles du script d'édition de liens : pile principale `[0x20007B00, 0x20007F00]` (1 024 o), `__HeapBase` = `0x20005908` ⇒ « RAM statique » journalisée = **22 792 o** (22 768 + alignement).

**Piège constaté** : basculer `POD_RENDER_V1` / `POD_CANARY` à 1 DANS le `.ino` versionné (pour compiler avec l'IDE) fait « fuiter » ce défaut dans le dépôt ; les tests (`renderFirmware`, `canaryPrep`) échouent alors et le commit est refusé — ils ont d'ailleurs détecté la bascule pendant la préparation. **Avec l'IDE Arduino** (sans `arduino-cli`) : ne pas modifier le `.ino` versionné. Copier le dossier du sketch dans un dossier temporaire, ajouter **tout en haut** du `.ino` copié `#define POD_RENDER_V1 1` et `#define POD_CANARY 1`, compiler et téléverser **depuis la copie** ; pour le retour arrière, téléverser le sketch versionné tel quel.

## 3. Flasher le canari (EEPROM conservée)

> **SUSPENDU** — ne suivre ce § 3 qu'après correction de la pile et feu vert de l'audit GPT (voir la mise à jour en tête de document). Ordre de reprise fixé par GPT : micro-canari Ed25519 sans écran ni frame → démarrage complet sans frame → seulement alors UNE frame personnelle.

1. Brancher la R4 ; `arduino-cli board list` donne le port (ex. `COM5`). Ouvrir le moniteur série à **115200** et **enregistrer la sortie dans un fichier** (`canary-AAAAMMJJ.log`).
2. Téléverser (aucun effacement de l'EEPROM n'est demandé ; l'EEPROM de la R4 est une flash de données séparée du code) :
   ```bash
   arduino-cli upload -p COM5 --fqbn arduino:renesas_uno:unor4wifi --input-dir canary-builds/canary
   ```
3. À la sortie du téléversement la carte redémarre : le moniteur doit montrer la **bannière CANARY** (§ 5.1). Si elle manque, **ce n'est pas le canari** : ne rien envoyer, revenir au § 7.

## 4. Provoquer une frame réellement NOUVELLE sans effacer l'EEPROM

Le firmware compare l'identifiant de la frame annoncée à celui gardé en EEPROM (`frameKey`, 32 premiers caractères) ; une œuvre déjà affichée n'est **pas** réaffichée (`[PULL] frame déjà affichée`). **L'EEPROM n'est PAS effacée** (elle garde les clés Ed25519 et l'appairage). Pour obtenir une frame nouvelle :

1. Ouvrir le site, **dans la session propriétaire de la carte**, une œuvre de la galerie (page du bloc, `app/BlockDetail.tsx`) → encadré **« Afficher sur mon écran »** → choisir **cet appareil et l'écran e-ink 2,9″** → **Envoyer**. (Route `/api/send-to-screen`.)
2. Chaque envoi crée une **frame personnelle** avec un **UUID neuf** (`frameId`) : même si c'est la même œuvre que celle déjà à l'écran, c'est une frame nouvelle pour la carte. Pas de quorum, pas de vote ; limite serveur : 10 envois / heure / appareil ; la frame est effacée au prochain bloc validé par la pool de l'appareil (et n'est **pas** supprimée par l'ACK : elle sert aussi à restaurer l'image après un redémarrage).
3. **Ne pas attendre passivement** : au repos, le serveur annonce un `retryAfter` de **300 à 900 s** — la carte ne tirerait la frame que 5 à 15 min plus tard. Pour la faire tirer tout de suite **sans changer aucune fréquence de polling**, **appuyer UNE fois sur le bouton reset** : le démarrage fait « premier pull immédiat » (l'EEPROM est conservée, la frame personnelle est nouvelle ⇒ affichée). **Un seul reset** (chaque boot refait l'auto-test Ed25519 et un pull).
4. Choisir une œuvre qui permet de juger : **du rouge** (plan rouge), un **bord noir** près des bandes, un **titre/artiste avec accents ou assez long** (troncature à 48 caractères). Un seul affichage suffit ; un second envoi (autre œuvre) seulement si le premier est concluant.
5. *(Optionnel, comparaison)* avec le firmware **stable** sur la carte, envoyer d'abord la **même** œuvre et photographier l'écran : on comparera l'ancien cartel (gravé en place) au nouveau (`fit`, entre les bandes).

## 5. Lignes série attendues (chaque ligne existe dans le firmware ; test `canaryPrep`)

Les valeurs entre `<…>` varient. Ordre chronologique d'un essai réussi.

### 5.1 Démarrage et mémoire
| Ligne | Signification |
|---|---|
| `[BOOT] Proof-of-Draw UNO R4 WiFi + e-ink 2.9" BWR — <version>` | version `r4eink29-1.1` (inchangée) |
| `[MEM] <étiquette>: tas libre <N> o, zone 0xA5 sous la pile <N> o (INDICATIF : NON fiable des la 1re pile temporaire)` | mesure d'origine, **rebaptisée par WIFI-CALLS-FIX2** : l'ancien « pile max ~N » observait la zone 0xA5 peinte sous `__StackLimit`, recouverte légitimement par les piles temporaires du tas (PodEd, PodNet, Wi-Fi, journal) → valeur **non interprétable** dès la première ; la mesure de pile principale fiable est la ligne `[CANARY] … pile utilisee au plus …` |
| `[CANARY] ===== BUILD LOCAL TEMPORAIRE DE CANARI — rendu v1 ACTIF (POD_RENDER_V1=1, mode=<N>) — NE PAS DÉPLOYER, NE PAS COMMITER LE BINAIRE =====` | **bannière : preuve que le canari est bien chargé** (`mode=1` = fit) |
| `[CANARY] firmware annoncé au serveur : <version> (inchangé) ; pile principale [<bas>, <haut>] ; SP=<adresse>` | attendu : `[0x20007b00, 0x20007f00]` et SP **dans** cet intervalle (sinon `loop()` ne tourne pas sur la pile principale : mesure invalide, arrêt) |
| `[CANARY] <étiquette> : pile utilisee au plus <N> o / 1024 (marge <N> o) \| SP=<adresse> \| tas libre <N> \| sbrk->limite <N>` | **la mesure de pile PRINCIPALE réelle, CUMULATIVE** (la peinture n'est jamais refaite) à chaque point de contrôle ; une marge entre 128 et 255 o s'affiche `(marge <N> o, SOUS L'OBJECTIF 256)` **sans arrêt** (WIFI-CALLS-FIX2). Depuis WIFI-CALLS-FIX2 la ligne ne porte plus de « pile max » : la zone 0xA5 peinte SOUS `__StackLimit` est légitimement écrasée par les piles temporaires allouées dans le tas (PodEd, PodNet, Wi-Fi, journal) et n'est plus une mesure valide ni un critère fatal |
| `[CANARY] <étiquette> : ALERTE PILE utilisee au plus <N> o / 1024 (marge <N> o) \| SP=<adresse> \| tas libre <N> \| sbrk->limite <N>` | **anomalie** (marqueur ou longueur invalides, SP hors pile, ou marge principale < 128 o) : suivie de 5 lignes de diagnostic (marqueur, bornes, mallinfo, 32 octets autour de `__StackLimit`, zone 0xA5 sous la limite à titre **indicatif seulement**) puis du **verrou fatal** |
| `[CANARY]   marqueur=<0x…> <état> longueur peinte=<0x…> <état> \| plus bas octet modifie au-dessus du marqueur : <adresse ou AUCUN>` | diagnostic d'anomalie : marqueur détruit ou non, premier octet de peinture modifié (ou `AUCUN`) |
| `[CANARY]   __StackLimit=<0x…> __StackTop=<0x…> __HeapBase=<0x…> sbrk(0)=<0x…> SP <dans la pile ou HORS de la pile>` | diagnostic d'anomalie : bornes réelles et position du tas |
| `[CANARY]   mallinfo : arene=<N> utilise=<N> libre=<N>` | diagnostic d'anomalie : état du tas |
| `[CANARY] ARRET FATAL (verrou) apres '<étiquette>' : plus aucun pull, vote, ACK ni affichage. Debrancher la carte, reflasher le firmware stable.` | **le verrou est posé** (répété toutes les 10 s) : la carte ne fait plus rien d'autre |
| `[WIFI] firmware du module: <version>` | coprocesseur Wi-Fi |
| `[WIFI] IP: <adresse>` | Wi-Fi connecté |
| `[SELFTEST] Ed25519 signature <N> ms, vérification <N> ms -> <OK ou ECHEC>` | attendu `OK` |
| `[REGISTER] deviceId=<dev_XXXXXXXX> paired=<oui ou non>` | attendu `paired=oui` |
| `[BOOT] œuvre déjà affichée : <frameId>` | **confirme que l'EEPROM a survécu au flash** (absent si la carte n'avait jamais rien affiché : sans gravité) |
| `[BOOT] premier pull immédiat` | pull du démarrage |
| `[HTTP <méthode>] <chemin> -> <code>` | attendu `[HTTP GET] /api/pull?... -> 200` |
| `[PULL] cartel: <titre> / <artiste> (bloc <N>)` | métadonnées du cartel (repliées en ASCII) |
| `[PULL] nouvelle frame <frameId> (<source>)` | **attendu : source `personal`** (frame envoyée depuis la galerie) |
| `[BOOT] prêt — pull toutes les <N> s` | fin du setup |

Si le boot affiche `[PULL] frame déjà affichée` ou `[PULL] aucune frame` : l'envoi n'est pas arrivé, ou la carte a déjà cette frame — renvoyer l'œuvre (§ 4) puis **un** reset.

### 5.2 Une frame : récupération, rendu, remise, ACK
| Ligne | Signification |
|---|---|
| `[HTTP GET] /api/pull-frame -> <code> (contenu <N>)` | attendu `200 (contenu 9472)` |
| `[FRAME] lu noir=<N> rouge=<N> attendu=<N>` | attendu `lu noir=4736 rouge=4736 attendu=4736` |
| `[EINK] <page blanche ou image> <affichée ou ECHEC> en <N> ms` | `CLEAR_BEFORE_IMAGE=1` : une **page blanche** d'abord (~15 s), puis l'image |
| `[EINK] attente <N> ms (écart minimal entre rafraîchissements)` | garde-fou de 10 s entre rafraîchissements (éventuel) |
| `[CANARY] meta ts="<date>" artist="<artiste>" title="<titre>" bloc=<N> mode=<N>` | **les métadonnées exactes du rendu** (à recopier pour la vérification § 5.4) |
| `[RENDER] frameHash=<64 hex>` | hash des 9 472 octets **reçus** |
| `[RENDER] calculé ET remis au pilote en <N> ms — mode=<N> renderHash=<64 hex>` | **succès du rendu** : hash des octets réellement envoyés au panneau (≈ 15–20 s) |
| `[FRAME] OK en <N> ms (frameId=<id> source=<source>)` | l'affichage est terminé |
| `[CANARY] <étiquette> : pile utilisee au plus <N> o / 1024 (marge <N> o)` | étiquettes `apres affichage`, puis `apres ACK`, puis `apres pull (fin de doPull)` |
| `[ACK] <frameId> -> <OK ou FAIL>` | **attendu `OK`** (précédé de `[HTTP POST] /api/ack-frame -> 200`) |
| `[MEM] <étiquette>: tas libre <N> o, zone 0xA5 sous la pile <N> o (INDICATIF : NON fiable des la 1re pile temporaire)` | étiquette `après pull` ; la valeur est **indicative** (ne plus l'interpréter comme une pile max) |

### 5.3 Valeurs de référence et seuils
* `marge` de pile (dernier chiffre de la mesure `[CANARY] … après affichage`, la plus profonde attendue) : **estimation 288 o** (1 024 − 736) ; **seuil d'alerte 128 o** (le firmware affiche alors `ALERTE PILE`).
* Tas libre : comparable au firmware stable (pas de nouvelle allocation dynamique) ; une chute de plusieurs centaines d'octets entre deux pulls identiques = anomalie.
* RAM statique : **22 792** à tous les `[CANARY]` (elle ne bouge pas).

### 5.4 Vérifier les hashes HORS CARTE (optionnel mais recommandé)
La référence TypeScript recalcule les deux hashes à partir des 9 472 octets de la frame et des métadonnées du journal :
```bash
curl -o planes.bin "https://proof-of-draw.vercel.app/api/pull-frame?deviceId=dev_XXXXXXXX&screen=eink29bwr&fmt=bin"
node --import tsx scripts/canary-verify-render.ts --planes planes.bin --ts "<date>" --artist "<artiste>" --title "<titre>" --block <N> --mode fit
```
(`pull-frame` est en **lecture seule** ; la frame personnelle y reste disponible après l'ACK. Une seule requête manuelle.) La sortie `frameHash=… renderHash=…` doit être **identique** aux deux lignes `[RENDER]` de la carte. Un `frameHash` différent = octets reçus différents (réseau / lecture) ; un `renderHash` différent avec le même `frameHash` = **le rendu de la carte diffère de la référence** : défaut à analyser (voir critères d'arrêt).

### 5.5 Contrôle visuel (photographier l'écran)
Bande haute : date puis `#<bloc>`, texte noir centré, séparateur noir sous la bande ; bande basse : `ARTISTE - TITRE` en majuscules ASCII (accents repliés, `?`→espace), centré, séparateur noir au-dessus ; entre les bandes : l'image **entière réduite** (231 × 100 px, marges blanches de 32 px à gauche et à droite) avec le **rouge préservé** ; aucun trait parasite, aucune ligne décalée, aucune moitié d'image.

## 6. Critères d'arrêt — retour IMMÉDIAT au stable (§ 7)

Un seul critère suffit. **Pourquoi immédiatement** : si le rendu échoue, la frame personnelle n'est pas acquittée et la carte la retente **à chaque pull (60 s)** ; chaque tentative refait une page blanche + un rafraîchissement du panneau (garde-fou : 10 s), ce qui use le panneau.

| Critère | Comment le reconnaître |
|---|---|
| **Redémarrage inattendu** | un second `[BOOT] Proof-of-Draw …` sans reset de votre part, ou `[WIFI] échec — redémarrage` |
| **Blocage BUSY** | plus aucune ligne série depuis > 60 s après `[RENDER] frameHash=…` (le panneau attend BUSY ; `waitBusy` du pilote R4 : délai maximal 40 s) ; ou `[RENDER] rendu CALCULÉ … fin physique du rafraîchissement NON confirmée (BUSY expiré) — pas d'ACK` |
| **Absence d'ACK** | pas de `[ACK] <id> -> OK` après `[FRAME] OK`, ou `[ACK] <id> -> FAIL` |
| **Rendu incomplet / refusé** | `[RENDER] frameHash impossible — abandon`, `[RENDER] paramètres refusés — abandon`, `[RENDER] panneau non initialisé`, `[RENDER] production interrompue — rafraîchissement NON lancé`, `[RENDER] renderHash incomplet — abandon`, `[FRAME] affichage échoué — frame conservée côté serveur`, `[FRAME] image incomplète — pas d'ACK, nouvel essai au prochain pull`, `[EINK] init échoué` ; ou écran **blanc / partiellement dessiné / tronqué / décalé** |
| **Anomalie mémoire** | toute ligne `[CANARY] … ALERTE PILE …` (marge < 128 o, marqueur de fond écrasé, écriture sous `__StackLimit`, SP hors pile : le firmware pose alors lui-même un **verrou fatal**) ; SP hors de la pile principale ; `[MEM] … pile max ~<N>` avec N > 1024 ; RAM statique ≠ 22 792 ; tas libre qui s'effondre |
| **Hash divergent** | `renderHash` de la carte ≠ `canary-verify-render` pour le même `frameHash` (§ 5.4) |
| **Autre** | `[HTTP] connexion TLS impossible`, `corps incomplet`, erreur d'auto-test `ECHEC` |

## 7. Retour immédiat au firmware stable

```bash
arduino-cli upload -p COM5 --fqbn arduino:renesas_uno:unor4wifi --input-dir canary-builds/stable
```
Puis : **ne pas** effacer l'EEPROM ; vérifier au moniteur série que la bannière `[CANARY]` a **disparu** ; la dernière œuvre reste à l'écran (l'e-ink la conserve). Si le téléversement échoue (carte bloquée) : double-clic sur reset (mode bootloader), relancer la commande. L'IDE Arduino : ouvrir le sketch versionné **sans** modification et téléverser. Rien n'est à défaire côté serveur (aucune donnée serveur n'a été modifiée par le canari ; la frame personnelle expire seule).

## 8. À me rapporter après l'essai

1. Le fichier de journal **complet** (boot → ACK) ; 2. toutes les lignes `[CANARY] … pile utilisée` (surtout `après affichage`) ; 3. `frameHash` / `renderHash` de la carte **et** de `canary-verify-render` ; 4. les durées `[RENDER] … en <N> ms` et `[EINK] … en <N> ms` ; 5. une **photo** de l'écran ; 6. la présence de `[ACK] … -> OK` ; 7. tout critère du § 6 observé.
Ce que le canari ne prouve pas : le comportement sur la durée (un seul affichage), les autres firmwares (TFT 1,8″, e-ink 2,7″), le chien de garde des ESP8266. Suite prévue seulement si ce canari est concluant : canari ESP8266 TFT 1,8″ (couleurs, watchdog), puis ESP8266 e-ink 2,7″ (orientation, BUSY).

Rien de ce document ne commite de binaire, ne touche le serveur, Redis, Neon, l'ACK, le vote ou l'OTA ; aucun polling accéléré (un seul reset), jamais commité.
