# Lot UX 1 — parcours et interface fondamentaux (26/10/2026)

Décisions du porteur / audit Codex : trois intentions (créer, découvrir, connecter un écran), pas de réécriture, rien de supprimé.

## Livré
- **`/draw` = page « Créer une œuvre »** (`app/draw/page.tsx`, `DrawChoice.tsx`, logique pure `lib/drawTargets.ts`) : « Dessiner sur mes écrans » (`/api/devices?mine=1`) et « Dessiner sur un écran partagé » (`/api/public-screens`, mes propres appareils retirés). Chaque écran mène au studio existant `/draw/{device}/{écran}` (inchangé). Capteurs seuls et écrans inconnus exclus. Aucun écran : message calme avec les prochaines étapes (Connecter mon écran / installer / participer sans matériel).
- **Quatre états distincts** par liste : chargement, erreur (HTTP, réseau ou corps inattendu → message + « Réessayer »), vide réel, appareil hors ligne (pastille + mention, le dessin reste possible, l'œuvre attend son retour). `classifyList` ne transforme jamais un échec en vide.
- **Corrections d'échecs silencieux** : `/api/public-screens` renvoie 503 (et non plus `{devices: []}`) en cas d'échec ; la page profil montre l'erreur avec « Réessayer » pour « Mes écrans » et « Écrans partagés » (liste précédente conservée lors d'un rafraîchissement silencieux raté).
- **Navigation** (`lib/navLinks.ts`) : Créer · Découvrir · Mes écrans · Installer un écran + menu « Plus » (Accueil, Réseau en direct, Animations, Agents IA, Artistes, Connecter mon écran, Apprendre et documentation). « Onboard » n'apparaît plus côté utilisateur (URL `/onboard` inchangée). Menu « Plus » = `<details>` natif, refermé au changement de page ; tiroir mobile avec séparateur.
- **Accueil** : trois actions (Créer / Découvrir / Connecter mon écran) avant la carte réseau, « Le réseau, en direct » vient ensuite.
- **Mes écrans** : onglets renommés (« Mes écrans », « Écrans partagés ») ; le panneau « Gérer » est séparé en deux groupes visibles : **Gérer** (Réglages, Accès, Journal : nom, partage, mesures, appairage) et **Maintenance avancée** (Blocs/transfert, Zone sensible : fusion, don, suppression). Toutes les confirmations de sécurité sont inchangées. « Utiliser » = les boutons Dessiner/Animer et l'état de la carte (déjà en tête).

## Tests
`tests/drawTargets.test.ts` (sélection, exclusions, états erreur/vide), `tests/navLinks.test.ts` (4 entrées, aucune destination perdue, « Onboard » absent, état actif).

## Impact Redis
Aucun nouvel accès : `/draw` fait les deux lectures déjà faites par le profil (`devices?mine=1`, `public-screens`), une fois par ouverture de la page.

## Limites
- « Dernière œuvre » par appareil n'est pas ajoutée à la carte (coûterait une lecture `my-devices/displays` par ouverture du profil) : elle reste dans la section « Ce que mes écrans affichent » du profil.
- Rendu vérifié par navigateur sans Redis (états erreur / vide) ; le rendu avec de vrais appareils est à vérifier sur la production.
