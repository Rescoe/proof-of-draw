# Lot UX 5 — page Apprendre : intentions, recherche, filtres (26/10/2026)

Réorganisation SANS suppression : tout le contenu et toutes les ancres existantes restent ; on ajoute un catalogue, une recherche et des destinations dédiées.

## Deux axes distincts (décision du 26/10)
- **Profondeur** : Découvrir (aucune connaissance requise) · Installer et pratiquer (tutoriels, actions concrètes) · Comprendre en profondeur (architecture, consensus, sécurité, référence technique).
- **Type** : Guide · Concept · Dépannage · Référence · État du projet.

## Livré
- **Page d'accueil d'Apprendre** (`/learn`) : cinq intentions (installer un écran · dessiner sans matériel · chercher une solution à un problème · comprendre le réseau · compatibilité et état du projet), boutons directs (recherche, dessiner, feuille de route, matrice, synthèse, consommation) puis **« Trouver un sujet »** : champ de recherche, filtres Niveau et Type avec compteurs, sans requête les sujets sont rangés par profondeur, avec requête classés par pertinence. L'adresse `/learn?q=wifi` est partageable.
- **Catalogue** (`lib/learnCatalog.ts` pur + `app/learn/data/catalog.ts` + `app/learn/catalogBuild.ts`) : une entrée par section existante (parcours installation étape par étape, dépannages ciblés comme « Mon ordinateur ne détecte aucun port USB » / « La R4 ne se connecte pas au Wi-Fi », réseau, synthèse, consommation…) avec résumé et **mots-clés de débutant** (wifi, branchement, batterie, câble…). Les sections des documents markdown (matrice de compatibilité, dépannage) et les phases de la feuille de route sont ajoutées **automatiquement** à partir de leur contenu : leur texte intégral est cherchable (« ota », « portail », « déménagement »…) ; leurs titres reçoivent des ancres stables (`c-…`, `h-…`, `road-…`).
- **Feuille de route et matrice = destinations dédiées** (`?path=roadmap`, `?path=compat`) au lieu d'être collées après chaque petit parcours. Chaque parcours a désormais un fil d'Ariane (« ← Apprendre / … ») et un lien « Rechercher un sujet ».
- **Anciens liens conservés** : `/learn#compatibilite`, `#feuille-de-route`, `#matrice`, `#depannage`, `#synthese`, `#consommation`, `#wiring`… redirigent vers le bon parcours (`pathForHash`, testé) ; les ancres existantes sont toutes encore présentes.
- Nouvelles ancres ajoutées (additif) sur les dépannages et détails techniques de l'installation, `n-pull-leger`, `p-courants`, `p-reduire`.

## Tests (`tests/learnCatalog.test.ts`, 15)
Toute ancre d'un composant est au catalogue (sinon test rouge → on ne perd jamais un sujet) ; toute entrée statique pointe vers une ancre réelle ; redirections des anciens hash sans incohérence ; identifiants uniques, profondeurs/types valides, 8 parcours représentés ; sections markdown ; recherche (accents, wifi = Wi-Fi, ET, début de mot, filtres, compteurs) ; requêtes réelles (wifi, câblage, batterie, port usb, vote, glossaire, feuille de route, ota). `tests/hardwareMatrix.test.ts` : l'assertion « matrice juste après la feuille de route, toujours visible » est remplacée (décision de ce lot : destination dédiée).

## Impact Redis
Aucun (tout est statique / calculé dans le navigateur ; les fichiers markdown sont lus à la construction).

## Limites
- Les niveaux de profondeur et les types sont attribués à la main pour les sections statiques (relire quand un contenu change de nature) ; les sections markdown sont « Référence / Installer et pratiquer » (matrice) et « Dépannage / Installer et pratiquer » (dépannage) par défaut.
- La recherche est lexicale (début de mot, sans fautes de frappe tolérées).
- Le texte détaillé des guides TSX (contenu des étapes d'installation) n'est pas indexé mot à mot : seuls titres, résumés et mots-clés le sont.
