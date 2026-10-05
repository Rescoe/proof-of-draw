# Brief ChatGPT (v2, 05/10/2026) — refonte de l'accueil (vitrine) ET développement de la page Réseau complète

Deux chantiers **menés en parallèle et liés** par un socle commun :
- **Chantier A — `/network`** : la page technique **exhaustive** (diagramme complet, explorable, tactile, panneau d'informations complet).
- **Chantier B — `/`** : la **vitrine** simple et attrayante, avec une version légère du diagramme et une infobulle.

Rédigé après relecture du travail non commité de ChatGPT (`ExperimentalNetworkStage.tsx`, `NetworkMap.tsx`, `GlobalTerminal.tsx`, `activity-log/route.ts`) et des mesures faites sur le site local. **À coller tel quel dans ChatGPT**, avec l'accès au dépôt. Ne rien commiter sans accord (voir §10).

---

## 0. Décisions du porteur (05/10/2026) — elles priment sur tout le reste
1. **Flux visuellement persistant** : un échange réel doit rester visible **quelques minutes** (impulsions qui se répètent le long du trajet réel, puis s'estompent), pour qu'un visiteur ait le temps de « voir passer la trame ». Jamais de mouvement inventé.
2. **Vignettes = l'image actuellement affichée sur l'écran** (confirmée par l'ACK du firmware), rien d'autre. Cela permet de **supprimer les grandes listes d'images sous le diagramme sur l'accueil** ; le détail (listes, « en direct ») **reste sur la page Réseau**.
3. **Aucun artiste n'est masqué**, quel que soit leur nombre : tout est visible dans le diagramme ; on **dézoome** et on **regroupe** (clusters, « lots de lots ») quand le réseau grossit. Le diagramme est **plus large et plus haut que l'écran**, **pan/zoom de bonne qualité**, **maniable au téléphone**.
4. **Accueil** : un clic sur un appareil ouvre une **infobulle placée sous le diagramme** (comme l'actuelle fiche sous la carte sur mobile — « c'était très bien »). **Page Réseau** : **toutes** les informations utiles.
5. L'accueil garde la **même logique d'information que les anciennes versions** (core relié aux artistes, chaque artiste a son réseau d'appareils), en **minimaliste**, avec **les appareils toujours visibles** (jamais « seulement le core »).

## 1. Constats mesurés sur l'état actuel (à ne pas contester sans vérifier)
1. **La vue LAB n'est pas une topologie** : 0 `<svg>`, 0 lien, 0 image dans `.lab-stage-wrap` ; le core est un orbe isolé ; les appareils sont des cartes texte ≈ 310 px plus bas. La vue **classique** (`NetworkStage`) dessine bien core + 7 ESP + 8 écrans reliés. Le mode LAB est mémorisé (`localStorage` `pod-network-view`) et masque la topologie.
2. **Accueil = 1,07 Mo de HTML dont 87 % de base64 d'images** : le `snapshot` en props embarque `recentFrame.preview` de chaque appareil (31 buffers, jusqu'à 204 800 caractères) alors qu'aucune vignette n'est affichée.
3. **Cache du snapshot 1 h, jamais invalidé** (`getNetworkSnapshot`, tag `network-snapshot`) : « en ligne » et nouveaux appareils en retard jusqu'à 1 h.
4. **`/network` = le même `NetworkMap` que l'accueil** (pas de page dédiée) ; tout est monté partout, deux boucles de requêtes par visiteur sur la vitrine.
5. **Texte d'accueil périmé** (« ESP8266, e-ink et OLED ») et sans appel à l'action.
6. **Fragilités** : matériel deviné par regex sur la chaîne de firmware ; regroupement par **nom** d'artiste (homonymes fusionnés) ; `deviceId` complet ajouté aux événements de vote d'un endpoint public.
7. **À conserver du travail LAB** : flux réellement observés, filtres/recherche/tri, isolation d'un artiste, `prefers-reduced-motion`, flux d'événements unique partagé.
8. Côté Claude : `npx tsc --noEmit` propre, `npm test` 258/258 sur l'arbre actuel (le blocage `uv_os_get_passwd ENOMEM` de ChatGPT est local à son environnement).

## 2. Prérequis serveur — **réservés à Claude, à livrer AVANT que ChatGPT commence** (il ne touche pas à `lib/`)
| # | Livrable Claude | Pourquoi |
|---|---|---|
| P1 | `lib/networkSnapshot.ts` : **retirer `recentFrame.preview`** du snapshot (type `NetworkSnapshot` allégé) ; ajouter à `NetworkDevice` : `artistKey` stable (identifiant d'artiste public ; **pas** le nom), `hardware` (`"esp8266" \| "uno-r4" \| "unknown"`, déduit d'une table de préfixes de firmware), `capabilities` (`animation`, `scene`) déduites de la version de firmware (`lib/anim/pointer.ts`), `pools` | supprime les 931 Ko, fiabilise regroupement et matériel |
| P2 | **Invalidation du cache** du snapshot : `revalidateTag("network-snapshot")` à l'enregistrement d'un appareil et au minage d'un bloc ; TTL de repli 300 s (au lieu de 3 600) | « live » honnête |
| P3 | **Jeu de données synthétique déterministe** `lib/network/fixtures.ts` + paramètre **dev uniquement** `?fixture=n` (1, 5, 20, 100, 500 appareils ; 1, 3, 20, 80 artistes ; avec/sans images affichées ; certains hors ligne) | tester l'échelle **sans lire Redis** (quota) |
| P4 | `/api/network/activity-log` : ne plus renvoyer le `deviceId` complet des votes (identifiant court ou haché) | ne pas exposer les identifiants des firmwares |
| P5 | `/api/network/displays` : s'assurer qu'il renvoie, par appareil et écran, `frameId`, `shownAt`, `hasImage`, `mode` (frame / scène / animation), `workTitle`, `artistName`, n° de bloc (champs **publics**) | alimente vignettes et panneau |

ChatGPT développe **contre ces types** ; en attendant P1-P3, il peut stubber les champs dans le module de modèle.

## 3. Architecture : un socle commun, deux pages
```
app/network/model/            ← PUR (aucun React) — partagé par A et B
  groups.ts      regroupement artiste → appareils → écrans ; clés stables ; hiérarchie de clusters
  layout.ts      positions déterministes (circle-packing / radial), stables d'un rafraîchissement à l'autre
  flows.ts       événements réels → trajets (core → artiste → appareil → écran) + fenêtre de persistance
  constants.ts   SCREEN_COLOR, icônes, plafonds, durées (une seule source)
  format.ts      temps relatifs, formats
app/network/graph/            ← composants de diagramme (client)
  Graph.tsx      SVG pan/zoom/pinch, niveaux de détail, culling, sélection
  nodes/*        Core, Cluster, Artist, Device, Screen (vignette)
  useViewport.ts gestes (réutiliser la logique de NetworkStage : pinch, pointeurs)
app/network/page.tsx          ← Chantier A
app/_home/*                   ← Chantier B (hero, HomeConstellation, DeviceTooltip)
tests/networkModel.test.ts    ← groups / layout / flows / constants
```
**Règle** : l'accueil et `/network` partagent `model/` et les noeuds ; **seules** les fonctionnalités (panneaux, filtres, journal, listes) diffèrent. `Graph.tsx` accepte une prop `variant="home" | "full"` (densité, interactions, niveau de détail).

## 4. Le diagramme (commun) — spécification
### 4.1 Hiérarchie
`core` → **(optionnel) clusters** → **artistes** → **appareils** → **écrans**.
- Les clusters n'apparaissent que si le nombre d'artistes dépasse un seuil (≈ 12) ; ils servent aussi de **crochet futur pour les réseaux privés** (« salles ») : un niveau « réseau » doit pouvoir s'insérer sans réécrire le moteur.
- Critère de regroupement (à proposer et justifier) : par défaut **par activité** (actifs < 24 h / récents / dormants) puis **par taille de parc** ; alternatives : par famille d'écran dominante, par ordre alphabétique. « Lots de lots » : un cluster peut contenir des sous-clusters au-delà de ≈ 12 enfants.
- Layout **déterministe et stable** (pas de simulation de forces qui « bouge » à chaque données) : *circle packing* ou *radial tree* ; ordre = clé stable. Les positions ne sautent pas quand un événement arrive.

### 4.2 Zoom sémantique (niveaux de détail)
| Zoom | Affiché |
|---|---|
| très faible | core + clusters (taille ∝ nombre d'appareils, couleur = activité) |
| faible | + artistes (monogramme), liens |
| moyen | + appareils (icône par type d'écran, point d'état) |
| fort | + écrans, **vignettes** de l'œuvre affichée, étiquettes |
Les étiquettes et vignettes apparaissent **par seuil de zoom** et **culling** (seuls les noeuds visibles sont rendus). Un bouton « tout voir » (fit) et un indicateur de niveau.

### 4.3 Interaction tactile (obligatoire)
- `touch-action: none` sur le diagramme ; **Pointer Events** ; 1 doigt = déplacer, 2 doigts = pincer/zoomer, double-tap = zoom sur le noeud ; boutons **+ / − / ajuster** (≥ 44 px) ; molette et glisser à la souris ; clavier (flèches, +/−, Entrée).
- Cibles tactiles ≥ 44 px **à l'écran** (la zone cliquable s'agrandit quand le zoom est faible) ; aucun conflit avec le défilement de la page (le diagramme peut être **verrouillé / déverrouillé** sur mobile, ou occuper la hauteur d'écran).
- Inertie légère facultative ; aucune dérive d'un seul doigt qui empêche de faire défiler la page.
- **Budget de performance** : 500 appareils fluides sur un téléphone moyen — un seul `<g transform>` animé, pas d'état React par noeud, pas de re-rendu au pan/zoom, vignettes décodées à la demande.

### 4.3 Flux visuellement persistants (décision 0.1)
- Source : **uniquement** des événements réels — `displays` (ACK : « frame affichée » / « scène jouée » / « animation »), `activity-log` (votes, validations en attente, blocs).
- Trajet réel : *livraison* core → artiste → appareil → écran ; *vote* appareil → core ; *validation en attente* artiste → core ; *bloc miné* halo sur le core puis vers les pools concernés.
- **Persistance** : un événement déclenche des **impulsions répétées** (période ≈ 4 s) pendant une fenêtre configurable (**défaut 5 min**, `constants.ts`), puis un estompage de 30 s. Plusieurs événements se superposent sans saturer (plafond d'impulsions simultanées, priorité aux plus récents).
- Traînée lumineuse + **horodatage** « il y a 2 min » au survol. `prefers-reduced-motion` : pas de mouvement, **surbrillance statique** du trajet pendant la fenêtre.
- Un appareil avec événement récent a un **anneau d'activité** ; un artiste, un halo.

### 4.4 Noeuds
- **Core** : logo, état LIVE/SYNC (flux), clic = infos serveur.
- **Artiste** : monogramme/avatar, nombre d'appareils en ligne, halo d'activité ; clic = isoler / ouvrir la fiche (`/artists/[id]`).
- **Appareil** : icône par famille (ESP8266 / UNO R4), point d'état, **vignette de l'œuvre actuellement affichée** (de l'écran principal, ou l'écran le plus récemment confirmé).
- **Écran** : pastille de la couleur du type d'écran ; vignette propre à l'écran à fort zoom.
- Sans image confirmée (ou frame personnelle, non publique) : **icône seule**, jamais de vignette inventée.

## 5. Chantier B — Accueil `/` (vitrine)
```
┌──────────────────────────────────────────────────────────────┐
│ HERO : titre court · 3 étapes · [Dessiner] [Voir le réseau]  │
│        chiffres : N artistes · N écrans en ligne · N blocs   │
├──────────────────────────────────────────────────────────────┤
│ CONSTELLATION (variant="home") : core ─ artistes ─ appareils │
│   (tous visibles, dézoom + clusters si nombreux, vignettes)  │
├──────────────────────────────────────────────────────────────┤
│ INFOBULLE sous le diagramme (clic sur un appareil)           │
├──────────────────────────────────────────────────────────────┤
│ bandeau « Installer un écran » · lien « Explorer la galerie »│
└──────────────────────────────────────────────────────────────┘
```
- **Hero** (répond à « c'est quoi / pourquoi / comment participer ») : titre concret et court, **sans « blockchain », « preuve » ni « consensus »** (la validation n'est pas encore réelle) — ex. *« Des dessins qui s'affichent sur de vrais écrans, partout, en direct. »* ; 3 étapes : **Dessine** → **Le réseau valide** → **Ça s'affiche** ; boutons **Dessiner maintenant** (`/draw`), **Voir le réseau en direct** (`/network`) ; lien discret **Installer un écran** (`/learn`).
- **Constellation** : `Graph variant="home"` — **tous les appareils visibles**, flux persistants (§4.3), vignettes de l'œuvre affichée, **zoom/pan tactiles**, hauteur ≈ 60-70 % de l'écran ; **pas** de panneau latéral, journal, filtre ni tri. Le diagramme **dézoome et regroupe** (§4) plutôt que de masquer.
- **Infobulle sous le diagramme** (clic ou tap sur un appareil), à l'image de l'actuelle fiche sous la carte :
  vignette de l'œuvre affichée · titre · artiste · type d'écran · état en ligne + « vu il y a X » · famille matériel + version de firmware · un lien **« Voir tous les détails »** → `/network?device=<id>`. Fermable ; une seule ouverte.
- **Supprimer de l'accueil** les grandes listes d'images (`BlockGallery`) : remplacées par le diagramme ; garder un lien **Explorer la galerie**. `RecentArtists` : version compacte ou retirée — voir §11 question 1.
- **Poids** : HTML de `/` < 150 Ko non compressé ; **aucun base64 > 3 000 caractères** ; diagramme et infobulle chargés en **lazy** (`next/dynamic`) ; **au plus une requête client** (`/api/network/displays`) ; **aucun flux d'événements** sur la vitrine si le coût Redis n'est pas démontré nul (voir §8 : les flux persistants de l'accueil peuvent venir de `displays` seul).

## 6. Chantier A — Page `/network` (technique, exhaustive)
```
┌─ barre : vues [Diagramme | Liste | Journal] · filtres · recherche ─┐
│ ┌──────────────── DIAGRAMME (variant="full") ────────┐ ┌ PANNEAU ┐ │
│ │ pan/zoom/pinch · clusters · artistes · appareils   │ │ détail  │ │
│ │ flux persistants · vignettes · minimap (option)    │ │ complet │ │
│ └────────────────────────────────────────────────────┘ └─────────┘ │
│ « En direct » : images affichées par écran (liste existante)         │
│ Journal réseau · Liste détaillée (tableau triable)                   │
└─────────────────────────────────────────────────────────────────────┘
```
### 6.1 Contenu
- **Diagramme complet** (§4) en `variant="full"`, **plein écran** possible (bouton), minimap facultative pour les grands réseaux.
- **Panneau d'informations complet** (reprend et **étend** l'actuel `SidePanel`) — toutes les données **publiques** disponibles :
  - **Identité** : nom/artiste (lien fiche), identifiant court + **copie de l'identifiant complet**, famille matériel (ESP8266 / UNO R4 WiFi), **version de firmware** et **capacités** déduites (animation ✓/✗, scène ✓/✗, avec la version requise si ✗), date d'enregistrement.
  - **État** : en ligne / hors ligne, **vu il y a** + horodatage absolu, dernier ping, **rythme de pull** annoncé (si connu).
  - **Écrans** (un bloc par écran) : type, résolution, couleurs, format ; **œuvre actuellement affichée** (vignette agrandissable, titre, artiste, n° de bloc, heure d'affichage, **mode frame / scène / animation**, lien vers le bloc) ; écrans sans confirmation signalés.
  - **Activité on-chain** (`/api/network/device-activity`) : blocs où l'appareil est auteur ou validateur (20 derniers, avec vignettes), votes récents, score moyen, blocs possédés (compteurs) ; dernier bloc validé avec ses métadonnées (score, validateurs, durée d'affichage, hash court + copie).
  - **Flux récents** de cet appareil (les événements réels qui le concernent, avec heures).
  - **Jamais** : MAC, code d'appairage, clé privée, cookies, quoi que ce soit de propre au propriétaire (réservé à « Mon profil »).
- **Artiste** (clic sur un noeud artiste) : fiche condensée — nombre d'appareils / écrans, matériel, activité, œuvres actuellement affichées (vignettes), lien `/artists/[id]`.
- **Core** : infos serveur existantes (`ServerInfoPanel`) + compteurs réseau (appareils, écrans, blocs, validations en attente).
- **Cluster** : liste de ses artistes, activité cumulée, bouton « zoomer ici ».
- **Liste détaillée** : tableau **triable et filtrable** (artiste, appareil, famille, firmware, écrans, état, dernière activité) — c'est ici que vit l'actuelle liste de cartes du LAB.
- **Filtres** : famille de matériel, type d'écran, en ligne / hors ligne, **capacité animation**, recherche libre ; **isolement** d'un artiste / cluster ; **réinitialiser**.
- **Journal** : flux d'événements (existant), **étiqueté « dérivé des blocs »** là où il est synthétisé ; filtrable par type.
- **Section « en direct »** : conservée (images confirmées par écran).
- **Deep links** : `?view=diagram|list|log`, `?device=<id>`, `?artist=<clé>`, `?cluster=<clé>`, `?screen=<type>` (+ zoom/centre dans l'URL de façon facultative).

### 6.2 Cohérence d'état
Sélection unique partagée (diagramme ↔ panneau ↔ liste ↔ URL). Fermer le panneau retire `?device=`. Le défaut pour un nouveau visiteur est **le diagramme** (jamais la liste seule, jamais le choix mémorisé qui masque la topologie).

## 7. Données, chargement et quota Redis (règle primordiale du dépôt)
| Page | Données au chargement | Requêtes client | Notes |
|---|---|---|---|
| `/` | snapshot **allégé** (serveur, cache) | **1** : `/api/network/displays` (60 s, onglet visible) ; vignettes via `/api/network/display-image` (immuable, cache 1 an, **seulement les visibles**) | pas de journal ni de panneau ; flux persistants dérivés de `displays` (`shownAt`) |
| `/network` | snapshot allégé | `displays` (60 s) + flux d'événements `activity-log` (30 s, **une seule boucle** partagée) ; `device-activity` **à la demande** (cache CDN 60 s) à l'ouverture d'un appareil | `useNetworkEventStream` et `useLiveDisplays` existants ; `lib/usePolling.ts` (pause onglet caché, arrêt après inactivité) |
- **Aucune** nouvelle boucle de requêtes, **aucun** `setInterval` nu, aucun nouvel endpoint sans coût écrit en commandes Redis par appel.
- Les vignettes ne chargent qu'à partir d'un seuil de zoom et dans la fenêtre visible ; cache mémoire par `frameId:screen` (déjà dans `LiveDisplays.tsx`, à factoriser).

## 8. Honnêteté et vocabulaire
- Pas de mouvement ni de ligne inventés. Le fil `esp-<écran> ▸ …` (`EspActivityFeed.tsx`) est **synthétisé** à partir des blocs : l'étiqueter « dérivé des blocs » ou le garder sur `/network` seulement.
- Vocabulaire neutre : « validé par le réseau » plutôt que « preuve », « consensus », « blockchain ».
- Les flux de l'accueil ne montrent que ce qui est confirmé (ACK) ; l'absence d'événement récent s'affiche comme une absence (« calme »), pas comme une animation de remplissage.

## 9. Critères d'acceptation vérifiables
| # | Critère | Mesure |
|---|---|---|
| 1 | Accueil < 150 Ko de HTML, 0 base64 > 3 000 car. | `curl -s / \| wc -c` ; recherche du motif |
| 2 | **Tous** les appareils visibles dans le diagramme (aucun masqué) pour 1, 5, 20, 100, 500 appareils (fixtures) | captures + comptage des noeuds |
| 3 | Pan/zoom/pinch fluides au téléphone (émulation tactile 375 px) ; cibles ≥ 44 px ; pas de scroll horizontal | captures + test manuel guidé |
| 4 | 500 appareils : ≥ 30 images/s en pan sur CPU bridé ×4 (DevTools) | trace de performance |
| 5 | Flux persistants : un événement réel produit des impulsions pendant la fenêtre (défaut 5 min) puis s'estompe ; **aucun** mouvement sans événement ; `prefers-reduced-motion` respecté | test unitaire de `flows.ts` + captures |
| 6 | Infobulle de l'accueil sous le diagramme ; panneau complet sur `/network` (toutes les sections du §6.1) | captures |
| 7 | Vignettes = image **actuellement affichée** uniquement ; sans image → icône | test unitaire + captures |
| 8 | Deep links `?device=`, `?artist=`, `?view=` fonctionnent à froid | test manuel |
| 9 | Aucune nouvelle requête en boucle ; requêtes client de l'accueil ≤ 1 | onglet Réseau des DevTools |
| 10 | `npx tsc --noEmit`, `npm test` (y compris `tests/networkModel.test.ts`), `npm run build`, `git diff --check` verts | sorties jointes |
| 11 | États : vide, 1 artiste, homonymes, appareil sans écran, hors ligne, matériel inconnu, nom très long | captures |

## 10. Règles de travail
- **Ne pas toucher** : `esp8266/**`, `arduino_uno_r4/**`, `lib/**` (les prérequis P1-P5 sont à Claude), routes `/api/pull*`, `/api/ack-frame`, `/api/validation-result`, `docs/PLAN_REDIS_200K.md`. Le fichier `esp8266/esp_tft1.8/esp_tft1.8.ino` contient des **identifiants Wi-Fi locaux** : jamais dans un commit.
- Fichiers autorisés : `app/page.tsx`, `app/network/**`, `app/_home/**`, `app/globals.css` (sections réseau/accueil), `tests/networkModel.test.ts`, et au besoin `app/api/network/*` (mêmes règles de coût).
- Partir de l'**arbre de travail actuel** (ne pas repartir de zéro) : `ExperimentalNetworkStage` est **remplacé** par `Graph` (le LAB devient la vue Diagramme) ; `NetworkStage` (classique) peut servir de **référence** pour les gestes (pinch/pan) puis être retiré une fois la parité atteinte.
- **Dépendances** : préférer **aucune**. Si `d3-hierarchy` / `d3-zoom` apportent un gain net (circle packing, gestes), proposer **avant** d'ajouter, avec le poids gzip et un chargement lazy.
- **Jalons et commits séparés** (proposer, ne pas commiter sans accord) :
  1. `model/` + `tests/networkModel.test.ts` (groups, layout, flows, constants) ;
  2. `Graph` + noeuds + gestes + niveaux de détail (page de démonstration `?fixture=`, dev) ;
  3. `/network` (panneau complet, liste, filtres, journal, deep links) ;
  4. accueil (hero, `HomeConstellation`, infobulle, retrait de `BlockGallery`).
  À chaque jalon : build, captures desktop 1280 + mobile 375, états du §9.11, et la liste de ce qui n'a pas pu être vérifié.
- Les tests doivent être **écrits même si leur exécution est bloquée localement** ; Claude les relance.

## 11. Questions ouvertes (à poser au porteur avant de coder)
1. `RecentArtists` sur l'accueil : version compacte (une ligne d'avatars) ou retrait complet ?
2. Critère de regroupement des clusters : **activité** (proposé) ou famille d'écran dominante ?
3. Fenêtre de persistance des flux : **5 min** (proposé) ou autre ?
4. Minimap sur `/network` : utile ou superflu ?

## 12. Ce que Claude fait en parallèle (pour ne pas bloquer ChatGPT)
P1 à P5 (§2) en priorité ; puis relecture de chaque jalon (taille de la charge utile, coût Redis, cohérence avec `lib/`), tests relancés, et rétroaction.
