# Audit de la page de dessin — état au 30/09/2026

Périmètre : `app/draw/[device]/[screen]/page.tsx` (1 891 lignes, un seul composant),
`hooks/useCanvasDrawing.ts`, `lib/canvasPrimitives.ts`, `lib/canvasToScreen.ts`,
`lib/types/actions.ts`, et le contrat serveur (`/api/draw`, `/api/submit-candidate`,
`lib/crypto.ts`).

**Méthode et limites.** Audit par lecture complète du code. Le serveur de dev n'a pas pu
démarrer dans cet environnement (`node` introuvable dans le lanceur) : **aucun constat
ci-dessous n'a été reproduit sur un vrai téléphone.** Chaque constat porte une étiquette :
- **[CODE]** : établi par lecture, le comportement découle mécaniquement du code.
- **[HYPOTHÈSE]** : cause plausible d'un symptôme que vous décrivez, à reproduire d'abord
  (appareil réel ou émulation tactile) avant de conclure.

Références au format `page.tsx:ligne` = `app/draw/[device]/[screen]/page.tsx`.

---

## 1. Vos demandes, formalisées

| # | Exigence | Critère d'acceptation vérifiable |
|---|---|---|
| R1 | **Téléphone d'abord, PC aussi.** Priorité absolue au téléphone (portrait, à un doigt, écrans 360–430 px), PC en second mais de vrai niveau. | Toutes les actions courantes atteignables au pouce ; cibles tactiles ≥ 44 px ; testé 360×640, 390×844, 430×932, iPad, 1440×900 ; portrait ET paysage. |
| R2 | **Envoi évident.** L'utilisateur comprend immédiatement où et comment envoyer. | Un seul bouton d'envoi principal, toujours visible (jamais clippé), libellé sans ambiguïté ; parcours d'envoi en étapes claires (titre → aperçu → confirmer). |
| R3 | **Titre + envoi fiables après le plein écran.** Sortir du plein écran ne doit jamais faire disparaître ou casser le titre/le bouton d'envoi. | Test automatisé : entrer/sortir du plein écran, pivoter, ouvrir le clavier → titre et envoi restent visibles et fonctionnels. |
| R4 | **Ne jamais perdre un dessin.** Aucune erreur ne doit réinitialiser la page. | Brouillon sauvegardé en continu (par appareil+écran), restauré après rechargement/crash/onglet tué ; aucune redirection automatique sur erreur ; erreurs affichées sans quitter la page. |
| R5 | **Plus de doubles clics parasites** sur outils / couleurs / taille de trait. | Une action = un effet, activation cohérente (même événement partout), pas de recouvrement d'un contrôle par un panneau pendant le même geste. |
| R6 | **Interface propre et prise en main immédiate** pour outils, couleurs, tailles. | Un nouvel utilisateur dessine et envoie sans explication ; outils inutiles retirés ; libellés/icônes non ambigus. |
| R7 | **Le dessin est au centre du produit** : qualité d'outil au niveau d'une vraie app de dessin (fluidité, précision, aperçu fidèle de ce que l'écran affichera). | Voir sections 3.C et 3.D. |

---

## 2. Ce qui marche et doit être conservé

- Pointer Events avec un trait par `pointerId` (`page.tsx:405`, `640-764`) et `touch-action: none` sur le canvas.
- Palettes et tailles pilotées par `lib/screenProfiles.ts` (source unique).
- Génération des buffers écran (`canvasToScreenPayload`) : c'est le chemin **validé en production**, les conventions de bits/rotation ne doivent pas changer.
- Le mécanisme de PoD (actions + replay) — voir contrat serveur en section 4.
- Le cooldown affiché avec barre de progression, la persistance locale du cooldown.

---

## 3. Constats

### A. Perte de dessin et envoi (priorité P0)

**A1 — Redirection automatique qui détruit le dessin [CODE].**
`page.tsx:540` et `586-587` : si le device n'est pas retrouvé après 5 essais, ou si **n'importe quel** `fetch` de chargement échoue (`catch { router.push("/draw") }`), la page navigue vers `/draw` → redirige vers `/profile`. Une micro-coupure réseau au chargement, ou une session qui expire, suffit à jeter l'utilisateur hors de la page **avec un dessin non sauvegardé**. C'est très probablement une des causes de « ça réinitialise la page ».
*Correction :* jamais de navigation automatique sur erreur ; état d'erreur affiché en place avec bouton « Réessayer » ; le dessin reste utilisable hors ligne.

**A2 — Aucune persistance du brouillon [CODE].**
Tout l'état (canvas, historique, actions, replay) est en mémoire (`useRef`). Rechargement, pull-to-refresh, navigation, ou **onglet tué par le navigateur mobile** (très fréquent quand on passe une minute dans une autre app) = dessin perdu. Aucun `beforeunload`, aucun autosave.
*Correction :* autosave (IndexedDB ou localStorage) sur `visibilitychange`/`pagehide` + toutes les N secondes + après chaque geste ; clé `(deviceId, screenId)` ; restauration avec le replay/les actions ET l'horloge de session (voir 4.3) ; purge après envoi réussi.

**A3 — Mobile : aucun retour d'erreur visible [CODE].**
`page.tsx:1252` (`status && !isMobile`) et `1268` (`banWarning && !isMobile`) : sur téléphone, **les messages d'erreur et de succès ne s'affichent pas du tout** (dessin rejeté, file d'attente pleine, erreur réseau, 429). L'utilisateur voit seulement le libellé du bouton changer. C'est directement lié à « on ne comprend pas ». 
*Correction :* toasts/bandeau de statut universels, pensés mobile d'abord ; écran de résultat après envoi (succès, position en file, prochain dessin dans X).

**A4 — Barre du haut qui clippe le bouton d'envoi [CODE, mécanisme] / [HYPOTHÈSE, cause exacte du symptôme plein écran].**
`page.tsx:1158-1164` : la barre est `flexWrap: nowrap; overflow: hidden`, avec ~10 éléments `flexShrink: 0` (retour, undo, redo, effacer, importer, badge guide, plein écran, statut, envoyer min 90 px). Sur 360 px la somme dépasse la largeur : ce qui déborde est **coupé sans scroll**, et le bouton « Envoyer » est le dernier. Le badge « Guide » ou le statut le pousse encore plus. À la sortie du plein écran, la hauteur/largeur se recalcule (`page.tsx:1146` : `calc(100dvh - 57px)` avec une hauteur de nav codée en dur) → décalages supplémentaires.
*Correction :* architecture de mise en page où l'envoi n'est jamais dans une barre qui peut déborder ; hauteur pilotée par CSS (`dvh`, `flex`) sans constante magique (57 px) ; test automatisé plein écran ↔ normal.

**A5 — Bouton d'envoi trompeur [CODE].**
`page.tsx:1303` : quand le titre est vide, le bouton s'appelle « ✏️ Titre ? », est rouge mais reste **cliquable** (`disabled` ne dépend pas du titre) ; cliquer fait clignoter un champ situé dans une autre barre (desktop). Sur mobile le titre n'est saisi que dans un panneau qui s'ouvre au clic (`page.tsx:1282`), avec **deux états de titre distincts** (`workTitle` et `toastTitle`) recopiés à la main. Le flux n'est ni découvrable ni cohérent.
*Correction :* flux d'envoi unique et explicite en 3 étapes (Titre → Aperçu tel qu'affiché sur l'écran → Confirmer), même logique mobile et desktop.

**A6 — Cooldown incohérent entre client et serveur [CODE].**
Client : cooldown mémorisé **par (device, écran)** dans `localStorage` (`page.tsx:32-33`). Serveur : verrou **par device** (`draw:lock:{deviceId}`) et un 429 compte comme **abus** (`strikeDevice`, 3 strikes = blacklist 7 jours, `app/api/draw/route.ts`). Conséquences : (1) un ESP à deux écrans (ex. 2.7" + OLED) : dessiner sur l'autre écran est accepté côté client puis refusé + compté comme abus côté serveur ; (2) localStorage vidé, navigation privée, autre téléphone → le client ignore le cooldown → envoi → strike. Des utilisateurs légitimes peuvent se faire bannir sans rien comprendre.
*Correction :* endpoint de statut (`GET` : temps restant, par device) interrogé à l'ouverture et avant l'envoi ; le 429 « légitime » ne doit pas compter comme abus quand il vient d'un défaut d'information côté client (décision serveur à trancher).

**A7 — Envoi : pas de garde contre le double envoi côté ref [CODE, risque faible].**
`canSend` dépend d'un `useState` (`page.tsx:614`) ; deux invocations dans le même tick sont théoriquement possibles. Utiliser un verrou `useRef`.

### B. Interaction tactile et « doubles clics » (P0/P1)

**B1 — Activation incohérente : `pointerdown` vs `click` [CODE].**
Barre du bas mobile : `onPointerDown` + `preventDefault` (`page.tsx:1602, 1610, 1625, 1639-1655`). Contenu des panneaux : `onClick` (`page.tsx:976, 987, 1061`). Fond des panneaux : `onPointerDown={onClose}` (`page.tsx:303`). Un contrôle qui ouvre un panneau au `pointerdown` fait apparaître un calque plein écran **sous le doigt pendant le même geste** ; selon le navigateur (capture implicite du pointeur tactile, `click` synthétique, double-tap), le geste peut atterrir sur le calque ou le refermer. C'est la famille de bugs « double clic qui fait n'importe quoi ». **[HYPOTHÈSE sur le mécanisme exact — à reproduire sur appareil.]**
*Correction :* une seule convention (activation à `pointerup`/`click`), jamais de calque qui apparaît sous le doigt pendant le geste qui l'ouvre, zones de tap séparées.

**B2 — Panneau outils : fermeture incohérente [CODE].**
Choisir un outil ferme le panneau (`page.tsx:976`), choisir une taille ou l'opacité non (`page.tsx:987, 1000`), choisir une couleur ferme (`page.tsx:1061`). Changer outil **et** taille demande de rouvrir le panneau : c'est ce qui pousse à retaper et à « double-cliquer ».
*Correction :* palette d'outils persistante et directement accessible, sans panneau modal pour les actions fréquentes.

**B3 — Pastilles de couleur rapides fausses [CODE].**
`page.tsx:1622` : `colors.slice(0, 6)` — les 6 **premières** couleurs de la palette. Sur TFT (48 couleurs) ce sont 4 rouges + 2 oranges ; sur BWR il n'y en a que 3. Aucune notion de « récentes » ou de « favorites ».

**B4 — Pas de `pointercancel` [CODE].**
`page.tsx:1456-1459` : seuls `down/move/up/leave`. Un geste système iOS/Android (bord d'écran, notification) déclenche `pointercancel` : le trait reste dans `strokes`, jamais clos, pas de `saveHistory`, pas d'événement `up` dans le replay → historique et replay désynchronisés du canvas.

**B5 — Deux doigts = deux traits ; pas de pincement [CODE].**
Le commentaire `page.tsx:401-404` traite le multi-touch comme du **dessin simultané**. Sur téléphone, deux doigts devraient zoomer/déplacer, pas dessiner ; et une paume posée avec un stylet crée des traits fantômes (aucun usage de `pointerType`, ni de rejet de paume).

**B6 — Zoom sans déplacement [CODE].**
`page.tsx:457-470` : échelle entière bornée 1–8, conteneur en `overflow: hidden` (`page.tsx:1432`), aucun pan. Sur téléphone (OLED 128×64 → échelle 2 sur 360 px = canvas de 256×128 px CSS) le doigt est bien plus gros qu'un pixel et il **n'existe aucun moyen de zoomer puis de se déplacer** (zoomer coupe le canvas, les zones cachées deviennent inaccessibles).
*Correction :* zoom continu + pan (pincement, molette), aide à la précision (loupe / curseur déporté), plein cadre du canvas.

**B7 — Effacement sans confirmation [CODE].**
Corbeille collée à Annuler/Rétablir (`page.tsx:1205-1210`), sans confirmation ; `Ctrl+Backspace/Delete` efface tout aussi (`page.tsx:625-629`) **sans** enregistrer l'événement `clear` dans actions/replay (le score et le replay divergent).

**B8 — Raccourcis clavier en conflit [CODE].**
`page.tsx:624` : `f` bascule le plein écran **et** `return` avant l'outil « Remplissage (F) » — le raccourci Remplissage n'a jamais fonctionné (l'aide en bas affiche pourtant « F remplissage », `page.tsx:1773`). Les lettres sont traitées même avec Ctrl/Cmd/Alt : `Ctrl+R` (rafraîchir) sélectionne aussi le rectangle, `Ctrl+F` (recherche) bascule le plein écran.

**B9 — Plein écran inexistant sur iPhone [CODE + connaissance plateforme, à confirmer].**
`requestFullscreen` sur un élément n'est pas supporté sur iPhone Safari ; l'appel est avalé silencieusement (`page.tsx:192-202`), donc le bouton « ⊟ » ne fait rien. Il y a en plus **deux** boutons plein écran dans l'interface mobile (barre du haut et barre du bas). Le plein écran natif ne doit pas être la base de la conception mobile : concevoir un mode « canvas plein cadre » en CSS (masquer la nav du site), et garder l'API Fullscreen comme bonus.

**B10 — Détection mobile fragile [CODE].**
`useIsMobile` : `false` au premier rendu (rendu desktop puis bascule = flash), seuil `innerWidth < 768` : un téléphone en **paysage** (≥ 768 px de large, ~350 px de haut) reçoit la disposition desktop (barre gauche 60 px + panneau droit 210 px) et laisse un canvas minuscule ; les tablettes portrait aussi. La disposition doit dépendre de la place disponible (conteneur/`matchMedia`), pas d'un booléen global.

**B11 — Icônes emoji sans libellé [CODE].**
Outils = emojis (✏️ ⬜ 🪣 🩸 ✥) : rendu différent selon la plateforme, `title=` inexistant au tactile, aucun `aria-label`. « ⬜ » pour la gomme et « 🩸 » pour la pipette ne sont pas lisibles.

### C. Moteur de dessin et fidélité à l'écran (P1)

**C1 — Anti-aliasing et opacité sur des écrans 1 bit [CODE].**
Le dessin est fait au canvas 2D natif : traits anti-crénelés (`drawLine`, `arc`, `page.tsx:683`, `canvasPrimitives.ts:50-58`) et curseur **Opacité 10–100 %** (`page.tsx:1000`). Ensuite `classifyPixel` (`canvasToScreen.ts:14-18`) seuille à 128 : ce que l'utilisateur voit (dégradés de gris) **n'est pas** ce que l'écran affichera. Un trait à 40 % d'opacité disparaît ou devient noir selon la couleur ; l'épaisseur varie selon le sous-pixel. L'opacité n'a aucun sens sur e-ink/OLED.
*Correction :* moteur de dessin **pixel-exact** (Bresenham / brosses carrées ou rondes pixelisées, pas d'AA), aperçu = rendu final ; retirer l'opacité pour les écrans à palette fixe.

**C2 — « Couleur libre » sur écrans mono/BWR : un piège [CODE].**
`page.tsx:1076-1094` : sélecteur libre sur e-ink/OLED. Toute couleur non noire/rouge est classée blanc ou noir par luminance (jaune → blanc = trait invisible). Sur TFT le sélecteur libre est utile, mais le buffer est en RGB565 (quantification non montrée).
*Correction :* palette stricte pour mono/BWR ; sur TFT sélecteur HSV avec aperçu de la couleur RGB565 réelle.

**C3 — Bug d'historique sur le remplissage [CODE].**
`page.tsx:667-669` : `saveHistory()` est appelé **avant** `floodFill`, jamais après. L'historique contient alors un doublon de l'état d'avant. Conséquences : (a) rétablir (redo) un remplissage restaure un état **sans** le remplissage ; (b) après un remplissage, annuler le trait suivant **supprime aussi le remplissage**. Reproductible par lecture ; à confirmer à l'écran.

**C4 — Historique et replay désynchronisés [CODE].**
- `MAX_HISTORY = 50` fait un `shift()` (`page.tsx:482`) mais `replaySnapshots` n'est jamais décalé → après 50 actions, un undo tronque le replay à la mauvaise longueur.
- `undo` **tronque** le replay (`page.tsx:496-499`) mais `redo` ne le **restaure pas** (`page.tsx:512-522`) : après undo puis redo, l'image contient un trait que le replay ne connaît pas → « replay ✓ » ne reflète pas l'œuvre.
- Sans `pointercancel` (B4) et avec l'effacement clavier (B7), d'autres divergences.
Le replay est la **preuve** du produit (Proof-of-Draw) : cet écart est un défaut de fond, pas cosmétique.

**C5 — Le guide d'image est effacé par les formes [CODE].**
`page.tsx:717` : l'aperçu ligne/rectangle/ellipse fait `overlay.clearRect(...)` sur le **même** calque que le guide (image de référence). Après la première forme, le guide disparaît et ne revient pas (l'effet de rendu `page.tsx:836-849` ne dépend pas des formes).

**C6 — Outil « Déplacer (V) » inexistant [CODE].**
Déclaré (`page.tsx:12-15, 38, 48`) et affiché comme outil, mais aucun code n'agit dans `pointerdown/move/up`. Un outil mort dans l'interface.

**C7 — Formes limitées [CODE].**
Rectangle et ellipse : contour seulement, épaisseur 1 px (`canvasPrimitives.ts:60-76`, ignore la taille choisie), pas de remplissage, pas de contrainte (carré/cercle, ligne à 45°), l'opacité est ignorée pour l'aperçu.

**C8 — Remplissage à tolérance [CODE].**
`colorsClose` tolère une distance de 30 (`canvasPrimitives.ts:16-22`, seuil 5 pour la couleur cible) : avec l'anti-aliasing (C1) le remplissage laisse des halos ou déborde. Disparaît avec un moteur pixel-exact (comparaison stricte).

**C9 — Aucun lissage/stabilisation, coordonnées entières [CODE].**
Position arrondie au pixel (`floor`, `page.tsx:643`), pas de lissage des trajectoires, pas de pression (le type `ReplayEvent.pressure` existe mais n'est jamais rempli). Pour du pixel art c'est acceptable ; pour un dessin au doigt sur 128×64 c'est très heurté sans zoom (B6).

**C10 — Import d'image = « guide » compliqué [CODE].**
Trois états (charger → positionner → activer) avec des champs numériques X/Y au clavier (`page.tsx:1821-1838`) : inutilisable au doigt (pas de glisser/pincer). Les fonctions de tramage `ditherFloyd`/`ditherOrdered` (`page.tsx:56-116`) sont **du code mort** (l'import ne s'applique plus jamais au dessin).
*Décision produit à trancher* (section 5).

### D. Aperçu, cadrage, cohérence visuelle (P1/P2)

- **Pas d'aperçu « ce que l'écran affichera »** avant l'envoi : le canvas est en couleur/gris, l'écran sera en 1 bit / 3 couleurs / RGB565.
- **Pas de cadre écran** (bords, ratio, orientation réelle du panneau, zone visible).
- Disposition desktop : trois panneaux (outils gauche, palette+opacité+grille+image à droite, clavier en bas) sans hiérarchie ; le titre — obligatoire — est dans une barre fine séparée (`page.tsx:1310-1343`).
- Tout est en styles inline (≈ 1 900 lignes, une centaine d'objets `style`) : pas de tokens, pas de système de composants, pas de réutilisation (les couleurs `rgba(124,107,255,…)` sont recopiées partout). Le reste du site utilise `globals.css`.
- `env(safe-area-inset-bottom)` est utilisé (`page.tsx:318, 1596`) mais `viewport-fit=cover` n'est pas déclaré dans `app/layout.tsx` : sur iPhone les zones sûres restent à 0 (barre du bas collée à la barre d'accueil).
- Verrou de défilement du `body` géré par **trois** effets concurrents (`MobileBottomSheet` monté 3 fois) qui se réinitialisent mutuellement (`page.tsx:287-294`).
- `canvasToScreen.ts` logge en `console.log` des aperçus de buffer à chaque envoi OLED (bruit + fuite d'information).

### E. Dette technique (P2)

- `hooks/useCanvasDrawing.ts` : **jamais importé** (code mort, API concurrente avec des événements souris/tactile séparés). À supprimer ou à remplacer par le nouveau moteur.
- `ditherFloyd` / `ditherOrdered` : morts (C10).
- Un composant de ~1 400 lignes avec 40+ états et refs, aucune séparation moteur / état / interface / persistance / envoi ; aucun test.
- Le tampon d'historique stocke jusqu'à 50 `ImageData` complets (TFT 128×160×4 = 80 Ko chacun) : acceptable, mais à remplacer par des deltas si le moteur change.

---

## 4. Contrat serveur à préserver (ne pas casser)

### 4.1 Requête d'envoi — `POST /api/draw`
Corps : `{ screen, deviceId, workTitle (≤ 80), drawArtistName? (≤ 40, mode invité), actions[], replayEvents[], drawScore, black+red | buffer }`.
Buffers : `eink29bwr` = `black` + `red` (4 736 o chacun) ; `eink27bw` = `buffer` (5 808 o) ; `oled096` = `buffer` (1 024 o) ; `tft18` = `buffer` RGB565 LE (40 960 o). Limite : 60 000 caractères base64 par buffer. `drawScore ≤ 0` → refus « dessin vide ».
Auth : propriétaire de l'ESP (cookie de session) **ou** ESP en `publicMode` (invité).

### 4.2 Conventions de conversion canvas → buffer
Références dans `CLAUDE.md` et `lib/canvasToScreen.ts` (rotations, bits). **Ne pas les ré-implémenter** : le nouveau moteur doit produire un canvas aux dimensions `SCREEN_PROFILES[screen].width × height` et continuer à passer par `canvasToScreenPayload` (ou son remplaçant vérifié bit à bit).

### 4.3 Preuve de dessin (PoD) — contraintes réelles côté serveur
`lib/crypto.ts` (`analyzeReplay`) et `submit-candidate` rejettent ou marquent :
- durée de session `MIN_SESSION_DURATION_MS` = **15 s** ; nombre de traits `MIN_STROKE_COUNT` = **3** ; couverture de grille `MIN_GRID_COVERAGE` = **5 %** ;
- **`automationRatio`** = part d'intervalles < **15 ms** entre événements consécutifs du replay, seuil `MAX_AUTOMATION_RATIO` = **0,80** → si le nouveau moteur échantillonne à haute fréquence (`getCoalescedEvents`, `requestAnimationFrame`, écrans 120 Hz) sans **limiter le débit du replay (≥ 16 ms)**, des dessins légitimes seront rejetés comme « non humains » ;
- l'horloge `t` est relative à `sessionStartRef` = **montage de la page** (`page.tsx:424`) et pas au premier trait : avec un brouillon restauré (A2), l'horloge de session doit être persistée/recalée pour ne pas fausser durée et intervalles ;
- le replay doit rester **fidèle** à l'image finale (sinon « replay ✓ » faux dans les galeries) → corriger C4 dans la nouvelle conception, avec des tests (image reconstruite depuis le replay == image envoyée) ;
- score (`scoreFromActions`) : undo −1, clear = remise au checkpoint, redo neutre.
Si le nouveau moteur change la nature des événements (ex. brosses pixel-exact, formes), les **types** `ActionEvent`/`ReplayEvent` et le rendu du replay côté galerie (`BlockDetail.tsx`, via `lib/canvasPrimitives.ts`) doivent évoluer ensemble.

### 4.4 Cooldown et abus
Verrou serveur par device (`DRAW_WINDOW_SEC`, 900 s) ; 429 = strike ; 3 strikes = ban. Voir A6.

---

## 5. Décisions produit à trancher avant de coder

1. **Import d'image** : le supprimer, le garder comme « image de référence » simple (glisser/pincer, jamais soumise), ou permettre un **vrai import converti** (tramage) ? Aujourd'hui : référence seulement, par choix anti-triche PoD.
2. **Opacité et niveaux de gris** : confirmer leur suppression sur les écrans 1 bit / BWR.
3. **Outils conservés** (proposition) : Pinceau, Gomme, Remplissage, Ligne, Rectangle/Ellipse (avec option plein/contour), Pipette (optionnelle). Retirer « Déplacer » sauf besoin réel.
4. **Cooldown** : lecture du statut serveur + traitement des 429 « non fautifs » (impact sur `/api/draw`).
5. **Orientation** : demander/conseiller le paysage pour les écrans paysage (eink27, eink29, OLED) ? Rotation du canvas d'affichage ?
6. **Mode invité (ESP public)** : nom d'artiste dans le flux d'envoi (aujourd'hui saisi à part).
7. **Niveau de qualité du replay** : pression, lissage — ou rester simple.

---

## 6. Structure recommandée pour la refonte (à formaliser dans le prompt)

1. **Moteur pur** (`lib/drawEngine/*`) : raster pixel-exact, brosses, formes, fill strict, historique par deltas **couplé** au journal d'actions/replay (une seule source de vérité), sans dépendance React → testable en Node.
2. **État** : machine à états explicite (`dessin → envoi → succès/erreur → cooldown`), verrou d'envoi par `ref`.
3. **Persistance** : brouillon (image + journal + horloge de session) restaurable.
4. **Interface mobile d'abord** : canvas plein cadre, dock d'outils au pouce, undo/redo toujours visibles, panneau minimal (couleurs/tailles) sans calque bloquant, flux d'envoi en 3 étapes avec aperçu écran, toasts.
5. **Interface desktop** : même modèle, raccourcis clavier corrects (modificateurs ignorés), molette pour zoom, pan à la barre espace.
6. **Design tokens** dans `globals.css` (fin des styles inline dupliqués), icônes SVG avec libellés accessibles.
7. **Tests** : unitaires moteur (historique/replay cohérents, fill strict, bornes), parité `canvasToScreen`, e2e Playwright en émulation tactile (360×640, 390×844, 430×932, iPad, desktop) : plein écran ↔ normal, rotation, clavier virtuel, coupure réseau pendant l'envoi, rechargement en cours de dessin, `pointercancel`.
8. **Vérification sur appareils réels** (iPhone Safari, Android Chrome) avant clôture — c'est le point que cet audit n'a **pas** pu couvrir.

---

## 7. Récapitulatif des priorités

| Priorité | Constats |
|---|---|
| **P0** — perte de données / envoi cassé | A1, A2, A3, A4, A5, A6, B1, B2 |
| **P1** — usage tactile et fidélité | B3–B10, C1–C4, C5–C7 |
| **P2** — polish et dette | C8–C10, D, E |

---

## 8. Décisions actées le 30/09/2026

Les points de la section 5 sont tranchés, voir `docs/PROMPT_REFONTE_DESSIN.md` §2 (D1–D7) :
import d'image en deux usages séparés (modèle jamais envoyé / envoi d'image à un seul écran,
sans validation ni enregistrement) ; réception d'images par écran (off par défaut, privée / amis
« bientôt » / universelle) ; niveaux de gris = trames 1 bit sur e-ink/OLED, vrais gris sur TFT ;
tous les outils conservés, « Déplacer » → sélection & déplacement ; paysage conservé ; nom
d'artiste invité prérempli depuis le profil. Idée « amis » notée dans `docs/IDEES_A_PLUS_TARD.md`.
