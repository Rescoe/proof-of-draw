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
