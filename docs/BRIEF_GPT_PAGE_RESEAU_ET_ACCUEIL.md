# Brief pour ChatGPT — séparer « page Réseau » (technique) et « accueil » (vitrine)

Rédigé le 05/10/2026 après relecture du travail non commité de ChatGPT (`ExperimentalNetworkStage.tsx`, `NetworkMap.tsx`, `GlobalTerminal.tsx`, `activity-log/route.ts`) et mesures sur le site local.
**À coller tel quel dans ChatGPT**, avec l'accès au dépôt. Ne rien commiter sans accord ; voir « Règles de travail ».

---

## 1. Objectif en une phrase
Faire de `/` une **vitrine** qui, en 30 secondes, fait comprendre ce qu'est l'application et donne envie d'y participer, avec une **visualisation réseau minimaliste mais juste** ; et de `/network` la **page technique complète** (tout ce qui existe aujourd'hui + la vue LAB).

## 2. Constats mesurés (ne pas les contester sans les vérifier)
1. **La vue LAB n'est pas une topologie.** Mesuré dans le navigateur : 0 `<svg>`, 0 lien (`line`/`path`), 0 image dans `.lab-stage-wrap`. Le « core » est un orbe isolé ; les appareils sont des cartes texte dans une liste, ≈ 310 px sous le haut de l'observatoire (sur un écran de 900 px de haut). Un visiteur voit donc « seulement le core ». La vue **classique** (`NetworkStage`) dessine bien le core + 7 ESP + 8 écrans reliés (vérifié : positions dans le `viewBox`). **Régression de perception** : le mode LAB est mémorisé dans `localStorage` (`pod-network-view`) et masque la topologie.
2. **Poids de la page d'accueil : 1,07 Mo de HTML, dont 87 % (≈ 931 Ko) de base64 d'images** (31 buffers, jusqu'à 204 800 caractères) : le `snapshot` passé en props au composant client embarque `recentFrame.preview` (buffers noir/rouge/RGB565) de chaque appareil — alors que l'accueil n'affiche **aucune** vignette. Inacceptable pour une vitrine (mobile). À supprimer du snapshot côté client.
3. **Le snapshot est mis en cache 1 h** (`getNetworkSnapshot`, `unstable_cache`, tag `network-snapshot`) et **ce tag n'est jamais invalidé** : points « en ligne » et nouveaux appareils peuvent avoir jusqu'à 1 h de retard sur une page qui se dit « live ». (Correctif côté serveur : **réservé à Claude**, voir §6.)
4. **`/network` rend exactement le même `NetworkMap` que l'accueil** : il n'y a pas de page dédiée. Tout est monté partout (topologie classique, LAB, panneau latéral, terminal, vue « en direct », deux boucles de requêtes) : trop lourd pour une vitrine.
5. **Le texte d'accueil est périmé et jargonneux** : « Dessins distribués entre ESP8266, e-ink et OLED » (ni TFT, ni UNO R4) ; aucune explication de ce qu'on peut faire, aucun bouton d'action.
6. Points solides du travail LAB à **conserver** : flux réellement observés (aucun mouvement inventé), seuil de 15 min pour animer, filtres/recherche/tri, isolation d'un artiste, repli à 8 appareils par atelier, `prefers-reduced-motion`, flux d'événements unique partagé (pas de requête en plus).
7. Fragilités à corriger : détection du matériel par regex sur la chaîne de firmware (un firmware « 2.0 » = « ESP8266 » par défaut) ; regroupement par **nom** d'artiste (deux artistes homonymes fusionnent ; « non-associe ») ; `deviceId` complet ajouté aux événements de vote d'un endpoint public (les `deviceId` sont déjà dans le snapshot public, mais ils servent d'identifiant aux routes des firmwares : ne pas en exposer davantage que nécessaire).
8. Vérification faite côté Claude sur l'arbre de travail actuel : `npx tsc --noEmit` propre, `npm test` 258/258. Le blocage `uv_os_get_passwd ENOMEM` de ChatGPT est local à son environnement : il doit quand même **écrire** les tests demandés ci-dessous.

## 3. Ce qu'on veut, page par page

### 3.1 Accueil `/` — vitrine + visualisation technique légère
Ordre : **(a)** hero · **(b)** constellation légère · **(c)** galerie des blocs · **(d)** derniers artistes (c et d existent déjà, inchangés).

**(a) Hero** — répond à « c'est quoi ? pourquoi ? comment participer ? » :
- Titre court et concret (proposition à affiner, **sans le mot « blockchain »** ni « preuve » : la validation n'est pas encore réelle) : *« Des dessins qui s'affichent sur de vrais écrans, partout, en direct. »*
- 3 étapes en une ligne chacune : **Dessine** (sur téléphone ou PC) → **Le réseau valide** → **Ça s'affiche** (e-ink, OLED, TFT, un écran chez quelqu'un).
- Deux boutons : **Dessiner maintenant** (`/draw`) et **Voir le réseau en direct** (`/network`) ; un lien discret **Installer un écran** (`/learn`).
- Une ligne de chiffres issus du snapshot : *N artistes · N écrans en ligne · N blocs minés*.

**(b) Constellation légère** (nouveau composant, ex. `app/_home/HomeConstellation.tsx`, **pas** `NetworkMap`) :
- **Un vrai graphe SVG** : le core au centre → un **nœud par artiste** (monogramme/avatar) → ses **appareils** (icône par type d'écran, couleur de `SCREEN_COLOR`) → **liens visibles** core ↔ artiste ↔ appareil.
- **Tous les appareils sont visibles** (jusqu'à un plafond raisonnable : 6 artistes et 4 appareils par artiste, puis un nœud « +N »). Jamais seulement le core.
- **Vignette de l'œuvre affichée** à côté de l'icône de l'appareil : l'image réellement confirmée par l'ACK (voir §4.2), petite (≈ 40-64 px), chargée **à la demande** ; sans image → l'icône seule.
- **Aucun** panneau latéral, terminal, filtre ni tri. Une infobulle ou un clic qui **renvoie vers `/network?device=<id>`** (ou `?artist=<clé>`).
- Aucun mouvement inventé : un lien ne s'anime que pour un événement < 15 min (comme le LAB). `prefers-reduced-motion` respecté.
- Mobile 375 px : graphe réduit (artistes autour du core, appareils en grappe) ou liste verticale de repli lisible ; jamais de scroll horizontal.
- États vides : 0 appareil (message + lien « Installer un écran »), 1 artiste, 20 artistes / 60 appareils (plafonnés + « +N »).

### 3.2 Page `/network` — tout le technique
Garde **tout** l'existant : topologie classique, vue LAB, panneau latéral (device/serveur), journal, section « en direct ». Évolutions :
- **La vue LAB devient un vrai graphe** (même grammaire visuelle que la constellation de l'accueil, en plus riche) : core → artistes → appareils → écrans, **liens dessinés**, vignettes, regroupement par atelier, repli à 8 appareils. La liste actuelle devient la **vue détaillée sous le graphe** (ou un onglet « Liste »).
- Deep links : `?networkView=classic|lab`, `?device=<id>`, `?artist=<clé>` (ouvre le panneau / isole l'atelier).
- Le choix de vue mémorisé ne doit **jamais** masquer la topologie à un nouveau visiteur : défaut = classique ou LAB-graphe (pas la liste).

## 4. Contraintes techniques non négociables

### 4.1 Quota Redis (règle primordiale du dépôt, `CLAUDE.md`)
- **Aucune nouvelle boucle de requêtes.** Réutiliser `useNetworkEventStream` (30 s, onglet visible) et `useLiveDisplays` (60 s, onglet visible).
- **Sur l'accueil : au plus UNE requête client** (`/api/network/displays`, déjà en cache serveur/CDN) et **aucun flux d'événements** (pas de journal sur la vitrine). Pas de `setInterval` nu ; pause onglet caché ; arrêt après inactivité (`lib/usePolling.ts`).
- Aucun nouvel endpoint sans écrire le coût en commandes Redis par appel.

### 4.2 Poids de la page
- **Supprimer les buffers d'image du snapshot envoyé au client** (type allégé `NetworkSnapshotLite` sans `recentFrame.preview`). Les vignettes viennent de **`/api/network/displays`** (méta : `frameId`, `screen`, `hasImage`, `shownAt`…) puis **`/api/network/display-image?frameId=…&screen=…`** (réponse immuable, cache navigateur 1 an) — mécanisme déjà utilisé par `LiveDisplays.tsx` (`loadImage`, convertisseurs `lib/screenToCanvas.ts`). Charger **uniquement** les vignettes visibles.
- Critère : `curl -s / | wc -c` **< 150 Ko non compressé** ; **aucune** chaîne base64 de plus de 3 000 caractères dans le HTML.
- Charger la constellation et le LAB **en lazy** (`next/dynamic`) ; l'accueil ne doit pas embarquer `NetworkStage`, `SidePanel`, `GlobalTerminal`, `ServerInfoPanel`.

### 4.3 Données et logique partagées
Créer un **module pur** `app/network/networkModel.ts` (aucun React) utilisé par l'accueil ET `/network` : `artistKey`, regroupement par artiste (clé = `artistId` si disponible, sinon nom ; **jamais** la fusion silencieuse d'homonymes), `hardwareOf` (table de préfixes de firmware : `r4…` → UNO R4 WiFi, `multiscreen-`, `tft18-`, `eink27bw-`, `2.0` e-ink 2.9" → ESP8266 ; **valeur « inconnu » plutôt qu'une supposition**), couleurs et icônes par écran (`SCREEN_COLOR`, une seule source), plafonds d'affichage.
Tests unitaires obligatoires : `tests/networkModel.test.ts` (regroupement, homonymes, matériel inconnu, plafonds, état vide). Les écrire même si l'exécution est bloquée localement ; le résultat sera relancé côté Claude.

### 4.4 Honnêteté de l'affichage
- Ne pas présenter comme « appareils » des lignes fabriquées. Le fil actuel `esp-<écran> ▸ …` du journal est **synthétisé** à partir des blocs (`EspActivityFeed.tsx`) : l'étiqueter « dérivé des blocs » (ou le déplacer sur `/network` uniquement, jamais sur la vitrine).
- Vocabulaire neutre : « validé par le réseau » plutôt que « preuve », « consensus », « blockchain ».

### 4.5 Accessibilité et robustesse
Navigation clavier, `aria-label` sur les nœuds, contraste suffisant, `prefers-reduced-motion`, aucun scroll horizontal à 375 px, aucune erreur console.

## 5. Livrables et critères d'acceptation
| # | Livrable | Critère vérifiable |
|---|---|---|
| 1 | `app/network/networkModel.ts` + `tests/networkModel.test.ts` | `npm test` vert (relancé par Claude) |
| 2 | Snapshot allégé côté client + vignettes à la demande | HTML de `/` < 150 Ko ; 0 base64 > 3 000 car. ; vignettes chargées via `display-image` |
| 3 | `/network` complet (classique + LAB-graphe + panneaux + deep links) | tous les appareils visibles reliés au core ; `?device=` ouvre le panneau ; défaut sans liste seule |
| 4 | Accueil : hero + `HomeConstellation` + galerie + artistes | graphe avec **appareils et vignettes** ; aucun terminal/panneau ; une seule requête client |
| 5 | Captures avant/après : desktop 1280 et mobile 375, états vide / 1 artiste / 20 artistes / 60 appareils | joindre les images |
| 6 | `npx tsc --noEmit`, `npm run build`, `git diff --check` | verts |

## 6. Règles de travail
- **Ne pas toucher** : `esp8266/**`, `arduino_uno_r4/**`, `lib/networkSnapshot.ts` (invalidation du cache : Claude s'en charge), `lib/chain.ts`, routes `/api/pull*`, `/api/ack-frame`, `/api/validation-result`, `docs/PLAN_REDIS_200K.md`.
  Le fichier `esp8266/esp_tft1.8/esp_tft1.8.ino` contient des **identifiants Wi-Fi locaux** : ne jamais l'ajouter à un commit.
- Fichiers autorisés : `app/page.tsx`, `app/network/**`, `app/_home/**` (nouveau), `app/globals.css` (sections réseau/accueil uniquement), `tests/networkModel.test.ts`, et au besoin `app/api/network/*` (mêmes règles de coût).
- Partir de l'**arbre de travail actuel** (les quatre fichiers non commités) ; ne pas repartir de zéro. Ne **rien commiter** sans accord : proposer trois commits séparés (modèle + allègement du snapshot ; page `/network` ; accueil).
- Une modification à la fois, builds et captures à chaque étape ; signaler tout ce qui n'a pas pu être vérifié.

## 7. Questions à poser au porteur avant de coder
1. Les vignettes : œuvre **actuellement affichée** (ACK) uniquement, ou aussi dernier bloc miné ?
2. Sur l'accueil : au-delà de 6 artistes, « +N » ou rotation ?
3. Clic sur un appareil de l'accueil : infobulle seule, ou navigation vers `/network?device=` ?
