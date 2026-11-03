# Vue capteurs v3 — audit d'implémentation (03/11/2026)

Suite de `docs/VUE_CAPTEURS_V2_2026_11_02.md`. Objectif : une lecture des mesures **simple à l'ouverture, personnalisable sans jargon, confortable au téléphone, précise pour l'analyse**, en corrigeant les régressions de la v2 (graphique température + humidité fusionné disparu, trop de rangées de boutons).

## 1. Constats sur l'existant (v2 du 02/11)
- Plus de graphique fusionné température + humidité : une courbe par grandeur, empilées.
- Quatre à cinq rangées de pilules successives (lecture, période, vision, outils de zoom).
- `onJump(t, kind)` recevait la grandeur et ne l'utilisait pas (`void k`).
- Cibles tactiles de 32 px sur les boutons de période / d'œuvre ; styles en ligne répétés.
- Œuvre en bulles comme vue principale (largeur non bornée, 15 000 px sur 30 jours).
- Lecture : liste plate de phrases, grille jours × heures comprimée sur téléphone.

## 2. Ce qui a changé
- **Trois espaces** : Données · Œuvres · Lecture, période commune (24 h / 7 jours / 30 jours).
- **Données** : « Vue d'ensemble » (cartes : dernière valeur, tendance courte, min / moyenne / max de la période ; graphique **température + humidité fusionné** à deux axes colorés, légende cliquable pour masquer une série, curseur et fiche communs, bande de l'air discrète ou bouton « Ajouter la qualité de l'air ») et « Analyse détaillée » (bouton « ⚙ Affichage » : données choisies, compositions Environnement / Air / Connexion, représentation, échelle, remise à zéro).
- **Plan automatique** (`planCharts`) : 1 grandeur = graphique simple, 2 = fusionné (gauche / droite), 3 et plus = petits graphiques synchronisés. Jamais de troisième axe.
- **Représentations** : Mesures · Tendance (moyenne par tranche, annoncée « pas une mesure ») · Min–max (bande + moyenne ; par heure sur 24 h, par jour au-delà) · Mesures + min–max. **Échelle** adaptative ou complète (humidité 0–100, air 0–500…).
- **Interactions communes** : même fenêtre, même curseur, même zoom ; fiche de sélection sous les graphiques (colonne à droite sur grand écran) avec « aucune mesure à cet instant » plutôt qu'une valeur inventée, valeurs agrégées signalées, mesure précédente / suivante.
- **Œuvres** : Chronique (défaut, disques par heure / jour), Trajectoire (température × humidité dans le temps), Empreinte (rosace jours × heures) ; la vue en bulles est dans « Laboratoire ». Papier / Nuit conservé.
- **Lecture** : constats regroupés (À retenir · Variations · Données manquantes), bouton « Voir dans les données » qui **ouvre la bonne grandeur, centre la période et met l'instant en évidence** ; jour type ; grille jours × heures défilante avec colonne des jours figée.
- **Accessibilité** : `aria-pressed`, focus visible, cibles ≥ 44 px, couleur doublée par trait pointillé et marqueur, rien ne dépend du survol, `prefers-reduced-motion`.

## 3. Fichiers
Créés : `lib/chartCompose.ts`, `lib/measureWorks.ts`, `app/measures/{DataParts,WorksView}.tsx`, `app/measures/measures.css`, `tests/chartCompose.test.ts`, ce document.
Modifiés : `app/measures/{MeasuresPanel,SeriesChart,ReadingView,ArtworkView}.tsx`, `lib/chartView.ts` (échelle complète, bandes par tranche), `tests/{measuresPanel,artistSensors}.test.ts`, `docs/PLAN_REDIS_200K.md` (déjà poussé avant), `docs/INDEX_DOCUMENTATION.md`.

## 4. Preuves
- **Aucun endpoint, polling, commande Redis ni chargement en plus** : `useDeviceMeasures(` n'apparaît qu'une fois (dans le panneau) ; test statique : aucune des vues ne contient `fetch(`, `/api/`, `setInterval`, `setTimeout`, `requestAnimationFrame`. Mesuré dans le navigateur : 0 requête réseau pendant changement d'espace, de grandeur, de représentation, d'échelle, de période et de constat → courbe.
- Vérifié dans le DOM du bac à sable `/measures-lab` : température seule (1 graphique), température + humidité (1 graphique fusionné, 2 axes), + air (3 petits graphiques), signal + latence + débit (3 petits graphiques), masquage d'une série, constat → bonne grandeur et instant, trois œuvres, 24 h / 7 j / 30 j = 24 / 7 / 30 disques.
- **Largeurs** 320, 360, 390, 430, 768, 820, 1024, 1280 (via 1440), 1440 : aucun débordement horizontal de la page (largeur max du panneau 980 px), aucune cible tactile < 44 px dans les espaces Données, Œuvres, Lecture.
- Tests : `tests/chartCompose.test.ts` (plan, axes, compositions, échelle, tendance, bandes, trous, 4 000 relevés < 200 ms avec min / max préservés, résumé, sélection, œuvres déterministes, garde-fous statiques), `measureCharts`, `measurePrivacy` (10 mutants), `measuresPanel`, `artistSensors`.

## 5. Limites
- **Aucune capture d'écran** : le volet de navigation était masqué pendant tout le travail ; les vérifications visuelles sont des lectures de DOM et de géométrie, pas un contrôle à l'œil (contrastes, esthétique, tablette en paysage).
- Superposition forcée de trois grandeurs : non offerte (trois unités différentes exigeraient un troisième axe, exclu) ; petits graphiques synchronisés à la place.
- Le bac à sable utilise des données synthétiques ; pas d'essai sur un appareil réel avec SGP40 ni sur une durée de 31 jours réelle.
- Deux tests de harnais firmware R4 (« VRAI code ») restent rouges comme avant ce lot (sources tierces non téléchargées, vérification non refaite).
- Build de production : voir le résultat dans le message de livraison.
