# Prompt de refonte — page de dessin Proof-of-Draw

> À coller comme premier message d'une nouvelle session Claude Code (modèle le plus performant
> disponible), ouverte dans le repo `proof-of-draw`. Ce document est autoportant ; il s'appuie sur
> `docs/AUDIT_PAGE_DESSIN.md` (constats détaillés avec fichiers/lignes) et `CLAUDE.md`.

---

## 0. Rôle et cadre

Tu es responsable de la **refonte complète de l'outil de dessin** de Proof-of-Draw (page
`app/draw/[device]/[screen]/page.tsx` et tout ce qui en dépend). Le dessin est le cœur du projet :
l'objectif est un outil **complet, fiable, agréable, pensé pour le téléphone d'abord** (priorité
absolue), avec une version PC de vrai niveau.

**Cette mission lève, pour la page de dessin uniquement, le non-goal « refonte UI / nouveau design »
de `CLAUDE.md`.** Tout le reste de `CLAUDE.md` reste en vigueur, en particulier :
- ne pas changer les conventions canvas → buffer (rotations, bits, tailles) ni le firmware ;
- serverless-safe (pas d'état mémoire côté serveur, tout en Redis), pas de cron, pas de base de données ;
- préserver les rate limits et le système de strikes ;
- pas de déploiement ; TypeScript strict, build valide ;
- donner les fichiers modifiés/créés, jamais de pseudo-diffs.

Avant de coder : lis `CLAUDE.md`, **tout** `docs/AUDIT_PAGE_DESSIN.md`, puis
`lib/screenProfiles.ts`, `lib/canvasToScreen.ts`, `lib/canvasPrimitives.ts`,
`lib/types/actions.ts`, `lib/crypto.ts` (`analyzeReplay`), `app/api/draw/route.ts`,
`app/api/submit-candidate/route.ts`, `app/BlockDetail.tsx` (rendu du replay), `lib/screenConvert.ts`,
`app/api/personal-frame/route.ts`, `app/api/send-to-screen/route.ts`. Ne t'appuie pas sur ta
mémoire du projet : vérifie dans le code.

## 1. Ce que veut le porteur (exigences non négociables)

1. **Téléphone d'abord** (portrait, un doigt, pouce ; 360–430 px), **PC aussi**. Paysage conservé et
   soigné pour les écrans paysage (e-ink 2.7", 2.9", OLED).
2. **Envoi évident** : un seul chemin d'envoi, toujours visible, jamais clippé, libellé clair.
3. **Sortir du plein écran ne doit jamais casser titre/envoi.**
4. **Ne jamais perdre un dessin** : aucune erreur ne réinitialise la page ni ne redirige ; brouillon
   persistant.
5. **Plus de doubles clics parasites** (une action = un effet, activation cohérente).
6. **Interface propre, prise en main immédiate** (outils, couleurs, tailles).
7. **Outil complet et fonctionnel** — « pas un Photoshop », mais une vraie app de dessin.

Les 40+ constats de l'audit (A1–A7, B1–B11, C1–C10, D, E) sont **tous** à traiter ou à écarter
explicitement avec justification. Chaque exigence ci-dessus a des critères d'acceptation dans l'audit §1.

## 2. Décisions produit actées (30/09/2026)

**D1 — Deux usages distincts des images. Ne jamais les confondre, ni dans l'UI ni dans le code.**
- **D1a. Image « modèle » dans un dessin** (existe déjà : image de référence semi-transparente pour
  dessiner par-dessus, éventuellement en gris). On la **conserve et on l'améliore** (déplacement au
  doigt / pincement, échelle, opacité). **Elle n'est JAMAIS envoyée ni incluse dans le payload,
  ni dans le replay.** On reste sur un dessin (PoD complet).
- **D1b. Envoi d'image (nouvelle fonctionnalité).** Importer une image existante et l'envoyer à
  **UN seul écran destinataire choisi**. Ce n'est pas un dessin :
  - **aucun** calcul de complexité, **aucune** validation ESP/quorum, **aucun** PoD/replay/score ;
  - **aucun** bloc, **aucune** galerie, **aucun** enregistrement pérenne : l'image n'existe que
    comme frame de livraison éphémère (TTL Redis), effacée à la consommation/à l'expiration ;
  - elle **consomme le quota d'envoi de 15 minutes** (même verrou `draw:lock` que le dessin, du côté
    de l'appareil émetteur) ;
  - usage voulu : « faire beau chez soi / chez un ami ».
  - Point d'entrée **séparé** de la page de dessin (« Envoyer une image »), avec son propre éditeur
    (voir W6). Endpoint serveur **dédié** (jamais `/api/draw`).

**D2 — Réception d'images par écran (pas par ESP), désactivée par défaut**, avec 4 valeurs :
`off` (défaut) · `private` (seul moi — mes propres appareils, cookie de session ou même profil artiste) ·
`friends` (**indisponible** : afficher « bientôt », voir `docs/IDEES_A_PLUS_TARD.md` — ne pas
implémenter d'amis) · `universal` (n'importe quel utilisateur peut m'envoyer une image).
Réglage dans `/profile`, à côté des réglages existants (`publicMode`, `acceptsAnaArt`,
`acceptsConvertedScreens`), même style d'API (`/api/my-devices/[deviceId]/…`). Un envoi d'image vers
un écran n'est autorisé que si le niveau de réception de cet écran le permet vis-à-vis de l'émetteur.
Le destinataire est **un seul écran** choisi dans une liste : mes écrans (si `private`+) ou les
écrans `universal` (liste publique sans données sensibles, sur le modèle de `/api/public-screens`).
Pas d'envoi « à tous à la fois » en V1.

**D3 — Niveaux de gris / opacité : uniquement s'ils sont 100 % sûrs à l'affichage.**
Fait établi (à re-vérifier dans le code) : le firmware envoie des buffers **1 bit** (e-ink
`Display(buf)`, OLED) ; seul le TFT RGB565 affiche de vrais gris/couleurs. Le panneau 2.7" V2 sait
faire 4 niveaux de gris matériellement, mais **cela exige un changement de firmware/protocole :
hors périmètre**. Règle retenue :
- **TFT** : couleurs pleines + vraie opacité (mélange puis quantification RGB565).
- **e-ink/OLED (1 bit) et rouge BWR** : pas de « gris vrai ». Les tons sont des **trames pixel-exactes**
  (motifs ordonnés type Bayer : ~12/25/50/75/88 %) choisies explicitement par l'utilisateur ;
  le curseur « Opacité » devient « **Densité** » et sélectionne une trame. Le rendu à l'écran du
  téléphone est **identique bit à bit** à ce que l'écran physique affichera (par construction : on ne
  dessine que des pixels 0/1, aucun seuillage ultérieur). Ajouter un test qui le prouve
  (`canvas → canvasToScreenPayload → décodage` == canvas d'origine).
- Ne pas promettre plus : signaler dans la doc que la finesse des trames sur e-ink dépend du panneau
  (rémanence) — à valider sur matériel réel.

**D4 — Outils : on garde tout, on améliore tout.** Pinceau, Gomme, Remplissage, Ligne, Rectangle,
Ellipse, Pipette, et **« Déplacer » devient « Sélection & déplacement »** : sélection rectangulaire,
**par couleur** (contiguë et globale), éventuellement lasso ; sélection flottante déplaçable au doigt,
avec copier/couper/supprimer, miroir H/V, rotation 90°, validation en touchant hors sélection. Formes :
contour **et** plein, épaisseur, contraintes (carré/cercle, angles de 45°). Pas de calques, pas de
filtres : le périmètre est « app de dessin pixel complète », pas un éditeur photo. Toute cette
richesse doit rester **utilisable au pouce**.

**D5 — Orientation : on garde le paysage** pour les écrans paysage (aide/indice pour tourner le
téléphone ; ne jamais bloquer le dessin en portrait).

**D6 — Mode invité (ESP public non possédé)** : la saisie du nom d'artiste est conservée mais
**préremplie** avec le nom du profil artiste si l'utilisateur en a un (session `artistId`,
`GET /api/artist`), toujours modifiable, « anonyme » si vide.

**D7 — Idée « amis » : notée, hors périmètre** (`docs/IDEES_A_PLUS_TARD.md`). Ne pas construire.

## 3. Points ouverts — recommandations à appliquer sauf avis contraire du porteur

À signaler dans ton compte rendu ; ne pas bloquer dessus.
1. **Modération de l'envoi d'image « universel »** : c'est un vecteur d'abus (n'importe qui peut
   pousser n'importe quelle image sur l'écran d'un inconnu ayant activé l'option). « Aucun
   enregistrement » (D1b) exclut de stocker l'image ; recommandation : **ne conserver aucune image**,
   mais un **journal éphémère sans contenu** (émetteur, destinataire, horodatage, TTL 48–72 h) pour
   pouvoir traiter un abus, un **blocage par le destinataire** (liste d'émetteurs bloqués), des
   limites de débit strictes, et un retour visible côté destinataire (qui a envoyé, quand).
2. **Score des déplacements** : un « déplacer » compte +1 dans le score PoD. Compter **une action par
   déplacement validé** (pas par frame de glissement) et plafonner/neutraliser les allers-retours pour
   éviter de gonfler le score.
3. **Cooldown côté serveur** : ajouter un endpoint de statut (`GET`, temps restant par appareil) et
   ne pas compter comme abus un 429 dû à une information manquante côté client. Toute modification de
   `/api/draw` doit préserver le comportement des strikes pour les vrais abus.

## 4. Chantiers (dans cet ordre, un commit cohérent par chantier, `tsc` vert à chaque commit)

**W0 — Reproduire et verrouiller.** Mettre en place la vérification mobile avant de coder : dev server
fonctionnel (`.claude/launch.json`), émulation tactile (Playwright ou l'outil navigateur intégré) aux
tailles 360×640, 390×844, 430×932, 820×1180 (tablette), 1440×900, portrait + paysage. Reproduire par
un test chaque symptôme du porteur (bouton d'envoi clippé après plein écran, redirection sur erreur,
undo après remplissage, replay désynchronisé, doubles taps). Ces tests deviennent la non-régression.

**W1 — Moteur de dessin pur** (`lib/drawEngine/*`, sans React, testable en Node) : bitmap pixel-exact
(Bresenham, brosses carrées/rondes pixelisées, pas d'anti-aliasing), formes (contour/plein), remplissage
strict, trames (D3), sélection (D4), **historique par deltas couplé au journal d'actions et au replay**
(une seule source de vérité : impossible d'avoir une image que le replay ne sait pas reconstruire,
undo/redo restaurent le replay, plus de `shift()` désynchronisé). Test-propriété : *l'image reconstruite
depuis le replay == l'image envoyée*, pour des séquences aléatoires incluant undo/redo/clear/fill/formes/sélection.

**W2 — Interface mobile d'abord.** Canvas plein cadre ; dock d'outils au pouce (actions fréquentes
toujours visibles : outil, couleur, taille, undo/redo) sans panneau modal bloquant ; **zoom continu +
pan** (pincement à deux doigts, molette, barre espace), aides de précision (loupe/curseur déporté),
rejet de paume/`pointerType`, gestion de `pointercancel`/`lostpointercapture`. Une convention
d'activation unique (`pointerup`/`click`), jamais de calque qui apparaît sous le doigt pendant le geste
qui l'ouvre. Icônes SVG avec libellés accessibles, cibles ≥ 44 px, composants + design tokens dans
`globals.css` (fin des styles inline dupliqués), thème cohérent avec le site. Disposition pilotée par
l'espace réellement disponible (conteneur/`matchMedia`), pas par un booléen `isMobile` global ; plus de
constante `57px` ; `viewport-fit=cover` + zones sûres. Mode « canvas plein cadre » en CSS (masque la nav)
+ API Fullscreen comme bonus seulement (iPhone ne la supporte pas).

**W3 — Flux d'envoi.** Machine à états explicite `dessin → envoi → (succès | erreur) → cooldown`,
verrou d'envoi par `ref`. Un seul bouton d'envoi principal toujours visible, ouvrant un flux en 3
étapes : **Titre → Aperçu tel qu'affiché sur l'écran (rendu final réel) → Confirmer** ; mode invité :
nom prérempli (D6). Retour d'état **universel** (toasts/écran de résultat, y compris mobile : succès,
position en file, rejet, file pleine, réseau, cooldown, prochain dessin dans X). Confirmation avant
« Tout effacer ».

**W4 — Brouillon persistant.** Sauvegarde continue (IndexedDB de préférence) de l'image, du journal
d'actions/replay et de **l'horloge de session** (`t` doit rester cohérent après restauration —
`analyzeReplay` : session ≥ 15 s, ≥ 3 traits, couverture ≥ 5 %, **automationRatio < 0,80** avec
intervalles < 15 ms). Restauration proposée à la réouverture ; purge après envoi réussi. **Jamais** de
navigation automatique sur erreur (audit A1) : état d'erreur en place + « Réessayer ».

**W5 — Image modèle (D1a).** Import, glisser/pincer pour placer/échelle, opacité, niveau de gris ;
calque de guide **séparé** de l'aperçu des formes (audit C5) ; jamais dans le payload ni le replay.
Supprimer le code mort de tramage de l'ancienne page.

**W6 — Envoi d'image (D1b, D2).** Nouvelle page/flux « Envoyer une image » : import, recadrage/
ajustement (cadrer, zoomer, déplacer), conversion adaptée à l'écran cible avec **aperçu WYSIWYG**
(noir/blanc par seuil, tramage Floyd–Steinberg / Atkinson / ordonné au choix, contraste/luminosité ;
BWR : option rouge ; TFT : couleur RGB565), choix du destinataire (D2), envoi. Conversion **côté
client** vers le buffer de l'écran cible (réutiliser `canvasToScreenPayload`), le serveur ne fait que
valider format/taille/droits. Endpoint dédié (`POST /api/send-image`) : vérifie le niveau de réception
du destinataire, applique le quota 15 min de l'émetteur, écrit une frame éphémère (TTL) livrée par le
mécanisme existant, **sans** bloc/galerie/PoD. Réglages de réception dans `/profile`. Sécurité : voir §3.1.

**W7 — Serveur, strictement nécessaire.** Endpoint de statut de cooldown ; réglage de réception ; envoi
d'image. Évolution des types `ActionEvent`/`ReplayEvent` et du rendu du replay côté galerie
(`BlockDetail.tsx`) **si** de nouveaux événements sont introduits (sélection/déplacement, formes
pleines, trames) — et mise à jour de `analyzeReplay`/`computeEnrichment` en conséquence. Rétrocompat :
les anciens replays doivent continuer à se rejouer.

**W8 — Nettoyage.** Supprimer `hooks/useCanvasDrawing.ts` (mort), les fonctions de tramage mortes,
les `console.log` de `canvasToScreen.ts`, l'ancien composant monolithique. Documenter l'architecture
(`docs/`), mettre à jour `CLAUDE.md` (section dessin) et la note vault de Proof of Draw si demandé.

## 5. Vérification (obligatoire, pas de « ça devrait marcher »)

- Tests unitaires du moteur (W1) et parité canvas→buffer→décodage (D3) dans le repo.
- E2E en émulation tactile sur toutes les tailles listées en W0 : plein écran ↔ normal, rotation,
  clavier virtuel ouvert, coupure réseau pendant l'envoi, rechargement en plein dessin (restauration),
  `pointercancel`, double-tap sur chaque contrôle, deux doigts (zoom vs dessin).
- Envoi réel de bout en bout **dans un environnement de test** : dessin → validation → affichage ;
  envoi d'image → réception selon chaque niveau (off refuse, private accepte l'émetteur propriétaire,
  universal accepte un tiers, friends indisponible).
- **Dis explicitement ce que tu n'as pas pu vérifier** (notamment le rendu sur iPhone Safari / Android
  Chrome réels et sur les panneaux e-ink physiques) au lieu de l'affirmer.

## 6. Format de rendu

Par chantier : fichiers modifiés, fichiers créés, contenu complet de chaque fichier, résultats des tests
lancés (sortie réelle), décisions prises sur les points ouverts (§3), et risques restants. Ne fais pas
de réarchitecture hors du périmètre ; si un changement serveur dépasse le strict nécessaire ou modifie
le contrat PoD (seuils, hash, types), **arrête-toi et demande** avant de le faire. Ne déploie rien,
ne pousse rien : commits locaux uniquement.
