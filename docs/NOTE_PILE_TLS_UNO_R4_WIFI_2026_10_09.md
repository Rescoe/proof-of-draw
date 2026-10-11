# UNO R4 WiFi : dépassement réel de la pile principale pendant `WiFiSSLClient::connect`

| | |
|---|---|
| **Date** | 09/10/2026 |
| **Contexte** | Canari matériel du rendu v1, firmware PoD UNO R4 WiFi + e-ink 2,9″ |
| **Matériel mesuré** | Arduino UNO R4 WiFi, cœur Renesas 1.5.3, firmware du module Wi-Fi 0.5.2 |
| **Niveau de preuve** | **[H] mesuré sur la carte** pour le firmware PoD ; **[?] non démontré hors PoD** |
| **Impact exploitation** | Défaut préexistant des firmwares PoD R4 empruntant la même chaîne réseau ; aucune frame de test envoyée, canari arrêté avant `loop()` |

## Résumé

Le canari a établi que la chaîne appelée par `doRegister()` déborde réellement la pile principale de l'UNO R4 pendant `WiFiSSLClient::connect`. La pile principale vaut **1 024 octets** ; la profondeur maximale observée vaut **1 480 octets**, soit **456 octets écrits sous `__StackLimit`**, dans la région réservée au haut du tas.

Ce défaut existait avant le rendu v1, le consensus v3 et le chantier OTA. Il restait invisible parce que la zone atteinte était généralement libre. L'instrumentation du canari l'a transformé en arrêt explicite avant toute frame, tout vote ou tout ACK.

Ce constat est une **découverte établie pour PoD**, pas une revendication de découverte mondiale ni, à ce stade, la preuve d'un défaut autonome de la bibliothèque WiFiS3.

## Mesure matérielle déterminante

Avant la première connexion TLS :

```text
[CANARY] 6a avant doRegister : pile utilisee au plus 864 o / 1024 (marge 160 o)
... ecrit sous la limite ou pile max 1024
```

Au retour de `WiFiSSLClient::connect` :

```text
[CANARY] http: apres connect/TLS : ALERTE PILE utilisee au plus 1016 o / 1024 (marge 8 o)
... ecrit sous la limite ou pile max 1480
[CANARY] __StackLimit=0x20007B00 __StackTop=0x20007F00
[CANARY] __HeapBase=0x20005908 sbrk(0)=0x200066D8 SP dans la pile
[CANARY] mallinfo : arene=3536 utilise=1544 libre=1992
[CANARY] ARRET FATAL (verrou) ... plus aucun pull, vote, ACK ni affichage
```

Interprétation :

- profondeur réelle : `1 480 o` ;
- capacité : `1 024 o` ;
- dépassement : `456 o` ;
- `SP` était revenu dans la plage normale au point de contrôle : le dépassement est transitoire mais ses écritures persistent ;
- `sbrk(0)` restait à **5 160 o** de `__HeapLimit` : le tas n'a pas atteint le marqueur ;
- les octets autour de `__StackLimit` ressemblent à des pointeurs/cadres, ce qui concorde avec une descente de pile ;
- le premier point fautif est précisément `apres connect/TLS`, avant l'envoi de la requête HTTP.

## Ce que cette mesure sépare clairement

1. **Ed25519 n'est plus en cause.** Le micro-canari et l'auto-test complet ont validé `PodEd` sur sa pile dédiée : `sign 1316/924`, `verify 1532/708`, erreurs `0/0`, aucune écriture sous `__StackLimit`.
2. **Le rendu v1 n'est pas en cause.** Aucune frame n'a été reçue ou rendue.
3. **Le serveur et les quotas ne sont pas en cause.** Aucun changement Redis ou Neon ; aucun polling accéléré.
4. **Le défaut est antérieur au chantier.** La chaîne register/TLS existait déjà dans le firmware stable.

## Portée exacte de la conclusion

### Fait établi

Dans la structure d'appel du firmware PoD R4 e-ink 2,9″, la connexion TLS dépasse la pile principale de 1 024 octets. Les autres firmwares PoD UNO R4 partageant la même pile et la même chaîne réseau doivent être considérés à risque tant qu'ils ne sont pas corrigés et mesurés.

### Non établi

Il n'est pas encore démontré que l'exemple minimal officiel `WiFiWebClientSSL` déborde à lui seul. Le cumul peut dépendre des cadres PoD (`setup` → `doRegister` → `httpCall` → `Conn::request`) autour de WiFiS3. Une recherche rapide dans les dépôts officiels Arduino n'a pas fait apparaître de ticket décrivant exactement cette mesure ; cette absence n'est pas une preuve d'antériorité.

Sources officielles utiles :

- documentation de `WiFiSSLClient` : <https://github.com/arduino/ArduinoCore-renesas/blob/main/libraries/WiFiS3/docs/api.md> ;
- exemple officiel TLS : <https://github.com/arduino/ArduinoCore-renesas/blob/main/libraries/WiFiS3/examples/WiFiWebClientSSL/WiFiWebClientSSL.ino>.

## Travail de correction PoD

Le lot suivant doit exécuter la transaction réseau synchrone complète sur une pile dédiée mesurée : connexion TLS, envoi, lecture des en-têtes et du corps, puis `stop`. Le mécanisme doit être central afin de couvrir register, pull, téléchargement de frame, ACK et validation.

Contraintes : garde, watermark, marge minimale 128 o (objectif 256 o), restauration certaine de `SP`, effacement avant libération, échec fermé en manque de mémoire, aucun pointeur vers une variable automatique de la pile dédiée après le retour, aucune imbrication avec `PodEd`.

Le premier re-test reste le R4 e-ink 2,9″ sans frame : register puis au moins trois pulls, sans écriture sous `__StackLimit`, sans dérive du tas et avec les marges des deux piles journalisées. Les cinq firmwares R4 devront ensuite compiler et être audités ; le TFT 2,8″ conserve en plus son problème distinct de marge de vote principale (60 o dans l'analyse statique actuelle).

## Reproduction minimale upstream — à faire après stabilisation de PoD

Créer un sketch autonome `WiFiSSLStackProbeUnoR4`, sans code PoD :

1. peindre la pile principale et placer une sentinelle à `__StackLimit` ;
2. `WiFi.begin` ;
3. un unique `WiFiSSLClient.connect` vers un hôte public ;
4. mesurer le point bas, `sbrk(0)`, `mallinfo` et les versions ;
5. répéter avec l'exemple officiel, cœur 1.5.3 puis dernière version disponible ;
6. ne publier un ticket Arduino que si la reproduction minimale confirme le phénomène.

Si le sketch minimal reproduit le dépassement, PoD disposera d'un rapport upstream solide. Sinon, le résultat restera néanmoins une contribution technique utile : budget de pile insuffisant dans l'architecture d'appel PoD sur une cible à pile principale de 1 Kio.
