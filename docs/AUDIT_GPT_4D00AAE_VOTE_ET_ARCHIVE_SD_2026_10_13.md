# Audit GPT du commit `4d00aae` — vote TFT 2,8″ et archive SD

Date : 13 octobre 2026
Statut : **audit documentaire accepté avec corrections obligatoires avant implémentation**.

## Verdict

Le commit est bien documentaire : il ne modifie ni firmware, ni serveur, ni protocole, ni tests. Les mesures statiques, leurs limites et la séparation avec le canari animation sont correctement annoncées.

La chaîne de vote n'est cependant **pas prête pour un flash**. Les bloqueurs R-B1 à R-B3 sont confirmés : marge principale non validée matériellement, absence de harnais de vote de bout en bout et absence de verrou de canari garantissant un seul candidat et une seule tentative.

Le plan V1 à V5 est une bonne base. Aucun lot V1 ne doit commencer avant le verdict matériel du canari animation, conformément à la condition V0.

## Décisions gelées

### D-V1 — environnement du canari de vote

**Backend isolé obligatoire.** Aucun vote de canari sur la production : avec un quorum à un appareil, le test créerait un bloc réel et permanent.

### D-V2 — divergence de hash

**Abstention obligatoire, en canari comme en production.** Une divergence entre le hash annoncé et le hash des octets reçus n'est pas un verdict sur l'œuvre : elle indique que l'appareil n'a pas validé l'identité du contenu (transport tronqué ou altéré, état serveur incohérent, mauvais candidat). Il ne dispose donc pas du message canonique qu'il prétendrait voter.

Un `reject` signé reste correct uniquement après établissement de l'identité du contenu : lecture complète, absence de défaut collant, taille exacte et hash égal à celui annoncé, puis échec d'une règle déterministe portant sur ce contenu (uniformité, bruit ou autre règle versionnée).

Les scénarios S3 et R-H5 doivent être corrigés en conséquence avant V1/V2.

### D-V3 — tampon statique de vote

- **Canari épinglé `tft28` :** aucun scratch de 4 736 octets ; ce format se vérifie en flux sans ce tampon.
- **Production actuelle :** conserver provisoirement le tampon statique tant que les appareils doivent pouvoir vérifier des candidats OLED et e-ink 2,9″. Une allocation dynamique avant la lecture chevaucherait la transaction réseau et serait sensible à la fragmentation.
- Toute suppression permanente doit être précédée d'une décision explicite limitant les types d'écran que ce validateur accepte, ou d'une nouvelle stratégie mémoire mesurée.

### D-V4 et D-V5

La vérification locale de la signature est souhaitable dans le canari uniquement. La réinscription est interdite dans le canari ; en production elle doit être bornée et séparée du vote.

Le verrou EEPROM « dépensé avant envoi » garantit **au plus une tentative** pour le canari. Il ne doit pas être présenté comme la politique de production : en cas de panne avant remise au serveur, il sacrifie volontairement le vote. Une éventuelle reprise de production devra s'appuyer sur l'idempotence serveur par `deviceId + candidateId` et sur un état distinguant `NOT_SENT`, `SENT_UNKNOWN` et `ACCEPTED`.

## Corrections nécessaires dans la spécification SD avant S0

1. Le format d'en-tête décrit aux offsets 0–48 ne contient aucun champ `état`, alors que la procédure d'écriture demande un état `0xFF`. Soit ce champ est ajouté et couvert par le CRC, soit toute notion d'état est supprimée et seule la présence d'un enregistrement `PUB` valide publie l'objet.
2. Les collisions des noms tronqués 8.3 doivent être résolues **avant toute ouverture en écriture**, en lisant le hash complet des fichiers existants. Il faut préciser les effets exacts de `FILE_WRITE` (création, ajout, absence de troncature) afin qu'un nouvel objet ne puisse jamais être ajouté à un fichier légitime ou corrompu.
3. Un chaînage de manifestes et un `HEAD` A/B détectent une rupture interne, mais pas le remplacement cohérent de toute la carte par une ancienne copie. La détection d'un retour arrière complet exige une ancre extérieure plus récente (serveur, EEPROM monotone, checkpoint connu d'un autre nœud). La promesse de détection doit être reformulée.
4. Un manifeste signé par la clé de l'appareil n'est vérifiable hors ligne que si la liaison entre cette clé, l'appareil et son époque est elle-même ancrée dans une preuve externe fiable. Un objet `KEY` provenant de la même SD ne suffit pas seul.
5. Plusieurs archives locales ne deviennent pas automatiquement une preuve de réplication : tant que leurs inventaires ou manifestes ne sont pas publiés ou comparés par un mécanisme défini, elles constituent seulement des copies indépendantes convergeant vers les mêmes hash.
6. Les estimations `Redis/Neon = 0` sont des objectifs d'architecture, pas une propriété acquise. Chaque future route devra démontrer son stockage d'origine, sa politique CDN et son coût réel avant d'être qualifiée de statique.

## Séquence autorisée

1. Finir et archiver le canari matériel animation (`V0`).
2. Corriger les formulations D-V2 dans l'audit documentaire.
3. Implémenter seulement V1 (harnais du code actuel), puis arrêt pour audit.
4. V2, V3 et V4 restent trois commits séparés avec audit entre chacun.
5. Aucun canari de vote tant que le backend isolé, le candidat épinglé et l'arrêt après une tentative ne sont pas démontrés.
6. L'archive SD reste un chantier séparé ; commencer par S0/S1 après correction des six points ci-dessus, sans la mélanger au vote.

## Conclusion

Le commit `4d00aae` fournit une cartographie utile et honnête. Il est **accepté comme rapport de recherche**, mais ne constitue ni un feu vert pour le vote matériel ni une spécification SD gelée. Le prochain événement décisif reste le résultat du canari animation sur la carte.
