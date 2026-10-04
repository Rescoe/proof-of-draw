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
```

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

## Banc d'essai d'animation — TFT 2.8" (02/10/2026, v1 test)

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
sans aucune requête (0 commande Redis de plus qu'une image fixe). Autres écrans : repli sur le canal du banc d'essai (`lib/anim/deliver.ts`, ≤ 10 min, ≈ 200 commandes/écran).
Plus aucune publication sans consensus : `/api/anim/save` et l'option `gallery` de `/api/bench/send` sont supprimés. Détails, coûts Redis, limites : `docs/ANIMATIONS_PIPELINE.md`.

## Règle PRIMORDIALE — quotas Upstash Redis (écrite le 03/10/2026)

Ne jamais saturer Redis. Toute route, page, cron ou firmware qui y accède doit être pensé en **commandes Redis / heure / acteur AVANT d'être codé** (écrire le coût dans le commit ou la doc).
- Interface web : jamais de `setInterval` nu → pause si `document.hidden`, rythme réduit au repos, arrêt après inactivité, reprise sur `visibilitychange`.
- Mode « test / accéléré » : TTL obligatoire, extinction automatique.
- Regrouper les lectures (`MGET`), pas d'écriture de présence à chaque poll, journaux/listes en pipeline.
- Manquement du 03/10 (page `/bench` : ≈ 8 600 commandes/h par onglet, onglet caché compris) et plan de réduction (tâches Q1–Q12) : `docs/NOTE_BENCH_ET_QUOTAS_2026_10_03.md`.

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
