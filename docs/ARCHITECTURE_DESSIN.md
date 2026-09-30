# Architecture de la page de dessin — Pod Studio

> Refonte du 30/09/2026. Remplace l'ancienne page monolithique de 1 891 lignes.
> Audit de départ : `AUDIT_PAGE_DESSIN.md` · cahier des charges : `PROMPT_REFONTE_DESSIN.md`.

## 1. Vue d'ensemble

```
app/draw/[device]/[screen]/page.tsx     adaptateur réseau (charge l'appareil, cooldown, envoi)
app/draw/_studio/                       l'éditeur (React, tactile)
  DrawStudio.tsx                        orchestrateur : état, raccourcis, brouillon, récompenses
  Stage.tsx                             scène : canvas pixel-exact + guides + gestes (pointer events)
  Toolbars.tsx · panels.tsx · ui.tsx    barre du haut, outils, options, sections, feuilles, toasts
  SendFlow.tsx                          envoi en 3 étapes + écrans de résultat
  channel.ts                            cooldown (serveur d'abord) + POST /api/draw
  storage.ts                            préférences (localStorage), brouillon (IndexedDB), horloge de session
  view.ts · settings.ts · types.ts      transformation de vue, réglages → moteur, types
  studio.css                            tokens et composants (fin des styles inline dupliqués)
lib/drawEngine/                         moteur de dessin PUR (aucun React, aucun DOM) — testé en Node
app/api/draw-status/route.ts            GET : temps restant avant le prochain dessin d'un appareil
app/draw-lab/                           bac à sable DEV uniquement (404 en production)
tests/                                  npm test (node:test + tsx)
```

Principe directeur : **une seule source de vérité**. Le journal d'événements *est* le dessin. L'image affichée,
l'image envoyée, le replay et le score en découlent — il est impossible d'avoir une image que le replay ne
sait pas reconstruire (audit C4).

## 2. Le moteur (`lib/drawEngine`)

| Fichier | Rôle |
|---|---|
| `color.ts` | Couleurs empaquetées 0xAABBGGRR ; quantification par écran (`bw`, `bwr`, `rgb565`) ; mélange entier |
| `bitmap.ts` | `Bitmap` + `Txn` (transaction : journalise les pixels modifiés → deltas) |
| `patterns.ts` | Textures 8×8 : trames de Bayer (12/25/50/75/88 %), motifs, motifs personnalisés `c:<16 hex>` |
| `brushes.ts` | Empreintes (rond, carré, pixel, losange, plat, calligraphie, spray, **brosses perso** `c:WxH:base64`) |
| `raster.ts` | Bresenham, ellipse de Zingl, anneaux, polygone, remplissage strict, symétries (miroirs, rotations ×N) |
| `ops.ts` | **Seule implémentation du dessin** : trait (`StrokeRunner`), formes, remplissage, dégradé tramé, effacement |
| `selection.ts` | Sélection rectangle / baguette (par couleur) / lasso, déplacer-dupliquer-retourner-pivoter-supprimer |
| `text.ts` | Police bitmap 5×7 embarquée (accents français, ♥ ★ …) : texte identique partout |
| `session.ts` | `DrawSession` : image + historique par deltas + journal d'actions + replay + brouillon |
| `replay.ts` | `Replayer` : reconstruit l'image depuis un replay v2 (galerie, tests) |
| `scoring.ts` | Points de PoD, chronologie, profil de savoir-faire (succès) |
| `podHints.ts` | Aperçu client des critères PoD (miroir de `analyzeReplay`, testé) |

### Garanties (toutes couvertes par `npm test`)

- **Pixel-exact** : aucun anti-aliasing, aucun seuillage. Le canvas ne contient que des couleurs affichables
  par l'écran (noir/blanc ; noir/blanc/rouge ; RGB565 quantifié). Le rendu du téléphone est identique bit à bit
  à ce que l'écran physique affichera : test `canvas → rgbaToScreenPayload → décodage == canvas d'origine` sur les 4 écrans.
- **Niveaux de gris (D3)** : sur e-ink/OLED, le « gris » est une **trame** (matrice de Bayer 8×8) choisie
  explicitement ; sur le TFT, vraie opacité (mélange entier puis quantification RGB565).
- **Replay == image** : propriété testée sur des séquences aléatoires (trait, formes, remplissage, dégradé, texte,
  sélection, annuler/rétablir/effacer, symétries, spray, textures) pour les 3 modes couleur, *après un aller-retour JSON*.
- **Annuler/rétablir par deltas** (plus de snapshots `ImageData`), plus de désynchronisation après 50 gestes.
- **Remplissage strict** (comparaison exacte) : plus de halos.
- **Refactor sans régression** : `canvasToScreen.ts` expose `rgbaToScreenPayload` (encodeur pur) ; l'ancienne
  fonction `canvasToScreenPayload(canvas, …)` n'en est plus qu'un adaptateur. Test de non-régression bit à bit
  contre l'ancienne implémentation (`tests/fixtures/canvasToScreen.legacy.ts`). Les `console.log` sont supprimés.

### Déterminisme

Aucun `Math.random` : le spray utilise une graine (`sd`) enregistrée dans le replay. Les rotations de symétrie
utilisent une table cos/sin en littéraux (les fonctions transcendantes ne sont pas identiques d'un moteur JS à l'autre).

## 3. Format de replay v2 (compatible avec l'existant)

Tous les champs ajoutés à `ActionEvent` / `ReplayEvent` (`lib/types/actions.ts`) sont **optionnels** et tous les
nouveaux `kind` sont additifs. Un replay/une séquence d'actions du moteur v2 se reconnaît à `v: 2` sur son
**premier** élément ; sans ce marqueur, tout est relu/scoré comme avant.

Événements de replay v2 : `down`/`move`/`up` (trait ; `move`/`up` allégés : pas de `tool`/`color`), `fill`, `grad`
(dégradé), `shape` (ligne, rect, ellipse, polygone), `sel` (sélection : décrite par un `SelectionDesc` résolu contre
l'image au moment du geste — aucun masque embarqué), `text`, `clear`. Paramètres : `br` brosse, `tx` texture, `op`
opacité, `sd` graine, `sy/cx/cy` symétrie, `fl` plein, `pp` pixel-parfait, `fc` depuis le centre, `pts`, `c2`, `gl`,
`m/dx/dy/cp/dl` (transformation de sélection), `s/sc` (texte), `f` (frame — réservé GIF).

Cadence : les points de trait sont enregistrés à ≥ 16 ms d'intervalle et le tracé à l'écran utilise **exactement**
les points enregistrés → aucun intervalle < 15 ms parasite pour `automationRatio` (seuil serveur 0,80).

`BlockDetail.tsx` rejoue les replays v2 avec `Replayer` (pixel-exact) et garde le chemin historique pour les anciens.

## 4. Score (points de dessin)

`lib/drawEngine/scoring.ts` — module pur, utilisable par le client, la galerie et les validateurs.

- **Séquences sans `v: 2`** : règles historiques inchangées (`scoreFromActions`).
- **v2** : `+1` par geste qui **modifie réellement des pixels** (`n > 0`) : trait, remplissage/dégradé, forme, texte ;
  gomme = 0 ; annuler retire **exactement** les points du geste annulé, rétablir les rend, un nouveau geste vide la pile
  « rétablir » ; effacer tout remet à zéro (l'annuler restaure) ; déplacer/dupliquer une sélection compte, avec un
  **plafond à la moitié des gestes de dessin** (impossible de gonfler le score par allers-retours).
- Chaque action porte `n` (pixels modifiés), `br`, `tx`, `sz`, `sy`, `op` : les validateurs peuvent recalculer le score
  depuis `actionSequence` (déjà stocké dans la chaîne) sans faire confiance au client.
- **Profil de savoir-faire** (`craftProfile`) : 11 « techniques » dérivées du journal (premier trait, formes, aplat,
  texture, symétrie, dégradé, retouche, texte, brosse perso, touche-à-tout, persévérance). Informatif : il **n'entre pas**
  dans `drawScore`, il valorise la variété (toasts, panneau « Points & techniques », galerie).
- Le serveur ne recalcule pas `drawScore` (inchangé) : `finalScore` (durée d'affichage) vient des votes des ESP.

## 5. Interface

- **Trois boîtes à outils** (comme une calculatrice simple / scientifique) : *Essentiel* (pinceau, gomme, pot, formes),
  *Studio* (+ pipette, sélection, texte, textures, symétrie miroir, grille, modèle), *Pro* (+ dégradés tramés, polygone,
  lasso, spray, brosses et motifs personnalisés, symétrie rotative, stabilisateur, pixel parfait, position d'axe).
  Suggestions automatiques Essentiel → Studio → Pro selon les points et les techniques.
- **Mobile d'abord** : dock au pouce, options contextuelles en une ligne, feuilles fermables (le geste qui ouvre ne
  peut pas fermer : fond ignoré 280 ms), cibles ≥ 44 px, `viewport-fit=cover`, hauteur suivant `visualViewport`
  (clavier virtuel). Disposition pilotée par la **taille du conteneur** (`st--stack` / `st--side` / `st--dense`), pas par un
  booléen global. Canvas plein cadre en CSS (`position: fixed`), API Fullscreen en bonus seulement.
- **Gestes** : 1 doigt dessine (hors du cadre : déplace la vue), 2 doigts zoom + déplacement (annule un début de trait),
  stylet détecté → les doigts ne dessinent plus, `pointercancel`/`lostpointercapture` annulent proprement, molette,
  Espace/clic milieu pour déplacer, Maj pour contraindre, Alt+clic = pipette.
- **Orientation** : un repère « ▲ HAUT » est toujours collé au bord haut du dessin et tourne avec la vue ; dès que la vue est pivotée il devient ambre (« HAUT DE L'ÉCRAN · vue pivotée 180° »), avec une puce et un bouton « remettre à l'endroit » (aussi dans le menu).
- **Changement de boîte à outils** : bouton du dock (3 barres = niveau) → choix rapide en 2 touches ; sélecteur permanent en tête du panneau latéral sur grand écran.
- **Précision** : curseur déporté au-dessus du doigt + loupe, grille de pixels au zoom, vue pivotable d'un quart de tour,
  indication « tourne ton téléphone » pour les écrans paysage (jamais bloquant).
- **Envoi** : titre → aperçu **décodé du buffer réellement envoyé** (habillé e-ink/OLED/TFT) → confirmer ; verrou par `ref` ;
  résultats explicites (succès, file, rejet, file pleine, cooldown, réseau) ; aucune redirection.
- **Brouillon** : IndexedDB, sauvegarde continue, reprise proposée ; l'horloge de session ne compte que le temps actif.
- **Image modèle (D1a)** : guide semi-transparent (déplacer/pincer, opacité, gris) ; jamais envoyée ni dans le replay.

## 6. Préparer la pipeline GIF / boucles (prochain chantier)

Le moteur est déjà organisé pour des animations image par image :

- `DrawSession.frames: Bitmap[]` (1 aujourd'hui), chaque `HistoryEntry` et chaque `Delta` porte un index `frame`,
  `ReplayEvent.f` est réservé.
- Un GIF = N frames dessinées avec les mêmes outils ; l'historique par deltas fonctionne déjà frame par frame.
- À ajouter : événements `frame` (ajouter/dupliquer/supprimer/réordonner), pelure d'oignon dans le calque de guides de
  `Stage`, ligne de temps dans l'interface, payload multi-frames + `frameDelays`, validation PoD adaptée.
- Le contrat serveur (`/api/draw`) n'a pas à changer pour une V1 : un GIF pourra voyager comme une suite de buffers.

## 7. Vérification

`npm test` (moteur, historique, replay, score, parité écran) · `npx tsc --noEmit` · `npx eslint app/draw lib/drawEngine`.
Interface : `npm run dev` puis `/draw-lab?screen=oled096|eink27bw|eink29bwr|tft18` (options : `&guest=1`, `&send=error|reject|full`,
`&cd=30`, `&notice=1`). **Non vérifié sur appareils réels** : iPhone Safari, Android Chrome, panneaux e-ink physiques.

## 8. Suivi de l'audit (`AUDIT_PAGE_DESSIN.md`)

| # | Constat | Statut | Où |
|---|---|---|---|
| A1 | Redirection sur erreur | ✅ | `page.tsx` : jamais de navigation ; bandeau + « Réessayer » |
| A2 | Aucun brouillon | ✅ | IndexedDB, reprise proposée, horloge de session (`storage.ts`) |
| A3 | Aucun retour d'erreur sur mobile | ✅ | toasts + écran de résultat, toutes tailles |
| A4 | Barre du haut qui clippe « Envoyer » | ✅ | barre à colonnes fixes ; testé 320×568 → 1440×900 |
| A5 | Bouton d'envoi trompeur | ✅ | un seul chemin : titre → aperçu → confirmer |
| A6 | Cooldown client ≠ serveur | ✅ | `GET /api/draw-status` par appareil + pré-contrôle ; `/api/draw` **inchangé** (strikes préservés) |
| A7 | Double envoi | ✅ | verrou par `ref` (`SendFlow`) |
| B1 | Activation `pointerdown` vs `click` | ✅ | `click` partout ; fond des feuilles ignoré 280 ms ; scène qui ferme sans dessiner |
| B2 | Panneau outils incohérent | ✅ | outils/options persistants, feuilles seulement pour le rare |
| B3 | Pastilles rapides fausses | ✅ | palette réelle (mono/BWR), récentes (TFT) |
| B4 | Pas de `pointercancel` | ✅ | annulation propre + test moteur |
| B5 | 2 doigts = 2 traits | ✅ | pincer/zoom ; rejet de paume si stylet |
| B6 | Zoom sans déplacement | ✅ | zoom continu + pan + loupe + curseur déporté |
| B7 | Effacement sans confirmation / non journalisé | ✅ | confirmation, geste `clear` journalisé et annulable |
| B8 | Raccourcis en conflit | ✅ | modificateurs ignorés ; F = remplir, L/R/O formes, V sélection |
| B9 | Plein écran inexistant sur iPhone | ✅ | plein cadre CSS ; API Fullscreen en bonus (menu, si supportée) |
| B10 | Détection mobile fragile | ✅ | disposition selon la taille du conteneur |
| B11 | Icônes emoji | ✅ | SVG + libellés + `aria-label` |
| C1 | Anti-aliasing / opacité sur 1 bit | ✅ | moteur pixel-exact ; trames (D3) ; opacité = TFT seulement |
| C2 | Couleur libre sur mono/BWR | ✅ | palette stricte ; TFT : HSV + couleur RGB565 réellement affichée |
| C3 | Historique du remplissage | ✅ | deltas + test de régression |
| C4 | Historique ≠ replay | ✅ | source unique + test-propriété |
| C5 | Guide effacé par les formes | ✅ | modèle = calque DOM séparé |
| C6 | Outil « Déplacer » mort | ✅ | Sélection & déplacement (rect, baguette, lasso) |
| C7 | Formes limitées | ✅ | contour/plein, épaisseur, 1:1 / 45°, depuis le centre, polygone, symétrie |
| C8 | Remplissage à tolérance | ✅ | comparaison stricte |
| C9 | Pas de lissage | ✅ partiel | stabilisateur + pixel-parfait. **Pression stylet non enregistrée** (choix : rester simple) |
| C10 | Import compliqué | ✅ | image modèle (D1a) : déplacer/pincer, opacité, gris ; tramage mort supprimé |
| D | Aperçu, cadre, hiérarchie, styles inline, `viewport-fit`, verrou de défilement, `console.log` | ✅ | aperçu décodé du buffer ; cadre + libellé ; `studio.css` ; layout dédié ; verrou unique ; logs supprimés |
| E | Hook mort, tramage mort, monolithe, tests, historique lourd | ✅ | supprimés/scindés ; `npm test` ; deltas |

**Non traité dans cette passe (voulu)** : W6 — envoi d'image à un écran (D1b) et réglage de réception par écran (D2). C'est un
chantier distinct (nouveau endpoint, réglages `/profile`, modération de l'envoi « universel ») qui mérite ses propres décisions
(voir `PROMPT_REFONTE_DESSIN.md` §3.1). Le moteur et le flux d'envoi sont prêts à l'accueillir. **Non fait non plus** :
tests E2E automatisés (Playwright non installé) ; vérification sur iPhone Safari / Android Chrome / e-ink physiques.
