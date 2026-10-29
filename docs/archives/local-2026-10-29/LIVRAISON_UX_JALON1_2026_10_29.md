# Livraison — chantier UX, jalon 1 « Navigation et vocabulaire »

Date : 29 octobre 2026
Plan de référence : `docs/PLAN_CHANTIER_UX_2026_10_29.md` (révision 2, corrections P0/P1 de l'audit Codex intégrées)
Branche locale : `claude/ux-jalon1-navigation` (worktree `scratchpad/wt-v3`), **cinq commits locaux au-dessus de `main` (`f2e2222`)**. **Rien n'est poussé, rien n'est déployé** : attente de l'audit Codex du jalon.

## 1. Commits (séparés, réversibles un par un)

| # | Commit | Contenu |
|---|---|---|
| 1 | `7fd142c` | Primitives CSS `.pod-page` / `.pod-btn` / `.pod-pills` (gouttières 16/24/32 px, boutons 44 px, pilules qui passent à la ligne). Aucune page migrée. |
| 2 | `626f4e3` | `lib/navLinks.ts` : `NAV_ENTRIES` (barre), `DRAWER_GROUPS` (tiroir), `isActive` avec règles de requête, `activeEntryId`, `activeDrawerHrefs`. Les anciennes listes restent le temps du commit 3 : l'interface n'a pas bougé. |
| 3 | `c439a86` | `NavMenu.tsx` + CSS : barre à sept entrées sur une ligne, menu Communauté, hamburger à 1024 px, tiroir en quatre groupes. Anciennes listes et menu « Plus » retirés. |
| 4 | `ffbad6f` | Tiroir accessible : focus piégé, premier lien focalisé, focus rendu au bouton, reste de la page inerte. |
| 5 | `f571a6b` | Vocabulaire : Galerie / Œuvres / Appareils / « Associer un appareil » ; lien « Créations IA » dans la Galerie ; portes d'accueil. |

Chaque commit passe `tsc --noEmit` et ses tests. Retour arrière : `git revert` du commit voulu (le 3 doit être annulé avec le 4).

## 2. Ce qui a été fait, conformément au plan

- **Barre bureau** (≥ 1025 px) : `Accueil · Galerie · Créer une œuvre · Réseau · Communauté ▾ · Apprendre · Mon espace`, « Créer une œuvre » en appel à l'action, `Communauté` = Artistes + Cercles privés. `aria-current="page"` sur l'unique entrée active.
- **Tiroir tablette / téléphone** (≤ 1024 px inclus) : `Accueil`, puis **PARTICIPER** (Créer une œuvre, Galerie) · **EXPLORER** (Réseau en direct, Artistes, Cercles privés) · **MON COMPTE** (Mon espace, Associer un appareil) · **AIDE** (Comprendre Proof-of-Draw, Installer un appareil, Documentation technique). Les quatre groupes sont conservés ; la barre condensée n'est que leur version grand écran.
- **Destinations** : aucun chemin ne change. `Animations` reste le filtre de la Galerie ; **`Agents IA` est atteignable par le lien « 🤖 Créations IA »** que ce jalon ajoute dans la Galerie (sans lui, `/gallery-ana` n'aurait plus eu d'entrée de navigation) ; `Connecter mon écran` devient « Associer un appareil » (`/onboard`) ; `/learn?path=install#installer` = « Installer un appareil » ; `/learn?path=network#how` = « Documentation technique ».
- **États actifs** : un seul lien actif par adresse dans le tiroir, une seule entrée dans la barre ; `/onboard` allume « Associer un appareil » (tiroir) et « Mon espace » (barre) ; `/artists` allume Communauté et non plus Galerie ; `/learn?path=install` allume « Installer un appareil » et pas « Comprendre ».
- **Vocabulaire** : Block Explorer → Galerie (« Œuvres validées par le réseau », onglets *Œuvres validées / rejetées*) ; Blocs récents → Œuvres récentes ; ESP liés → Appareils liés ; « + Ajouter un ESP » → « + Associer un appareil » ; lien « Onboard » → « page d'association » ; accueil : « Voir la galerie » et « Connecter un appareil » (→ guide d'installation).

## 3. Fichiers modifiés (17)

`app/NavMenu.tsx`, `lib/navLinks.ts`, `app/globals.css`, `app/gallery/GalleryClient.tsx`, `app/BlockGalleryClient.tsx`, `app/page.tsx`, `app/profile/page.tsx`, `app/artists/[artistId]/page.tsx`, `app/circles/CirclesClient.tsx`, `app/draw/DrawChoice.tsx`, `app/onboard/page.tsx`, `app/learn/components/InstallGuide.tsx`, `app/learn/data/catalog.ts`, `tests/navLinks.test.ts` (réécrit), `tests/navActive.test.ts`, `tests/uxPrimitives.test.ts`, `tests/uxVocabulary.test.ts` (nouveaux). `+516 −139` lignes.

## 4. Vérifications

- `npx tsc --noEmit` : **propre**.
- ESLint sur les fichiers touchés : mêmes erreurs qu'avant par fichier (pré-existantes : `GalleryClient` 9, `onboard/page` 4, `profile/page` 2, un avertissement `<img>` sur l'accueil) ; **`NavMenu.tsx` passe de 1 erreur à 0**.
- Tests ciblés : `navLinks` (8), `navActive` (4), `uxPrimitives` (1), `uxVocabulary` (4) : **tous verts**.
- **Suite complète comparée au socle** (même machine, avant puis après) :

| | Tests | Réussis | Échecs | Ignorés |
|---|---|---|---|---|
| Socle `f2e2222` | 1 362 | 1 278 | 73 | 11 |
| Après le jalon 1 | 1 374 | 1 290 | 73 | 11 |

**Les 73 échecs sont exactement les mêmes noms avant et après** (comparaison ligne à ligne : aucun nouvel échec, aucun échec corrigé). Ce sont des échecs déjà présents sur `main` (harnais hôte C++ du rendu, vérifications de texte des firmwares, etc.), sans lien avec ce jalon. Les 12 tests ajoutés passent tous.
- `next build --webpack` (avec un faux Redis) : **compilation et TypeScript réussis**, aucune erreur « Missing Suspense boundary with useSearchParams » — l'étape de pré-rendu échoue ensuite uniquement sur `/` parce que le faux Redis refuse la connexion (même comportement avant ce jalon) ; **le build complet n'a donc pas été terminé sans vrai Redis**.

## 5. Contrôles dans le navigateur (serveur de développement `--webpack`, Redis absent)

Mesures par script : à **1025 px** la barre tient sur **une seule rangée** (hauteur 75 px) ; à **1024 px** la barre est masquée et le bouton visible ; **aucun défilement horizontal**. Communauté : s'ouvre, **Échap** le ferme et rend le focus au bouton, un **clic extérieur** le ferme, `aria-current` = « Apprendre » sur `/learn`. Tiroir à 390 px : focus sur « Accueil », reste de la page inerte, Échap ferme et rend le focus au bouton.

## 6. Captures (`docs/captures/ux-jalon1/`)

`telephone-390x844-barre-fermee.jpg`, `telephone-390x844-tiroir-groupe.jpg`, `telephone-390x844-galerie.jpg`, `telephone-390x844-galerie-tiroir.jpg`, `tablette-820x1180-barre-compacte.jpg`, `tablette-820x1180-tiroir-groupe.jpg`, `bureau-1280x720-barre.jpg`, `bureau-1280x720-communaute-ouvert.png`, `bureau-1440x900-galerie.jpg`.

## 7. Ce qui n'est PAS vérifié (à ne pas lire comme acquis)

1. **L'accueil, `/network`, `/profile`, `/draw`, `/artists`, `/circles` n'ont pas été rendus dans le navigateur** : ces pages lisent Redis côté serveur et l'environnement de vérification n'en a pas. Leurs changements de ce jalon (libellés) sont couverts par des tests de texte, pas par une capture. À confirmer sur le déploiement Preview ou avec la vraie base.
2. **Pas de viewport 320, 360, 430, 600, 768, 1180, 1366, 1920 ni de zoom 200 %** : seuls 390, 820, 1024, 1025, 1280 et 1440 ont été exercés. La suite de viewports automatisés (Playwright) est prévue au jalon 5.
3. **Défilement horizontal des pages de contenu** non mesuré en dehors de la barre.
4. **Contraste et lecteur d'écran** non audités ; seuls les attributs ARIA sont posés et testés.
5. Les clics du navigateur ont été simulés par script dans le serveur de développement ; **aucun essai tactile réel**.

## 8. Écarts entre le plan et l'implémentation

- Commits 3 et 4 du plan (barre, tiroir) restent deux commits, mais le tiroir groupé arrive dès le commit 3 (même composant) ; le commit 4 ajoute seulement l'accessibilité.
- Le plan prévoyait la section « Artistes du réseau » et la variante `surface` au jalon 2 : **non commencées**, conformément à la consigne (jalon 1 seul).
- Un lien « Créations IA » a été ajouté à la Galerie (vocabulaire, commit 5) pour préserver l'accès à `/gallery-ana` : ce n'était pas explicite dans le plan.
- La barre est masquée par un hamburger à **1024 px inclus** (breakpoint `max-width: 1024px`), l'ancienne bascule à 560 px est supprimée.

## 9. Risques résiduels

- `Mon espace` allume la barre aussi sur `/onboard` ; dans le tiroir, c'est « Associer un appareil » seul qui s'allume. Voulu, à confirmer à l'audit.
- La hauteur du tiroir est calée sur la hauteur mesurée de la barre (76 px) ; si la barre change de hauteur, ajuster `.nav-drawer { top }`.
- Les liens d'aide pointent vers `/learn?path=install#installer` et `/learn?path=network#how` : si la structure de la page Apprendre change, mettre à jour `lib/navLinks.ts` et `tests/navActive.test.ts`.

## 10. Reprise

`git -C <worktree> log --oneline f2e2222..HEAD` donne les cinq commits. Pour publier après audit : relire, puis fusionner la branche dans `main` (aucun fichier de firmware, d'OTA, de consensus ni de Redis n'est touché).
