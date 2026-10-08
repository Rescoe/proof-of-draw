# Correctif bloquant — pile UNO R4, Ed25519 et reprise du canari rendu v1

| | |
|---|---|
| **Date** | 08/10/2026 |
| **Statut** | **CORRECTIONS REQUISES — ne pas envoyer de frame et ne pas reprendre le canari avant audit GPT** |
| **Matériel observé** | UNO R4 WiFi + e-ink 2,9″ BWR (`r4eink29-1.1`) |
| **Portée** | diagnostic et correction de la pile R4 ; aucun serveur, Redis, Neon, ACK, vote, OTA ou polling supplémentaire |

## 1. Observation matérielle

Le porteur a flashé le build local avec `POD_RENDER_V1=1` et `POD_CANARY=1`, puis a seulement démarré la carte. Aucune nouvelle frame n'a été envoyée et le nouveau rendu n'a pas été exécuté.

Extraits utiles :

```text
[MEM] boot: tas libre 8532 o, pile max ~1024 o
[SELFTEST] Ed25519 signature 177 ms, vérification 274 ms -> OK
[MEM] après Ed25519: tas libre 8532 o, pile max ~1732 o
...
[CANARY] prêt: ALERTE PILE — marqueur de fond écrasé ou absent : la pile principale a touché son extrémité basse → ARRÊT
```

Décision prise : carte immédiatement débranchée ; aucune œuvre envoyée ; aucun ACK de test ; aucun autre firmware flashé.

Au moment de la rédaction, l'arbre contient encore les changements de préparation du canari (`.gitignore`, sketch R4, tests, script et note). Ils appartiennent au lot Claude en cours : **ne pas les supprimer, les écraser ni les remettre à zéro**. Claude termine d'abord ce lot, le commite proprement avec les valeurs par défaut désactivées, puis démarre le présent correctif depuis ce nouveau HEAD.

## 2. Constat technique à traiter comme réel jusqu'à preuve contraire

Le cœur Arduino Renesas UNO R4 1.5.3 réserve :

```text
BSP_CFG_STACK_MAIN_BYTES = 0x400  = 1 024 octets
BSP_CFG_HEAP_BYTES       = 0x2000 = 8 192 octets
```

Le script `variants/UNOWIFIR4/fsp.ld` place `__StackLimit` à `__StackTop - 1024` et désactive la protection de pile dans `arduino_main()`.

La bibliothèque Crypto 0.4.0 utilisée par les firmwares écrit dans `Ed25519.cpp` que ses fonctions publiques demandent beaucoup de pile et recommande **environ 1,5 Kio de pile libre**. `Ed25519::sign()` et `Ed25519::verify()` créent plusieurs objets SHA-512, points de courbe et tableaux de limbs sur la pile.

L'ancien instrument `paintStack()` peint les 2 048 octets **situés sous** `__HeapLimit == __StackLimit`. Il ne mesure donc pas seulement la pile réservée : une valeur `pile max ~1732 o` signifie environ 708 octets écrits sous la limite de la pile, dans la zone de tas. La nouvelle sentinelle placée à `__StackLimit` a été détruite après l'auto-test Ed25519, ce qui concorde avec ce dépassement.

Conclusion provisoire : il s'agit vraisemblablement d'un **dépassement de pile R4 préexistant**, révélé par le canari, et non d'un défaut du rasteriseur. Le rendu v1 n'a pas encore été essayé.

## 3. Périmètre de l'audit Claude

Claude doit auditer tous les appels Ed25519 des firmwares UNO R4, pas seulement l'auto-test :

- génération/dérivation de clé ;
- auto-test de démarrage ;
- signature des votes v1/v2/v3 ;
- vérification éventuelle des messages ;
- futurs rapports `pod-render-v1` et manifeste OTA.

Le même risque doit être recherché sur chaque variante R4. Aucun diagnostic n'est extrapolé à l'ESP8266 sans mesure propre.

## 4. Interdits du correctif

Le lot ne doit pas :

- supprimer l'auto-test pour masquer le problème ;
- supprimer ou relâcher l'alerte ;
- considérer le déplacement du seul tableau `sig[64]` comme une correction suffisante ;
- augmenter une constante de mesure sans changer la mémoire réellement réservée ;
- committer `POD_RENDER_V1=1`, `POD_CANARY=1`, un binaire, `secrets.h` ou des identifiants Wi-Fi ;
- modifier le serveur, Redis, Neon, l'ACK, le protocole de vote, l'OTA ou la fréquence de polling ;
- flasher une carte ou envoyer une frame sans nouveau feu vert GPT et accord du porteur.

## 5. Travail demandé

### 5.1 Reproduire et localiser

1. Archiver le journal ci-dessus comme trace du premier canari interrompu.
2. Vérifier dans l'ELF/map les adresses de `__HeapBase`, `__HeapLimit`, `__StackLimit`, `__StackTop`, le SP courant et la taille réellement réservée.
3. Construire un diagnostic temporaire qui repeint et mesure séparément :
   - avant/après `Ed25519::sign()` ;
   - avant/après `Ed25519::verify()` ;
   - avant/après l'auto-test complet ;
   - sans rendu ni réseau dans le micro-test si possible.
4. Produire les cadres `-fstack-usage` de la bibliothèque Crypto elle-même, pas uniquement ceux du sketch.
5. Expliquer explicitement pourquoi la première sonde a perdu son marqueur. Ne pas conclure « faux positif » sans une preuve matérielle et une carte mémoire cohérente.

### 5.2 Concevoir la correction

Comparer au moins ces familles de solutions :

1. implémentation Ed25519 compatible utilisant un **workspace explicite** hors de la pile (statique partagé ou tas contrôlé), sans changer les signatures standard ;
2. adaptation locale et testée de Crypto pour sortir ses gros temporaires de la pile ;
3. nouvelle répartition pile/tas reproductible dans Arduino IDE et `arduino-cli`, uniquement si elle laisse une marge réelle suffisante à toutes les variantes et ne dépend pas d'une modification manuelle du cœur installé.

La solution retenue doit rester portable, reproductible et compatible avec les signatures déjà vérifiées côté serveur. Une modification locale non distribuable du cœur Arduino n'est pas acceptable comme solution finale.

### 5.3 Étendre la preuve à tous les chemins R4

- vecteurs Ed25519 connus : clé, message, signature et vérification identiques à la référence ;
- faux message et fausse signature refusés ;
- signature réelle d'un vote vérifiée par la référence TypeScript/serveur ;
- quatre cycles consécutifs sans dérive de tas ni écrasement de sentinelle ;
- compilation OFF/ON des variantes R4 concernées, RAM statique, flash et pile documentées ;
- chemin stable sans rendu inchangé fonctionnellement ;
- aucun secret dans le diff ou les artefacts suivis.

## 6. Critères de fin du correctif

Le lot est livrable à GPT seulement si :

1. la cause du `~1732 o` et du marqueur détruit est expliquée ;
2. chaque opération Ed25519 tient dans la pile réellement réservée, avec **au moins 128 octets de marge mesurée**, objectif 256 octets ;
3. aucune opération n'écrit sous `__StackLimit` ni dans le tas réservé ;
4. les signatures restent bit-à-bit compatibles avec les vecteurs attendus ;
5. les firmwares R4 compilent, les tests TypeScript/C++ passent et `git diff --check` est propre ;
6. le build par défaut garde `POD_RENDER_V1=0` et `POD_CANARY=0` ;
7. le commit est local et Claude s'arrête avant tout nouveau flash.

## 7. Reprise matérielle après audit GPT

Ordre obligatoire :

1. micro-canari Ed25519 sans écran ni frame ;
2. démarrage complet du R4 e-ink 2,9″, sans frame ;
3. seulement si les deux sont verts, une unique frame personnelle pour tester le rendu v1 ;
4. audit des traces et de la photo ;
5. ensuite seulement canari ESP8266 TFT 1,8″ puis e-ink 2,7″.

Le firmware stable reste le rollback. L'EEPROM, les clés et l'appairage ne doivent pas être effacés.

## 8. Budget et sécurité

- Redis : **+0 commande** pour le correctif et les micro-tests hors réseau ; le futur essai d'une frame utilisera uniquement le flux normal existant, une fois.
- Neon ANA : **0**.
- Aucun nouveau polling, aucun `SCAN`, aucune variable de production.
- Aucun push de binaire contenant les identifiants Wi-Fi.
