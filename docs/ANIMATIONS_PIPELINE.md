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

## Lecture sur l'écran (sans changement de firmware)
Les firmwares ne connaissent qu'un canal pour jouer un clip : le **mode banc d'essai**. À la validation, on pose le clip sur chaque écran capable et on allume ce mode
pour `min(durée d'affichage, ANIM_PLAY_MAX_SEC = 600 s)`. L'écran l'apprend à son prochain pull (≤ 30 s), télécharge le clip, le joue (boucle si `loops = 0`).
**Limite assumée** : au bout de 10 minutes le mode s'éteint et l'écran revient à l'affiche. Jouer pendant tout le temps d'affichage du bloc demande un pointeur
d'animation dans `/api/pull` côté firmware (à faire avec un test sur la carte).

## Coût Redis (règle primordiale)
- Soumission : celui d'un dessin (+ 0). Le clip (≤ 12,3 k car.) voyage dans le candidat ; le bloc garde ≈ 25 Ko de plus (`chain:anim`), permanent.
- Minage d'un bloc d'animation : 2 lectures groupées (pool, bannis) + 1 MGET appareils + 3 écritures par écran récepteur.
- Écran en lecture : 1 commande (EVAL) par contrôle rapide ≈ toutes les 3 s pendant ≤ 10 min ⇒ **≈ 200 commandes par écran et par animation**.
- Galerie : `/api/blocks` inchangé (+ filtre en mémoire) ; `/api/block-anim` 1 GET, cache CDN 24 h.
- L'atelier ne fait plus de lecture d'état (plus de sondage `bench:status`).

## Fichiers
`lib/anim/block.ts` (dérivation pure, testée) · `lib/anim/deliver.ts` · `lib/chain.ts` (`Block.kind/anim`, `Candidate.kind/anim`, `chain:anim:*`, `getBlockAnim`) ·
`app/api/{draw,submit-candidate,validate-candidate,validation-result,blocks}` · `app/api/block-anim` · `app/AnimBlockPlayer.tsx` · `app/gallery/GalleryClient.tsx` ·
`app/profile/DevicesPanel.tsx` · `app/bench/BenchClient.tsx` (variante studio) · `tests/animBlock.test.ts`.

## À faire / à décider
- Essai réel : soumettre une animation depuis le profil d'un TFT 2.8", voir le candidat, les votes, le bloc, puis la lecture.
- Pointeur d'animation dans `/api/pull` (lecture pendant tout l'affichage) + R4 qui vérifie le clip lui-même.
- Garde anti-automatisation propre aux animations (un dessin a l'analyse du rythme des traits ; ici seul le verrou de 15 min et le refus des animations vides/identiques s'appliquent).
- Aperçu animé dans les cartes de la galerie (aujourd'hui : affiche + pastille « 🎞 Animation », lecture dans le détail du bloc).
