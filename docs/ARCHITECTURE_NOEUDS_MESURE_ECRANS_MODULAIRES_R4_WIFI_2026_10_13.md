# Architecture exploratoire — nœuds de mesure et écrans interchangeables sur UNO R4 WiFi

Date : 13 octobre 2026

Statut : **spécification de recherche, aucune implémentation autorisée par cette note**

Périmètre initial : **UNO R4 WiFi uniquement**

## 1. Objectif

Construire un socle commun permettant d'assembler, sans réécrire toute l'application :

1. un nœud pour le bonsaï : `Grove Moisture Sensor V1.4` alimenté à la demande par un `Grove Relay V1.2` ;
2. un nœud de qualité de l'air : `DHT22 + SGP40` ;
3. un écran choisi indépendamment parmi une liste de pilotes supportés ;
4. le transport de mesures déjà présent dans Proof-of-Draw ;
5. plus tard, une preuve d'origine et d'intégrité de ces mesures.

Le but n'est pas qu'un écran matériel inconnu fonctionne magiquement. Les écrans e-ink, OLED et TFT n'ont ni les mêmes bus, ni les mêmes broches, ni les mêmes pilotes. Le compromis réaliste est :

> un noyau de mesure unique, un modèle d'affichage neutre et un petit adaptateur compilé pour chaque écran supporté.

Changer d'écran ne doit modifier ni les pilotes de capteurs, ni la cadence d'acquisition, ni le format des mesures, ni leur envoi au serveur.

## 2. Architecture proposée

```text
capteurs physiques
   │
   ├── adaptateurs capteurs : begin / sample / état / qualité
   │
   ▼
MeasurementSnapshot (valeurs normalisées, qualité, séquence)
   ├── agrégation et historique court
   ├── envoi /api/sensor
   ├── future signature pod-measure-v1
   └── DashboardModel (texte, valeurs, tendances, alertes)
            │
            └── adaptateur écran sélectionné à la compilation
                ├── OLED I²C
                ├── e-ink SPI
                ├── TFT SPI
                └── écran nul (nœud sans affichage)
```

### Contrats minimaux

Le noyau ne doit connaître aucune bibliothèque d'écran. Conceptuellement :

```cpp
struct MeasurementSnapshot {
  uint32_t sequence;
  uint32_t uptimeMs;
  int16_t temperatureDeciC;
  uint16_t humidityDeciPct;
  int16_t vocIndex;
  uint16_t soilRaw;
  uint16_t qualityFlags;
};

struct DashboardModel {
  const char* title;
  MeasurementSnapshot latest;
  int16_t trendPrimary;
  uint8_t alertLevel;
  uint32_t ageSeconds;
};
```

Chaque adaptateur d'écran expose ensuite une surface étroite : `begin()`, `render(model)`, `showStatus()`, `sleep()`. Une fonction virtuelle n'est pas obligatoire : sur R4, une table de fonctions ou un adaptateur sélectionné par `#define POD_DISPLAY_PROFILE` suffit et permet au compilateur d'éliminer les autres bibliothèques.

## 3. Profils d'écran

### Premier prototype recommandé : OLED I²C

- câblage simple ;
- peut partager SDA/SCL avec le SGP40 si les adresses I²C ne se chevauchent pas ;
- rafraîchissement rapide pour mettre au point les capteurs ;
- peu de mémoire si l'interface reste simple.

### Bonsaï final : e-ink

- information lente et persistante ;
- mise à jour toutes les 10 à 30 minutes suffisante ;
- affichage encore lisible entre deux acquisitions ;
- à préférer pour une station contemplative et peu animée.

### Qualité de l'air : OLED ou TFT

- OLED : valeur courante et petite tendance, prototype le plus facile ;
- TFT : historique et graphiques plus riches, mais consommation, RAM et pilote plus coûteux ;
- e-ink possible pour un résumé lent, mais inadapté à un indicateur VOC réactif seconde par seconde.

### Limite du « branchement universel »

Un écran ne doit être déclaré supporté qu'avec un profil comprenant : pilote, bus, broches, résolution, couleurs, cadence maximale et budget mémoire. Une détection automatique est envisageable pour quelques modules I²C connus ; elle ne peut pas identifier universellement tous les écrans SPI.

## 4. Nœud bonsaï — Grove Moisture V1.4 + Grove Relay V1.2

Le Grove Moisture V1.4 est résistif : sa mesure dépend fortement du substrat et ses électrodes peuvent se corroder si elles restent alimentées. Le relais sert à couper réellement son alimentation entre les mesures.

### Câblage conceptuel

```text
R4 D4 (exemple) ── Grove Relay SIG
R4 5 V / GND     ── alimentation du module relais

R4 3,3 V ou 5 V ── COM du relais
NO du relais     ── VCC du capteur d'humidité
GND commun       ── GND du capteur
sortie capteur   ── A0 du R4
```

Le contact **NO** garde le capteur éteint au repos. On commute le VCC, pas la masse. La tension choisie doit rester compatible à la fois avec le capteur et l'entrée analogique. Le Grove Moisture accepte 3,3 à 5 V ; sa sortie suit son alimentation. Sur un montage définitif, vérifier au multimètre la tension maximale réellement présente sur A0.

Au démarrage, écrire l'état OFF avant de configurer la broche de commande en sortie afin de réduire le risque d'une impulsion involontaire. Le niveau actif doit être vérifié avec la LED et le clic du relais, sans se fier uniquement au nom d'une constante.

### Cycle de mesure proposé

1. relais OFF au repos ;
2. relais ON ;
3. attendre la stabilisation ; commencer par comparer 250, 500 et 1 000 ms ;
4. prendre 9 à 15 lectures analogiques ;
5. conserver la médiane et éventuellement l'étendue ;
6. relais OFF immédiatement ;
7. convertir en indice relatif après calibration dans le vrai substrat ;
8. afficher et placer la lecture dans le tampon d'envoi.

Cadence initiale : une lecture toutes les 30 minutes, envoi groupé toutes les heures comme le DHT22 actuel. À 48 commutations par jour, un relais donné pour 100 000 cycles atteindrait théoriquement plusieurs années ; le nombre réel dépendra du module et de son environnement. Pour une version silencieuse et plus durable, un MOSFET ou un interrupteur de charge remplacera avantageusement le relais mécanique.

### Calibration indispensable

Ne pas convertir immédiatement la valeur en un faux pourcentage absolu. Enregistrer au minimum :

- `soil_raw_air` : sonde hors du sol ;
- `soil_raw_dry` : substrat considéré trop sec pour ce bonsaï ;
- `soil_raw_watered` : valeur stabilisée après un arrosage et drainage normaux ;
- type de substrat, profondeur et position de la sonde ;
- identifiant et date de calibration.

Le tableau de bord peut ensuite afficher `sec / correct / humide`, la valeur brute et sa tendance. Il ne doit jamais arroser automatiquement pendant la phase de recherche.

Sources : [Grove Moisture Sensor V1.4](https://wiki.seeedstudio.com/Grove-Moisture_Sensor/), [Grove Relay V1.2](https://wiki.seeedstudio.com/Grove-Relay/).

## 5. Nœud qualité de l'air — DHT22 + SGP40

### Rôle des capteurs

- DHT22 : température et humidité relative ;
- SGP40 : signal brut sensible aux événements de composés organiques volatils ;
- algorithme officiel Sensirion : transformation du signal compensé en `VOC Index`.

Le DHT22 fournit température et humidité au SGP40 pour sa compensation. Le SGP40 doit rester alimenté et être échantillonné régulièrement : le couper entre les mesures ferait perdre l'adaptation nécessaire à un indice VOC interprétable.

### Cadences proposées

- SGP40 : acquisition toutes les secondes et passage par le Gas Index Algorithm ;
- DHT22 : lecture toutes les 2 à 5 secondes, dernière valeur valide utilisée pour la compensation ;
- écran OLED/TFT : rafraîchissement toutes les 5 secondes ;
- agrégat local : moyenne, minimum, maximum et événements sur une minute ;
- envoi : lots toutes les 15 minutes pendant l'étude, à recalculer avant production selon le coût Redis ;
- e-ink éventuel : rafraîchissement seulement toutes les 10 à 15 minutes ou sur changement de niveau.

Le tableau de bord doit afficher au minimum température, humidité, VOC Index, tendance et âge de la dernière mesure valide. Conserver également `SRAW_VOC`, la version de l'algorithme, la durée de chauffe et les erreurs I²C.

### Ce que ce montage ne mesure pas

Il ne constitue pas une analyse complète de l'air : il manque au minimum un capteur CO₂ NDIR et un capteur de particules PM1/PM2.5/PM10. Le VOC Index est relatif au passé récent de la pièce ; il ne doit pas être affiché comme une concentration universelle de pollution.

Sources : [fiche SGP40 et compensation](https://sensirion.com/resource/datasheet/sgp40), [produit SGP40](https://sensirion.com/products/catalog/SGP40), documentation DHT22 déjà conservée dans `docs/CAPTEUR_TEMPERATURE_R4_DHT22.md`.

## 6. Bus et broches : règle de composition

Chaque configuration doit avoir un manifeste de broches vérifié à la compilation.

| Fonction | Bus typique | Remarque |
|---|---|---|
| DHT22 | GPIO | une broche numérique + résistance si le module n'en possède pas |
| SGP40 | I²C | partage possible avec un OLED I²C si adresses distinctes |
| humidité du sol | ADC | une entrée analogique |
| relais | GPIO | OFF par défaut, contact NO |
| OLED | I²C ou SPI | profil précis obligatoire |
| TFT/e-ink | SPI | SCK/MOSI partageables ; CS/DC/RST/BUSY spécifiques |

Le validateur de configuration doit refuser les collisions de broches, l'ajout simultané de deux pilotes utilisant la même interruption exclusive et un écran dont le framebuffer excède le budget de RAM.

## 7. Relation avec Proof-of-Draw

La première version peut réutiliser `/api/sensor` et le registre générique de grandeurs. Nouveaux types envisagés :

| Clé | Valeur |
|---|---|
| `voc` | VOC Index |
| `vocraw` | signal SRAW_VOC |
| `soil` | indice relatif calibré |
| `soilraw` | lecture ADC brute |
| `sensorerr` | drapeaux d'erreur, plutôt qu'une fausse mesure |

L'écran est un consommateur local du même `MeasurementSnapshot`. Un échec d'écran ne doit jamais invalider une mesure correcte, et une mesure invalide ne doit jamais être remplacée par la dernière valeur sans afficher explicitement son âge.

La future `pod-measure-v1` signera la provenance, pas la vérité physique : identifiant du dispositif, modèles et numéros logiques des capteurs, firmware, séquence, valeurs brutes et transformées, calibration, qualité, hash précédent et référence de temps. La signature et le consensus restent hors de ce premier lot matériel.

## 8. Lots recommandés

1. **M0 — interfaces et modèle neutre, hôte seulement** : `MeasurementSnapshot`, faux capteurs et faux écran ; aucun matériel.
2. **M1 — bonsaï sans écran** : relais, acquisition bornée, calibration brute, journal série ; aucune automatisation d'arrosage.
3. **M2 — air sans écran** : DHT22 + SGP40, compensation et VOC Index ; observation 48 h.
4. **M3 — premier adaptateur OLED** : même tableau de bord pour M1 et M2.
5. **M4 — adaptateur e-ink** : cadence lente, aucune modification des capteurs.
6. **M5 — transport PoD** : nouvelles grandeurs et calcul du coût Redis avant codage serveur.
7. **M6 — preuve de mesure** : message canonique et signatures seulement après calibration et stabilité matérielle.

Chaque lot doit conserver les chemins d'écran/vote existants et s'arrêter pour audit. Aucun déploiement sur les firmwares de production n'est autorisé par cette note.

## 9. Choix immédiat recommandé

- développer d'abord les deux nœuds **sans écran**, au journal série ;
- utiliser ensuite un petit OLED I²C comme premier adaptateur commun ;
- réserver l'e-ink au nœud bonsaï une fois les données et l'interface stabilisées ;
- ne pas brancher les MQ-5/MQ-7 sur ce premier nœud : alimentation, chauffe, calibration et sécurité méritent un banc séparé.

## 10. Vision produit — configurateur matériel dans « Apprendre »

À terme, la page **Apprendre** pourrait proposer un configurateur guidé plutôt qu'une liste de sketches indépendants.

### Parcours envisagé

1. choisir une carte, avec **UNO R4 WiFi comme seule cible initialement supportée** ;
2. choisir un écran principal ;
3. choisir éventuellement un écran secondaire OLED ;
4. choisir un ou plusieurs capteurs ;
5. ajouter les dépendances nécessaires : carte SD, relais, résistances, alimentation, câbles ;
6. obtenir une configuration déclarée compatible, son câblage, ses limites et son firmware.

La page doit produire :

- une nomenclature des pièces ;
- un schéma de câblage et une table des broches ;
- les conflits éventuels de tension, bus, broches, mémoire ou alimentation ;
- un fichier de configuration lisible ;
- un sketch ou paquet de firmware construit depuis le noyau commun ;
- les bibliothèques et versions requises ;
- une procédure de compilation, d'appairage, de test et de retour arrière ;
- un statut honnête par combinaison : `simulé`, `compilé`, `canari matériel`, `production`.

### Éviter l'explosion combinatoire

Le système ne doit pas entretenir un `.ino` copié pour chaque panier. Chaque composant fournit un manifeste de capacités :

```text
carte : RAM, flash, bus, broches, tensions
écran : pilote, résolution, framebuffer, bus, broches, SD éventuelle
capteur : bus, cadence, chauffe, compensation, alimentation
fonction : art fixe, animation, mesures, vote, archive locale
```

Un solveur simple filtre les assemblages impossibles. La CI compile ensuite une **matrice finie de profils officiellement supportés**, pas toutes les permutations théoriques. Une combinaison non canarisée peut être proposée comme expérimentale, mais jamais comme prête à l'emploi.

### Écran principal + OLED

Le double affichage est possible lorsque les broches, le bus et la mémoire le permettent. Rôles recommandés :

- écran principal : œuvre, animation ou tableau de bord complet ;
- OLED secondaire : état réseau, dernière mesure, alerte, progression d'une mise à jour ou code d'appairage.

Le configurateur doit refuser ou adapter le double écran si les deux modules utilisent les mêmes broches de contrôle, dépassent le budget mémoire ou rendent impossible une pile dédiée déjà nécessaire au réseau.

## 11. Profil hybride proposé — UNO R4 WiFi + TFT 1,8″ + SD + capteurs

Ce profil est plus intéressant que de finaliser immédiatement le canari de l'ancien montage ESP8266 + TFT 1,8″ si l'écran doit être déplacé physiquement sur une UNO R4 WiFi.

### Expérience utilisateur

- l'œuvre reste l'affichage principal ;
- toutes les deux minutes, une page de mesures apparaît pendant 10 à 20 secondes ;
- l'œuvre est ensuite restaurée depuis la carte SD, sans téléchargement réseau ;
- une alerte importante peut prolonger la page de mesures ;
- un bouton ou un toucher peut afficher les mesures à la demande ;
- l'acquisition continue indépendamment de ce qui est affiché.

La cadence d'affichage n'est pas la cadence des capteurs :

- SGP40 : calcul interne du VOC Index chaque seconde ;
- DHT22 : toutes les 2 à 5 secondes pour la compensation ;
- sol : toutes les 30 minutes avec alimentation temporaire ;
- résumé visible : toutes les 2 minutes ;
- envoi PoD : lot horaire au départ, après chiffrage Redis.

### Pourquoi la carte SD est importante

Une image RGB565 de 128 × 160 représente environ 40 960 octets, davantage que la RAM disponible pour un cache complet confortable sur R4. La SD permet de conserver l'œuvre et de la restaurer après le tableau de bord sans refaire une requête ni garder un framebuffer complet en RAM.

Si le module TFT 1,8″ ne possède pas de carte SD utilisable, deux replis seulement sont raisonnables : réserver des bandes permanentes aux mesures, ou réduire fortement/cache-partiellement l'image. Retélécharger l'œuvre toutes les deux minutes serait coûteux et fragile.

### Ordre de réalisation

1. identifier précisément le contrôleur du TFT 1,8″, la présence de la SD et le brochage ;
2. compiler le firmware R4 TFT 1,8″ actuel sans l'activer ;
3. valider DHT22 + SGP40 sans écran ;
4. valider le capteur de sol et son relais séparément ;
5. ajouter le tableau de bord TFT ;
6. ajouter le cache/restauration SD ;
7. seulement ensuite réunir art, mesures et réseau PoD ;
8. canari sans vote, puis vote dans le chantier commun lorsqu'il sera prêt.

## 12. Priorité par rapport aux firmwares existants

L'ancien **ESP8266 + TFT 1,8″** reste compilé mais non canarisé. Si son écran est destiné au nœud R4 hybride, son canari est reporté afin de ne pas valider une configuration appelée à être démontée.

L'**ESP8266 + e-ink 2,7″ + OLED** reste en revanche un canari utile : il couvre un vrai montage multiscreen, la contrainte mémoire ESP8266 et la coexistence e-ink/OLED. Il pourra être testé après la clôture du canari tactile TFT 2,8″, sans être bloqué par le futur nœud de mesures.
