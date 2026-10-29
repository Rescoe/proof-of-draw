# Suivi — canari Multibwr (`dev_T46HBXG1`) en attente de reconnexion

**Statut au 29/10/2026 (soir) : release publiée, carte hors ligne, migration NON observée, AUCUNE conclusion matérielle.** Cette note est à compléter au premier signe de vie de la carte, puis à archiver (voir § 5).

## 1. Ce qui est publié
- Release `eink29bwr-2.15-ota16` dans `ota-releases/` (commit `eb0cef1` sur `main`) : canal `canary`, famille `esp8266-eink29bwr`, version de manifeste `eink29bwr-2.15`, séquence 16, **`canaryDevices: ["dev_T46HBXG1"]` uniquement**, clé `ota-a`. Le binaire qu'elle contient se déclare `multibwr-2.1` / famille `esp8266-multibwr` après son premier démarrage.
- SHA-256 complets (pin `docs/mesures/MULTIBWR_2026_10_29/MULTIBWR-2.1-BUILD-PIN.json`) : image `f6db0289f1130dd54cb34b7b54cd78aaab06785e93b0a480faa968ba061a752e` · fichier signé `4624072f76a0c2463479a1b8dce473cac8035a294e10b0014bcdfa6624470ea5` · région signée `1c85f1e731a110bd1742b59e71b0810f549510257bd241e6eb3c23d39dcf1935`.
- La porte `ota:kill` est **ouverte** (clé absente, relue le 29/10/2026) : la migration part toute seule au prochain pull de la carte.
- Ciblage vérifié (29/10/2026) : parmi les 11 manifestes de `ota-releases/`, seule cette séquence 16 est destinée à `dev_T46HBXG1` en dernière position ; aucun autre appareil n'est dans sa liste de canari, et `eligibleForRelease` refuse tout appareil hors liste (test `tests/multiBwr.test.ts`, cas 8 : `dev_MN67OG7R` et une séquence non supérieure ne reçoivent rien). Elle peut donc rester publiée.

## 2. Dernier état connu
Firmware `eink29bwr-2.13`, écran `eink29bwr` seul, capacité `anim-oled`, **dernier signe de vie 14:06:56 UTC**, dernière mesure 13:13 UTC, appareil débranché chez un tiers (peut le rester plusieurs semaines). La tentative `eink29bwr-2.14` (séquence 15) du même jour n'a pas abouti et **reste non expliquée** (aucun journal série n'existe).

## 3. Ce qui n'est PAS établi
Aucune migration observée, aucun démarrage en `multibwr-2.1`, aucun affichage OLED, aucune animation, aucun comportement du tas pendant le téléchargement avec l'OLED réel. Tant que la carte n'est pas revenue : **statut = « publiée, en attente de reconnexion — non validée sur carte »**. Ne jamais écrire « OTA réussie ».

## 4. Contrôles à la première reconnexion (lecture seule d'abord)
1. `device:dev_T46HBXG1` : `lastSeen` change ; `firmware` passe-t-il à `multibwr-2.1` ? `screens` = `["eink29bwr","oled096"]` ? `caps` vidé ? `publicKey`, `artistId` et `pairCode` inchangés (identité conservée).
2. Si toujours `eink29bwr-2.13` après quelques pulls : journaux de plateforme des requêtes `/firmware/eink29bwr-2.15-ota16/image.bin` (statut 200 = téléchargement tenté ; 503/400 = refus avant) ; la garde mémoire (24 000 o contigus) refuse sans risque et réessaie.
3. Mesure `meas:dev_T46HBXG1` : nouvelle entrée ; OLED du cousin = température/humidité (plus « en attente »).
4. Vote : un seul validateur pour la carte (pas deux voix), `missedVotes` stable.
5. Seulement ensuite : œuvre fixe sur l'e-ink, puis animation sur l'OLED (GO distinct du porteur).
6. Si la carte ne revient plus que par câble (image installée mais défaillante, pas de retour arrière automatique) : sauvegarde de flash locale `canary-builds/` (contient le Wi-Fi, jamais partagée).

## 5. Verdict (à compléter)
| Date | Constat | Verdict |
|---|---|---|
| — | — | en attente |

Après un succès **ou** un échec documenté : déplacer cette note dans `docs/archives/`, mettre la matrice à jour (`V2`/`OTA` seulement si observés) et fermer la porte (`SET ota:kill 1`) si plus aucune migration n'est attendue.
