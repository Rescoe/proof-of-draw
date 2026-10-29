# Prompt de passation — preuve de dessin, preuve d'affichage et pistes de monétisation

Copier-coller le texte ci-dessous dans une autre session pour lui transmettre rapidement l'état de la recherche. Le prompt est volontairement autonome, mais demande aussi la lecture des sources locales lorsque la session y a accès.

---

## Prompt à copier

Tu rejoins une réflexion en cours sur **Proof of Draw (PoD)**, projet artistique et laboratoire technique de RESCOE. Commence par intégrer le contexte ci-dessous et par lire les documents indiqués avant de proposer du code, une architecture ou un modèle économique.

### 1. Ce qu'est Proof of Draw

Proof of Draw est un réseau artistique expérimental reliant :

- un atelier web de dessin et d'animation ;
- un moteur qui conserve et rejoue le geste ;
- une conversion déterministe vers les formats réels d'écrans ;
- un protocole de candidat, observation, vote, quorum et bloc ;
- des appareils ESP8266 et Arduino UNO R4 WiFi ;
- des écrans e-ink, OLED et TFT ;
- des signatures Ed25519, des hashes SHA-256, des ACK et une chaîne légère ;
- une galerie, une carte du réseau, des archives SD et des mesures environnementales.

Le serveur Next.js/Vercel coordonne encore le réseau et Redis conserve l'état opérationnel. PoD n'est donc pas aujourd'hui une blockchain autonome. La formulation honnête est : **une coordination encore centralisée, avec des calculs, observations, signatures et traces distribués sur des appareils physiques**.

PoD est aussi pensé comme une **œuvre-réseau** ou une **œuvre-protocole**. Les écrans, les cartes, les contraintes embarquées, les votes, les pannes, les lieux, les hôtes et les durées d'exposition ne sont pas seulement une infrastructure : ils peuvent devenir le matériau de l'œuvre.

### 2. État actuel : se référer à la note de clôture

Une autre session est chargée d'établir la note de clôture qui décrira précisément l'état d'achèvement du chantier « preuve de dessin », ses validations et ce qui reste ouvert. **Ne chiffre pas toi-même cet avancement et ne déduis aucun pourcentage du présent prompt.**

Dès que cette note existe, considère-la comme le point d'entrée autoritatif pour l'état courant, devant cette synthèse. Elle est attendue dans le dépôt sous la forme :

```text
C:\Users\thibf\Documents\App-Rescoe\proof-of-draw\docs\SESSION_2026_10_15_CLOTURE.md
```

Si ce nom exact n'existe pas, cherche la note `SESSION_*_CLOTURE.md` la plus récente dans `docs/`, ou demande au porteur de te la transmettre. Le présent document décrit le continuum et les recherches futures ; il ne remplace pas le bilan de clôture.

Le continuum recherché est le suivant :

```text
geste de l'artiste
→ événements et replay déterministe
→ identité et hash du contenu
→ conversion déterministe par profil d'écran
→ candidat proposé au réseau
→ observations et votes signés
→ quorum et bloc
→ téléchargement du payload binaire
→ calcul du rendu final
→ remise au pilote de l'écran
→ rafraîchissement physique
→ ACK après succès
→ trace dans la galerie et le réseau
```

Les briques principales existent. Plusieurs chemins de réception, rendu et ACK ont été validés sur du matériel réel, notamment sur e-ink 2,9 pouces avec ESP8266 et UNO R4, ainsi que sur d'autres branches matérielles documentées. Le dépôt comprend aussi :

- replay déterministe du dessin ;
- pipeline d'animation ;
- hashes de contenu, `frameHash` et `renderHash` ;
- identité Ed25519 des appareils ;
- travaux sur les reçus signés, racines de Merkle et vérificateur indépendant ;
- noyau C++ portable comparé à la référence TypeScript ;
- ACK envoyé uniquement après un chemin d'affichage considéré comme réussi ;
- archives locales sur carte SD pour certaines cibles ;
- mesures de température, humidité et connexion sur certaines cartes.

Il reste néanmoins des écarts précis avant une preuve complète et généralisée :

- le vote réel multi-appareils contrôlé n'est pas encore validé de bout en bout sur tout le parc ;
- le protocole v3, les reçus et certains contrôles existent mais ne sont pas tous généralisés ou activés en production ;
- tous les firmwares et profils matériels n'ont pas le même niveau de validation ;
- l'OTA n'est pas considéré comme déployé ;
- un `renderHash` prouve les octets du framebuffer final calculé, pas la lumière ou les pigments réellement vus sur la dalle ;
- un ACK prouve qu'un chemin logiciel et matériel a déclaré le rafraîchissement réussi, mais pas à lui seul que l'image est restée visible pendant toute une durée donnée.

Ta première obligation est de conserver ces distinctions. Ne transforme jamais « calculé », « signé », « remis au pilote », « ACK », « présumé visible » et « observé par un tiers » en synonymes.

### 3. Direction de recherche : de la preuve de dessin à la preuve d'affichage

La prochaine idée structurante est la **preuve d'affichage** ou **preuve d'exposition**. L'objectif n'est pas seulement de dire qu'une œuvre existe ou appartient à quelqu'un, mais de documenter sa biographie physique : où, sur quel appareil, sous quelle forme, pendant combien de temps et avec quel niveau d'assurance elle a été exposée.

Exemple de formulation visée :

> Cette variation a été exécutée et exposée pendant trois jours sur six écrans hébergés dans quatre lieux, avec des reçus produits par plusieurs appareils indépendants.

Une preuve d'exposition pourrait relier les données suivantes :

#### Identité de l'œuvre

- `artworkId`, artiste et titre ;
- hash du geste, du replay, du code ou de la capsule autonome ;
- graine et paramètres s'il s'agit d'une œuvre générative ;
- bloc et `parentHash` ;
- version du format, du moteur, des règles et du layout ;
- licence et droits d'exposition.

#### Identité de l'exécution

- `frameHash` du payload reçu ;
- `renderHash` du framebuffer final calculé ;
- profil d'écran, dimensions, couleurs et mode de cartel ;
- firmware et version du rasteriseur ;
- horodatages de téléchargement, rendu, rafraîchissement et ACK ;
- signature de l'appareil sur les éléments réellement connus par lui.

#### Identité de l'exposition

- appareil et clé publique ;
- hôte de l'appareil, distinct si nécessaire de l'artiste ;
- lieu déclaré, seulement avec consentement et précision contrôlée ;
- début d'exposition ;
- fin d'exposition provoquée par le prochain rendu réussi, l'effacement, une interruption explicite ou une borne d'incertitude ;
- signaux de présence ou défis périodiques ;
- événements de déconnexion, redémarrage ou remplacement de frame ;
- éventuelles mesures environnementales pertinentes et consenties.

### 4. Définir honnêtement la durée d'affichage

La durée ne doit pas être un simple `fin - début` inventé par le serveur. Il faut distinguer plusieurs valeurs :

- **durée demandée** : durée prévue par la politique d'exposition ;
- **durée potentielle** : intervalle entre l'ACK initial et le prochain événement connu ;
- **durée confirmée** : somme des intervalles encadrés par des signes de vie ou défis valides ;
- **durée incertaine** : intervalle sans observation suffisante ;
- **durée interrompue** : arrêt connu, changement de frame, panne, redémarrage ou retrait ;
- **durée attestée extérieurement** : durée couverte par un témoin humain, optique ou appareil indépendant.

Pour un écran e-ink, une panne de courant ne signifie pas nécessairement disparition de l'image. Inversement, un ping réseau ne prouve pas que la dalle affiche encore correctement la frame. Le modèle temporel devra donc produire des bornes et un niveau de confiance, pas une précision fictive.

Une exposition peut par exemple être représentée par :

```text
startedAt
lastDeviceConfirmationAt
endedAt ou null
confirmedSeconds
uncertainSeconds
terminationReason
proofLevel
```

Ce schéma est une piste de recherche, pas encore un contrat figé.

### 5. Niveaux de preuve proposés

Utilise une échelle lisible plutôt qu'un booléen « prouvé / non prouvé » :

| Niveau | Ce qui est raisonnablement établi |
|---|---|
| P0 — existence | L'œuvre et ses métadonnées sont archivées. |
| P1 — livraison | Le payload reçu correspond à l'identité attendue (`frameHash`). |
| P2 — rendu calculé | Le framebuffer final correspond au `renderHash` et à une version de rendu connue. |
| P3 — affichage acquitté | L'appareil a terminé son chemin de rafraîchissement et envoyé un ACK signé ou authentifié. |
| P4 — présence temporelle | Des confirmations bornent une durée d'exposition, avec intervalles confirmés et incertains. |
| P5 — témoignage externe | Un témoin indépendant, humain ou optique, atteste tout ou partie de la présence physique. |

Ne prétends pas que P3 équivaut à une preuve optique. P5 ne doit pas devenir obligatoire pour que PoD reste accessible ; il s'agit d'un niveau supplémentaire adapté à certaines expositions, ventes ou institutions.

### 6. Mesures pertinentes pour une future monétisation

La monétisation ne doit pas commencer par un token ou une place de marché. Elle peut partir de mesures vérifiables liées à l'exécution et à l'exposition.

#### Mesures fondamentales

- nombre d'expositions commencées et terminées ;
- secondes/minutes d'exposition confirmées et incertaines ;
- nombre d'appareils, d'hôtes et éventuellement de lieux uniques ;
- diversité des profils d'écran ;
- taux de téléchargement, rendu et ACK réussis ;
- latence entre publication, réception, rendu et ACK ;
- nombre de réplications simultanées ;
- disponibilité de l'appareil pendant l'exposition ;
- niveau de preuve atteint pour chaque intervalle ;
- nombre et identité des témoins indépendants, sans compter plusieurs fois le même profil ;
- version du firmware et du moteur de rendu ;
- intégrité des reçus, signatures et chaînes ;
- interruptions, échecs et périodes non observées.

#### Mesures enrichies, seulement si elles sont réellement observées

- durée dans un lieu d'exposition déclaré ;
- température et humidité associées à la période ;
- interaction tactile sur un écran compatible ;
- observation humaine volontaire ou contrôle optique ponctuel ;
- surface physique de la dalle, si elle est déclarée dans un profil matériel fiable ;
- coût énergétique mesuré. Ne pas inventer une consommation à partir de la seule durée ;
- événement curatorial, collection ou exposition auxquels la présence est rattachée.

#### Mesures à ne pas prétendre connaître sans capteur adapté

- nombre réel de spectateurs ;
- nombre de regards ou impressions ;
- attention humaine ;
- qualité visuelle réelle de la dalle ;
- durée optiquement parfaite ;
- emplacement précis d'un appareil sans consentement.

### 7. Modèles économiques à explorer sans les confondre avec des décisions

Étudier notamment :

- rémunération de l'artiste selon des expositions vérifiées, avec plafond et règles anti-spam ;
- rémunération de l'hôte pour le temps d'exposition confirmé et la disponibilité offerte ;
- rémunération ou réputation de témoins/validateurs indépendants, bornée pour éviter les fermes de votes ;
- commande d'exposition par une personne, une galerie, un musée ou une marque ;
- abonnement donnant accès à une programmation curatoriale, sans transférer nécessairement la propriété ;
- licence d'exposition pour une période, un parc d'écrans ou un événement ;
- partage explicite entre artiste, hôte, curateur, maintenance du réseau et éventuels témoins ;
- vente d'une capsule autonome accompagnée de son historique d'exposition exportable ;
- preuve premium pour une institution, avec témoins externes, conservation et audit renforcés.

Les formules ne doivent pas reposer uniquement sur le nombre d'ACK ou la durée brute, car cela inciterait au spam, aux appareils fantômes et à l'auto-exposition infinie. Toute proposition doit intégrer :

- plafonds par œuvre, appareil, hôte et période ;
- déduplication par profil et clé d'appareil ;
- séparation artiste/hôte/témoin lorsque le niveau de preuve l'exige ;
- exclusion ou pondération transparente de l'auto-validation ;
- challenges de présence non prévisibles si nécessaire ;
- prévention du rejeu des reçus ;
- coût réel du stockage, des requêtes Redis, de la bande passante et de la maintenance ;
- protection de la vie privée ;
- possibilité d'audit et d'export hors de RESCOE.

Ne propose pas de valeur financière ou de tarif avant d'avoir défini l'unité mesurée, son niveau de preuve, son coût de production et les comportements opportunistes qu'elle créerait.

### 8. Principe de conservation issu de fxhash

La recherche est influencée par fxhash, Raptoreum et d'autres cultures d'art génératif et de blockchain. La leçon retenue n'est pas « recréer des NFT », mais :

> Un token, un hash ou une blockchain peuvent survivre alors que l'œuvre exécutable, ses dépendances, ses graines, son contexte ou son interface disparaissent.

PoD explore donc une **capsule d'œuvre autonome** contenant, selon la nature de l'œuvre : manifeste, geste ou code, graines, dépendances locales, versions du moteur, métadonnées, cartel, licence, aperçus, profils de rendu, vecteurs de test et preuves d'exposition exportables.

La promesse de long terme pourrait être : si RESCOE disparaît, les œuvres et leurs preuves déjà produites doivent rester compréhensibles, vérifiables et, lorsque les droits le permettent, réexposables.

### 9. Sources à lire et manière d'y accéder

Le dépôt local est normalement accessible ici :

```text
C:\Users\thibf\Documents\App-Rescoe\proof-of-draw
```

Lire en priorité :

```text
C:\Users\thibf\Documents\App-Rescoe\proof-of-draw\docs\SESSION_2026_10_15_CLOTURE.md
C:\Users\thibf\Documents\App-Rescoe\proof-of-draw\README.md
C:\Users\thibf\Documents\App-Rescoe\proof-of-draw\docs\VISION_LONG_TERME_OEUVRE_RESEAU_APRES_FXHASH_2026_10_13.md
C:\Users\thibf\Documents\App-Rescoe\proof-of-draw\docs\SPEC_PROTOCOLE_V3.md
C:\Users\thibf\Documents\App-Rescoe\proof-of-draw\docs\LOT_3_RECUS_ET_VERIFICATEUR_2026_10_07.md
C:\Users\thibf\Documents\App-Rescoe\proof-of-draw\docs\LOT_8A_RASTERISEUR_REFERENCE_2026_10_07.md
C:\Users\thibf\Documents\App-Rescoe\proof-of-draw\docs\ANIMATIONS_PIPELINE.md
```

La note de vision équivalente dans le vault Obsidian est ici :

```text
C:\Users\thibf\Documents\ObsidianGeneralVault\01 - Projets\PoD - Vision long terme — œuvre-réseau après fxhash.md
```

La note canonique historique du projet dans le vault est ici :

```text
C:\Users\thibf\Documents\ObsidianGeneralVault\01 - Projets\Proof of Draw.md
```

Si tu es dans une session locale disposant du filesystem, lis directement ces fichiers. Si tu n'y as pas accès, demande qu'on te joigne au minimum la note de clôture, le `README.md`, la note `VISION_LONG_TERME...` et le présent prompt. Le dépôt public est :

```text
https://github.com/Rescoe/proof-of-draw
```

L'application et ses vues publiques sont accessibles ici :

```text
https://proof-of-draw.vercel.app
https://proof-of-draw.vercel.app/gallery
https://proof-of-draw.vercel.app/network
https://proof-of-draw.vercel.app/learn
```

Les documents datés peuvent décrire des étapes dépassées. Le code courant, le README le plus récent et les verdicts matériels les plus récents priment. Distingue toujours : déclaré par le porteur, présent dans le code, testé sur l'hôte, compilé pour une carte, observé sur matériel, activé en production.

### 10. Ce que j'attends de toi dans cette session

Après lecture :

1. reformule en quelques paragraphes ta compréhension de PoD, du continuum geste-affichage et des limites restantes décrites par la note de clôture ;
2. conserve cette compréhension comme contexte pour la suite de la session ;
3. si la demande porte sur la monétisation, commence par définir les unités mesurables, les niveaux de preuve et les risques d'incitation avant de parler de prix, tokens ou marché ;
4. si tu découvres une contradiction avec le dépôt, cite le fichier et le niveau de preuve concerné ;
5. ne code rien, ne modifie aucune roadmap et ne propose aucune blockchain additionnelle sans demande explicite ;
6. traite les idées de preuve d'affichage, durée et capsule autonome comme des pistes de recherche concrètes, pas comme des fonctionnalités déjà livrées.

La phrase directrice est :

> **Proof of Draw transforme progressivement la preuve d'un geste numérique en une biographie vérifiable de son exécution et de son exposition physique.**

---

## Provenance de ce prompt

- État d'achèvement : volontairement absent de ce prompt ; il doit être repris depuis la note de clôture produite par la session responsable.
- État technique général : synthèse du `README.md` mis à jour le 14/10/2026 et des documents de recherche du dépôt, à corriger si la note de clôture plus récente indique autre chose.
- Preuve d'exposition, durée, capsule autonome et rôles artiste/hôte/témoin : prolongement de `VISION_LONG_TERME_OEUVRE_RESEAU_APRES_FXHASH_2026_10_13.md`.
- Métriques, niveaux P0–P5 et garde-fous économiques : cadre de travail proposé pour les sessions futures ; non implémenté et non décidé à ce jour.
