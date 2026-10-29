# Taxonomie canonique des familles et compositions matérielles PoD

**Date de décision : 29/10/2026**
**Statut : règle produit et règle d'architecture**
**Portée : application, firmwares, matrice matérielle, OTA, documentation et vocabulaire utilisé avec les IA**

## 1. Pourquoi cette note existe

PoD possède désormais plusieurs cartes, écrans, capteurs et variantes de firmware. Le mot « famille » a parfois été employé pour parler tantôt d'un écran, tantôt d'un ancien sketch, tantôt d'une cible OTA. Cette ambiguïté a notamment conduit à traiter le montage e-ink BWR + OLED + DHT22 comme un « BWR avec OLED auxiliaire », alors que le porteur le définit comme un véritable multiscreen.

Cette note fixe le vocabulaire. Toute IA et toute personne intervenant sur le projet doit l'appliquer avant de proposer un firmware, une nouvelle composition ou une release OTA.

## 2. Les niveaux à ne plus confondre

Une composition PoD se décrit avec plusieurs niveaux indépendants.

### 2.1 Famille fonctionnelle

La famille décrit le rôle général du montage. Elle ne dépend ni d'un ancien nom de sketch, ni d'une carte particulière.

| Famille | Définition | Règle d'entrée |
|---|---|---|
| **Mono-écran** | Une carte avec exactement un écran physique | un seul écran présent |
| **Multiscreen** | Une carte avec au moins deux écrans physiques | le deuxième écran fait immédiatement entrer la composition dans cette famille |
| **Nœud capteur** | Une carte sans écran, dédiée principalement aux mesures | aucun écran physique, un ou plusieurs capteurs |
| **Validateur sans écran** | Une carte sans écran qui embarque explicitement le moteur de vote | capacité de validation déclarée et autorisée ; ne se déduit jamais d'un capteur |
| **Nœud d'affichage/validation puissant** | Ordinateur léger ou Linux, par exemple un futur Raspberry Pi relié en HDMI | famille réservée ; à spécifier et valider avant activation |

La famille ne donne pas à elle seule le niveau de preuve, la compatibilité OTA ni la capacité de vote.

### 2.2 Plateforme de calcul

La plateforme indique la carte ou le système qui exécute PoD :

- ESP8266 ;
- UNO R4 WiFi ;
- éventuellement ESP32 ;
- ultérieurement Linux/Raspberry Pi.

La plateforme ne décide pas si le montage est mono-écran ou multiscreen. Un ESP8266, une R4 ou un Raspberry Pi peuvent appartenir à l'une ou l'autre famille selon leur composition.

### 2.3 Composition d'écrans

La composition énumère tous les écrans physiques réellement branchés, même si l'un d'eux sert principalement aux états, aux capteurs ou aux animations.

Exemples :

- `TFT 1,8″` : mono-écran ;
- `e-ink 2,9″ BWR` : mono-écran ;
- `e-ink 2,7″ BW + OLED 0,96″` : multiscreen ;
- `e-ink 2,9″ BWR + OLED 0,96″` : multiscreen ;
- `TFT 1,8″ + e-ink 2,9″ BWR` : multiscreen, même si cette composition n'est encore qu'un exemple ;
- `TFT 1,8″ + e-ink BWR + OLED` : multiscreen à trois écrans.

**Règle absolue : dès qu'un deuxième écran physique est ajouté, la composition devient multiscreen.** On ne maintient pas artificiellement la composition dans une famille mono-écran en qualifiant le second écran d'« auxiliaire ».

Le mot « auxiliaire » peut décrire un rôle technique transitoire ou un ancien protocole compatible, mais il ne remplace pas la famille produit. Un nouveau firmware final doit déclarer les écrans réels et leur rôle.

### 2.4 Modules additionnels

Les capteurs et périphériques ne changent pas à eux seuls la famille fonctionnelle :

- DHT22 ;
- SGP40 ;
- microSD ;
- tactile ;
- boutons ;
- LED ;
- relais ou autres périphériques futurs.

Ainsi :

- R4 + TFT 1,8″ + DHT22 + SGP40 reste **mono-écran** ;
- R4 + TFT 1,8″ + DHT22 + SGP40 + e-ink BWR devient **multiscreen** ;
- ESP8266 + BWR + OLED + DHT22 est **multiscreen**, le DHT22 étant un module de cette composition.

### 2.5 Profil matériel

Le profil matériel est l'identité technique exacte d'une composition. Il fixe au minimum :

- plateforme ;
- famille fonctionnelle ;
- liste et rôle des écrans ;
- pilotes et dimensions ;
- câblage et broches ;
- modules activés ;
- profil de flash et stockage ;
- capacités déclarées ;
- contraintes de mémoire.

Exemples de noms explicites :

- `esp8266-mono-eink29bwr` ;
- `esp8266-multiscreen-eink27bw-oled096` ;
- `esp8266-multiscreen-eink29bwr-oled096-dht22` ;
- `r4wifi-mono-tft18-dht22-sgp40` ;
- `r4wifi-multiscreen-tft18-eink29bwr-dht22-sgp40` pour l'exemple hypothétique du porteur.

Ces identifiants sont des identités techniques. L'interface peut employer des libellés plus lisibles.

### 2.6 Variante de firmware et cible OTA

La famille fonctionnelle sert à comprendre et mutualiser le code. La cible OTA sert à empêcher un binaire incompatible d'être installé.

Deux compositions peuvent appartenir à la famille multiscreen tout en nécessitant des binaires distincts. Par exemple, le 2,7″ BW utilise un plan alors que le 2,9″ BWR utilise deux plans noir/rouge, des dimensions et un pilote différents.

Cela ne limite pas l'OTA. Chaque variante peut et doit recevoir ses mises à jour à distance. La règle est seulement :

> Une release OTA cible un profil matériel compatible explicite ; elle n'est jamais envoyée à toutes les compositions d'une famille sur le seul mot « multiscreen ».

Une migration de profil peut être réalisée par OTA : la release de migration est acceptée par l'ancien client ciblé, conserve l'identité et installe le firmware final qui se déclare ensuite sous son nouveau profil.

## 3. Familles et compositions actuellement connues

Cette table décrit la classification, pas le niveau de preuve. Les preuves restent dans `MATRICE_COMPATIBILITE_MATERIELLE.md`.

| Composition | Plateforme | Famille fonctionnelle | Modules | Remarque |
|---|---|---|---|---|
| TFT 1,8″ | ESP8266 | Mono-écran | éventuellement DHT22 | ancien montage pris en charge |
| e-ink 2,9″ BWR | ESP8266 | Mono-écran | éventuellement DHT22 | profil BWR seul |
| e-ink 2,7″ BW | ESP8266 | Mono-écran | — | profil simple |
| e-ink 2,7″ BW + OLED | ESP8266 | Multiscreen | éventuellement DHT22 | multiscreen historique |
| e-ink 2,9″ BWR + OLED + DHT22 | ESP8266 | **Multiscreen** | DHT22 | montage de Claude2 ; doit migrer hors du modèle « OLED auxiliaire » |
| TFT 1,8″ + DHT22 + SGP40 | UNO R4 WiFi | Mono-écran | DHT22, SGP40, microSD | station R4 actuelle |
| e-ink 2,7″ BW + OLED | UNO R4 WiFi | Multiscreen | selon profil | profil R4 multiscreen |
| e-ink 2,9″ BWR | UNO R4 WiFi | Mono-écran | selon profil | profil R4 BWR |
| TFT 2,8″ tactile | UNO R4 WiFi | Mono-écran | tactile, microSD | profil R4 dynamique |
| DHT22 sans écran | UNO R4 WiFi ou autre | Nœud capteur | DHT22 | ne vote pas sauf capacité explicite future |

## 4. Capacités indépendantes

La composition matérielle ne suffit pas à déduire les capacités. Chaque profil déclare séparément :

- affichage d'œuvres fixes, par écran ;
- lecture d'animations, par écran ;
- vote statique ;
- futur vote d'animation ;
- mesures et types de capteur ;
- OTA ;
- portail Wi-Fi ;
- stockage local ;
- tactile ou interaction.

Un appareil multiscreen reste un seul appareil cryptographique et un seul validateur : **un appareil = une voix**, jamais une voix par écran.

## 5. Réutilisation du code pour une nouvelle composition

Lorsqu'une nouvelle composition est demandée, l'IA doit d'abord la décomposer en briques existantes :

1. cœur réseau, identité, vote et chaîne ;
2. client OTA de la plateforme ;
3. portail Wi-Fi ;
4. pilote et rendu de chaque écran ;
5. lecteur d'animation de chaque écran dynamique ;
6. modules capteurs ;
7. stockage ;
8. contraintes de broches et de mémoire.

Elle doit ensuite produire un nouveau profil en réutilisant ces briques, sans copier aveuglément un ancien sketch complet et sans déduire que l'assemblage est déjà validé.

Le fait que chaque brique ait déjà fonctionné réduit fortement le travail, mais la composition finale doit encore être compilée, mesurée et essayée sur la carte. Le niveau de preuve est attaché au profil complet.

## 6. Règles de vocabulaire pour toutes les IA

Quand le porteur dit :

- « mono-écran », il parle d'une composition avec exactement un écran physique ;
- « multiscreen », il parle de toute composition avec au moins deux écrans physiques, pas uniquement de l'ancien 2,7″ BW + OLED ;
- « on ajoute un écran », il demande une migration vers la famille multiscreen ;
- « on ajoute un capteur », la famille d'écran ne change pas ; le capteur devient un module du profil ;
- « même famille », il demande de réutiliser l'architecture et les briques fonctionnelles de cette famille, pas d'envoyer le même binaire à des matériels incompatibles ;
- « OTA sur cette composition », il demande une release distante compatible avec son profil exact, pas un reflash par câble par défaut.

Une IA ne doit pas contredire cette définition en invoquant le nom historique d'un dossier ou d'un firmware. Si le dépôt emploie encore un ancien nom, le code doit être migré progressivement vers cette taxonomie, avec compatibilité pour les appareils déjà déployés.

## 7. Conséquences pour la matrice et l'application

La matrice matérielle et sa vue dans l'application doivent distinguer au minimum :

1. famille fonctionnelle ;
2. plateforme ;
3. profil matériel ;
4. écrans et rôles ;
5. modules ;
6. capacités ;
7. firmware/version ;
8. cible et séquence OTA ;
9. niveaux de preuve `C`, `M`, `V2`, `OTA` ;
10. statut de diffusion.

Elle doit permettre de voir les combinaisons réellement testées et les briques réutilisables, sans faire croire qu'une nouvelle composition est validée par simple déduction.

## 8. Maintenance

Cette note est la source canonique du sens des familles. La matrice est le registre cumulatif des profils concrets et de leurs preuves ; sa synthèse courante doit rester alignée sur `ETAT_ACTUEL_CANONIQUE.md`.

Toute nouvelle composition doit mettre à jour, dans le même lot :

- cette taxonomie si une nouvelle famille générale apparaît ;
- la matrice matérielle ;
- la page de compatibilité de l'application ;
- le profil d'installation ;
- la documentation du firmware et de l'OTA ;
- les preuves après compilation, essai ou canari.
