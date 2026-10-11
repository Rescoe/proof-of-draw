# Audit GPT — AUDIT5 matériel : `abort()` confirmé dans `WiFiSSLClient::read`

| Champ | Valeur |
|---|---|
| Date | 11/10/2026 |
| Commit instrumenté | `3387088` |
| Matériel | UNO R4 WiFi + e-ink 2,9 pouces BWR |
| Verdict du lot AUDIT5 | **ACCEPTÉ** — l'instrumentation a répondu à la question |
| Verdict matériel | **`abort()` appelé pendant `WiFiSSLClient::read()`** |
| Prochaine étape | correctif borné séparé `PULLFRAME-BOUNDED-SSL-FIX1` |
| Redis / Neon | Redis +0 ; Neon 0 |

## 1. Preuve matérielle

Le journal persistant du démarrage précédent donne :

```text
DERNIERE PHASE 9 (apres client.print)
... M93 V59 R54#
tas avant read : libre 2976 o puis 2976 o
sommet vierge 1888 o puis 1888 o
abort() : OUI
```

La phase 9 prouve que `client.print` est revenu. `R54#` place l'appel à `abort()` entre l'entrée et la sortie de `read()`. Le total libre et le sommet vierge sont stables avant les lectures échantillonnées : aucune fuite progressive n'est observée.

Le journal brut est archivé dans `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT5_2026_10_11/journal-audit5-3387088-materiel.txt`.

## 2. Conclusion exacte

Établi :

- `abort()` est appelée dans la lecture SSL de la frame, après l'envoi de la requête ;
- le silence infini n'est ni un simple blocage USB, ni un timeout manquant de `Reader`, ni une faute de pile principale détectée ;
- Wi-Fi, register, pull JSON, PodNet, Ed25519 et pile de journal sont sains avant ce point.

Très probable mais pas directement enregistré : l'agrandissement de la `std::string` de `ModemClass::buf_read` échoue faute de bloc contigu. Le cœur WiFiS3 accumule la réponse dimensionnée par `data_res += c`, et `operator new` aboutit à `abort()` lorsqu'une allocation échoue.

Non établi : la taille exacte de l'allocation fautive et la classe exacte de l'exception/du chemin d'abandon.

## 3. Divergence documentaire à résoudre dans le correctif

Le lot AUDIT5 mentionne une lecture pouvant atteindre environ 511 octets. Le code du cœur Renesas 1.6.0 installé localement déclare `RX_BUFFER_DIM = 1024` et `WiFiSSLClient::_read()` demande `rx_buffer->freePositions() - 1`, soit jusqu'à environ 1 023 octets lorsque le FIFO est vide.

Le prochain lot doit vérifier les sources réellement compilées des cœurs 1.5.3 et 1.6.0 et archiver cette preuve. Il ne doit pas supposer qu'une réduction du tampon demandé par `Reader` borne la commande AT : `_read()` choisit sa taille d'après le FIFO interne.

Cette vérification a été archivée dans `docs/PREUVE_WIFIS3_RX_BORNE_RENESAS_1_5_3_1_6_0_2026_10_11.md` : les trois fichiers concernés ont les mêmes SHA-256 dans les deux cœurs.

## 4. Verdict d'orchestration

Il n'est plus utile d'ajouter un AUDIT6 général. Le prochain test scientifique pertinent est une intervention bornée : limiter la véritable réception `_SSLCLIENTRECEIVE`, puis vérifier que la même frame est reçue octet par octet sans `abort()`.

Contraintes du prochain lot :

- aucun patch dans l'installation Arduino globale ;
- adaptateur local au projet ou autre solution démontrée ;
- aucun `new_handler`, aucune redéfinition de `operator new` en production ;
- échec fermé, aucun ACK/rendu/vote annoncé sur lecture incomplète ;
- e-ink 2,9 pouces R4 seulement avant propagation ;
- drapeaux committés à `0/0` ;
- serveur, Redis, Neon, protocole, polling, vote et OTA inchangés.

Rollback : revert du futur commit du correctif. AUDIT5 reste une instrumentation de canari absente du chemin `0/0`.
