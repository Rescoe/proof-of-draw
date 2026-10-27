# Lot BWR + OLED : écran capteur propre et animations du réseau sur l'OLED auxiliaire (29/10/2026)

> **Statut : code, tests hôte et compilation faits. Jamais essayé sur une carte. Aucune release OTA n'est créée ni publiée.**
> Cible : `dev_T46HBXG1` (ESP8266 4 Mo + e-ink 2,9″ BWR + OLED SSD1306 + DHT22 D3). Niveaux de preuve : `C` (compilé) et `H` (hôte) seulement.

## 1. Ce que fait la nouvelle option (`POD_OLED_ANIM`, 0 par défaut)

- **Sans animation** : l'OLED affiche la température (grande), l'humidité, l'âge de la mesure (« mesure il y a 12 min ») et l'état Wi-Fi / numéro de bloc, rafraîchi chaque minute. Sans mesure, il le dit (rien n'est inventé).
- **Avec une animation du réseau** : le clip PBC1 est téléchargé, validé, rangé en flash et joué **en boucle sur l'OLED**. L'e-ink garde l'affiche BWR de la livraison et son cartel (gravé en haut, mesure en bas : inchangé).
- Le vote V2 existant, l'OTA, le portail Wi-Fi et la surimpression capteur ne sont **pas modifiés**. Aucun vote d'animation V3 n'est ajouté (décision de l'audit : d'abord mesurer en ombre sur la R4, puis porter).

## 2. Architecture retenue

| Sujet | Choix | Raison |
|---|---|---|
| Écrans déclarés | **un seul** : `eink29bwr` | pas de seconde file Redis, un seul `frameId`, un seul ACK, quorum et profil inchangés |
| Livraison | la frame `eink29bwr` du bloc d'animation porte **l'affiche BWR + le pointeur `anim`** | le même chemin que les écrans dynamiques, sans nouvelle route |
| Capacité | la carte déclare `caps:["anim-oled"]` à `/api/register` ; le serveur ne livre le pointeur qu'avec `eink29bwr >= 2.13` | une carte BWR **sans OLED** ou ancienne reçoit exactement la même réponse qu'avant |
| Stockage du clip | **flash brute, deux emplacements de 12 Ko à 0x3E0000** (`pod_oled_flash.h`) | la partition « fichiers » porte déjà la frame sauvegardée de la surimpression (0x3F0000) : un système de fichiers l'aurait formatée ; économie de ≈ 1,5 Ko de tas |
| Écriture | dans l'emplacement **inactif**, en-tête écrit **en dernier**, clip précédent conservé jusqu'à validation complète du nouveau | coupure de courant = ancien clip intact |
| Validation | **en flux** (`pod_bench_stream.h`, CRC PBC1, structure, retour à l'image 0), TLS fermé | mêmes codes d'erreur que le décodeur TypeScript |
| Lecture | **en flux** (`pod_oled_stream.h`) : RAM = un tampon de 256 o + un lecteur de < 64 o ; **le tampon de l'OLED sert d'image** | le clip (≤ 9 Ko) n'est jamais chargé en RAM, aucune copie de 1 Ko |
| Priorité | `podoaNetDueSoon()` : pull, vote, observation, capteur, OTA, Wi-Fi passent **avant** ; tranches de 2,5 s ; une tâche réseau interrompt la tranche | l'animation ne retarde jamais le réseau |
| Phases mémoire | plans image libérés avant le TLS du clip, réalloués après (règle du projet) ; aucune lecture pendant un TLS | identique au capteur DHT22 |
| Panne | clip illisible → en-tête effacé, retour à l'écran capteur ; téléchargement incomplet → ancien clip conservé, 4 essais par clip puis arrêt | jamais d'écran bloqué |

Fichiers du firmware (dossier `esp8266/esp_eink_2.9BWR/`) : `pod_oled_stream.h` (nouveau, pur), `pod_oled_flash.h` (nouveau, pur), `pod_bench.h` et `pod_bench_stream.h` (copies identiques des originaux, `scripts/sync-bench-header.js`), `esp_eink_2.9BWR.ino` (blocs `POD_BWR_BEGIN/END` seulement : drapeau, pointeur de pull, caps, écran capteur, service d'animation).

Côté serveur : `lib/anim/pointer.ts` (`animOledAuxCapable`, `animPullMeta`), `lib/anim/targets.ts` (`animOledAuxTargets`), `lib/anim/block.ts` (`posterBwr` : clip ×2 centré, noir sur blanc, par la conversion validée), `lib/anim/broadcast.ts` (pool `eink29bwr`), `lib/voteCapability.ts` (« anim-oled » ajoutée à la liste fermée, jamais une capacité de vote).

## 3. Budget mémoire et taille (build `eink29bwr-2.13`, flags de la release 2.12 de `dev_T46HBXG1` : portail + OTA + DHT22 + OLED + surimpression + frame par morceaux)

| | option à 0 | option à 1 | écart |
|---|---|---|---|
| Binaire | 550 528 o | 556 944 o | **+6 416 o** |
| RAM statique | 35 272 o | 35 640 o | **+368 o** (la cible du projet est ≤ 40 000) |
| SHA-256 | `87619d51…` | `f266caef…` | — |

- **L'option à 0 est bit à bit identique au firmware d'avant** (même SHA-256) ; hors blocs `POD_BWR`, le texte du sketch est identique à `ad2e672` (test).
- Pendant la lecture : un tampon de 256 o (alloué par tranche, libéré après). Pendant le téléchargement du clip : tampon TLS de 4 Ko + un écrivain de flash de ≈ 280 o + un morceau de 128 o, **sans plans image**. Validation : 2 Ko transitoires, TLS fermé, planes libérés.
- Seuils codés : téléchargement si tas ≥ 20 000 o et plus gros bloc ≥ 12 000 o ; lecture si tas ≥ 6 000 o.
- **Non mesuré sur la carte** : tas minimal pendant le téléchargement du clip, avec un vrai OLED, avec le DHT22, après plusieurs animations (fragmentation).

## 4. Preuves hôte

| Suite | Contenu | Résultat |
|---|---|---|
| `tests/oledStream.test.ts` | lecteur en flux vs décodeur TypeScript : N = 1, 2, 3, 5, 12 images, boucles finies et infinie, **chaque image (CRC du tampon de l'OLED), le délai de chaque image**, découpage en tranches (source rouverte à chaque appel), RAM, bornes (run corrompu : T_IO, sentinelles intactes), panne de lecture | 7 tests verts |
| `tests/oledFlash.test.ts` | stockage deux emplacements avec **fausse flash qui applique la physique de la NOR** (20 graines) : écriture dans l'inactif, coupure avant l'en-tête, en-tête déchiré, séquences qui bouclent, pannes d'effacement et d'écriture, capacité, **gros clip sur emplacement pollué**, relecture ; régions disjointes de la frame sauvegardée ; câblage du sketch (phases, ordre dans `loop()`, aucune bibliothèque de fichiers, identité hors blocs) | 5 tests verts |
| `tests/oledMutants.test.ts` | **18 mutants** des deux en-têtes : tous détectés | 18 tests verts |
| `tests/animOledAux.test.ts` | capacité (trois conditions), `animPullMeta`, cibles, affiche BWR (octet par octet), câblage de la diffusion | 6 tests verts |

Trois mutants équivalents ont été écartés après analyse (fenêtre de lecture à `~31` au lieu de `~63`, vérification redondante de capacité du dernier bloc, remplissage par 0x00 au lieu de 0xFF) et remplacés par des mutants non équivalents.

## 5. Ce qui reste avant toute publication (rien de tout cela n'est fait)

1. **Canari de banc avec un VRAI OLED SSD1306 et un VRAI DHT22**, même partition 4M2M, identité de banc (jamais `dev_T46HBXG1`). Un ballast mémoire ne suffit pas. Le banc habituel (`dev_MN67OG7R`, COM4) n'a **pas d'OLED** et n'était pas branché pendant ce lot.
2. Critères (audit du 29/10/2026) : 5 démarrages sans boucle de reset ; register et pull stables ; 5 téléchargements BWR consécutifs, affichage et ACK 200 ; 5 votes V2 dont 2 formats ; lecture DHT22 et envoi ; écran capteur ; téléchargement d'un clip ; lecture en boucle sans retarder pull, vote ou OTA ; interruption puis reprise ; clip corrompu ou tronqué refusé (ancien clip conservé) ; redémarrage avec clip persistant ; tas libre, plus grand bloc et pile mesurés à chaque phase ; OTA A→B sur la combinaison exacte ; redémarrage B sain (identité, Wi-Fi, mesures, vote conservés).
3. Seuils : aucune exception OOM ou WDT ; tas minimal ≥ 10 Ko pendant le téléchargement d'une frame avec OLED ; marge < 2 Ko hors phase mesurée = ne pas publier ; pas de bloc contigu pour l'OTA = report propre.
4. **Release** (seulement après le canari) : `eink29bwr-2.13`, séquence **14** (la carte est en 2.12, séquence installée 12 d'après `ota-releases/eink29bwr-2.12-ota12` ; 13 est celle du banc ; à confirmer par une ligne `[ota-announce] … installee=` des journaux Vercel), identifiant neuf `eink29bwr-2.13-ota14`, famille `esp8266-eink29bwr`, cible `dev_T46HBXG1` seule, manifeste signé, SHA du fichier servi / région signée / image installée consignés séparément. **Fusionner un dossier `ota-releases/…` dans `main` = envoyer** : ne jamais le fusionner sans le GO.
5. Retour si la carte ne revient pas : la porte `ota:kill` ferme l'annonce ; la carte garde son image 2.12 tant que le téléchargement n'est pas complet et vérifié ; sans retour automatique, un reflash par câble (sauvegarde de flash à 115 200 bauds) reste le seul recours.

## 6. Pour le serveur (déployé avant la carte)

Le code serveur est inerte tant qu'aucune carte ne déclare « anim-oled » (liste fermée, aucune famille ne la déclare aujourd'hui). Coût Redis par bloc d'animation : **+1 `SMEMBERS`** (pool `eink29bwr`) et **+1 `SET` par carte BWR capable** ; aucun autre changement.

## 7. Après l'installation chez le cousin (29/10/2026 soir) — constat, remix d'animation, constellation

**Constat (lecture seule de Redis).** La carte est bien en `eink29bwr-2.13`, déclare `caps: ["anim-oled"]`, est appairée et tire normalement : la mise à jour a fonctionné, aucun débranchement n'est nécessaire. L'OLED ne montre que la température parce qu'**aucune animation n'a été minée** : le dernier bloc (#123, « ZombieMouche_V5 ») est un dessin fixe TFT 2,8″ — une image fixe de ce type n'est jamais diffusée à un BWR — et aucune frame `frame:dev_T46HBXG1:eink29bwr` n'existait. Un pointeur d'animation n'arrive que dans la frame d'un bloc `kind: "animation"`.

**Cause de V5.** « Remix » / « Reprendre » d'une animation ouvrait le studio de DESSIN avec l'affiche (une seule image). Corrigé : l'animation entière (toutes les images, délais, couleurs) se rouvre dans l'atelier `/animer` (`?resume={candidat rejeté}` ou `?remix={bloc}`), en copie modifiable (`handmade: false` : non soumise tant qu'on n'y a pas touché). Entrées : galerie → rejets (`kind: "animation"` dans l'entrée d'archive, additif), page d'un bloc d'animation (« Copier cette animation dans l'atelier »), et le studio de dessin renvoie vers l'atelier au lieu d'ouvrir l'affiche. `/api/rejected-image?id=…&clip=1` sert le clip PBC1 (≤ 9 Ko) d'un rejet. Pas de lien de filiation (`derivedFromBlockHash`) pour une animation pour l'instant.

**Diffusion à tous les écrans dynamiques.** Inchangée côté serveur (elle l'était déjà : `broadcastAnimation` vise les pools tft28, tft18, oled096 et les BWR à OLED, quel que soit l'écran d'origine). Le formulaire d'envoi le dit maintenant : l'écran choisi n'est que l'écran d'origine.

**L'OLED, second écran de la carte.** Le firmware déclare UN seul écran (`eink29bwr`) plus la capacité `anim-oled` : c'est sa déclaration, et la modifier demanderait une nouvelle release OTA. La vue réseau publique ajoute donc, côté serveur, le pseudo-écran `oled096aux` (« OLED 0,96″ (auxiliaire) ») aux cartes qui remplissent les trois conditions (`animOledAuxCapable`) ; il n'entre dans aucune pool (`pools` inchangé), ne reçoit aucun flux de bloc d'écran.

**Constellation.** Un écran qui joue une animation montre sa BOUCLE (clip rejoué : images, délais, couleurs ; OLED en blanc sur noir) au lieu de l'affiche fixe, d'après l'enregistrement d'affichage `isAnimation` + `blockHash` (ACK). Pour l'OLED auxiliaire, l'ACK du BWR qui a reçu la frame portant le pointeur écrit `shown:{id}:oled096aux` (+1 commande Redis, seulement dans ce cas). ⚠ **Ce n'est pas confirmé par l'OLED lui-même** (le firmware 2.13 n'envoie rien de plus) : c'est « la carte a acquitté la frame qui portait l'animation ». Un clip qui n'aurait pas pu être téléchargé (mémoire) apparaîtrait quand même en boucle dans la constellation. Cote Redis, 0 commande par vignette (clip immuable servi par le CDN). Limite : la vignette rejoue le clip, pas la mise en page exacte de l'écran (affiche centrée).

## 8. Livraison par POINTEUR SEUL — l'e-ink garde son image (29/10/2026, soir)

Constat sur le bloc #124 : le BWR du cousin a reçu une frame (affiche + pointeur), l'a téléchargée en 4 morceaux (200), puis s'est tu (aucun ACK, aucun pull, aucun relevé pendant plus de 30 min). Le blocage a eu lieu après le téléchargement de l'affiche, donc dans le chemin d'affichage e-ink ou juste après ; cause non établie (pas de port série). Décision du porteur : **les écrans fixes ne reçoivent PAS l'animation, ils gardent leurs images.**

Changement serveur (aucun firmware, aucune release OTA) : `lib/anim/broadcast.ts` n'écrit plus de frame pour un e-ink BWR (une SMEMBERS de moins par bloc). La carte à OLED déclaré (`anim-oled`, firmware ≥ 2.13) reçoit le pointeur directement dans `/api/pull` tant que le DERNIER bloc de la chaîne est cette animation et qu'aucune frame fixe n'est en attente (`animPullMeta(…, chainHead)` : 0 commande Redis de plus, la tête est déjà lue). Le firmware 2.13 traite `anim` à chaque pull indépendamment de toute frame (`podoaOnPull`) : il télécharge le clip et le joue sans toucher à l'e-ink. Une nouvelle image fixe en attente supprime le pointeur ; l'animation en cours s'arrête quand l'e-ink affiche cette nouvelle image (`podoaForget`). Une ancienne frame porteuse du pointeur (livrée avant ce changement) reste honorée.

Constellation : sans frame, plus d'ACK pour l'OLED ; `withAuxOledFromHead` (`/api/network/displays`, +1 GET dans un cache de 15 min invalidé par ACK) présente l'OLED des cartes EN LIGNE comme jouant la dernière animation. **Annoncé, non confirmé** : le pull a porté le pointeur, l'OLED ne rapporte rien.

## 9. Le vote d'une animation reste v1 (écho signé) — état et options

Pourquoi : `submit-candidate` fixe `v2 = null` pour une animation (`animSub`), `validate-candidate` ne donne alors aucune spécification à recalculer, et `ANIM_V1_VOTE` (par défaut) admet le vote v1 pour les seules animations. Bloc #124 : `votesSummary = {v1: 3, v2: 0}`, validateurs T46, banc BWR et station TFT 1,8″ ; le multiscreen (`dev_KAD6PKC4`) en était l'AUTEUR et ne vote pas son propre candidat. Un vote v1 prouve l'identité de l'appareil (signature Ed25519), PAS qu'il a recalculé quoi que ce soit.
Options : (a) v2 sur l'AFFICHE seulement (côté serveur, sans firmware : les appareils recalculeraient hash et métriques d'une image, pas du clip) — gain réel mais étroit, et le mot « v2 » laisserait croire que l'animation est vérifiée ; (b) v2 du clip entier = lot 8 (automate `pod-anim-v3` compilé, jamais flashé, exige une release de chaque famille) — seule vraie solution. Rien n'est changé ici ; décision du porteur.
