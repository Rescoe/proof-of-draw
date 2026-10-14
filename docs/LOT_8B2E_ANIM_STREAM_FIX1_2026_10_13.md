# LOT8B2E — ANIM-STREAM-FIX1 : clip d'animation PBC1 en FLUX sur la carte SD (UNO R4 + TFT 2,8″)

**Base :** `1bb2512` (archive du verdict FIX2) sur `f1471d4` (REGISTER-STACK-FIX2), branche `claude/r4-tft28-canary-8b2d`. **Périmètre :** `arduino_uno_r4/pod_uno_r4/` SEUL (firmware TFT 2,8″). **État :** compilé (cœurs 1.5.3 et 1.6.0, production et canari) + hôte ; **JAMAIS flashé** ; aucun vote ; `POD_RENDER_V1 = 0`, `POD_CANARY = 0` dans le commit ; aucun changement de serveur, Redis, Neon, protocole, polling, OTA, rendu, cartel, tactile ni des autres firmwares.

## 1. Le défaut (verdict matériel FIX2, `docs/mesures/8B2D_2026_10_12/fix2/verdict-materiel-fix2.md`)

Avec un clip résident sur la SD : `[ANIM] mémoire insuffisante pour la lecture` puis `[ANIM] lecture impossible : animation abandonnée (l'affiche reste)`. Tas libre ≈ 8 Ko, **plus grand bloc contigu 4 884 o**, fragmentation ≈ 40 % : l'ancien code allouait le clip ENTIER (jusqu'à `BENCH_MAX_CLIP` = 9 216 o) puis 1 024 o pour l'image courante, **au téléchargement comme à la lecture**. L'échec était propre (échec fermé, frames suivantes intactes) mais l'animation ne pouvait jamais jouer pour un clip de plus de ≈ 3,8 Ko.

## 2. Principe

| étape | avant | après |
|---|---|---|
| téléchargement | `malloc(announced)` + `readBody` en RAM, puis écriture SD | blocs de 480 o (`g_row`, statique) écrits sur la carte **au fil de la réception**, dans la transaction réseau (même schéma que `streamFrame`, déjà validé sur la carte) |
| validation | `podbench::parse` sur le clip en RAM | `podbench::validateStream` **en flux depuis la carte** (mêmes règles, mêmes codes d'erreur) |
| lecture | clip entier en RAM + 1 024 o | **2 048 o de travail** (image courante 1 024 o + tampon 1 024 o), quelle que soit la taille du clip ; lecture en flux par lots de runs |
| allocation maximale | 9 216 o + 1 024 o | **2 048 o** (+ piles dédiées 1 536 / 2 048 o, inchangées) |

Fichiers : `arduino_uno_r4/pod_uno_r4/pod_bench_stream.h` (NOUVEAU, propre à ce dossier ; `pod_bench.h` et ses copies sont **inchangés**), `pod_uno_r4.ino` (`netGetBlockClipToSd`, `animRemoveFiles`, `animValidateAndMark`, `fetchAnimToSd`, `runResidentAnim`, `SdClipSource`), sauvegarde `firmware-backups/2026-10-13_avant-animation-flux-tft28/pod_uno_r4.ino`.

### Contrat du lecteur en flux
- **Validation identique.** `validateStream` rend EXACTEMENT le code de `podbench::parse` (SHORT, MAGIC, VERSION, GEOM, COUNTS, SIZE, CRC, BODY) : 1re passe CRC de l'en-tête et du corps, 2e passe structure (transitions, runs, bornes), puis relecture de l'image 0 comparée **octet par octet** à l'état final (la dernière transition ramène à l'image 0). Une lecture qui échoue donne `ERR_IO` (jamais « à moitié valide »). La validation est refaite à CHAQUE lecture (comme l'ancien `parse` : une carte altérée est refusée).
- **Lecture identique.** `playStream` reproduit `playWith` : mêmes fenêtres, mêmes pixels, mêmes délais (différentiel hôte contre `podbench::play`). Une boucle = une seule `seek` (retour au début des transitions).
- **Bus SPI partagé (carte SD + TFT).** Aucune lecture de la carte entre `tft.startWrite()` et `tft.endWrite()` : une transition est lue PAR LOTS de runs entiers dans le tampon, puis peinte dans UNE transaction par lot (les transitions usuelles tiennent dans un lot : même nombre de transactions que le lecteur en RAM).
- **Ordre d'écriture inchangé et plus sûr.** Marqueur supprimé → clip écrit (au fil de l'eau) → clip validé depuis la carte (taille rangée == taille annoncée) → marqueur écrit EN DERNIER. Tout échec (réseau, écriture, validation, pile dédiée) supprime clip et marqueur ; l'affiche reste.
- **Piles.** Téléchargement + écriture : pile RÉSEAU dédiée (comme `streamFrame`). Suppression, validation et lecture (SD + TFT + toucher) : pile SD dédiée (`onSd`), la lecture entière sur UNE pile. Jamais imbriquées (inchangé).

## 3. Preuves

| preuve | résultat |
|---|---|
| `tests/animStream.test.ts` (g++ sur l'hôte, 8 tests) | écran après chaque image = agrandissement ×15/8 du décodeur TS (N = 1, 2, 5, 12 ; boucles ; `loops = 0`) ; équivalence avec `podbench::play` (fenêtres, pixels, délais) sur clips épars, bruit, 64 images, image fixe, infini ; **~3 000 clips mutés (CRC re-signé ou faux, tronqués) : code d'erreur identique à `parse`** ; accord avec `decodeClip` TS ; **aucune lecture de la carte pendant une transaction TFT** ; pannes de lecture à la k-ième lecture (validation et lecture) → arrêt propre, aucun dépassement |
| `tests/tft28Host.test.ts` § 15b (firmware COMPLET, production ET canari) | clip de 9 177 o (50 images) sur un **tas simulé fragmenté** (aucune allocation > 2 048 o) : reçu au fil de l'eau, validé, marqueur après, lu en boucle ; plus grosse allocation du chemin ≤ 2 048 o ; une seule requête ; tampon de travail refusé → échec fermé (rien d'inscrit / `AE_ERROR`) ; carte illisible à mi-clip ; clip altéré sur la carte (CRC) ; téléchargement tronqué → clip partiel supprimé |
| `tests/tft28AnimStream.test.ts` (statique + 15 mutants) | tampon fixe, aucune allocation du clip entier ni `parse` en RAM dans les chemins carte, `startWrite` après toute lecture, marqueur après validation, suppression sur échec, lecture sur une pile dédiée, libération du tampon |
| analyse statique (ELF 1.6.0, `docs/mesures/8B2E_2026_10_13/`) | lambda de lecture sur la pile SD : chaîne directe 792 o (budget : 1 536 − 64 de garde − 128 de marge = 1 344 o) ; lambda de validation : 752 o ; lambda de téléchargement sur la pile réseau : voir le fichier (même famille que `streamFrame`) |

## 4. Ce qui N'EST PAS prouvé (à mesurer sur la carte)

1. **Piles dédiées pendant la lecture.** L'analyse statique ne voit ni les appels indirects (Adafruit, STMPE610) ni les interruptions : la lambda de lecture (SD + TFT + toucher sur UNE pile de 1 536 o) n'a jamais tourné sur la carte. Le canari rapporte `[CANARY] pile sd/tft animPlay` (et `animValidate`) et `[CANARY] pile reseau block-clip (reseau + SD)` avec leur marge ; une marge < 128 o ARRÊTE le canari (arrêt sûr), comme pour les autres piles.
2. **Débit de lecture de la carte.** Un run = deux lectures `File.read` de quelques octets (cache de secteur de la bibliothèque SD). Si les images ne tiennent plus leur délai, le retard sera visible (la boucle ne cumule pas de dérive : horloge absolue) ; non mesuré.
3. **Fragmentation réelle.** Le test hôte simule un plus grand bloc de 2 048 o ; le tas réel est de 4 884 o. Le canari rapporte `tas apres …` après le téléchargement.
4. **Carte retirée / erreurs d'E/S** : couvert côté hôte (`PLAY_IO`, `ERR_IO`), jamais côté matériel.
5. **Animation de plus de 9 216 o** : toujours refusée (`BENCH_MAX_CLIP` inchangé) ; le banc d'essai (`netGetBenchClip`, clip en RAM) n'est pas migré — inerte (aucun mode banc d'essai n'est activé).

## 5. Protocole de canari (porteur ; aucun flash avant audit GPT/Codex)

1. Flasher le canari (`POD_CANARY=1`, sans vote) ; **conserver la SD actuelle** (elle porte déjà un clip résident : sa lecture est le premier test) et noter le journal de démarrage ; vérifier `[ANIM] clip trouvé sur la carte` puis, dans la boucle, l'ABSENCE de `[ANIM] mémoire insuffisante` ; relever `[CANARY] pile sd/tft animPlay : utilisee … marge …`.
2. Observer l'animation 2 minutes (images fluides ? retard ?) ; toucher = pause + cartel ; re-toucher = reprise.
3. Envoyer une animation validée : relever `[HTTP GET] /api/block-clip`, `[CANARY] pile reseau block-clip`, `[ANIM] clip reçu … rangé sur la carte`, puis la lecture.
4. Reset : la dernière frame revient depuis la SD, puis l'animation reprend.
5. Critères d'arrêt : marge de pile < 128 o (arrêt automatique), image corrompue, plus d'ACK, redémarrage en boucle.
Retour arrière : reflasher le binaire précédent (`firmware-backups/2026-10-13_avant-animation-flux-tft28/`) ; la SD peut garder `/pod/anim.*` (l'ancien firmware les relit ou les ignore).

## 6. Idée « la SD comme nœud d'archive du réseau » (non commencée)

Proposition du porteur (nœuds léger / conservateur / archive : chaîne, preuves, objets adressés par hash, répliques, écriture atomique `*.tmp` → manifeste en dernier). **Aucune ligne de code de ce lot ne la réalise** ; ce lot n'en pose que la première brique (réception directe vers la SD et relecture en flux, avec validation avant publication du marqueur). Un lot dédié devra d'abord écrire : le format `/pod/` (genèse, journaux de blocs, checkpoints, objets par `contentHash`), les preuves à conserver pour une vérification hors ligne (règles et versions, certificats de finalisation / votes signés, clés publiques par époque, rotations), la politique de répliques et de vérification périodique, le budget Redis/Neon (aucun, si la synchronisation passe par des routes CDN immuables comme `/api/block-clip`), et ce qui ne doit JAMAIS aller sur la SD (clés privées). Les clés privées restent en EEPROM ; une SD ne devient pas une autorité (l'autorité reste les hash, signatures, règles et le consensus). À cadrer avec GPT avant toute implémentation.
