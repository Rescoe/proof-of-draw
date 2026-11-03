# Archive — vue capteurs v1 (avant la refonte du 02/11/2026)

Copies **textuelles** (suffixe `.txt`, hors compilation) de l'ancienne vue des mesures, conservées telles quelles ; la règle de la refonte est de ne rien supprimer.

| Fichier archivé | Rôle d'origine | Remplacé par |
|---|---|---|
| `MeasuresExplorer.tsx.txt` | Graphique par seaux (24 h = 24 heures, 7 j = 7 jours), « Œuvre » (un disque par seau), « Interprétation » (constellation climatique) | `app/measures/SeriesChart.tsx`, `ArtworkView.tsx`, `ReadingView.tsx` |
| `MeasuresChart.tsx.txt` | Courbe simple + tableau des relevés bruts | `SeriesChart.tsx` (le tableau reste dans `MeasuresChart.tsx`, utilisé par « Relevés bruts ») |
| `MeasuresPanel.tsx.txt` | Panneau commun (température/humidité = explorateur ; air et connexion = courbe simple) | `app/measures/MeasuresPanel.tsx` (un seul panneau, toutes les grandeurs) |
| `measureViz.ts.txt` | Agrégation par seaux, palette chaud/froid, disque, constellation | `lib/chartView.ts`, `lib/measureArt.ts`, `lib/measureReading.ts` (`lib/measureViz.ts` reste en place : testé, `/measures-lab` l'utilise encore) |

Les originaux `app/MeasuresExplorer.tsx` et `lib/measureViz.ts` restent dans l'arbre (étiquetés « v1 ») tant que `/measures-lab` et leurs tests s'en servent.
Voir `docs/VUE_CAPTEURS_V2_2026_11_02.md`.
