# Lot UX 2 — mesures capteurs : graphique, œuvre, interprétation (26/10/2026)

Reprend le travail inachevé du panneau latéral du réseau (la fiche artiste n'avait qu'un lien vers le profil) et l'unifie avec le profil public.

## Livré
- **`lib/measureViz.ts`** (pur, déterministe, testé — `tests/measureViz.test.ts`) : agrégation en seaux (jour = 24 heures ; semaine = 7 jours ; mois = 30 jours ; fuseau en paramètre), résumé moyenne/min/max, palette chaud/froid, spécification des disques, constellation, échelle d'axe, seau le plus proche du survol. **Un seau sans mesure reste un trou** (jamais interpolé) ; les données brutes ne sont jamais modifiées (testé).
- **`app/MeasuresExplorer.tsx`** : trois lectures des MÊMES données publiques.
  1. **Graphique** : température (axe gauche, orange) et humidité (axe droit, bleu, pointillé) ; courbes coupées aux trous ; vue semaine/mois : trait pâle = min–max du jour ; survol / toucher / flèches clavier → date, température (min–max), humidité, nombre de mesures ; résumé moyenne/min/max.
  2. **Œuvre** : un disque par heure (24 h) ou par jour (7 / 30 jours) ; couleur = température (bleu glacé → cyan → jaune pâle → orange → rouge, plage fixe −5…40 °C pour que les œuvres restent comparables) ; humidité = épaisseur de l'anneau + nombre de gouttes (graine = début du seau : mêmes données → même image) ; halo = écart de température ; pointillé = aucune mesure ; chaque disque est explorable. Légende, période, capteur et artiste propriétaire affichés.
  3. **Interprétation** : « constellation climatique » générative **locale** (une étoile par seau complet : x = température, y = humidité, taille = nombre de mesures, reliées dans l'ordre du temps) + une phrase par règles fixes (« temps frais et air humide »). L'interface dit explicitement que ce n'est **pas une IA**. L'architecture reste ouverte : une couche IA future recevrait les mêmes `Bucket[]`.
  - **Agrandir** : plein écran (portail, Échap pour fermer). États : chargement, erreur réseau (Réessayer), **non public ou jamais mesuré** (404 identique côté serveur, rien ne se déduit), vide sur la période.
- **Branchements** : fiche artiste de la constellation (`ArtistPanel`, section « Capteurs », explorateur monté au clic seulement) ; panneau d'un appareil (`SidePanel`, bouton « Explorer ») ; profil public d'un artiste (`ArtistSensors`, remplace les anciennes courbes d'environnement ; les grandeurs de connexion — Wi-Fi, latence, débit — gardent leurs courbes 24 h / 7 j / 30 j).
- **`/measures-lab`** (dev seulement, 404 en production) : données synthétiques, `?scenario=empty|error|private`.

## Confidentialité
Inchangée : tout passe par `GET /api/sensor?public=1` (404 si `measuresPublic === false` ou capteur non déclaré) ; le snapshot réseau n'expose `measures` que pour les capteurs publics, donc la section « Capteurs » n'apparaît pas pour un capteur privé. Aucune nouvelle base ni clé.

## Impact Redis
Une lecture (1 LRANGE + 1 SISMEMBER + 1 GET appareil), mise en cache par le CDN 2 min, **à l'ouverture** de l'explorateur, pour 30 jours (`hours=720`) ; changer de période, de mode ou agrandir ne refait aucune requête côté Redis. Plus aucune requête quand l'explorateur est fermé. Le profil public ne fait plus de seconde lecture pour la température/humidité.

## Limites
- Jour/semaine/mois sont relatifs à « maintenant » (un capteur muet depuis 2 jours a un « jour » vide : affiché tel quel).
- Pas de saisie de plage personnalisée ni d'export ; pas d'œuvre figée/partageable (l'œuvre se recalcule avec les données).
- Les noms d'appareil publics ne sont pas exposés par le snapshot : le panneau réseau libelle un capteur par son identifiant public (`publicId`).
