# CLAUDE.md

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
