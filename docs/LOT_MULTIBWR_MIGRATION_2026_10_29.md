# Lot MULTIBWR — multiscreen e-ink BWR 2,9″ + OLED 0,96″ + DHT22 (29/10/2026)

Statut : **compilé + testé sur l'hôte, signé, JAMAIS publié, jamais flashé.** Définition validée par le porteur : `dev_T46HBXG1` est un **vrai multiscreen** (deux écrans réseau, une identité, une voix), pas un « BWR avec OLED auxiliaire ». Le montage « OLED auxiliaire » (`eink29bwr-2.13`) était une erreur de définition de ma part ; elle explique l'OLED figé et la mise à jour 2.14 qui ne pouvait pas arriver au bon résultat.

## Produit
**Multiscreen — e-ink BWR 2,9″ + OLED + DHT22.** Firmware `multibwr-2.1`, famille OTA `esp8266-multibwr`, écrans déclarés `["eink29bwr","oled096"]`, capteurs `temp`,`hum`. Aucune capacité `anim-oled` : l'OLED est un écran du réseau, pas un auxiliaire (`oled096aux` reste servi aux firmwares déjà distribués).

## Choix de construction (écart assumé avec le prompt « pars du multiscreen 2,7″ »)
Le firmware BWR contient déjà, validés, tous les composants que le prompt demande de ne pas réinventer : pilote BWR, plans noir/rouge, morceaux, mémoire TLS, ACK, OTA, DHT22, OLED, lecteur d'animations en flash brute. Le multiscreen 2,7″ n'apporte que **le protocole à deux écrans** (frame OLED de 1 024 o, ACK par écran, identifiant mémorisé par écran). Je l'ai porté dans le BWR (option `POD_MULTI_OLED`, 0 par défaut = firmware d'avant au texte près : tout le texte d'origine reste HORS des blocs `POD_BWR`, vérifié contre `ad2e672`) plutôt que de transplanter le pilote BWR et ses optimisations mémoire dans un sketch de 2 800 lignes à LittleFS : moins de lignes touchées, tas BWR inchangé.

| Brique | Source |
|---|---|
| Pilote e-ink 2,9″ BWR, plans, morceaux, rendu, cartel, persistance, ACK e-ink | BWR (inchangé) |
| Client OTA Internet | BWR (inchangé) ; famille compilée `esp8266-multibwr` |
| DHT22 (D3), envoi, écran de mesures OLED | BWR (inchangé) |
| Lecteur d'animation (clip en flash brute, flux) | BWR `POD_OLED_ANIM` (inchangé) ; alimenté par le pointeur de la frame **oled096** |
| Frame OLED, ACK par écran, mémoire par écran | **nouveau**, calqué sur le multiscreen 2,7″ (`doFetchFrameOled`, `ackFrame(id, "oled096")`) |

## Comportement
- Le pull porte `screen`. `eink29bwr` : chemin BWR habituel, **toujours avec `&screen=eink29bwr`** (sinon le serveur prend la plus ancienne frame des deux files). `oled096` : l'image (1 024 o, format natif du tampon SSD1306) est lue **directement dans le tampon de la bibliothèque** (aucune allocation pendant le TLS), affichée, acquittée avec `screen:"oled096"`.
- Le pointeur d'animation n'est lu **que** sur une frame `oled096` (un pull sans frame ou avec une frame e-ink ne touche jamais à l'animation en cours). Pointeur présent → clip téléchargé réseau libre (`podoaService`) et joué en boucle ; absent → l'animation précédente s'arrête.
- Une image fixe de l'OLED est tenue 5 minutes ; ensuite l'écran de mesures reprend. Une animation joue sans interruption, réseau/vote/capteur/OTA passent avant.
- Bus I2C réarmé avant chaque usage de l'OLED (correctif du gel : `SPI.begin()` de l'e-ink met GPIO12/D6 en fonction SPI) — déjà dans `main` (`d743c6c`).

## Serveur (4 lignes)
`VOTE_V2_FIRMWARE.multibwr = [2,1]` · `ANIM_POINTER_FIRMWARE.oled096.alt += multibwr 2.1` · `OTA_CLIENT_FIRMWARE.multibwr = [2,1]` + `OTA_FAMILIES.multibwr = esp8266-multibwr` · `hardware.ts`. Tables du noyau C++ (`podOta.h`, `podOtaR4.h`) alignées (test de parité). Anciennes cartes BWR, ancien multiscreen 2,7″ et `oled096aux` : règles inchangées (testé).

## Migration OTA — le point qui piège
Le client **installé** (`eink29bwr-2.13`) rejette toute version dont le préfixe n'est pas dans sa table de vote (`not-vote-capable`, `podOta.h`). Une release dont le manifeste annonce `multibwr-2.1` serait donc **refusée** par la carte. La release de migration est donc :
- famille `esp8266-eink29bwr` (celle du client installé), séquence **16** (> 14 installée, > 15 de la release 2.14), canal canari, cible **`dev_T46HBXG1` seul** ;
- version de **manifeste et de trailer** `eink29bwr-2.15` (préfixe connu du client installé) ;
- **binaire** qui se déclare `multibwr-2.1` à son premier `/api/register`, avec famille OTA `esp8266-multibwr` : les mises à jour suivantes sont des releases `esp8266-multibwr`.
Identité (clé privée, `deviceId`), Wi-Fi (enregistrement EEPROM), blocs possédés et état d'appairage ne sont pas touchés : aucune zone EEPROM n'est écrite par la variante.

## Build et mesures
Binaire `multibwr-2.1` séquence 16 : **558 592 o**, RAM statique **35 736 o** (+96 o sur 2.14 : 35 640 ; règle ≤ 40 000 respectée). SHA-256 complets : image `f6db0289f1130dd54cb34b7b54cd78aaab06785e93b0a480faa968ba061a752e` · fichier signé (558 916 o) `4624072f76a0c2463479a1b8dce473cac8035a294e10b0014bcdfa6624470ea5` · région signée (558 656 o) `1c85f1e731a110bd1742b59e71b0810f549510257bd241e6eb3c23d39dcf1935` (manifeste : famille `esp8266-eink29bwr`, version `eink29bwr-2.15`, séquence 16, canari `dev_T46HBXG1`, clé `ota-a`). Pin suivi : `docs/mesures/MULTIBWR_2026_10_29/MULTIBWR-2.1-BUILD-PIN.json` (FQBN, options exactes, test `multiBwrPin`). Tas / plus grand bloc : **non mesurés** (aucune carte ici) — le tas pendant le téléchargement OTA est le risque principal (3,7 Ko de marge sur le BWR ; l'OLED réel en consomme ≈ 2,7 Ko).

## Preuves (tests/multiBwr.test.ts, 11 tests)
1 deux écrans déclarés · 2 BWR fixe (écran nommé dans les deux URL) · 3 OLED : frame, ACK par écran, pointeur réservé à l'OLED, animation jamais sur l'e-ink · 3 bis mesures entre animations · 4 DHT22 · 5-6 un seul `/api/register`, table de vote client **et** serveur, vote sur les quatre formats · 7 identité/Wi-Fi/EEPROM · 8 migration acceptée par le client installé (famille, préfixe connu, séquence, canari) · 9 futures OTA de la famille `multibwr` · 10 un binaire d'une autre famille (2,7″ BW) n'est jamais éligible. **Limite : le texte du sketch est vérifié, pas son exécution** (pas de harnais hôte du pull à deux écrans).

## Risque principal non levé : l'échec de la 2.14
La mise à jour `eink29bwr-2.14` (séquence 15) a été **tentée puis la carte est revenue en 2.13**. La cause est inconnue (je n'ai pas le journal série `[OTA]`). La migration utilise **le même client** : sans cause établie, elle peut échouer pour la même raison. À fournir avant tout GO : les lignes `[OTA]` du démarrage du 29/10 ~14:07 (annonce, pile, garde « contigus », tas pendant le téléchargement, `image seq=… état=… tentatives`). Possibles : garde mémoire (24 000 o contigus) → refus sans risque, nouvel essai ; écriture / vérification ; OLED réel qui réduit le tas.

## Protocole du canari (chaque ligne = un accord distinct)
1. **Toi** : fournir les lignes `[OTA]` de la tentative 2.14 (ou une capture du prochain pull).
2. **Moi** (sur GO) : retirer la release 2.14 (`ota-releases/eink29bwr-2.14-ota15/`) pour qu'elle ne soit plus réessayée, commiter `ota-releases/eink29bwr-2.15-ota16/` — **la fusion dans `main` = l'envoi** (porte `ota:kill` actuellement ouverte).
3. **Toi/moi** : surveillance serveur (`scripts` de suivi) : `firmware` doit passer à `multibwr-2.1`, `screens` à deux écrans, `caps` vidé ; mesure `meas:dev_T46HBXG1` à l'heure.
4. Contrôle visuel par le cousin : OLED = température/humidité (plus « en attente »). E-ink : image conservée.
5. Une œuvre fixe → e-ink ; **GO animation** → pointeur, clip, boucle sur l'OLED ; mesures entre les animations.
6. Échec : une image refusée ou incomplète laisse l'ancien firmware en place (c'est ce qu'on a vu le 29/10 avec la 2.14) ; une image installée mais défaillante n'a **pas de retour arrière automatique** → restauration par câble (sauvegarde `canary-builds/…/backup-*.bin`, contient le Wi-Fi : ne jamais partager).

## Corrections de l'audit Codex (29/10/2026)
1. **Image de l'OLED** : `doFetchFrameOled` libère `blackBuf`/`redBuf` AVANT tout TLS, les garde libérés pendant le téléchargement ET l'ACK, puis les réalloue et les initialise sur TOUTES les sorties (le flux interne `oledFrameFlow` est séparé de l'enveloppe : aucun retour anticipé ne peut sauter la restauration) ; réallocation échouée = journal puis redémarrage fermé.
2. **ACK** : `ackFrame(frameId, "oled096")` est contrôlé ; `g_lastFrameIdOled`, le succès et le message « affichée et acquittée » ne sont posés qu'après un ACK HTTP réussi ; après un ACK échoué la frame reste retentable au prochain pull.
3. Preuves : `tests/multiBwrOledFlow.test.ts` (invariants sur le texte du sketch + 11 mutants refusés : plans vivants, libérés trop tard, retour anticipé, pas de réallocation / de redémarrage / d'initialisation, ACK ignoré, identifiant avant l'ACK ou malgré l'échec, ACK échoué rendu vrai, succès annoncé trop tôt, plans touchés par le flux).

## État de la porte et de l'échec 2.14
- `ota:kill` lu en lecture seule le 29/10/2026 : **clé ABSENTE** (valeur nulle) ⇒ pas de kill-switch posé ⇒ la porte est **OUVERTE** (OTA_DIST_MODE=on). Toute publication de release ciblée y est donc servie dès la fusion. À re-lire juste avant toute publication.
- **L'échec de la 2.14 (séquence 15) reste NON EXPLIQUÉ** : aucun journal série n'existe ni n'existera pour cette carte. Le canari 2.15 (migration) doit être surveillé côté serveur (`firmware`, `screens`, `caps`, dernière mesure, requêtes `/firmware/…` dans les logs de plateforme) et ne vaut PAS preuve tant qu'il n'a pas abouti.
