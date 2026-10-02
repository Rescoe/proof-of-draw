# scene-v1 — moteur de référence PoD, paquet `ANAS` et livraison (phase 0)

Statut : **phase 0 implémentée côté PoD** (2 octobre 2026), non déployée. Contrat amont : `notes/37` et `notes/38` (ANA → PoD).
Ce document fige les **variantes** que la note 37 §5 laisse au PoD (« PoD fige les variantes exactes et publie les golden vectors
avant le firmware »). Tout ce qui est ici est normatif pour les firmwares OLED (phase 1) et TFT (phase 2).

Code : `lib/scene/` (spec, validate, hash, engine, package, bundle, delivery, store) · tests : `tests/sceneV1*.test.ts` ·
vecteurs : `tests/fixtures/scene-v1-golden.json` (générés par `scene-v1-golden.generate.ts`, **calcul croisé avec le code ANA**).

## 1. Un seul moteur

`lib/scene/engine.ts` est le moteur TypeScript unique : revalidation + paquets (serveur), preview galerie (navigateur),
poster e-ink (serveur), golden vectors (tests). Arithmétique entière, aucune dépendance Node/DOM, aucune E/S :
une frame est une fonction pure de `(scène, largeur, hauteur, tick)`.

## 2. Variantes figées (à reproduire à l'identique)

| Sujet | Règle |
|---|---|
| Coordonnée → pixel | `px = floor(c × (extent − 1) / 65535)` (`extent` = largeur pour x, hauteur pour y) |
| Décalage `static` / `oscillate-*` / `orbit` | contrat §5 (table Q15, index `floor(((tick+phase) % period) × 256 / period)`, cosinus = index+64 mod 256, `trunc(a × s / 32767)` **vers zéro**). Bornes garanties par la validation : jamais hors canevas. |
| `linear` (`edge: "wrap"`) | `ox = (dx × tick) mod 65536`, `oy = (dy × tick) mod 65536` (modulo **non négatif**) ; `px = floor((c + ox) × (extent−1) / 65535)` (peut dépasser `extent−1`) ; chaque pixel tracé est replié `x mod largeur`, `y mod hauteur` (tore). Les autres mouvements **rognent** au lieu de replier. |
| Point `size` / trait `width` n (1..4) | carré n×n dont le coin haut-gauche est `(x − ⌊n/2⌋, y − ⌊n/2⌋)` : 1 = 1 px, 2 = x−1..x, 3 = x−1..x+1, 4 = x−2..x+1 |
| Ligne / polyline | Bresenham entier (`err = dx + dy`, `e2 = 2·err`), extrémités incluses ; chaque pixel reçoit le tampon `width`×`width` ; polyline fermée = segment dernier→premier |
| Rect | coins convertis en pixels, bornes **incluses** ; `fill` = tous les pixels, sinon contour de 1 px |
| Cercle | rayon pixel `rPx = floor(r × (min(largeur, hauteur) − 1) / 65535)` ; midpoint entier (`d = 1 − r` ; après `y++` : `d < 0 → d += 2y+1`, sinon `x−−, d += 2(y−x)+1`) ; plein = spans horizontaux des 4 symétries. Vecteur : disque plein `rPx = 3` = **37** pixels. |
| Ordre | z-order = ordre du tableau `entities` ; la dernière écrase |
| Fond | `palette[backgroundIndex]`, tout le buffer rempli avant les entités |
| xorshift32 | réservé (V1 sans primitive aléatoire) ; seed 1 → 10 sorties du contrat, testées |

## 3. Conversions de sortie

| Cible | Règle |
|---|---|
| TFT 128×160 | RGB565 **little-endian**, 2 octets/pixel, row-major (même convention que `encodeTft18`) — 40 960 octets |
| OLED 128×64 | page-major, `bit = 1` allumé (même convention que `encodeOled096`) — 1 024 octets. **Allumé = couleur RGB565 ≠ celle du fond** (comparaison des *couleurs*, pas des index) |
| Poster e-ink | gris 0 (encre) / 255, **encre = couleur ≠ fond**, rendu à la résolution native (264×176 ou 296×128), au **tick `floor(durationTicks / 2)`** ; puis `encodeForScreen(gray, w, h, screen)` — chemin frame existant, aucun changement e-ink |
| Preview navigateur | expansion RGB565 → RGBA (`(r5<<3)|(r5>>2)`…) — **jamais** utilisée pour un hash normatif |

## 4. Cadence de lecture (décision à valider par GPT)

`fps = min(tickRate de la scène, maxFps de l'appareil)`. **Aucun tick n'est sauté** : l'appareil rend `0..durationTicks−1`
exactement comme le moteur, donc les golden vectors s'appliquent tels quels. Un TFT 2 FPS joue une scène 5 ticks/s **plus
lentement** (10 ticks = 5 s au lieu de 2 s). Alternative écartée pour la V1 : sous-échantillonner (`tick = floor(n × tickRate / fps)`),
qui préserve la vitesse mais ajoute une règle de plus à reproduire. À trancher avant la phase 2.
Durée de lecture = `ceil(durationTicks × loopCount × 1000 / fps)` ms ; `retryAfter` = durée + 30 s.

## 5. Paquet binaire `ANAS` (≤ 4 096 octets, little-endian, sans padding)

```
Header 32 octets
  0  "ANAS"                 magic
  4  u8  formatVersion = 1   5  u8 rendererVersion = 1   6  u8 profil (1 = oled096, 2 = tft18)   7  u8 réservé = 0
  8  u16 width   10 u16 height   12 u32 seed
  16 u8 tickRate  17 u8 durationTicks  18 u8 loopCount  19 u8 backgroundIndex
  20 u8 paletteCount  21 u8 entityCount  22 u16 bodyLength
  24 8 octets : 8 premiers octets du sceneHash (identité / diagnostic)
Corps   palette u16[paletteCount] puis par entité :
  u8 id, u8 primitive (1 point, 2 line, 3 rect, 4 circle, 5 polyline), u8 colorIndex, u8 motion (0 static, 1 linear, 2 osc-x, 3 osc-y, 4 orbit)
  géométrie  point  u16 x,y u8 size
             line   u16 x1,y1,x2,y2 u8 width
             rect   u16 x0,y0,x1,y1 u8 fill
             circle u16 cx,cy,r u8 fill
             polyline u8 n, u8 closed, u8 width, n × (u16 x, u16 y)
  mouvement  linear i16 dx,dy · oscillate-x/y u16 amplitude, u8 period, u8 phase · orbit u16 radiusX, radiusY, u8 period, u8 phase
Trailer  u32 CRC32 IEEE (0xEDB88320) de tous les octets précédents
```

Les coordonnées restent **normalisées** : le firmware applique `toPixel` (§2). Un paquet est refusé **atomiquement** (ancien affichage
conservé, aucun ACK) s'il est tronqué, trop long, au mauvais CRC, de version inconnue, de profil/dimensions incohérents ou si la scène
décodée viole une seule règle du contrat. Mesuré : la scène de référence à 24 entités = 360 octets (vs 4 009 octets de JSON canonique) ; le plafond théorique reste 4 096.

## 6. Livraison

```
ANA feed ──► parseFeedItem (revalidation stricte : manifeste, sceneHash, bytes, sourceHash, contentHash, suffixe d'id)
          ──► compileSceneArtifacts : 1 SET NX par (profil, classe) → scene:pkg:<artifactId>   (≤ 4 Ko, TTL 90 j)
          ──► frame:{device}:{écran} = frame de repli (capture / poster) + pointeur `scene` (~300 o, aucun octet de paquet)
/api/pull       appareil déclaré scene-v1 : + `kind` et bloc `scene` {artifactId, bytes, hash, tickRate, fps, durationTicks, loopCount, playMs}
                autre appareil : réponse **identique octet pour octet** à l'ancienne (le pointeur est retiré, `kind` omis)
/api/pull-frame ?kind=scene&screen=…&artifactId=…&fmt=bin → paquet ANAS ; 404 → le firmware retombe sur le chemin frame inchangé
```

- `artifactId = sc:<contentHash[0..32]>:<profil>:r<rendererVersion>:<classe>` (classe = `f<maxFps>`). Classes compilées : OLED `f5`, TFT `f2` (`f4` seulement après benchmark).
- **Repli** (toujours une frame, jamais une erreur côté appareil) : e-ink, appareil sans capability, scène invalide ou absente, entités/paquet au-delà de la capability, artefact introuvable.
- **e-ink** : poster calculé par le moteur dès qu'une scène valide existe (note 37 §1), même si une capture existe ; OLED/TFT sans scene-v1 : capture, sinon poster.
- Capability : `POST /api/register` accepte `sceneCapability` (forme stricte du contrat §6) ; toute valeur invalide = pas de scene-v1.
- Remplacement par `sourceId` : les blocs galerie d'une œuvre générative sont **réécrits** (`upsert`), pas dupliqués, quand une révision ajoute la scène.

## 7. Budgets (testés dans `tests/sceneV1Delivery.test.ts` et `tests/sceneV1Engine.test.ts`)

| Opération | Commandes Redis |
|---|---|
| Compilation (par œuvre, une fois) | 1 `SET NX` par (profil, classe) — 2 aujourd'hui ; relancer n'écrit rien |
| Choix frame/scene dans `/api/pull` | **0** de plus (device + frame déjà lus) |
| Téléchargement du paquet | 1 `GET` (+ la lecture de la frame pour vérifier le pointeur) |
| Animation (10 s, 30 min) | **0** — moteur pur, `fetch` neutralisé pendant le test |
| Nouvel appareil compatible | 0 recompilation, même `artifactId` |

## 8. Points à valider avec GPT (ANA)

1. **Cadence** (§4) : ralentir ou sous-échantillonner sur un appareil plus lent que la scène ? Ou borner `tickRate ≤ 2` côté ANA pour le TFT ?
2. **Scène invalide sans capture** : l'item est refusé définitivement (motif dans les logs PoD) ; il n'apparaît donc pas dans la galerie. Si ANA veut un état visible, il faut un item « scène en erreur » côté feed.
3. `linear` : le repli en tore est une **décision PoD** (le contrat disait seulement `edge: "wrap"`).
4. La capture (`captureHash`) n'est pas recalculable côté PoD (algorithme ANA) : le `contentHash` est vérifié avec le `captureHash` annoncé.
