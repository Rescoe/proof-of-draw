# Animations dans le consensus (04/10/2026)

Statut : **serveur et interface testés sur PC (248 tests, `tsc`) — chaîne complète (vote réel des ESP, lecture du clip sur l'écran) PAS encore essayée sur le matériel.**

## Ce qui change pour l'utilisateur

- Le menu n'a plus « Animer » ni « Animations ».
- **Mon profil** : à côté de « ✏️ Dessiner », un bouton **« 🎞 Animer »** n'apparaît que sur les écrans qui jouent un clip (TFT 2.8", TFT 1.8", OLED). Il ouvre `/animer?device=…&screen=…`.
- **Atelier** (`/animer`, éditeur du banc d'essai sans mesures) : l'écran est celui du lien, plus de mode banc d'essai ni d'avertissements.
  « 🚀 Soumettre au réseau » = `POST /api/draw` avec `{ anim }`. Même verrou (1 soumission / appareil / 15 min), même file d'attente, mêmes strikes qu'un dessin.
  Un modèle de départ (balle, vague, texte) ne peut pas être soumis tel quel : il faut le modifier.
- **Galerie** (`/gallery`) : filtre **Tout · Dessins · Animations**. Une animation est un bloc ; le détail du bloc la rejoue et permet de la
  **vérifier image par image** (le navigateur recalcule le SHA-256 de chaque image et le compare au bloc). `/gallery-anim` redirige vers `/gallery?type=animation`.
- Supprimés : la galerie `anim:*` séparée côté interface, `POST /api/anim/save` et l'option `gallery` de `/api/bench/send` (elles publiaient **sans** consensus).
  Les anciennes fiches `anim:item:*` restent en base mais ne sont plus affichées.

## Pipeline

```
/animer → POST /api/draw { deviceId, screen, workTitle, anim:{frames,delaysMs,loops,fg,bg} }
        → lib/anim/block.ts : le SERVEUR encode le clip PBC1 et dérive TOUT (clip ≤ 9 Ko, rien n'est cru sur parole)
        → POST /api/submit-candidate { animClip }  (re-dérivation depuis le clip seul)
             par IMAGE : SHA-256 des 1024 octets + score de complexité (entropie · transitions · RLE, comme un dessin)
             candidat : score = moyenne des scores d'images · imageHash = racine = SHA-256(empreintes + délais + boucles + couleurs)
                        payload = affiche (meilleure image, au format de l'écran) · kind:"animation" · anim:{clip, frameHashes, frameScores…}
        → ESP : /api/pull (inchangé) → /api/validate-candidate (+ kind, frames si animation) → vote signé Ed25519 sur « deviceId:candidateId:score »
        → quorum → finalizeBlock : bloc {kind:"animation", anim:{frames,loops,playMs,bytes,root}} ; le hash du bloc couvre la racine
                   chain:anim:{hash} (permanent) = clip + empreintes + scores par image
        → broadcast de l'AFFICHE comme un dessin (repli universel : tous les écrans, e-ink compris, via conversion) 
        → lib/anim/deliver.ts : écrans à clip (firmware compatible) → bench:clip/ptr + mode rapide à durée limitée
```

### Ce que « les ESP valident image par image » veut dire ici
Un ESP8266 ne télécharge jamais les pixels (tas de 47 Ko) : pour un dessin il vote déjà sur `score_server`. Pour une animation, ce score **est la moyenne des
scores de chaque image**, et la racine des empreintes d'images est dans le bloc que les signatures des validateurs engagent. Chaque image est donc notée, empreinte,
et vérifiable publiquement (`verifyAnimDoc`, bouton de la galerie). La **vérification par l'ESP lui-même, image par image**, demanderait que l'ESP télécharge le clip :
possible sur l'UNO R4 (clip ≤ 9 Ko), pas sur l'ESP8266 — non fait.

## Lecture sur l'écran : boucle INFINIE depuis la carte SD (TFT 2.8", `r4tft28-2.4`)
Une animation de bloc tourne **toujours en boucle** (le serveur force `loops = 0`, le choix de l'auteur est ignoré).

```
mine du bloc → frame de l'écran = affiche + pointeur anim:{hash du bloc, bytes, frames}
/api/pull (firmware >= 2.4 seulement) → { …, anim:{hash,bytes,frames} }        (les autres firmwares : réponse inchangée)
écran : affiche (comme un dessin) → GET /api/block-clip?hash=… (clip ≤ 9 Ko, CDN immuable 1 an) → validé (CRC, structure)
        → /pod/anim.bin + /pod/anim.txt sur la microSD → lecture EN BOUCLE, aucune requête entre deux pulls
        → tâche réseau due (pull / vote / ré-validation) : la lecture s'arrête juste avant, la tâche s'exécute, la lecture reprend
        → toucher = pause sur l'affiche + cartel ; re-toucher (ou 60 s) = reprise
        → redémarrage : l'animation reprend depuis la carte ; nouvelle image fixe : clip effacé
```
Sans carte SD : l'affiche reste à l'écran, pas d'animation (le clip n'est pas gardé en RAM : 32 Ko seulement).

**Autres écrans** (TFT 1.8" / OLED en ESP8266, R4 < 2.4) : repli sur le canal du banc d'essai (`lib/anim/deliver.ts`) : clip posé + mode rapide
`min(durée d'affichage, ANIM_PLAY_MAX_SEC = 600 s)`, l'écran l'apprend à son prochain pull, interroge `/api/bench/poll` toutes les 3 s, puis revient à l'affiche.
Limite assumée de ce repli : 10 minutes. Il disparaîtra quand ces firmwares sauront lire un clip rangé (pas de carte SD sur l'ESP8266 : à étudier).

## Coût Redis (règle primordiale)
- Soumission : celui d'un dessin (+ 0). Le clip (≤ 12,3 k car.) voyage dans le candidat ; le bloc garde ≈ 25 Ko de plus (`chain:anim`), permanent.
- Minage d'un bloc d'animation : 2 lectures groupées (pool, bannis) + 1 MGET appareils + 3 écritures par écran récepteur.
- **Écran à lecteur SD (r4tft28-2.4+) : 0 commande de plus qu'une image fixe.** Le pointeur est lu dans le pull normal (déjà compté), le clip vient du CDN
  (1 GET Redis au tout premier téléchargement du monde, 0 ensuite), la lecture ne demande rien. Avant : ≈ 200 commandes par écran et par animation, et une
  animation arrêtée au bout de 10 min. Plus de `deliverAnimation` pour ces écrans (3 écritures de moins par écran récepteur).
- Repli ESP8266 / R4 < 2.4 : 1 commande (EVAL) par contrôle rapide ≈ toutes les 3 s pendant ≤ 10 min ⇒ ≈ 200 commandes par écran et par animation (inchangé).
- Galerie : `/api/blocks` inchangé (+ filtre en mémoire) ; `/api/block-anim` 1 GET, cache CDN 24 h.
- L'atelier ne fait plus de lecture d'état (plus de sondage `bench:status`).

## Fichiers
`lib/anim/block.ts` (dérivation pure, testée) · `lib/anim/pointer.ts` (pointeur `anim` de /api/pull) · `app/api/block-clip` (clip binaire, CDN) · `lib/anim/deliver.ts` (repli) · `arduino_uno_r4/pod_uno_r4` (r4tft28-2.4) · `lib/chain.ts` (`Block.kind/anim`, `Candidate.kind/anim`, `chain:anim:*`, `getBlockAnim`) ·
`app/api/{draw,submit-candidate,validate-candidate,validation-result,blocks}` · `app/api/block-anim` · `app/AnimBlockPlayer.tsx` · `app/gallery/GalleryClient.tsx` ·
`app/profile/DevicesPanel.tsx` · `app/bench/BenchClient.tsx` (variante studio) · `tests/animBlock.test.ts`.

## À faire / à décider
- Essai réel : soumettre une animation depuis le profil d'un TFT 2.8", voir le candidat, les votes, le bloc, puis la lecture.
- **Essai sur la carte du firmware r4tft28-2.4** (compilé, jamais flashé) : téléchargement du clip, écriture sur la SD, lecture en boucle, pause au toucher, reprise après redémarrage.
  Sauvegarde de l'ancien firmware : `firmware-backups/2026-10-04_avant-animation-sd/`, tag `firmware-avant-animation-sd-2026-10-04`.
- Ports du lecteur sur carte SD pour les autres matériels (R4 + OLED / TFT 1.8" avec SD) ; ESP8266 sans SD : étudier une lecture depuis la flash (LittleFS).
- R4 qui vérifie le clip lui-même (empreintes image par image) avant de le ranger.
- Garde anti-automatisation propre aux animations (un dessin a l'analyse du rythme des traits ; ici seul le verrou de 15 min et le refus des animations vides/identiques s'appliquent).
- Aperçu animé dans les cartes de la galerie (aujourd'hui : affiche + pastille « 🎞 Animation », lecture dans le détail du bloc).
