# Release `multiscreen-2.9` séquence 18 — PRÉPARÉE, NON PUBLIÉE (01/11/2026)

Statut : compilée, signée dans un dossier de staging hors de `ota-releases/`, contrôle de pré-publication OK. **Jamais flashée, jamais essayée sur une carte. Aucun GO de publication.** À auditer par Codex avant tout GO.

## Pourquoi
`dev_KAD6PKC4` (multiscreen e-ink 2,7″ + OLED) ne vote pas : dernier vote le 30/10, `missedVotes = 3`, et son journal serveur montre `candidat GET → 200` puis un nouveau `register` sans `validation-result` — le même schéma que `dev_T46HBXG1` avant `multibwr-2.2`. Les « v1 écho × 2 » du bloc #130 ne viennent PAS de cette carte : c'est une animation (aucune spécification v2, vote v1 par construction) et les deux validateurs étaient `dev_MN67OG7R` et `dev_T46HBXG1`. Cause du plantage : **hypothèse**, pas preuve (tampon TLS de 16 Ko + tampon de travail pendant la lecture du candidat).

## État de la carte (lu côté serveur)
`multiscreen-2.8`, écrans `oled096` + `eink27bw`, `sensors: ["temp","hum"]` déclarés alors qu'**aucun capteur n'est branché**. C'est l'image d'essai du 23/10 (`--ota --sensor`, séquence OTA **8**, `ota-lab/esp8266-canary/MS27-OTA-DHT-BUILD-PIN.json`). La séquence de la release doit donc être > 8 ; le contrôle de pré-publication exige en plus > toutes les séquences publiées (17) → **18**.

## Contenu
- Lecture du candidat par morceaux de 2 368 o (`podFetchAndCheckChunked`, déjà dans `pod_vote_esp.h` et déjà utilisée par `multibwr-2.2`), tampon TLS de 4 Ko, espaces de travail statiques. Option `POD_VOTE_CHUNK` (1 par défaut ; 0 = lecture d'une traite d'avant).
- **Sans code capteur** (`POD_SENSOR_DHT22` = 0) : la carte cesse de déclarer `temp`/`hum` à `/api/register` — le menu « Mesures » fantôme disparaît de son profil. Conséquence à annoncer : c'est un changement de comportement visible.
- Marqueur `PODWIFI:record-v1` ajouté au sketch multiscreen + lecture au démarrage ; le contrôle fermé de l'outil de build (`build-bwr.mjs`) s'applique maintenant à **toutes** les cibles (il ne couvrait que le BWR) : le build échoue si l'absence des identifiants Wi-Fi n'est pas établie.

## Pin
| Champ | Valeur |
|---|---|
| FQBN | `esp8266:esp8266:nodemcuv2:eesz=4M2M` (cœur 3.1.2) |
| Commande | `node ota-lab/esp8266-canary/tools/build-bwr.mjs --target ms27 --ota --seq 18 --version multiscreen-2.9` |
| Image installée (binaire ESP) | 586 704 o, SHA-256 `b80a5a74240e73470067fecb656f5d1551e8fd7dabfd5de4723d845abd3ac22f` |
| RAM statique | **37 876 o** (règle ≤ 40 000 o respectée) |
| Région signée | `f5d1ac8a518abccfc9a062e6907faf2f1041342c9f9e4e952bfc3d255c7cd212` |
| Fichier signé (`image.bin`) | 587 028 o, SHA-256 `149d7d6bf3524dce1ef09e6c399e2c123e38bcf3afcdebdb11e94ed78c0f7281` |
| Manifeste | SHA-256 `c68d23b1c73ffd5f9f022ba33e23e1f8439bdd2a6cd72c5ecb49e0f05e5396bd` |
| Famille / version / séquence / canal | `esp8266-multiscreen` / `multiscreen-2.9` / 18 / `canary` |
| Cible | **uniquement** `dev_KAD6PKC4` |
| Clé | `ota-a` (RSA-2048), hors dépôt |
| Wi-Fi | `wifiGuard = true`, `ssidAbsent = true` |
| Staging (hors Git) | `canary-builds/ota-staging/multiscreen-2.9-ota18/{image.bin,manifest.json}` — non copié dans `ota-releases/` |

Pin de build : `docs/mesures/MULTISCREEN_2026_11_01/MULTISCREEN-2.9-BUILD-PIN.json`. Le `FIRMWARE_VERSION` du sketch reste `multiscreen-2.7` : la version est imposée par la commande de build (comme pour le BWR).

## Vérifié (hôte uniquement)
- `tests/multiscreenVoteChunk.test.ts` (appel par morceaux par défaut, copie locale == socle, marqueur Wi-Fi, garde de build étendue) ; les tests d'identité « options à 0 == firmware d'avant » (`wifiMsFirmware`, `esp8266Eink27OledCanary`) passent avec la normalisation de l'appel et de la ligne de marqueur ; `tsc --noEmit` propre.
- Six tests du harnais hôte du canari 8B2C (« HÔTE OFF / ON / CANARI ») échouent **déjà sans ces modifications** (vérifié par `git stash`) : préexistants, non traités ici.
- Compilation ESP8266 réelle OK. **Non fait** : exécution sur carte ; la pile cont réelle pendant le vote (lignes `[VOTE-NET]`) reste à relever.

## Suivi après publication (sur GO seulement)
1. Serveur, lecture seule : `device:dev_KAD6PKC4.firmware` passe de `multiscreen-2.8` à `multiscreen-2.9` ; `sensors` disparaît ; plus de cycles `register` répétés après un `candidat GET`.
2. Un vote signé (`vote POST → 200`) pour un **dessin fixe** (un vote sur animation reste v1 par conception) ; `missedVotes` revient à 0.
3. Retour visuel : dessin et OLED comme avant.
4. **Retrait immédiat** si pas de réinscription en 2.9 sous 12 min (un redémarrage manuel peut être nécessaire, comme pour `multibwr-2.2`), redémarrages répétés ou perte d'affichage. Toute correction = nouvelle séquence.
