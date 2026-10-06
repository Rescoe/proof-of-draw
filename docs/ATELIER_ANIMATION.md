# Atelier d'animation — refonte du 06/10/2026

Route : **`/animer`** (bouton « 🎞 Animer » de Mon profil). Code : `app/animer/*` ; briques pures et testées : `lib/anim/brushes.ts`, `lib/anim/fit.ts`, `lib/bench/{draw,history,clip,gif}.ts`.

## Pourquoi (retours du porteur en dessinant une animation)
1. **Les boutons, notamment « retour en arrière », étaient introuvables** (l'éditeur était une longue page de cartes).
2. **En paysage, le canvas ne tenait pas dans l'écran.**
3. **Le défilement pour atteindre la boîte à outils passait sur le canvas** et laissait des traits parasites : la boîte à outils était SOUS le canvas dans une page qui défile.
4. L'éditeur était partagé avec un « banc d'essai » (mesures, journal, mode de test) : deux produits dans un seul fichier de 701 lignes.

## Ce qui est fait
| Problème | Solution |
|---|---|
| Boutons introuvables | **Barre du haut fixe** : ← retour · ↶ annuler · ↷ rétablir (grands, toujours visibles) · mode · Envoyer. Raccourcis clavier conservés (Ctrl+Z / Ctrl+Y, P E L R O G, Espace, ← →, [ ]). |
| Canvas hors écran | `fitCanvas` (`lib/anim/fit.ts`) calcule l'agrandissement pour que le canvas **tienne toujours** dans la scène (entier dès que ≥ 3, fractionnaire en dessous). `ResizeObserver` : suit la rotation et le clavier virtuel. |
| Défilement qui dessine | L'atelier est un **calque plein écran sans aucun défilement** (comme Pod Studio) ; la boîte à outils n'est plus sous le canvas ; `touch-action: none` sur la scène ; le document derrière est verrouillé (`overflow: hidden`, `overscroll-behavior: none`) ; la ligne de temps ne défile qu'**horizontalement** (`touch-action: pan-x`). |
| Trait parasite (paume, pincement) | Un **second doigt annule le trait en cours** (`StageCanvas`) au lieu de le laisser. |
| Deux dispositions | **Empilée** (téléphone portrait) : barre · scène · ligne de temps · options · outils. **Latérale** (paysage / ordinateur, `chooseLayout`) : outils à gauche · scène · options à droite · ligne de temps sur toute la largeur en bas ; **dense** (hauteur < 520 px : téléphone couché) : commandes et images sur UNE rangée. |
| 3 modes | **Essentiel** : brosse (rond, carré, spray), gomme, remplir, fantôme, vitesse unique. **Studio** : + ligne, rectangle, ellipse, 7 brosses, fantôme avant **et** après, retournements, décalage, inverser, aller-retour, déplacer les images. **Pro** : + délai par image, grille d'octets, budget d'octets, génération de mouvement, texte défilant, export GIF/projet, import. Changer de mode ne perd rien. |
| Boîte à outils | Rail d'outils (icône + nom), options contextuelles, feuilles (brosses avec aperçu du trait, couleurs, actions, mode). |
| **Onion skin conservé** | « Fantôme » (Essentiel : image précédente) ; « Avant » (orange) et « Après » (bleu) en Studio / Pro. |
| Brosses | `lib/anim/brushes.ts` : **rond, carré, spray** (nuage de points déterministe : hachage de x, y, graine), **trame** (Bayer 4×4, 25/50/75 %, alignée sur les coordonnées absolues : les traits se raccordent), **pointillé** (espacement régulier, reste de distance reporté d'un segment à l'autre), **plume** (45°), **hachures**. Taille 1–12. Aucune n'appelle `Math.random()`. |
| Banc d'essai | **Supprimé** (voir ci-dessous). |

## Purge du banc d'essai
- Supprimés : `app/bench/BenchClient.tsx` (éditeur partagé), les routes réservées à son interface `app/api/bench/{send,mode,status,clear}`, le lien « 🧪 Banc d'essai » de la carte d'appareil. `/bench` redirige vers `/animer`.
- **Conservés** (le firmware déjà déployé les appelle) : `app/api/bench/{poll,clip,result}`, `lib/bench/*` (le codeur de clips PBC1, les primitives de dessin et l'historique servent l'atelier), le champ `benchMode` de `/api/pull`. Plus aucune interface ne peut activer le mode banc d'essai : ces routes sont **inertes** (les firmwares ne les appellent que si `benchMode` est vrai).
- **Reste à purger plus tard** (demande un reflash) : les lecteurs « banc d'essai » des firmwares (`pod_bench_esp.h`, bloc `[BENCH]` de `pod_uno_r4.ino`) et les fonctions de `lib/bench/store.ts` devenues sans appelant (`setBenchMode`, `clearBenchHistory`, `benchStatus`, `storeClip`). Les modèles de test (balle, vague, éclair, bruit) ont disparu ; balle et vague restent comme **modèles de départ** (jamais soumis tant qu'on n'y a pas touché).

## Compatibilité
- Même clé de brouillon (`pod-anim-studio-draft-v1`) et même format : les brouillons existants se rouvrent (le mode et la brosse sont des ajouts facultatifs).
- Même circuit de soumission : `POST /api/draw { anim }` → candidat → votes → bloc → galerie. Même format de projet `.pod-anim.json`.
- **Coût Redis** : aucun ajout. L'atelier ne fait plus aucun polling d'état (l'ancien éditeur lisait l'état du banc d'essai) ; seul `wakeNetwork()` (≤ 1 appel / 10 min) et `GET /api/devices?mine=1` à l'ouverture.

## Vérifié / non vérifié
- Vérifié dans le navigateur (aperçu de développement) : 812×375 (téléphone couché), 375×812 (portrait), 1280×800 ; dessin par événements pointeur ; annulation par 2e doigt ; ajout d'image, fantôme, lecture, statistiques ; feuilles ; redirection `/bench`.
- **Non vérifié** : sur un vrai téléphone (clavier virtuel, barres d'adresse mobiles, stylet), la soumission réelle au réseau (aucun écran compatible dans l'environnement de test), l'accessibilité au lecteur d'écran. Tests : `tests/animBrushes.test.ts` (10), `fit` et `chooseLayout` inclus.

## Proposition : un canvas unique plus grand (à valider avant de coder)
**Question du porteur** : dessiner sur un canvas unique plus grand que l'OLED (128×64) mais plus petit que le TFT 1,8″ (128×160), puis convertir chaque image pour chaque écran avec une meilleure qualité.

**Analyse (de ce que dit le code, pas d'un essai)**
- Les cibles n'ont **pas la même forme** : OLED 128×64 (2:1, 1 bit), TFT 2,8″ 240×320 (3:4 portrait, couleur ; le lecteur R4 affiche déjà le clip 128×64 agrandi ×1,875 = **240×120**), TFT 1,8″ 128×160 (4:5 portrait, couleur ; le clip 128×64 y est affiché 1:1 au centre). Un seul canvas ne peut pas être « natif » partout : la conversion sera un recadrage, un cadre noir ou un redimensionnement.
- **Le format du clip est le vrai verrou** : PBC1 = 128×64, 1 bit, ≤ 9 216 octets, lu en mémoire par l'appareil. Un canvas plus grand ne s'envoie pas tel quel : il faut un **nouveau format** et donc un **reflash**. L'ESP8266 (TFT 1,8″, OLED) a ≈ 38 Ko de tas dont le TLS prend l'essentiel (voir `NOTE_MULTISCREEN_TAS_2026_10_06.md`) : il ne gagnera pas de pixels. Seule la **R4 + TFT 2,8″** (SD + 32 Ko de RAM, redessin par différences) peut afficher plus.
- Ce qui est **gratuit** : l'OLED affiche 128×64 ; dessiner à 2× (256×128, 1 bit) et réduire avec une **trame ordonnée** (Bayer, comme `lib/anim/brushes.ts`) donne un rendu plus fin des courbes qu'un dessin direct à 128×64, sans aucun changement de firmware.

**Recommandation en 3 étapes**
1. **Valider cet atelier à 128×64** (essai réel sur les écrans) — c'est l'étape en cours.
2. **Rendre la taille du canvas un paramètre** de l'atelier (`W`/`H` passés aux primitives ; elles sont déjà pures), avec un *format* : « OLED 128×64 » (natif) et « Maître 256×128 » (exact 2× de l'OLED, ≈ 1,07× de la largeur du TFT 2,8″). Export par cible : OLED = réduction 2× avec trame ; TFT 1,8″ = 128×64 centré (inchangé) ; TFT 2,8″ = aperçu 240×120. **Aucun reflash** : seul le clip PBC1 128×64 part vers les appareils.
3. **Seulement si l'étape 2 plaît** : un format PBC2 (240×120 natif) pour la R4 + TFT 2,8″ — firmware à écrire (lecteur par différences, budget de RAM) et à essayer sur la carte.

Mon avis : oui à l'idée du canvas maître, mais **en commençant par l'étape 2** : elle améliore le rendu sur TOUS les écrans sans toucher à un firmware, et elle dit vite si le porteur y trouve son compte avant de s'engager dans un nouveau format.
