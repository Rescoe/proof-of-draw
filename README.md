# Proof of Draw

> Un réseau artistique distribué où des écrans e-ink ESP8266 valident collectivement des dessins via consensus, gravant chaque œuvre dans une chaîne légère.

---

## Vision

Proof of Draw est un réseau artistique embarqué qui relie des artistes, des ESP8266, et des écrans physiques e-ink/OLED. Un dessin est soumis depuis une interface web Next.js, propagé à une pool d'ESP du même type d'écran, validé localement selon des métriques simples de complexité visuelle, puis affiché et archivé dans une chaîne légère stockée dans Redis.

Le serveur Next.js / Vercel reste coordinateur et archiveur. Redis / Upstash gère l'état, les locks, les files, les bans, les devices et les pools. Les ESP ne font pas que afficher — ils participent à un protocole de validation distribué.

---

## Stack

| Composant | Technologie |
|-----------|-------------|
| Frontend | Next.js 14 (App Router) — Vercel |
| Backend | Next.js API Routes — Vercel Edge/Serverless |
| Storage | Upstash Redis (KV, TTL natif, pas de DB) |
| Firmware | ESP8266 Arduino — e-ink Waveshare 2.9" BWR + 2.7" BW/OLED |
| Auth | Session HMAC + blacklist Redis |
| Crypto | ED25519 (clés en EEPROM ESP), SHA-256 (hashes blocs) |

---

## Statut actuel — v1 (16/05/2026)

| Composant | État |
|-----------|------|
| Enregistrement ESP (register + pairing QR) | ✅ fonctionnel |
| Dessin web → candidat | ✅ fonctionnel |
| Vote ESP → quorum → bloc miné | ✅ fonctionnel |
| Affichage post-mining sur e-ink 2.9" BWR | ✅ fonctionnel |
| Personal frame | ✅ logique implémentée |
| Rate limiting / blacklist / strikes | ✅ préservé |
| Intégrité chaîne (blockHash EEPROM, parentHash) | ✅ fonctionnel |
| Multi-ESP en pool (quorum > 1) | 🔜 à tester |
| Firmware e-ink 2.7" BW + OLED | 🔜 à porter |

Commit de référence firmware ESP + eink 2.9" BWR : `43aac8f`

---

## Flux complet

```
[Web] Artiste dessine sur /draw
        ↓
POST /api/draw → POST /api/submit-candidate
        ↓
[ESP] GET /api/pull (léger, ~300B) — détecte candidat
        ↓ wait VALIDATE_INTERVAL (30s)
GET /api/validate-candidate (~121B) — récupère metadata + score_server
        ↓
POST /api/validation-result — vote ESP
        ↓ quorum atteint → bloc miné → broadcast frame:{deviceId} Redis
GET /api/pull (léger) — détecte nouveau frameId
        ↓
GET /api/pull-frame?fmt=bin — 9472 bytes binaires (blackBuf + redBuf)
        ↓ readFull() loop garantit réception complète
epd.Display(blackBuf, redBuf) → ✅ affiché sur e-ink
```

---

## Architecture serveur

### Routes API

| Route | Méthode | Rôle |
|-------|---------|------|
| `/api/register` | POST | Enregistrement ESP par MAC. Idempotent. Retourne deviceId + pairCode. Gère les pools Redis. |
| `/api/ping` | POST | Met à jour lastPing/lastSeen du device. |
| `/api/pull` | GET | Retourne metadata légère (~300B) : frameSource, frameId, chain summary, pendingValidation. Rate limit : 2/15min. |
| `/api/pull-frame` | GET | Retourne les buffers pixel en binaire brut (`?fmt=bin`) : blackBuf[4736] + redBuf[4736] concaténés. |
| `/api/validate-candidate` | GET | Retourne metadata du candidat courant (sans payload). Rate limit : 4/min. |
| `/api/validation-result` | POST | Enregistre le vote ESP. Si quorum → finalizeBlock → broadcast → clearCandidate. |
| `/api/draw` | POST | Soumet un dessin depuis l'app web (auth HMAC). |
| `/api/submit-candidate` | POST | Crée le candidat Redis à partir du dessin. |
| `/api/onboard` | POST | Associe un pairCode à un artistName. |
| `/api/ack-frame` | POST | ESP confirme l'affichage d'un frame. |
| `/api/personal-frame` | POST | Stocke un frame personnel pour un device spécifique. |

### Librairies serveur

| Fichier | Rôle |
|---------|------|
| `lib/chain.ts` | Logique chaîne : Block, Candidate, VoteMap, castVote(), finalizeBlock(), clearCandidate(), getChainSummary() |
| `lib/deviceStore.ts` | CRUD devices Redis. TTL 48h. |
| `lib/queue.ts` | Store/retrieve frames depuis Redis. FramePayload typé par écran. |
| `lib/canvasToScreen.ts` | Conversion canvas → buffers e-ink selon profil écran. |
| `lib/rateLimit.ts` | Rate limiting, blacklist, strike system Redis. |
| `lib/crypto.ts` | SHA-256, computeDisplayTime (score → durée affichage). |
| `lib/screenProfiles.ts` | Profils d'écrans : dimensions, formats, BUF_SIZE. |
| `lib/session.ts` | Gestion sessions HMAC pour l'app web. |

### Clés Redis

| Clé | Valeur |
|-----|--------|
| `chain:head` | JSON(Block) — dernier bloc validé |
| `chain:block:{hash}` | JSON(Block) — archive par hash |
| `chain:index:{n}` | blockHash — index séquentiel |
| `candidate:current` | JSON(Candidate) — dessin en attente |
| `candidate:votes` | JSON(VoteMap) — votes reçus |
| `pool:screen:{screenId}` | Set(deviceId) — membres de la pool |
| `frame:{deviceId}` | JSON — frame à afficher (TTL = displayTime) |

---

## Architecture firmware ESP8266

### Boot flow

```
WiFi connect
→ POST /api/register (MAC → deviceId + pairCode)
→ Génération/chargement clés ED25519 EEPROM
→ malloc blackBuf + redBuf (BUF_SIZE × 2 = ~9.5KB)
→ doPull() immédiat
→ loop : pull toutes les 60s / validate toutes les 30s
```

### Contraintes mémoire critiques

L'ESP8266 dispose de ~47KB de heap après WiFi. Chaque connexion TLS (BearSSL) consomme ~16KB de manière fragmentée. Toute la gestion mémoire repose sur ces invariants :

- `blackBuf`/`redBuf` toujours `free()` avant toute connexion TLS, toujours `malloc()` après
- `DynamicJsonDocument` pour les petits JSON alloué après fermeture TLS (scope HTTP fermé)
- `http.useHTTP10(true)` obligatoire — Vercel utilise chunked encoding en HTTP/1.1, incompatible avec `getStream()`
- `/api/validate-candidate` ne retourne PAS le payload image (uniquement metadata + score_server)
- Lecture binaire directe pour les buffers pixel : zéro JSON, zéro base64 côté firmware

### Fichiers firmware

| Fichier | Cible |
|---------|-------|
| `esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino` | Waveshare 2.9" BWR (noir/blanc/rouge) ✅ |
| `esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino` | 2.7" BW + OLED 🔜 |

### EEPROM layout

```
[0..31]   clé privée ED25519 (32 bytes)
[32..63]  blockHash courant (16 premiers bytes du hash = 32 hex chars)
[64]      keyGenerated flag (0x01 = généré)
[65..96]  clé publique (32 bytes)
[97]      onboardingShown flag (0x01 = déjà affiché)
```

---

## Problèmes résolus (session 15-16/05/2026)

### P1 — validate-candidate retournait 13KB

**Symptôme :** heap TLS ESP épuisé, GET → -1, candidateId vide.  
**Cause :** payload base64 inclus dans la réponse, DynamicJsonDocument(4096) épuisé.  
**Fix :** suppression du payload de la réponse. L'ESP vote avec score_server uniquement.

### P2 — candidateId toujours vide après P1

**Cause :** DynamicJsonDocument trop grand alloué après TLS fragmenté → pas de bloc contigu.  
**Fix :** réécriture doValidate() avec DynamicJsonDocument(512).

### P3 — Pull + validate back-to-back : second TLS impossible

**Cause :** loop() déclenchait validate immédiatement après pull.  
**Fix :** reset lastValidateMs = now à chaque nouveau candidat → délai VALIDATE_INTERVAL avant premier vote.

### P4 — voteCount=0, needed=0 → vote ignoré silencieusement

**Cause :** castVote() retourne zeros quand voteMap absent/expiré de Redis.  
**Fix :** détection 409 + log warn côté serveur.

### P5 — JSON error IncompleteInput après bloc miné

**Cause :** getString() ne peut pas allouer une String de 12.8KB sur heap fragmenté post-TLS.  
**Fix :** réécriture doPull() avec http.getStream() → ArduinoJson lit directement le stream.

### P6 — JSON error InvalidInput sur le stream

**Cause :** Vercel utilise Transfer-Encoding: chunked (HTTP/1.1). getStream() reçoit `1ea\r\n{...}`.  
**Fix :** `http.useHTTP10(true)` avant chaque GET.

### P7 — JSON error NoMemory persistant après bloc miné

**Cause :** DynamicJsonDocument(15360) alloué après http.GET() → heap fragmenté par BearSSL → malloc échoue malgré 29KB free total (maxBlock = 19KB).  
**Fix :** séparation en deux routes + lecture binaire directe (voir P8).

### P8 — Architecture pull/fetch séparée (fix définitif)

**Problème :** même avec l'allocation du doc avant TLS, le maxBlock tombait à ~23KB après le pull léger, insuffisant pour un DynamicJsonDocument(16384) dans doFetchFrame.  
**Fix :** `/api/pull-frame?fmt=bin` retourne les buffers en **binaire brut** (9472 bytes, pas de JSON, pas de base64). Le firmware lit directement dans blackBuf et redBuf avec une boucle robuste :

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

**Pourquoi readFull est nécessaire :** `stream->readBytes()` sur TLS peut retourner moins que demandé si les données arrivent en plusieurs paquets TCP → buffers partiels → image hachée.

---

## Généralisation à d'autres types d'écrans

### Côté serveur — `/api/pull-frame`

Le endpoint lit le profil d'écran depuis `screenProfiles.ts` pour déterminer :
- le nombre de buffers (`bw` = 1 buffer, `bwr` = 2 buffers concaténés)
- la `BUF_SIZE` correspondante

Pour les écrans monochrome : envoyer uniquement `blackBuf` (pas de concaténation rouge).  
Ajouter un header `X-Screen-Type` dans la réponse pour validation côté ESP.

### Côté firmware — `doFetchFrame`

`SCREEN_TYPE` et `BUF_SIZE` sont des constantes définies en tête de fichier.  
Pour les écrans BW (un seul buffer) : lire `BUF_SIZE` bytes, appeler `epd.Display(blackBuf)`.  
Pour les écrans BWR : conserver la lecture `black + red` actuelle.

### Côté `screenProfiles.ts`

Chaque profil déclare :
- `BUF_SIZE` : taille d'un buffer en bytes
- `bufferCount` : 1 (BW/OLED) ou 2 (BWR)
- `format` : `"bw"` ou `"bwr"`
- dimensions logiques

---

## Écrans supportés

| ID | Nom | Résolution logique driver | BUF_SIZE | Format |
|----|-----|--------------------------|----------|--------|
| `eink29bwr` | E-Ink 2.9" BWR Waveshare V4 | 128×296 | 4736 | BWR (2 buffers) |
| `eink27bw` | E-Ink 2.7" BW Waveshare V2 | 176×264 | 5808 | BW (1 buffer) |
| `oled096` | OLED 0.96" SSD1306 | 128×64 | 1024 | BW (1 buffer) |

### Conversions canvas → buffer (référence)

#### E-Ink 2.9" BWR (296×128 canvas → 128×296 driver, rotation 90° CCW)

```typescript
const bufCol = y;        // 0..127
const bufRow = 295 - x;  // 0..295
const byteIndex = bufRow * 16 + Math.floor(bufCol / 8);
const bit = 7 - (bufCol % 8);
// 0xFF = blanc, bit à 0 = coloré
```

#### E-Ink 2.7" BW (264×176 canvas → 176×264 driver, rotation 90° CCW)

```typescript
const bufCol = y;        // 0..175
const bufRow = 263 - x;  // 0..263
const byteIndex = bufRow * 22 + Math.floor(bufCol / 8);
const bit = 7 - (bufCol % 8);
```

#### OLED 0.96" (128×64, page-major)

```typescript
const page = Math.floor(y / 8);
const bit = y % 8;
buffer[page * 128 + x] |= (1 << bit);
// 0x00 = éteint, bit à 1 = allumé
```

---

## Consensus — Proof of Presence V1

L'ESP vote sur présence dans la pool. Le score serveur (`score_server`) sert de référence.  
Le quorum est `ceil(poolSize × 0.51)`.

**V2 prévu :** l'ESP calcule ses propres métriques depuis `/api/candidate-payload` (binaire) :
- Entropie Shannon
- Densité de transitions horizontales
- RLE complexity
- Score composite : entropie 40% + transitions 40% + RLE 20%

---

## Sécurité

- Cookie session HMAC-SHA256
- Rate limiting par device (Redis)
- Blacklist IP/device/MAC automatique (après PULL_MAX × 10 dépassements)
- Lock draw atomique SET NX
- TTL sur devices (48h) et frames (displayTime calculé depuis score)
- Pas d'état critique en mémoire Vercel (serverless-safe)
- Pas de fetch sortant vers IP locale (plus de SSRF possible)

---

## Démarrage rapide

```bash
npm install
cp .env.local.example .env.local
# Renseigner UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN
npm run dev
```

→ http://localhost:3000

### Flow d'onboarding ESP

1. Flasher le firmware `esp_eink_2.9BWR.ino` avec WIFI_SSID, WIFI_PASSWORD, SERVER_URL
2. L'ESP démarre, s'enregistre sur `/api/register`, affiche le pairCode sur l'écran
3. Ouvrir `/onboard` sur le web, saisir le pairCode et artistName
4. Dessiner sur `/draw` — le dessin circule vers la pool

---

## Variables d'environnement

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
PULL_WINDOW_SEC=900
PULL_LIMIT_PER_WINDOW=2
BLACKLIST_TTL_SECONDS=604800
DRAW_LOCK_TTL=900
SESSION_SECRET=
```

---

## Roadmap V2

- `/api/candidate-payload` : payload binaire pour calcul local des métriques ESP
- Signature ED25519 réelle (clé privée EEPROM déjà générée)
- Score composite local : entropie + transitions + RLE
- Multi-pool par résolution/couleur d'écran
- Port firmware vers e-ink 2.7" BW et OLED 0.96"
- Mint on-chain (hors scope V1)
