# OTA-3 — canari automatique A → B → A (UNO R4 WiFi) · 16/10/2026

> **Écrit, compilé et testé sur l'HÔTE seulement. Jamais exécuté avec une carte** : aucun port série réel n'a été ouvert, aucun téléversement, aucun `arduino-cli board list`. Niveaux : `[hôte]` testé sur PC avec un simulateur · `[code]` lu · `[hyp]` hypothèse. Lancement : double-clic sur `ota-lab/r4-ota3/RUN-CANARY.cmd`. Sketch du lot : commit `9e9a9df` (mode `OTA3_AUTO`) ; sonde manuelle et ticket : `f5ff31d` (non modifié).

## 1. Ce que fait le banc (une commande, une confirmation)

| # | Étape | Qui | Destructif ? |
|---|---|---|---|
| 1 | prévol : tests hôte du lot, versions, `secrets.h` présent ET ignoré par git, cœur Renesas 1.6.0, arbre git propre sur les fichiers du lot, port 8080 libre | `preflight.mjs` | non |
| 2 | compilation de A et B (`-DOTA3_AUTO=1`, identifiant de run aléatoire par build), taille et SHA-256 des `.bin` figés dans `images.json` ; fabrication de `good.ota` (= B) et `to-a.ota` (= A) dans un dossier de service qui ne contient QUE ces deux fichiers | `real-io.mjs` | non |
| 3 | détection : exactement UNE carte compatible (FQBN exact, port série) ; zéro ou plusieurs → arrêt, jamais de choix arbitraire | `orchestrator.mjs` | non |
| 4 | résumé + **confirmation unique** : taper exactement `OTA3-A-B-A` | porteur | — |
| 5 | serveur local (journal capturé) | `real-io.mjs` | non |
| 6 | **téléversement de A** par `arduino-cli upload --fqbn arduino:renesas_uno:unor4wifi -p <port>` (le cœur choisit son outil) — ce téléversement remplace le firmware de production | `arduino-cli` | **oui** |
| 7 | attente de l'identité de A, SHA-256 de la flash programme = `.bin` de A, CRC de la flash de données (ligne de base) | machine | non |
| 8 | `w`, `s`, `d good`, `e <sha> <taille>`, `r` (ticket), `U` (ticket + armement), `YES` (ticket + consommation + `update_begin`) | machine + sonde | **oui** (reprogrammation A → B) |
| 9 | nouvelle identité (même puce, build B, bon `run_id`), 5 CRC de data flash identiques, SHA-256 de la flash = `.bin` de B | machine | non |
| 10 | idem B → A avec `d to-a` | machine + sonde | **oui** |
| 11 | arrêt du serveur, `verdict.txt`, `verdict.json`, journaux, `recovery.txt` si besoin | orchestrateur | non |

Aucune commande n'est saisie à la main, aucun hash n'est comparé à la main, le port COM n'est jamais retrouvé à la main.

## 2. Sécurité — arrêt fermé

Le ticket de flash **reste dans le sketch** (`ota3_ticket.h`, une seule logique) : la machine exige les événements `ticket` `ok=1` avec la bonne taille et le bon SHA-256, trois fois par jambe (`r`, `U`, `YES`). Le ticket est **consommé avant `ota.update()`** (valeurs attendues effacées, dernier `verify()` invalidé) : retour, échec ou délai d'`ota.update()` n'autorisent AUCUN retry ; un nouveau `U` exige un nouveau `d`, un nouveau `e` et une nouvelle relecture.

Arrêt au premier écart : délai, événement inattendu, mauvaise build ou mauvais `run_id`, mauvais SHA-256 de flash, mauvais vecteur / ticket refusé, autre puce, CRC de data flash modifié, `boot` non prévu, `update_begin` répété, `ota.update` qui revient, disparition de port ou perte de flux **hors reprogrammation**, plusieurs cartes, ligne `@OTA3` invalide, ligne `STOP` de la sonde. **Aucun retry** : le téléversement de A n'est essayé qu'une fois. Liste blanche de commandes (`protocol.mjs`) appliquée avant toute écriture : `d good` / `d to-a` seulement — `badmagic`, `badpayload`, tout autre cas, `h 0` et `h > 245 760` sont impossibles à envoyer (testé).

## 3. Preuve de succès d'une reprogrammation (point 1 du GO)

La disparition du port n'est **ni exigée ni suffisante**. Sont acceptés : port resté présent avec flux interrompu, port disparu puis revenu, port revenu sous un autre COM (le banc suit la carte par son numéro de série USB et refuse toute ambiguïté). La preuve est un **nouvel événement d'identité** (`boot`, ou `hello` en réponse à `m` si le `boot` a été manqué pendant la reconnexion) portant : le même identifiant de puce RA4M1, la bonne lettre de build, le bon `run_id`, les 5 CRC de data flash de départ ; **puis** `h <taille>` doit rendre le SHA-256 du `.bin` exact construit pour cette build (le pont ne vérifie rien après l'écriture BOSSA `[code]`). Une absence d'identité dans le délai est un échec.

## 4. Protocole `@OTA3` (sketch compilé avec `OTA3_AUTO=1`, absent sinon)

Une ligne par événement, `@OTA3 {json}`, < 250 caractères (testé au pire cas) : `boot`/`hello` (build, `run`, `uid` 128 bits, cause du reset, `n` = 8192, `fcrc` ×5), `wifi` (ok, IP), `server`, `stage` (cas, `dl`, `vf`), `expect`, `ticket` (ok, why, taille, SHA-256), `armed`, `update_begin`, `update_returned`, `fhash` (taille, SHA-256), `err`. Commandes ajoutées en mode auto : `h <taille>` (SHA-256 de la flash programme `0x4000…`, lecture seule, taille 1..0x3C000) et `m` (ré-émet l'identité). Le mode manuel (`OTA3_AUTO=0`, défaut) n'émet rien et n'a ni `h` ni `m` (testé).

## 5. Fichiers

Créés : `ota-lab/r4-ota3/canary/` (`protocol.mjs`, `machine.mjs` pure, `boardsim.mjs`, `board.mjs`, `preflight.mjs`, `verdict.mjs`, `transport.mjs`, `serial-bridge.ps1`, `orchestrator.mjs`, `real-io.mjs`), `RUN-CANARY.cmd`, `tests/canary-*.test.mjs`, `tests/helpers/canarySimIo.mjs`, ce document. Modifié : `.gitignore` (`runs/`, `artifacts/canary/`), `README.md`. Résultats d'un run (ignorés par git) : `ota-lab/r4-ota3/runs/<horodatage>/` = `verdict.txt`, `verdict.json`, `serial-A-to-B.log`, `serial-B-to-A.log`, `server.log`, `preflight.txt/.json`, `images.json`, `recovery.txt` (en cas d'échec après téléversement). Le verdict ne contient ni IP, ni secret, ni identifiant de puce complet ; les journaux bruts contiennent des adresses privées et restent locaux. Les binaires (qui embarquent le Wi-Fi) restent dans `artifacts/canary/<run>/`.

## 6. Preuves `[hôte]` et limites

- Machine pure : 18 scénarios (succès, ports disparus/revenus/changés, `hello`, chaque défaut injecté) + **mutants** : retirer l'une des 16 gardes (uid, ancienne image, mauvaise build, data flash, hash avant/après, `vf`, taille, ticket, `update_returned`, boot inattendu, hello incohérent, port inattendu, flux perdu, IP nulle, retry, timeout, erreur de la sonde) fait dévier au moins un scénario.
- Orchestrateur contre un `io` simulé : ordre (confirmation AVANT téléversement), une seule confirmation, un seul téléversement, 6 confirmations erronées, prévol en échec, 0 / 2 cartes, échec de téléversement + `recovery.txt`, 7 défauts en cours de route, disparition silencieuse, seconde carte, changement de COM sans fermeture de flux ; 9 mutants de l'orchestrateur.
- Pont PowerShell : syntaxe analysée par PowerShell ; sur un port INEXISTANT (`COM999`) il rend une erreur JSON et le code 3. Transport testé avec un faux processus. **Le pont n'a jamais ouvert de vrai port** : première inconnue du GO matériel.
- **Non démontré** : l'ouverture d'un vrai port USB par `SerialPort` (DTR, réouverture après réénumération), le format réel de `arduino-cli board list` / `upload` avec cette carte, le comportement du pare-feu Windows pour le serveur, la détection par numéro de série USB (si la carte n'en expose pas, le banc se rabat sur « une seule carte compatible »), le délai réel de reprogrammation (timeouts : 300 s pour la reprogrammation, 60 s pour le démarrage — à ajuster après mesure).

## 7. GO matériel — séquence proposée (non lancée)

1. Sonde de lecture seule : ouvrir le port, lire une bannière, rien envoyer (valide le pont et le format de `board list`).
2. `RUN-CANARY.cmd --dry-run` : prévol et compilation réels, carte fictive, confirmation impossible (aucun port énuméré).
3. Run complet avec confirmation `OTA3-A-B-A` : carte seule branchée, shield TFT retiré, moniteur série de l'IDE fermé.

## 8. Essai à blanc RÉEL (`--dry-run`, carte fictive, aucun port énuméré ni ouvert) — 16/10/2026

Lancé deux fois sur ce PC, commit `eb7fbbb` :
1. **Prévol réel** : 9 vérifications sur 10 OK (dont les 51 tests hôte), et **l'ÉCHEC attendu** « port TCP 8080 libre » : l'ancien serveur `serve-r4.mjs` du porteur écoute encore (`netstat` : PID 23096). → **Fermer ce serveur avant le vrai run, ou lancer `RUN-CANARY.cmd --port 8091`** (le banc démarre son propre serveur ; l'ancien ne doit plus tourner).
2. Avec `--port 8091` : prévol complet OK, **compilation réelle de A et de B** (76 556 o chacune, identifiants de run distincts), `good.ota`/`to-a.ota` fabriqués dans un dossier de service qui ne contient que ces deux fichiers, carte fictive acceptée comme unique candidate, **confirmation refusée (`DRY-RUN`) → ABORTED « rien n'a été téléversé »** ; `verdict.txt`/`.json`, `images.json`, `preflight.txt/.json` écrits sans IP ni secret.

Ce que l'essai à blanc a fait trouver (corrigé avant le commit) : un filtre de verdict trop large (le mot « secrets.h » d'une ligne de prévol le faisait planter) et un orchestrateur qui pouvait planter à la toute fin ; le garde « arbre git propre » a aussi bloqué un run lancé avec une modification non commitée — comportement voulu. Non couvert par l'essai à blanc : détection d'une vraie carte, pont série réel, `arduino-cli upload`.
