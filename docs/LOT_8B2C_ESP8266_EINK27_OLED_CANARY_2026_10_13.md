# Lot 8B-2C — LOT8B2C-ESP8266-EINK27-OLED-CANARY-1 (13/10/2026)

Canari **sans vote** du firmware ESP8266 + e-ink 2,7″ BW V2 + OLED SSD1306 (`esp8266/esp_eink_2.7BW_OLED/`). Rendu v1 sur le chemin e-ink seul ; le chemin OLED n'est pas modifié.
**Compilé et simulé sur l'hôte seulement — jamais flashé, jamais essayé sur une carte.** Arrêt pour audit GPT avant tout flash.

## 0. Base (vérifiée avant toute modification)

- Branche `claude/esp8266-eink27-oled-canary-8b2c`, worktree séparé, **base `e059db3`** (`LOT8B2C-ESP8266-EINK29-CANARY-FIX2`, canari 2,9″ validé sur carte).
- Contient : la propagation `POD_RENDER_V1` aux huit firmwares à cartel gravé (lot 8B-2B-1, dont e-ink 2,7″ + OLED), les correctifs validés du 2,9″ (FIX1/FIX2) et le firmware 2,7″ + OLED actuel. Une seule base, aucun cherry-pick ; **aucune** branche TFT tactile ni vote intégrée.
- Sauvegarde d'avant : `firmware-backups/2026-10-13_avant-canari-esp8266-eink27-oled/` (sketch + pilote).

## 1. Ce qui n'est pas copié du 2,9″ (et pourquoi)

| 2,9″ BWR | 2,7″ BW + OLED |
|---|---|
| deux plans de 4 736 o (9 472 o) reçus par `readFull` | **un** plan de 5 808 o (22 × 264) ; route flash (LittleFS `/e27.tmp`, écrit PENDANT le TLS) ou route RAM (repli) ; plan `malloc` seulement APRÈS la fermeture du TLS pour la route flash |
| un seul périphérique | **SPI (e-ink) et I²C (OLED) partagent GPIO12** : l'OLED doit être ré-initialisé après chaque usage SPI |
| `ReadBusy()` borné | `ReadBusy()` **illimité** en production (inchangé) ; en canari plafond de 20 s, durée mesurée |
| ACK de la frame personnelle | idem ; deux écrans annoncés (`oled096`, `eink27bw`) : l'ACK porte `SCREEN_E27` |
| animations/banc d'essai absents | **présents** (OLED) : neutralisés en canari (aucune requête de clip) |

Reprises du 2,9″ (principe, non copie aveugle) : pré-vol BearSSL avant le TLS (tas ≥ 24 000 o, bloc ≥ 17 000 o), TLS fermé avant le rendu, taille de corps exacte (Content-Length + surplus), échec fermé, **l'ACK HTTP 200 décide du succès**, mémoire restituée après le TLS, trace de phases en RTC + analyse de la cause de reset, abandon après 2 resets anormaux consécutifs.

## 2. Ce que le canari ajoute (`#if POD_RENDER_V1 && POD_CANARY`, et rien d'autre)

1. **Aucun vote** : `doValidate()` retourne `false` en tête (candidat oublié localement, ligne `AUCUN vote en build canari`), `doObsConfirm()` idem — aucun `validate-candidate`, `validation-result`, `obs-confirm`, signature ni `malloc`. Le canari reçoit, affiche et acquitte les frames qu'on lui propose (le verdict matériel a été obtenu sur une frame `source=consensus` déjà minée) ; **l'invariant exact est : aucun candidat n'est validé et aucun vote n'est envoyé en build canari** (la formulation « seule une frame personnelle est traitée » des versions précédentes était trop stricte).
2. **Pas d'animation/banc d'essai** : `newBenchMode`, `newAnimHash`, `newAnimBytes` forcés à vide avant `podbenchesp::onPull` / `podanimesp::onPull` (ligne `IGNORES en build canari`).
3. **Pré-vol TLS** avant le téléchargement et avant l'ACK (`REFUS pre-vol TLS` : destination libérée, aucun ACK, nouvel essai au pull suivant, sans polling accéléré).
4. **Corps exact** : Content-Length ≠ 5 808 ou octets en surplus ⇒ `bRead = 0` ⇒ destination libérée, aucun rendu, aucun ACK.
5. **Phases** (RTC `PC27`) : BOOT, WIFI, REGISTER, PULL, FETCH, PLANE_DEST, TLS_OPEN, BODY, TLS_CLOSED, PLANE_READY, FRAMEHASH, PANEL, STREAM, FINISH, ACK, OLED, DONE ; cause de reset, 2 resets anormaux ⇒ arrêt sans réseau.
6. **Instruments** : tas libre, plus grand bloc contigu, fragmentation (avant/après TLS, rendu, ACK), pile `cont`, plus long intervalle entre deux appels du producteur (alerte > 0,5 s : chien de garde ≈ 3,2 s), durée de chaque attente BUSY (nombre, total, max, expirations ; alerte > 8 s), orientation.
7. **Sonde OLED** (`canaryOledProbe`) après l'e-ink, sur chaque issue (succès, échec du rendu, ACK refusé, pré-vol refusé) : appelle `ensureOLEDReady()` (Wire.begin + oled.begin), restitue `oledArtBuf` à l'écran, journalise `pret_avant / spi_actif_avant / reinit / affiche_en_memoire`.
8. **ACK** : en canari `lastFrameIdE27`, `lastFrameWasConsensus`, `pendingCandidateId` ne sont écrits **qu'après** un ACK HTTP 200 ; ACK refusé ⇒ `return false`, la frame sera reproposée (≥ 60 s).
9. **Pilote** : `Epd::ReadBusy()` borné à 20 s et mesuré **uniquement** en canari ; en production le texte est celui d'avant (test d'égalité).

## 3. Preuves

### Statiques (`tests/esp8266Eink27OledCanary.test.ts`)
Drapeaux 0/0 ; OFF == sauvegarde au texte près (sketch et pilote) ; tout le canari sous la garde ; chaînes en flash ; aucun code R4/WiFiS3 ; aucune route nouvelle ; aucun accès réseau dans le chemin de vote ; ordre pré-vol → ACK → état acquitté ; code OLED/bus de production identique à l'avant ; seuils BearSSL.

### Hôte — code réel extrait (`consensus-pod/host/esp27_frame_harness.cpp`, `esp_mock/esp27_mock.h`)
Six configurations vertes (OFF / ON / CANARI × avec et sans chemin de vote) : **110 / 156 / 227** vérifications sans vote, **119 / 165 / 243** avec ArduinoJson réel. Scénarios : nominal route flash et route RAM, fragmentation (aléatoire, 200 tirages), réponse tronquée / trop longue / Content-Length inconnu, allocation et flash refusés, HTTP ≠ 200 / `begin` / TLS −1, échec d'`Init` du panneau et du producteur, images uniformes, **bus et OLED après l'e-ink** (le modèle journalise toute « VIOLATION » : opération du panneau sans SPI, OLED pendant le SPI ou avant `Wire.begin`), ACK refusé, fuites sur cycles répétés, attente minimale de 180 s, BUSY normal / bloqué (production : ne rend jamais la main ; canari : plafond ≈ 20 s), géométrie du plan, pré-vol, RTC/reset, neutralisation animation/banc d'essai, vote.

### Contrôles négatifs (20 mutants, tous refusés)
ACK avant le rendu ; ACK malgré échec du rendu ; garde Content-Length/surplus ; refus sans effet ; pré-vol avant téléchargement et avant ACK ; résultat de l'ACK ignoré ; frame marquée acquittée avant l'ACK ; plan non libéré ; vote autorisé / sans oubli du candidat / sans retour anticipé ; animation non neutralisée ; producteur sans `yield` ou > 32 o ; plafond BUSY supprimé ; abandon sur 2 resets supprimé ; OLED non ré-initialisé ; SPI non terminé ; sonde OLED retirée.

### Compilation (cœur esp8266 3.1.2, xtensa gcc 10.3, `--warnings all`) — `docs/mesures/8B2C_27_2026_10_13/`
| config | RAM statique | flash |
|---|---|---|
| OFF (défaut du dépôt) | 35 200 o | 473 820 o |
| ON (`POD_RENDER_V1=1`) | 35 316 o | 476 956 o |
| canari (`1/1`) | **35 320 o** (< 40 000) | 468 648 o |

Avertissements du projet identiques dans les trois (bibliothèques tierces : AES/qrcode ; `DynamicJsonDocument` déprécié, préexistant). Le ballast de canari est réduit à 20 o pour que la RAM du canari reste égale à celle du ON. Sources compilées = sources du commit (comparées).

## 4. Protocole matériel (porteur, après audit GPT)

Préparation : build local `-DPOD_RENDER_V1=1 -DPOD_CANARY=1` dans `canary-builds/` (ignoré par git, `secrets.h` embarqué) ; **conserver le binaire OFF actuel** (`canary-builds/stable`) comme retour arrière ; carte appairée, EEPROM intacte.

1. **Démarrage sans frame** : lignes attendues `[CANARY] BUILD LOT8B2C-ESP8266-EINK27-OLED-CANARY-1`, cause du reset, RAM statique ≈ 35 320 o, `[HEAP] après WiFi ≈ 38000`, `wifi connecte`, `register OK`, `pull: debut`, `[PULL] aucune frame`. L'OLED doit afficher son contenu habituel.
2. **Une seule frame personnelle** (« Afficher sur mon écran », UUID neuf ; motif asymétrique : **lettre F noire en haut à gauche**, cadre), puis **un reset**. Attendu dans l'ordre : `frame e-ink 2,7 : debut`, destination du plan (fichier flash), pré-vol (tas, bloc), `[HTTP GET] /api/pull-frame (E27) → 200`, `corps : Content-Length=5808 lus=5808 surplus=0`, `TLS FERME`, plan prêt, rendu, **BUSY** (nombre / total / max), ACK 200, `ACK recu`, `OLED apres l'e-ink : … reinit=OK`.
3. **Contrôle visuel** : e-ink (orientation physique **inconnue** — à juger sur la lettre F ; ne pas corriger à l'aveugle) **et** OLED (doit redevenir fonctionnel et réafficher son contenu).
4. **Plusieurs pulls** sans frame (≥ 3, ≈ 3 min) : relever tas / plus grand bloc / fragmentation ; aucun reset.

**Arrêt (rapporter le journal brut)** : toute `ALERTE` ; `REFUS pre-vol TLS` ; `ARRET : deux redemarrages anormaux` ; cause de reset 1/2/3 ; `Exception` ; `BUSY … TIMEOUT (plafond canari)` ; OLED `reinit=ECHEC` ; `[HTTP GET] … → -1` répété ; tout `[VALIDATE…]` / `validation-result` (ne doit **jamais** apparaître).

## 5. Rollback

`git revert` du commit du lot (sketch de `e059db3`, sauvegarde ci-dessus). Matériel : reflasher le binaire OFF ; l'EEPROM n'est jamais modifiée par le canari.

## 6. Limites et points à surveiller

1. **Rien n'est mesuré sur carte** : tas minimal pendant le TLS, contextes BearSSL, fragmentation, durées, chien de garde, rendu et orientation physique. Le pilote 2,7″ V2 n'a **jamais tourné sur matériel** dans cette version (v2.5).
2. `ReadBusy()` de production reste **illimité** : un BUSY bloqué gèle la carte (et ne nourrit pas toujours le chien de garde). Seul le canari le borne (20 s) pour obtenir une mesure ; la décision de borner la production est un lot ultérieur.
3. Attente minimale entre deux rafraîchissements (`E27_MIN_REFRESH_MS` = 180 s) : un deuxième affichage rapproché est retardé, pas refusé.
4. **Observation préexistante (non modifiée)** : après un échec d'`Init` du panneau, `oledReady` reste vrai alors que GPIO12 est pris par le SPI ; la sonde de canari ré-initialise l'OLED sur cette issue, la production non.
5. Après un échec du rendu, l'écran n'est pas garanti inchangé (documenté au lot 8B-2A).
6. `[HEAL]` (redémarrage sur tas fragmenté) peut précéder un reset logiciel (cause 4) : la ligne de démarrage du canari le rappelle.
7. Animations et banc d'essai ignorés en canari (aucune requête de clip) ; pas de signature `pod-render-v1`, `cartelMode` non exposé, rapport de rendu non envoyé.
8. Les autres firmwares (ESP8266 2,9″ déjà validé, TFT 1,8″, e-ink 2,7″ seul, tout le R4) : hors lot, aucune propagation.

## 7. Contraintes respectées

`POD_RENDER_V1 = 0` et `POD_CANARY = 0` dans le commit ; aucun binaire ni `secrets.h` ; serveur, Redis, Neon, protocole et OTA inchangés ; pas de push ; pas de flash ; branches TFT tactile / vote et branche d'animation gelée non touchées.

## 8. FIX1 (audit GPT de `6a988a1`, 13/10/2026) — BUSY et Content-Length échouent FERMÉS

1. **BUSY** : après le rendu et AVANT le pré-vol et l'ACK, si `g_pcBusyTimeouts > 0` ou `g_pcBusyMaxMs > 8 s` : aucun ACK, `lastFrameIdE27` inchangé, OLED remis en état (`canaryOledProbe`), ressources déjà libérées, `return false` (ligne `REFUS ACK : BUSY …`). Les quatre compteurs BUSY sont remis à zéro juste avant le rendu : un affichage antérieur ne provoque aucun faux refus. Production inchangée.
2. **Content-Length** : en canari il doit valoir EXACTEMENT 5 808 ; absent / inconnu (−1), trop court, trop long ou surplus ⇒ aucun rendu, aucun ACK. (En production le comportement existant — −1 accepté — est conservé.)
3. **Hygiène** : espaces finaux de la sauvegarde `firmware-backups/2026-10-13_…` supprimés ; les tests comparent sans espaces finaux. `git diff --check e059db3..HEAD` propre.
4. **Preuves** : harnais +scénarios S4c (−1 refusé), S4e (exact accepté), B2 (BUSY plafonné ⇒ 0 ACK, rien d'acquitté, OLED remis, plan libéré), B4 (BUSY 9 s ⇒ refus), B5 (7,5 s ⇒ succès), B6 (compteurs antérieurs ignorés) : 111 / 157 / 236 vérifications sans vote, 252 avec vote en canari ; 24 mutants refusés (4 nouveaux : refus BUSY supprimé, seul le plafonnement refuse, compteurs non remis à zéro, Content-Length −1 accepté). `tsc` propre. Compilation ESP8266 3.1.2 : OFF 35 200 o / 473 820 o, ON 35 316 o / 476 956 o, canari 35 320 o / 468 920 o ; avertissements identiques dans les trois (`docs/mesures/8B2C_27_FIX1_2026_10_13/`).
5. **Suite globale, même environnement (g++ WinLibs 14.2, `CXX`, caches `consensus-pod/host/wifis3/.cache` copiés), `e059db3` puis HEAD** : base 794 tests / 2 échecs ; HEAD 833 tests / 2 échecs. Les deux échecs sont **strictement identiques** : `boundedSsl` « cœur Renesas 1.5.3 » et « 1.6.0 (VRAI code) » (code de sortie 3221226356 = 0xC0000374, corruption de tas du harnais hôte sous Windows) ; ils viennent de la base, pas du lot, et ne sont PAS corrigés ici. La suite n'est donc pas « propre » ; le différentiel base → HEAD est +39 tests, 0 échec nouveau. (Le test 8B1 `renderStream`, rouge avant FIX1 à cause de la liste blanche des harnais, est corrigé depuis `6a988a1`+FIX1 : la liste inclut `esp27_frame_harness.cpp`.)

## 9. Démarrage rapide du build local (outillage, sans flash)

```bash
bash scripts/esp8266-eink27-oled-canary-build.sh "<chemin vers TON secrets.h>"
```
Produit `canary-builds/stable/` (retour arrière, `POD_RENDER_V1=0`) et `canary-builds/canary/` (`1/1`, sans vote), vérifiés avec le `secrets.h.example` : RAM 35 200 / 35 320 o, flash 473 820 / 468 920 o. Les `.bin` embarquent le Wi-Fi : dossier ignoré par git, ne jamais partager. **Flasher seulement après le verdict de l'audit GPT sur FIX1**, puis suivre le protocole du § 4.

## 10. FIX2 — « undefined reference to g_pcBusyCalls » dans l'IDE Arduino (13/10/2026)

**Cause (pas les bibliothèques)** : le sketch et le pilote `epd2in7_V2.cpp` sont deux unités de compilation. Un `#define POD_CANARY 1` écrit dans le `.ino` est invisible du pilote, qui ne définissait donc pas les compteurs BUSY lus par le sketch (build `-D…` en ligne de commande : sans problème, d'où mes compilations vertes). Les avertissements « Multiple libraries found … ssd1306 » sont sans rapport et sans effet (l'IDE a retenu `Adafruit_GFX_Library` et `Adafruit_SSD1306`) ; rien n'a été touché dans les bibliothèques.
**Correctif** : `pod_canary_flags.h` (0/0 au dépôt) est la source unique des deux drapeaux, incluse par le sketch (dans la zone `POD_RENDER_V1_BEGIN`) et par le pilote. **Canari dans l'IDE : passer les DEUX valeurs à 1 dans `pod_canary_flags.h` de la copie ignorée, et ne pas modifier le `.ino`.** Vérifié : build IDE-style (seul l'en-tête édité, sans `-D`) = 35 320 o de RAM / 468 920 o de flash, édition de liens réussie. Tests adaptés (identité OFF, test des pilotes).

## 11. VERDICT MATÉRIEL (13/10/2026, build `b94bfb9`) — canari VERT pour l'affichage, sans vote

Relevé du porteur archivé dans `docs/mesures/8B2C_27_FIX1_2026_10_13/verdict-materiel-releve-porteur-2026_10_13.md` (**transcription des chiffres reçus ; le journal série brut reste à déposer**, rien n'est reconstruit).

| Critère | Observé |
|---|---|
| Orientation et affichage e-ink | corrects (jugement du porteur) |
| Rendu v1 | terminé ; 182 appels du producteur, appel max 747 µs, intervalle max 3 083 µs, pile contiguë min 752 o |
| BUSY | après Init 0 ms ; max au rafraîchissement 2 102 ms ; aucun dépassement du plafond, aucun TIMEOUT |
| renderHash | `b6e2e298bda2aad24ac699a2ae5c60e29829d2f106e0c8aabf33361c3f2f742a` |
| ACK `/api/ack-frame` | HTTP 200, frame `d52e9874-7bfe-4b9a-bfcd-0d3d5fc6b51b` |
| OLED après e-ink | `reinit=OK`, contenu restauré ; animation de 9 images toujours active pendant les pulls |
| Mémoire à l'ACK | pile contiguë min 384 o ; tas 39 456 o ; plus grand bloc 18 408 o ; fragmentation 41 % |
| 4 pulls espacés d'environ 300 s | avant : tas 39 952 o, bloc 21 264 o, frag. 36 %, pile 384 o ; après : tas 39 512 o chaque fois, bloc 16 720 – 18 432 o, frag. 41 – 44 % ; aucune fuite progressive |
| Resets, exceptions, REFUS, vote, `validation-result` | aucun |

**Frame réellement affichée : `source=consensus`** (déjà minée), pas `personal`. Le canari n'a effectué aucun vote : il a seulement reçu, affiché et acquitté la frame. Le protocole du § 4 parlait d'une frame personnelle ; l'invariant correct est celui du § 2 (aucun candidat validé, aucun vote).

**Ce que ce verdict valide** : affichage, rendu v1, ACK, coexistence e-ink/OLED, stabilité mémoire sur quatre pulls. **Il ne valide aucun vote réel.**

**Réserves honnêtes**
1. La pile contiguë ESP8266 descend à **384 o** pendant l'ACK : stable, aucun défaut observé, mais la réserve est mince.
2. `ReadBusy()` reste **illimité en production** ; seul le canari a le plafond de 20 s. Sur le matériel testé il rend la main normalement (2,102 s).
3. Le commentaire de `esp_eink_2.7BW_OLED.ino` (ligne du drapeau `POD_CANARY`) dit encore « frame personnelle » : volontairement non modifié (aucun changement de firmware dans ce commit documentaire).
4. Le journal série brut n'est pas encore archivé (voir ci-dessus).
