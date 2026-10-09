# Audit GPT — `e99f77e` et débordement matériel découvert dans `doPull`

| Champ | Valeur |
|---|---|
| Date | 09/10/2026 |
| Commit essayé | `e99f77e` |
| Matériel | UNO R4 WiFi + e-ink 2,9 pouces BWR |
| Build | local, `POD_RENDER_V1=1`, `POD_CANARY=1` |
| Verdict sur le correctif B | **Validé matériellement** |
| Verdict global | **CORRECTIONS REQUISES avant toute frame : débordement réel dans le traitement local de `doPull`** |
| Redis / Neon | Aucun changement ; Redis +0, Neon 0 |

## 1. Ce que le canari valide

Le déplacement du contrôle B hors de `podCanaryNet` fonctionne : le premier HTTP du pull revient, son rapport est imprimé et l'exécution atteint la fin de `doPull`.

Les sous-systèmes isolés restent sains :

- pile Wi-Fi : marges de 864 à 1 024 octets, erreurs 0 ;
- pile de journal : 416 octets utilisés, 1 056 de marge, erreur 0 ;
- Ed25519 : pire marge 708 octets, erreurs 0 ;
- PodNet inscription : 1 136 octets utilisés, 848 de marge ;
- PodNet pull : 1 136 octets utilisés, 848 de marge ;
- inscription HTTP 200 et pull HTTP 200.

Le correctif `e99f77e` n'est donc pas la cause du nouveau défaut : il a supprimé un arrêt instrumental et permis d'observer plus loin le chemin historique de production.

## 2. Nouvelle preuve matérielle

Après la réponse `/api/pull`, le firmware a correctement imprimé :

```text
[PULL] cartel: Chat - pain / Roubzi (bloc 95)
[PULL] nouveau bloc #95
[PULL] aucune frame
```

Au contrôle `7b`, après le retour de `doPull` :

```text
pile principale : 1016 / 1024 octets
marge : 8 octets
marqueur CNRY : détruit
longueur peinte : altérée
```

Cette fois, ce n'est ni la zone indicative `0xA5`, ni une marge seulement sous l'objectif : le marqueur situé dans la pile principale est réellement détruit. Le verrou fatal a correctement empêché toute suite, frame, vote ou ACK.

Le journal affiche `longueur peinte=0x000001A1 (OK)`, mais le boot avait enregistré `0x00000250`. Le suffixe `OK` signifie seulement que la valeur reste dans une plage jugée plausible ; il ne prouve pas qu'elle est intacte. L'instrument de phase doit mémoriser la longueur initiale et exiger son égalité exacte, en plus du marqueur `CNRY`.

## 3. Périmètre de la cause

Le point A placé immédiatement après la transaction HTTP est passé. Les piles dédiées et le réseau ne sont donc pas responsables. La corruption apparaît entre le retour du HTTP et la fin de `doPull`, pendant le traitement local de la réponse.

Le chemin concerné contient notamment :

- le cadre de `doPull` et ses quatre `String` de résultat ;
- `deserializeJson` sur la réponse `/api/pull` ;
- les conversions `JsonVariant` vers `String` ;
- `asciiFold` et l'évaluation des arguments du journal du cartel ;
- la construction éventuelle de l'observation ;
- les écritures EEPROM des hashes ;
- les journaux « nouveau bloc » et « aucune frame ».

Les archives ELF antérieures mesurent le cadre propre de `doPull` à environ 408 octets avec le rendu désactivé et 432 octets avec le rendu activé. Des cadres ArduinoJson de 240–272 octets apparaissent aussi dans les relevés. Ces mesures rendent le résultat matériel plausible, mais ne suffisent pas à désigner l'instruction exacte.

## 4. Prochain lot requis : instrumentation de phases, pas de correction spéculative

Créer un lot étroit `DOPULL-PHASE-AUDIT1`, uniquement pour le canari e-ink 2,9 pouces :

1. enregistrer la première phase où le marqueur diffère de `CNRY` ou la longueur diffère exactement de sa valeur initiale ; ne pas se contenter d'un test de plage ;
2. les sondes dans `doPull` doivent être de simples lectures inline du marqueur et de la longueur : aucune E/S, allocation, `String`, `malloc`, `mallinfo`, `logf` ou appel à `podCanaryCheck` ;
3. stocker uniquement le premier numéro de phase dans un octet compilé exclusivement avec `POD_RENDER_V1 && POD_CANARY` ;
4. rapporter cette phase après le retour de `doPull`, sur la pile de journal, avant le diagnostic fatal ;
5. phases minimales :
   - entrée de `doPull` ;
   - après `httpCall` ;
   - après construction du document JSON ;
   - après `deserializeJson` ;
   - après extraction chaîne/candidat/frame ;
   - après cartel et son journal ;
   - après observation et `ownedBlock` ;
   - après destruction du document JSON et de `resp` ;
   - après mise à jour du bloc et EEPROM ;
   - après le journal « aucune frame », juste avant le retour ;
6. produire une analyse ELF des chaînes d'appels `setup -> doPull` et `loop -> doPull`, incluant ArduinoJson, `asciiFold`, EEPROM et le journal ;
7. ajouter des mutants supprimant ou déplaçant chaque phase ;
8. prouver que le binaire de production avec `POD_CANARY=0` reste inchangé ;
9. ne modifier ni la taille de la pile principale, ni les piles dédiées, ni le serveur ou les protocoles dans ce lot.

Après cette instrumentation, refaire un canari sans frame et s'arrêter au premier verrou. La phase matérielle décidera ensuite entre refactorisation noinline, traitement JSON sur une pile de travail dédiée ou réduction des temporaires.

## 5. Interdictions

- aucune frame avant correction et nouveau canari complet ;
- aucun vote ni ACK après une alerte ;
- aucune augmentation arbitraire d'une pile dédiée sans mesure ;
- ne pas déplacer le traitement JSON dans la transaction TLS : la fermeture réseau avant calcul doit rester vérifiable ;
- aucun changement Redis, Neon, OTA ou polling ;
- TFT 2,8 pouces toujours bloqué.

## 6. Retour arrière

La carte étant verrouillée par le canari, la débrancher. Pour l'utiliser hors diagnostic, reflasher le firmware stable avec `POD_RENDER_V1=0` et `POD_CANARY=0`. Ne pas commiter le binaire ni les secrets du build local.
