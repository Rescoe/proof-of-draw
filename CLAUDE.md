# CLAUDE.md

> **ÉTAT AU 14/10/2026 — lire d'abord `docs/SYNTHESE_VOTE_REEL_ET_PRODUCTION_DIRECTE_2026_10_14.md`, puis `docs/RESTE_A_FAIRE_2026_10_14.md`.** Le **vote réel v2** est en production : `main` contient tout le travail (TFT 2,8″, ESP8266 2,7″+OLED/2,9″, R4 e-ink 2,9″, serveur « réseau de vote réel ») et les blocs #100, #101 et #103 ont été minés avec des votes v2 de 4 familles d'appareils. **Production directe jusqu'à nouvel ordre** (`docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md` ; phrase de bascule : « réactiver les tests isolés »). Tous les drapeaux de canari valent 0 dans le dépôt ; `secrets.h` et `pod_vote_pins.h` ne sont jamais commités. Dossier de travail : le dépôt principal, branche `main`. **Les consignes de reprise des 11 et 12/10/2026 (worktree `local-resume`, « ne pas fusionner, pousser ni déployer », lot `PULLFRAME-BOUNDED-SSL-FIX1`) sont HISTORIQUES et levées.** Branches fusionnées retirées de GitHub : leurs sommets sont archivés par les étiquettes `archive/2026-10-14/<branche>`.

## Rôle

Tu travailles sur le repo existant `proof-of-draw`.

Ta mission n'est PAS de refaire l'application.  
Ta mission est de faire évoluer le projet à partir d'une base fonctionnelle en V1.

---

## État du projet au 16/05/2026

### Ce qui fonctionne en production

Le pipeline complet est validé sur l'écran e-ink 2.9" BWR :

```
dessin web → POST /api/draw → POST /api/submit-candidate
→ ESP GET /api/pull (metadata ~300B)
→ ESP GET /api/validate-candidate (metadata candidat ~121B)
→ ESP POST /api/validation-result (vote)
→ quorum → bloc miné → broadcast Redis frame:{deviceId}
→ ESP GET /api/pull (détecte nouveau frameId)
→ ESP GET /api/pull-frame?fmt=bin (9472 bytes binaires)
→ readFull() loop → epd.Display(blackBuf, redBuf) ✅
```

Commit de référence : `43aac8f`

### Ce qui reste à faire

- Porter le firmware vers e-ink 2.7" BW et OLED 0.96"
- Tester le quorum multi-ESP (poolSize > 1)
- V2 : calcul local de métriques ESP, signature ED25519 réelle

---

## Architecture actuelle

### Modèle réseau

```
ESP → serveur (register + ping + pull + pull-frame)
```

Pas de fetch sortant vers IP locale. Pas de SSRF possible.

### Séparation pull léger / fetch binaire

`/api/pull` retourne uniquement des métadonnées (~300B) :
```json
{
  "frameSource": "consensus",
  "frameId": "...",
  "chain": { "blockHash": "...", "blockIndex": 7 },
  "pendingValidation": { "candidateId": "..." }
}
```

`/api/pull-frame?fmt=bin` retourne 9472 bytes bruts :
```
[0..4735]    blackBuf (4736 bytes)
[4736..9471] redBuf   (4736 bytes)
```

Pas de JSON. Pas de base64. Content-Type: application/octet-stream.

---

## Contraintes mémoire ESP8266 — à lire avant tout changement firmware

L'ESP8266 a ~47KB de heap après WiFi. BearSSL consomme ~16KB par connexion TLS de façon fragmentée.

### Règles absolues

```
1. free(blackBuf); free(redBuf) AVANT toute connexion TLS
2. malloc(blackBuf); malloc(redBuf) APRÈS fermeture TLS (http.end())
3. http.useHTTP10(true) sur TOUS les GET — Vercel chunked encoding sinon
4. /api/validate-candidate ne retourne JAMAIS le payload image
5. /api/pull ne retourne JAMAIS black/red
6. DynamicJsonDocument petit (512-1024) pour les réponses légères
7. Pour les buffers pixel : readFull() en boucle, jamais readBytes() seul
8. RAM STATIQUE : un tampon « statique » n'est PAS gratuit (ESP8266 = 80 Ko au total, BearSSL veut ≈ 35 Ko de tas après le Wi-Fi). Lire « Variables and constants in RAM »
   à chaque compilation d'un firmware TLS : viser ≤ 40 000 o. Aucun gros tampon (> 2 Ko) statique ni vivant pendant le TLS : flash (LittleFS) ou malloc APRÈS la fermeture du TLS
9. Messages Serial en flash : F("…") / printf_P(PSTR("…")) (sinon chaque littéral occupe de la RAM)
10. Après tout changement : relever « [HEAP] après WiFi » (≈ 38 Ko = OK ; 30 Ko = « /api/register → -1 » puis Exception 29)
```

Incident du 06/10/2026 (multiscreen : tampons statiques + vote v2 ⇒ 30 Ko de tas ⇒ TLS impossible) : `docs/NOTE_MULTISCREEN_TAS_2026_10_06.md`.

### Pourquoi readFull() est obligatoire

`stream->readBytes()` sur TLS peut retourner moins que demandé (paquets TCP fragmentés). Sans boucle, les buffers sont partiels → image hachée à l'écran.

```cpp
auto readFull = [](WiFiClient* s, uint8_t* dst, size_t len) -> size_t {
  size_t total = 0;
  unsigned long t0 = millis();
  while (total < len && millis() - t0 < 15000) {
    if (s->available()) {
      size_t got = s->readBytes(dst + total, len - total);
      if (got > 0) total += got;
    } else {
      delay(10);
    }
  }
  return total;
};
```

---

## Contraintes serveur

### TypeScript strict

`lib/queue.ts` définit `FramePayload` comme une union discriminée :
```typescript
export type FramePayload =
  | { screen: "oled096";   buffer: string }
  | { screen: "eink27bw";  buffer: string }
  | { screen: "eink29bwr"; black: string; red: string }
  | { screen: string; buffer?: string; black?: string; red?: string };
```

Pour extraire `black`/`red` sans erreur TypeScript :
```typescript
const { black: _b, red: _r, ...meta } = payload as Record<string, unknown>;
```

### Serverless-safe

Pas d'état en mémoire Vercel. Tout passe par Redis.  
Pas de cron. Le cleanup des devices inactifs est opportuniste (à chaque lecture/écriture).

### Rate limiting

Préserver impérativement :
- `/api/pull` : 2 requêtes / 15 min par device
- `/api/validate-candidate` : 4 requêtes / min par device
- Blacklist automatique après PULL_MAX × 10 dépassements
- Strike system sur `/api/draw`

---

## Conversions canvas → buffer (référence canvasToScreen.ts)

### E-Ink 2.9" BWR — canvas 296×128 → driver 128×296

```typescript
// Rotation 90° CCW, bytesPerRow = 16
const bufCol = y;        // 0..127
const bufRow = 295 - x;  // 0..295
const byteIndex = bufRow * 16 + Math.floor(bufCol / 8);
const bit = 7 - (bufCol % 8);
// 0xFF = blanc, bit à 0 = coloré (noir ou rouge)
```

### E-Ink 2.7" BW — canvas 264×176 → driver 176×264

```typescript
// Rotation 90° CCW, bytesPerRow = 22
const bufCol = y;        // 0..175
const bufRow = 263 - x;  // 0..263
const byteIndex = bufRow * 22 + Math.floor(bufCol / 8);
const bit = 7 - (bufCol % 8);
// 0xFF = blanc, bit à 0 = noir
```

### OLED 0.96" — canvas 128×64, page-major

```typescript
// a < 32 OBLIGATOIRE (transparent = éteint)
const page = Math.floor(y / 8);
const bit = y % 8;
buffer[page * 128 + x] |= (1 << bit);
// 0x00 = éteint, bit à 1 = allumé
```

---

## Généralisation à un nouvel écran

Trois fichiers à modifier :

### 1. `screenProfiles.ts`
Ajouter : `BUF_SIZE`, `bufferCount` (1 ou 2), `format` (`"bw"` | `"bwr"`), dimensions.

### 2. `/api/pull-frame/route.ts`
Lire le profil. Pour `bw` : envoyer `blackBuf` seul. Pour `bwr` : `blackBuf + redBuf` concaténés.  
Ajouter header `X-Screen-Type`.

### 3. Firmware cible
Définir `SCREEN_TYPE` et `BUF_SIZE` comme constantes.  
`doFetchFrame()` : adapter le nombre de `readFull()` et l'appel `epd.Display()`.

---

## Page de dessin — Pod Studio (refonte du 30/09/2026)

La page `app/draw/[device]/[screen]` a été entièrement refondue (le non-goal « refonte UI » est levé **pour cette page
uniquement**). Architecture complète : `docs/ARCHITECTURE_DESSIN.md`.

```
lib/drawEngine/     moteur pur pixel-exact (sans React/DOM) : session, historique par deltas, replay v2, score
app/draw/_studio/   interface tactile (Essentiel / Studio / Pro), brouillon IndexedDB, flux d'envoi 3 étapes
app/draw-lab/       bac à sable DEV (404 en prod) — vérifier l'interface sans toucher à Redis
tests/              npm test (moteur, replay == image, parité canvas → buffer → décodage)
```

Règles à respecter :
- le canvas ne contient que des couleurs affichables par l'écran ; toute conversion vers un buffer passe par
  `rgbaToScreenPayload` / `canvasToScreenPayload` (`lib/canvasToScreen.ts`, conventions inchangées, testées) ;
- les types `ActionEvent`/`ReplayEvent` ne changent que **de façon additive** ; un replay/une séquence v2 porte `v: 2`
  sur son premier élément ; sans ce marqueur, tout se relit et se score comme avant ;
- `drawScore` = `scoreActions(actions)` (`lib/drawEngine/scoring.ts`), déterministe et recalculable par les validateurs ;
- le replay envoyé ne contient jamais l'image modèle ; les points de trait sont espacés de ≥ 16 ms (`automationRatio`) ;
- aucune navigation automatique sur erreur dans la page de dessin : le dessin ne doit jamais être perdu ;
- avant tout commit touchant le moteur : `npm test`, `npx tsc --noEmit`.

## Vue réseau « en direct » (02/10/2026)

Ce que chaque écran **affiche réellement** (≠ dernier bloc miné, ≠ frame en attente supprimée à l'ACK) :

```
POST /api/ack-frame (firmware, après affichage) → lib/displayState.ts recordDisplayed()
  shown:{device}:{écran}     méta ~300 o (titre, artiste, nature, bloc, mode frame|scene)   TTL 30 j
  shown:img:{frameId}:{écran} buffers, SET NX : une copie partagée par tous les appareils du même frameId
GET /api/network/displays      PUBLIC : uniquement les affichages AVEC image ; 1 MGET, cache invalidé par ACK (tag network-displays)
GET /api/network/display-image image immuable par frameId (cache navigateur 1 an)
GET /api/my-devices/displays   PROPRIÉTAIRE : enregistrements complets (frameId, bloc, mode, affichages personnels)
UI publique : app/network/LiveDisplays.tsx — IMAGES SEULEMENT (section « Actuellement affiché » + « Affiché maintenant » du panneau)
UI debug    : app/profile/OwnDisplaysDebug.tsx — « Mon profil » : titre, nature, date, frameId, écrans sans confirmation
```

Règles : l'ACK ne doit **jamais** échouer à cause de cet enregistrement ; une frame **personnelle** (`personal:frame:*`) n'est ni
copiée ni exposée publiquement (absente de la vue publique) ; `mode: "scene"` dans le corps de l'ACK = animation jouée.
Pas de « frame en attente » dans la vue réseau : seul compte ce qui est affiché.

## Autoriser un autre équipement (navigateur / PC) à accéder au profil (02/10/2026)

```
Appareil d'origine (profil)  « Autoriser un autre équipement » → POST /api/artist/link-code → code XXXX-XXXX (10 min, 1 usage)
                             sondage GET /api/artist/link-code?code=… toutes les 4 s (onglet visible) → « ✓ appairé »
Nouvel équipement (sans profil) « Utiliser ce code » → POST /api/artist/join {code} → cookie : artistId + ESP du profil
UI : app/profile/PairDevice.tsx (PairingSection, PairThisBrowser, JoinWithCode) ; logique pure : lib/linkCode.ts
```

Libellés : « équipement » = PC/navigateur ; « ESP » = écran physique (on l'ajoute par « + Ajouter un ESP », jamais par ce code). Règles : l'autorisation **ajoute** un navigateur, n'en retire jamais ; code à aléa cryptographique (`crypto.getRandomValues`), usage unique
**atomique** (`GETDEL`), `join` limité à 10 essais / 10 min / IP, `link-code` à 8 codes / 10 min / profil. Les droits suivent le
**profil** : `sessionOwnsDevice` accepte un ESP lié à l'`artistId` du cookie (clé inverse `artist:device:{id}`, 1 GET) — un PC appairé
contrôle donc aussi les ESP ajoutés plus tard depuis le téléphone, et perd l'accès à un ESP donné (détaché) sans autre action.

## Page profil : liste « Mes ESP » (02/10/2026)

`app/profile/DevicesPanel.tsx` : carte compacte par appareil (nom, état, écrans, pastilles), UN bouton « ✏️ Dessiner » (menu de choix d'écran si plusieurs),
UN bouton « ⚙ Gérer » → sous-menus Réglages · Accès · Blocs · Zone sensible (un seul panneau ouvert). **Suppression protégée** : retaper le nom de
l'appareil (`lib/deviceDeleteGuard.ts`, testé). `InlineEdit` vit dans son propre fichier (un `page.tsx` ne peut exporter que la page).

## Firmware UNO R4 WiFi + TFT 2.8" tactile — écran `tft28` (02/10/2026)

Nouveau type d'écran **`tft28`** (240×320 RGB565, 153 600 o, profil dans `lib/screenProfiles.ts`) : l'œuvre est plein écran ; **pas de scene-v1** (aucune
`sceneCapability`) — les œuvres ANA arrivent comme image fixe. Le toucher affiche/cache le cartel ; la microSD garde la dernière image pour pouvoir
redessiner les bandes sans re-télécharger. Détails, contraintes et mesures à rapporter : `docs/UNO_R4_TFT28.md`.
**Piège R4 : pile principale de 1 Ko** (protection désactivée) → pas de gros tableau local, tampons statiques, `[MEM]`/`[SELFTEST]` au Serial.
Vue réseau : icône dédiée (tablette portrait) + turquoise. Tests : `podHttpR4`, `canvasToScreen` (tft28), `screenConvert` (boucle sur tous les écrans).

## Atelier d'animation (refonte du 06/10/2026) — remplace le banc d'essai

`/animer` = éditeur plein écran SANS défilement de page (le canvas tient toujours dans la scène, la boîte à outils n'est jamais sous lui), 3 modes (Essentiel · Studio · Pro), 7 brosses
(`lib/anim/brushes.ts`), fantôme avant/après, retour/annuler/rétablir toujours visibles, un 2e doigt annule le trait en cours. Code : `app/animer/*` ; détails, purge et proposition de canvas maître :
`docs/ATELIER_ANIMATION.md`. **Le banc d'essai a été supprimé** (UI `/bench` redirigée vers `/animer`, routes `/api/bench/{send,mode,status,clear}` retirées) ; `poll`/`clip`/`result` restent pour
le firmware déjà déployé (inertes : plus rien n'active `benchMode`). Règle d'interface mobile : aucune boîte à outils sous un canvas dans une page qui défile (le geste de défilement dessine).

## (Historique) Banc d'essai d'animation — TFT 2.8" (02/10/2026, v1 test) — retiré le 06/10/2026, voir ci-dessus

Page `/bench` (lien sur la carte de l'appareil) : animation 128×64 1 bit → clip « PBC1 » en DIFFÉRENCES (`lib/bench/clip.ts`, plafond 9 Ko) → `/api/bench/{send,mode,poll,clip,result,status}`
(Redis `bench:*`, TTL courts) → firmware `pod_bench.h` (repeint les seuls octets modifiés, ×15/8, mesures renvoyées). `/api/pull` ajoute `benchMode` pour un tft28 quand le mode est actif.
Détails, format et mesures à rapporter : `docs/BENCH_ANIMATION.md`. Tests : `benchClip`, `podBenchR4` (g++ + validation différentielle).
Ancienne galerie `/gallery-anim` (`anim:*`) : redirigée vers la galerie principale (voir « Animations = blocs du consensus »). Export GIF (`lib/bench/gif.ts`), journal par appareil (`bench:log:*`), alerte si le firmware enregistré est < r4tft28-2.1.
Firmware 2.2 : pixels envoyés PAR BLOC (`fastPixels` = `SPI.transfer(buf, n)` ; `Adafruit_SPITFT::writePixels` fait 2 transferts d'octet par pixel sur la R4), une transaction SPI par image,
métrique de retard = retard de DÉMARRAGE (+ marge min), `loops = 0` = boucle sans fin (arrêt : toucher / nouvel envoi / fin du mode / 1 h ; contrôle serveur toutes les 20 s).

## Animations : écrans, atelier, firmwares (03/10/2026)

Écrans compatibles du banc d'essai : `lib/bench/screens.ts` (`tft28` validé ; `tft18` et `oled096` ⚠ non testés sur le matériel). Atelier ouvert à tous : `/animer`. Lecteur de clips `pod_bench.h` et réseau ESP `pod_bench_esp.h`
existent en COPIES IDENTIQUES par dossier de firmware : après toute modification de l'original, `node scripts/sync-bench-header.js` (test `benchHeaderCopies`). **Avant de modifier un `.ino`, le sauvegarder dans `firmware-backups/<date>/`.**
Tout code non testé sur le matériel porte un avertissement (en-tête, doc, interface). Plan : `docs/PLAN_ANIMATIONS_ET_PORTS_R4.md`.

## Animations = blocs du consensus (04/10/2026)

Une animation suit le MÊME pipeline qu'un dessin : `/animer` (bouton « 🎞 Animer » de Mon profil, écrans tft28/tft18/oled096) → `POST /api/draw { anim }` →
`submit-candidate` (`animClip`) → votes signés → bloc `kind:"animation"` → galerie principale (filtre Tout/Dessins/Animations, `/gallery?type=animation`).
Le serveur dérive TOUT du clip PBC1 (`lib/anim/block.ts`, pur et testé) : empreinte + score de chaque image, score candidat = moyenne, `imageHash` = racine des empreintes,
affiche (image fixe diffusée à tous les écrans). Clip et empreintes dans `chain:anim:{hash}`. Lecture : boucle INFINIE (`loops = 0` imposé par le serveur). TFT 2.8" `r4tft28-2.4` : pointeur `anim` dans /api/pull -> clip (`/api/block-clip`, CDN) rangé sur la microSD et joué
sans aucune requête (0 commande Redis de plus qu'une image fixe). ESP8266 (multiscreen-2.2 OLED, tft18-2.2) : même principe, clip en flash LittleFS (`esp8266/_shared/pod_anim_esp.h`).
**Seuls les écrans dont le firmware DÉCLARÉ (version envoyée à /api/register) lit les animations en reçoivent** (`ANIM_POINTER_FIRMWARE`, `lib/anim/pointer.ts`) . Une animation validée est diffusée automatiquement à TOUS les écrans dynamiques capables (tft28, tft18, oled096 : même clip, affiche rendue par écran, `lib/anim/broadcast.ts`), jamais à un e-ink.
Plus aucune publication sans consensus : `/api/anim/save` et l'option `gallery` de `/api/bench/send` sont supprimés. Détails, coûts Redis, limites : `docs/ANIMATIONS_PIPELINE.md`.

## Règle PRIMORDIALE — quotas Upstash Redis (écrite le 03/10/2026)

Ne jamais saturer Redis. Toute route, page, cron ou firmware qui y accède doit être pensé en **commandes Redis / heure / acteur AVANT d'être codé** (écrire le coût dans le commit ou la doc).
- Interface web : jamais de `setInterval` nu → pause si `document.hidden`, rythme réduit au repos, arrêt après inactivité, reprise sur `visibilitychange`.
- Mode « test / accéléré » : TTL obligatoire, extinction automatique.
- Regrouper les lectures (`MGET`), pas d'écriture de présence à chaque poll, journaux/listes en pipeline.
- **Pull d'écran (05/10/2026)** : 1 `MGET` (appareil + frames + tête + candidat + votes + notification + banc d'essai + drapeau d'observation), rate-limit ÉCHANTILLONNÉ 1/8, présence réécrite toutes les 12 min (en ligne = 20 min), observation dépilée seulement si `chain:obs:pending` : ≈ 1,5 commande au repos (5 avant). Flux par bloc (pull-frame, ack, validate, vote) en 1 MGET ; mode actif/dormant (repos 5 min si `net:hot`, sinon 15 min ; `CANDIDATE_TTL_SEC` 1800). Plan 200 k/mois, leviers, tarifs Upstash, décisions : `docs/PLAN_REDIS_200K.md`.
- Manquement du 03/10 (page `/bench` : ≈ 8 600 commandes/h par onglet, onglet caché compris) et plan de réduction (tâches Q1–Q12) : `docs/NOTE_BENCH_ET_QUOTAS_2026_10_03.md`.

## Chantier à venir : validation réelle (cadrage du 05/10/2026)

Aujourd'hui le vote des ESP est un **écho** du `score_server` (aucun calcul local, signatures permissives, identité usurpable). Dossier complet, modèle de menace, spécification
des métriques entières, plan en 7 phases et décisions à prendre : `docs/CHANTIER_VALIDATION_REELLE.md`. **Ne pas parler de « consensus/preuve » dans l'UI au-delà du niveau réellement atteint.**

**Reprise du 06/10/2026** : lire aussi `docs/REPRISE_2026_10_06_VALIDATION_ET_RESEAU.md` avant de poursuivre. Cette note fixe les garde-fous décidés : rejets v2 non bloquants pendant le canari, vote atomique avant essais multi-cartes, P0 complet avant mode strict, différentiel C++ obligatoire et interdiction de commiter le firmware TFT 1.8 local contenant le Wi-Fi.

**Plan de travail du 06/10/2026** (audits Claude + GPT, rôles : GPT orchestrateur/auditeur, Claude réalisateur) : `docs/PLAN_DE_TRAVAIL_CONSENSUS_FINAL_2026_10_06.md` (lots 0-10 : preuves, protocole v3, identité, reçus signés, comité, noyau `consensusPoD`, animations calculées, cartels, grand reflash + OTA, documentation).
Les audits : `docs/NOTE_CLAUDE_AUDIT_VALIDATION_CONSENSUS_OTA_2026_10_06.md` et `docs/AUDIT_GPT_CONSENSUS_POD_IOT_2026_10_06.md`. **À la clôture de chaque lot : mettre à jour `app/learn/data/roadmap.ts` (feuille de route, fin de la page Apprendre) et, si un niveau d'assurance change, la synthèse `app/learn/components/SynthesisPath.tsx`** (test `learnRoadmap`).
Firmware e-ink 2,7" seul (`eink27bw-2.1`) : vote v2 porté le 06/10/2026, compilé, **non essayé sur la carte**.

**Animations calculées (lot 6, 07/10/2026) — `pod-anim-v3`** : spécification `docs/SPEC_PODANIM_V3.md` (R2) ; référence pure `lib/animV3.ts` + noyau C++ en flux `consensus-pod/src/podAnimV3.h` (vecteurs `anim-vectors.txt`, 260 clips : `docs/LOT_6B1_…`) ;
route `/api/candidate-clip` (ticket HMAC `CLIP_TICKET_SECRET`), mode `ANIM_V3_MODE` **`off`/`shadow` seulement**, représentants, vérificateur de bloc animation (`rulesVersion = 2`) : `docs/LOT_6B2_…`. **Tout est INACTIF par défaut, aucun firmware ne l'utilise, aucun ticket n'est distribué** ;
`enforce` n'existe pas (lot 8, capacités firmware). **Lot 6C** (`docs/LOT_6C_…`, `docs/mesures/6C_2026_10_07/`) : l'automate d'animation (≈ 1,9 Ko) est COMPILÉ pour ESP8266 et UNO R4 (exemples `consensus-pod/examples/AnimSelfTest*`, « NE PAS DÉPLOYER »), jamais essayé sur carte ; contrat du lot 8 : ESP8266 = clip écrit dans LittleFS pendant le TLS puis calcul TLS FERMÉ, jamais d'automate pendant le TLS ; R4 = objet GLOBAL (pile principale de 1 024 o). Un vote v1 (écho) ne valide JAMAIS un bloc animation v3. Ne pas parler d'animation « validée par les appareils » avant le lot 8.

**Cartels e-ink (lot 7, 07/10/2026)** : `docs/SPEC_LOT_7_CARTELS_RENDU_2026_10_07.md`. Les firmwares gravent le cartel PAR-DESSUS l'image (e-ink 2,9″ : 28 lignes sur 128 ; 2,7″ : 26–28 sur 176 ; TFT 1,8″ : 27–29 sur 160) ; `lib/cartelZones.ts` (géométrie lue dans les sources, testée) alimente les hachures de l'éditeur et l'avertissement d'envoi — **purement visuel, l'image du bloc reste complète**. L'ACK accepte un « rapport non authentifié » facultatif (`artworkHash`/`frameHash`/`renderHash`/`layoutVersion`/`cartelMode`), consigné dans l'enregistrement d'affichage, jamais voté ni public (type public sans `render`), sans `renderHash` pour une scène. Contrat de rendu et décisions D7 GELÉS (`fit` au rendu, pas de réglage visible avant le firmware, rasteriseur complet versionné, signature `pod-render-v1` au lot 8).

**Rasteriseur de référence (lot 8A, 07/10/2026)** : `docs/LOT_8A_RASTERISEUR_REFERENCE_2026_10_07.md`. `lib/renderLayout.ts` (TypeScript) est la source unique de `layoutVersion = 1` (police R4, repli des accents, cartel, `fit` entier, `frameHash`/`renderHash`, table `artworkIdentity` « absent plutôt qu'inventé » ; ANA = `sha256:<hex64>` strict, normalisé en 64 hex nus) ; `consensus-pod/src/podRender.h` le porte en C++ (harnais hôte `consensus-pod/host/render_harness.cpp`, vecteurs `consensus-pod/test-vectors/render-vectors.txt`, régénérés par `node --import tsx scripts/gen-render-vectors.ts`). **Référence logicielle : aucun firmware ne l'utilise, jamais essayée sur un écran** ; la version hôte travaille sur une grille complète (stratégie mémoire MCU = lot 8B).

**Noyau de rendu en flux (lot 8B-1, 07/10/2026)** : `docs/LOT_8B1_NOYAU_RENDU_FLUX_2026_10_07.md`. `consensus-pod/src/podRenderStream.h` produit les octets du pilote SANS grille : e-ink = octet calculé à la demande depuis les plans reçus (sortie bornée choisie par l'appelant), TFT 1,8″ = compositeur ligne par ligne (une ligne source + une ligne de sortie, fit monotone), `frameHash` sur les octets reçus, `renderHash` sur ceux remis au pilote. Vérifié sur l'HÔTE contre les 228 vecteurs d'or et la référence à grille (octet par octet), COMPILÉ pour ESP8266/R4 (sondes `consensus-pod/examples/RenderProbe*`, « NE PAS DÉPLOYER », mesures dans `docs/mesures/8B1_2026_10_07/`). **Aucun firmware ne l'utilise, jamais essayé sur une carte** ; pas de signature `pod-render-v1`, pas de réglage `cartelMode` exposé.

**Intégration inactive du rendu v1 dans 4 firmwares canaris (lot 8B-2A, 08/10/2026)** : `docs/LOT_8B2A_INTEGRATION_CANARIS_2026_10_08.md`. ESP8266 e-ink 2,9″ + TFT 1,8″, UNO R4 e-ink 2,9″ + TFT 1,8″ : option de compilation **`POD_RENDER_V1` = 0 par défaut** (le firmware est alors, au texte près, celui d'avant : testé contre `firmware-backups/2026-10-08_avant-rendu-v1-canaris/`) ; à 1, le noyau gelé rend et remet l'image au pilote par morceaux (e-ink : `Epd::DisplayStream` / `Epd29b::displayStream`, plans sources intacts, aucun tampon final ; TFT : une ligne source + une ligne de sortie). `frameHash`/`renderHash` seulement journalisés : **ACK, routes, rapport de rendu, `cartelMode` inchangés/non exposés**. Copies du noyau dans les 4 dossiers (`node scripts/sync-bench-header.js`, test `benchHeaderCopies`). **Compilé seulement (OFF + ON), jamais flashé ni essayé sur une carte** ; ne pas activer avant le lot 8B-2B (canari). Après un échec du rendu v1 : **aucun ACK** (le serveur réessaiera) mais l'écran n'est **pas** garanti inchangé (TFT partiellement redessiné ; e-ink éventuellement resté blanc) ; R4 e-ink, BUSY expiré = données et rafraîchissement envoyés, fin physique non confirmée. ⚠ R4 e-ink : pile estimée ≈ 736–752 o sur 1 024 o, non mesurée.

**Propagation du rendu v1 aux huit firmwares à cartel gravé (lot 8B-2B-1, 08/10/2026)** : `docs/LOT_8B2B1_PROPAGATION_2026_10_08.md`. Ajout de ESP8266 e-ink 2,7″ (solo et + OLED) et UNO R4 e-ink 2,7″ (solo et + OLED) : `POD_RENDER_V1 = 0` par défaut, chemin désactivé == firmware d'avant au texte près (sauvegardes `firmware-backups/2026-10-08_avant-propagation-8b2b1/`), matrice complète 8 × OFF/ON compilée sans avertissement nouveau. **R4 e-ink : aucune variable globale ajoutée** — le renderer et son hash vivent dans `g_podScratch[600]` (`alignas(PodScratch)`, construit par new placé et DÉTRUIT explicitement par le point d'entrée à sortie unique `podRenderAndShow()`) qui REMPLACE `qrData[600]` (RAM statique ON == OFF == base ; marge 528 o sur le 2,9″, 4 168 o sur le 2,7″). Pilotes 2,7″ : `ReadBusy()` attend indéfiniment (pas de « BUSY expiré »). Les firmwares sans cartel gravé (R4 TFT 2,8″, OLED) ne sont pas concernés. **Toujours compilé seulement, jamais flashé ; canari matériel obligatoire avant toute activation.**

**Canari du rendu v1 sur UNO R4 e-ink 2,9″ (préparation, lot 8B-2B-2, 08/10/2026)** : `docs/CANARY_R4_EINK29_RENDU_V1_2026_10_08.md`. Le dépôt garde `POD_RENDER_V1 = 0` ET `POD_CANARY = 0` ; le canari est un **build local** (`-DPOD_RENDER_V1=1 -DPOD_CANARY=1`, dossier `canary-builds/` IGNORÉ par git : les binaires embarquent `secrets.h`) ; retour arrière = binaire `canary-builds/stable` (`POD_RENDER_V1=0`). `POD_CANARY` n'ajoute qu'un journal série `[CANARY]` (pile principale PEINTE et mesurée, métadonnées du cartel, mémoire) : aucune variable globale, aucun réseau, firmware annoncé au serveur inchangé. Frame nouvelle sans effacer l'EEPROM : « Afficher sur mon écran » (`/api/send-to-screen`, UUID neuf à chaque envoi) puis UN reset (« premier pull immédiat »). Vérification hors carte : `scripts/canary-verify-render.ts`. **Ne jamais commiter un défaut à 1** (testé).

**⚠ Ed25519 sur UNO R4 : pile dédiée (lot 8B-2B-2 STACK-FIX1, 08/10/2026)** : la pile principale du cœur R4 ne fait que **1 024 o** et `Ed25519::verify` en demande 1 364 (`sign` 1 148, `derivePublicKey` 1 004) : le premier démarrage du canari a montré `pile max ~1732 o` — **dépassement réel et préexistant**, dans le haut du tas (le firmware stable en souffrait aussi, à chaque vote). **Plus aucun appel direct à `Ed25519::` dans un sketch R4** : tout passe par `PodEd` (`consensus-pod/src/adapters/podEdStack.h`, copié par `scripts/sync-bench-header.js`) qui exécute l'opération sur 2 304 o pris un instant au tas (trampoline Thumb de 8 instructions qui déplace `SP` ; les interruptions s'y empilent aussi, donc la marge les mesure ; suppose `SPMON` désactivé comme dans le cœur 1.5.3 ; jamais depuis une interruption), contrôle garde + marge ≥ 128 o, efface, et **échoue fermé** (sortie à zéro, vote non envoyé, aucune clé écrite). Tout futur appel Ed25519 R4 (rapport `pod-render-v1`, reçus, manifeste OTA) doit utiliser `PodEd` et tester son résultat (testé : `tests/edStack.test.ts`). Bibliothèque Crypto NON modifiée. **Compilé et testé sur l'hôte seulement — le déplacement de `SP` n'a jamais tourné sur une carte** (reste ouvert : au vote, la pile principale est à 868 o statiques sur la plupart des R4 et **964 o sur le TFT 2,8″**, à cause du cadre de `doValidate`) : micro-canari `consensus-pod/examples/Ed25519StackProbeUnoR4` d'abord (sans écran ni frame), PUIS démarrage complet sans frame, PUIS une frame — jamais l'inverse. Détails, mesures, comparaison des solutions : `docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md`. Les sketches R4 s'éditent donc avec cette table (`tests/helpers/edStackEdits.ts`) ; la sauvegarde d'avant est `firmware-backups/2026-10-08_avant-correctif-pile-ed25519-r4/`.
**Canari R4 : dépassement TLS mesuré + verrou fatal (BOOT-FIX2, 08–09/10/2026)** : `PodEd` est validé sur carte (micro-canari et auto-test). Le second canari a ensuite **prouvé sur matériel** que la chaîne réseau déborde pendant `WiFiSSLClient::connect` : **1 480 o utilisés sur une pile principale de 1 024 o, soit 456 o écrits sous `__StackLimit`**. `sbrk(0)` restait à 5 160 o de la limite : ce n'est pas le tas ; aucune frame n'avait été reçue. Défaut préexistant du firmware stable et potentiellement commun aux cinq firmwares R4 PoD utilisant cette chaîne — cela ne prouve pas encore un bug autonome de WiFiS3. Le verrou fatal a correctement empêché tout pull/vote/ACK/affichage après l'alerte. Source et plan de reproduction minimale : `docs/NOTE_PILE_TLS_UNO_R4_WIFI_2026_10_09.md` ; instrument et journal : `docs/LOT_8B2B2_BOOTFIX2_2026_10_08.md`. **Aucune frame avant correction de la pile réseau dédiée et nouveau verdict.**

**Toute transaction réseau/TLS R4 sur pile dédiée (lot 8B-2B-2 NETSTACK-FIX1, 09/10/2026)** : `docs/LOT_8B2B2_NETSTACK_FIX1_2026_10_09.md`. `consensus-pod/src/adapters/podNetStack.h` (copié dans les 5 dossiers R4 par `scripts/sync-bench-header.js`) : `PodNet::run(fn, ctx)` / `podNetRun(lambda)` exécute la transaction ENTIÈRE (connect, requête, en-têtes, corps, `stop()`) sur 2 048 o pris au tas (garde 64 o, marge ≥ 128 o, objectif 256 o, interruptions comprises, effacement avant `free`, échec fermé, MÊME trampoline de 8 instructions que `PodEd`). **Plus aucun `Conn` hors d'une lambda `auto tx = [&]() {…}` lancée par `podNetRun`** (testé) ; résultats uniquement dans des objets de l'appelant ; jamais imbriqué ni dans `PodEd` ni dans lui-même (SP hors de la pile principale → `NESTED`) : la lecture du candidat (`netReadCandidate`) est FERMÉE avant la signature. Échec (malloc, garde, marge, imbrication) → transaction ÉCHOUÉE : `httpCall` retourne −4, image/clip/candidat comme incomplets, ni vote, ni ACK, ni affichage. Tout futur appel réseau R4 doit passer par `podNetRun`. **Compilé + hôte seulement : canari SANS frame d'abord** (register + ≥ 3 pulls, critères au § 6 du lot). Restent hors pile dédiée : `WiFi.begin/status/localIP…` (864 o à `6a`, marge 160 o). **TFT 2,8″ : toujours BLOQUÉ pour tout flash** (pile principale au vote : voir le lot).

**Pile dédiée validée sur carte + journal sur pile dédiée (lots 8B-2B-2 NETSTACK-FIX1 → FIX2, 09/10/2026)** : le canari a VALIDÉ la pile réseau (2 048 o : 1 172 o utilisés, 812 o de marge, `connect()` ne déborde plus), puis relevé 24 o sous `__StackLimit` APRÈS la transaction : les E/S de journal (`vsnprintf` ≈ 416 o + écriture USB 270 – 430 o) posées sur ≈ 608 o de cadres (`setup → doRegister → httpCall`) dépassent les 1 024 o — **y compris le `logf` de production**. Correctif : `logf` s'exécute sur une pile de journal dédiée (`PodNet::runSized`, 1 536 o) quand l'appelant est sur la pile principale (directement sur une pile dédiée), ligne abandonnée si l'allocation échoue ; transaction HTTP brute dans un helper noinline (`netHttpRaw`) ; `client.stop()` toujours appelé ; échecs formulés honnêtement (`podNetExecuted`/`podNetWhy` : NOMEM/NESTED = NON exécutée ; GUARD/MARGIN = EXÉCUTÉE mais rejetée localement, un POST/vote/ACK a pu partir ; `httpCall` −4/−5 ; TFT : « l'écran a pu être redessiné », jamais « image NON présentée »). **Toute nouvelle sortie série R4 passe par `logf`** (ou par la pile de journal), jamais `Serial.print` direct depuis une couche profonde. Détails, A/B/C, protocole : `docs/LOT_8B2B2_NETSTACK_FIX2_2026_10_09.md` ; journal matériel : `docs/mesures/8B2B2_NETSTACK_FIX2_2026_10_09/`. **Compilé sur les cœurs 1.5.3 ET 1.6.0, hôte seulement : canari sans frame d'abord.**

**Les 24 o ne viennent pas du journal ; le marqueur est détruit DANS `macString()` (lots 8B-2B-2 NETSTACK-FIX3 puis FIX3-R1, 09/10/2026)** : le point silencieux A (juste après `netHttpRaw`) a relevé 1 048 o ⇒ hypothèse du journal RÉFUTÉE ; puis le canari FIX3 a donné **R0 sain, R1 en alerte** : le dégât a lieu entre l'entrée de `doRegister` et la fin de `macString()` (appel au module pour l'adresse MAC, `snprintf` ou construction du `String`), AVANT toute transaction PodNet. Les octets détruits sont des cadres de la chaîne printf de newlib (`__ssputs_r`). Suspect : `WiFi.macAddress()` (512 o de cadres + 592 o de chaîne modem = 1 104 o statiques pour 1 048 mesurés) — **hypothèse forte, NON prouvée** (R1 ne distingue pas ses trois étapes). **PodNet n'est PAS exonéré par le matériel** : son épilogue paraît innocent par l'ANALYSE STATIQUE (688–728 o) mais ses sondes de phase (`POD_NET_PROBE`, `PodNetInfo::pad[0]`) n'ont jamais été exercées sur la carte. FIX3-R1 : trois sous-phases silencieuses dans `macString()` (canari e-ink 2,9″ seulement, première sous-phase fautive inscrite « !n » dans le `String` retourné, rapportée APRÈS le retour sur la pile de journal), `logfSafeStop()` réellement silencieux (aucune E/S : la carte se tait), `docs/LOT_8B2B2_NETSTACK_FIX3_R1_2026_10_09.md` et `docs/LOT_8B2B2_NETSTACK_FIX3_2026_10_09.md`. **Aucune correction d'architecture avant le prochain canari sans frame** (option à confirmer : envelopper chaque appel `WiFi.*` dans une courte pile dédiée). **Tout nouvel appel au module Wi-Fi (`WiFi.*`) pose une feuille `vsnprintf` de 400–600 o : jamais sur un cadre profond ; et aucune E/S dans un arrêt fatal appelé depuis un cadre quelconque.**

**`WiFi.macAddress()` PROUVÉ sur la carte ; tout appel direct au module Wi-Fi sur une pile dédiée (lot 8B-2B-2 NETSTACK-WIFI-CALLS-FIX1, 09/10/2026)** : le canari FIX3-R1 a donné `macString : PREMIERE sous-phase fautive = 1` (R0 sain) : l'appel au module pour l'adresse MAC détruit le marqueur de pile (24 o sous `__StackLimit`) — chaque appel au module (`ModemClass → vsnprintf`) pose une feuille de 400 – 600 o sur le cadre de l'appelant. `snprintf`, le constructeur `String` et **toute transaction PodNet n'avaient pas encore été exécutés** : leurs phases restent à exercer. Correctif (compilé + hôte seulement, jamais flashé) : `podWifiRun` (`podNetStack.h`, pile dédiée de **1 536 o** : garde 64 o, filigrane, marge ≥ 128 o, objectif 256 o, jamais imbriquée) ; **plus aucun `WiFi.<méthode>(` hors des six enveloppes `wifiStatusT/wifiStatus`, `wifiFirmware`, `wifiBegin`, `wifiMac`, `wifiRssi`, `wifiIpString`** (cinq firmwares ; testé statiquement ET dans l'ELF par `scripts/wifi-stack-report.js`) ; résultats chez l'appelant ; **échec fermé** : statut `0xFE` (ni connecté ni module absent), `"?"`, MAC vide (`doRegister` n'inscrit pas), clés non générées ; `GUARD` → arrêt sûr silencieux. La MAC est encodée par un hexadécimal manuel dans `char[18]` (plus de `snprintf`). Canari : relevé `[CANARY] wifi … utilisé/marge/erreur` à chaque appel, sondes de PodNet et sous-phases conservées. **Toute nouvelle fonction du module Wi-Fi (`WiFi.*`) doit passer par une enveloppe `podWifiRun` ; ne jamais en poser une à l'intérieur d'une lambda `podNetRun`.** `docs/LOT_8B2B2_NETSTACK_WIFI_CALLS_FIX1_2026_10_09.md`. Canari sans frame à refaire après audit. **Validé sur la carte (canari WIFI-CALLS-FIX1, 09/10/2026)** : pile Wi-Fi dédiée 448 – 608 o utilisés (marges 864 – 1 024 o), PodNet 1 172 / 812 o, Ed25519 ≥ 708 o, toutes les erreurs à 0, `/api/register` 200, marqueur principal intact, aucun octet sous `__StackLimit`. **WIFI-CALLS-FIX2** : l'arrêt à `6b` était un FAUX POSITIF de l'instrument (`stackDepthBytes()` observe la zone 0xA5 sous `__StackLimit`, légitimement recouverte par les piles temporaires allouées au tas : « pile max 3072 ») — critères fatals du canari = marqueur/longueur invalides, SP hors pile, marge principale < 128 o ; la zone sous la limite n'est plus qu'un indicateur (jamais fatal, jamais « pile max » dans la ligne de mesure) ; 144 o s'affiche « SOUS L'OBJECTIF 256 » sans arrêt ; `wifiFailed()` appelle `logfSafeStop()` AVANT tout `logf` sur `GUARD` (le tas voisin peut être corrompu, `logf` alloue). **Marge principale à `doRegister` : 144 o (880 / 1 024)** — étroite, à améliorer avant la production. `reportMem()` de production affiche maintenant `zone 0xA5 sous la pile N o (INDICATIF : NON fiable des la 1re pile temporaire)` au lieu de « pile max ~N » (la zone 0xA5 sous `__StackLimit` ne doit jamais être repeinte après le démarrage). `docs/LOT_8B2B2_NETSTACK_WIFI_CALLS_FIX2_2026_10_09.md`. **WIFI-CALLS-FIX3** : le canari de `cf276b5` (Wi-Fi, Ed25519, register 200, PodNet 848 o de marge, A passé) s'est arrêté au contrôle **B** à 124 o parce que `podCanaryCheck(B)` était appelé DEPUIS `podCanaryNet()` (cadre vivant, +20 o) — ni débordement ni faute de PodNet (marqueur et longueur intacts). **Règle d'instrumentation : un contrôle de pile ne s'appelle jamais depuis le corps d'une fonction de rapport ; il suit son retour chez l'appelant** (B après `podCanaryNet` dans `httpCall`, l'image et le candidat ; A avant le rapport, C après le journal HTTP). Testé (`podCanaryNetViolations`, 5 mutants). Les 144 o de `6b` venaient eux aussi d'un B imbriqué : la marge réelle de production est probablement un peu plus grande (à confirmer). `docs/LOT_8B2B2_NETSTACK_WIFI_CALLS_FIX3_2026_10_09.md`. **Le canari de `e99f77e` a validé le déplacement de B** (journal 416/1 056 o, Wi-Fi ≥ 864, Ed25519 ≥ 708, PodNet 848, register et pull 200) **puis révélé un VRAI débordement de la pile principale dans le traitement LOCAL de `doPull`** (après `[PULL] aucune frame` : 1 016 / 1 024 o, marqueur `CNRY` détruit, indépendant du réseau et du rendu). `longueur peinte=0x1A1 (OK)` était trompeur : l'ancien contrôle ne testait qu'une plage. **DOPULL-PHASE-AUDIT1** (instrumentation seule, aucune correction) : le contrôle de longueur est maintenant EXACT (`g_podPaintLen`) ; dix sondes silencieuses `POD_DP_PROBE(n)` dans `doPull` mémorisent la PREMIÈRE phase où le marqueur ou la longueur diffère (deux statiques de canari : +16 o de RAM, marge 512 o) ; rapport `podCanaryDoPull()` APRÈS le retour de `doPull`, sur la pile de journal (setup, boucle) ; analyse ELF `scripts/dopull-chain-report.js` : **le premier pull part de `setup` (cadre 224 o), les suivants de `loop` (56 o) : 168 o de plus au premier pull**, et la sérialisation ArduinoJson → `String` (584 o) dépasse la pile depuis `setup` (1 120 o statiques). **Découverte : le bloc de sondes précédait la définition des drapeaux du fichier ⇒ dans un build à drapeaux réglés DANS le fichier (IDE) les sondes de phase de PodNet étaient exclues en silence (macros indéfinies = 0) : les canaris FIX3 → `e99f77e` n'ont jamais exercé ces sondes ; bloc et inclusion de `podNetStack.h` déplacés après `// POD_RENDER_V1_END` (règle : tout bloc de canari vient APRÈS les drapeaux).** Production : même code (1 014 / 1 015 fonctions identiques en désassemblage normalisé ; l'ordre d'émission de quatre fonctions change). **Aucune correction avant la mesure matérielle des phases ; aucune frame ; ne jamais déplacer le JSON dans la transaction TLS.** `docs/LOT_8B2B2_DOPULL_PHASE_AUDIT1_2026_10_09.md`. **Le canari de `b03c0b4` a localisé le débordement : phases 1 à 3 saines, phase 4 fautive = PENDANT `deserializeJson(doc, resp)` de la réponse `/api/pull`** (réseau, TLS, Wi-Fi, Ed25519, journal sains ; les sondes de PodNet étaient enfin actives). **DOPULL-JSON-STACK-FIX1 (10/10/2026)** : TOUT le décodage de `/api/pull` (document JSON, `deserializeJson` 429 ET réponse, conversions `JsonVariant -> String`, branche `pendingObservation`, `ownedBlock`) s'exécute sur une **pile de travail dédiée** (`podWorkRun` dans `podNetStack.h` : 2 048 o au tas, garde 64 o, marge >= 128 o, objectif 256 o, jamais imbriquée, échec fermé, effacée avant `free`), APRÈS la fermeture de TLS (`httpCall` est revenu) ; sortie = `PullParsed` BORNÉE (identifiants <= 64 car., `frameSource` <= 16, observation <= 8 empreintes : REFUSÉ au-delà ; textes du cartel 255 / 127 / 63 o : TRONQUÉS à une frontière UTF-8), allouée au tas ; **aucun effet de bord (état global, EEPROM) avant un retour valide** ; ordre des effets inchangé. Cadre de `doPull` 264 -> 136 o, pire chaîne statique depuis `setup` 1 096 -> 704 o, ArduinoJson hors de la pile principale. Règle : **tout traitement local profond (JSON, conversions) passe par `podWorkRun`, jamais sur la pile principale ni dans une transaction TLS ; ne jamais déplacer le JSON dans la transaction TLS.** Sketch e-ink 2,9″ seul (propagation aux autres firmwares R4 APRÈS validation matérielle) ; compilé + hôte contre ArduinoJson réel seulement, JAMAIS flashé ; canari sans frame à refaire (ligne `[CANARY] pull JSON`). `docs/LOT_8B2B2_DOPULL_JSON_STACK_FIX1_2026_10_10.md`. **REGISTER-JSON-STACK-FIX1 (10/10/2026)** : le canari de `c19efb8` s'est arrêté à `6b` (doRegister 948 / 1 024 o, marge 76 o < 128, marqueur et longueur intacts) : le parseur de `/api/register` tournait encore sur la pile principale et le pull n'a jamais été atteint. La réponse du register est décodée sur la MÊME pile de travail (`registerParseWork`, `RegisterParsed` de 28 o au tas, `doRegisterDecode` qui n'inscrit `deviceId`/`pairCode`/`paired`/`registered` que dans la seule branche valide) ; `deviceId` = `dev_` + 8 car. `[A-Z0-9]` et `pairCode` = 8 car. de l'alphabet du serveur : REFUSÉS (jamais tronqués) ; cadre de `doRegister` 240 -> 176 o, pire chaîne depuis `setup` 1 096 -> 824 o. **Inventaire formel (`scripts/json-inventory.js`, figé par test) : 21 `deserializeJson` dans les cinq firmwares R4, 3 sur la pile de travail (e-ink 2,9″), 18 sur la pile principale ; `doValidate` (e-ink 2,9″) est le dernier de la voie vote et doit être migré AVANT le premier vote réel** (chaîne statique sous les 128 o). Ne pas propager aux autres firmwares avant validation matérielle. `docs/LOT_8B2B2_REGISTER_JSON_STACK_FIX1_2026_10_10.md`. **Canari `231393d` RÉUSSI sur la carte** (register JSON 448 o / marge 1 536, pull JSON 620 – 724 o / marges 1 260 – 1 364, trois pulls, tas stable, aucun verrou ; `7b` à 132 o) : `docs/AUDIT_GPT_231393D_CANARI_3_PULLS_2026_10_10.md`. **DOVALIDATE-JSON-STACK-FIX1 (10/10/2026)** : la réponse de `/api/validate-candidate` est décodée sur la même pile de travail (`validateParseWork`, `ValidateParsed` ≈ 170 o au tas, `doValidateDecode`) ; candidateId (8–64 car. `[0-9A-Za-z-]`), écran (1–16 `[a-z0-9_]`), hash (exactement 64 hex) et taille (1–262 144) REFUSÉS jamais tronqués ; sorties seulement avec un résultat complet ; `pendingCandidateId` effacé APRÈS le retour du décodeur sur tout résultat sans vote (comme avant) ; cadre de `doValidate` 520 -> 424 o. **Limite d'imbrication explicite `POD_WORK_JSON_NESTING = 8` pour les trois décodeurs** (l'instance partagée coûte 112 o par niveau : à 10, le pull aurait eu 88 o de marge) ; `POD_WORK_DEEPEST_CALL = 1536`. Inventaire (`scripts/json-inventory.js`, figé par test) : 21 `deserializeJson`, 4 sur la pile de travail (e-ink 2,9″), 17 sur la pile principale (autres firmwares). **Plus aucun parseur de la voie vote du e-ink 2,9″ sur la pile principale ; la ligne canari `validate JSON` n'apparaît que si un candidat est annoncé ; une frame PERSONNELLE ne crée pas de candidat, un dessin soumis au réseau si.** Ne pas propager avant validation matérielle complète. `docs/LOT_8B2B2_DOVALIDATE_JSON_STACK_FIX1_2026_10_10.md`. **Canari `7df39b6` (deux images envoyées) : premier blocage matériel dans le téléchargement de la frame** — après `[PULL] nouvelle frame … (personal)` plus aucune ligne (ni `[HTTP GET] … pull-frame`, ni `[FRAME]`, ni ACK) pendant ≈ 30 min ; register JSON et pull JSON restent validés ; le dessin neuf n'a reçu que 2 votes sur 3 (le R4 bloqué n'a pas voté). **PULLFRAME-PHASE-AUDIT1 (10/10/2026), instrumentation SEULE** : 15 marques `[CANARY] FF n : … | marqueur OK|DETRUIT | perdues=k | t=` autour de `doFetchFrame` (canari uniquement ; `g_podFfPhase` / `g_podFfDrop` : +2 o de RAM statique) ; **le cœur R4 (`SerialUSB::write`) boucle SANS LIMITE quand le tampon USB est plein et que l'hôte ne le vide pas** : les marques n'impriment que s'il reste 120 o (attente bornée 200 ms) et comptent les lignes perdues — règle : un instrument de pile/phase ne doit jamais pouvoir bloquer sur la série. Par lecture des cœurs 1.5.3 et 1.6.0, chaque commande AT du module est bornée à 10 s (`MODEM_TIMEOUT`) et `connect` à ≈ 50 s : un blocage de 30 minutes suppose `millis()` figé, une boucle sans limite hors du réseau (USB, tas) ou une faute — la cause est INCONNUE. Production inchangée (désassemblage normalisé 1031 / 1036 identiques). La capture Vercel fournie ne couvrait que 13:41 – 14:11 (la frame a été envoyée avant) : la preuve est le journal série. Aucune correction avant la localisation matérielle. `docs/LOT_8B2B2_PULLFRAME_PHASE_AUDIT1_2026_10_10.md`. **Le canari `3628b3d` (un Reset, aucune image renvoyée) s'est tu au même endroit SANS AUCUNE ligne FF (pas même FF 1) : le traçage par `logf` n'a rien localisé. PULLFRAME-PHASE-AUDIT2 (10/10/2026), instrumentation SEULE** : chaque marque (mêmes 15 phases) s'INSCRIT d'abord dans `g_podFfRec`, 20 o en section `.noinit` (le script d'édition de liens du cœur la prévoit : ni copiée ni mise à zéro, survit à un reset, ni EEPROM ni flash), scellée par une somme, relue et rapportée au démarrage suivant (`[CANARY] FFREC demarrage precedent … derniere phase P`) ; les phases 4 à 14 (pile réseau dédiée) écrivent en plus UN jeton de 7 o `[FFnn]` par UN `Serial.write`, seulement si `availableForWrite() >= 7` (sinon perdu et compté) — ni `logf`, ni formatage, ni allocation, ni attente ; **phases 1, 2, 3, 15 (pile principale, marge 132 – 224 o) : enregistrement seul, jamais d'E/S série (l'écriture USB coûte 270 – 430 o de pile)**. Démarrage : empreinte `BUILD PULLFRAME-PHASE-AUDIT2 | base 3628b3d | compile <date heure>` (le hash du commit d'instrumentation ne peut pas se graver lui-même) et jeton de contrôle `[FF00]`. Coût : canari +1 408 o de flash, RAM statique INCHANGÉE (22 784 o), chaînes de pile identiques ; production : texte du sketch identique à `3628b3d` hors canari. Règle : **un instrument de localisation ne doit dépendre ni du tas ni du port USB qu'on soupçonne ; ne jamais poser d'E/S série sur la pile principale.** Le cœur : FIFO USB de TX = 256 o, USB géré par interruption. Le mécanisme `.noinit` n'a JAMAIS tourné sur la carte (le chargeur d'amorçage peut effacer la RAM : la somme le détecte). Aucune correction avant la localisation. `docs/LOT_8B2B2_PULLFRAME_PHASE_AUDIT2_2026_10_10.md`. **Le canari AUDIT2 (`3ace43b`, binaire confirmé) s'est tu au même endroit : jeton de contrôle perdu au démarrage (FIFO USB de TX = 256 o, plein juste après une ligne de 250 caractères), enregistrement RAM « aucun valide » (valeur normale d'un premier démarrage : la perte de `.noinit` au Reset n'est pas établie). PULLFRAME-PHASE-AUDIT3 (10/10/2026), instrumentation SEULE** : la trace vit en FLASH DE DONNÉES — la « EEPROM » de la R4 est une flash de 8 Ko (8 blocs de 1 Ko, `veeprom`) ; les clés, le dernier bloc et l'état du firmware tiennent dans les 452 premiers octets du bloc 0 ; le journal occupe le **bloc 7 (0x1C00 – 0x1FFF)**, EN AJOUT SEUL : un effacement du bloc 7 par démarrage au plus (aucun si le journal précédent est vide), puis chaque marque programme UN octet vierge (`DataFlashBlockDevice::program`, numéro de phase sur 4 bits + son complément sur 4 bits ; 0xBD = pile principale détruite) ; **jamais `EEPROM.update` pour une trace : il alloue une page de 1 Ko au tas et efface/reprogramme un bloc de 1 Ko à chaque écriture** ; au démarrage, rapport protégé du journal précédent (`FFLOG demarrage precedent … DERNIERE PHASE P … sequence`) puis réarmement vérifié par relecture ; jeton série d'UN octet (lettres `D` à `N`) pour les phases 4 à 14 seulement et seulement si la place existe ; phases 1, 2, 3, 15 (pile principale) : flash seule (≈ 165 o de pile) ; `podFfBoot` est `noinline` (sinon `setup` gagne 16 o). Usure : un effacement par démarrage, 1 016 octets programmés au plus ; absent de la production (testé). Coût : canari +896 o de flash, RAM statique INCHANGÉE (22 784 o), chaînes de pile identiques, production identique hors canari. Test hôte du code réel contre une flash simulée (`consensus-pod/host/ffl_harness.cpp`, ET binaire, pannes, valeurs aléatoires). Règle : **un instrument de localisation doit survivre à un Reset ET ne pas dépendre du tas ni de l'USB ; ne jamais utiliser `EEPROM.update` comme trace.** Jamais essayé sur la carte. `docs/LOT_8B2B2_PULLFRAME_PHASE_AUDIT3_2026_10_10.md`. **Le canari AUDIT3 (`2cdfe54`) A LOCALISÉ le blocage, sur deux démarrages consécutifs : `DERNIERE PHASE 9 (apres client.print)`, séquence `0123456789` — connexion TLS réussie, requête construite, `client.print` revenu (requête remise au client Wi-Fi, PAS prouvée arrivée chez Vercel), la phase 10 (retour de `readHeaders`) jamais écrite ; la trace en flash de données fonctionne sur la carte (9 octets programmés pendant le dialogue TLS sans erreur). PULLFRAME-PHASE-AUDIT4 (10/10/2026), instrumentation SEULE** : (1) client TLS « espion » `FfSSL` (dérivé de `WiFiSSLClient`, nom redirigé par `#define WiFiSSLClient FfSSL` entre sa définition et `struct Conn` : aucune ligne de production ne change, `pod_http.h` partagé NON modifié) qui, entre les marques 9 et 10 SEULEMENT, inscrit en flash l'entrée et la sortie des appels 1, 2, 3, 4, 8, 16, 32, 64, 128 de `read()` et de `connected()` avec le temps écoulé (octet = unités de 8 ms, plafonné à 254, 0xFF = vierge) et un événement par seconde (`T<n>`), **64 événements au plus** ; (2) **cinq LED de la matrice de la carte pilotées EN STATIQUE par les registres** (mêmes masques et routine que `turnLed` du cœur ; anode 7, cathodes 3, 4, 8, 0, 6 ; ni minuteur, ni interruption, ni bibliothèque `Arduino_LED_Matrix` à 10 kHz ; **jamais D13 : c'est l'horloge SPI de l'e-ink**) : F écriture flash en cours, R dans `read`, C dans `connected`, A trace active, H `readHeaders` revenue (allumée AVANT l'écriture flash de la phase 10) ; elles restent allumées si le firmware se fige ; test séquentiel au démarrage ; (3) rapport en lignes courtes — **`logf` tronque à 255 caractères** (un test refuse tout format plus long). Production : texte du sketch identique hors canari ; canari +1 440 o de flash, RAM +8 o (22 792 o), chaînes de pile et pile réseau identiques. Test hôte du code réel (flash, client TLS qui ne rend jamais la main, LED simulés). Règle : **pour localiser un blocage, un témoin matériel indépendant du chemin suspect (LED statiques) en plus d'une trace qui survit au Reset ; ne jamais modifier un en-tête partagé pour instrumenter, observer à la frontière (sous-classe du client).** Jamais flashé. `docs/LOT_8B2B2_PULLFRAME_PHASE_AUDIT4_2026_10_10.md`. **Le canari AUDIT4 (`fd8b1dc`) a réduit la zone du gel à ≈ 224 ms – 1 s après la remise de la requête : journal `gen=3` = `DERNIERE PHASE 9` puis six itérations échantillonnées (`R→Z`, `C→K` : `read()` sans octet, `connected()` vrai, ≈ 13 ms par tour) et RIEN d'autre, pas même `T1` ; la fenêtre est celle de l'arrivée de la réponse du serveur. Lecture du binaire (cœurs 1.5.3 = 1.6.0) : `operator new(size_t)` qui échoue sans gestionnaire → `abort()` → `raise(6)` → `_exit` = `b.n _exit` (BOUCLE VIDE, interruptions actives : ni message ni reset, horloge et USB continuent) ; `Modem::buf_read` accumule la réponse « dimensionnée » par `data_res += c` sur une `std::string` du tas (bloc jusqu'à ≈ 511 o → capacité 960 o) : hypothèse H5, NON démontrée. PULLFRAME-PHASE-AUDIT5 (11/10/2026), instrumentation SEULE** : (a) `abort()` REDÉFINIE en canari seulement (`extern "C" void abort(void) { podFfDie(0xAB); }`) : `podFfDie` = LED X, UNE signature dans le journal flash, boucle `for (;;)` — aucune allocation, aucun `String`, ni `logf` ni Serial, aucune exception, aucun verrou du tas, pas de `mallinfo` (corps vérifié au mot près) ; (b) avant chaque `read()` échantillonné, deux mesures du tas dans le journal (M = tas libre = `mallinfo().fordblks`, V = sommet vierge = `sbrk(0)` jusqu'à `__StackLimit`, unités de 32 o, plafonnées à 254) — le plus grand bloc libre n'est PAS disponible sans allocation (la `mallinfo` du cœur ne renseigne que l'arène et le total libre) ; (c) sixième LED X (cathode 5) et repère « six LED ensemble » au test de démarrage ; (d) 96 événements au plus ; rapport `FFLOG tas avant read : libre A o puis B o ; sommet vierge C o puis D o ; abort() : OUI|non`. **Règle : ne JAMAIS installer `std::set_new_handler` pour instrumenter — `operator new(nothrow)` l'appelle au lieu de renvoyer 0 et détournerait les chemins « échec = rejet » des décodeurs ; ne pas mettre de `#ifndef/#endif` imbriqués dans un bloc de canari (le retrait des blocs par les tests s'arrête au premier `#endif`).** Production : texte du sketch identique hors canari ; canari +408 o de flash, RAM 22 792 o inchangée, chaînes de pile identiques. Jamais flashé. `docs/LOT_8B2B2_PULLFRAME_PHASE_AUDIT5_2026_10_11.md`.

**PULLFRAME-BOUNDED-SSL-FIX1 (11/10/2026, UNO R4 e-ink 2,9″ SEUL, compilé sur l'HÔTE seulement, jamais flashé)** : le canari AUDIT5 a prouvé `abort()` DANS `WiFiSSLClient::read` ; cause très probable : le cœur WiFiS3 (1.5.3 = 1.6.0) envoie `_SSLCLIENTRECEIVE` avec `freePositions()-1` = **1 023 o** et `buf_read` accumule la réponse dans une `std::string` vide (capacité jusqu'à 1 920 o, bloc contigu > 1 888 o disponibles). `arduino_uno_r4/pod_uno_r4_eink29/pod_ssl_bounded.h` (`PodBoundedSSL : WiFiSSLClient`, `rx_buffer`/`_sock` protected) borne la VRAIE commande à **240 o**, réserve la chaîne de réponse une fois (257 o) et pose un défaut collant (échec fermé : ni affichage, ni ACK). Sketch : 4 fragments (`tests/helpers/boundedSslEdits.ts`). Preuves : harnais hôte qui compile le VRAI `Modem.cpp`/`WiFiSSLClient.cpp` (`node scripts/fetch-wifis3-sources.js`, sources tierces jamais commitées) ; compilation ARM, mesures et canari matériel **à faire par le porteur**. Aucune propagation aux autres firmwares avant le canari. `docs/LOT_8B2B2_PULLFRAME_BOUNDED_SSL_FIX1_2026_10_11.md`. **CANARI RÉUSSI sur la carte (11/10/2026)** : frame de 9 472 o reçue (`lu noir=4736 rouge=4736`), rendu v1, affichage et ACK, sans abort (pile réseau 1 184 o / marge 800) — verdict et réserves (binaire non identifié par la ligne BUILD, un seul essai en 1/1, pile principale 132 o) : `docs/CANARY_R4_EINK29_BOUNDED_SSL_FIX1_VERDICT_2026_10_11.md`. **Règle : toute lecture TLS R4 passe par `PodBoundedSSL` ; ne jamais redéfinir `operator new` ni installer de `new_handler`.**

**LOT8B2D-R4-TFT28-CANARY-1 (12/10/2026, branche `claude/r4-tft28-canary-8b2d`, UNO R4 + TFT 2,8″ SEUL, compilé cœurs 1.5.3 ET 1.6.0 + hôte, JAMAIS flashé)** : canari **SANS VOTE** (`POD_CANARY=1` : routes, signature, décodeur et lecture du candidat NON compilés — absents de l'ELF — ; candidat et observation oubliés ; banc d'essai ignoré ; ACK qui décide du succès ; instrument de pile / tas à arrêt sûr), `POD_CANARY=0` et `POD_RENDER_V1=0` au dépôt (`POD_RENDER_V1` sans effet : pas de cartel gravé). Correctifs mémoire : `PodBoundedSSL` porté (non validé sur cette carte), JSON register / pull / validate / banc d'essai sur `podWorkRun`, **carte SD / TFT de haut niveau sur pile dédiée (`onSd`, 1 536 o) — l'analyse statique montrait 24 o de marge au masquage du cartel et un dépassement à la création du clip d'animation** ; voie vote : marge statique encore de 120 o (vote NON traité, lot suivant). Preuves : harnais hôte du firmware COMPLET (image 240×320 octet par octet, cache SD, cartel, tactile, animations, pannes, ACK 200 / refusé / impossible, aucun vote en 10 minutes de boucle), inventaire formel, 27 mutants refusés. **Règle : toute opération SD / TFT de haut niveau depuis la pile principale passe par `onSd` (gabarits dans `pod_sd_stack.h` — JAMAIS de `template` dans un `.ino` : le générateur de prototypes d'Arduino casse la compilation, FIX1 du 13/10/2026) ; jamais de vote dans un canari TFT ; toute compilation d'un sketch se vérifie avec le dossier du sketch tel quel, jamais via une enveloppe.** `docs/LOT_8B2D_R4_TFT28_CANARY_2026_10_12.md` (protocole matériel au § 6), mesures `docs/mesures/8B2D_2026_10_12/`. **REGISTER-STACK-FIX2 (13/10/2026)** : le premier canari matériel s'est arrêté à 916/1 024 o (marge 108 o < 128) au retour de `doRegister` ; `doRegister` est désormais un pilote en phases `noinline` (MAC, corps par ajouts successifs détruit après la requête, décodage, journal, écran « Connecte » / « Register echoue » sur la pile dédiée `onSd`, onboarding QR inchangé), échec fermé ; prévision statique 660 → 604 o (appairé), écran hors pile principale ; marge matérielle attendue 160–300 o, NON mesurée (objectif 256 o non démontré). Compilé (1.5.3 / 1.6.0) + hôte seulement, jamais flashé ; aucun vote. `docs/LOT_8B2D_R4_TFT28_CANARY_2026_10_12.md` § 11. **Canari FIX2 VALIDÉ sur la carte (13/10/2026)** : register 200, marge principale 244 o (108 avant), frames de 153 600 o reçues/affichées/ACK, pile principale au pire 184 o ; défaut établi : `[ANIM] mémoire insuffisante` (plus grand bloc 4 884 o). **LOT8B2E ANIM-STREAM-FIX1** : le clip PBC1 est écrit sur la SD au fil de la réception, validé et joué EN FLUX (`pod_bench_stream.h`, 2 048 o de travail quel que soit le clip, validation de mêmes codes que `podbench::parse`, aucune lecture SD pendant une transaction TFT) ; compilé + hôte seulement, jamais flashé, piles de lecture non mesurées. `docs/LOT_8B2E_ANIM_STREAM_FIX1_2026_10_13.md` (la SD comme nœud d'archive : idée consignée § 6, non commencée).

**LOT8B2C-ESP8266-EINK29-CANARY-1 (12/10/2026, branche `claude/esp8266-eink29-canary-8b2c`, ESP8266 e-ink 2,9″ SEUL, compilé cœur 3.1.2 + hôte, JAMAIS flashé)** : canari local `POD_RENDER_V1 && POD_CANARY` (0/0 au dépôt) pour valider frame personnelle → TLS fermé → rendu v1 en flux → ACK, **AUCUN vote** (`doValidate` oublie le candidat avant tout réseau). **BearSSL ≠ WiFiS3** : rien de `PodBoundedSSL`/`podNetStack`/`podWifiRun`/`podWorkRun` n'est copié ; risque = TAS (BearSSL ≈ 27 Ko dont pile de poussée 6 200 + iobuf 16 384 + 512, + 9 472 o de plans pendant le TLS ≈ 2 Ko de marge estimée) et chien de garde. Canari : pré-vol TLS, refus Content-Length/surplus, phases en RTC, cause de reset, arrêt après 2 resets anormaux, mesures tas/maxBloc/frag/pile cont/intervalle producteur. OFF inchangé (RAM/flash identiques, désassemblage normalisé identique, texte identique hors blocs gardés). Harnais hôte sur le code RÉEL (`consensus-pod/host/esp_mock/`, `esp_frame_harness.cpp`). `docs/LOT_8B2C_ESP8266_EINK29_CANARY_2026_10_12.md`, mesures `docs/mesures/8B2C_2026_10_12/`. **CANARI MATÉRIEL VALIDÉ (12/10/2026, `6ccb729`)** : frame personnelle 9 472 o reçue, rendu v1, affichage, ACK 200, sans vote ni reset ; tas minimum pendant BearSSL 4 000 o (bloc 2 776 o), retour exact à 33 352 o après le TLS ; réserve : 3 × `e-Paper busy TIMEOUT` (init du panneau 45 s, pilote `Init()` inchangé, non corrigé : comparer au binaire OFF). **FIX2** : une frame déjà affichée (même `frameId`) sans candidat respecte désormais le `retryAfter` du serveur (pulls toutes les 60 s auparavant). `docs/LOT_8B2C_ESP8266_EINK29_CANARY_2026_10_12.md` § 4 ter, journal brut dans `docs/mesures/8B2C_2026_10_12/`.

**Mesures des appareils / capteur R4 + DHT22 (12/10/2026)** : modèle GÉNÉRIQUE `lib/measures.ts` — une liste Redis par appareil `meas:{deviceId}` (entrée `t;temp=211;hum=719`, dixièmes d'unité), registre de grandeurs `MEASURE_KINDS` (ajouter un capteur = une ligne), index `meas:devices`. Une carte sans écran s'enregistre avec `screens=["sensor"]` (pseudo-écran) ; une carte avec écran déclare `sensors=[…]` à `/api/register`. `POST /api/sensor` (code + appairé, anti-rafale `SET NX`, ≈ 8 commandes Redis/mesure), `GET` propriétaire (31 j) ou `?public=1` (48 h, CDN 2 min). **Un capteur seul n'entre JAMAIS dans `devices:all`, une pool d'écran ni le quorum** (`getGlobalActiveCount`/`getPoolSnapshot` l'ignorent). Visible : profil « 🌡 Mesures », Topologie, Constellation, panneau latéral (`app/MeasuresChart.tsx`, `app/profile/SensorPanel.tsx`). Essai à 5 min terminé : le serveur n'accepte l'intervalle court que jusqu'au 16/10/2026 00:00 UTC (`MEASURE_TEST_UNTIL_MS`), puis 50 min minimum. Firmware compilé et flashé par le porteur (mesures correctes, validé 12/10) : **cadence définitive (firmware `r4dht22-1.3`) : LECTURE toutes les 30 min, ENVOI toutes les heures (2 lectures/envoi, tampon de 12 en RAM, âge par lecture, un seul LPUSH : 8 commandes Redis par envoi ≈ 5 800/mois), serveur : refus < 50 min, 1 488 entrées = 31 j ; température/humidité et « connexion » (rssi, lat, dl) sont deux parties séparées de l'interface ; une carte sans écran affiche ses mesures sur sa carte du profil (`GET /api/devices` : `latest`)** ; **débit `dl`** = temps de lecture de `public/speedtest.bin` (4 Ko, CDN, 0 Redis) joint à la mesure, via `PodBoundedSSL` ; diagnostic Wi-Fi dans la même mesure (`rssi` dBm, `lat` ms : grandeurs `primary:false`, panneaux seulement) ; vue réseau : monde élargi en topologie, pincement tactile sur un nœud corrigé en constellation. `docs/CAPTEUR_TEMPERATURE_R4_DHT22.md`.

**RÉSEAU DE VOTE RÉEL (14/10/2026, production directe)** : `docs/LOT_VOTE_REEL_COMPLET_2026_10_14.md` et `docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md`. Les tests passent en **production directe jusqu'à nouvel ordre** (infrastructure Preview, `TFT28-PREVIEW-ENROLL-1` et protocole d'isolation conservés en sommeil ; phrase de bascule : « réactiver les tests isolés »). Branche `claude/integration-vote-reel-2026-10-14`. `lib/voteCapability.ts` : seuls les firmwares qui savent voter en v2 (liste `VOTE_V2_FIRMWARE`, par version déclarée à `/api/register`) comptent dans le quorum, reçoivent quelque chose de `/api/pull` et peuvent voter (`/api/validation-result`, `/api/validate-candidate` : 403 sinon) ; capteurs seuls hors mécanisme ; interrupteur `VOTE_ONLY_NETWORK=false`. Défauts du vote réel : `MIN_V2_APPROVALS` = 1 (un écho v1 seul ne mine plus), `STRICT_SIGNATURE` strict (`false` pour revenir au permissif). Les 4 firmwares compilés **sans aucun drapeau** contiennent le vote v2 (canaris = drapeaux à 1, non utilisés ici). **Toute nouvelle version de firmware qui sait voter doit être ajoutée à `VOTE_V2_FIRMWARE`** (sinon elle est coupée). Le vote v2 des ESP8266 et R4 e-ink n'a jamais tourné sur la carte.

## Non-goals

Ne pas faire :
- refonte UI
- nouveau design
- changement de framework
- base de données
- websocket
- auth blockchain / wallet / seed phrase
- logique proof-of-draw V2 complète avant que V1 multi-écrans soit validée
- fetch sortant vers IP locale
- renommage massif de fichiers
- déploiement

---

## Format de rendu

1. Lister les fichiers modifiés
2. Lister les fichiers créés
3. Donner le contenu complet de chaque fichier
4. Pas de pseudo-diffs incomplets
5. Pas de réarchitecture totale
6. Build TypeScript valide
