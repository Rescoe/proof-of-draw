# LOT 8B-2B-2 — PULLFRAME-PHASE-AUDIT3 (10/10/2026)

**Instrumentation SEULE du canari. Aucune correction. Compilé (cœurs 1.5.3 ET 1.6.0) et testé sur l'hôte (flash simulée) : jamais flashé.** Base : `3ace43b`. Drapeaux committés : `POD_RENDER_V1 = 0`, `POD_CANARY = 0`. Serveur, Redis (+0), Neon (0), protocole, vote, ACK, rendu, OTA, polling, tailles de pile : inchangés.

## 1. Ce que le matériel a dit (canari AUDIT2, `3ace43b`)

Journal : `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT3_2026_10_10/journal-audit2-3ace43b-materiel.txt`. Le bon binaire tourne (ligne `BUILD PULLFRAME-PHASE-AUDIT2`, compilé à 20:35:21). Register et pull JSON sains (496 o / 700 o), puis `[PULL] nouvelle frame ce693868-… (personal)` (« Mouche a fleur / Roubzi », bloc 81) et silence. Le pull annonce un identifiant différent de celui de `6429e8f5…` : le porteur a renvoyé une image entre-temps (l'anomalie d'identifiant notée en AUDIT2 est donc expliquée).

- `FFREC … AUCUN enregistrement valide` : **valeur normale d'un premier démarrage après téléversement**. Le journal ne montre qu'UN démarrage : la conclusion de GPT (« `.noinit` est effacée au Reset ») n'est établie que si ce démarrage suivait un premier démarrage du même binaire. Non tranché ; sans importance pour AUDIT3, qui ne dépend plus de la RAM.
- `[FF00] PERDU (tampon USB trop plein)` : le jeton venait juste après la « sonde journal » de 250 caractères et trois lignes de rapport ; le FIFO USB de TX du cœur ne fait que 256 o. Il n'est donc pas surprenant qu'un jeton de 7 o y soit perdu juste après une rafale. **Au pull, aucune ligne de canari ne précède la ligne « nouvelle frame »** (la dernière est la ligne `pull JSON`, puis les trois lignes de production) : le tampon y avait le temps de se vider, et l'absence de tout jeton `[FF04]`… est un indice (faible, non concluant) que la phase 4 n'a pas été atteinte.

## 2. Audit préalable de l'EEPROM (demandé par GPT)

La « EEPROM » de la UNO R4 est de la **flash de données** (`FLASH_TOTAL_SIZE 0x2000` = 8 Ko, `FLASH_BLOCK_SIZE 0x400` = 1 Ko, soit 8 blocs, `variants/UNOWIFIR4/pins_arduino.h`), pilotée par `veeprom` (`libraries/BlockDevices/virtualEEPROM.cpp`).

| Zone (adresse logique) | Contenu (e-ink 2,9″) | Fin |
|---|---|---|
| 0 – 31 | clé privée Ed25519 | 32 |
| 32 – 63 | hash du dernier bloc | 64 |
| 64 | drapeau « clés générées » (0xED) | 65 |
| 65 – 96 | clé publique | 97 |
| 97 | drapeau d'accueil | 98 |
| 98, 99 | tête / compte des hashes « à moi » | 100 |
| 100 – 419 | 10 hashes de 32 o | 420 |
| 420 – 451 | identifiant de la frame affichée (état du firmware) | **452** |
| 452 – 1023 | libres | |
| 1024 – 7167 (blocs 1 à 6) | libres | |
| **7168 – 8191 (0x1C00 – 0x1FFF, bloc 7)** | **journal du canari (ce lot)** | 8192 |

Les quatre autres firmwares R4 ont la même carte (un test le vérifie : aucune donnée ne dépasse 1 024 o). **Tout tient dans le bloc 0.**

Risques de la voie « `EEPROM.update` » (GPT) relevés dans le cœur :
- chaque écriture d'une valeur modifiée **alloue une page de 1 Ko au tas** (`new uint8_t[1024]`, `veeprom::read_block`), efface le bloc de 1 Ko puis le **reprogramme en entier** (1 024 octets), puis libère la page ;
- 15 marques = 15 allocations de 1 Ko au tas, au moment exact où l'on soupçonne le tas, plus 15 effacements : intrusif et usant ;
- le bloc 0 (clés) ne serait pas touché tant que l'adresse est dans un autre bloc.

**Choix du lot :** ne pas passer par `EEPROM.update`. On utilise `DataFlashBlockDevice::getInstance().program(&octet, adresse, 1)` du cœur : **un octet vierge programmé**, sans page au tas, sans effacement (le bloc 7 est effacé UNE fois au démarrage). Cette fonction est celle qu'`EEPROM` appelle déjà (même pilote `R_FLASH_LP`, unité d'écriture `BSP_FEATURE_FLASH_LP_DF_WRITE_SIZE = 1`). Un registre de sauvegarde RA4M1 n'a PAS été étudié (« étudier d'abord » seulement si l'EEPROM était inutilisable : elle l'est sans risque ici).

## 3. Conception

Zone : **bloc 7**, adresses logiques `0x1C00 – 0x1FFF`. Format :

```
0x1C00  'F' 'F' 'L' '3'  gen  ~gen  0xFF 0xFF        en-tête de 8 o (magie, génération, complément de la génération)
0x1C08  entrées d'UN octet : (phase << 4) | (~phase & 0x0F)   phase 0 = armement ; 1..15 ; 0xBD = pile principale détruite ; 0xFF = vierge
```

- **Octet de phase = numéro (4 bits) + son complément (4 bits)** : une programmation interrompue ne ressemble à aucune phase (0xFF et 0x00 sont invalides). Chaque marque programme **un seul octet** (au plus une écriture par phase) ; le contrôle du marqueur de pile principale ajoute `0xBD` (une fois par marque tant qu'il est détruit).
- **Démarrage (`podFfBoot`, canari seulement, appelé juste après la ligne `1b`)** : ligne `BUILD PULLFRAME-PHASE-AUDIT3 | base 3ace43b | … | compile <date> <heure>` ; lecture PROTÉGÉE du journal précédent (en-tête valide seulement si la magie ET le complément de la génération concordent ; lecture par blocs de 32 o, arrêt au premier octet vierge ; octets invalides comptés et signalés `?`) ; rapport `FFLOG demarrage precedent : gen=… ; N entrees ; DERNIERE PHASE P (nom) ; sequence : 0123456789abcdef` ; puis réarmement : **effacement du bloc 7**, en-tête, octet d'armement 0, **relecture de contrôle** ; le journal n'est armé (`g_podFfPos`) que si l'écriture ET la relecture ont réussi, sinon `DESACTIVE` et plus aucune écriture. Si le journal précédent est vide (rien après l'armement), **on n'efface pas** : on continue à la suite.
- **Jeton série** : un octet « lettre » (`'A' + phase − 1`, soit `D` … `N`) par `Serial.write`, **seulement pour les phases 4 à 14** (pile réseau dédiée) et **seulement si `availableForWrite() >= 1`** ; sinon perdu. Au démarrage, jeton de contrôle `Z` (rapporté ⇒ « ecrit » ou « perdu »). Aucun `logf`, formatage, `String`, allocation ni attente dans une marque.
- **Phases 1, 2, 3 et 15 (pile principale)** : écriture flash seulement, aucune E/S série.
- **« Silencieux avant `doFetchFrame` » (consigne GPT)** : vérifié, rien à faire : entre la dernière ligne de production (`nouvelle frame`) et la phase 4, AUCUNE ligne de canari n'est imprimée ; la perte du jeton de contrôle venait du démarrage (sonde de 250 caractères), pas du pull.
- **Statiques** : `g_podFfPhase` (1 o) et `g_podFfPos` (2 o). L'enregistrement `.noinit` d'AUDIT2 est supprimé.
- **Aucune logique de téléchargement, de rendu ou d'affichage n'est modifiée.**

## 4. Usure et nombre maximal d'écritures

- **Effacements** : au plus UN par démarrage, et AUCUN si le journal précédent est vide (un démarrage qui meurt avant la marque 1 ne consomme rien). Même avec une carte qui redémarre sans fin avec des phases, le coût est d'un effacement par démarrage ; l'endurance de la flash de données RA4M1 est de l'ordre de 10⁵ à 10⁶ cycles d'effacement par bloc (à confirmer sur la fiche technique) ; le bloc 7 n'est utilisé par rien d'autre.
- **Programmations** : au plus 1 016 octets par démarrage (taille du bloc moins l'en-tête) ; le journal plein devient silencieux. Un téléchargement complet = 15 octets (+ les `0xBD` éventuels).
- **Production** : le mécanisme n'existe QUE sous `POD_RENDER_V1 && POD_CANARY` (testé : aucune occurrence de `DataFlashBlockDevice`, `POD_FFL_` ou `podFf` hors des blocs de canari). Le bloc 7 n'est jamais lu ni écrit par la production.
- **Effacement du bloc 7 seulement** : la fonction `erase` reçoit `(0x1C00, 0x400)` ; le harnais refuse tout effacement ou toute programmation hors de ce bloc, et vérifie que le bloc 0 (clés, sentinelle) reste identique.

## 5. Coûts mesurés (ELF, cœurs 1.5.3 = 1.6.0)

| | AUDIT2 (`3ace43b`) | AUDIT3 |
|---|---|---|
| Production OFF, flash | 124 580 o | 124 612 o (+32 : longueur du chemin de build) |
| Production, RAM statique | 22 768 o | 22 768 o |
| Canari, flash | 137 820 o | 138 716 o (+896) |
| Canari, RAM statique | 22 784 o | 22 784 o |
| Chaînes statiques `setup`/`loop → doPull` (canari) | 800 / 632 o | **800 / 632 o (identiques)** ; cadre de `setup` 224 o (`podFfBoot` est `noinline` : sinon `setup` gagnait 16 o et la marge du point `7b` repassait sous 128 o) |
| Pile réseau, lambda de `doFetchFrame` | 248 o, reste 880 o | **248 o, reste 880 o (identiques)** |

Production : **texte du sketch identique à `3ace43b` hors blocs de canari** (vérifié) ; désassemblage normalisé OFF : 1 030 / 1 036 fonctions identiques, les 6 autres sont des données et du chemin de build.

Pile de l'écriture flash (analyse statique, `DataFlashBlockDevice::program` est virtuelle donc suivie à la main) : `podFfNote` 8 o + `podFfAppend` 40 o + `program` 4 o + `write` 40 o + `R_FLASH_LP_Write` 72 o ≈ **165 o**. Aux phases de la pile principale (au niveau de `doPull` : 440 o depuis `setup`, 272 o depuis `loop`), cela donne ≈ 605 o au plus, soit ≈ 420 o de marge avant les interruptions (la profondeur de l'interruption USB n'est pas mesurée ; les points de contrôle `7a`/`7b`/`1c` la montreront). Un octet `0xBD` apparaît dans le journal si le marqueur de pile est détruit.

## 6. Tests

`tests/pullFramePhases.test.ts` (réécrit) :
- **statique** : 15 marques seules dans leur bloc gardé et dans l'ordre ; `podFfNote` sans `logf`/`String`/allocation/boucle, une inscription flash PAR marque avant le jeton, jeton d'un octet pour 4 à 14 sous `availableForWrite() >= 1` ; `podFfAppend` = UNE programmation d'UN octet dans le bloc 7, journal non armé/plein sans écriture, toute erreur désactive ; `podFfBoot` = UN effacement du bloc 7, en-tête validé par magie ET complément, pas d'effacement si le journal précédent est vide, armement seulement après écriture ET relecture ; aucun `EEPROM.xxx` ; **22 mutants + 15 suppressions refusés** ;
- **carte EEPROM** : dans les cinq firmwares R4, aucune donnée EEPROM ne dépasse le bloc 0 (452 o pour le e-ink 2,9″) ; le journal est le dernier bloc, aligné ;
- **HÔTE (`consensus-pod/host/ffl_harness.cpp`, code RÉEL du sketch contre une flash simulée : programmation = ET binaire, effacement par bloc, pannes injectées)** : 14 scénarios (bloc vierge, 15 phases, blocage à la phase 6, démarrages sans phase ⇒ un seul effacement, 40 blocs aléatoires, 40 journaux à entrées aléatoires, octet interrompu, effacement ou programmation refusés, tampon USB plein, pile détruite, journal plein, journal non armé, usure sur 20 démarrages, en-tête à complément ou magie faux) ; **15 mutants du harnais refusés** ;
- `canaryPrep` (quatre statiques initialisés, trois fonctions pures autorisées), `canaryBootFix2` (point `1c`).

Suite : 726 / 728 dans l'arbre du porteur à 0/0 (les 2 échecs habituels viennent de ses copies locales) ; 728 / 728 en clone propre (à confirmer ci-dessous).

## 7. Protocole du prochain canari (après audit GPT)

Même fichier local `1`/`1`, **sans renvoyer d'image ni de dessin** (la frame en attente est le bon test). La première fois, le journal est vierge.

1. Flasher, moniteur ouvert. Relever : `BUILD PULLFRAME-PHASE-AUDIT3`, `FFLOG demarrage precedent : AUCUN journal valide`, `FFLOG arme : gen=1 ; ecriture + relecture OK`, éventuellement une lettre `Z` collée au début d'une ligne (jeton de contrôle).
2. Le premier pull télécharge la frame en attente. Copier TOUT le journal, silence final compris, y compris d'éventuelles lettres `D`…`N` (une lettre = une phase atteinte). Attendre au moins 2 minutes (`connect` ≤ 50 s ; en-tête ≤ 20 s).
3. **Si le firmware se tait : appuyer UNE fois sur Reset.** Les premières lignes du démarrage suivant donnent `FFLOG demarrage precedent : gen=1 ; N entrees ; DERNIERE PHASE P (nom) ; sequence : 0123…`. Cette lecture survit au Reset et à la mise hors tension.
4. Côté Vercel, relever en parallèle `/api/register`, `/api/pull`, `/api/pull-frame` pour l'heure du démarrage : `/api/pull-frame` présent = la requête a atteint le serveur (le blocage est alors après la phase 8).

Légende de la séquence : `0` armement ; `1` à `9` ; `a` à `f` = phases 10 à 15 ; `!` = marqueur de la pile principale détruit après la phase précédente ; `?` = octet invalide (écriture interrompue).

## 8. Table de lecture (dernière phase atteinte → zone suspecte)

| Dernière phase | Le blocage est entre … et … |
|---|---|
| aucune (`AUCUNE phase atteinte`) | le `logf` « nouvelle frame » (épilogue : `SP`, effacement, `free`) et la marque 1 — ou la première écriture flash elle-même |
| 1 | l'appel de `doFetchFrame` et sa marque 2 (prologue, `PodNetInfo`) |
| 2 | marque 2 → marque 3 (construction de la lambda) |
| 3 | `podNetRun` : allocation de 2 048 o, peinture, trampoline, avant la transaction |
| 4 | construction de `Conn` / `WiFiSSLClient` (marque 5), tas |
| 5 | construction de l'URL (`String`) et début de `request` (marque 6) |
| 6 | `client.connect` (borné ≈ 50 s par les commandes AT ; au-delà, anormal) |
| 7 | construction de la requête (`String`) avant `client.print` (marque 8) |
| 8 | `client.print` (écriture TLS) |
| 9 | `readHeaders` (borné 20 s par ligne) |
| 10 | le `logf` `[HTTP GET] … pull-frame` ou le début de la lecture du plan noir |
| 11 | lecture du plan rouge |
| 12 | le `logf` `[FRAME] lu …` ou `readBody` suivant |
| 13 | `client.stop()` |
| 14 | retour de la lambda, épilogue de `podNetRun` |
| 15 | après `podNetRun` : journal `net`, ACK/rendu |

## 9. Réserves

- **Rien n'est flashé** : l'écriture réelle de la flash de données au milieu du dialogue TLS (durée d'un octet programmé, interaction avec les interruptions USB et UART du module Wi-Fi) n'a jamais été observée ; l'hôte ne prouve que la logique. Une programmation d'un octet est très courte devant l'effacement ou la page de 1 Ko d'`EEPROM.update`, mais ce n'est pas mesuré. **Si les marques perturbent le téléchargement lui-même, le résultat le montrera (le blocage disparaît ou se déplace)** : à garder à l'esprit à la lecture.
- `DataFlashBlockDevice::read` renvoie un code d'erreur trompeur quand le pilote est DÉJÀ ouvert (le code lit quand même) : le lot ne s'appuie pas sur son code de retour, seulement sur les données et la relecture de contrôle de l'armement.
- La lecture du rapport au démarrage suivant se fait sur la pile principale (cadre de `podFfBoot` : 136 o), rapport imprimé par `logf` (pile de journal).
- L'idée d'afficher la phase sur la **matrice de LED** de la carte (fonctionne sans USB, sans tas et sans reset) n'a pas été évaluée : à envisager si le journal en flash ne suffit pas.
- Le cœur effectivement flashé (1.5.3 ou 1.6.0) n'est toujours pas connu.
- Aucune récupération n'est implémentée. TFT 2,8″ : toujours BLOQUÉ.

## 10. Archives

`docs/AUDIT_GPT_AUDIT2_PULLFRAME_2026_10_10.md`, `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT3_2026_10_10/` (journal série d'AUDIT2, chaînes statiques avant/après, pile réseau, comparaison de production, tailles), sauvegarde `firmware-backups/2026-10-10_avant-pullframe-phase-audit3/`, harnais `consensus-pod/host/ffl_harness.cpp`.
