# Chantier UX — retour d'exécution, jalons 1 à 5 (29/10/2026)

Plan : `PLAN_CHANTIER_UX_2026_10_29.md` (révision 2, décisions de l'audit Codex intégrées). Base : `main` au commit `f2e2222`. Aucun fichier de firmware, d'OTA, de consensus ni de schéma Redis n'est touché.

## Ce qui est livré

| Jalon | Contenu | Commits |
|---|---|---|
| 1 — Navigation et vocabulaire | Barre bureau à sept entrées sur une ligne (Accueil · Galerie · Créer une œuvre · Réseau · Communauté ▾ · Apprendre · Mon espace) ; **tiroir tablette / téléphone en quatre groupes PARTICIPER · EXPLORER · MON COMPTE · AIDE** ; hamburger jusqu'à 1024 px inclus ; focus piégé ; `aria-current="page"` réservé au lien qui est exactement la page courante ; vocabulaire Galerie / Œuvres / Appareils / « Associer un appareil » ; corrections d'audit (en-tête de Galerie empilé, recherche pleine largeur, « Créations d'agents IA » en lien secondaire, tiroir ancré sous la barre, zones sûres) | `7fd142c` `626f4e3` `c439a86` `ffbad6f` `f571a6b` `d699563` |
| 2 — Accueil | `NetworkMap surface="home"` (constellation pleine largeur sans colonne de terminal vide, détail à droite ≥ 901 px ou sous la carte) ; un seul journal ; section unique **« Artistes du réseau »** (actifs maintenant + nouveaux, 6 cartes, aucune lecture de plus) ; Œuvres récentes ; liens Comprendre / Installer / Associer | `2972ccf` `a21e30d` |
| 3 — Créer et responsive | `/draw` : **Dessiner** et **Animer** (affiché seulement si le serveur déclare l'écran capable : `animScreensOf` = `animCapable`, calculé dans `/api/devices?mine=1`, aucune table de versions côté interface, `/api/draw` revalide) ; matrice de compatibilité et tableaux Markdown en cartes sur téléphone ; plus de débordement horizontal de la page Apprendre (code inline) ; gouttières communes ; grille d'œuvres à une colonne sous 420 px | `016d1fd` `c76fd48` `4562bd7` |
| 4 — Mesures | **Une lecture** par appareil (cache de session à Promise partagée, clés privé/public disjointes, TTL 2 min, aucun polling) ; **une période** (24 h / 7 jours / 30 jours) pour température/humidité, qualité de l'air et connexion ; `MeasuresPanel` partagé par Mon espace, profil public, panneau réseau, panneau artiste ; qualité de l'air visible sur le profil public ; relevés bruts en cartes sur téléphone | `def5f38` `e3aa51c` `224a08b` |
| 5 — Modales, accessibilité, Playwright | `useDialog` (Échap, focus piégé et rendu, défilement verrouillé) ; feuille plein écran sur téléphone pour l'historique des mesures et la fiche d'œuvre ; suite `npm run test:ui` (Playwright, devDependency) | `f2e3395` `b997de6` |

## Vérifications

- `tsc --noEmit` propre ; ESLint : aucune erreur nouvelle (comparaison fichier par fichier avec le socle).
- `next build --webpack` complet **avec la vraie base en lecture seule** : compilation, TypeScript et pré-rendu réussis.
- Suite hôte `npm test` : socle 1 362 tests / 73 échecs → **1 402 tests / 73 échecs, mêmes noms** (aucun nouvel échec, 40 tests ajoutés, tous verts). Les 73 échecs existaient sur `main` (harnais C++ du rendu, vérifications de texte des firmwares…).
- Suite de viewports `npm run test:ui` : **79/79** (320×568 … 1920×1080, 14 tailles, `/learn`, matrice, `/gallery`, `/draw`, barre, tiroir) et **84/84** pour l'accueil et `/network` sur données réelles en lecture seule : aucun défilement horizontal, barre sur une ligne au-dessus de 1024 px, hamburger en dessous, cibles de navigation ≥ 44 px, tiroir à quatre groupes à focus piégé, Échap rend le focus, dernier lien atteignable, matrice en cartes.
- Mesures dans le navigateur : une seule requête `/api/sensor` par appareil sur le profil d'un artiste ; tiroir vérifié à 320, 360, 390, 640×360 (zoom 200 %).

## `npm run test:ui`

Serveur de développement déjà lancé (`npm run dev`), puis `npm run test:ui` (`UI_BASE_URL` pour une autre adresse, `UI_WITH_DATA=1` pour l'accueil et `/network`, `UI_CHROMIUM` pour un navigateur déjà installé, sinon `npx playwright install chromium`). Jamais exécutée par `npm test` ni par le build ; `tests/ui` est exclu de `tsc`.

## Non fait / limites

1. **`ChartCore`** (cœur de tracé commun) : reporté, comme demandé par l'audit (lecture et période d'abord). Les deux moteurs de tracé coexistent encore.
2. **Snapshot réseau borné** pour 10 000 appareils : lot séparé, non commencé (l'accueil reste borné à 6 artistes, mais `getNetworkSnapshot` charge tous les appareils).
3. **Safari / Firefox / vrai téléphone** non essayés : la suite ne couvre que Chromium ; aucun essai tactile réel.
4. Contraste et lecteurs d'écran non audités ; seuls les attributs ARIA et les comportements clavier sont testés.
5. « Animer » n'est proposé que sur **mes** écrans (l'atelier signe l'œuvre depuis un de mes appareils) ; sur un écran partagé, seul « Dessiner » apparaît.
6. Le profil, les pages Artistes/Cercles et la Galerie gardent beaucoup de styles inline : seules les gouttières, la grille et les libellés sont harmonisés (les primitives `.pod-btn` / `.pod-pills` existent mais peu de pages les utilisent encore).
7. Les anciens sélecteurs de période propres à `MeasuresExplorer` restent utilisés quand il est employé seul (banc `/measures-lab`).
