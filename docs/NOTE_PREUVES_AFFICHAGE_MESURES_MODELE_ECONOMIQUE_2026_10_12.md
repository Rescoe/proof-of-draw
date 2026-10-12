# Proof-of-Draw — preuves d'affichage, mesures environnementales et valeur produit

Date : 12 octobre 2026
Statut : **orientation produit documentée ; hors périmètre d'implémentation des lots 8B en cours**

## 1. Objet

Cette note conserve une décision de cadrage née des canaris ESP8266 et UNO R4 : l'infrastructure développée pour Proof-of-Draw peut devenir une couche d'attestation plus générale, mais le projet doit distinguer clairement :

1. l'intégrité d'une donnée numérique ;
2. l'origine déclarée par un appareil ;
3. la vérité physique de ce que l'appareil observe ;
4. la valeur opérationnelle pour un client.

Elle ne demande aucune modification du firmware, du serveur, du consensus, de Redis, de Neon ou de l'OTA.

## 2. Actifs techniques réutilisables issus des canaris

Les travaux de canari ont produit des briques qui dépassent un modèle d'écran particulier :

- formats de messages canoniques et domaines de signature séparés ;
- signatures Ed25519 et reçus vérifiables ;
- références TypeScript/C++ et vecteurs différentiels ;
- rendu déterministe, `frameHash` et `renderHash` ;
- flux bornés et échecs fermés ;
- mesures de pile, tas, fragmentation et watchdog ;
- piles temporaires contrôlées sur UNO R4 ;
- discipline de fermeture du TLS avant les calculs volumineux ;
- tests matériels par famille plutôt que confiance dans la seule compilation.

Ces briques rendent envisageable une preuve de mesure peu volumineuse. Elles ne rendent pas automatiquement un capteur exact ni infalsifiable.

## 3. État de maturité à ne pas sur-vendre

- La référence logicielle et les primitives cryptographiques sont fortement testées.
- Le chemin frame personnelle → rendu → affichage → ACK est validé sur ESP8266 e-ink 2,9 pouces.
- Les mécanismes de piles dédiées R4 ont reçu des preuves matérielles partielles importantes.
- Le TFT 2,8 pouces n'est pas encore validé : son canari s'est arrêté après `register` avec 108 octets de marge principale.
- Les builds de canari désactivent volontairement le vote ; ils ne constituent donc pas une validation de vote final sur toutes les cartes.
- Les animations, la flotte complète et une OTA authentifiée/récupérable restent à finaliser.

## 4. Piste future : `pod-measure-v1`

### 4.1 Sémantique

Une preuve de mesure doit signifier :

> L'appareil identifié affirme avoir produit cette lecture dans ce contexte.

Elle ne doit jamais être présentée comme la preuve cryptographique que la pièce possédait réellement cette température ou cette humidité.

### 4.2 Enveloppe conceptuelle

```text
pod-measure-v1
deviceId
sensorId
sensorModel
firmwareVersion
sequence
serverChallenge
measuredAt
temperature
relativeHumidity
declaredUncertainty
calibrationId
previousMeasurementHash
```

Cette liste est exploratoire. Tout gel futur doit préciser l'encodage canonique, les unités entières, les bornes, le traitement de l'horloge, les erreurs capteur et les vecteurs TypeScript/C++.

### 4.3 Propriétés nécessaires

- séquence monotone et chaînage ;
- temps ou défi venant d'une source explicitement qualifiée ;
- stockage temporaire en cas de coupure ;
- distinction entre absence, erreur et mesure valide ;
- signature de lots ou racines de Merkle si la cadence augmente ;
- conservation de l'incertitude et de la calibration ;
- détection des trous de séquence ;
- comparaison de plusieurs capteurs uniquement lorsqu'ils apportent une indépendance réelle.

### 4.4 DHT22

Le DHT22 convient à un prototype. Sa documentation annonce une précision d'humidité typique d'environ ±2 % HR, avec un maximum pouvant atteindre ±5 %, ainsi qu'une dérive à long terme. Il ne doit pas être vendu comme instrument muséal certifié sans étalonnage.

Sources :

- [Fiche technique DHT22/AM2302](https://cdn-shop.adafruit.com/datasheets/DHT22.pdf)
- [Institut canadien de conservation — surveillance de l'environnement](https://www.canada.ca/en/conservation-institute/services/agents-deterioration/humidity/video-monitoring-your-environment.html)
- [Institut canadien de conservation — humidité relative incorrecte](https://www.canada.ca/en/conservation-institute/services/agents-deterioration/humidity.html)

## 5. Produit potentiel : preuve de présentation + preuve de conservation

### Preuve de présentation

- œuvre et contenu ;
- appareil ;
- `frameHash` ;
- `renderHash` ;
- version de rendu et mode de cartel ;
- ACK et événements matériels.

### Preuve de conservation

- température et humidité ;
- fluctuations et dépassements ;
- interruptions de mesure ;
- capteur, incertitude et calibration ;
- rapport exportable.

L'association peut former un historique signé de la présentation d'une œuvre et des conditions dans lesquelles elle a été exposée.

## 6. Valeur économique envisagée

### Musées et lieux patrimoniaux

La valeur n'est pas « le consensus » en soi. Elle peut être :

- surveillance et alerte ;
- prévention des dommages ;
- historique pour prêt, assurance, certification ou subvention ;
- réduction du relevé manuel ;
- administration d'une flotte d'écrans et de capteurs ;
- rapport vérifiable partagé entre dépositaire, prêteur, artiste et assureur.

### Hôtels et lieux d'accueil

La proposition la plus crédible est différente :

- programmation distante d'œuvres numériques ;
- rotation de collections et contenus locaux ;
- preuve que le bon contenu est affiché ;
- état et maintenance du parc ;
- expérience artistique de marque ;
- mesures environnementales comme fonction secondaire.

## 7. Modèles de revenus à tester, sans prix gelé

- installation ;
- abonnement par site, salle ou appareil ;
- supervision et alertes ;
- rapports signés ;
- maintenance et calibration ;
- gestion d'expositions ;
- API et marque blanche ;
- commissions sur commandes, licences ou rotations d'œuvres ;
- expositions distribuées sponsorisées.

Le réseau social d'artistes peut créer la communauté et le catalogue. Il ne doit pas être supposé rentable avant validation d'un service opérationnel payé.

## 8. Rôle raisonnable du consensus

Un consensus est utile lorsque plusieurs parties indépendantes ont intérêt à vérifier un événement. Si toutes les clés appartiennent au même exploitant, les signatures apportent surtout intégrité et redondance ; il ne faut pas présenter cela comme une décentralisation forte.

## 9. Séquence recommandée

1. terminer le lot matériel en cours sans élargir son périmètre ;
2. retenir deux familles matérielles stables ;
3. valider un vote réel contrôlé ;
4. figer une version pilote ;
5. mener des entretiens avec un lieu culturel ;
6. seulement ensuite rédiger une spécification formelle `pod-measure-v1` ;
7. utiliser d'abord le DHT22 comme démonstrateur, puis choisir capteur et procédure de calibration selon le besoin du pilote.

## 10. Limites de décision

Cette note ne doit pas être interprétée comme une autorisation pour :

- ajouter le DHT22 au consensus actuel ;
- modifier les firmwares pendant les lots 8B ;
- annoncer une certification ;
- créer un token ;
- présenter les données signées comme une vérité physique ;
- retarder indéfiniment un pilote pour supporter tous les écrans.

La formulation stratégique retenue est :

> Proof-of-Draw peut devenir une infrastructure reliant création humaine, décision collective, affichage physique vérifiable et historique environnemental signé.
