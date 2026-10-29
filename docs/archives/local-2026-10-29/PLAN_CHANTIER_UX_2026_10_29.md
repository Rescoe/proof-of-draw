`# Plan de chantier UX — navigation, accueil, composants, graphiques, responsive
`
`Date : 29 octobre 2026
`Auteur : Claude (réalisateur). Destinataire : Codex / GPT (audit du plan), puis le porteur.
`Entrées : `docs/AUDIT_UX_NAVIGATION_ACCUEIL_2026_10_29.md` et `docs/AUDIT_UX_RESPONSIVE_COMPOSANTS_2026_10_29.md` (lus en entier).
`État du code comparé : `origin/main` au commit **`f2e2222`** (les deux audits portent sur `0c24fd8`).
`Nature : plan. **Révision 2 (29/10/2026, après l'audit Codex `docs/AUDIT_PLAN_CHANTIER_UX_2026_10_29.md` : GO conditionnel).** Les corrections P0/P1 de l'audit et les six décisions sont intégrées ci-dessous ; les passages qu'elles remplacent ont été réécrits (pas de contradiction résiduelle). Le chantier est exécuté par **cinq jalons** (§ 10) ; seul le **jalon 1 — Navigation et vocabulaire** est autorisé, sans push ni déploiement avant audit Codex du jalon.
`
`## Révision 2 — décisions tranchées et corrections intégrées
`
`| # | Décision / correction | Où dans ce plan |
`|---|---|---|
`| D1 | Barre : **Accueil · Galerie · Créer une œuvre · Réseau · Communauté · Apprendre · Mon espace** | § 2.1 |
`| D2 | Hamburger à **1024 px** ; critère réel = aucun retour à la ligne, quel que soit le zoom | § 2.3 |
`| D3 | Accueil : **`EspActivityFeed` conservé**, terminal réservé à `/network` ; en `surface="home"` aucune colonne de terminal vide | § 3.2 |
`| D4 | **Playwright** en `devDependency`, script `test:ui` séparé, jamais dans `npm test` ni dans le build Vercel | § 8.1 |
`| D5 | Snapshot réseau borné : **lot séparé après le chantier UX**, à inscrire à la roadmap proche avant toute promesse de 10 000 appareils | § 9, § 12 |
`| D6 | « Onboard » → **« Associer un appareil »** (action) ; « page d'association » seulement dans une phrase documentaire ; distinction stable *Installer* (matériel, firmware) / *Configurer le Wi-Fi* (portail de la carte) / *Associer* (rattacher au profil) | § 2.4, § 3.1, § 6 |
`| P0 | `Animer` dépend de la **capacité réelle** (`animCapable` + firmware/caps, calculée côté serveur), pas de `lib/bench/screens.ts` seul | § 6 lot b |
`| P1 | **Une seule** section « Artistes du réseau » (actifs + nouveaux), jamais deux listes | § 3.1, § 3.3 |
`| P1 | `surface="home"` : la constellation prend **toute la largeur** sans sélection ; détail à droite (grand écran) ou sous la carte ; test de **structure de grille** | § 3.2 |
`| P1 | CTA d'accueil **« Connecter un appareil » → `/learn?path=install#installer`** ; dans Mon espace : **« Associer un appareil » → `/onboard`** | § 3.1, § 2.4 |
`| P1 | Cache des mesures : clé `(deviceId, owner|public)`, Promise partagée, expiration mesurable, invalidation explicite, démontage sûr, **jamais de partage privé→public** | § 5.2 |
`| P1 | **Lecture et période d'abord, `ChartCore` ensuite** (ne bloque pas la correction du double fetch) | § 5.5, § 10 |
`| P2 | Pas d'assertion chronométrique stricte en CI pour les artistes actifs : test **structurel** (borne, complexité), temps seulement informatif | § 8.5 |
`
`**Conservé impérativement** (confirmé par le porteur) : dans le tiroir téléphone/tablette, les **quatre groupes PARTICIPER · EXPLORER · MON COMPTE · AIDE** ; la barre desktop condensée n'en est que la version adaptée aux grands écrans.
`
`Contraintes reprises telles quelles : ne rien supprimer, ne pas refaire le design global, ne toucher ni au consensus, ni aux firmwares, ni à l'OTA, ni au schéma Redis, ne pas multiplier les lectures de mesures, préserver toutes les URL, téléphone d'abord puis tablette puis ordinateur.
`
`---
`
`## 0. Ce qui a changé depuis les audits (à lire avant le reste)
`
`Deux commits ont été poussés **après** `0c24fd8`. Ils ne touchent pas l'interface de navigation, mais ils modifient des faits cités par les audits :
`
`| Commit | Contenu | Effet sur le plan |
`|---|---|---|
`| `01a69f2` | Le BWR 2,9″ téléchargeable repasse en `eink29bwr-2.13` (portail Wi-Fi + client OTA + frame par morceaux ; capteur/OLED à 0). Matrice et cellule `r4eink29` (1.2) corrigées. | La matrice de compatibilité a de nouvelles valeurs (version téléchargeable BWR = 2.13). Elle sera rendue en cartes sur téléphone : les fixtures du test responsive doivent prendre cette version de la matrice, pas l'ancienne. |
`| `f2e2222` | Le profil d'installation **UNO R4 + TFT 1,8″** (`r4Tft18`) ne propose plus l'ancien port `pod_uno_r4_tft18` (1.1, jamais essayé) mais la station `pod_uno_r4_tft18_env` (`r4tft18-2.6`). `testedOnHardware: true`, nouvelle note, câblage SD reformulé, ligne de matrice `r4tft18` séparée (V2 observé, bloc #126), tests `hardwareMatrix` / `learnInstallProfiles` / `learnSdWiring` alignés. | Les 9 profils de la page Installer ont maintenant **un profil R4 de plus « éprouvé »**. Tout test de viewport ou de libellé qui compte « profils non testés » doit lire `INSTALL_PROFILES`, pas une liste en dur. Le libellé « PORT NON TESTÉ » de `r4Tft18` n'existe plus. |
`
`Deux changements **déjà présents dans `0c24fd8`** mais qui ont des conséquences directes sur le Lot « graphiques », à ne pas défaire :
`
`1. `MeasuresChart` est désormais **interactif** (appui ou glissement place le curseur, date + valeur lues dessous, le doigt levé laisse la valeur, `user-select: none`, `-webkit-touch-callout: none`, menu contextuel bloqué), avec **repères de temps** (`lib/timeAxis.ts`, heure locale). `MeasuresExplorer` a reçu la même correction (le doigt levé ne vide plus l'infobulle). → L'audit responsive § 7.4 (« interaction tactile sans appui long ») est **résolu** pour les deux familles de graphiques.
`2. La qualité de l'air n'affiche **jamais de nombre** : niveau en toutes lettres (`vocLevel`, six niveaux), couleur, tendance (`vocTrend`), bouton ⓘ (`VOC_EXPLAIN`) ; le brut du SGP40 (`voc`) n'est plus dans le groupe « Environnement » (il reste stocké). → Le graphique unifié doit **réutiliser** `vocLevel`, `vocTrend`, `AirNote`, jamais un axe numérique pour `vocidx`.
`
`Autres fonctions récentes à préserver (ajoutées avant `0c24fd8`, absentes des audits) :
`
`- **Remix / reprise d'animation** : bouton sur `BlockDetail` (`/animer?remix=…`) et dans la galerie des rejets (`/animer?resume=…`). La refonte de la fiche d'œuvre et de la galerie ne doit pas les masquer.
`- **Boucles d'animation dans la constellation** (`AnimLoop`) et pseudo-écran **`oled096aux`** (OLED des BWR). La variante « home » de `NetworkMap` doit les conserver (ce sont les miniatures des nœuds, pas la section « Actuellement affiché »).
`- **Réglage « Œuvres fixes » par écran** dans `DevicesPanel` (deux interrupteurs ON/OFF). La simplification des actions par appareil (§ 6 lot 8) ne doit pas l'enfouir.
`
`---
`
`## 1. Vérification des constats des deux audits contre `f2e2222`
`
`Légende : **C** confirmé · **P** partiellement vrai / à nuancer · **D** déjà corrigé · **F** faux ou inexact.
`
`### 1.1 Navigation et accueil
`
`| # | Constat | Verdict | Preuve sur `f2e2222` |
`|---|---|---|---|
`| N1 | 4 entrées principales + « Plus » à 8 entrées | **C** | `lib/navLinks.ts` : `PRIMARY_LINKS` (Créer, Découvrir, Mes écrans, Installer un écran), `MORE_LINKS` (8). Test `tests/navLinks.test.ts` verrouille ces libellés : il faudra le réécrire dans le même commit. |
`| N2 | Bascule mobile à 560 px | **C** | `app/globals.css:887` `@media (max-width: 560px)` masque `.site-nav__links` et affiche `.nav-burger`. |
`| N3 | Pas de `aria-current` | **C** | `app/NavMenu.tsx` : aucune occurrence. |
`| N4 | Échap / clic extérieur / focus | **P** | Échap ferme le **tiroir mobile** (`NavMenu.tsx:23`). Le menu « Plus » du bureau est un `<details>` natif : ni Échap ni clic extérieur (il est refermé seulement au changement de route). Aucun piège ni restitution du focus dans le tiroir. |
`| N5 | `/learn` active « Installer un écran » pour toute page | **C** | `PRIMARY_LINKS[3].match = ["/learn", "/firmware"]`. |
`| N6 | `/draw` est déjà une bonne page de choix | **C** | `app/draw/DrawChoice.tsx` : sections « Dessiner sur mes écrans » / « Dessiner sur un écran partagé », états chargement/erreur/vide. **Aucun** choix Dessiner/Animer par écran : l'animation s'ouvre depuis `/profile` (bouton 🎞) ou `/animer`. |
`| N7 | L'accueil manque de « portes d'entrée » | **D** | `app/page.tsx` contient déjà `home-actions` : Créer une œuvre / Découvrir / Connecter mon écran (grille 3 → 1 colonne à 720 px). Reste à renommer « Découvrir » en « Galerie » et à relier « Connecter mon écran » à Mon espace. |
`| N8 | Répétition « Actuellement affiché » sur l'accueil | **C** | `NetworkMap.tsx:352` rend `LiveDisplaysSection`. `NetworkMap` sert `/` **et** `/network` (`app/page.tsx:47`, `app/network/page.tsx:8`) : une prop de variante est nécessaire. |
`| N9 | Double journal | **C** | `NetworkMap.tsx:174` rend `GlobalTerminalPanel` ; `app/page.tsx` ajoute `EspActivityFeed` dessous. |
`| N10 | Vocabulaire « Block Explorer », « Blocs récents », « ESP liés », « Ajouter un ESP », « Onboard » | **C** | `GalleryClient.tsx:321`, `BlockGalleryClient.tsx:116`, `profile/page.tsx:821,856`, `artists/[artistId]/page.tsx:386`, `learn/components/InstallGuide.tsx:471` (lien « Onboard » dans la doc). |
`| N11 | Snapshot réseau = tous les appareils | **C** | `lib/networkSnapshot.ts` (`getNetworkSnapshot`, enveloppé dans `unstable_cache` avec tag `network-snapshot`). Risque d'échelle réel, traité hors de ce chantier (§ 9). |
`
`### 1.2 Responsive et composants
`
`| # | Constat | Verdict | Preuve |
`|---|---|---|---|
`| R1 | `.site-main` sans gouttière | **C** | `globals.css:358` : seulement `min-height`. |
`| R2 | `DrawChoice` / `CirclesClient` collés aux bords | **C** (à confirmer au viewport) | `padding: "1.5rem 0 3rem"` dans les deux (`DrawChoice.tsx:59`, `CirclesClient.tsx:77`). |
`| R3 | Boutons hétérogènes | **C** | p. ex. `CirclesClient.tsx:25` (`btn()` local), styles inline dans `DevicesPanel`, `SensorPanel`, `BlockDetail`. |
`| R4 | Tableaux `powerTable` / `synthTable` | **C** | `PowerPath.tsx:46`, `SynthesisPath.tsx:77`, `MarkdownDoc.tsx:23` (la matrice est rendue par `MarkdownDoc` → `synthTable`). |
`| R5 | Deux familles de graphiques | **C** | `MeasuresExplorer` (temp/hum) et `MeasuresChart` (vocidx, rssi, lat, dl). |
`| R6 | Deux états de période | **C** | `SensorPanel.tsx` : `hours` (24 h/7 j/31 j) pour `MeasuresChart` et le tableau ; `MeasuresExplorer` a son propre `range` (day/week/month). |
`| R7 | Lectures redondantes | **C**, nom corrigé | Le composant s'appelle `SensorModal` dans `profile/SensorPanel.tsx:52` : il lit `?hours=744` (`MEASURE_MAX_HOURS`), puis `MeasuresExplorer owner` relit le même historique. Côté public : `ArtistSensors.tsx` lit l'explorateur **et** `?hours=` pour les autres grandeurs. Dans `SidePanel.tsx`, la seconde lecture (« Voir la connexion sur 48 h ») ne part que sur un clic : moins grave. |
`| R8 | Interaction tactile sans appui long | **D** | Voir § 0 (corrigé dans `0c24fd8`). |
`| R9 | Rangée de période de l'explorateur sans `flex-wrap` | **C** | `MeasuresExplorer.tsx` : `<div role="group" aria-label="Période" style={{ display: "flex", gap: 6 }}>` + texte de période sur la même ligne. |
`| R10 | Modales sans focus trap | **C** | `SensorModal` ne gère que Échap ; `MeasuresExplorer` plein écran idem. |
`| R11 | « Mesures publiques / privées » à expliciter | **C** | Rien dans `SensorModal` n'indique l'état public/privé (le réglage existe côté `Device.measuresPublic`). |
`| R12 | Matrice → cartes | **C** | Aucune variante mobile dans `CompatibilityMatrix.tsx` / `MarkdownDoc.tsx`. |
`
`### 1.3 Points des audits que je corrige ou précise
`
`1. **« Les anciennes URL » ne demandent aucune redirection** : le plan **ne change aucun chemin**. Seuls les libellés, regroupements et états actifs changent. Les redirections historiques existantes (`LegacyHashRedirect`, `/bench` → `/animer`, `/gallery-anim` → galerie) restent telles quelles et sont couvertes par un test (§ 8).
`2. **« Découvrir → Galerie »** : le lien `Artistes` est aujourd'hui rattaché à `Découvrir` par `match` (`/artists`). Dans la cible, `Artistes` passe sous **Communauté** : il faut donc retirer `/artists` du `match` de Galerie, sinon deux entrées s'allument.
`3. **Mon espace** regroupe `/profile` **et** `/my-devices` et `/onboard` : l'état actif de « Mon espace » doit inclure `/onboard`, aujourd'hui rattaché à « Plus ».
`4. **« Animer » n'est pas un nouvel écran** : `/animer` existe, avec ses propres capacités d'écran (`lib/bench/screens.ts`). Le choix Dessiner/Animer dans `DrawChoice` réutilise ces capacités ; aucune nouvelle route.
`
`---
`
`## 2. Navigation cible
`
`### 2.1 Données (une seule source : `lib/navLinks.ts`)
`
`Remplacer `PRIMARY_LINKS` / `MORE_LINKS` par une structure à groupes **sans supprimer de destination** :
`
````ts
`export interface NavLink { href: string; label: string; match?: string[]; /* + query: { key, value } pour les sous-vues */ }
`export interface NavGroup { id: "participer"|"explorer"|"compte"|"aide"; label: string; links: NavLink[] }
`
`export const DESKTOP_LINKS: (NavLink | { id: "communaute"; label: "Communauté"; links: NavLink[] })[] = [
`  { href: "/",        label: "Accueil" },
`  { href: "/gallery", label: "Galerie",          match: ["/gallery", "/gallery-ana", "/gallery-anim"] },
`  { href: "/draw",    label: "Créer une œuvre",  match: ["/draw", "/animer", "/draw-lab"] },   // CTA accentué
`  { href: "/network", label: "Réseau" },
`  { id: "communaute", label: "Communauté", links: [{ href: "/artists", label: "Artistes" }, { href: "/circles", label: "Cercles privés" }] },
`  { href: "/learn",   label: "Apprendre",        match: ["/learn", "/firmware"] },
`  { href: "/profile", label: "Mon espace",       match: ["/profile", "/my-devices", "/onboard"] },
`];
````
`
`Destinations conservées dans la barre : toutes celles de l'audit. Destinations qui **quittent le premier niveau** mais restent atteignables : `Animations` (filtre `?type=animation` de la Galerie), `Agents IA` (filtre « Créations IA » de la Galerie, vers `/gallery-ana`), `Connecter mon écran` (Mon espace + groupe Aide du tiroir), `Installer un écran` (Apprendre → parcours `install`, et groupe Aide).
`
`### 2.2 États actifs (fonction pure, testée)
`
`- Règle de base inchangée : chemin exact ou préfixe + `/`.
`- Ajout d'un critère de **requête** pour les sous-vues : `/gallery?type=animation` allume Galerie (et non un second bouton) ; `/learn?path=install` allume Apprendre avec sous-état « Installer » **dans la navigation locale d'Apprendre**, pas dans la barre globale.
`- Une seule entrée active à la fois (test : pour chaque URL historique, exactement une entrée active).
`
`### 2.3 Bureau (≥ 1024 px)
`
````
`[logo] Accueil  Galerie  [Créer une œuvre]  Réseau  Communauté ▾  Apprendre  Mon espace      (une seule ligne, hauteur 64 px stable)
````
`
`- `Communauté` : bouton + menu (pas `<details>`) → Échap, clic extérieur, `aria-expanded`, `aria-haspopup="menu"`, focus rendu au bouton.
`- `aria-current="page"` sur le lien actif.
`- Entre 900 et 1024 px : libellés compacts (« Créer » masqué derrière l'icône **non** : on garde le texte, on réduit l'espacement et on passe en hamburger **à 1024 px**).
`
`### 2.4 Tablette et téléphone (< 1024 px)
`
`Barre : logo + hamburger (zone 44 × 44 px). Tiroir groupé :
`
````
`Accueil
`PARTICIPER     Créer une œuvre · Galerie
`EXPLORER       Réseau en direct · Artistes · Cercles privés
`MON COMPTE     Mon espace · Associer un appareil
`AIDE           Comprendre Proof-of-Draw · Installer un appareil · Documentation technique
````
`
`- À l'ouverture : focus sur le premier lien ; focus **piégé** dans le tiroir ; à la fermeture, focus rendu au hamburger ; `inert`/`aria-hidden` sur le reste de la page ; défilement du corps verrouillé (déjà fait) ; Échap (déjà fait).
`- Chaque lien : hauteur ≥ 44 px.
`- « Comprendre Proof-of-Draw » → `/learn` ; « Installer un appareil » → `/learn?path=install#installer` ; « Documentation technique » → `/learn?path=network#how` (parcours « réseau » existant dans `LearnNavigation`) ; « Comprendre Proof-of-Draw » → `/learn`.
`
`### 2.5 Fichiers
``lib/navLinks.ts`, `app/NavMenu.tsx`, `app/layout.tsx` (en-tête), `app/globals.css` (bloc `site-nav*`, `nav-*`, media 560 → 1024), `tests/navLinks.test.ts` (réécrit), nouveau `tests/navActive.test.ts`.
`
`---
`
`## 3. Accueil
`
`### 3.1 Composition cible
`
`1. **Hero** (existant : `hero`, titre, `home-lead`) — texte inchangé, jargon matériel déjà absent.
`2. **Trois portes** (existant `home-actions`) — libellés : *Créer une œuvre* (`/draw`) · *Voir la galerie* (`/gallery`) · *Connecter un appareil* (**`/learn?path=install#installer`** : le guide explique l'installation puis l'association — destination déterministe).
`3. **Le réseau, en direct** — `NetworkMap surface="home"` : constellation pleine largeur sans sélection ; panneau de détail à droite (grand écran) ou sous la carte (tablette / téléphone) ; **sans** `LiveDisplaysSection`, **sans** `GlobalTerminalPanel`, **sans** colonne réservée au terminal (§ 3.2).
`4. **Activité du réseau** — `EspActivityFeed` **seul** (déjà pleine largeur).
`5. **Artistes du réseau** (nouveau, borné, **une seule section**) — vue principale « Actifs maintenant », sous-état « Nouveaux artistes » (reprend le contenu de `RecentArtists`), lien « Tous les artistes » vers `/artists` — voir § 3.3.
`6. **Œuvres récentes** — `BlockGallery` renommé (« Œuvres récentes », lien « Voir toute la galerie »).
`7. **Comprendre ou rejoindre** — deux liens : *Comprendre Proof-of-Draw* (`/learn`), *Installer un appareil* (`/learn?path=install#installer`).
``RecentArtists` n'est donc **pas** affiché en plus : son contenu (derniers inscrits) devient le sous-état « Nouveaux artistes » de la section 5 ; aucune information n'est supprimée, aucune seconde liste n'apparaît.
`
`### 3.2 Variante `surface` de `NetworkMap`
`
`- Nouvelle prop **explicite** `surface: "home" | "network"` (défaut `"network"` pour ne pas changer `/network`).
`- `home` : cache `GlobalTerminalPanel` et `LiveDisplaysSection`, conserve `useLiveDisplays` **uniquement** si les miniatures des nœuds en dépendent (à vérifier au code avant le lot ; sinon suppression de l'appel — **aucune lecture Redis ni fetch supplémentaire**, seulement des suppressions).
`- `network` : comportement actuel inchangé.
`- **Structure de grille** (pas seulement des chaînes absentes) : en `home`, la grille du composant n'a **pas** de piste « terminal » ; sans sélection, la constellation occupe `grid-column: 1 / -1` ; avec sélection, deux pistes (carte | détail) ≥ 1100 px, une seule piste (détail sous la carte) en dessous. Test : le HTML rendu pour chaque `surface` ne contient ni `ld-` ni `terminal` en `home` et le conteneur porte la classe `nv2-layout--home` dont la feuille de style ne déclare qu'une piste ; `network` contient les deux. Les miniatures des nœuds et les boucles d'animation (`AnimLoop`) sont conservées.
`
`### 3.3 Artistes du réseau (borné, sans lecture neuve)
`
`- Dérivés du `snapshot` déjà chargé par `getNetworkSnapshot()` (même appel que la carte) : groupement par artiste, tri par `lastPing` décroissant, **maximum 6**, plus un compteur global « N artistes · M appareils en ligne ».
`- Chaque ligne : nom d'artiste (lien `/artists/<id>`), nombre d'appareils en ligne, dernière activité lisible (« il y a 4 min »).
`- Fonction pure `networkArtists(snapshot, now, max = 6)` dans `lib/` (testée avec 0, 1, 7 et 5 000 appareils) : **la sortie est bornée à 6 — assertion structurelle** (longueur, un seul passage sur les appareils : pas de tri complet quand un tas borné suffit) ; le temps de calcul est seulement **affiché à titre informatif**, jamais assertionné (dépend de la machine). « Nouveaux artistes » : mêmes 6 au plus, triés par date d'inscription (donnée déjà lue par `RecentArtists` — vérifier au jalon 2 si elle est déjà dans le snapshot ; sinon `RecentArtists` fournit ce sous-état tel quel, sans nouvelle lecture).
`- **Ne pas** lister tous les artistes.
`
`### 3.4 Maquettes textuelles
`
````
`TÉLÉPHONE 390×844 (une colonne)                 TABLETTE 820×1180
`┌ logo            ☰ ┐                           ┌ logo  Accueil Galerie [Créer] … ☰? (hamburger <1024) ┐
`│ Hero (titre+lead) │                           │ Hero centré                                         │
`│ [Créer une œuvre] │  portes empilées 1 col.   │ [Créer] [Galerie] [Connecter]   (3 colonnes dès 720)│
`│ [Voir la galerie] │                           │ Réseau en direct                                    │
`│ [Connecter un app]│                           │  constellation 100 % largeur                         │
`│ Réseau en direct  │                           │  panneau de détail SOUS la carte (section)           │
`│  constellation    │                           │ Activité (journal unique)                            │
`│  détail = feuille │                           │ Artistes du réseau (6 max)                       │
`│ Activité (journal)│                           │ Œuvres récentes (grille 3 col.)                      │
`│ Artistes du réseau│                           │ Comprendre / Rejoindre                               │
`│ Œuvres récentes   │                           └──────────────────────────────────────────────────────┘
`│  (grille 2 col.)  │
`│ Comprendre/Rejoind│          ORDINATEUR 1440×900 : barre complète ; constellation + panneau latéral
`└───────────────────┘          (comme aujourd'hui, sans terminal) ; journal pleine largeur dessous ;
`                               Artistes du réseau et Œuvres récentes en deux colonnes ≥ 1200 px.
````
`
`Sur téléphone, le détail d'un nœud sélectionné s'ouvre en **bas de carte** (section de page, pas de saut de défilement : `scrollIntoView({ block: "nearest" })`) ; la sortie du mode « artiste isolé » reste visible (bouton existant).
`
`### 3.5 Fichiers
``app/page.tsx`, `app/network/NetworkMap.tsx` (prop `surface`), `app/network/page.tsx` (passe `surface="network"` explicitement), `app/BlockGallery.tsx` + `BlockGalleryClient.tsx` (libellés), nouveau `app/ActiveArtists.tsx`, nouveau `lib/activeArtists.ts`, `app/globals.css` (bloc `.home-*`), tests `homeComposition.test.ts`, `activeArtists.test.ts`.
`
`---
`
`## 4. Composants réellement à mutualiser
`
`Seuls les motifs **déjà répétés** sont extraits ; aucune bibliothèque abstraite.
`
`| Composant / primitive | Remplace | Où il est utilisé en premier | Forme |
`|---|---|---|---|
`| `.pod-page` (+ `--wide`, `--narrow`), `.pod-section`, `.pod-card` | `padding: …rem 0` locaux | `DrawChoice`, `CirclesClient`, pages de contenu | CSS, gouttières 12–16 / 20–24 / 24–32 px |
`| `.pod-btn` (+ `--primary`, `--ghost`, `--danger`, `--sm`) | `btn()` locaux et styles inline | Cercles, Profil/Appareils, `BlockDetail`, `SensorModal` | CSS ; hauteur 44 px (36 px pour `--sm` jamais en action principale) |
`| `.pod-pills` / `.pod-tabs` | pilules `pill()` de `MeasuresExplorer`, filtres galerie, onglets profil | Mesures, Galerie, Profil | CSS + `flex-wrap` par défaut ; état actif aussi marqué par le **contour/gras**, pas la couleur seule |
`| `Dialog` (hook `useDialog` + composant) | `SensorModal`, plein écran de l'explorateur, `BlockDetail`, modales de don/suppression d'appareil, sélecteur d'œuvre du profil | d'abord `SensorModal` | Téléphone : feuille plein écran (`100dvh`, en-tête sticky, bouton fermer ≥ 44 px). Tablette+ : fenêtre centrée. Échap, focus piégé, restitution du focus, verrou de défilement, `aria-modal` |
`| `ResponsiveTable` | `powerTable`, `synthTable` (+ matrice) | `MarkdownDoc` (matrice) puis `PowerPath` | ≥ 720 px : tableau actuel ; < 720 px : une **carte par ligne** (en-têtes répétés devant chaque valeur) ; si un tableau large reste nécessaire : première colonne sticky + indication « Glisser » |
`| `MeasuresPanel` (voir § 5) | `MeasuresExplorer` + `MeasuresChart` côté appelants | Mon espace, profil public, panneau réseau, panneau artiste | un composant, deux variantes `compact` / `expanded` |
`
`Explicitement **non** mutualisés : les studios de dessin et d'animation (isolés), les formulaires de Cercles (ils adoptent seulement `.pod-btn` / `.pod-page`).
`
`---
`
`## 5. Graphiques et périodes : un seul traitement
`
`### 5.1 Objectif
`Une lecture de l'historique par appareil et par ouverture ; une période pour toutes les grandeurs ; un composant partagé ; les vues artistiques (Œuvre, Interprétation) conservées pour température/humidité.
`
`### 5.2 Chargement unique
`Nouveau hook `useDeviceMeasures(deviceId, { owner })` (`app/measures/useDeviceMeasures.ts`) :
`
`- **un seul** `fetch` : propriétaire → `/api/sensor?deviceId=…&hours=744` (déjà le cas dans `SensorModal`) ; public → `/api/sensor?deviceId=…&public=1&hours=744` (le public est plafonné à 744 h côté serveur : `PUBLIC_MAX_HOURS`) ;
`- cache **en mémoire de session** : clé `${owner ? "own" : "pub"}:${deviceId}` — **une réponse privée n'est jamais servie à un appel public** (clés disjointes, test dédié) ; chaque entrée stocke la **Promise partagée** (deux composants qui ouvrent le même panneau simultanément déclenchent **une** requête) puis le résultat ; expiration mesurable de 2 min (durée du cache CDN) via un horodatage injectable dans les tests ; `reload()` **invalide la clé** puis relit ; un résultat reçu après démontage est ignoré (drapeau `alive`, pas d'`setState` orphelin) ; **aucun polling** ;
`- retourne `{ state: loading|error|unavailable|ready, measures, nowSec, reload }` ;
`- `MeasuresExplorer` gagne une prop optionnelle `measures` (si présente, aucune lecture ; sinon comportement actuel → **migration réversible appelant par appelant**).
`
`Le coût Redis ne peut que baisser : suppression de la seconde lecture de `SensorModal`, de `ArtistSensors` et du clic « Voir la connexion sur 48 h » de `SidePanel` (la période « Jour » couvre déjà 24 h ; 48 h devient « Semaine » filtrée côté client).
`
`### 5.3 Période unique
`Le panneau possède **un** état `range ∈ {day, week, month}` (libellés : *24 h*, *7 jours*, *31 jours*) transmis à toutes les sections. Correspondance exacte avec l'existant : `day` = 24 h, `week` = 7 j, `month` = 31 j (`VIZ_RANGES`). L'état `hours` de `SensorModal` disparaît ; le tableau brut se filtre sur la même période. Le texte de période (« du 22/10 au 29/10 ») passe sur sa propre ligne (correction R9) ; la rangée de pilules est en `flex-wrap`.
`
`### 5.4 Sections et vues
`
````
`[24 h | 7 jours | 31 jours]        du 22/10 au 29/10          [Agrandir]
`Température et humidité   → Graphique · Œuvre · Interprétation   (existant, inchangé)
`Qualité de l'air          → niveau actuel (couleur) · tendance · ⓘ · courbe interactive (aucun nombre)
`Connexion de la carte     → signal / latence / débit : courbe interactive (valeurs lues au toucher)
`Relevés bruts             → <details> fermé par défaut ; sur téléphone : cartes, pas de tableau
````
`
`- La section « Qualité de l'air » est présente seulement si `vocidx` est déclaré ; « Connexion » seulement si `rssi|lat|dl` ; « Température et humidité » seulement si `temp|hum`.
`- Public/privé : une ligne d'état en tête (« Mesures publiques » / « Mesures privées — visibles par vous seul ») alimentée par `measuresPublic` de l'appareil (déjà lu par `DevicesPanel` pour l'interrupteur « Mesures publiques » ; à passer en prop à `MeasuresPanel`, sans nouvelle requête).
`
`### 5.5 Cœur de tracé commun (APRÈS la lecture et la période uniques)
`**Ordre imposé par l'audit : d'abord § 5.2 et § 5.3 avec les deux moteurs de tracé actuels, ensuite seulement cette extraction.** L'extraction ne doit jamais retarder la suppression du double fetch. Extraire `ChartCore` (`app/measures/ChartCore.tsx`) : échelles, repères de temps (`lib/timeAxis.ts`), gestion des pointeurs (`pointerType === "mouse"` pour l'effacement), `NO_SELECT`, `touch-action: pan-y`, navigation clavier (flèches, Échap). `ChartView` (deux axes, température/humidité) et `Chart` (un axe) deviennent deux **configurations** de `ChartCore`. Les tests existants (`timeAxis.test.ts`, `vocLevels.test.ts`, `measureViz.test.ts`) continuent de passer sans modification de leurs assertions ; seul le test de câblage de `timeAxis.test.ts` (qui lit les sources) est mis à jour.
`
`### 5.6 Appelants à migrer (dans l'ordre)
`1. `profile/SensorPanel.tsx` (`SensorModal`) · 2. `artists/[artistId]/ArtistSensors.tsx` · 3. `network/SidePanel.tsx` (`DeviceMeasuresSection`) · 4. `network/ArtistPanel.tsx` · 5. `measures-lab/LabClient.tsx` (banc d'essai, fixtures).
`
`### 5.7 Fichiers
``app/measures/{MeasuresPanel,ChartCore,useDeviceMeasures}.tsx|ts` (nouveau dossier), `app/MeasuresChart.tsx` (devient un mince adaptateur puis disparaît), `app/MeasuresExplorer.tsx` (prop `measures`), les cinq appelants, `lib/measureViz.ts` (inchangé sauf export d'une aide `rangeHours`), tests `measuresPanel.test.ts`, `useDeviceMeasures.test.ts`.
`
`---
`
`## 6. Corrections responsive page par page
`
`| Lot | Page | Corrections | Fichiers |
`|---|---|---|---|
`| a | Toutes | Gouttière `.pod-page` ; hauteurs de barre stables ; `overflow-wrap:anywhere` sur noms/identifiants ; aucune largeur fixe > viewport | `globals.css`, pages |
`| b | `/draw` (`DrawChoice`) | Cadre `.pod-page--narrow` ; sous chaque écran **deux boutons** « Dessiner » (route actuelle) et « Animer » (`/animer?device=…&screen=…`). **« Animer » n'apparaît que si le serveur déclare `canAnimate` pour cet écran** : calculé par la **source canonique `animCapable`** (`lib/anim/pointer.ts` : écran dynamique + firmware déclaré ≥ seuil `ANIM_POINTER_FIRMWARE`, plus la capacité `anim-oled` du BWR) à partir du firmware, des écrans et des `caps` — **jamais** de nouvelle table de versions dans `DrawChoice`, et `lib/bench/screens.ts` seul est insuffisant. Les réponses de la liste privée et de la liste partagée gagnent le champ `canAnimate` par écran (calcul pur côté serveur, **aucune lecture Redis de plus** : la fiche appareil est déjà lue) ; `DrawTarget` est étendu. Écran incapable : phrase « Animation non disponible sur cet écran (firmware à mettre à jour ou écran fixe) ». **L'atelier `/animer` revalide** la capacité : l'interface n'est jamais une autorisation. Tests : écran compatible + firmware ancien, écran compatible + firmware récent, OLED auxiliaire du BWR (`oled096aux`), écran non compatible (e-ink). Phrase d'intro sur la validation par le réseau ; état vide → liens *Installer un appareil* (`/learn?path=install#installer`) et *Associer un appareil* (`/onboard`) | `DrawChoice.tsx`, `fetchList.ts`, `app/api/my-devices/route.ts` et la route des écrans partagés (champ `canAnimate`), `lib/anim/pointer.ts` (export réutilisé, non modifié), `app/animer` (garde) |
`| c | `/gallery` | Titre « Galerie », sous-titre « Œuvres validées par le réseau », onglets « Œuvres validées / rejetées », filtres Tout/Dessins/Animations/Créations IA ; barre supérieure empilée < 430 px ; filtres sur une rangée défilante **explicite** (ombre + flèche) ; une colonne < 420 px ; fiche d'œuvre = `Dialog` (feuille plein écran), hash et validateurs dans un `<details>` ; **remix / reprise conservés** | `GalleryClient.tsx`, `BlockDetail.tsx`, `AnimBlockPlayer.tsx` (inchangé) |
`| d | `/network` | `surface="network"` ; panneau de détail en section sous la carte < 900 px ; terminal replié par défaut sur téléphone | `NetworkMap.tsx`, `NetworkStage.tsx`, `SidePanel.tsx` |
`| e | `/profile` | « ESP liés » → « Appareils liés » ; « + Ajouter un ESP » → « + Associer un appareil » (`/onboard`) ; par appareil : **une** action primaire (Dessiner) + « Gérer » (les autres, dont les deux interrupteurs *Œuvres fixes*) ; champ de fuseau `minWidth` → `min(220px,100%)` ; menus contextuels bornés au viewport | `profile/page.tsx`, `DevicesPanel.tsx`, `PairDevice.tsx` |
`| f | `/artists/<id>` | « ESP liés » → « Appareils liés » ; grille d'œuvres 1 colonne < 420 px, 2 colonnes < 600 px ; capteurs via `MeasuresPanel` | `artists/[artistId]/page.tsx`, `ArtistSensors.tsx` |
`| g | `/circles` | `.pod-page` ; formulaire de message en `flex-wrap` ; actions en `.pod-btn` ; `overflow-wrap:anywhere` | `CirclesClient.tsx` |
`| h | `/learn` (+ matrice) | Lien « Onboard » → « page d'association » (`InstallGuide.tsx:471`) ; matrice et tableaux → `ResponsiveTable` ; navigation locale unique ; contenus experts repliables | `MarkdownDoc.tsx`, `PowerPath.tsx`, `SynthesisPath.tsx`, `CompatibilityMatrix.tsx`, `learn/*.module.css`, `InstallGuide.tsx` |
`| i | Studios (`/draw/[device]/[screen]`, `/animer`) | **Aucune modification** ; seulement une vérification des viewports (`dvh`, safe-area, clavier virtuel, barre d'outils à 320 px) | — |
`
`---
`
`## 7. Maquettes textuelles supplémentaires
`
`**Barre, ≥ 1024 px**
````
`[logo]  Accueil  Galerie  ┃Créer une œuvre┃  Réseau  Communauté ▾  Apprendre  Mon espace
````
`
`**Tiroir, 390×844** : voir § 2.4 (groupes, en-têtes de groupe en petites capitales, lignes de 48 px).
`
`**Panneau de mesures, 390×844**
````
`┌──────────────────────────────────┐
`│ Station TFT         Mesures privées│
`│ [24 h] [7 jours] [31 jours]        │
`│ du 22/10 au 29/10                  │
`│ 🌡 Température et humidité         │
`│   [Graphique][Œuvre][Interpré.]    │
`│   (courbe, 100 % largeur, 220 px)  │
`│   lecture au toucher : 29/10 14:35 │
`│   · 19,2 °C · 68,5 %               │
`│ 🌫 Qualité de l'air                │
`│   Actuellement : Modéré · ↘ en baisse ⓘ│
`│   (courbe, couleur du niveau)      │
`│ 📶 Connexion                       │
`│   ▸ Relevés bruts (cartes)         │
`└──────────────────────────────────┘
````
`Tablette portrait : mêmes sections, courbes 100 % d'une colonne de 720 px max. Ordinateur : courbes à gauche, lecture au toucher/survol à droite si la place le permet (sinon sous la courbe).
`
`**Matrice, 390×844** : filtres (famille, preuve `C/M/V2/OTA`) puis une carte par configuration : titre `eink29bwr · BWR 2,9″`, puis lignes *Statut · Carte · Écran · Capteurs · Vote · OTA · Preuve*.
`
`---
`
`## 8. Tests de viewport et critères d'acceptation
`
`### 8.1 Outil
`**Décision D4 (validée) :** `@playwright/test` en `devDependency`, script **`test:ui`** séparé (jamais dans `npm test`, jamais dans le build Vercel : aucun téléchargement de navigateur au déploiement — `vercel.json` / commande de build inchangés, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` posé hors CI de production), fixtures déterministes, Chromium d'abord, captures et traces dans un dossier ignoré par git (sauf références choisies). Avant l'arrivée de la dépendance (jalon 5), les captures des jalons 1 à 4 se font avec le navigateur intégré (resize aux tailles ci-dessous).
`
`### 8.2 Viewports
`Téléphones : 320×568, 360×800, 390×844, 430×932. Tablettes : 600×960, 768×1024, 820×1180, 1024×768, 1180×820, 1366×1024. Ordinateurs : 1280×720, 1440×900, 1920×1080, plus zoom navigateur 200 %.
`
`### 8.3 Pages et fixtures
``/`, `/gallery`, `/draw`, `/network`, `/profile` (0, 1, 5 et 30 appareils ; noms de 80 caractères ; station avec temp+hum+vocidx+liaison), `/artists/<profil avec capteurs>`, `/learn?path=compat`, `/circles`, `/measures-lab`, studios (contrôle seul). Fixtures de mesures : `app/measures-lab` (31 jours synthétiques) étendu avec `vocidx`, `rssi`, `lat`, `dl`.
`
`### 8.4 Assertions
`Par page et par viewport : `document.scrollWidth <= innerWidth` ; aucun bouton ou lien principal < 44 px ; barre sticky sur une seule ligne et sans recouvrement ; modale fermable (Échap + bouton) et focus rendu ; focus visible ; contraste des états actifs ; `aria-current` unique dans la navigation ; pas de nombre d'indice COV visible ; les liens historiques répondent (pas de 404).
`
`### 8.5 Tests structurels (sans navigateur, dans `npm test`)
``navLinks`/`navActive` (une entrée active par URL historique, toutes les destinations présentes), `homeComposition` (une seule section d'activité, aucune `LiveDisplaysSection` en `surface="home"`), `activeArtists` (borne 6), `measuresPanel` (une période partagée, une seule lecture : le hook est appelé une fois), `useDeviceMeasures` (cache), vocabulaire (absence de « Block Explorer », « Blocs récents », « ESP liés », « Onboard » dans les textes visibles), `hardwareMatrix` inchangé.
`
`### 8.6 Critères globaux (repris des audits)
`Une personne nouvelle identifie en moins de dix secondes comment créer, voir des œuvres, comprendre le réseau, gérer son appareil. Accueil visible comme bouton. Menu principal sur une ligne avant bascule. Tiroir groupé, cibles ≥ 44 px. `/draw` propose Dessiner/Animer selon les capacités. L'accueil ne répète ni la carte des affichages ni le journal. Toutes les anciennes URL fonctionnent.
`
`---
`
`## 9. Risques
`
`| Risque | Gravité | Parade |
`|---|---|---|
`| **Redis / quotas** : aucune nouvelle lecture n'est ajoutée ; seulement des suppressions (2e lecture capteur, clic 48 h). Risque inverse : cache de session trop long → données périmées | faible | Cache = durée CDN (2 min) ; aucun polling ; `reload` explicite |
`| **Échelle (10 000 appareils)** : `getNetworkSnapshot` charge tout | moyen, **hors périmètre** | Ce chantier ne l'aggrave pas (activité bornée à 6). Ouvrir un lot séparé « snapshot public borné / agrégé » avec décision préalable du porteur et mesure Redis |
`| Régression de `/network` (variante `surface`) | moyen | Défaut `"network"` ; test SSR des deux variantes ; changement dans un commit isolé |
`| Régression des graphiques (refonte `ChartCore`) | moyen | Migration appelant par appelant ; `MeasuresExplorer` garde son mode autonome jusqu'au dernier appelant ; tests existants conservés |
`| Régression d'accessibilité (focus trap mal fait) | moyen | Un seul `useDialog`, testé ; première utilisation sur une modale à faible enjeu (`SensorModal`) |
`| Faux positif visuel : les audits n'ont pas pu capturer le site déployé | moyen | Chaque constat visuel est rejoué aux viewports du § 8.2 **avant** correction ; sinon il est classé « non reproduit » |
`| Vocabulaire : changement de libellés publics | faible | Table de correspondance unique dans le plan et les tests ; ancres et URL inchangées |
`| Les textes de la matrice changent encore (firmwares) | faible | La carte mobile lit le même fichier Markdown ; aucun contenu recopié |
`
`Rien dans ce plan ne touche au consensus, aux firmwares, à l'OTA ni au schéma Redis.
`
`---
`
`## 10. Jalons et ordre des commits (petits, vérifiables, réversibles)
`
`Cinq jalons auditables. **Après chaque jalon : type-check, tests ciblés, suite complète comparée au socle, captures téléphone / tablette / desktop, audit Codex — aucun push ni déploiement avant cet audit.**
`
`| Jalon | Contenu | Commits ci-dessous |
`|---|---|---|
`| **1 — Navigation et vocabulaire** (**seul autorisé à ce stade**) | primitives CSS, données de navigation, barre desktop, tiroir groupé, libellés | 1 à 5 |
`| 2 — Accueil | `surface`, composition, section « Artistes du réseau » fusionnée | 6 à 8 |
`| 3 — Créer et responsive principal | Dessiner / Animer (`canAnimate`), gouttières et grilles, matrice en cartes | 9, 14, 15 |
`| 4 — Mesures | lecture + période uniques d'abord (10, 11a), migration des appelants (12), tracé commun ensuite (11b) | 10 à 12 |
`| 5 — Modales, accessibilité, Playwright | `Dialog`, `test:ui`, retour documentaire | 13, 16, 17 |
`
`Chaque commit passe `npx tsc --noEmit`, `eslint` sur les fichiers touchés et `npm test` (échecs déjà présents sur `main` explicitement listés avant le premier commit pour ne pas les confondre avec une régression).
`
`| # | Commit | Contenu | Annulable par |
`|---|---|---|---|
`| 0 | `docs: plan UX validé` | ce plan + décisions du § 11 | revert |
`| 1 | `style: primitives .pod-page / .pod-btn / .pod-pills` | CSS seulement, aucune page migrée | revert |
`| 2 | `nav: données groupées + états actifs + tests` | `lib/navLinks.ts`, tests ; barre inchangée visuellement | revert |
`| 3 | `nav: barre bureau 1024 px, menu Communauté, aria-current` | `NavMenu.tsx`, CSS | revert |
`| 4 | `nav: tiroir groupé, focus piégé` | `NavMenu.tsx`, CSS | revert |
`| 5 | `vocab: Galerie / Œuvres / Appareils / association` | libellés seulement (galerie, accueil, profil, artistes, doc) | revert |
`| 6 | `home: prop surface sur NetworkMap` | `network` par défaut, `home` ajoutée sans être utilisée | revert |
`| 7 | `home: composition (portes, journal unique, œuvres récentes)` | `page.tsx`, CSS ; `surface="home"` activée | revert |
`| 8 | `home: section « Artistes du réseau » (fusion actifs + nouveaux)` | `lib/networkArtists.ts`, composant, retrait de `RecentArtists` de la page (le composant reste pour le sous-état), tests | revert |
`| 9 | `draw: Dessiner / Animer sur /draw (canAnimate côté serveur)` | `DrawChoice.tsx`, `fetchList.ts`, routes de liste, tests de capacité | revert |
`| 10 | `measures: hook de lecture unique (Promise partagée, clés pub/own) + prop measures` | `useDeviceMeasures`, `MeasuresExplorer` accepte `measures` | revert |
`| 11a | `measures: période unique (MeasuresPanel, deux moteurs de tracé conservés)` | `MeasuresPanel`, migration `SensorModal` | revert |
`| 11b | `measures: ChartCore` (après 12) | extraction du cœur de tracé | revert |
`| 12 | `measures: migration profil public, panneau réseau, artiste` | trois appelants | revert (un commit par appelant) |
`| 13 | `ui: Dialog partagé (SensorModal puis BlockDetail)` | `useDialog` | revert |
`| 14 | `ui: ResponsiveTable + matrice en cartes` | tableaux Apprendre | revert |
`| 15 | `pages: gouttières et grilles (Cercles, Artistes, Galerie, Profil)` | CSS / petits ajustements | revert |
`| 16 | `qa: viewports automatisés` (si Playwright validé) | `tests/ui/*`, script | revert |
`| 17 | `docs: retour d'exécution` | écarts, captures, état | — |
`
`Les commits 1 à 5 sont indépendants des commits 6 à 12 : on peut livrer la navigation et le vocabulaire (valeur immédiate demandée par le porteur) sans attendre les graphiques.
`
`---
`
`## 11. Décisions (toutes tranchées par Codex et le porteur le 29/10/2026)
`
`1. Barre : *Accueil · Galerie · Créer une œuvre · Réseau · Communauté · Apprendre · Mon espace*. ✔
`2. Hamburger à 1024 px ; critère réel : **aucun retour à la ligne** de la barre. ✔
`3. Accueil : `EspActivityFeed` ; terminal réservé à `/network`. ✔
`4. Playwright en `devDependency`, `test:ui` séparé. ✔
`5. Snapshot réseau borné : lot séparé, à inscrire à la roadmap proche avant toute promesse de 10 000 appareils. ✔
`6. « Associer un appareil » (action) ; « page d'association » seulement dans les explications. ✔
`
`Restent à trancher plus tard (jalon concerné) : forme exacte du sous-état « Nouveaux artistes » (jalon 2) et seuil visuel des cartes de la matrice (jalon 3).
`
`---
`
`## 12. Ce qui n'est PAS dans ce plan
`
`Consensus, vote, firmwares, OTA, schéma Redis (les routes de liste d'écrans reçoivent seulement le champ calculé `canAnimate`), studios de dessin et d'animation, identité visuelle (couleurs, typographies, logo), snapshot réseau borné (§ 9), génération de captures du site déployé (indisponible aux audits comme ici).
