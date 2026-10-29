# Audit UX — responsive, cohérence visuelle et composants redondants

Date : 29 octobre 2026
Révision auditée : `origin/main` au commit `0c24fd8`
Priorité : téléphone, puis tablettes de toutes tailles, puis ordinateur.
Nature du document : audit et exigences pour préparer un plan de chantier. Aucun code applicatif n’est modifié par ce document.

Méthode : inspection de toutes les routes visibles, des composants de navigation, réseau, galerie, profil, capteurs, documentation et studios, ainsi que de leurs styles sur `origin/main`. La capture automatisée du déploiement était indisponible dans l'environnement d'audit : les risques de débordement identifiés dans le code doivent donc être rejoués aux viewports listés ci-dessous avant toute conclusion visuelle définitive.

## 1. Objectif

Rendre Proof-of-Draw cohérent, professionnel et utilisable sur toutes les tailles sans supprimer les informations existantes ni refaire le design global.

Le site possède déjà beaucoup de bons composants et de contenu. Le problème principal est leur accumulation historique : styles inline, variantes presque identiques, contrôles dupliqués, pages qui n’emploient pas les mêmes marges, boutons ou vocabulaire.

## 2. Synthèse des principaux constats

1. Le breakpoint du menu mobile (`560 px`) est trop bas : entre environ 560 et 900 px, les boutons de navigation peuvent se tasser ou passer sur plusieurs lignes.
2. Plusieurs pages reposent sur `padding: ... 0` alors que `.site-main` n’apporte pas de marge horizontale globale ; leurs contenus peuvent toucher les bords du téléphone.
3. Les boutons sont construits localement avec de nombreux styles différents : rayons, couleurs, hauteurs, typographies et états désactivés ne sont pas uniformes.
4. Les tableaux techniques utilisent un défilement horizontal avec des largeurs minimales de 560 à 720 px. Ils ne sortent pas toujours du document, mais l’expérience mobile reste mauvaise et donne l’impression d’un contenu coupé.
5. Deux familles de graphiques coexistent : `MeasuresExplorer` pour température/humidité et `MeasuresChart` pour VOC/connexion. Elles n’ont pas le même sélecteur de période ni le même niveau d’interaction.
6. Les panneaux capteurs peuvent effectuer deux lectures d’historique pour afficher une même station : une pour l’explorateur température/humidité et une autre pour les autres grandeurs.
7. Les périodes sont pilotées par deux états indépendants. Cela donne l’impression légitime qu’un bouton 24 h / 7 jours / 31 jours ne s’applique pas à tous les graphiques.
8. La page d’accueil et la page réseau peuvent afficher la même information sous plusieurs formes : constellation, terminal, journal d’activité et galerie des écrans affichés.
9. Les modales fonctionnent, mais plusieurs ne gèrent pas complètement le focus et restent présentées comme de petites fenêtres sur téléphone alors qu’une feuille plein écran serait plus confortable.
10. Les pages Galerie, Réseau, Apprendre, Profil et Cercles possèdent des langages visuels partiellement différents.

## 3. Méthode de validation responsive exigée

Le chantier doit être vérifié au minimum aux tailles suivantes :

### Téléphones

- 320 × 568 ;
- 360 × 800 ;
- 390 × 844 ;
- 430 × 932.

### Tablettes

- 600 × 960, petite tablette portrait ;
- 768 × 1024, tablette type iPad portrait ;
- 820 × 1180, tablette portrait large ;
- 1024 × 768, tablette paysage ;
- 1180 × 820, tablette paysage large ;
- 1366 × 1024, grande tablette ou tablette graphique.

### Ordinateurs

- 1280 × 720 ;
- 1440 × 900 ;
- 1920 × 1080 ;
- vérification à 200 % de zoom navigateur.

Pour chaque taille : pas de défilement horizontal du document, aucun bouton coupé, aucune superposition, texte lisible, cible tactile suffisante et modale fermable.

## 4. Navigation globale

### Défaut

Le menu bureau ne devient hamburger qu’à `560 px`. Or la marque, quatre boutons principaux et `Plus` peuvent déjà dépasser sur une tablette portrait.

### Recommandation

- basculer vers la navigation compacte vers 900–1024 px, ou utiliser une container query ;
- ne jamais laisser la barre sticky passer sur deux lignes ;
- garantir une hauteur stable ;
- conserver le logo et le bouton hamburger visibles ;
- appliquer les groupes définis dans l’audit navigation ;
- ajouter `aria-current`, gestion du focus, Échap et clic extérieur.

## 5. Cadre de page et espacements

### Défaut

`.site-main` définit seulement une hauteur minimale. Chaque page gère donc elle-même ses marges. Certaines ont `padding: 20px`, d’autres `1rem`, d’autres `padding: 1.5rem 0`.

Les pages `DrawChoice` et `CirclesClient`, notamment, peuvent se retrouver collées aux bords lorsqu’aucun parent n’ajoute de marge.

### Recommandation

Introduire quelques primitives CSS limitées, sans réarchitecture :

- `.pod-page` : largeur maximale et gouttière responsive commune ;
- `.pod-page--wide` et `.pod-page--narrow` ;
- `.pod-section` ;
- `.pod-card` ;
- `.pod-stack`.

Gouttières indicatives :

- 12–16 px sur téléphone ;
- 20–24 px sur tablette ;
- 24–32 px sur ordinateur.

## 6. Boutons, onglets et champs

### Défauts

- coexistence de boutons à 22, 32, 40, 44 et 52 px ;
- rayons 6, 7, 8, 10, 12, 14, 16 et pilules ;
- couleurs et états actifs définis localement ;
- emojis, Lucide et caractères Unicode utilisés sans règle commune ;
- certaines rangées de pilules ne passent pas à la ligne ;
- petits boutons d’information difficiles à toucher.

### Recommandation

Créer des styles partagés, sans réécrire tous les composants :

- bouton primaire, secondaire, discret et danger ;
- tailles compacte et normale ;
- onglets ;
- groupe de pilules ;
- champ, select et textarea ;
- état loading, disabled, success et error.

Règles :

- cible tactile minimale 44 × 44 px pour l’action principale ;
- texte jamais réduit pour faire entrer artificiellement un bouton ;
- groupes en `flex-wrap` sur mobile ;
- états actifs perceptibles autrement que par la couleur seule.

## 7. Graphiques et capteurs

### 7.1 État réel du code

`MeasuresExplorer` propose :

- Graphique ;
- Œuvre ;
- Interprétation ;
- Jour, Semaine, Mois ;
- exploration tactile et agrandissement.

Mais ce composant ne traite que température et humidité.

`MeasuresChart` reste utilisé pour :

- qualité de l’air `vocidx` ;
- signal Wi-Fi ;
- latence ;
- débit ;
- tableaux bruts.

Dans le profil propriétaire :

- un sélecteur extérieur 24 h / 7 jours / 31 jours filtre les anciennes courbes et le tableau ;
- `MeasuresExplorer` possède son propre sélecteur Jour / Semaine / Mois ;
- les deux états ne sont pas synchronisés.

Le réglage extérieur agit bien sur la courbe SGP40/VOC dans le code actuel. En revanche, comme température/humidité possèdent un autre réglage juste en dessous, l’interface donne l’impression que la période n’a pas un effet global. Cette confusion doit être considérée comme un défaut UX réel.

### 7.2 Lectures redondantes

`SensorModal` charge déjà l’historique privé complet, puis instancie `MeasuresExplorer`, qui relit le même historique via `/api/sensor`. Un profil public peut également charger séparément l’explorateur et les autres grandeurs.

Cela augmente inutilement le coût et rend les états de chargement incohérents.

### 7.3 Cible recommandée

Faire évoluer vers un composant d’exploration partagé :

- une seule lecture d’historique par appareil et par ouverture ;
- un seul état de période ;
- période commune à toutes les grandeurs ;
- onglets ou sections Température, Humidité, Qualité de l’air et Connexion ;
- graphiques interactifs cohérents ;
- vues artistiques uniquement pour les grandeurs pertinentes ;
- données brutes dans un volet secondaire ;
- même composant dans Mon espace, profil public et panneau réseau ;
- variantes `compact` et `expanded` plutôt que plusieurs implémentations.

Ne pas ajouter de polling et ne pas augmenter les lectures Redis. Idéalement, le parent charge les mesures et les passe au composant.

### 7.4 Problèmes mobiles précis

- la rangée de période de `MeasuresExplorer` n’a pas de `flex-wrap` ;
- le texte de période partage la même ligne que trois boutons ;
- la légende des deux courbes peut devenir dense ;
- l’agrandissement devrait être une vue plein écran avec barre de fermeture sticky ;
- les tableaux doivent être secondaires sur téléphone ;
- l’interaction tactile doit fonctionner sans appui long ni sélection de texte, ce qui est déjà partiellement traité.

## 8. Tableaux et matrice de compatibilité

### Défaut

Les tableaux `.powerTable` et `.synthTable` ont une largeur minimale respectivement de 720 et 560 px. Le conteneur défile, mais sur téléphone :

- les colonnes importantes sont hors écran ;
- l’utilisateur ne sait pas toujours qu’il peut glisser ;
- l’en-tête disparaît pendant le défilement vertical ;
- la matrice ressemble à un composant desktop réduit.

### Recommandation

- conserver les vrais tableaux à partir de la tablette paysage ;
- transformer chaque ligne en carte structurée sur téléphone ;
- pour la matrice matérielle : une carte par configuration avec Statut, Carte, Écran, Capteurs, Vote, OTA et niveau de preuve ;
- proposer des filtres avant la matrice plutôt que toutes les colonnes simultanément ;
- si un tableau horizontal reste nécessaire, rendre la première colonne sticky et afficher une indication `Glisser pour voir la suite` ;
- tester les mots longs, les identifiants de firmware et les badges multiples.

## 9. Accueil et Réseau

### Redondances actuelles

`NetworkMap` utilise déjà :

- la constellation ou la topologie ;
- un panneau de détail ;
- un terminal réseau ;
- les miniatures de ce qui est affiché ;
- une section `Actuellement affiché` sous la carte.

L’accueil ajoute ensuite un autre `EspActivityFeed`.

### Recommandation

- variante `home` : constellation synthétique, artistes actifs, un seul flux, pas de catalogue `Actuellement affiché` ;
- variante `network` : outils de zoom, sélection détaillée, panneaux, diagnostics et éventuellement affichages actuels ;
- aucun fetch supplémentaire pour la variante accueil ;
- sur mobile, le panneau sélectionné doit apparaître comme une section claire ou une bottom sheet, pas provoquer un saut de page incompréhensible ;
- conserver une sortie évidente du mode isolé d’un artiste.

### Échelle

Le snapshot contient actuellement tous les appareils. Avant 10 000 utilisateurs, prévoir une représentation agrégée et bornée. Ce point ne doit pas être traité par une simple grille de 10 000 cartes.

## 10. Galerie et fiches d’œuvre

### Points positifs

- grille adaptative ;
- recherche et filtres ;
- cartes navigables au clavier ;
- modale bornée en hauteur ;
- contenu technique disponible.

### Améliorations

- vocabulaire Galerie / Œuvres ;
- topbar empilée sous 430 px ;
- filtres pleine largeur ou défilants de façon explicite ;
- une seule colonne sous environ 420 px si les métadonnées deviennent trop tassées ;
- modale plein écran sur téléphone ;
- barre d’onglets sticky dans la modale ;
- focus piégé dans la modale et rendu au déclencheur à la fermeture ;
- actions importantes sous forme de boutons cohérents ;
- les hashes et détails avancés dans une section repliable.

## 11. Profils, appareils et capteurs

### Points à conserver

- empilement du profil sous 600 px ;
- statistiques en deux colonnes ;
- actions des appareils en deux colonnes ;
- recherche et renommage.

### Points à améliorer

- remplacer `ESP liés` par `Appareils liés`, puisque le réseau contient aussi des R4 ;
- uniformiser `Ajouter un ESP`, `Connecter mon écran`, `Installer un écran` en fonction de l’action réelle ;
- éviter quatre boutons de même importance sur chaque appareil ;
- action primaire : créer ; actions secondaires dans `Gérer` ;
- champs de fuseau avec `minWidth: 220` à adapter au téléphone ;
- menus contextuels de 210 px à maintenir dans le viewport ;
- modale capteur plein écran sur téléphone ;
- rendre explicite la différence entre données publiques et privées ;
- éviter d’afficher plusieurs fois les mêmes graphiques sous des formes différentes.

## 12. Artistes et communauté

- La grille des œuvres d’un artiste passe à deux colonnes sous 600 px. Sur les téléphones de 320–390 px, tester une seule colonne sous 420 px pour préserver image, titre et badges.
- Les formulaires de Cercles utilisent correctement `flex-wrap` dans plusieurs zones, mais la page n’a pas de gouttière locale ; elle doit adopter le cadre commun.
- Le formulaire de message d’un cercle ne passe pas explicitement à la ligne : à tester à 320 px.
- Les actions accepter/refuser, inviter, quitter et supprimer doivent employer les mêmes styles et tailles que le reste du site.
- Les messages et noms longs doivent conserver `overflow-wrap:anywhere`.

## 13. Apprendre et documentation

### Points positifs

- parcours distincts ;
- sommaire mobile repliable ;
- recherche documentaire ;
- contenus déjà riches.

### Problèmes

- densité très élevée ;
- navigation Installation et Autres parcours répétée selon le contexte ;
- tableaux desktop ;
- nombreuses cartes visuellement proches ;
- plusieurs liens vers une même information avec des libellés différents.

### Recommandation

- conserver la page d’entrée orientée par intention ;
- une seule navigation locale contextualisée ;
- contenus experts repliables ;
- matrice en cartes sur mobile ;
- fil d’Ariane stable ;
- bouton `Rechercher` toujours accessible ;
- pas de duplication du même lien dans plusieurs groupes si le contexte n’en a pas besoin.

## 14. Studios de dessin et d’animation

Ces surfaces possèdent déjà leur propre responsive avancé et doivent rester isolées du chantier global.

À vérifier sans refonte :

- hauteur dynamique `dvh` avec clavier virtuel ;
- safe areas iOS ;
- orientation portrait/paysage ;
- barre d’outils accessible à 320 px ;
- timeline d’animation scrollable sans capturer le scroll vertical ;
- aucun contrôle masqué derrière la navigation sticky ;
- tailles tactiles ;
- réduction des animations si `prefers-reduced-motion`.

## 15. Modales et panneaux

Créer une convention commune :

- téléphone : plein écran ou bottom sheet ;
- tablette/desktop : fenêtre centrée avec largeur maximale ;
- en-tête et fermeture visibles pendant le scroll ;
- Échap, clic backdrop lorsque non destructif, focus trap et restitution du focus ;
- blocage du scroll arrière ;
- confirmation claire des actions destructives ;
- aucun contenu large ne doit élargir la modale.

Composants concernés au minimum : détail d’un bloc, historique capteur, don/transfert d’appareil, suppression, sélecteur d’œuvre de profil et détails IA.

## 16. Primitives visuelles proposées

Sans introduire de nouvelle architecture, formaliser :

- espacements : 4, 8, 12, 16, 24, 32 ;
- rayons : 8 pour contrôles, 12 pour cartes, 16 pour grandes surfaces ;
- hauteurs : 44 normal, 36 compact uniquement hors action principale ;
- couleurs sémantiques : principal, secondaire, succès, attention, danger ;
- typographie : titre de page, titre de section, corps, aide, monospace technique ;
- composants CSS : page, card, button, tabs, pills, form-field, modal, table-responsive, empty-state, notice.

Ne pas transformer tout en bibliothèque abstraite. Extraire seulement les motifs réellement répétés.

## 17. Tests automatisés recommandés

### Structure

- tests de `navLinks` mis à jour ;
- absence des anciens termes publics non souhaités ;
- anciennes URL toujours accessibles ;
- états actifs par route ;
- une seule section d’activité et aucune `LiveDisplaysSection` sur l’accueil ;
- variantes home/network explicites.

### Responsive

Ajouter des captures ou tests de viewport sur les pages :

- `/` ;
- `/gallery` ;
- `/draw` ;
- `/network` ;
- `/profile` avec plusieurs appareils et capteurs ;
- `/artists/<profil avec capteurs>` ;
- `/learn?path=compat` ;
- `/circles` ;
- studio dessin et studio animation.

Fixtures nécessaires :

- noms très longs ;
- 0, 1, 5 et beaucoup d’appareils ;
- station avec température, humidité, VOC et connexion ;
- œuvres dessin et animation ;
- tableau de compatibilité complet ;
- erreurs réseau, chargement et états vides.

Assertions :

- `document.scrollWidth <= viewportWidth` ;
- aucune cible principale sous 44 px ;
- modale fermable et contenu visible ;
- pas de chevauchement de la barre sticky ;
- navigation clavier ;
- contraste et focus visibles.

## 18. Ordre de chantier recommandé

### Lot 1 — fondations visibles

- navigation et cadre de page ;
- vocabulaire ;
- boutons et onglets partagés ;
- breakpoints.

### Lot 2 — accueil

- variante home de la constellation ;
- suppression des redondances ;
- artistes actifs et œuvres récentes ;
- test d’échelle visuel.

### Lot 3 — données et graphiques

- une lecture ;
- une période ;
- un explorateur partagé ;
- cohérence profil/réseau/artiste.

### Lot 4 — pages de contenu

- Galerie ;
- Profil/Appareils ;
- Artistes/Cercles ;
- Apprendre et matrice responsive.

### Lot 5 — finitions

- modales ;
- accessibilité ;
- viewports automatisés ;
- correction des derniers débordements.

## 19. Contraintes

- ne pas modifier le consensus, Redis, les routes firmware ou OTA pour résoudre un problème visuel ;
- ne pas ajouter de polling ;
- ne pas multiplier les lectures de mesures ;
- ne pas supprimer les informations techniques, mais les placer dans des niveaux avancés ;
- ne pas refaire l’identité visuelle ;
- ne pas réécrire les studios ;
- préserver les URL historiques ;
- travailler par lots vérifiables et réversibles.

## 20. Livrable attendu de la prochaine étape

À partir des deux audits UX, produire un plan d’exécution précis : fichiers touchés, composants à mutualiser, maquettes textuelles par viewport, ordre des commits, tests et risques. Soumettre ce plan à audit avant de modifier l’interface.
