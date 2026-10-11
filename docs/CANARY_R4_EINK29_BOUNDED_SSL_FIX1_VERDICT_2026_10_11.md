# Verdict du canari — PULLFRAME-BOUNDED-SSL-FIX1 sur UNO R4 e-ink 2,9″ (11/10/2026)

**Verdict : le téléchargement de la frame fonctionne sur la carte (canari réussi, un essai).** Le gel à la phase 9 / `abort()` d'AUDIT5 ne s'est pas reproduit. Le chantier « pull-frame » est considéré **résolu pour le e-ink 2,9″**, sous les réserves ci-dessous. Journal fourni par le porteur (build local canari `POD_RENDER_V1=1`, `POD_CANARY=1`, Wi-Fi du porteur ; non archivé en entier dans le dépôt).

## Ce que le journal établit

| Point | Relevé |
|---|---|
| Démarrage | Wi-Fi (module 0.5.2), Ed25519 sign 178 ms / verify 276 ms (pile dédiée 1316/924 et 1532/708), `register` 200 (pile réseau 1176 o, marge 808), JSON register 556 o / marge 1428 |
| Pulls | 4 pulls à 200, JSON 740–764 o / marge 1220–1244, aucun verrou |
| **Téléchargement** | `[PULL] nouvelle frame 02760df6… (personal)` → `[HTTP GET] /api/pull-frame -> 200 (contenu 9472)` → **`[FRAME] lu noir=4736 rouge=4736 attendu=4736`** (avant : silence puis `abort()`) |
| Pile réseau pendant la frame | 1184 o utilisés, marge **800 o** (objectif ≥ 256 : OK), erreur 0, tas libre 6716 |
| Rendu v1 | `frameHash` + `renderHash` calculés, « calculé ET remis au pilote en 15817 ms », e-ink rafraîchi |
| Fin | `[FRAME] OK en 47274 ms`, `POST /api/ack-frame -> 200`, `[ACK] … -> OK` |

Aucun vote, aucun dessin, une seule frame personnelle : conforme au protocole du lot.

## Réserves (à lire avant d'étendre)

1. **Identité du binaire non prouvée par le journal.** La ligne `BUILD PULLFRAME-PHASE-AUDIT5 | base fd8b1dc` est un texte fixe de l'instrumentation : elle n'indique pas si le correctif y est. Indices concordants (compilé le 11/10 12:12 heure locale, après le commit `22c847e` de 09:54 UTC ; échec avant, succès après) — à **confirmer par le porteur** (`git log -1` du dossier compilé = `22c847e` ou postérieur, et présence de `pod_ssl_bounded.h`).
2. **Un seul essai, canari 1/1.** Le firmware de production (`POD_RENDER_V1=0`, `POD_CANARY=0`) n'a pas été flashé ; à faire une fois (même chemin de lecture).
3. **Lecture du journal flash `FFLOG` non fournie** : un reset montrerait « DERNIERE PHASE 15 » ; pas indispensable, mais la confirmation est gratuite.
4. **Pile principale** : `7b/8` = 892 o utilisés, marge **132 o** (« SOUS L'OBJECTIF 256 », au-dessus du minimum de 128). Ce n'est pas nouveau (déjà 132 o au canari `231393d`) et sans lien avec le correctif (pile réseau dédiée à 800 o de marge), mais reste à améliorer avant la production.
5. **Durée** : la durée propre du téléchargement n'est pas isolée dans le journal (`FRAME OK en 47274 ms` inclut 15,6 s de page blanche, 10 s d'attente minimale et 15,8 s de rendu).
6. **Non validé** : les quatre autres firmwares R4 (e-ink 2,7″ ×2, TFT 1,8″, TFT 2,8″), l'ESP8266, un vote réel. Aucune propagation tant que le porteur ne l'a pas décidée (lot suivant, avec le même `PodBoundedSSL`).

## Suite

Le porteur se concentre sur le capteur DHT22 (`docs/CAPTEUR_TEMPERATURE_R4_DHT22.md`). Reprise du canari plus tard : flasher la production 0/0, lire `FFLOG` après un reset, puis propagation du client borné aux autres firmwares R4, puis le chantier vote/validation.
