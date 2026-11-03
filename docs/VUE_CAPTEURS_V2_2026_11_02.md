# Vue capteurs v2 — courbes, œuvre en bulles, lecture, confidentialité par grandeur (02/11/2026)

Branche `claude/capteurs-oeuvre-viz` (non poussée). Ancien code : `archive/2026-11-02_vue-capteurs-v1/` (copies `.txt` + README).
**Vérifié** : tests unitaires et `tsc` ; DOM dans le navigateur de développement (zoom, sélection, trois modes, pas de débordement à 375 px). **Non vérifié** : rendu visuel (capture impossible, volet de navigation masqué), thème papier/nuit à l'œil, appareil réel.

## 1. Courbes (`app/measures/SeriesChart.tsx`, `lib/chartView.ts`)
Toutes les grandeurs reçues (température, humidité, air, signal, latence, débit) ont le même traitement ; le brut SGP40 (`voc`) reste masqué.
Points réels reliés par segments droits (ni lissage ni interpolation) ; un silence > 2,5 écarts typiques coupe la courbe. Fenêtre de temps partagée : molette / pincement / boutons ＋ − = zoom (minimum 3 h), glisser = déplacement, toucher = valeur et heure exactes ; clavier ← → + − Début Fin. L'axe se recale sur la fenêtre ; l'indice d'air part de 0 avec les bandes de niveaux.

## 2. Œuvre (`lib/measureArt.ts`, `ArtworkView.tsx`)
**Une bulle par mesure** (avant : une par heure/jour → 24 h = 24 bulles, semaine = 7). Largeur ∝ nombre de mesures (24 h ≈ 440 px, 7 j ≈ 3 600, 30 j ≈ 15 000 ; « Tout voir » ajuste). Chaque forme encode une donnée, la légende le dit :

| Élément | Donnée |
|---|---|
| position horizontale | le temps (trou plafonné à 6 emplacements, trait pointillé) |
| hauteur | température (normalisée sur la période) |
| taille | humidité |
| couleur | température (plage fixe 0–34 °C) |
| halo violet | indice d'air Sensirion, absent tant que ≤ 100 |
| petites bulles | variation de température depuis la mesure précédente : une par 0,5 °C, 5 au plus, dessus = réchauffement |

Une grandeur absente (ou privée) n'est jamais inventée. Palette « pigments et terres » du vault (`Art Génératif/Palettes`, couleur vive = événement rare) ; surfaces « papier » `#f2ece0` et « nuit » `#0b0d17`, bouton de bascule mémorisé (l'application elle-même n'a qu'un thème sombre). Inspiration : *Champagne Bubbles* (nappe de bulles, halo), *Gymnast Ink* (palette rabattue).

## 3. Lecture (`lib/measureReading.ts`, `ReadingView.tsx`)
Pistes envisagées : (A) constats en phrases cliquables ; (B) grille jours × heures (rythme d'une journée) ; (C) constellation climatique (ancienne, illisible). Retenu : **A + B** — phrases calculées par règles fixes (plus chaud/frais, plus forte variation, air le plus chargé, plus long silence, rythme moyen), chacune ouvre la courbe sur son instant ; grille où la couleur d'une case est la moyenne de l'heure, case vide en pointillé. Aucune IA.

## 4. Confidentialité par grandeur (`lib/measurePrivacy.ts`)
Liste blanche par appareil `measuresPublicKinds`, en plus de l'interrupteur général `measuresPublic` (faux = rien de public). Absente : défaut du registre `MEASURE_KINDS[k].visibility` — **température et humidité publiques ; air et diagnostics privés ; brut SGP40 jamais** ; une grandeur inconnue ou nouvelle est privée tant que le registre ne dit pas « public ».
Appliquée côté serveur : `/api/sensor?public=1` (filtre avant la réponse, donc avant le CDN ; l'heure de référence ne vient que des mesures publiques ; aucune grandeur publique = même 404), snapshot réseau (`kinds` et dernière mesure), `/api/artists/[id]`. Réglage : `POST /api/my-devices/[id]/measures-public { kinds: [...] }` (propriétaire seulement, grandeurs inconnues ou « jamais » refusées), interrupteurs dans Gérer › Réglages. Les `sensors` des fiches d'appareil du propriétaire restent complets.
Limite : le CDN garde une réponse publique jusqu'à 2 min (`stale-while-revalidate` retiré) ; un passage en privé n'est donc effectif qu'après ce délai pour une URL déjà en cache.
Tests : `tests/measurePrivacy.test.ts` (comportement, vue réseau, routes, 10 mutants refusés).

## Coût Redis
Lecture : inchangé (réglage dans la fiche déjà lue : 0 commande de plus). Changer un réglage : ≈ 2 commandes, rare. Les vues n'ajoutent aucune requête (une lecture partagée, aucun polling) ; la suppression du SWR peut ajouter quelques lectures publiques (≤ 3 commandes par appareil et par 2 min, seulement si la page est consultée).

## Reste à faire
Regarder le rendu (papier/nuit, mobile) ; premier appareil réel avec SGP40 ; `app/MeasuresExplorer.tsx` et `lib/measureViz.ts` (v1) gardés pour `/measures-lab?view=v1` et leurs tests ; `tests/measuresPanel.test.ts` figeait l'ancienne structure du panneau si adapté.

## Ajout du 03/11 — vision des courbes
Bouton « Vision » au-dessus des courbes : **Points réels** (défaut), **Amplitude du jour** (bande min–max de chaque jour local en transparence + moyenne du jour, comme l'ancienne vue de production) ou **Les deux**. `dailyBands` (`lib/chartView.ts`) : valeurs réelles, pas de bande pour un jour sans mesure.
