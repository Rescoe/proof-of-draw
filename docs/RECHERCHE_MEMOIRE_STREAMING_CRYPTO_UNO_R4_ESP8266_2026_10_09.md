# Mémoire, calcul en flux, cryptographie et réseau sur UNO R4 WiFi / ESP8266

## Retour d'expérience PoD réutilisable pour d'autres projets embarqués

| Champ | Valeur |
|---|---|
| Date de synthèse | 09/10/2026 |
| Projet d'origine | Proof-of-Draw (PoD) |
| Cibles principales | Arduino UNO R4 WiFi, ESP8266, écrans e-ink / OLED / TFT |
| Niveau de preuve | Tests TypeScript et C++ hôte, analyses ELF, compilations Arduino et canaris matériels explicitement distingués |
| Portée | Guide technique réutilisable ; les chiffres exacts doivent être remesurés pour chaque firmware, cœur Arduino et bibliothèque |

Cette note rassemble les recherches menées pendant les lots 6C à 8B2B2. Elle explique le modèle mémoire, les dépassements réellement observés, le calcul des preuves de dessin et d'animation, le calcul en flux, les piles dédiées pour Ed25519 et TLS, les limites actuelles et une méthode de validation réutilisable.

Elle ne doit pas être lue comme une promesse générale sur toutes les UNO R4 WiFi. Les mesures matérielles citées ont été faites avec le firmware PoD UNO R4 WiFi + e-ink 2,9 pouces, le cœur Renesas 1.5.3 et le firmware du module Wi-Fi 0.5.2. La compilation a aussi été exercée avec d'autres versions, sans remplacer les mesures sur carte.

---

## 1. Résumé exécutable

1. La UNO R4 WiFi possède assez de RAM totale pour PoD, mais le firmware réserve une pile principale de seulement **1 024 octets**.
2. `Ed25519::sign` et `Ed25519::verify` dépassaient cette pile. Une pile temporaire dédiée de **2 304 octets** a été validée matériellement : signature **1 316 o utilisés / 924 o de marge**, vérification **1 532 / 708**, aucune écriture sous `__StackLimit`.
3. `WiFiSSLClient::connect` dans la chaîne PoD descendait jusqu'à **1 480 octets**, soit **456 octets sous la limite**. Le défaut existait avant le nouveau rendu et restait silencieux parce que la zone écrasée était généralement libre.
4. Une pile réseau temporaire de **2 048 octets** a ramené la transaction TLS à **1 172 o utilisés / 812 o de marge**.
5. Le canari NETSTACK-FIX1 a détecté **1 048 o sur la pile principale**, soit encore **24 octets de dépassement après la transaction**. NETSTACK-FIX2 a ajouté un point silencieux A immédiatement au retour de `netHttpRaw` : le même dépassement y est déjà présent, **avant** le rapport PodNet et le journal HTTP. L'hypothèse « le journal provoque ces 24 octets » est donc réfutée. Le premier suspect devient la sortie de `PodNet::runSized` sur la pile principale (contrôle, effacement, `free` ou chaîne de retour), sans que la phase exacte soit encore prouvée.
6. Le calcul d'image et d'animation est conçu en flux. Sa mémoire ne dépend pas du nombre total d'images, dans les bornes du protocole. Le temps, lui, augmente avec le nombre d'images et de pixels.
7. La signature Ed25519 ne signe pas le fichier image ou le clip entier : elle signe un message canonique court contenant leurs empreintes, les métriques et le contexte de chaîne. Son coût mémoire et temporel est donc pratiquement constant quelle que soit l'œuvre acceptée.
8. Une entrée non bornée doit être refusée avant ou pendant sa lecture. Le streaming ne remplace jamais les plafonds de taille, de dimensions, de nombre d'images et de durée.

---

## 2. Modèle mémoire à garder en tête

### 2.1 Flash

La Flash contient le programme, les constantes et les tables. Une augmentation de quelques kilo-octets de Flash n'est pas automatiquement problématique tant que la capacité de la carte et le mécanisme de mise à jour sont respectés.

Placer les tables constantes en Flash (`PROGMEM` sur ESP8266) évite de consommer inutilement la RAM.

### 2.2 RAM statique

La RAM statique est réservée dès le démarrage pour les variables globales et `static`. Elle reste occupée pendant toute l'exécution.

Un grand tableau global est prévisible, mais coûte de la RAM même lorsqu'il n'est pas utilisé. Sur les firmwares R4 proches de la limite, PoD réutilise une même zone `g_podScratch[600]` pour des objets dont les durées de vie ne se chevauchent pas : QR d'appairage puis renderer. Le type est construit par placement `new`, correctement aligné avec `alignas(PodScratch)`, puis explicitement détruit.

### 2.3 Tas (`heap`) et `malloc`

Le tas fournit des blocs temporaires :

```cpp
void* p = malloc(2304);
// utilisation bornée
memset(p, 0, 2304); // si des données sensibles y ont transité
free(p);
```

`malloc` peut échouer. Toute utilisation embarquée doit donc avoir un chemin d'échec fermé : aucune fausse signature, aucun faux ACK, aucun résultat présenté comme valide.

Après `free`, `sbrk(0)` ne redescend pas nécessairement. L'allocateur peut garder une arène haute mais libre pour une prochaine allocation. Une valeur `sbrk` haute n'est donc pas une preuve de fuite. Il faut regarder ensemble :

- le tas libre avant et après plusieurs opérations ;
- `mallinfo` (arène, utilisé, libre) ;
- la stabilité au fil des cycles ;
- les gardes et filigranes ;
- l'absence de fragmentation empêchant une allocation de la taille requise.

### 2.4 Pile (`stack`)

La pile contient les variables automatiques, les paramètres, les registres sauvegardés et les adresses de retour. Les cadres des fonctions imbriquées s'additionnent.

Sur la R4 mesurée :

```text
__StackTop   = 0x20007F00
__StackLimit = 0x20007B00
capacité     = 0x400 = 1 024 octets
```

La pile grandit vers les adresses basses. Si elle descend sous `__StackLimit`, elle écrit dans la région haute du tas. Le programme peut continuer à fonctionner tout en ayant corrompu des objets, pointeurs ou métadonnées d'allocation.

Le fait que le tas annonce encore plusieurs kilo-octets libres ne protège pas contre une pile de 1 Kio déjà dépassée.

---

## 3. Mesurer sans se tromper

### 3.1 Analyse statique

`-fstack-usage`, les symboles ELF et le désassemblage donnent une estimation des cadres connus. Cette analyse est utile mais incomplète : appels indirects, bibliothèques précompilées, interruptions et chemins conditionnels peuvent lui échapper.

### 3.2 Filigrane matériel

Le canari peint la zone libre de pile avec un motif, pose un marqueur à la limite, exécute le code puis recherche le premier octet modifié. Il mesure le maximum historique, contrairement à la simple lecture de `SP`, qui ne montre que la position actuelle.

Le rapport lui-même peut consommer de la pile. `printf` / `vsnprintf`, la conversion des nombres et l'USB série peuvent ajouter plusieurs centaines d'octets. Les points de contrôle doivent donc être :

1. silencieux immédiatement après l'opération ;
2. puis séparés du rapport détaillé ;
3. exécutés après disparition des cadres profonds si possible.

### 3.3 Arrêt fatal du canari

À la première corruption, le firmware de canari doit se verrouiller : aucun nouveau pull, vote, ACK ou affichage. Continuer après une corruption rend les observations suivantes non fiables et peut modifier l'état distant.

### 3.4 Statuts de preuve

Toujours séparer :

- **référence logicielle** : algorithme attendu ;
- **test hôte** : logique exécutée sur PC ;
- **compilé** : le sketch passe l'outil Arduino ;
- **analyse statique** : estimation de pile ou de symboles ;
- **mesuré sur carte** : résultat réel du canari ;
- **validé sur écran** : orientation, couleurs, BUSY, watchdog et affichage observés.

---

## 4. Incident Ed25519 sur UNO R4 WiFi

L'analyse ELF de Crypto 0.4.0 a trouvé environ :

| Opération | Cadre statique observé |
|---|---:|
| `derivePublicKey` | 1 004 o |
| `sign` | 1 148 o |
| `verify` | 1 364 o |

Ces opérations ne peuvent pas tenir de façon sûre sur une pile principale de 1 024 octets, surtout avec l'appelant et les interruptions.

### 4.1 Correction `PodEd`

`PodEd` :

- alloue 2 304 o au tas ;
- réserve une garde basse de 64 o ;
- peint la pile temporaire ;
- déplace `SP` par un trampoline Thumb de huit instructions ;
- exécute Ed25519 ;
- restaure l'ancien `SP` ;
- mesure profondeur et marge ;
- efface le bloc avant `free` ;
- met la sortie à zéro et retourne une erreur si l'opération n'est pas saine.

Les interruptions utilisent la pile désignée par `SP` au moment où elles surviennent. Leur consommation est donc incluse dans le filigrane de la pile dédiée.

### 4.2 Résultat matériel

Sur quatre cycles :

```text
sign   : 1 316 o utilisés, 924 o de marge
verify : 1 532 o utilisés, 708 o de marge
pile principale : intacte
haut du tas      : intact
vecteur RFC 8032 : identique
```

Ce mécanisme est validé sur cette carte et ce build. Toute transposition doit recompiler et refaire le canari.

---

## 5. Incident TLS / WiFiS3 sur UNO R4 WiFi

Après correction d'Ed25519, le canari a isolé un second dépassement pendant la connexion TLS :

```text
avant doRegister      : 864 / 1 024 o, marge 160 o
après connect/TLS     : profondeur réelle 1 480 o
dépassement           : 1 480 - 1 024 = 456 o
sbrk → limite de pile : encore 5 160 o
```

Le tas normal n'avait donc pas atteint la sentinelle. La chaîne d'appel réseau avait réellement écrit sous `__StackLimit`.

Conclusion exacte : le défaut est établi pour l'architecture d'appel PoD. Il n'est pas encore démontré par un sketch officiel minimal isolant WiFiS3.

### 5.1 Correction `PodNet`

La transaction complète doit vivre sur la pile dédiée : connexion, requête, en-têtes, corps et `stop()`. Déplacer seulement `connect()` serait insuffisant, car `available`, `read`, `write` et `stop` réutilisent le modem et le formatage.

Configuration testée :

```text
allocation totale  : 2 048 o
garde               : 64 o
pile utilisable     : 1 984 o
marge minimale      : 128 o
objectif de marge   : 256 o
```

Premier résultat matériel :

```text
utilisé : 1 172 o
marge   : 1 984 - 1 172 = 812 o
erreur  : 0
```

Le gros dépassement TLS est donc déplacé avec une marge confortable.

### 5.2 Problème restant après la transaction — localisation NETSTACK-FIX2

Le premier essai avait ensuite détecté :

```text
pile principale maximale : 1 048 / 1 024 o
dépassement restant       : 24 o
```

NETSTACK-FIX2 a déplacé tout le journal sur une pile dédiée de 1 536 o et ajouté trois points silencieux. Le nouveau canari matériel s'est arrêté au **point A**, immédiatement après `netHttpRaw()` et avant `podCanaryNet`, `Serial`, `logf` ou `freeHeapBytes` :

```text
A: apres la transaction (silencieux)
pile principale maximale : 1 048 / 1 024 o
dépassement               : 24 o
SP au contrôle            : 0x20007C38
sbrk → limite             : 1 924 o
mallinfo                  : arène 6 772, utilisé 2 020, libre 4 752
```

Le verrou fatal a fonctionné avant pull, vote, ACK ou frame. La répétition exacte des 24 octets montre que le journal n'était pas la cause de ce dépassement précis. La pile réseau dédiée reste séparément validée par la mesure précédente (1 172/812, erreur 0), mais son **épilogue** revient sur la pile principale : vérification de garde et de marge, effacement, `free`, puis retours `runSized` → `podNetRun` → `netHttpRaw`. L'une de ces phases, ou leur cumul avec les cadres encore vivants, est désormais le suspect principal. Il faut l'instrumenter sans E/S avant de choisir une architecture.

Avant toute frame, le prochain lot doit distinguer, toujours sans E/S :

1. juste après le retour du trampoline, avant contrôle de garde ;
2. après mesure garde / filigrane ;
3. après effacement ;
4. après `free` ;
5. après retour de `runSized`, de `podNetRun` et de `netHttpRaw`.

Une solution ne doit pas être choisie avant cette localisation. Options à étudier ensuite : déplacer l'épilogue vers un point de pile principale moins profond, différer la libération jusqu'au retour dans `setup` / `loop`, ou employer une arène de pile auxiliaire réutilisable. Il ne faut jamais libérer le bloc qui porte le `SP` courant.

Le critère n'est pas « seulement 24 octets ». Le critère est **zéro octet sous la limite**, avec au moins 128 o de marge et idéalement 256 o sur les chemins durables.

### 5.3 Sémantique d'échec à documenter honnêtement

- `NOMEM` / `NESTED` avant l'appel : la transaction n'a pas démarré.
- `GUARD` / `MARGIN` détecté après l'appel : la transaction a réellement pu atteindre le serveur ; seul son résultat local est rejeté.
- Pour un écran TFT écrit en flux, une erreur tardive peut laisser un affichage partiel.
- Un ACK ou un vote envoyé avant la détection tardive a pu être reçu. Il ne faut jamais journaliser « aucune action distante » sans cette distinction.

---

## 6. Une œuvre fixe est-elle bornée ?

Oui, parce que le type d'écran fixe la géométrie et le nombre exact d'octets :

| Écran | Géométrie logique | Octets bruts attendus |
|---|---:|---:|
| OLED 0,96 | 128×64, 1 bit | 1 024 o |
| e-ink 2,7 BW | 176×264, 1 bit | 5 808 o |
| e-ink 2,9 BWR | 128×296, 2 plans | 9 472 o |
| TFT 1,8 | 128×160, RGB565 | 40 960 o |
| TFT 2,8 | 240×320, RGB565 | 153 600 o |

Une œuvre de dimensions arbitraires n'entre pas dans ce calcul : elle est convertie côté serveur vers un profil connu ou refusée.

### 6.1 Métriques `pod-metrics-2`

Le calcul parcourt chaque pixel dans un ordre figé et produit quatre entiers en parties par million :

- `E` : entropie à partir de la proportion de pixels actifs, via une table entière ;
- `T` : transitions horizontales et verticales ;
- `R` : mesure liée au nombre de runs ;
- `S` : score composite.

Formules principales :

```text
E = tableEntropie(arrondi(1024 × pixelsActifs / pixelsTotaux))
T = arrondi(1 000 000 × transitions / transitionsPossibles)
R = racineEntière(arrondi(10^12 × runs / pixelsTotaux))
S = min(1 000 000, floor((4E + 4T + 2R) / 10))
```

Le calcul n'utilise ni flottant ni logarithme à l'exécution. Il est déterministe et reproductible en TypeScript et C++.

### 6.2 Mémoire en flux

`PodMetrics` utilise des compteurs et une ligne de 240 octets maximum. Certains formats imposent cependant un scratch en raison de leur ordre d'encodage :

- OLED page-major : 1 024 o ;
- e-ink 2,9 BWR, plan noir puis rouge : 4 736 o ;
- e-ink 2,7 et TFT : pas de scratch complet pour les métriques.

Le SHA-256 brut et le hash salé sont alimentés avec les mêmes fragments. La mémoire reste bornée par les tampons du profil, pas par une taille déclarée par l'utilisateur.

### 6.3 Coût temporel

Le coût est linéaire dans le nombre de pixels du profil : `O(pixels)`. Un TFT 2,8 pouces nécessite beaucoup plus de travail et de réseau qu'un OLED, mais pas un tableau supplémentaire de 153 600 octets pour les métriques si le flux est correctement utilisé.

---

## 7. Une animation est-elle bornée ?

Oui. Le consensus animation v3 accepte uniquement le format PBC1 suivant :

```text
dimensions          : 128×64
profondeur          : 1 bit par pixel
taille d'une image  : 1 024 octets
nombre d'images     : 2 à 64
taille du clip      : ≤ 9 216 octets
délai par image     : 20 à 2 550 ms
durée d'un tour     : ≤ 120 s
loops v3            : 0, boucle pilotée par le lecteur
couleurs            : fg != bg
retour final        : doit reconstruire exactement l'image 0
CRC32               : obligatoire
```

Le format général de l'atelier accepte historiquement un cas à une image, mais le consensus v3 exige au moins deux images.

### 7.1 Compression et mémoire réelle

La première image est complète. Les suivantes sont décrites par des runs de différences. Le clip décompressé conceptuel peut représenter :

```text
64 × 1 024 = 65 536 octets d'images
```

Mais l'appareil ne conserve jamais ces 65 536 octets. Il garde seulement :

- l'image courante : 1 024 o ;
- une ligne / les compteurs de métriques : environ 272 o ;
- au plus sept hashes Merkle : 7 × 32 = 224 o ;
- les contextes SHA-256 ;
- les petits en-têtes et résultats.

Mesures compilées de `PodAnimStream` :

```text
ESP8266 : 1 944 o
UNO R4  : 1 960 o
```

Avec le hash salé, le résultat et un fragment de lecture, l'intégration réelle est estimée autour de 2,6–2,9 Ko selon la plateforme et les objets simultanément vivants.

### 7.2 Travail maximal effectué

Pour chaque image, le validateur :

1. reconstruit l'image courante ;
2. SHA-256 les 1 024 octets ;
3. examine 128×64 = 8 192 pixels ;
4. calcule `e_i`, `t_i`, `r_i`, `s_i` ;
5. crée une feuille Merkle ;
6. ajoute cette feuille à l'accumulateur.

À 64 images, le cœur examine au maximum :

```text
64 × 8 192 = 524 288 pixels
64 × 1 024 = 65 536 octets pour les hashes d'images
jusqu'à 9 216 octets de clip pour clipHash, CRC et décodage
```

La mémoire reste presque constante, mais le temps est approximativement `O(tailleClip + nombreImages × 8 192)`.

Les sommes restent sûres en `uint32_t` : chaque métrique est ≤ 1 000 000 et `64 × 1 000 000 = 64 000 000`, très inférieur à `2^32 - 1`.

### 7.3 Agrégats et engagement cryptographique

```text
E = floor(somme(e_i) / N)
T = floor(somme(t_i) / N)
R = floor(somme(r_i) / N)
S = floor(somme(s_i) / N)
```

Chaque feuille engage :

```text
frameHash_i, e_i, t_i, r_i, délai_i
```

`framesRoot` est la racine Merkle des feuilles. `animRoot` engage :

```text
clipHash, framesRoot, N, loops, fg, bg
```

Changer un octet, un délai, une couleur, l'ordre des images ou leur contenu modifie les engagements.

### 7.4 Watchdog et granularité

Une mémoire bornée ne garantit pas que le watchdog sera nourri assez souvent. La fin d'une image déclenche un scan synchrone de 8 192 pixels. Un appel `update()` portant un gros fragment peut également enchaîner beaucoup de travail avant de rendre la main.

L'appelant doit donc :

- lire par fragments bornés ;
- rendre la main entre les fragments (`yield` sur ESP8266) ;
- tester le pire cas de 64 images identiques ou presque ;
- mesurer le temps réel sur carte ;
- éviter tout calcul simultané avec BearSSL sur ESP8266.

Le lot 6C a démontré la possibilité logicielle de fragmenter à 1, 7, 61 et 256 octets, mais pas encore le temps ni le watchdog sur la carte de production.

### 7.5 Stratégie ESP8266

Après Wi-Fi, BearSSL peut demander environ 35 Ko de tas sur environ 38 Ko disponibles. L'automate d'animation et ses objets ne doivent donc pas rester vivants pendant TLS.

Stratégie retenue :

1. télécharger le clip vers LittleFS pendant TLS ;
2. fermer et détruire la connexion TLS ;
3. allouer l'automate ;
4. relire LittleFS par petits fragments ;
5. calculer ;
6. détruire l'automate ;
7. seulement ensuite rouvrir TLS pour envoyer le vote.

### 7.6 Stratégie UNO R4 WiFi

Le clip peut théoriquement être analysé pendant sa lecture, mais le chantier pile a montré que toute la transaction réseau doit être isolée. Le calcul et la signature ne doivent pas être imbriqués dans `PodNet` :

1. téléchargement réseau sur pile dédiée ;
2. fermeture réseau ;
3. calcul avec objet global / scratch ou stockage temporaire ;
4. signature sur pile `PodEd` ;
5. nouvelle transaction `PodNet` pour le vote.

Le détail final doit respecter la mémoire disponible et être validé par canari.

---

## 8. La signature dépend-elle de la taille du dessin ?

Non, pas directement.

L'appareil lit tous les octets pour calculer leurs hashes et métriques. Ensuite il construit un message canonique court.

Image fixe, ordre de grandeur conseillé : tampon de message ≥ 400 o.

```text
pod-vote-v3|deviceId|candidateId|parentHash|versions|rawHash|saltedHash|E|T|R|verdict|règle|classe
```

Animation, ordre de grandeur conseillé : tampon ≥ 512 o.

```text
pod-vote-v3-anim|deviceId|candidateId|parentHash|versions|clipHash|animRoot|saltedHash|frames|E|T|R|S|verdict|règle|classe
```

Ed25519 signe ce message de quelques centaines d'octets, jamais les 153 600 octets d'un TFT ni les 64 images décompressées. Son coût reste donc borné et presque constant.

La liaison au contenu vient des hashes contenus dans le message. Sous l'hypothèse de sécurité de SHA-256, signer le hash lie la signature aux octets lus sans devoir les remettre à Ed25519.

Attention : la signature prouve que la clé privée de l'appareil a signé ce résumé. Elle ne prouve pas à elle seule que l'écran physique a affiché les pixels ni qu'un humain a personnellement réalisé le dessin.

---

## 9. Que prouve réellement le « Proof-of-Draw » ?

Dans son état visé, un reçu valide prouve que le firmware associé à une clé :

- a reçu un contenu dont il fournit les empreintes ;
- a recalculé des métriques déterministes ;
- a lié le résultat au candidat, au parent de chaîne, aux versions de règles et à son identité ;
- a signé le message canonique ;
- a participé au quorum selon les règles du protocole.

Cela ne prouve pas automatiquement :

- que les pixels ont physiquement changé sur la dalle ;
- que le geste est humain ;
- que le matériel n'est pas compromis ;
- que tous les appareils éligibles ont participé ;
- qu'une œuvre est artistiquement « bonne ».

`renderHash` atteste les octets que le firmware affirme avoir remis au pilote. L'ACK et le rapport de rendu sont utiles pour l'exploitation, mais ne sont pas une preuve optique des pixels visibles.

Le système est donc plus exactement une preuve distribuée de lecture, de recalcul déterministe, de conformité aux règles et de signature, complétée par un protocole d'affichage.

---

## 10. Bornes indispensables à conserver

Pour qu'un algorithme en flux reste sûr, toutes les dimensions suivantes doivent être plafonnées avant usage :

- `Content-Length` ou compteur maximal d'octets ;
- nombre d'images ;
- dimensions et format de pixel ;
- longueur de chaque run ;
- offset + longueur avec calcul sans débordement ;
- nombre de boucles et durée ;
- nombre de validateurs / feuilles Merkle ;
- longueur des identifiants et du message canonique ;
- temps de lecture réseau ;
- nombre de tentatives ;
- taille du stockage temporaire.

Nuance du noyau actuel : `PodAnimStream::step` refuse après 9 216 octets, mais `update(d, len)` transmet d'abord le fragment au SHA-256. L'appelant doit donc lui-même limiter la taille des fragments et ne jamais accepter un corps réseau arbitrairement grand sous prétexte que l'automate finira par le refuser.

---

## 11. Défaillances et comportements sûrs

### Manque de mémoire

- aucun redémarrage en boucle ;
- abstention ;
- pas de signature remplie avec des zéros présentée comme valide ;
- pas de vote ;
- pas d'ACK ;
- journal local borné si la pile le permet.

### Contenu trop grand ou mal formé

- arrêter la consommation au plafond autorisé ;
- fermer la connexion ;
- signer éventuellement un rejet canonique seulement si le protocole le prévoit ;
- ne pas continuer le décodage après l'état `FAILED` sauf consommation réseau strictement nécessaire et bornée.

### Échec d'affichage en flux

- un TFT peut rester partiellement redessiné ;
- un e-ink peut avoir sa RAM de contrôleur partiellement alimentée sans rafraîchissement ;
- un timeout BUSY ne prouve pas que l'écran n'a rien affiché ;
- ne pas envoyer d'ACK de succès ;
- conserver un identifiant idempotent pour que le serveur puisse réessayer sans créer un second vote.

---

## 12. Procédure réutilisable pour un nouveau projet UNO R4 / e-ink

1. Relever les versions : cœur Arduino, bibliothèque Crypto, WiFiS3, firmware du coprocesseur Wi-Fi.
2. Compiler avec `-fstack-usage` et archiver l'ELF.
3. Vérifier la taille réelle de la pile dans le script de lien ; ne jamais supposer que toute la RAM libre est disponible à la pile.
4. Mesurer la RAM statique OFF/ON à l'octet.
5. Éviter les gros tableaux locaux et les appels `printf` sous des cadres profonds.
6. Créer un micro-canari séparé pour chaque brique lourde : cryptographie, TLS, décodage, pilote écran.
7. Peindre la pile principale et ajouter une garde aux piles temporaires.
8. Mesurer au moins : boot, Wi-Fi, clés, crypto, register, trois pulls, téléchargement maximal, calcul maximal, signature, affichage, ACK.
9. Faire les tests sans frame avant la première frame.
10. Tester une seule carte par famille, puis un petit canari, avant tout déploiement général.
11. Ne jamais activer l'OTA avant d'avoir un chemin de récupération et une authentification de firmware démontrés.
12. Conserver les journaux matériels bruts, les commandes de compilation et les tailles d'objets dans le dépôt.

Critères minimaux recommandés :

```text
aucune écriture sous __StackLimit
garde intacte
marge dédiée >= 128 o
objectif de marge >= 256 o
tas stable sur plusieurs cycles
aucun polling accéléré
aucun vote / ACK en cas d'échec local
résultat TypeScript == C++ == carte pour les mêmes vecteurs
```

---

## 13. État PoD au 09/10/2026

| Élément | État |
|---|---|
| Métriques images fixes | référence TS/C++ et intégrations antérieures testées ; chaque firmware doit rester sous canari lors du grand flash |
| Automate animation | référence et hôte validés, compile ESP8266/R4, pas encore intégré et mesuré de bout en bout sur carte de production |
| Rendu en flux | équivalence logicielle établie ; canari matériel interrompu avant frame par les problèmes de pile |
| `PodEd` | validé sur vraie UNO R4 |
| `PodNet` | transaction dédiée mesurée à 1 172/812 ; NETSTACK-FIX2 prouve que les 24 o sous la limite existent déjà au point A, avant tout journal : épilogue / retour à localiser |
| TFT 2,8 R4 | problème distinct : chemin de vote estimé à 964/1 024 o, seulement 60 o de marge ; reste bloqué |
| OTA | architecture à concevoir et prouver ; non livrée |
| Redis / Neon | ces recherches matérielles n'ajoutent aucune commande ni requête ; les plafonds du projet restent immuables |

Ne pas envoyer de frame avec le canari R4 e-ink 2,9 tant que le dépassement post-transaction n'est pas ramené à zéro et que register + trois pulls n'ont pas tenu au moins cinq minutes avec des marges stables.

---

## 14. Documents sources du dépôt

- `docs/NOTE_PILE_TLS_UNO_R4_WIFI_2026_10_09.md`
- `docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md`
- `docs/LOT_8B2B2_BOOTFIX2_2026_10_08.md`
- `docs/LOT_8B2B2_NETSTACK_FIX1_2026_10_09.md`
- `docs/LOT_6C_COMPILATION_ANIMATION_2026_10_07.md`
- `docs/SPEC_PODANIM_V3.md`
- `docs/LOT_8B1_NOYAU_RENDU_FLUX_2026_10_07.md`
- `consensus-pod/src/pod_metrics.h`
- `consensus-pod/src/podAnimV3.h`
- `consensus-pod/src/adapters/podEdStack.h`
- `consensus-pod/src/adapters/podNetStack.h`

## 15. Recherches futures utiles

- reproduire TLS dans un sketch minimal dérivé de `WiFiWebClientSSL`, sans PoD ;
- comparer matériellement les cœurs Renesas 1.5.3 et 1.6.0 ;
- mesurer le temps maximal des 64 images sur ESP8266 et R4 ;
- mesurer le watchdog avec images identiques, quasi identiques et transitions maximales ;
- tester la fragmentation du tas après des centaines de cycles `PodNet` / `PodEd` ;
- mesurer la pile réelle du TFT 2,8 pendant le vote ;
- documenter les limites de récupération OTA et d'anti-retour arrière pour ESP8266 et UNO R4 WiFi ;
- si le sketch TLS minimal reproduit le dépassement, préparer un rapport upstream Arduino avec versions, ELF, adresses et journal brut.
