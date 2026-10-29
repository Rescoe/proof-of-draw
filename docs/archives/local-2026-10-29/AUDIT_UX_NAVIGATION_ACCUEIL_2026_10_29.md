# Audit UX — navigation, architecture de l’information et accueil

Date : 29 octobre 2026
Révision auditée : `origin/main` au commit `0c24fd8`
Périmètre : navigation globale, page d’accueil, articulation Galerie / Création / Réseau / Communauté / Documentation / Compte.
Nature du document : audit et exigences pour préparer un plan de chantier. Aucun changement fonctionnel demandé dans ce document.

Méthode : lecture de la navigation, des routes, des composants et des styles présents sur `origin/main`. La capture automatisée du site déployé était indisponible dans l'environnement d'audit ; les constats structurels sont vérifiés dans le code, tandis que les comportements visuels devront être confirmés par les tests de viewport prévus dans le plan.

## 1. Intention produit à préserver

Proof-of-Draw doit être compréhensible en quelques secondes par une personne qui ne connaît ni les ESP, ni le consensus, ni la chaîne de blocs.

La page d’accueil doit raconter, dans cet ordre :

1. ce qu’est Proof-of-Draw et pourquoi le projet existe ;
2. comment participer immédiatement ;
3. le réseau vivant : constellation, artistes et appareils connectés, flux et événements ;
4. les œuvres produites par le réseau ;
5. les artistes et les chemins pour aller plus loin.

Tout ce qui existe actuellement peut rester accessible. Le chantier consiste surtout à uniformiser, hiérarchiser et déplacer les éléments au bon endroit, pas à supprimer les fonctions ni à refaire l’application.

## 2. État actuel vérifié

La navigation de `origin/main` expose quatre entrées principales :

- `Créer` → `/draw` ;
- `Découvrir` → `/gallery` ;
- `Mes écrans` → `/profile` ;
- `Installer un écran` → documentation d’installation ;
- puis un menu `Plus` contenant Accueil, Réseau, Animations, Agents IA, Artistes, Cercles privés, connexion d’un écran et documentation.

Contrairement à une version locale plus ancienne, `/draw` n’est plus une simple redirection. La page `DrawChoice` existe et propose déjà :

- les écrans personnels ;
- les écrans partagés ;
- les états chargement, erreur et liste vide ;
- un chemin vers l’installation et l’association d’un écran.

Cette base est bonne. Il faut la rendre plus visible et y intégrer clairement le choix entre dessin et animation lorsque l’écran le permet.

## 3. Diagnostic de la navigation

### 3.1 Libellés trop abstraits

- `Créer` ne précise pas ce qui sera créé.
- `Découvrir` ne dit pas si l’on va découvrir des œuvres, le réseau, des artistes ou la documentation.
- `Mes écrans` mène en réalité vers un espace qui contient aussi le profil, les capteurs, les œuvres, les appareils partagés et les autorisations.
- `Installer un écran` reste considéré comme actif pour toutes les pages `/learn`, même lorsqu’on lit la consommation ou la feuille de route.
- `Plus` rassemble huit destinations sans intention commune.

### 3.2 Fonctions essentielles cachées et fonctions secondaires surreprésentées

`Accueil`, `Réseau en direct`, `Artistes`, `Cercles privés` et `Apprendre` sont structurants mais cachés dans `Plus`.

À l’inverse :

- `Animations` est déjà un filtre de la galerie principale ;
- `Agents IA` est une famille d’œuvres ;
- `Connecter mon écran` est une action de compte ou d’installation.

Ces destinations doivent rester disponibles sans occuper chacune une entrée globale.

### 3.3 Accueil absent comme bouton explicite

Le logo renvoie bien à l’accueil, mais cela n’est pas suffisamment explicite pour tous les publics. Un bouton `Accueil` doit être visible dans la navigation principale.

### 3.4 Navigation mobile trop longue

Le tiroir mobile affiche les quatre entrées principales, un séparateur `Plus`, puis huit autres entrées : treize choix sans regroupement sémantique réel.

### 3.5 Incohérences d’état actif

- Le calcul repose surtout sur le chemin et ignore la sémantique des paramètres de requête.
- `Animations` pointe sur `/gallery?type=animation`, mais `/gallery` est déjà capté par `Découvrir` ; l’état actif ne peut pas expliquer clairement dans quelle sous-vue se trouve l’utilisateur.
- Toutes les pages `/learn` activent `Installer un écran`, même quand ce libellé est faux pour le contenu affiché.

### 3.6 Accessibilité du menu

Points à corriger lors du chantier :

- ajouter `aria-current="page"` au lien réellement actif ;
- fermer le menu bureau au clic extérieur et avec Échap ;
- gérer le focus à l’ouverture et à la fermeture du tiroir mobile ;
- empêcher le focus clavier de rester dans le contenu masqué ;
- conserver des cibles tactiles d’au moins 44 × 44 px.

## 4. Navigation cible recommandée

### 4.1 Barre principale sur grand écran

Ordre recommandé :

```text
Accueil | Galerie | Créer une œuvre | Réseau | Communauté | Apprendre | Mon espace
```

Rôles :

- **Accueil** : présentation et vue synthétique du projet vivant ;
- **Galerie** : œuvres validées et rejetées, dessins, animations et œuvres IA via filtres ;
- **Créer une œuvre** : entrée principale, visuellement accentuée ;
- **Réseau** : constellation et vue technique en direct ;
- **Communauté** : menu regroupant Artistes et Cercles privés ;
- **Apprendre** : parcours débutant, installation, compréhension et documentation ;
- **Mon espace** : profil, appareils, écrans, capteurs, autorisations et association.

Pour éviter une barre surchargée :

- `Communauté` peut être un menu à deux entrées ;
- `Mon espace` peut avoir un traitement visuel compact ;
- le passage au menu mobile doit intervenir autour de 900–1024 px, pas seulement à 560 px.

### 4.2 Tiroir mobile

Le menu doit être regroupé par intention :

```text
PARTICIPER
  Créer une œuvre
  Galerie

EXPLORER
  Réseau en direct
  Artistes
  Cercles privés

MON COMPTE
  Mon espace
  Ajouter un appareil

AIDE
  Comprendre Proof-of-Draw
  Installer un appareil
  Documentation technique
```

`Accueil` doit apparaître en tête, hors groupe ou dans un en-tête clairement identifiable.

### 4.3 Destinations à ne plus dupliquer globalement

- `Animations` devient un filtre de Galerie.
- `Agents IA` devient un filtre ou une sous-galerie accessible depuis Galerie.
- `Connecter mon écran` vit dans Mon espace et dans le parcours d’installation.
- Les anciennes URL restent valides et redirigent si nécessaire : aucun lien historique ne doit casser.

## 5. Parcours Créer

La page actuelle `/draw` est une bonne base. Elle ne doit pas être réécrite.

Améliorations proposées :

1. conserver le titre `Créer une œuvre` ;
2. expliquer en une phrase que l’œuvre sera validée par le réseau puis affichée ;
3. présenter les écrans personnels et partagés ;
4. pour chaque écran compatible, proposer distinctement :
   - `Dessiner` — œuvre fixe ;
   - `Animer` — œuvre composée de plusieurs images ;
5. masquer ou expliquer `Animer` lorsque le matériel ne le permet pas ;
6. garder les chemins d’installation et de connexion en état vide ;
7. ne jamais renvoyer silencieusement vers une page de gestion sans expliquer l’étape attendue.

Le CTA global doit dire `Créer une œuvre`, pas seulement `Créer`.

## 6. Galerie

### 6.1 Vocabulaire public

La page `/gallery` affiche encore `Block Explorer`. Ce vocabulaire doit devenir secondaire.

Proposition :

- titre : `Galerie` ;
- sous-titre : `Œuvres validées par le réseau` ;
- onglets : `Œuvres validées` et `Œuvres rejetées` ;
- filtres : `Tout`, `Dessins`, `Animations`, `Créations IA` ;
- détails techniques conservés dans la fiche de l’œuvre : numéro de bloc, hash, validateurs, replay et preuve.

### 6.2 Page d’accueil

Le bloc `Blocs récents` doit être présenté comme `Œuvres récentes`. Le terme bloc peut rester dans la fiche détaillée et dans la documentation experte.

## 7. Page d’accueil cible

### 7.1 Structure recommandée

1. **Hero** : but du projet en une phrase, sans jargon matériel dominant.
2. **Trois portes d’entrée** : Créer une œuvre, Voir la galerie, Connecter un appareil.
3. **Le réseau en direct** : constellation, artistes/appareils actifs, événements qui circulent.
4. **Œuvres récentes** : sélection bornée, puis lien vers Galerie.
5. **Artistes récemment actifs** : sélection bornée, puis lien vers Communauté.
6. **Comprendre ou rejoindre** : liens vers Apprendre et Installer.

### 7.2 Supprimer la répétition « Actuellement affiché » sur l’accueil

`NetworkMap` rend actuellement, sous la carte, `LiveDisplaysSection`. Les miniatures sont déjà visibles dans les nœuds et panneaux de la constellation. Sur l’accueil, cette section répète donc les mêmes images pour chaque appareil.

Décision recommandée :

- masquer `LiveDisplaysSection` sur l’accueil ;
- la conserver si elle reste utile sur la page réseau détaillée ;
- ajouter à `NetworkMap` une variante explicite, par exemple `surface="home" | "network"`, plutôt qu’un test implicite sur l’URL ;
- ne pas supprimer les données d’affichage nécessaires aux miniatures de la constellation sans mesurer l’impact.

À grande échelle, afficher 10 000 fois la même œuvre ou animation n’apporte aucune information supplémentaire.

### 7.3 Éviter le double journal

Sur ordinateur, `NetworkMap` affiche déjà un terminal dans son panneau droit, puis l’accueil ajoute `EspActivityFeed` sous la carte. Les deux racontent des événements réseau proches.

Choisir une seule présentation d’accueil :

- soit un flux éditorial lisible sous la constellation ;
- soit le terminal du panneau ;
- mais pas les deux simultanément sans différence claire.

La page `/network` peut conserver la vue technique complète.

### 7.4 Vue artistes connectés

La meilleure alternative au catalogue des écrans affichés est une vue bornée des artistes actifs :

- nombre d’artistes et d’appareils en ligne ;
- quelques artistes récemment actifs ;
- activité récente : vote, bloc validé, mesure reçue, affichage confirmé ;
- lien vers l’artiste ou son nœud dans la constellation.

Ne pas rendre une liste exhaustive. Prévoir un nombre maximum et une agrégation afin que l’accueil reste lisible lorsque le réseau grandit.

### 7.5 Risque d’échelle identifié

Le snapshot réseau charge actuellement tous les appareils, leurs écrans et certaines métadonnées avant d’envoyer la vue au client. Ce fonctionnement est acceptable pour le réseau actuel, mais pas pour 10 000 appareils.

Le plan UX doit distinguer :

- **court terme** : composition de l’accueil sans nouvelle lecture Redis ;
- **moyen terme** : snapshot public borné/agrégé pour l’accueil, constellation avec niveaux de détail et chargement des détails à la demande.

Ne pas résoudre ce problème par de nouvelles lectures Redis par visiteur. Réutiliser les caches et préférer des agrégats calculés côté serveur.

## 8. Cohérence éditoriale

Choisir un vocabulaire unique et l’appliquer partout :

| Terme technique actuel | Terme public recommandé |
|---|---|
| Block Explorer | Galerie |
| Blocs récents | Œuvres récentes |
| Blocs validés | Œuvres validées |
| Rejetés | Œuvres rejetées |
| Device | Appareil ou carte |
| Onboard | Connecter / associer un appareil |
| Mes écrans | Mon espace |
| Plus | nom sémantique du groupe ou suppression |

Les termes techniques restent disponibles dans les vues avancées et la documentation.

## 9. Priorités proposées

### P0 — compréhension immédiate

- bouton Accueil explicite ;
- `Découvrir` → `Galerie` ;
- `Créer` → `Créer une œuvre` ;
- `Mes écrans` → `Mon espace` ;
- suppression du fourre-tout `Plus` au profit de groupes sémantiques ;
- `Block Explorer` → `Galerie`.

### P1 — accueil cohérent

- variante d’accueil de `NetworkMap` ;
- suppression de la section répétitive des écrans affichés ;
- un seul journal réseau ;
- vue bornée des artistes actifs ;
- œuvres récentes puis artistes.

### P2 — consolidation

- animations et IA intégrées aux filtres Galerie ;
- états actifs cohérents ;
- accessibilité du menu ;
- redirections historiques testées.

## 10. Critères d’acceptation

- Une personne nouvelle peut identifier en moins de dix secondes comment créer, voir des œuvres, comprendre le réseau et gérer son appareil.
- Accueil est visible comme bouton.
- Aucun terme `Onboard` ou `Block Explorer` n’est nécessaire pour utiliser le site.
- Le menu principal ne dépasse pas une ligne avant son basculement mobile.
- Sur mobile, les destinations sont regroupées et chaque cible fait au moins 44 px.
- `/draw` conserve ses états explicites et propose dessin/animation selon les capacités.
- L’accueil ne répète pas une carte complète des affichages déjà montrés dans la constellation.
- Le flux réseau n’est affiché qu’une fois sur l’accueil.
- Toutes les anciennes URL restent fonctionnelles.

## 11. Consigne pour la préparation du chantier

À partir de cet audit, produire d’abord un plan de modifications fichier par fichier, avec maquettes textuelles desktop/mobile, risques, tests et ordre des lots. Ne pas lancer une refonte globale, ne pas modifier le protocole réseau, Redis, le firmware ou le consensus dans ce chantier.
