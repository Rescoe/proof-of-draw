# Cadrage — bornes matérielles des animations et futurs formats variables

Date : 13 octobre 2026

Statut : **orientation et protocole de mesure, sans changement de format**. Les priorités restent le vote/calcul et les mises à jour distantes.

## 1. Ce que le format actuel garantit

PBC1 est un contrat fixe, commun aux OLED, TFT 1,8″ et TFT 2,8″ :

- grille logique monochrome : **128×64** ;
- état d'une image : **1 024 octets** ;
- **1 à 64 images** ;
- clip encodé : **9 216 octets maximum** ;
- animation différentielle, boucle infinie possible ;
- affichage TFT 2,8″ : agrandissement dans une zone centrale 240×120.

Le lecteur en flux conserve toujours environ 2 048 octets de travail, quel que soit le nombre d'images ou la taille du clip. Augmenter le nombre d'images dans les limites PBC1 ne fait donc pas croître proportionnellement la RAM ; cela augmente surtout les lectures SD, la validation, le travail TFT et la durée.

Le canari matériel du 13 octobre valide 12 images et 7 707 octets. Il ne démontre pas encore les deux plafonds contractuels (64 images et 9 216 octets).

## 2. Ce qu'il est utile de borner maintenant

Un lot de mesure séparé, sans vote, doit exercer :

| Cas | Construction | Ce qu'il mesure |
|---|---|---|
| B0 | clip matériel déjà validé : 12 images, 7 707 o | référence |
| B1 | **64 images**, transitions très petites, clip ≤9 216 o | coût du nombre maximal d'images |
| B2 | clip valide aussi proche que possible de **9 216 o**, nombre d'images quelconque | coût de la taille maximale |
| B3 | 64 images au délai minimal autorisé | débit de présentation, retards et images en dépassement |
| B4 | transitions fragmentées en nombreux petits runs, clip proche de 9 216 o | pire coût SD/SPI par image |
| B5 | Reset après B1/B2, reprise depuis SD | persistance et revalidation aux bornes |

Pour chaque cas : temps de téléchargement, temps de validation, temps moyen/maximal par image, retards, marge avant la prochaine tâche réseau, pile principale, piles réseau/SD, tas libre, plus grand bloc, fragmentation, ACK et reprise après Reset.

Critères : aucune erreur, aucun reset, aucune dérive du tas, pile principale ≥128 o, piles dédiées ≥128 o, aucun retard réseau, résultat visuel cohérent. Le test s'arrête au premier échec ; il n'augmente jamais les constantes du protocole.

Ce protocole établit **l'enveloppe matérielle du contrat PBC1 actuel**, pas le maximum absolu du matériel.

## 3. « Taille maximale du dessin » : trois notions distinctes

1. **Frame TFT fixe physique** : 240×320 RGB565 = 153 600 octets. Elle est déjà validée en flux.
2. **Frame logique d'animation PBC1** : 128×64, 1 bit = 1 024 octets. Fixée par le protocole actuel.
3. **Futur canevas canonique** : résolution indépendante de l'écran, à réduire ou adapter selon les capacités. Il n'existe pas encore.

Tester une animation plus grande que 128×64 aujourd'hui nécessiterait un nouveau format et de nouvelles règles de consensus ; ce ne serait plus un simple canari.

## 4. Rôle réel des mises à jour distantes

Une mise à jour distante ne rend pas spontanément le format variable. Elle permettra de distribuer, par profil matériel, un firmware qui sait déjà :

- décoder une nouvelle version de clip ;
- annoncer ses capacités ;
- conserver la compatibilité PBC1 ;
- appliquer les mêmes règles de hash, de métriques et de consensus que le serveur ;
- revenir à une version sûre si l'activation échoue.

Avant toute activation distante, il faudra une OTA signée, progressive, canari par canari, avec version minimale, rollback et matrice par firmware. L'OTA facilite le déploiement ; elle ne supprime ni les limites de RAM, ni celles du processeur, du TFT ou de la SD.

## 5. Futur format variable (nom provisoire PBC2)

Le futur contrat devra versionner au minimum : largeur, hauteur, profondeur/palette, taille d'image, algorithme différentiel, limites de clip, rasterisation et domaine de hash. Chaque appareil annoncera par exemple :

```text
formats = [pbc1, pbc2]
maxLogicalWidth / maxLogicalHeight
maxFrameBytes / maxClipBytes / maxFrames
colorModel
hasSd
playerVersion / rulesVersion
```

Le serveur choisira un format compatible. L'œuvre de consensus devra rester liée à une source canonique ; les variantes d'affichage seront des dérivés vérifiables, pas de nouvelles œuvres implicites.

Une animation plein écran monochrome 240×320 demanderait déjà 9 600 octets pour une seule image non compressée, davantage que le plus grand bloc de tas observé sur la R4. Elle devra donc être traitée en tuiles/lignes depuis la SD, jamais comme un framebuffer alloué en RAM. Le choix d'un compromis de résolution doit venir de mesures, pas d'une simple multiplication du format OLED.

## 6. Ordre retenu

1. finir le petit lot tactile si souhaité ;
2. mesurer B1 à B5 sur le canari actuel, sans modifier PBC1 ;
3. terminer le vote/calcul ;
4. sécuriser et activer les mises à jour distantes ;
5. seulement ensuite spécifier PBC2 et négocier les capacités ;
6. ne jamais utiliser l'OTA pour changer simultanément format, consensus et lecteur sur tout le réseau.
