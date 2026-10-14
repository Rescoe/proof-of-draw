# Cadrage — carte SD comme nœud d'archive Proof-of-Draw

**Statut : idée structurée, aucune implémentation autorisée dans le canari `480eacd`.**

## Intention

Les cartes TFT munies d'une SD peuvent conserver davantage qu'un cache d'affichage : œuvres, animations, métadonnées, blocs et preuves nécessaires à une vérification ultérieure. La SD devient un support de réplication et de conservation, jamais une autorité par elle-même.

## Principes

- objet adressé par son hash de contenu ;
- format versionné et vérifiable hors ligne ;
- écriture dans un fichier temporaire ou directement sous un nom immuable par hash ;
- validation complète avant publication d'un manifeste ;
- reprise après coupure sans objet « à moitié valide » visible ;
- vérification périodique et réparation depuis une autre réplique ;
- politiques de capacité et d'éviction explicites ;
- aucune clé privée sur la SD.

## Rôles proposés

| Rôle | Contenu minimal |
|---|---|
| nœud léger | derniers en-têtes/blocs, œuvres affichées, preuves courantes |
| nœud conservateur | fenêtre longue de blocs et objets artistiques associés |
| nœud archive | historique complet disponible, checkpoints et inventaire des objets |

Le rôle doit être déclaré par l'appareil et contrôlé par sa capacité réelle. Une carte absente, pleine ou corrompue ne doit jamais empêcher le firmware d'échouer proprement.

## Preuves à conserver

- contenu brut ou format canonique de l'œuvre/animation ;
- `contentHash`, `artworkHash`, `frameHash` et `renderHash` quand ils existent ;
- identifiant de bloc, lien au bloc précédent et version des règles ;
- certificats de finalisation et votes signés si le protocole les expose ;
- clés publiques et rotations par époque ;
- manifeste d'inventaire signé ou haché ;
- provenance déclarée et horodatages, sans les confondre avec une preuve de vérité physique.

## Organisation indicative

```text
/pod/
  v1/
    genesis/
    blocks/
    checkpoints/
    objects/sha256/ab/cd/<hash>
    manifests/
    quarantine/
```

Cette arborescence n'est pas encore un contrat. Les limites de taille, l'encodage, la stratégie de checkpoint et le format de manifeste doivent être spécifiés et testés avant code.

## Ce que `480eacd` apporte déjà

- réception réseau directement vers la SD ;
- relecture en flux avec mémoire bornée ;
- validation avant création du marqueur actif ;
- gestion des erreurs de lecture et d'écriture.

Il ne fournit pas encore : objets immuables par hash, réplication entre nœuds, inventaire, checkpoints, preuve de possession, synchronisation, réparation, quota ou éviction.

## Ordre recommandé

1. valider matériellement l'animation en flux ;
2. écrire la spécification du format et des invariants ;
3. créer des vecteurs et un lecteur hors ligne ;
4. implémenter l'écriture atomique locale ;
5. ajouter l'inventaire et les contrôles de capacité ;
6. seulement ensuite concevoir la réplication réseau et son budget serveur.
