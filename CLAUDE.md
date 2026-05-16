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
