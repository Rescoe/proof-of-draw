# Audit GPT — canari PULLFRAME-PHASE-AUDIT3 (2cdfe54) : le journal flash localise le blocage ; instruction du lot AUDIT4 (10/10/2026)

Transcription de l'analyse transmise par le porteur (texte tel que reçu, mis en forme).

## Constats

Cette fois, la localisation est exploitable. Le journal persistant montre : `sequence 0123456789`, `DERNIERE PHASE 9 (apres client.print)`. Donc :

- connexion TLS réussie ;
- requête construite ;
- `client.print(req)` est revenu ;
- blocage avant l'enregistrement de la phase 10.

Correction au rapport de Claude : cela prouve que la requête a été **remise au client Wi-Fi**, pas encore qu'elle est arrivée chez Vercel. Seule la présence de `/api/pull-frame` dans Vercel le prouvera.

## Consigne au porteur

Le démarrage `gen=2` s'est visiblement bloqué au même endroit. Appuyer une seule fois sur Reset et copier uniquement le début jusqu'à `FFLOG demarrage precedent ...`. Si cela indique encore `DERNIERE PHASE 9`, c'est une reproduction matérielle deux fois consécutive ; ensuite débrancher la carte. Chercher aussi `/api/pull-frame` dans Vercel aux heures des deux essais :

- requête absente : `client.print()` est revenu, mais le module n'a peut-être jamais transmis la requête ;
- requête présente avec 200 : Vercel a répondu et le blocage est dans la réception côté R4 ;
- requête présente avec une durée anormalement longue ou une erreur : piste serveur/proxy à étudier.

## Instruction : PULLFRAME-PHASE-AUDIT4 (instrumentation seulement)

- événements persistants, écrits une seule fois, avant/après `WiFiSSLClient::read` ;
- événements avant/après `connected()` ;
- distinguer l'entrée dans `readHeaders`, `readLine` et `fill` ;
- enregistrer des valeurs de `millis()` aux points clés pour déterminer si l'horloge avance ;
- ne pas écrire en flash à chaque tour de boucle : nombre d'événements strictement borné pour ne pas perturber TLS ni user prématurément le bloc ;
- ajouter un témoin indépendant juste après le retour de `readHeaders` et avant l'écriture de la phase 10, par exemple la LED intégrée, afin de distinguer « lecture bloquée » de « écriture flash phase 10 bloquée » ;
- conserver les contrôles de pile dédiée et les drapeaux committés à `0/0` ;
- aucun correctif fonctionnel, serveur, Redis, Neon, protocole, ACK, rendu, polling ou OTA avant localisation ;
- compiler sur les deux cœurs, commit local, puis arrêt pour audit GPT.

Conclusion de GPT : le problème n'est plus « quelque part après le pull ». Il est réduit à la lecture de la réponse HTTP/TLS — probablement un appel `read()` ou `connected()` qui ne rend pas la main — ou, moins probablement, à l'écriture persistante de la phase 10.

## Écarts de l'implémentation (Claude) par rapport à ce texte

- **Entrées de `readLine` / `fill` / `readHeaders`** : ces fonctions sont des gabarits de `pod_http.h`, un en-tête partagé par plusieurs firmwares. Pour ne pas modifier ce texte partagé, seuls les appels au CLIENT sont observés (`read`, `connected`), ce qui suffit à distinguer « bloqué dans le module » de « bloqué hors des appels du client (boucle, `delay`, horloge) ». `readHeaders` a son entrée connue (marque 9).
- **LED intégrée** : D13 est aussi l'horloge SPI de l'e-ink (la reconfigurer en GPIO casserait l'affichage). Le témoin indépendant est constitué de cinq LED de la **matrice** de la carte, pilotées en statique par les registres (sans minuteur ni interruption).
