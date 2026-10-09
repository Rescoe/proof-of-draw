# Correctif demandé — NETSTACK-FIX3 : localiser les 24 octets dans l'épilogue / retour de PodNet

## Statut

- NETSTACK-FIX2 : commit local `66d5b9d`, non poussé au moment du canari.
- Carte : UNO R4 WiFi + e-ink 2,9 pouces BWR.
- Build local : `POD_RENDER_V1=1`, `POD_CANARY=1` ; valeurs du commit : 0/0.
- Aucun dessin, vote, ACK ou affichage de frame pendant l'essai.
- Verdict GPT sur FIX2 : architecture cohérente et pile réseau déjà validée, mais canari FIX2 rouge au point A ; aucune frame autorisée.

## Fait matériel nouveau

Le point silencieux A s'exécute immédiatement après `netHttpRaw()`, avant `podCanaryNet`, `Serial`, `logf` et `freeHeapBytes`. Il détecte déjà le dépassement :

```text
[CANARY] 6a avant doRegister : pile utilisee au plus 864 o / 1024 (marge 160 o)
[CANARY]   A: apres la transaction (silencieux) : ALERTE PILE utilisee au plus 1016 o / 1024 (marge 8 o)
... ecrit sous la limite ou pile max 1048
... marqueur DETRUIT ; longueur peinte INCOHERENTE
... __StackLimit=0x20007B00 __StackTop=0x20007F00
... sbrk(0)=0x2000737C ; sbrk->limite 1924
... mallinfo : arene=6772 utilise=2020 libre=4752
[CANARY] ARRET FATAL ... apres 'A: apres la transaction (silencieux)'
```

Conclusion : **les 24 octets ne viennent pas du rapport PodNet ni du journal HTTP**. L'hypothèse principale de FIX2 est réfutée pour ce dépassement précis. Garder cependant la pile de journal : l'analyse montre qu'elle protège un autre chemin réellement risqué ; ne pas la supprimer sans mesure.

La pile réseau dédiée avait été validée au canari précédent : 2 048 o alloués, 1 172 o utilisés, 812 o de marge, erreur 0. Le suspect se déplace vers ce qui s'exécute après le retour du trampoline sur la pile principale : contrôle de garde et de filigrane, effacement, `free`, ou cumul des cadres de retour `runSized` → `podNetRun` → `netHttpRaw`.

## Tâche FIX3

### 1. Instrumenter sans journal et sans repeindre

Trouver la première phase qui détruit le marqueur. Aucun `Serial`, `logf`, `malloc`, `freeHeapBytes`, `mallinfo`, `String` ou autre bibliothèque dans les sondes. Stocker seulement un petit numéro de première phase fautive dans `PodNetInfo::pad` ou dans un objet de l'appelant déjà vivant.

Points demandés :

1. juste après `podNetCallOnStack`, avant scan de garde ;
2. après le scan garde / filigrane ;
3. après le calcul de marge ;
4. après `wipe` ;
5. après `free` ;
6. au retour de `runSized` ;
7. au retour de `podNetRun` ;
8. au retour de `netHttpRaw` (point A existant).

La sonde doit lire uniquement les mots canaris déjà posés et mémoriser la **première** phase fautive. Elle ne doit pas ajouter une profondeur significative. Le diagnostic est imprimé seulement après détection, sur la pile de journal, puis verrou fatal.

### 2. Analyser l'ELF

Archiver les cadres et chaînes pour :

- `PodNet::runSized` après le trampoline ;
- scan de garde / boucle de filigrane ;
- `podnetimpl::wipe` ;
- `free` et ses appels ;
- wrappers template `podNetRun`, `netHttpRaw`, `httpCall` ;
- cadres cumulés `setup → doRegister → httpCall → netHttpRaw → podNetRun → runSized`.

Compiler avec les cœurs Renesas 1.5.3 et 1.6.0.

### 3. Ne choisir la correction qu'après localisation

Solutions possibles à comparer, sans en imposer une avant preuve :

- exécuter l'épilogue à un niveau où la pile principale est moins profonde ;
- différer effacement / libération jusqu'au retour dans `setup` ou `loop` ;
- arène auxiliaire réutilisable, dimensionnée sur le plus grand besoin et interdite d'imbrication ;
- autre découpage prouvé par l'ELF et le canari.

Contraintes :

- ne jamais `free()` un bloc pendant que `SP` pointe dedans ;
- ne pas augmenter la RAM statique sans budget explicite (marge e-ink 2,9 : 528 o) ;
- conserver garde, filigrane, effacement, marge minimale 128 o et objectif 256 o ;
- conserver l'échec honnête `NOMEM/NESTED` versus `GUARD/MARGIN` ;
- conserver `client.stop()` sur toutes les sorties ;
- ne pas imbriquer PodNet, pile de journal et PodEd ;
- aucun changement serveur, Redis, Neon, ACK, vote, rendu ou OTA ;
- aucun polling accéléré.

### 4. Réserve du journal avant production

Dans le canari, si la sonde de pile de journal retourne `GUARD` ou `MARGIN`, poser un verrou fatal ; continuer après un dépassement de garde n'est pas sûr. En production, distinguer :

- `NOMEM` : ligne abandonnée ;
- `GUARD/MARGIN` : faute mémoire persistante ou arrêt sûr, pas une simple ligne perdue.

### 5. Validation

- tests hôte et contrôles négatifs ;
- TypeScript, ESLint et `git diff --check` ;
- compilations cinq firmwares, deux cœurs ;
- défauts 0/0 dans le commit, 1/1 seulement dans le fichier local du porteur ;
- un commit local séparé, non poussé ;
- **aucun flash par Claude**.

Après audit GPT : refaire uniquement le canari sans frame, register + trois pulls pendant cinq minutes. Exiger zéro écriture sous `__StackLimit`, pile réseau et journal erreur 0, marges ≥ 128 o (objectif 256), tas stable. Une frame restera interdite jusqu'à ce résultat vert.
