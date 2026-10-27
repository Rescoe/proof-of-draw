# Protocole d'essai matériel — station R4 `r4tft18-2.4` (28/10/2026)

> **Statut : PRÉPARÉ, NON EXÉCUTÉ.** Rien n'est flashé, poussé ni soumis. L'exécution attend le GO du porteur : « GO pour pousser les commits comportementaux et exécuter l'essai matériel instrumenté sur la station R4 ».
> Niveaux de preuve visés : `M` (observé sur carte), `V2` (vote réel observé).

## 1. Images et retour arrière

| Image | Contenu | Octets | SHA-256 |
|---|---|---|---|
| `canary-builds/station-2.3-flashe/` | **retour arrière** : reconstruction exacte du firmware actuellement sur la carte (commit `f47942e`, 165 172 o de flash) | 165 180 (.bin) | `addcd4976c99741617adff0b8f91cde019cb73a420bf88367630401e4a4e8056` |
| `canary-builds/station-2.4/` | **à essayer** : `r4tft18-2.4` = 2.3 + lots 1 à 3 (verdict « blank » aligné sur l'ESP, candidat conservé, tampon de vote à la demande, abstentions explicites, 3 essais par candidat) | 165 924 (.bin) | `5230fa7b1f90785484b40ee475a49ca744f99d2cac877dee7ba6e99a48140113` |

| `canary-builds/station-2.4-animv3shadow/` | `2.4` + **OMBRE du vote d'animation v3** (`-DPOD_ANIM_V3_SHADOW=1`) : après chaque clip reçu, la carte calcule et journalise `[ANIM-V3] ombre (AUCUN vote)` (règle, images, E/T/R/S, durée, pile, tas) ; ni réseau, ni signature, ni vote | 169252 (.bin) | `7bae5244122b747df64a22b0d455a61f14f9e9ec38061e426fc948dbf60a9353` |

Le drapeau à 0 donne une image **octet pour octet identique** à `station-2.4` (même SHA-256). À utiliser seulement à l'étape 6 (animation) : un second flash, avec retour arrière identique.

Les trois dossiers contiennent `secrets.h` compilé (Wi-Fi) : **ils sont ignorés par git et ne se partagent pas**. RAM statique 2.4 : 17 108 o (2.3 : 21 828 o) ; tas libre estimé ≈ 15 660 o (≈ 10 940 o).

## 2. Garde-fous (un seul flash par étape)

- Ne pas effacer la mémoire : `arduino-cli upload … --input-dir` écrit le seul programme (identité, clés Ed25519, état de l'EEPROM et carte SD conservés).
- Avant : `node --env-file=<.env.local> --import tsx scripts/diag-electorate.ts` (lecture seule) pour noter l'électorat.
- Capture série pendant tout l'essai ; ne jamais ouvrir le moniteur de l'IDE en même temps (le port doit être libre pour le téléversement).
- Retour arrière : `arduino-cli upload --fqbn arduino:renesas_uno:unor4wifi -p COM7 --input-dir canary-builds/station-2.3-flashe`.

## 3. Étapes et critères

1. **Flash de `station-2.4`** (l'image `station-2.4-animv3shadow` ne sert qu'à l'étape 6) puis démarrage : critères `M` — `[KEYS] clés chargées` avec la **même** clé publique qu'avant, `[SELFTEST] Ed25519 … OK`, `/api/register` 200 (`deviceId` inchangé), `[SD] carte lisible`, `[MEM]` : tas libre > 12 Ko. Arrêt si l'identité change.
2. **Vote d'un dessin à fond non blanc** (le cas du 27/10) : soumettre depuis l'interface un dessin TFT 1,8″ à fond noir avec traits colorés. Attendu : `[VALIDATE2] … verdict=accept` (jamais `blank`), `/api/validation-result` 200. Si le réseau ne contient que la station, le quorum est de 1 : le bloc est miné (`blockMined`). `V2` seulement si l'acceptation est observée.
3. **Image et ACK** : la frame du bloc miné est téléchargée, affichée (cartel compris), écrite sur la SD, puis `[ACK] … OK`. Critères `M`. Vérifier que l'écran alterne ensuite relevés / œuvre / courbes (1 minute par page).
4. **Un pull qui apporte candidat ET frame** : soumettre un second dessin juste après l'affichage du premier. Attendu : le journal montre `[PULL] nouvelle frame …` suivi d'un vote ; **aucune** ligne d'abandon de candidat.
5. **Abstention explicite** (si reproductible sans danger) : en cas d'échec, le journal doit montrer `[VOTE] abstention : <raison>` avec une raison de la liste fermée (`memoire`, `pile-reseau`, `http`, `telechargement`, `signature`, `post`, `ecran-inconnu`) et **jamais** un refus signé.
6. **Animation** : soumettre une animation. Attendu avec `ANIM_V1_VOTE` : vote v1 « écho » accepté (étiqueté comme tel par le rapport), clip téléchargé sur la SD, lecture en boucle ; **ce n'est pas une validation du contenu**.
7. **Rapport** : `node --env-file=<.env.local> --import tsx scripts/trial-report.ts [candidateId …]` après chaque soumission et une fois le candidat réglé.

## 4. Vote croisé (la preuve centrale)

Il exige **au moins un autre appareil en ligne dont l'écran diffère du candidat** (par exemple un BWR : candidat TFT 1,8″, ou la station : candidat BWR). Aujourd'hui seuls la station et le multiscreen sont actifs. À rallumer pour l'essai complet : BWR, R4 e-ink 2,9″, R4 TFT 2,8″. Le rapport compte les **votes croisés v2** ; sans eux, la règle « tous votent tout » reste `C` + `H` (matrice `MATRICE_VALIDATEUR_X_FORMAT_2026_10_28.md`).

## 5. Ce que cet essai ne prouve pas

Les ESP modifiés (BWR, multiscreen, e-ink 2,7″) et les R4 e-ink / TFT 2,8″ ne sont pas flashés : leur correction du candidat conservé n'est que `C` + `H`. L'animation v3 n'est active sur aucune carte. Les capteurs seuls restent exclus du quorum (capacité explicite : `lib/voteCapability.ts`, aucune famille autorisée).
