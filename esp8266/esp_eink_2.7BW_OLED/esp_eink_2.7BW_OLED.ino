// esp_multiscreen_pull.ino — v1.2 stable onboarding
// Supporte : oled096 (128x64) + eink27bw (176x264)
//
// Philosophie v1.2 :
// - Même logique pratique que le modèle e29 qui fonctionne
// - HTTPS pull-based Vercel
// - Anti-OOM : pas d'init e-ink au boot, pas de buffer e27 persistant
// - OLED init après register
// - E27 init à la demande uniquement
// - Onboarding affiché UNE SEULE FOIS sur OLED + E27 si non paired
// - Aucun restart automatique après onboarding
// - Aucun spam de /api/register : un seul register au boot, puis attente calme
// - Après appairage : redémarrage manuel / reboot externe conseillé pour repartir proprement
//
// Remarque : cette version n'a pas besoin de /api/device-status.
// Elle s'aligne sur ton workflow e29 : on affiche, on attend, puis on reboote quand l'appairage est fait.

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

#include <SPI.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <qrcode.h>
#include "epd2in7_V2.h"

// ─── CONFIG ────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "Livebox-D190";
const char* WIFI_PASSWORD = "Q2gueWg3UaYJo2VN7C";

#define SERVER_URL       "https://proof-of-draw.vercel.app"
#define FIRMWARE_VERSION "multiscreen-1.2"

#define SCREEN_OLED "oled096"
#define SCREEN_E27  "eink27bw"

#define PULL_INTERVAL        900000UL   // 15 min
#define E27_MIN_REFRESH_MS   10000UL    // comme le e29, sécurité refresh
#define IDLE_DELAY_MS        250UL

// ─── OLED 128×64 ───────────────────────────────────────────────────────────
#define OLED_SDA      D6
#define OLED_SCL      D4
#define OLED_RST      -1
#define OLED_WIDTH    128
#define OLED_HEIGHT   64
#define OLED_BUF_SIZE ((OLED_WIDTH * OLED_HEIGHT) / 8)

Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RST);
bool oledReady = false;
uint8_t* oledBuf = nullptr;

// ─── EINK 2.7" BW ──────────────────────────────────────────────────────────
#define E27_WIDTH     176
#define E27_HEIGHT    264
#define E27_BUF_SIZE  ((E27_WIDTH * E27_HEIGHT) / 8)

Epd epd27;
unsigned long lastE27RefreshMs = 0;

// ─── STATE ─────────────────────────────────────────────────────────────────
String deviceId, pairCode, canvasUrl;
bool   registered        = false;
bool   paired            = false;
bool   onboardingShown   = false;
unsigned long lastPullMs = 0;
String lastFrameId       = "";
String lastScreen        = "";

unsigned long lastRegisterRetryMs = 0;
unsigned long registerRetryIntervalMs = 300000UL; // 5 min
bool waitingForPairing = false;

// ─── BASE64 ────────────────────────────────────────────────────────────────
static const int8_t B64_TABLE[256] PROGMEM = {
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,
  52,53,54,55,56,57,58,59,60,61,-1,-1,-1, 0,-1,-1,
  -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,
  15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
  -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
  41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1
};

size_t base64Decode(const char* src, size_t srcLen, uint8_t* dst, size_t dstMax) {
  size_t out = 0;
  int buf = 0, bits = 0;
  for (size_t i = 0; i < srcLen && out < dstMax; i++) {
    int8_t val = (int8_t)pgm_read_byte(&B64_TABLE[(uint8_t)src[i]]);
    if (val < 0) continue;
    buf = (buf << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      dst[out++] = (buf >> bits) & 0xFF;
    }
    yield();
  }
  return out;
}

// ─── HTTP HELPERS ──────────────────────────────────────────────────────────
bool httpPost(const String& path, const String& body, String& resp) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, String(SERVER_URL) + path);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  int code = http.POST(body);
  resp = (code > 0) ? http.getString() : "";

  http.end();
  Serial.printf("[HTTP POST] %s -> %d\n", path.c_str(), code);
  return code == 200;
}

bool httpGet(const String& path, String& resp) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, String(SERVER_URL) + path);
  http.setTimeout(15000);

  int code = http.GET();

  if (code > 0) {
    int contentLength = http.getSize();
    resp = "";
    if (contentLength > 0) resp.reserve(contentLength);

    WiFiClient* stream = http.getStreamPtr();
    unsigned long timeout = millis();

    while ((millis() - timeout) < 10000) {
      if (stream->available()) {
        resp += (char)stream->read();
        timeout = millis();
        if (contentLength > 0 && (int)resp.length() >= contentLength) break;
      } else if (!http.connected()) {
        break;
      }
      yield();
    }
  }

  http.end();
  Serial.printf("[HTTP GET] %s -> %d (%u bytes)\n", path.c_str(), code, resp.length());
  return code == 200;
}

// ─── OLED ──────────────────────────────────────────────────────────────────
bool ensureOLEDReady() {
  if (oledReady) return true;

  if (!oledBuf) {
    oledBuf = (uint8_t*)malloc(OLED_BUF_SIZE);
    if (!oledBuf) {
      Serial.println("[OLED] malloc failed");
      return false;
    }
    memset(oledBuf, 0x00, OLED_BUF_SIZE);
  }

  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(100000);

  oledReady = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!oledReady) {
    Serial.println("[OLED] init failed");
    return false;
  }

  Serial.println("[OLED] ready");
  return true;
}

void displayOLEDFromBuffer() {
  if (!oledReady || !oledBuf) return;

  if (lastScreen == SCREEN_E27) {
    SPI.end();
    delay(20);
    Wire.begin(OLED_SDA, OLED_SCL);
    Wire.setClock(100000);
    delay(20);
  }

  memcpy(oled.getBuffer(), oledBuf, OLED_BUF_SIZE);
  oled.display();
  Serial.println("[OLED] displayed");
}

void displayQROnOLED(const String& code, const String& mac) {
  if (!ensureOLEDReady()) return;

  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);
  oled.println("PROOF-OF-DRAW");
  oled.println("Scannez / saisissez:");
  oled.println("");
  oled.setTextSize(2);
  oled.println(code);
  oled.setTextSize(1);
  oled.println("");

  String macShort = mac;
  macShort.replace(":", "");
  macShort.toUpperCase();
  oled.println("MAC:" + macShort);

  oled.display();
  Serial.println("[OLED] onboarding displayed");
}

// ─── FONT 5x7 + DRAW E27 ───────────────────────────────────────────────────
static const uint8_t FONT_5x7[][5] PROGMEM = {
  {0x3E,0x51,0x49,0x45,0x3E},{0x00,0x42,0x7F,0x40,0x00},{0x42,0x61,0x51,0x49,0x46},
  {0x21,0x41,0x45,0x4B,0x31},{0x18,0x14,0x12,0x7F,0x10},{0x27,0x45,0x45,0x45,0x39},
  {0x3C,0x4A,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},{0x36,0x49,0x49,0x49,0x36},
  {0x06,0x49,0x49,0x29,0x1E},{0x7C,0x12,0x11,0x12,0x7C},{0x7F,0x49,0x49,0x49,0x36},
  {0x3E,0x41,0x41,0x41,0x22},{0x7F,0x41,0x41,0x22,0x1C},{0x7F,0x49,0x49,0x49,0x41},
  {0x7F,0x09,0x09,0x09,0x01},{0x3E,0x41,0x49,0x49,0x7A},{0x7F,0x08,0x08,0x08,0x7F},
  {0x00,0x41,0x7F,0x41,0x00},{0x20,0x40,0x41,0x3F,0x01},{0x7F,0x08,0x14,0x22,0x41},
  {0x7F,0x40,0x40,0x40,0x40},{0x7F,0x02,0x0C,0x02,0x7F},{0x7F,0x04,0x08,0x10,0x7F},
  {0x3E,0x41,0x41,0x41,0x3E},{0x7F,0x09,0x09,0x09,0x06},{0x3E,0x41,0x51,0x21,0x5E},
  {0x7F,0x09,0x19,0x29,0x46},{0x46,0x49,0x49,0x49,0x31},{0x01,0x01,0x7F,0x01,0x01},
  {0x3F,0x40,0x40,0x40,0x3F},{0x1F,0x20,0x40,0x20,0x1F},{0x3F,0x40,0x38,0x40,0x3F},
  {0x63,0x14,0x08,0x14,0x63},{0x07,0x08,0x70,0x08,0x07},{0x61,0x51,0x49,0x45,0x43},
  {0x00,0x36,0x36,0x00,0x00},{0x00,0x60,0x60,0x00,0x00},{0x08,0x08,0x08,0x08,0x08},
  {0x02,0x01,0x02,0x04,0x02},{0x00,0x00,0x00,0x00,0x00},
};

int charIndex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
  if (c >= 'a' && c <= 'z') return c - 'a' + 10;
  if (c == ':') return 36;
  if (c == '.') return 37;
  if (c == '-') return 38;
  if (c == '/') return 39;
  return 40;
}

// Mapping simple pour buffer 176x264 du driver utilisé
inline void setPixelE27(uint8_t* buf, int x, int y) {
  if (!buf) return;
  if (x < 0 || x >= E27_WIDTH || y < 0 || y >= E27_HEIGHT) return;

  int xr = E27_WIDTH - 1 - x;   // miroir horizontal
  int byteIndex = (xr / 8) + y * (E27_WIDTH / 8);
  int bitMask   = 0x80 >> (xr & 7);

  buf[byteIndex] &= ~bitMask;
}

void drawCharE27(uint8_t* buf, int x, int y, char c, int scale = 1) {
  int idx = charIndex(c);
  for (int col = 0; col < 5; col++) {
    uint8_t bits = pgm_read_byte(&FONT_5x7[idx][col]);
    for (int row = 0; row < 7; row++) {
      if (bits & (0x40 >> row)) {
        for (int dx = 0; dx < scale; dx++) {
          for (int dy = 0; dy < scale; dy++) {
            setPixelE27(buf, x + col * scale + dx, y + row * scale + dy);
          }
        }
      }
    }
  }
}

void drawTextE27(uint8_t* buf, int x, int y, const String& text, int scale = 1) {
  int cx = x;
  for (unsigned int i = 0; i < text.length(); i++) {
    drawCharE27(buf, cx, y, text.charAt(i), scale);
    cx += 6 * scale;
    yield();
  }
}

int textWidthE27(const String& text, int scale = 1) {
  return text.length() * 6 * scale;
}

// ─── E27 DISPLAY ───────────────────────────────────────────────────────────
bool initE27ForRefresh() {
  unsigned long elapsed = millis() - lastE27RefreshMs;
  if (elapsed < E27_MIN_REFRESH_MS) {
    delay(E27_MIN_REFRESH_MS - elapsed);
  }

  SPI.begin();
  delay(10);

  if (epd27.Init() != 0) {
    Serial.println("[E27] init failed");
    SPI.end();
    return false;
  }

  return true;
}

bool displayE27Buffer(uint8_t* buf) {
  if (!buf) return false;
  if (!initE27ForRefresh()) return false;

  epd27.Display(buf);
  epd27.Sleep();
  SPI.end();
  lastE27RefreshMs = millis();

  Serial.println("[E27] displayed");
  return true;
}

void displayOnboardingOnE27(const String& onboardUrl, const String& code, const String& mac) {
  uint8_t* buf = (uint8_t*)malloc(E27_BUF_SIZE);
  if (!buf) {
    Serial.println("[E27] onboarding malloc failed");
    return;
  }

  memset(buf, 0xFF, E27_BUF_SIZE);

  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(5)];

  int qrResult = qrcode_initText(&qrcode, qrcodeData, 4, ECC_MEDIUM, onboardUrl.c_str());
  if (qrResult < 0) {
    qrResult = qrcode_initText(&qrcode, qrcodeData, 5, ECC_MEDIUM, onboardUrl.c_str());
  }

  String title = "PROOF-OF-DRAW";
  String subtitle = "EINK27BW";
  String codeLine = "CODE:" + code;
  codeLine.toUpperCase();

  String macShort = mac;
  macShort.replace(":", "");
  macShort.toUpperCase();
  String macLine = "MAC:" + macShort;

  drawTextE27(buf, (E27_WIDTH - textWidthE27(title, 2)) / 2, 10, title, 2);
  drawTextE27(buf, (E27_WIDTH - textWidthE27(subtitle, 1)) / 2, 32, subtitle, 1);

  if (qrResult >= 0) {
    const int quietZone = 2;
    int totalModules = qrcode.size + quietZone * 2;
    int scale = 4;
    int qrPx = totalModules * scale;
    int qrX0 = (E27_WIDTH - qrPx) / 2;
    int qrY0 = 54;

    for (int my = 0; my < qrcode.size; my++) {
      for (int mx = 0; mx < qrcode.size; mx++) {
        if (!qrcode_getModule(&qrcode, mx, my)) continue;
        int px0 = qrX0 + (mx + quietZone) * scale;
        int py0 = qrY0 + (my + quietZone) * scale;
        for (int dy = 0; dy < scale; dy++) {
          for (int dx = 0; dx < scale; dx++) {
            setPixelE27(buf, px0 + dx, py0 + dy);
          }
        }
      }
      yield();
    }
  } else {
    drawTextE27(buf, 24, 80, "QR ERROR", 2);
  }

  drawTextE27(buf, (E27_WIDTH - textWidthE27(codeLine, 2)) / 2, 198, codeLine, 2);
  drawTextE27(buf, (E27_WIDTH - textWidthE27(macLine, 1)) / 2, 224, macLine, 1);
  drawTextE27(buf, 10, 244, "ONBOARD VIA SITE", 1);

  if (!displayE27Buffer(buf)) {
    Serial.println("[E27] onboarding display failed");
  } else {
    Serial.println("[E27] onboarding displayed");
  }

  free(buf);
}

// ─── ACK ───────────────────────────────────────────────────────────────────
bool ackFrame(const String& frameId) {
  if (frameId.length() == 0) return false;
  String body = "{\"deviceId\":\"" + deviceId + "\",\"frameId\":\"" + frameId + "\"}";
  String resp;
  bool ok = httpPost("/api/ack-frame", body, resp);
  Serial.printf("[ACK] %s -> %s\n", frameId.c_str(), ok ? "OK" : "FAIL");
  return ok;
}

// ─── REGISTER ──────────────────────────────────────────────────────────────
bool doRegister() {
  String mac = WiFi.macAddress();
  mac.toLowerCase();

  String body =
    "{\"mac\":\"" + mac + "\","
    "\"screens\":[\"" + String(SCREEN_OLED) + "\",\"" + String(SCREEN_E27) + "\"],"
    "\"firmware\":\"" + String(FIRMWARE_VERSION) + "\"}";

  String resp;

  Serial.printf("[HEAP] avant register: %u bytes\n", ESP.getFreeHeap());

  if (!httpPost("/api/register", body, resp)) {
    Serial.println("[REGISTER] Echec HTTP");
    return false;
  }

  Serial.printf("[HEAP] après register: %u bytes\n", ESP.getFreeHeap());

  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, resp)) {
    Serial.println("[REGISTER] JSON error");
    return false;
  }

  deviceId   = doc["deviceId"].as<String>();
  pairCode   = doc["pairCode"].as<String>();
  canvasUrl  = doc["canvasUrl"].as<String>();
  paired     = doc["paired"] | false;
  registered = true;

  Serial.println("[REGISTER] deviceId : " + deviceId);
  Serial.println("[REGISTER] paired   : " + String(paired ? "oui" : "non"));

  if (!ensureOLEDReady()) {
    Serial.println("[REGISTER] OLED init failed");
    registered = false;
    return false;
  }

if (!paired) {
  if (!onboardingShown) {
    String onboardUrl = String(SERVER_URL) + "/onboard?code=" + pairCode;
    displayQROnOLED(pairCode, mac);
    displayOnboardingOnE27(onboardUrl, pairCode, mac);
    onboardingShown = true;
    waitingForPairing = true;
    Serial.println("[REGISTER] onboarding affiché une seule fois, attente appairage");
  } else {
    Serial.println("[REGISTER] toujours non appairé, attente...");
  }
} else {
  Serial.println("[REGISTER] déjà appairé");
}

  return true;
}

// ─── PULL ──────────────────────────────────────────────────────────────────
void doPull() {
  if (oledBuf) {
    free(oledBuf);
    oledBuf = nullptr;
  }

  Serial.printf("[HEAP] avant pull: %u bytes\n", ESP.getFreeHeap());

  String resp;
  bool ok = httpGet("/api/pull?deviceId=" + deviceId, resp);

  if (!ok) {
    Serial.println("[PULL] Echec HTTP");
    return;
  }

  if (resp.indexOf("\"frame\":null") >= 0) {
    Serial.println("[PULL] Aucune frame");
    return;
  }

  auto extractField = [&](const String& key) -> String {
    String search = "\"" + key + "\":\"";
    int start = resp.indexOf(search);
    if (start < 0) return "";
    start += search.length();
    int end = resp.indexOf("\"", start);
    return (end < 0) ? "" : resp.substring(start, end);
  };

  String frameId  = extractField("frameId");
  String screen   = extractField("screen");
  String bufB64   = extractField("buffer");
  String blackB64 = extractField("black");
  String redB64   = extractField("red");

  if (frameId.length() > 0 && frameId == lastFrameId) {
    Serial.println("[PULL] frame déjà affichée");
    return;
  }

  Serial.println("[PULL] screen=" + screen + " frameId=" + frameId);

  if (screen == SCREEN_OLED) {
    if (bufB64.isEmpty()) {
      Serial.println("[PULL] buffer manquant pour OLED");
      return;
    }

    oledBuf = (uint8_t*)malloc(OLED_BUF_SIZE);
    if (!oledBuf) {
      Serial.println("[OLED] malloc failed");
      return;
    }

    memset(oledBuf, 0x00, OLED_BUF_SIZE);
    size_t len = base64Decode(bufB64.c_str(), bufB64.length(), oledBuf, OLED_BUF_SIZE);
    Serial.printf("[OLED] decoded=%u expected=%u\n", (unsigned)len, (unsigned)OLED_BUF_SIZE);

    if (len != OLED_BUF_SIZE) {
      Serial.println("[PULL] taille OLED invalide");
      free(oledBuf);
      oledBuf = nullptr;
      return;
    }

    if (!ensureOLEDReady()) {
      Serial.println("[OLED] init impossible");
      free(oledBuf);
      oledBuf = nullptr;
      return;
    }

    displayOLEDFromBuffer();
    lastScreen = SCREEN_OLED;
    lastFrameId = frameId;

    free(oledBuf);
    oledBuf = nullptr;

    ackFrame(frameId);
    Serial.println("[PULL] OLED affiche + ack");
    return;
  }

  if (screen == SCREEN_E27) {
    if (bufB64.isEmpty()) {
      Serial.println("[PULL] buffer manquant pour E27");
      return;
    }

    uint8_t* e27Buf = (uint8_t*)malloc(E27_BUF_SIZE);
    if (!e27Buf) {
      Serial.println("[E27] malloc failed");
      return;
    }

    memset(e27Buf, 0xFF, E27_BUF_SIZE);
    size_t len = base64Decode(bufB64.c_str(), bufB64.length(), e27Buf, E27_BUF_SIZE);
    Serial.printf("[E27] decoded=%u expected=%u\n", (unsigned)len, (unsigned)E27_BUF_SIZE);

    if (len != E27_BUF_SIZE) {
      Serial.println("[PULL] taille E27 invalide");
      free(e27Buf);
      return;
    }

    if (!displayE27Buffer(e27Buf)) {
      free(e27Buf);
      return;
    }

    free(e27Buf);

    lastScreen = SCREEN_E27;
    lastFrameId = frameId;

    ackFrame(frameId);
    Serial.println("[PULL] E27 affiche + ack");
    return;
  }

  if (!blackB64.isEmpty() || !redB64.isEmpty()) {
    Serial.println("[PULL] payload black/red reçu mais écran attendu = E27 BW/OLED");
    return;
  }

  Serial.println("[PULL] screen inconnu: " + screen);
}

// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] ESP Multiscreen Pull v1.2 stable onboarding");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Connexion");
  int i = 0;
  while (WiFi.status() != WL_CONNECTED && i++ < 40) {
    delay(500);
    Serial.print(".");
    yield();
  }

  Serial.println("\n[WIFI] IP: " + WiFi.localIP().toString());
  Serial.printf("[HEAP] après WiFi: %u bytes\n", ESP.getFreeHeap());

  while (!registered) {
    doRegister();
    if (!registered) delay(5000);
  }

  lastPullMs = millis();
}
void loop() {
  unsigned long now = millis();

  if (!registered) {
    doRegister();
    delay(5000);
    return;
  }

  if (!paired) {
    if (now - lastRegisterRetryMs >= registerRetryIntervalMs) {
      Serial.println("[PAIRING] recheck register...");
      bool wasPaired = paired;
      doRegister();
      lastRegisterRetryMs = now;

      if (!wasPaired && paired) {
        Serial.println("[PAIRING] appairage detecté -> restart propre dans 2s");
        delay(2000);
        ESP.restart();
      }
    }

    delay(250);
    yield();
    return;
  }

  if (now - lastPullMs >= PULL_INTERVAL) {
    doPull();
    lastPullMs = now;
  }

  delay(250);
  yield();
}