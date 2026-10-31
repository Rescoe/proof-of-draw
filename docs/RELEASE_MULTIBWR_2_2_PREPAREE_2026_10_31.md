# Release `multibwr-2.2` séquence 17 — PRÉPARÉE, NON PUBLIÉE (31/10/2026)

Statut : compilée, signée dans un dossier de staging hors de `ota-releases/`, contrôle de pré-publication OK. **Jamais flashée, jamais essayée sur une carte. Aucun GO de publication.** À auditer par Codex avant tout GO.

## Pourquoi
La carte `dev_T46HBXG1` (multibwr-2.1) et `dev_KAD6PKC4` (multiscreen-2.8) ne votaient plus : leur journal serveur montre `candidat GET → 200` puis un nouveau `register`, sans `validation-result`. Cause **probable, non prouvée** : la lecture du candidat (9 472 o) réservait un tampon TLS de 16 Ko en plus des 4 736 o de travail. Sur le profil au tas le plus étroit (BWR + OLED), la carte redémarre dans la poignée de main TLS. Les deux dessins/animations du jour ont expiré avec 2 votes sur 3 exigés (station R4 + BWR de l'auteur) : quorum adaptatif poussé séparément (`ce3b4fd`). L'OLED ne montrait plus température/humidité : une animation en boucle sans fin ne laissait jamais la place à l'écran capteur.

## Contenu
- Vote v2 lu par morceaux de 2 368 o (`/api/candidate-frame?off=&len=`, serveur déjà déployé, réponse sans paramètres inchangée), tampon TLS 4 Ko, contrôle `Content-Length` de chaque morceau, SHA-256 et métriques sur la concaténation. Espaces de travail du chemin fragmenté **statiques** (feeder, SHA, tampon de 128 o, condensat) pour ne pas charger la pile cont de 4 Ko ; non réentrant par construction (un vote à la fois). Journal `[VOTE-NET]` : tas, plus gros bloc et **pile cont libre** avant le GET, à chaque morceau, à la fin.
- OLED : cycle animation 30 s → température 6 s → humidité 6 s → reprise à l'image 0 ; sans animation, les deux pages alternent après les 5 min de l'image fixe. `nextPagesMs` est initialisé à l'activation d'un clip (démarrage ET acquisition) : le premier cycle commence par 30 s d'animation.
- Marqueur `PODWIFI:record-v1` (Wi-Fi lu de la flash) dans le binaire ; le build BWR **échoue** si l'absence des identifiants n'est pas établie.

## Pin complet
| Champ | Valeur |
|---|---|
| Commit source | `76ec58b` sur `main` (arbre propre, reconstruit deux fois : même SHA) |
| FQBN | `esp8266:esp8266:nodemcuv2:eesz=4M2M` (cœur esp8266 3.1.2) |
| Commande | `node ota-lab/esp8266-canary/tools/build-bwr.mjs --ota --seq 17 --version multibwr-2.2 --sensor --oled --display --chunk --define POD_OLED_ANIM=1 --define POD_MULTI_OLED=1` |
| Options | `POD_WIFI_FROM_RECORD=1 POD_WIFI_PORTAL=1 POD_SENSOR_DHT22=1 POD_OLED_STATUS=1 POD_SENSOR_DISPLAY=1 POD_FRAME_CHUNK=1 POD_OLED_ANIM=1 POD_MULTI_OLED=1 POD_OTA=1 POD_OTA_CLIENT=1 POD_OTA_SEQ=17` (`POD_VOTE_CHUNK=1` par défaut du sketch) |
| Image installée (binaire ESP) | 559 936 o, SHA-256 `1c865bc25f74bc6b21645cdd94b71f56a11cef1d972645eceec5d4f612f39fa9` |
| RAM statique | 36 336 o (multibwr-2.1 : 35 736 o ; règle ≤ 40 000 o respectée ; +600 o dont les espaces de travail statiques du vote) |
| Région signée | `f09f75de15c0208f45d45deb32dd80b16d7709bdb0c74968e9181dd7dd11287c` |
| Fichier signé servi (`image.bin`) | 560 260 o, SHA-256 `bee2d200ea21c26e13c49009e90434eb927b1d4f582024e8021704ed4cc83ad4` |
| Manifeste | `manifest.json`, SHA-256 `6bad6ad00408ce2f9c39b6f60ee854ccea1879a65ddfa6316422b0580c596fdf` |
| Famille / version / séquence / canal | `esp8266-multibwr` / `multibwr-2.2` / 17 / `canary` |
| Cible | **uniquement** `dev_T46HBXG1` (`canaryDevices`, vague 100/100) |
| Clé de signature | `ota-a` (RSA-2048), hors dépôt |
| Preuve Wi-Fi | `wifiGuard=true`, `ssidAbsent=true` : 2 valeurs interdites (`~/.pod-wifi-forbidden.txt` + `secrets.h` connus) absentes des octets ; marqueur `PODWIFI:record-v1` présent ; `PODWIFI:compiled-v1` absent ; aucun `secrets.h` dans le dossier compilé |
| Staging (hors Git) | `canary-builds/ota-staging/multibwr-2.2-ota17/{image.bin,manifest.json}` — **non copié dans `ota-releases/`** |

Pin de build : `docs/mesures/MULTIBWR_2026_10_31/MULTIBWR-2.2-BUILD-PIN.json`.

## Vérifications faites (hôte uniquement)
- Serveur : `candidateFrame.test.ts` (concaténation des morceaux == contenu entier, `X-Raw-Hash` du contenu entier, paramètres invalides refusés) ; quorum adaptatif (`quorumNeeded.test.ts`).
- Firmware : test de texte + mutants (feeder, SHA, tampon redevenus locaux → détectés) ; **la vraie fonction `podoaPages()` extraite du sketch et compilée avec g++** : 30 s d'animation, température 6 s, humidité 6 s, reprise à l'image 0 (`resets=1`), recommence à 72 s ; compilation ESP8266 réelle (559 936 o).
- Non faits : aucune exécution sur carte ; la pile cont réelle pendant le vote est à relever sur le journal `[VOTE-NET]`.

## Suivi après publication (sur GO seulement)
1. Serveur, lecture seule : `device:dev_T46HBXG1.firmware` passe de `multibwr-2.1` à `multibwr-2.2` ; `devlog:dev_T46HBXG1` ne montre plus de cycles `register` répétés après un `candidat GET`.
2. Un vote signé apparaît (`vote POST → 200 … vote v2`) et `candidate:voters:<id>` contient `dev_T46HBXG1` ; `missedVotes` revient à 0 au vote suivant.
3. OLED (retour visuel du cousin) : animation, puis température, puis humidité, puis reprise ; mesures DHT toujours envoyées (`meas:dev_T46HBXG1`).
4. **Retrait immédiat** de la release (supprimer `ota-releases/multibwr-2.2-ota17/` et fusionner) si : pas de réinscription en `multibwr-2.2` sous 12 min, redémarrages répétés, ou perte du vote/des mesures.

## Reste hors de cette release
`dev_KAD6PKC4` (`multiscreen-2.8`, e-ink 2,7″ + OLED) plante de la même façon ; son sketch (`esp8266/esp_eink_2.7BW_OLED`) n'utilise pas encore `podFetchAndCheckChunked`. À traiter dans un lot séparé, après le résultat de celle-ci.
