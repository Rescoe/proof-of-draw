# Spécification — gestes tactiles pendant une animation sur le TFT 2,8″

Date : 13 octobre 2026

Statut : **proposition UX, documentation seulement**. Le canari `ANIM-STREAM-FIX2` reste validé et inchangé.

## Constat matériel

Le toucher actuel interrompt `playStream`, restaure l'affiche fixe, dessine le cartel et place l'animation en pause. Ce comportement est sûr et a été validé sur la carte, mais il ne permet pas de consulter le cartel tout en laissant l'animation jouer.

Les zones ne se chevauchent pas : l'animation 128×64 agrandie occupe `y=100…219`, le cartel haut `y=0…39` et le cartel bas `y=272…319`. Une coexistence sans recomposition de chaque image est donc possible.

## Interaction souhaitée

| Geste | Animation en lecture | Animation en pause |
|---|---|---|
| appui court, relâché avant 650 ms | affiche/masque le cartel ; l'animation reprend immédiatement | affiche/masque le cartel sans reprendre |
| appui long, maintenu au moins 650 ms | pause sur l'affiche fixe et affiche le cartel | reprend l'animation ; cartel masqué par défaut |
| aucune action pendant 60 s en pause | reprise automatique (comportement de sécurité conservé) | — |

Un geste produit exactement une action. Le relâchement d'un appui long ne doit jamais déclencher ensuite un appui court.

## Architecture recommandée

1. Ajouter un classificateur sans allocation (`NONE`, `SHORT`, `LONG`) commun au lecteur d'animation et à `serviceTouch`.
2. Pendant `playStream`, un contact est chronométré jusqu'au relâchement ou au seuil de 650 ms. L'attente est bornée et continue de respecter le budget avant la prochaine tâche réseau.
3. L'appui court peut interrompre une invocation de `playStream`, fermer proprement le fichier, appliquer le cartel, puis reprendre au tour de `loop` suivant. Un bref redémarrage à l'image 0 est acceptable en v1 ; il doit être mesuré visuellement.
4. Quand le cartel est visible, le démarrage suivant de la lecture ne doit pas appeler `fillScreen` sur les bandes. Il efface seulement la zone centrale, puis l'animation continue dans `y=100…219`.
5. Masquer le cartel restaure les bandes depuis `/pod/frame.bin` avant la reprise plein écran. Tous les accès SD/TFT restent sous `onSd`.
6. L'appui long réutilise le chemin de pause actuel : fermeture du clip, restauration de l'affiche fixe, cartel, `animPaused=true`.
7. Aucun `String`, aucune allocation dynamique, aucune nouvelle variable globale volumineuse et aucune opération réseau dans le gestionnaire de geste.

## Preuves exigées

- harnais hôte : appui court, appui long, seuil exact, relâchement, anti-rebond, absence de double action ;
- animation + cartel : les bandes ne sont jamais réécrites par les images animées quand le cartel est visible ;
- appui long : fichier fermé avant restauration SD ;
- tâches réseau : aucun retard au-delà du budget existant ;
- canari matériel : lecture seule, court afficher, court masquer, long pause, long reprise, reprise automatique 60 s, puis plusieurs pulls ;
- marges : pile principale ≥128 o et piles dédiées ≥128 o ; tas stable ;
- aucune modification du vote, du serveur, du protocole, de Redis, Neon ou de l'OTA.

## Lot proposé

`LOT8B2E-ANIM-TOUCH-GESTURES-1`, sur une branche séparée issue du verdict matériel `a88d582`. Un commit fonctionnel, audit GPT, puis un canari tactile court sur la même carte. Ne pas mélanger ce lot avec V1 (harnais de vote) ni avec l'archive SD distribuée.
