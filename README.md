# ESP Canvas MVP

Application Next.js pour dessiner et envoyer des frames vers des écrans ESP8266 (e-ink, OLED).

## Démarrage rapide

```bash
npm install
# Éditez .env.local avec votre IP
npm run dev
```
→ http://localhost:3000

## Flows
1. `/onboard` — Enregistrer un device (nom, IP:PORT, écrans)
2. `/draw` — Sélectionner device + écran → Canvas adapté → Envoyer
3. `/admin` — Dashboard devices, ping, stats

## Écrans supportés
| ID | Nom | Résolution | Couleurs |
|----|-----|-----------|---------|
| `eink29bwr` | E-Ink 2.9" BWR | 296×128 | N/B/Rouge |
| `oled096` | OLED 0.96" | 128×64 | N/B |
| `eink27bw` | E-Ink 2.7" BW | 264×176 | Niveaux de gris |

## Tester sans ESP (ESP mock Python)

```python
# fake_esp.py — lancez avec: python fake_esp.py
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/ping':
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
    def do_POST(self):
        n = int(self.headers.get('Content-Length',0))
        data = json.loads(self.rfile.read(n))
        print(f"FRAME: screen={data['screen']} data_len={len(data.get('data',''))}")
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','POST,GET,OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()
    def log_message(self, *a): pass

HTTPServer(('',8080),Handler).serve_forever()
```

Puis enregistrez dans /onboard : IP=127.0.0.1 PORT=8080

## ESP8266 — esp8266/esp_canvas.ino
1. Arduino IDE + board ESP8266
2. Librairies: ArduinoJson, GxEPD2 (e-ink) ou Adafruit SSD1306 (OLED)
3. Modifiez WIFI_SSID, WIFI_PASSWORD, SCREEN_TYPE
4. Flashez → POST /frame reçu, loggé Serial

## API
- `GET /api/devices` — Liste devices
- `POST /api/onboard` — `{name, ip, port, screens[]}`
- `POST /api/draw` — `{deviceId, screen, data: base64}`
- `POST /api/ping` — `{deviceId}`

## Sécurité (mockée)
`lib/security.ts` : checkAuth(), rateLimit(15min), quotaDaily(1) → toujours true.
Prêt à brancher JWT + Redis + DB.

## Déploiement
```bash
npx vercel --prod
# Pour la persistance: activer Vercel KV et adapter deviceStore.ts
```

Rappels :
📋 GUIDE DÉFINITIF — CANVAS → BUFFER ÉCRANS
Pour éviter de refaire les mêmes conneries sur les écrans.

🎯 Contrat global (inchangé)
ts
export type ScreenPayload =
  | { screen: "oled096"; buffer: string }        // 128×64 SSD1306, 1024 bytes
  | { screen: "eink27bw"; buffer: string }      // 176×264 Waveshare V2, 5808 bytes
  | { screen: "eink29bwr"; black: string; red: string } // 128×296 Waveshare V4, 4736×2 bytes
🖥️ 1. OLED 0.96" SSD1306 128×64
TS (canvas → buffer)
ts
const OLED_W = 128, OLED_H = 64;
const BUF_SIZE = 1024;

const buffer = new Uint8Array(BUF_SIZE).fill(0x00); // 0x00 = éteint

for (y=0; y<64; y++) for (x=0; x<128; x++) {
  const i = (y*128 + x)*4;
  const a = px[i+3]; if (a < 32) continue; // transparent = éteint
  const lum = (px[i]*3 + px[i+1]*6 + px[i+2])/10;
  const isLit = lum < 128; // sombre = allumé
  if (!isLit) continue;

  const page = y/8, bit = y%8;
  buffer[page*128 + x] |= (1 << bit);
}
Arduino (Adafruit_SSD1306)
cpp
size_t len = base64Decode(bufferB64, ..., oledBuf, 1024);
uint8_t* fb = oled.getBuffer();
memcpy(fb, oledBuf, 1024);
oled.display();
⚠️ Points critiques

a < 32 OBLIGATOIRE sinon fond transparent = écran plein

lum < 128 pour allumer les sombres (trait)

bit 0 = éteint, 1 = allumé

page-major : byteIndex = page*128 + x

🖨️ 2. E-INK 2.7" BW Waveshare V2 (176×264 logique)
TS (canvas 264×176 → buffer driver)
ts
const EPD_W = 176, EPD_H = 264;
const bytesPerRow = 22, BUF_SIZE = 5808;

const buffer = new Uint8Array(BUF_SIZE).fill(0xff); // 0xFF = blanc

for (y=0; y<176; y++) for (x=0; x<264; x++) { // canvas 264x176
  const i = (y*264 + x)*4;
  const a = px[i+3]; if (a < 32) continue;
  const lum = (px[i]*3 + px[i+1]*6 + px[i+2])/10;
  if (lum > 128) continue; // blanc = reste 1

  // Rotation 90° CCW
  const bufCol = y;        // 0..175
  const bufRow = 263 - x;  // 0..263
  const byteIndex = bufRow * 22 + (bufCol/8);
  const bit = 7 - (bufCol%8);
  buffer[byteIndex] &= (~(1<<bit)) & 0xff;
}
Arduino (epd2in7_V2)
cpp
size_t len = base64Decode(bufferB64, ..., e27Buf, 5808);
epd27.Display(e27Buf);
epd27.Sleep();
⚠️ Points critiques

0xFF = blanc, 0 = noir

Rotation 90° CCW obligatoire : bytesPerRow = 176/8 = 22

MSB-first : bit = 7 - (col%8)

🌈 3. E-INK 2.9" BWR Waveshare V4 (128×296 logique)
TS (canvas 296×128 → buffers driver)
ts
const EPD_W = 128, EPD_H = 296;
const bytesPerRow = 16, BUF_SIZE = 4736;

const blackBuf = new Uint8Array(BUF_SIZE).fill(0xff);
const redBuf   = new Uint8Array(BUF_SIZE).fill(0xff);

for (y=0; y<128; y++) for (x=0; x<296; x++) {
  const i = (y*296 + x)*4;
  const a = px[i+3]; if (a < 32) continue;
  const color = classifyPixel(r,g,b); // black/red/white
  if (color === "white") continue;

  // Rotation 90° CCW
  const bufCol = y;
  const bufRow = 295 - x;
  const byteIndex = bufRow * 16 + (bufCol/8);
  const bit = 7 - (bufCol%8);

  const mask = (~(1<<bit)) & 0xff;
  if (color === "black") blackBuf[byteIndex] &= mask;
  else redBuf[byteIndex] &= mask;
}
Arduino (epd2in9b_V4)
cpp
size_t blackLen = base64Decode(blackB64, ..., blackBuf, 4736);
size_t redLen   = base64Decode(redB64,   ..., redBuf,   4736);
epd.Display(blackBuf, redBuf);
epd.Sleep();
⚠️ Points critiques

Rotation 90° CCW obligatoire : bytesPerRow = 128/8 = 16

MSB-first

0xFF = blanc, 0 = colored (black ou red)

🔧 Arduino unifié (template)
cpp
void handleFrame() {
  const char* screen = doc["screen"];
  const char* bufferB64 = doc["buffer"];
  const char* blackB64 = doc["black"];
  const char* redB64 = doc["red"];

  if (strcmp(screen, "oled096") == 0) {
    base64Decode(bufferB64, oledBuf, 1024);
    memcpy(oled.getBuffer(), oledBuf, 1024);
    oled.display();
  }
  else if (strcmp(screen, "eink27bw") == 0) {
    base64Decode(bufferB64, e27Buf, 5808);
    epd27.Display(e27Buf);
    epd27.Sleep();
  }
  else if (strcmp(screen, "eink29bwr") == 0) {
    base64Decode(blackB64, blackBuf, 4736);
    base64Decode(redB64,   redBuf,   4736);
    epd29.Display(blackBuf, redBuf);
    epd29.Sleep();
  }
}
⚠️ ERREURS À NE JAMAIS REFAIRE
Erreur	Symptôme	Cause
Erreur	Symptôme	Cause
a < 32 oublié	Buffer plein 0xFF	Transparent = sombre = allumé
Pas de rotation	Image découpée/bandes	bytesPerRow faux
lum > 128 au lieu <	Rien visible	Allume le blanc, pas le trait
drawPixel() boucle	Lent / artefacts	memcpy(getBuffer()) direct
📏 Vérification systématique
Logs obligatoires à chaque écran :

text
[canvasToScreen XXX] XXX pixels allumés
[BUFFER PREVIEW] 0x18 0x3C 0x7E ... (pas que FF/00)
[SEND] XXX: buffer XXX bytes
[HTTP] body=XXXX decoded=XXXX expected=XXXX
Si buffer preview = tapis FF/00 → bug contenu TS
Si decoded != expected → bug transport
Si Displayed OK mais rien → inversion invertDisplay() ou seuil TS faux