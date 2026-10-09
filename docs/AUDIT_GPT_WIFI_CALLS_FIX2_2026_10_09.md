# Audit GPT — NETSTACK-WIFI-CALLS-FIX2

| Champ | Valeur |
|---|---|
| Date | 09/10/2026 |
| Commit audité | `cf276b5` |
| Base | `297251d` |
| Verdict initial | **ACCEPTÉ SOUS RÉSERVE — canari sans frame autorisé** |
| Résultat matériel | **Canari exécuté ; opérations principales saines ; correction étroite de l'instrument requise avant frame** |
| Push / déploiement | Non requis pour le canari local ; aucun déploiement autorisé |
| Redis / Neon | Redis +0 commande ; Neon 0 |

## 1. Verdict

Le correctif répond aux deux demandes bloquantes de l'audit précédent :

1. la peinture historique `0xA5` située sous `__StackLimit` ne peut plus déclencher un faux verrou ;
2. une erreur `POD_NET_GUARD` arrête le firmware silencieusement avant tout appel à `logf`.

La logique de sécurité utile reste active : marqueur ou longueur invalides, SP hors pile et marge principale inférieure à 128 octets restent fatals. Une marge comprise entre 128 et 255 octets est visible comme « sous l'objectif 256 » sans être présentée comme un débordement.

Le canari local sur UNO R4 + e-ink 2,9 pouces peut donc être reflashé **sans envoyer de dessin**, pour une observation d'au moins trois pulls pendant environ cinq minutes.

## 1 bis. Résultat du canari matériel de `cf276b5`

Le canari a franchi le boot, Ed25519, l'inscription et la première transaction du pull. Résultats :

| Chemin | Utilisé / marge | Erreur | Verdict |
|---|---:|---:|---|
| Wi-Fi `status` | 608 / 864 o | 0 | OK |
| Wi-Fi `firmwareVersion` | 448 / 1 024 o | 0 | OK |
| Wi-Fi `begin` | 536 / 936 o | 0 | OK |
| Wi-Fi `localIP` | 568 / 904 o | 0 | OK |
| Wi-Fi `macAddress` | 520 / 952 o | 0 | OK |
| Ed25519 `sign` | 1 316 / 924 o | 0 | OK |
| Ed25519 `verify` | 1 532 / 708 o | 0 | OK |
| PodNet inscription | 1 140 / 844 o | 0 | OK, HTTP 200 |
| PodNet premier pull | 1 136 / 848 o | 0 | OK |

La pile principale est restée à 144 octets de marge après `doRegister`. Le point silencieux A, exécuté immédiatement après la transaction du pull et avant tout rapport, est passé. Le verrou est apparu au point B :

```text
[CANARY] B: apres le rapport PodNet : 900 / 1024 o, marge 124 o
marqueur et longueur intacts
```

Ce n'est ni un débordement, ni une faute de PodNet : la marge passe de 144 à 124 octets lorsque `podCanaryCheck()` est appelé **depuis l'intérieur de `podCanaryNet()`**, alors que le cadre de ce dernier est encore vivant. L'instrument superpose son propre cadre de contrôle au cadre du rapport qu'il vient de mesurer. Le point A prouve que le retour de la transaction elle-même reste au-dessus du minimum.

Correctif étroit requis :

1. retirer `podCanaryCheck("  B: apres le rapport PodNet (silencieux)", false)` du corps de `podCanaryNet()` ;
2. appeler le contrôle B chez chaque appelant, immédiatement **après le retour complet** de `podCanaryNet()` ;
3. couvrir `http`, `pull-frame` et `candidate-frame` ;
4. modifier les tests pour interdire tout `podCanaryCheck` imbriqué dans `podCanaryNet` ;
5. conserver A avant le rapport et C après le `logf` HTTP afin de distinguer transaction, rapport canari et journal de production ;
6. recompiler et refaire un canari sans frame. Aucune frame n'est autorisée avant que B et C passent et que trois pulls soient observés.

Cette correction ne doit changer ni le code de production lorsque `POD_CANARY=0`, ni Redis, Neon, les protocoles ou les tailles des piles dédiées.

## 2. Vérifications indépendantes GPT

Exécutées dans un clone propre de `cf276b5` :

- `tests/wifiCalls.test.ts` ;
- `tests/netStack.test.ts` ;
- `tests/canaryPrep.test.ts` ;
- `tests/canaryBootFix2.test.ts` ;
- `npx tsc --noEmit`.

Résultat : **55 tests sur 55 passent**, TypeScript propre. `git diff --check 297251d..cf276b5` est propre.

Les résultats de compilation des deux cœurs et la suite complète de 703 tests sont cohérents avec les preuves archivées par le lot. GPT n'a pas reflasher la carte et ne présente pas ces compilations comme une nouvelle preuve matérielle.

## 3. Réserve non bloquante

Un commentaire du canari dit encore :

```text
Toute ANOMALIE (... écriture sous __StackLimit ...) ... POSE UN VERROU FATAL
```

Cette formulation est désormais obsolète : la zone historique `0xA5` située sous la limite n'est plus un critère fatal, car elle appartient au futur espace du tas et peut être utilisée légitimement par les piles temporaires. Le code et les tests sont corrects ; seul ce commentaire doit être amendé dans le prochain commit documentaire pour citer exactement les quatre critères réels.

Cette réserve ne justifie pas un nouveau cycle de compilation avant le canari si aucun code n'est changé.

## 4. Marge principale

La marge matérielle connue de `doRegister` reste :

```text
880 / 1024 octets utilisés
144 octets libres
```

- seuil fatal : 128 octets ;
- marge observée au-dessus du seuil : 16 octets ;
- objectif de confort : 256 octets.

Cette valeur permet le canari surveillé, pas une activation générale. Le prochain essai doit vérifier qu'elle ne descend pas sous 128 pendant les pulls. Une optimisation de `doRegister` reste à planifier avant la production si la marge ne peut pas être portée plus haut.

## 5. Protocole autorisé maintenant

1. Utiliser uniquement `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` avec les deux drapeaux locaux à `1`.
2. Ouvrir le moniteur série à 115200.
3. Ne créer ni envoyer aucune nouvelle frame.
4. Laisser passer l'inscription et au moins trois pulls, environ cinq minutes.
5. Copier l'intégralité du journal, depuis `[BOOT]` jusqu'après le troisième pull.
6. Arrêter immédiatement si :
   - une marge dédiée descend sous 256 octets ;
   - la marge principale descend sous 128 octets ;
   - le marqueur ou sa longueur devient invalide ;
   - une erreur de pile n'est plus zéro ;
   - une phase PodNet ou Wi-Fi fautive apparaît ;
   - le tas libre décroît à chaque cycle.
7. Si les trois pulls sont stables, demander le verdict GPT avant d'envoyer une unique frame personnelle.

## 6. Interdictions inchangées

- aucun flash TFT 2,8 pouces, toujours bloqué à 60 octets de marge statique au vote ;
- aucune activation générale de `POD_RENDER_V1` ;
- aucun push requis pour tester le build local ;
- aucun déploiement, OTA, secret ou variable de production ;
- aucun polling accéléré ;
- aucune commande Redis ou requête Neon supplémentaire ;
- aucun commit avec les drapeaux à `1`, un binaire de canari ou `secrets.h`.

## 7. Archivage matériel

L'extrait série brut transmis dans le fil GPT est maintenant conservé dans :

`docs/mesures/8B2B2_NETSTACK_WIFI_CALLS_FIX2_2026_10_09/journal-wifi-calls-fix1-materiel.txt`

Il commence à la première ligne Wi-Fi reçue et non au tout début du boot ; cette limite est explicitement inscrite dans le fichier. Aucun contenu absent n'a été reconstitué.
