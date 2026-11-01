# Clôture du chantier `multibwr-2.2` (01/11/2026)

Décision du porteur le 01/11/2026 : le chantier `multibwr-2.2` (carte `dev_T46HBXG1`) est déclaré **validé matériellement et clôturé**.

## Ce qui est prouvé
- **Installation OTA Internet** : `register` en `multibwr-2.2` le 31/10/2026 à 21:42:38 UTC (après redémarrage manuel de la carte).
- **Retour visuel du cousin** : dessin, animations, température puis humidité sur l'OLED.
- **Vote** : journal serveur `devlog:dev_T46HBXG1`, 31/10/2026 22:18:18 UTC, `vote POST → 200` pour le candidat `7a4a8984-1ba9-4e3c-a18c-aa49c2a30d5a` (annoncé à 22:17:44, `candidat GET → 200` à 22:18:16), `ok=true`. Ce candidat est devenu le **bloc #130 « Citrouille »**, `kind: "animation"`, `votesSummary {v2:0, v1:2, rejects:0}`, validateurs `dev_MN67OG7R` et `dev_T46HBXG1` (`candidate:voters:` contient les deux).

## Réserve d'honnêteté
Le seul vote de `dev_T46HBXG1` retrouvé dans les enregistrements serveur depuis `multibwr-2.2` est celui ci-dessus : une **animation**, donc un vote **v1** (écho) par conception. **Je n'ai trouvé dans Redis aucun vote v2 sur un dessin statique pour cette carte** (dernière lecture : 01/11/2026 10:20 UTC). Le porteur indique avoir observé un vote v2 statique ; la preuve exacte (candidat, bloc, horodatage, `vote POST 200`) n'est pas dans le journal serveur à ma disposition. À consigner ici dès que le porteur ou une capture la fournit. Les lignes série `[VOTE-NET]` n'ont pas été capturées.

## Conséquence pour la matrice
`multibwr` : C, M, OTA (un appareil) ; V2 : **déclaré par le porteur, non retrouvé côté serveur**.
