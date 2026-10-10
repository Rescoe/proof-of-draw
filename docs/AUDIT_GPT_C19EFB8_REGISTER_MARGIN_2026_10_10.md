# Audit GPT — `c19efb8` : canari arrêté avant `doPull`, marge insuffisante dans `doRegister`

| Champ | Valeur |
|---|---|
| Date | 10/10/2026 |
| Commit flashé | `c19efb8` avec drapeaux locaux `POD_RENDER_V1=1`, `POD_CANARY=1` |
| Matériel | UNO R4 WiFi + e-ink 2,9 pouces BWR |
| Verdict sur l'architecture JSON du pull | **ACCEPTÉE SOUS RÉSERVE : non atteinte sur la carte** |
| Verdict du canari | **CORRECTIONS REQUISES avant tout pull et toute frame** |
| Point d'arrêt | `6b apres doRegister` |
| Redis / Neon | Redis +0, Neon 0 |

## 1. Ce que le journal prouve

Le canari s'arrête après une inscription HTTP 200 et avant le premier appel à `doPull` : le nouveau `podWorkRun` du pull n'a donc pas encore été exécuté ni mesuré sur la carte.

À `6b` :

- pile principale utilisée : 948 / 1 024 octets ;
- marge : 76 octets, sous le minimum obligatoire de 128 ;
- marqueur `CNRY` intact ;
- longueur peinte exacte et intacte (`0x250`) ;
- SP dans la pile ;
- aucune corruption détectée.

Le verrou est donc préventif et correct : il arrête une exécution encore saine mais sans réserve suffisante pour une interruption ou un appel supplémentaire.

## 2. Périmètre probable

Le contrôle `6a` est sain avec 440 octets de marge. Les contrôles silencieux R0, R1 et R2 n'ont pas verrouillé ; les appels Wi-Fi sont sains et `httpCall` revient avec PodNet à 1 148 octets utilisés / 836 de marge. La profondeur inférieure à 128 apparaît donc après le dernier contrôle interne de `httpCall` et avant le retour complet de `doRegister`.

Dans cette zone, `doRegister` exécute encore sur la pile principale :

```cpp
JSON_DOC(doc, 768);
deserializeJson(doc, resp);
deviceId = doc["deviceId"].as<String>();
pairCode = doc["pairCode"].as<String>();
paired = doc["paired"] | false;
```

Les journaux passent déjà par la pile de journal dédiée. Le parseur et les conversions ArduinoJson sont donc le suspect principal. La variation 144 -> 76 octets entre deux démarrages montre aussi que 144 n'était pas une réserve robuste, seulement une mesure ponctuelle proche du seuil.

Le lot `c19efb8` n'a pas modifié ce chemin de production ; le journal ne permet pas d'affirmer qu'il a créé cette profondeur. Il a changé l'image binaire et le moment des interruptions peut varier. La conclusion utile est que `doRegister` était déjà insuffisamment borné.

## 3. Correctif suivant : `REGISTER-JSON-STACK-FIX1`

Réutiliser la pile de travail de 2 048 octets introduite par `c19efb8`, après le retour complet de `httpCall` :

1. helper `noinline` de décodage de la réponse `/api/register` ;
2. `JsonDocument`, `deserializeJson` et toutes les conversions JSON -> chaîne vivent sur `podWorkRun` ;
3. structure `RegisterParsed` appartenant à l'appelant, allouée au tas ou constituée de champs bornés afin de ne pas grossir la pile principale ;
4. borner et valider `deviceId` et `pairCode` selon le contrat serveur ; refuser toute valeur invalide, ne jamais tronquer un identifiant ;
5. aucun changement de `registered`, `paired`, `deviceId`, `pairCode`, EEPROM ou écran avant un résultat complet et valide ;
6. échec fermé sur NOMEM, NESTED, GUARD, MARGIN, JSON invalide ou champ hors bornes ;
7. au canari, ligne dédiée `register JSON` avec utilisation, marge, erreur, statut et tas avant/après ;
8. contrôle silencieux juste après le retour du parseur et rapport après retour complet de `doRegister` ;
9. tests avec réponse valide, appairée/non appairée, JSON tronqué, champs absents, identifiants trop longs, pannes d'allocation et imbrication ;
10. aucune modification serveur, Redis, Neon, protocole, polling ou OTA.

Ce correctif doit rester sur le seul firmware e-ink 2,9 pouces jusqu'à validation matérielle.

## 4. Inventaire à ne pas oublier

Les cinq firmwares R4 ont encore plusieurs parseurs ArduinoJson sur la pile principale : inscription, pull et validation ; le firmware multiscreen a aussi un parseur supplémentaire. Après validation de l'e-ink 2,9 pouces, il faudra appliquer une migration systématique, et non attendre un nouveau débordement par firmware.

Pour l'e-ink 2,9 pouces, `doValidate` conserve notamment son propre `deserializeJson`. Il devra passer sur la pile de travail avant le premier test réel de vote. Le TFT 2,8 pouces reste bloqué indépendamment par sa marge de vote de 60 octets.

## 5. Prochain canari

Après le correctif hôte et son audit :

1. aucun dessin ;
2. register puis au moins trois pulls ;
3. exiger `register JSON` et `pull JSON` avec erreur 0, marges >= 128 octets et objectif >= 256 ;
4. pile principale >= 128 à tous les points, marqueur et longueur intacts ;
5. tas libre stable ;
6. seulement après ce passage complet, autoriser une frame personnelle unique.

## 6. Tests

Claude rapporte pour `c19efb8` : 716/716 depuis un clone propre, deux cœurs compilés, et un harnais ArduinoJson réel. GPT n'a pas pu reproduire la suite sur le poste lors de l'audit précédent à cause d'une erreur système Node `uv_os_get_passwd ENOMEM` avant chargement des tests. Ce point reste une réserve d'environnement, pas un échec du code.
