# Release `multibwr-2.3` séquence 21 — PRÉPARÉE, NON PUBLIÉE (04/11/2026)

Statut : compilée et signée dans un dossier de staging hors de `ota-releases/`, contrôle de pré-publication OK. **Jamais flashée, jamais essayée sur une carte. Aucun GO de publication.**

## Ce qui change par rapport à `multibwr-2.2`
Une seule chose : la POST du vote v2 (`/api/validation-result`) utilise un tampon TLS de réception de 4 Ko (`g_httpSmallRx`, `setBufferSizes(4096, 512)`), pour CETTE requête seulement. Raison : sur le multiscreen (même chaîne de vote), la POST échouait juste après la lecture par morceaux (plus gros bloc libre 16 704 o < ≈ 16,4 Ko d'un tampon TLS normal). Preuve et correctif : `docs/DIAGNOSTIC_MULTISCREEN_USB_2026_11_04.md`. Aucun autre octet de logique.

## ⚠ Ce que cette release ne garantit PAS
Le blocage observé chez le cousin (`dev_T46HBXG1`) n'est pas la panne de POST : sa carte disparaît juste après `candidat GET → 200`, 3 fois sur 3, sans `register`. Cette release ne traite PAS une cause inconnue de ce silence. Sans journal série de cette carte, **aucune promesse de résolution**.

## Pin
| Champ | Valeur |
|---|---|
| Commande | `node ota-lab/esp8266-canary/tools/build-bwr.mjs --ota --seq 21 --version multibwr-2.3 --sensor --oled --display --chunk --define POD_OLED_ANIM=1 --define POD_MULTI_OLED=1` |
| Binaire | 559 968 o, SHA-256 `1ace1acf1ec5d02400031730ab2c4f676de2dabe02f82b9532f8e92ee64760bd`, RAM statique 36 344 o |
| Fichier signé (`image.bin`) | 560 032 o, SHA-256 `2ef658e3b4a748d5180378f3e8a59644c764f4acbad1e89a92d6f3d5d22407e2` |
| Région signée | `d064e37ef51125e25ae32d537afba3239d1352896b75d35ade4276a1051879ba` |
| Manifeste | SHA-256 `075fc3106765293341128b97a7501dcf8bde5c572b2e4908b7ae3e5be49af756` |
| Famille / version / séquence / canal | `esp8266-multibwr` / `multibwr-2.3` / 21 / `canary` |
| Cible | **uniquement** `dev_T46HBXG1` (installée : séquence 17) |
| Staging (hors Git) | `canary-builds/ota-staging/multibwr-2.3-ota21/{image.bin,manifest.json}` |
| Pin de build | `docs/mesures/APPAREILS_2026_11_04/MULTIBWR-2.3-BUILD-PIN.json` |

## Pour publier (sur GO distinct du porteur)
Copier les deux fichiers du staging dans `ota-releases/multibwr-2.3-ota21/`, pousser, vérifier côté serveur (SHA des octets servis, manifeste ne ciblant que T46), puis surveiller `register` en `multibwr-2.3` (la carte du cousin a besoin d'un redémarrage manuel pour installer, comme pour la 2.2) et un vote v2 sur un dessin statique. Retrait immédiat si boucle de redémarrage ou perte d'affichage. **Ne jamais réutiliser la séquence 21.**
