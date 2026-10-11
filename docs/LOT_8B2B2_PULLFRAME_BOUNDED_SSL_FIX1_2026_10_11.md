# Lot 8B-2B-2 — PULLFRAME-BOUNDED-SSL-FIX1 (11/10/2026)

Correctif de production étroit : UNO R4 WiFi + e-ink 2,9″ **seulement**. Compilé et testé sur l'**hôte** (vrai code du cœur Renesas 1.5.3 et 1.6.0) ; **jamais compilé pour la carte, jamais flashé**. Réalisé par Claude (implémenteur), à auditer par GPT/Codex.

## 1. Cause retenue (AUDIT5 + lecture des sources)

`WiFiSSLClient::_read()` envoie `AT+SSLCLIENTRECEIVE=<sock>,<freePositions()-1>` : FIFO vide (`RX_BUFFER_DIM = 1024`) ⇒ **1 023 octets demandés**, quelle que soit la taille demandée à `read()`. Le module répond `min(demandé, disponible)` octets (`UNOR4USBBridge/cmds_wifi_SSL.h`, dépôt du pont, branche `main`). `ModemClass::buf_read` les accumule par `data_res += c` dans la `std::string` `res` de l'appelant, **vide** : capacité 15 → 30 → … → 480 → 960 → **1 920**, chaque agrandissement demandant un bloc contigu neuf pendant que l'ancien vit. Réponse de 961 à 1 023 o ⇒ allocation de **1 921 o** > sommet contigu vierge de **1 888 o** (mesure AUDIT5) ⇒ `operator new` échoue sans gestionnaire ⇒ `abort()` ⇒ boucle vide.

Statut : **très probable, pas directement enregistré** (la taille exacte de l'allocation fautive n'a pas été relevée sur la carte). L'hôte reproduit exactement le chiffre 1 921 o (§3.A), ce qui est cohérent avec — sans le prouver — l'abort matériel. Le canari dira si le correctif suffit.

Divergence documentaire résolue : l'AUDIT5 parlait de ≈ 511 o ; les sources effectivement compilées (SHA-256 identiques en 1.5.3 et 1.6.0, `docs/PREUVE_WIFIS3_RX_BORNE_RENESAS_1_5_3_1_6_0_2026_10_11.md`, **revérifiés** par `scripts/fetch-wifis3-sources.js`) demandent 1 023 o.

## 2. Correctif

`arduino_uno_r4/pod_uno_r4_eink29/pod_ssl_bounded.h` : `PodBoundedSSL : public WiFiSSLClient` (`_sock` et `rx_buffer` sont **protected** dans `WiFiClient` ⇒ aucun accès illicite, **aucun fichier du cœur modifié**, pas de `new_handler`, pas d'`operator new` redéfini).

| Point | Valeur |
|---|---|
| Argument `size` de la **vraie** commande `_SSLCLIENTRECEIVE` | `min(freePositions()-1, 240)` (`kRxCap = 240`) |
| Réponse AT | `std::string res; res.reserve(256)` **une fois** avant `modem.write` : `buf_read` n'agrandit plus (`clear()`/`= ""` gardent la capacité). Pic contigu **257 o** (mesuré hôte) au lieu de 1 921 (+ 961 vivants) |
| Stockage | FIFO existant (`rx_buffer`, déjà alloué par `WiFiClient`), ordre préservé, aucun tampon statique, aucune variable globale |
| Surcharges | `read(buf,n)`, `read()`, `connected()` ; `available()`, `peek()`, `stop()`… inchangés (n'appellent pas `_read`) |
| Échec fermé | module qui renvoie plus que demandé, ou FIFO qui refuse un octet ⇒ **défaut collant** : `read` = −1, `connected()` = 0 ; `doFetchFrame` : `got = … && c.client.fault() == 0` ⇒ pas d'affichage, pas d'ACK, pas de vote |
| Erreur de transport (silence, ERROR) | comme avant : 0 octet, le `Reader` réessaie jusqu'à son délai ; la complétude reste garantie par `Content-Length` exact |

Sketch : **4 fragments** seulement (`tests/helpers/boundedSslEdits.ts`) — `#include "pod_ssl_bounded.h"`, `#define WiFiSSLClient PodBoundedSSL` (avant la section HTTP ; `Conn` et `Reader<…>` restent inchangés), `#undef WiFiSSLClient` dans le bloc de canari (avant son `#define … FfSSL`, le client espion dérive désormais de `PodBoundedSSL`), contrôle du défaut dans `doFetchFrame`. `POD_RENDER_V1 = 0` et `POD_CANARY = 0` (testé). `FIRMWARE_VERSION` inchangée (aucun changement de protocole). Sauvegarde : `firmware-backups/2026-10-11_avant-pullframe-bounded-ssl-fix1/`.

Contrepartie : une frame de 9 472 o + en-têtes demande ≈ **41 commandes AT** au lieu de ≈ 10 (≈ 25 octets émis + ≈ 265 reçus chacune sur l'UART à 115 200 bauds : de l'ordre de 25 ms l'une, **non mesuré sur la carte**).

## 3. Preuves (hôte, vrai code du cœur)

`consensus-pod/host/wifis3/bounded_ssl_harness.cpp` compile les **vrais** `WiFiSSLClient.cpp`, `WiFiClient.cpp`, `Modem.cpp` (1.5.3 et 1.6.0, téléchargés par `node scripts/fetch-wifis3-sources.js` dans `consensus-pod/host/wifis3/.cache/`, **ignoré par git** — code LGPL tiers) contre un module AT simulé (`shim/Arduino.h`) qui répond comme le pont, avec le vrai `pod_ssl_bounded.h` et `pod_http.h`. Les commandes AT sont capturées **sur l'UART simulé**, c'est-à-dire telles que le vrai `Modem::write` les émet : la borne porte sur la **vraie** commande, pas sur un paramètre intermédiaire. Sorties : `docs/mesures/8B2B2_PULLFRAME_BOUNDED_SSL_FIX1_2026_10_11/harnais-hote-renesas-{1.5.3,1.6.0}.txt` (19 contrôles chacun, 0 échec).

- **A — ancien chemin** : le vrai cœur émet `…=0,1023` ; réponse de 400 ou 960 o : pas d'abort (pic bloc 481 / 961 o) ; réponse de 1 023 ou 4 000 o : `HeapAbort` à l'allocation de **1 921 o** sous bloc contigu 1 888 o / total 2 976 o (l'`operator new` du harnais lève au lieu d'appeler `abort()`).
- **B1** — 106 combinaisons (18 tailles de 0 à 9 472 × 6 motifs d'arrivée : tout d'un coup, 1/7/239/500 o par commande, 100 puis 333) sous bloc 300 o et total vivant 330 o : octets exacts et dans l'ordre, AT max demandée = **240**, pic bloc 257 o. **B2** : 4 000 o d'un coup sous le tas AUDIT5. **B3** troncature (5 000/9 472) : incomplet. **B4** 8 octets en trop : 9 472 lus, surplus non lu. **B5** rien n'arrive : `readHeaders = −1` au délai. **B6** module muet une commande sur 3 : 3 000 o exacts après réessais. **B7** module défectueux (280 o pour 240) : défaut collant, échec fermé. **B8** réponse AT coupée : rien de stocké. **B9** lectures de tailles mélangées. **B10** 300 scénarios pseudo-aléatoires.
- **C — frame complète 9 472 o** relue comme `doFetchFrame` (deux `readBody` de 4 736) : identique octet par octet ; 40 commandes AT, max demandé 240, pic bloc 257 o, pic vivant 307 o.
- **Contrôles négatifs** (`tests/boundedSsl.test.ts`) : plafond relevé à 1 023, plafond non appliqué, réservation supprimée, réponse trop longue acceptée, défaut non signalé par `read`, `connected()` qui ignore le défaut — chacun est REFUSÉ par le harnais.
- Tests des lots précédents adaptés (annulation des 4 fragments avant la comparaison « sketch d'avant au texte près » : `undoAllStacks` + `edStack`/`netStack`).

## 4. Limites (à ne pas oublier)

1. **Aucune compilation ARM** : `arduino-cli`/cœurs Renesas indisponibles dans la session cloud (proxy : `downloads.arduino.cc` et les archives GitHub refusés). La matrice 1.5.3/1.6.0 × OFF/ON/canari et les **mesures flash / RAM statique / pile** sont **à faire sur la machine du porteur** (commandes au §6). Attendu, non mesuré : RAM statique **inchangée** (aucun global ; +1 octet par instance, sur la pile réseau dédiée) ; flash quelques centaines d'octets.
2. **Pile réseau dédiée (2 048 o, marge 812 o au dernier canari)** : le correctif ajoute des cadres `fill_()` (≈ 100 o estimés) mais en retire d'autres du cœur ; non mesuré — le canari imprime la marge.
3. Le module simulé suit la **source** du pont (`main`) ; la version du pont embarquée sur la carte est **inconnue**. Le format exact des réponses du vrai pont n'est pas revérifié octet par octet (il est validé en pratique par les frames déjà reçues à 1 023 o avant AUDIT).
4. Le tas de l'hôte est un modèle (bloc contigu + total vivant) : il n'est pas le tas newlib de la carte. Il montre que la **plus grande allocation** passe de 1 921 à 257 o, pas que l'abort matériel disparaîtra.
5. Cause de l'abort matériel : « très probable », non démontrée directement ; si le canari s'arrête encore à la phase 9, **l'hypothèse est à revoir** (nouvelle mesure, pas de correctif supplémentaire à l'aveugle).
6. Une réponse AT coupée **consomme** des octets côté module (perdus) : seul `Content-Length` exact les détecte (frame incomplète, pas d'ACK) — comportement identique à l'ancien chemin.

## 5. Coûts et périmètre

Redis **+0**, Neon **0**, serveur / protocole / format de frame / polling / vote / ACK / OTA **inchangés**. Les quatre autres firmwares R4 et l'ESP8266 ne sont **pas** modifiés (testé). Aucun secret, aucun `secrets.h`, aucun binaire.

## 6. Reste à faire par le porteur (avant tout flash)

```
node scripts/fetch-wifis3-sources.js && npm test        # harnais hôte + tout le reste
# compilation (cœurs 1.5.3 PUIS 1.6.0), trois formes :
#   OFF   : défauts du dépôt (POD_RENDER_V1=0, POD_CANARY=0)
#   ON    : -DPOD_RENDER_V1=1
#   canari: -DPOD_RENDER_V1=1 -DPOD_CANARY=1   (build LOCAL, dossier canary-builds/ ignoré par git)
# relever : flash, « Variables and constants in RAM » (attendu inchangé vs 3387088), chaînes de pile
```

**Protocole du canari matériel** (une seule frame, **aucun dessin, aucun candidat, aucun vote**) : build canari local ; une frame **personnelle** déjà en attente (« Afficher sur mon écran », UUID neuf) ; **un** reset ; relever : `register 200`, `pull JSON`, puis pour la phase de téléchargement `[HTTP GET] /api/pull-frame -> 200`, `[FRAME] lu noir=4736 rouge=4736`, affichage, ACK ; journal flash `FFLOG` : dernière phase attendue **15** (retour de `podNetRun`) et plus **9** ; `abort() : non` ; marge de la pile réseau et durée du téléchargement (≈ 41 commandes AT). Si le gel persiste à la phase 9 : ne rien corriger à l'aveugle, rapporter `FFLOG` + `tas avant read`.

## 7. Rollback

`git revert` du commit du correctif : le sketch retrouve `WiFiSSLClient` direct ; `pod_ssl_bounded.h`, le harnais, le script de téléchargement et le test disparaissent ; le binaire stable `canary-builds/stable` (POD_RENDER_V1=0) reste le retour arrière matériel.
