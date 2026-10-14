# Verdict matériel — canari d'affichage TFT 2,8″ basé sur `4800451` (14/10/2026)

**Verdict : VERT.** La **revalidation du transport V4** (précondition (b) du protocole de vote) est **réussie**. Journal brut archivé : `docs/mesures/8B2E_V4_FIX2_CANARI_AFFICHAGE_2026_10_14/journal-serie-brut.txt` (trois extraits transmis par le porteur, non modifiés). Aucun vote, aucun reset, aucune alerte, `POD_VOTE_CANARY = 0`.

## Ce que le journal prouve
| Point | Observé |
|---|---|
| démarrage sans nouvel envoi | clés chargées, auto-test Ed25519 OK (signature 178 ms, vérification 278 ms), `register` 200, `paired=oui`, œuvre restaurée depuis la SD en 917 ms, clip trouvé sur la carte, premier pull 200, `[BOOT] prêt` |
| frame personnelle | `pull-frame` 200 (153 600 o), 4 jalons `[FRAME] 80…320/320`, ACK 200, `cache SD: oui`, 23 957 ms |
| animation | frame d'accompagnement ACK 200 (24 359 ms), `block-clip` 200 (5 632 o), clip validé : **18 images**, rangé sur la carte, lecture en boucle (2 238 ms) |
| tactile | pause, cartel masqué en 262 ms, reprise — trois cycles |
| piles dédiées | Ed25519 marge ≥ 708 o ; Wi-Fi 952 o ; réseau http 828 – 856 o ; pull-frame 784 o ; block-clip 816 o ; JSON register 1 488 o, pull 1 212 o ; SD/TFT 644 – 684 o ; toutes erreurs 0 |
| tas | libre 7 984 – 7 996 o après chaque pull, plus grand bloc 4 884 o, fragmentation 39 %, stable |
| trois pulls successifs | **rapportés par le porteur** (verdict) ; les extraits archivés en montrent le pull de démarrage et au moins deux pulls suivants (HTTP 200) |

## Réserves à garder en tête (non bloquantes)
1. **Marge de la pile principale : 192 o au plus bas** (pull-frame / ACK / block-clip), 208 – 236 o ailleurs : toujours au-dessus du seuil d'arrêt de 128 o, mais **sous l'objectif de 256 o** (les lignes `SOUS L'OBJECTIF 256` sont réelles). C'est le chemin d'affichage ; le chemin du canari de vote est un autre chemin (statique : `doValidateV2` 568 o).
2. **Identité du binaire** : la ligne `BUILD` n'est pas dans les extraits ; le rattachement à `4800451` repose sur la déclaration du porteur (copie préparée par `scripts/prepare-local-canary-tft28.sh`).
3. **Backend** : ce canari tourne sur l'hôte codé dans le firmware (production, `proof-of-draw.vercel.app`). Le canari de vote ciblera un autre hôte : cet essai ne dit **rien** de l'appairage ni de l'isolation côté Preview.
4. Un seul essai ; pas de test carte SD retirée / endurance longue (hors périmètre du transport).

## Conséquence
Précondition (b) du lot V4 (§ 7) : **remplie**. L'affichage n'est plus modifié. Suite : `docs/PHASE_BACKEND_PREVIEW_ISOLE_VOTE_TFT28_2026_10_14.md` (préparation du backend Preview, appairage, candidat épinglé, `pod_vote_pins.h`, contrôle du verrou) — **aucun flash du canari de vote avant audit**.
