# Audit GPT — canari UNO R4 WiFi, piles dédiées et faux positif de la jauge historique

| Champ | Valeur |
|---|---|
| Date | 09/10/2026 |
| Matériel essayé | UNO R4 WiFi + e-ink 2,9 pouces BWR |
| Firmware | `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` |
| Commit audité | `297251d` (`NETSTACK-WIFI-CALLS-FIX1`) |
| Build matériel | build local temporaire, `POD_RENDER_V1=1`, `POD_CANARY=1` |
| État du commit | local au moment de l'audit, non poussé d'après le rapport de livraison |
| Verdict | **Architecture validée sur la carte ; corrections instrumentales requises avant push et avant frame** |

## 1. Résumé exécutable

Le canari matériel confirme que les trois opérations lourdes de l'UNO R4 sont désormais isolées de la pile principale de 1 024 octets :

- appels directs au module Wi-Fi sur une pile dédiée de 1 536 octets ;
- transaction TLS/HTTP sur une pile dédiée de 2 048 octets ;
- Ed25519 sur une pile dédiée de 2 304 octets.

L'inscription réelle a réussi (`POST /api/register -> 200`) sans corruption du marqueur de la pile principale. Le dernier arrêt à `6b apres doRegister` n'est pas un nouveau débordement : il est provoqué par l'ancienne fonction `stackDepthBytes()`, devenue invalide après l'introduction de piles temporaires prises au tas.

La mesure moderne du canari donne toutefois une marge principale de seulement **144 octets** après `doRegister`. Elle respecte le seuil minimal actuel de 128 octets, avec seulement 16 octets de réserve. Cette marge autorise la poursuite du canari sous surveillance, mais ne suffit pas encore à déclarer le firmware prêt pour une activation générale.

## 2. Faits prouvés par le journal matériel

### 2.1 Appels directs au module Wi-Fi

| Appel | Utilisé | Marge | Erreur | Verdict matériel |
|---|---:|---:|---:|---|
| `WiFi.status()` | 608 o | 864 o | 0 | OK |
| `WiFi.firmwareVersion()` | 448 o | 1 024 o | 0 | OK |
| `WiFi.begin()` | 540 o | 932 o | 0 | OK |
| `WiFi.localIP()` + conversion en chaîne | 568 o | 904 o | 0 | OK |
| `WiFi.macAddress()` | 520 o | 952 o | 0 | OK |

Toutes les marges sont très supérieures à l'objectif de 256 octets. Le défaut matériel précédemment isolé dans `WiFi.macAddress()` est donc corrigé par `podWifiRun`.

### 2.2 TLS/HTTP

La transaction complète d'inscription a donné :

```text
[CANARY] net http : pile reseau dediee utilisee 1172 o, marge 812 o, erreur 0
[HTTP POST] /api/register -> 200
```

La pile réseau est donc exercée et validée sur la carte pour ce chemin. Cela confirme que `connect`, la requête, la lecture du corps et `stop()` peuvent s'exécuter dans la réserve de 2 048 octets sans toucher la pile principale.

### 2.3 Ed25519

```text
sign   : 1316 o utilisés, 924 o de marge
verify : 1532 o utilisés, 708 o de marge
erreurs: 0 / 0
```

Le correctif `PodEd` reste validé matériellement. Le résultat du self-test est `OK`.

### 2.4 Pile principale après l'inscription

Le diagnostic décisif est :

```text
marqueur=0x434E5259 (OK)
longueur peinte=0x00000250 (OK)
plus bas octet modifie : __StackLimit + 144
pile utilisee au plus 880 / 1024 o
marge 144 o
```

Interprétation :

- aucun octet de la pile principale n'a franchi `__StackLimit` ;
- le marqueur et sa longueur sont intacts ;
- la profondeur maximale réellement observée est de 880 octets ;
- la marge réellement observée est de 144 octets ;
- le canari moderne n'a détecté aucune corruption.

## 3. Pourquoi « pile max 3072 » est un faux positif

`paintStack()` peint historiquement 2 048 octets en `0xA5` immédiatement sous `__HeapLimit`, qui est aussi la limite basse de la pile principale. `stackDepthBytes()` considère ensuite tout octet différent de `0xA5` dans cette zone comme une écriture venue de la pile.

Cette hypothèse était exploitable avant les piles dédiées. Elle ne l'est plus : `PodEd`, `PodNet`, `podWifiRun` et le journal prennent temporairement leurs piles dans le tas. Le tas grandit précisément dans la zone située sous `__StackLimit` et remplace légitimement les anciens octets `0xA5`. La valeur `3072` signifie donc « la peinture historique du vide entre tas et pile a été réutilisée », et non « la pile principale a utilisé 3 072 octets ».

À partir de l'introduction des piles dédiées :

- le marqueur `CNRY`, sa longueur et le filigrane situé **dans** la pile principale sont les preuves autoritatives ;
- les gardes et filigranes propres à chaque pile dédiée sont autoritatifs pour ces piles ;
- `stackDepthBytes()` ne doit plus déclencher un verrou après la première allocation temporaire au tas ;
- `reportMem(... pile max ...)` doit être renommé, limité au tout début du boot ou clairement marqué non interprétable après utilisation des piles dédiées.

Il ne faut jamais repeindre cette zone après le démarrage : elle peut alors contenir des données ou métadonnées de l'allocateur du tas.

## 4. Audit logiciel du commit `297251d`

Contrôles exécutés par GPT dans un clone propre du commit :

- `tests/wifiCalls.test.ts` ;
- `tests/netStack.test.ts` ;
- `tests/canaryPrep.test.ts` ;
- `tests/canaryBootFix2.test.ts` ;
- `npx tsc --noEmit`.

Résultat : **54 tests sur 54 passent**, TypeScript propre.

Le lot ne change ni le serveur, ni Redis, ni Neon, ni le vote, ni l'ACK, ni le rendu, ni l'OTA. Coût Redis : **+0 commande**. Coût Neon : **0**.

## 5. Corrections obligatoires avant le prochain canari

### C1 — retirer le faux critère fatal historique

Dans `podCanaryCheck`, `below > 1024` ne doit plus provoquer une alerte après activation des piles dédiées. Les critères fatals à conserver sont :

- marqueur `CNRY` invalide ;
- longueur peinte invalide ;
- SP hors de la pile principale ;
- marge principale strictement inférieure à 128 octets.

Une marge comprise entre 128 et 255 octets doit être annoncée **sous l'objectif de 256**, mais ne doit pas être confondue avec un débordement.

### C2 — arrêt réellement silencieux sur `GUARD`

Dans les cinq firmwares, `wifiFailed()` journalise actuellement avant de tester `POD_NET_GUARD`. Cela contredit la documentation : si la garde de la pile temporaire est détruite, un voisin du tas peut déjà être corrompu et il ne faut pas allouer une nouvelle pile de journal.

Ordre requis :

```cpp
if (ni.err == POD_NET_GUARD) logfSafeStop();
logf(...);
```

Un test négatif doit vérifier l'ordre, pas seulement la présence des deux instructions.

### C3 — consigner honnêtement la marge principale

La valeur 144 octets :

- dépasse le minimum actuel de 128 octets ;
- reste inférieure à l'objectif de 256 octets ;
- est validée pour poursuivre un canari surveillé ;
- n'est pas encore une validation de production.

Si elle descend sous 128 pendant les pulls, le vote, l'ACK ou le rendu, le canari doit s'arrêter. Si elle reste stable, une optimisation du cadre de `doRegister` pourra être planifiée séparément sans bloquer la preuve fonctionnelle du rendu.

### C4 — archiver le journal brut

Le journal matériel complet doit être conservé sans reconstruction dans le dossier de mesures du lot suivant. Il doit inclure les lignes Wi-Fi, Ed25519, PodNet, `register -> 200` et le diagnostic de `6b`.

## 6. Protocole de reprise autorisé

Après correction C1–C4, audit logiciel et compilation :

1. conserver `POD_RENDER_V1=1` et `POD_CANARY=1` uniquement dans le fichier local du canari ;
2. reflasher uniquement l'UNO R4 + e-ink 2,9 pouces ;
3. ne soumettre aucune nouvelle frame ;
4. laisser l'appareil effectuer l'inscription puis au moins trois pulls, environ cinq minutes ;
5. vérifier :
   - aucune erreur Wi-Fi, PodNet, journal ou Ed25519 ;
   - toutes les marges dédiées supérieures ou égales à 256 octets ;
   - marge principale toujours supérieure ou égale à 128 octets ;
   - marqueur et longueur intacts ;
   - aucune phase fautive PodNet/Wi-Fi ;
   - tas libre stable entre les pulls ;
6. seulement après ce verdict, envoyer **une unique frame personnelle**, avec UUID neuf, moniteur série ouvert ;
7. vérifier le rendu visuel, `frameHash`, `renderHash`, l'ACK et l'absence de redémarrage ;
8. reflasher le firmware stable immédiatement en cas d'alerte.

## 7. Interdictions maintenues

- aucun flash du TFT 2,8 pouces : marge de vote statique de 60 octets, toujours bloquante ;
- aucune activation générale de `POD_RENDER_V1` ;
- aucun déploiement, variable de production, secret ou OTA ;
- aucun polling accéléré ;
- aucune nouvelle commande Redis non budgétée ;
- aucune augmentation des accès Neon ANA ;
- aucun vote, ACK ou affichage après une alerte fatale ;
- aucun commit contenant `POD_RENDER_V1=1`, `POD_CANARY=1`, un binaire de canari ou `secrets.h`.

Les limites immuables restent environ 200 000 commandes Upstash Redis par mois, soit environ 6 700 par jour, sans `SCAN` ni nouveau polling non chiffré. Ce lot n'ajoute aucune commande.

## 8. Niveau d'assurance atteint

| Élément | Niveau atteint le 09/10/2026 |
|---|---|
| `PodEd` sur R4 | Validé sur carte par sonde et self-test |
| `podWifiRun` | Validé sur carte pour les six familles d'appels, sauf RSSI non exercé sur ce boot car les clés existaient déjà |
| `PodNet` | Validé sur carte pour `POST /api/register` |
| Journal sur pile dédiée | Utilisé pendant le canari ; mesure de la sonde dédiée à poursuivre lors du prochain boot complet |
| Pile principale au register | Pas de corruption ; marge observée 144 o, sous l'objectif |
| Trois pulls sans frame | Non réalisé : arrêt artificiel à `6b` |
| Rendu d'une frame | Non réalisé |
| Vote réel après ces correctifs | Non réalisé |
| ACK signé `pod-render-v1` | Non réalisé |
| OTA | Non réalisé |

## 9. Règle réutilisable pour les autres projets UNO R4 WiFi

Sur ce cœur Renesas, une pile principale de 1 024 octets peut être insuffisante pour des bibliothèques individuellement correctes lorsqu'elles sont appelées depuis un cadre profond. L'analyse doit toujours porter sur la chaîne d'appels cumulée, interruptions comprises.

Pour tout nouveau projet UNO R4 WiFi :

- mesurer la pile réelle, ne pas se contenter de la RAM statique annoncée par l'IDE ;
- isoler les opérations lourdes et bornées sur des piles temporaires gardées ;
- ne jamais imbriquer ces piles ;
- conserver les résultats dans des objets appartenant à l'appelant ;
- effacer la zone avant `free()` ;
- échouer fermé sur allocation, garde ou marge insuffisante ;
- ne pas utiliser une peinture située dans le futur espace du tas comme preuve durable d'un dépassement de pile ;
- distinguer une mesure matérielle, une analyse ELF et une simple hypothèse dans toute documentation.

## 10. Décision de suivi

`297251d` n'est pas rejeté sur son architecture : le matériel confirme son principe. Il reste **non gelé pour la production** jusqu'au correctif instrumental C1, au correctif d'ordre C2 et à un canari sans frame complet. Le prochain jalon n'est pas encore l'OTA : c'est un boot stable de cinq minutes, puis une frame personnelle unique.
