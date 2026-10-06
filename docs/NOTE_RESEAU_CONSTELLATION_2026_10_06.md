# Constellation (`/network?networkView=diagram`) — reprise du 06/10/2026

Suite de `REPRISE_2026_10_06_VALIDATION_ET_RESEAU.md` § 8. Demande du porteur : plus d'espace entre un artiste et ses écrans, flux continus et stylisés plutôt que des
traits pleins et des impulsions espacées, meilleure répartition autour du core pour un petit réseau, et une fiche artiste complète (la précédente se terminait par
« arrive au jalon suivant »).

## Ce qui a été fait

| Demande | Réalisation | Fichiers |
|---|---|---|
| Répartition autour du core (3 artistes / 5 appareils « vide ») | Petit réseau (≤ 12 artistes, sans zones) : angle de base = hash(artistKey) **conservé**, puis attraction vers des créneaux réguliers (≤ 20 % d'un créneau : l'ordre et l'influence de la clé restent) ; rayon calculé pour que les appareils de deux voisins ne se touchent pas ; > 6 artistes : anneaux intérieur/extérieur en quinconce ; ellipse panoramique. Mêmes clés ⇒ mêmes coordonnées, ordre d'entrée sans effet. | `app/network/model/graph-layout.ts` |
| Écrans trop proches des bulles | Orbites appareil 112 ➜ 330, écran 58 ➜ 150 (petit réseau seulement) ; nœuds dessinés ×1,8 pour rester lisibles quand tout est cadré ; cadrage initial sur TOUT le réseau ; appareils et écrans visibles dès le départ (≤ 12 appareils). Grand réseau (zones) : **inchangé**. | `model/constants.ts` (`SPACIOUS_GEOMETRY`), `graph/Graph.tsx`, `graph/nodes/*` |
| Traits pleins ➜ pointillés / éléments stylisés | Tous les liens de structure sont des pointillés ronds (le trait plein ne sert plus qu'aux contours). | `graph/Graph.tsx` (CSS) |
| Flux continus plutôt que toutes les 1–2 s | Chaque échange = une piste pointillée sur tout le trajet + un **courant continu de points** (motif défilant sans interruption, 1,15 s ; 0,8 s pour votes/validations) tant que l'échange est dans sa fenêtre d'observation (5 min), puis fondu 30 s. Plus d'impulsion isolée. `prefers-reduced-motion` : motif figé. | `graph/Graph.tsx` |
| Fiche artiste | Appareils (état, matériel, firmware, dernière activité, écrans avec ✓ si l'affichage est **confirmé par ACK**), œuvres affichées récemment, frames reçues, **isolation** (le reste s'estompe, flux masqués, puce « Isolé : X ✕ tout afficher »). Un clic sur un appareil ouvre sa fiche. | `app/network/ArtistPanel.tsx`, `model/artist-summary.ts`, `NetworkMap.tsx` |
| Fiche de zone | Liste cliquable des artistes de la zone (au lieu d'un simple décompte). | `NetworkMap.tsx` |
| Correctif trouvé en chemin | Écart d'hydratation de la vue **Topologie** (flottants cos/sin différents serveur/navigateur) : coordonnées arrondies à 3 décimales. | `NetworkStage.tsx` |

**Coût Redis : aucun.** Tout vient du snapshot et des affichages déjà chargés (`useLiveDisplays`, `useNetworkEventStream`), aucune requête ni polling ajouté.
Tests : `tests/networkModel.test.ts` (+5 : répartition angulaire, distances artiste/appareil/écran, déterminisme, grand réseau inchangé, résumé d'artiste).

## Flux et lignes RECONSTITUÉS (ajout du même jour, demande du porteur : « plus on a de logs, mieux c'est »)
Principe : tout ce qui est **déduit** de données publiées plutôt que **mesuré** apparaît désormais, mais marqué d'un astérisque et d'une note.

| Flux reconstitué* | Déduit de | Trajet | Limites |
|---|---|---|---|
| `pull` « présence / pull* » | dernière présence (`lastPing`/`lastSeen`) de chaque appareil | appareil → artiste → core | le serveur ne réécrit la présence que toutes les ≈ 12 min (quota Redis) : c'est une présence récente, pas chaque requête |
| `frame` « bloc #N diffusé* » | les 3 derniers blocs minés + appareils EN LIGNE ayant cet type d'écran (≤ 6 par bloc) | core → artiste → appareil → écran | omis dès qu'un ACK observé postérieur au bloc existe (le flux de livraison observé le remplace) |

- Les flux **observés** (ACK d'écran, votes, validations, blocs) restent prioritaires ; le reconstitué est plafonné (`MAX_RECONSTRUCTED_FLOWS` = 14) et placé après.
- Graphe : style distinct (points plus espacés, piste plus pâle), entrée de légende « flux reconstitué* » et note « * reconstitué à partir des blocs, des présences et des votes publiés… non mesuré directement ».
- Terminal de la page Réseau : lignes `PULL*` et `FRAME*` fusionnées au flux des événements (calcul côté navigateur après montage, aucune requête), avec la même note.
- Journal ESP de l'accueil : les lignes PULL/FETCHFRAME portent « * » et une note (les lignes VOTE, elles, viennent de vrais votes).
- `reconstruct` est **désactivé par défaut** dans `buildObservedFlows` : sans demande explicite, aucune observation ⇒ aucun mouvement (test conservé).
- Tests : 7 de plus (`tests/networkModel.test.ts`).

## Vérifié / non vérifié
- Vérifié dans le navigateur (données de simulation `?fixture=`, jamais Redis) : 5, 12 et 100 appareils, bureau et mobile 375 px, clic artiste ➜ fiche, isolation, clic zone ➜ artiste.
- **Non vérifié** : avec le vrai snapshot de production (3 artistes, 5 appareils) et un écran large ; les flux réels (ils n'existent que si un ACK ou un vote récent existe).

## Reste à faire (trouvé en reprenant les notes)
2. Bouton « Centrer sur cet artiste » dans la fiche (le viewport expose `focusPoint`, non branché au panneau).
3. Liens profonds `?artist=…` / `?device=…` (brief § 9) : non faits.
4. Vignettes des écrans dans la fiche artiste (composant `ShownThumb` disponible ; volontairement non chargées : elles coûtent des requêtes d'image).
5. Fiche de **zone** : toujours volontairement neutre (« ne représente pas un groupe d'artistes »).
6. `GRAPH_GEOMETRY.artistMinGap` et `worldSizePerArtist` ne servent plus qu'au grand réseau.
