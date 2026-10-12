# Audit GPT préliminaire — `480eacd` — animation TFT 2,8″ en flux

## Verdict

**GO pour un canari matériel sans vote, avec réserves.**

Ce verdict n'autorise ni fusion dans `main`, ni déploiement, ni propagation. Le lot résout de façon crédible le défaut observé — allocation impossible du clip entier — mais les piles dédiées, le débit SD et la cohabitation SD/TFT/tactile doivent encore être mesurés sur la carte réelle.

## Points jugés solides

1. Le téléchargement ne conserve plus le clip entier en RAM : il l'écrit sur la SD par morceaux de 480 octets.
2. La validation relit la SD et reproduit les codes de la référence en RAM : en-tête, taille, CRC, structure, bornes et retour final à l'image initiale.
3. La lecture emploie un tampon fixe de 2 048 octets, indépendant de la taille du clip.
4. Les données nécessaires à un lot de runs sont chargées avant `tft.startWrite()` ; aucune lecture SD n'a lieu pendant la transaction TFT.
5. Un échec de réseau, de SD, de validation ou de lecture ne produit ni faux succès ni animation publiée comme valide.
6. Le canari reste sans vote et les drapeaux sont à `0/0` dans le commit.
7. Les tests statiques locaux de structure, périmètre, JSON, piles dédiées, ACK et canari passent. Les compilations Arduino 1.5.3 et 1.6.0 et les harnais complets ont été archivés par l'auteur du lot.

## Réserves non bloquantes pour le canari

### Remplacement du clip

Le lot supprime d'abord le marqueur et le clip final, puis écrit le nouveau clip sous son nom final, le valide et recrée le marqueur en dernier. Un téléchargement incomplet reste donc inactif, ce qui est sûr, mais l'ancien clip valide n'est pas conservé jusqu'à la publication du nouveau.

Ce comportement est acceptable pour le canari. Le futur stockage d'objets adressés par hash devra employer un nom temporaire ou un nom immuable par hash, puis publier un manifeste en dernier.

### Mutation entre validation et lecture

La validation est immédiatement suivie de la lecture, mais `playStream` ne scelle pas cryptographiquement le fichier ouvert contre une mutation physique postérieure. Une carte altérée peut provoquer un arrêt `PLAY_IO` ou une image partiellement repeinte avant l'échec. Le code ne prétend pas le contraire. Pour une archive durable, il faudra une vérification périodique et des objets immuables par hash.

### Mesures hôte locales de cette reprise

Les tests TypeScript statiques propres au lot passent. Les harnais C++ dynamiques n'ont pas pu être recompilés dans cette session locale : le compilateur Windows disponible est MSYS2 g++ 10.2, tandis que les tests du lot demandent la chaîne g++ récente utilisée par Claude et échouent sans diagnostic lors de la création des exécutables temporaires. Ce n'est pas une régression du code et cela ne remplace pas les résultats archivés du lot ; Claude doit rétablir ou déclarer explicitement sa toolchain avant de modifier le code.

## Protocole matériel autorisé

1. Compiler localement le sketch TFT 2,8″ avec `POD_CANARY=1`, sans vote ; ne pas commiter le changement de drapeau.
2. Conserver la SD actuelle et démarrer : l'ancien clip résident doit être trouvé et joué sans message « mémoire insuffisante ».
3. Observer deux minutes : fluidité, couleurs, absence de reset et de corruption.
4. Tester toucher → pause/cartel, puis toucher → reprise.
5. Relever les lignes de pile `animValidate`, `animPlay` et `block-clip`, le tas et le plus grand bloc.
6. Envoyer une seule animation personnelle déjà finalisée ; ne pas soumettre de dessin au consensus.
7. Vérifier téléchargement, validation, marqueur publié, lecture, puis redémarrer la carte et vérifier la reprise depuis la SD.
8. Laisser plusieurs pulls au repos pour vérifier la stabilité.

Arrêt immédiat si : marge de pile < 128 octets, reset, écran corrompu, ACK incohérent, boucle de téléchargement ou erreur répétée de SD.

## Après le canari

- Si vert : archiver le journal brut et le verdict, puis figer une spécification séparée de stockage SD avant toute implémentation d'archive réseau.
- Si rouge : corriger uniquement la phase mesurée en défaut ; ne pas élargir au stockage distribué.
