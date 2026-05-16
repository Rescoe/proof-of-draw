// esp_eink_2.7BW_OLED.ino
// Proof-of-Draw — Firmware multiscreen v2.0
// Supporte : oled096 (128×64) + eink27bw (176×264)
//
// IDENTIQUE au eink29BWR v2.0 dans sa logique :
//   1. Génération paire de clés ED25519 au premier boot → EEPROM
//   2. Affichage clés UNE SEULE FOIS (OLED + E27)
//   3. Pull léger (metadata) + fetch frame séparé
//   4. Boucle validate → mine → pull immédiat
//   5. Ack uniquement après affichage confirmé
//   6. lastFrameId mis à jour uniquement après succès
//   7. Pas de consensusJustDisplayed (géré serveur via alreadyVoted)
//   8. SPI.begin()/begin() autour de chaque accès E27 (cohabitation I2C)

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
#include <EEPROM.h>
#include "epd2in7_V2.h"
#include "epdif.h"

// ─── CONFIG ────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "Livebox-D190";
const char* WIFI_PASSWORD = "Q2gueWg3UaYJo2VN7C";

#define SERVER_URL       "https://proof-of-draw.vercel.app"
#define FIRMWARE_VERSION "multiscreen-2.0"
#define SCREEN_OLED      "oled096"
#define SCREEN_E27       "eink27bw"

#define PULL_INTERVAL      60000UL
#define VALIDATE_INTERVAL  30000UL
#define E27_MIN_REFRESH_MS 10000UL
#define IDLE_DELAY_MS      100UL

// ─── EEPROM layout ─────────────────────────────────────────────────────────
// [0..31]  : clé privée (32 bytes)
// [32..63] : blockHash courant (32 bytes ASCII)
// [64]     : keyGenerated flag
// [65..96] : clé publique (32 bytes)
// [97]     : onboarding shown flag
#define EEPROM_SIZE          128
#define EEPROM_PRIVKEY_OFF   0
#define EEPROM_BLOCKHASH_OFF 32
#define EEPROM_FLAG_OFF      64
#define EEPROM_PUBKEY_OFF    65
#define EEPROM_ONBOARDING_OFF 97
#define KEY_GENERATED_FLAG   0x01
#define ONBOARDING_SHOWN_FLAG 0x01

// ─── OLED 128×64 ───────────────────────────────────────────────────────────
#define OLED_SDA      D6
#define OLED_SCL      D4
#define OLED_RST      -1
#define OLED_WIDTH    128
#define OLED_HEIGHT   64
#define OLED_BUF_SIZE ((OLED_WIDTH * OLED_HEIGHT) / 8)  // 1024

Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RST);
bool oledReady = false;

// ─── EINK 2.7" BW ──────────────────────────────────────────────────────────
#define E27_WIDTH    176
#define E27_HEIGHT   264
#define E27_BUF_SIZE ((E27_WIDTH * E27_HEIGHT) / 8)  // 5808

Epd epd27;
unsigned long lastE27RefreshMs = 0;
bool lastScreenWasSPI = false;  // pour gérer la bascule SPI↔I2C

// ─── STATE ─────────────────────────────────────────────────────────────────
String deviceId, pairCode, canvasUrl;
bool   registered  = false;
bool   paired      = false;

String lastFrameId           = "";
bool   hasDisplayedFrame     = false;
bool   lastFrameWasConsensus = false;

String pendingCandidateId    = "";
unsigned long lastPullMs     = 0;
unsigned long lastValidateMs = 0;

// Clés
uint8_t privateKey[32];
uint8_t publicKey[32];
bool    keysLoaded = false;

// État chaîne
String currentBlockHash  = "";
int    currentBlockIndex = -1;

// ─── DEBUG HEAP ─────────────────────────────────────────────────────────────
void logHeapState(const char* tag) {
  Serial.printf("[%s] heap=%u maxBlock=%u frag=%u%%\n",
                tag, ESP.getFreeHeap(),
                ESP.getMaxFreeBlockSize(),
                ESP.getHeapFragmentation());
}

// ─── EEPROM helpers ────────────────────────────────────────────────────────
void eepromInit() { EEPROM.begin(EEPROM_SIZE); }

bool keysAlreadyGenerated() {
  return EEPROM.read(EEPROM_FLAG_OFF) == KEY_GENERATED_FLAG;
}

bool onboardingAlreadyShown() {
  return EEPROM.read(EEPROM_ONBOARDING_OFF) == ONBOARDING_SHOWN_FLAG;
}

void setOnboardingShown() {
  EEPROM.write(EEPROM_ONBOARDING_OFF, ONBOARDING_SHOWN_FLAG);
  EEPROM.commit();
}

void saveKeysToEEPROM() {
  for (int i = 0; i < 32; i++) EEPROM.write(EEPROM_PRIVKEY_OFF + i, privateKey[i]);
  for (int i = 0; i < 32; i++) EEPROM.write(EEPROM_PUBKEY_OFF  + i, publicKey[i]);
  EEPROM.write(EEPROM_FLAG_OFF, KEY_GENERATED_FLAG);
  EEPROM.commit();
}

void loadKeysFromEEPROM() {
  for (int i = 0; i < 32; i++) privateKey[i] = EEPROM.read(EEPROM_PRIVKEY_OFF + i);
  for (int i = 0; i < 32; i++) publicKey[i]  = EEPROM.read(EEPROM_PUBKEY_OFF  + i);
  keysLoaded = true;
}

void saveBlockHashToEEPROM(const String& hash) {
  String h = hash.length() >= 32 ? hash.substring(0, 32) : hash;
  h += String(' ', 32);
  for (int i = 0; i < 32; i++)
    EEPROM.write(EEPROM_BLOCKHASH_OFF + i, (uint8_t)h[i]);
  EEPROM.commit();
}

String loadBlockHashFromEEPROM() {
  String hash = "";
  for (int i = 0; i < 32; i++) {
    char c = (char)EEPROM.read(EEPROM_BLOCKHASH_OFF + i);
    if (c == ' ' || c == '\0') break;
    hash += c;
  }
  return hash;
}

// ─── Génération clés V1 ────────────────────────────────────────────────────
void derivePublicKeyV1(const uint8_t* priv, uint8_t* pub) {
  for (int i = 0; i < 32; i++)
    pub[i] = (~priv[i]) ^ (uint8_t)(i * 0x37 + 0xAB);
}

void generateKeys() {
  Serial.println("[KEYS] Génération nouvelle paire...");
  randomSeed(analogRead(A0) ^ millis() ^ (uint32_t)WiFi.RSSI());
  for (int i = 0; i < 32; i++) {
    privateKey[i] = (uint8_t)(random(256) ^ (analogRead(A0) & 0xFF));
    delayMicroseconds(100);
  }
  derivePublicKeyV1(privateKey, publicKey);
  keysLoaded = true;
  saveKeysToEEPROM();
  Serial.println("[KEYS] Clés générées et sauvegardées");
}

String bytesToHex(const uint8_t* buf, size_t len) {
  String hex = "";
  hex.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    if (buf[i] < 16) hex += "0";
    hex += String(buf[i], HEX);
  }
  return hex;
}

// ─── Signature V1 ──────────────────────────────────────────────────────────
String signV1(const String& candidateId, float score) {
  char buf[8];
  dtostrf(score, 1, 3, buf);
  return deviceId + ":" + candidateId + ":" + String(buf);
}

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
    if (bits >= 8) { bits -= 8; dst[out++] = (buf >> bits) & 0xFF; }
    yield();
  }
  return out;
}

// ─── HTTP HELPERS ──────────────────────────────────────────────────────────
bool httpPost(const String& path, const String& body, String& resp) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = String(SERVER_URL) + path;

  Serial.println("[HTTP POST] " + url);
  Serial.println("[HTTP POST] body len: " + String(body.length()));

  if (!http.begin(client, url)) {
    Serial.println("[HTTP POST] begin() failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);

  int code = http.POST(body);
  resp = (code > 0) ? http.getString() : "";
  Serial.printf("[HTTP POST] %s → %d\n", path.c_str(), code);
  if (code > 0) Serial.println("[HTTP POST] resp: " + resp);
  http.end();
  return code == 200;
}

bool httpGet(const String& path, String& resp) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  if (!http.begin(client, String(SERVER_URL) + path)) {
    Serial.println("[HTTP GET] begin() failed");
    return false;
  }
  http.setTimeout(20000);

  int code = http.GET();
  resp = (code > 0) ? http.getString() : "";
  http.end();
  Serial.printf("[HTTP GET] %s → %d (%u bytes)\n", path.c_str(), code, resp.length());
  return code == 200;
}

// ─── BUS helpers (SPI ↔ I2C) ───────────────────────────────────────────────
// Sur ESP8266, Wire.end() n'existe pas → on réinitialise avec begin()
void activateSPI() {
  if (lastScreenWasSPI) return;
  // Réinitialise I2C pour libérer les pins proprement
  Wire.begin(OLED_SDA, OLED_SCL);
  delay(10);
  SPI.begin();
  SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
  delay(10);
  lastScreenWasSPI = true;
}

void activateI2C() {
  if (!lastScreenWasSPI) return;
  SPI.endTransaction();
  SPI.end();
  delay(10);
  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(100000);
  delay(10);
  lastScreenWasSPI = false;
}

// ─── FONT 5×7 ──────────────────────────────────────────────────────────────
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
  if (c == ':') return 36; if (c == '.') return 37;
  if (c == '-') return 38; if (c == '/') return 39;
  return 40;
}

inline void setPixelE27(uint8_t* buf, int x, int y) {
  if (!buf || x < 0 || x >= E27_WIDTH || y < 0 || y >= E27_HEIGHT) return;
  int xr = E27_WIDTH - 1 - x;
  int byteIndex = (xr / 8) + y * (E27_WIDTH / 8);
  buf[byteIndex] &= ~(0x80 >> (xr & 7));
}

void drawCharE27(uint8_t* buf, int x, int y, char c, int scale = 1) {
  int idx = charIndex(c);
  for (int col = 0; col < 5; col++) {
    uint8_t bits = pgm_read_byte(&FONT_5x7[idx][col]);
    for (int row = 0; row < 7; row++) {
      if (bits & (0x40 >> row)) {
        for (int dx = 0; dx < scale; dx++)
          for (int dy = 0; dy < scale; dy++)
            setPixelE27(buf, x + col * scale + dx, y + row * scale + dy);
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

// ─── OLED ──────────────────────────────────────────────────────────────────
bool ensureOLEDReady() {
  activateI2C();
  if (oledReady) return true;
  oledReady = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!oledReady) { Serial.println("[OLED] init failed"); return false; }
  oled.clearDisplay();
  oled.display();
  Serial.println("[OLED] ready");
  return true;
}

bool displayOLED(const uint8_t* buf, size_t len) {
  if (len != OLED_BUF_SIZE) {
    Serial.printf("[OLED] taille invalide: %u attendu %u\n", len, OLED_BUF_SIZE);
    return false;
  }
  activateI2C();
  // Re-init OLED si on vient du SPI
  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("[OLED] re-init failed");
    return false;
  }
  oledReady = true;
  memcpy(oled.getBuffer(), buf, OLED_BUF_SIZE);
  oled.display();
  Serial.println("[OLED] displayed");
  return true;
}

// ─── E27 DISPLAY ───────────────────────────────────────────────────────────
bool initE27ForRefresh() {
  unsigned long elapsed = millis() - lastE27RefreshMs;
  if (elapsed < E27_MIN_REFRESH_MS) {
    unsigned long wait = E27_MIN_REFRESH_MS - elapsed;
    Serial.printf("[E27] attente refresh %lums\n", wait);
    delay(wait);
  }
  activateSPI();
  if (epd27.Init() != 0) {
    Serial.println("[E27] Init failed");
    return false;
  }
  return true;
}

bool displayE27Buffer(const uint8_t* buf) {
  if (!buf) return false;
  if (!initE27ForRefresh()) return false;
  epd27.Display(buf);
  epd27.Sleep();
  lastE27RefreshMs = millis();
  Serial.println("[E27] displayed");
  return true;
}

// ─── AFFICHAGE CLÉS (unique au premier boot) ────────────────────────────────
void displayKeyMaterialOnce() {
  String pubHex  = bytesToHex(publicKey,  32);
  String privHex = bytesToHex(privateKey, 32);

  Serial.println("[KEYS] Public:  " + pubHex);
  Serial.println("[KEYS] Private: " + privHex);

  // ── OLED : clé publique ──
  if (ensureOLEDReady()) {
    oled.clearDisplay();
    oled.setTextSize(1);
    oled.setTextColor(SSD1306_WHITE);
    oled.setCursor(0, 0);
    oled.println("PROOF-OF-DRAW KEYS");
    oled.println("-- SAVE PUBLIC KEY --");
    // Clé publique sur 4 lignes de 16 chars
    for (int line = 0; line < 4; line++) {
      oled.println(pubHex.substring(line * 16, line * 16 + 16));
    }
    oled.display();
  }

  // ── E27 : clé publique + privée ──
  uint8_t* buf = (uint8_t*)malloc(E27_BUF_SIZE);
  if (buf) {
    memset(buf, 0xFF, E27_BUF_SIZE);

    String title = "PROOF-OF-DRAW KEYS";
    String warn1 = "SAVE THESE KEYS NOW";
    String warn2 = "PRIVATE KEY ONCE";

    drawTextE27(buf, (E27_WIDTH - textWidthE27(title, 1)) / 2, 10, title, 1);
    for (int x = 10; x < E27_WIDTH - 10; x++) setPixelE27(buf, x, 22);

    drawTextE27(buf, 4, 30, "PUB:", 1);
    for (int line = 0; line < 4; line++)
      drawTextE27(buf, 4, 42 + line * 12, pubHex.substring(line * 16, line * 16 + 16), 1);

    drawTextE27(buf, 4, 102, "PRIV:", 1);
    for (int line = 0; line < 4; line++)
      drawTextE27(buf, 4, 114 + line * 12, privHex.substring(line * 16, line * 16 + 16), 1);

    for (int x = 10; x < E27_WIDTH - 10; x++) setPixelE27(buf, x, 166);
    drawTextE27(buf, (E27_WIDTH - textWidthE27(warn1, 1)) / 2, 174, warn1, 1);
    drawTextE27(buf, (E27_WIDTH - textWidthE27(warn2, 1)) / 2, 188, warn2, 1);

    displayE27Buffer(buf);
    free(buf);
  }

  Serial.println("[KEYS] Clés affichées — 60s pour noter");
  delay(60000);
  Serial.println("[KEYS] Délai écoulé");
}

// ─── QR ONBOARDING ─────────────────────────────────────────────────────────
void displayOnboardingOLED(const String& code, const String& mac) {
  if (!ensureOLEDReady()) return;

  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);
  oled.println("PROOF-OF-DRAW");
  oled.println("Code appairage:");
  oled.println();
  oled.setTextSize(2);
  oled.println(code);
  oled.setTextSize(1);
  String macShort = mac;
  macShort.replace(":", "");
  macShort.toUpperCase();
  oled.println("MAC:" + macShort);
  oled.display();
  Serial.println("[OLED] onboarding displayed");
}

void displayOnboardingE27(const String& onboardUrl, const String& code, const String& mac) {
  uint8_t* buf = (uint8_t*)malloc(E27_BUF_SIZE);
  if (!buf) { Serial.println("[E27] onboarding malloc failed"); return; }
  memset(buf, 0xFF, E27_BUF_SIZE);

  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(5)];
  int qrResult = qrcode_initText(&qrcode, qrcodeData, 4, ECC_MEDIUM, onboardUrl.c_str());
  if (qrResult < 0)
    qrResult = qrcode_initText(&qrcode, qrcodeData, 5, ECC_MEDIUM, onboardUrl.c_str());

  String title   = "PROOF-OF-DRAW";
  String codeLine = "CODE:" + code;
  codeLine.toUpperCase();
  String macShort = mac;
  macShort.replace(":", "");
  macShort.toUpperCase();
  String macLine = "MAC:" + macShort;

  drawTextE27(buf, (E27_WIDTH - textWidthE27(title, 2)) / 2, 10, title, 2);
  drawTextE27(buf, (E27_WIDTH - textWidthE27("SCAN TO PAIR", 1)) / 2, 32, "SCAN TO PAIR", 1);

  if (qrResult >= 0) {
    const int quietZone = 2;
    int scale = 4;
    int qrPx  = (qrcode.size + quietZone * 2) * scale;
    int qrX0  = (E27_WIDTH - qrPx) / 2;
    int qrY0  = 48;
    for (int my = 0; my < qrcode.size; my++) {
      for (int mx = 0; mx < qrcode.size; mx++) {
        if (!qrcode_getModule(&qrcode, mx, my)) continue;
        int px0 = qrX0 + (mx + quietZone) * scale;
        int py0 = qrY0 + (my + quietZone) * scale;
        for (int dy = 0; dy < scale; dy++)
          for (int dx = 0; dx < scale; dx++)
            setPixelE27(buf, px0 + dx, py0 + dy);
      }
      yield();
    }
  }

  drawTextE27(buf, (E27_WIDTH - textWidthE27(codeLine, 2)) / 2, 200, codeLine, 2);
  drawTextE27(buf, (E27_WIDTH - textWidthE27(macLine,  1)) / 2, 228, macLine,  1);

  displayE27Buffer(buf);
  free(buf);
  Serial.println("[E27] onboarding displayed");
}

// ─── ACK ───────────────────────────────────────────────────────────────────
bool ackFrame(const String& frameId) {
  if (frameId.length() == 0) return false;
  String body = "{\"deviceId\":\"" + deviceId + "\",\"frameId\":\"" + frameId + "\"}";
  String resp;
  bool ok = httpPost("/api/ack-frame", body, resp);
  Serial.printf("[ACK] frameId=%s → %s\n", frameId.c_str(), ok ? "OK" : "FAIL");
  return ok;
}

// ─── REGISTER ──────────────────────────────────────────────────────────────
bool doRegister() {
  String mac = WiFi.macAddress();
  mac.toLowerCase();

  String pubHex = keysLoaded ? bytesToHex(publicKey, 32) : "";
  String body =
    "{\"mac\":\"" + mac + "\","
    "\"screens\":[\"" + String(SCREEN_OLED) + "\",\"" + String(SCREEN_E27) + "\"],"
    "\"firmware\":\"" + String(FIRMWARE_VERSION) + "\","
    "\"publicKey\":\"" + pubHex + "\"}";

  String resp;
  Serial.printf("[REGISTER] heap avant: %u\n", ESP.getFreeHeap());

  if (!httpPost("/api/register", body, resp)) {
    Serial.println("[REGISTER] Echec HTTP");
    return false;
  }

  Serial.printf("[REGISTER] heap après: %u\n", ESP.getFreeHeap());

  DynamicJsonDocument doc(768);
  if (deserializeJson(doc, resp)) {
    Serial.println("[REGISTER] JSON error");
    return false;
  }

  deviceId  = doc["deviceId"].as<String>();
  pairCode  = doc["pairCode"].as<String>();
  canvasUrl = doc["canvasUrl"].as<String>();
  paired    = doc["paired"] | false;
  registered = true;

  Serial.println("[REGISTER] deviceId: " + deviceId);
  Serial.println("[REGISTER] paired: " + String(paired ? "oui" : "non"));

  if (!paired && !onboardingAlreadyShown()) {
    // Génère les clés si premier boot
    if (!keysAlreadyGenerated()) generateKeys();

    displayKeyMaterialOnce();

    String onboardUrl = String(SERVER_URL) + "/onboard?code=" + pairCode;
    displayOnboardingOLED(pairCode, mac);
    displayOnboardingE27(onboardUrl, pairCode, mac);

    setOnboardingShown();
    Serial.println("[REGISTER] Onboarding affiché. En attente d'appairage...");

  } else if (!paired) {
    Serial.println("[REGISTER] Déjà en onboarding, attente...");
  } else {
    Serial.println("[REGISTER] Déjà appairé");
  }

  return true;
}




// ─── FETCH FRAME OLED ──────────────────────────────────────────────────────
// Même pattern que E27 : fetch binaire séparé via /api/pull-frame
bool doFetchFrameOLED(const String& frameId, const String& frameSource) {
  logHeapState("FETCHFRAME-OLED-BEFORE");

  uint8_t* oledBuf = (uint8_t*)malloc(OLED_BUF_SIZE);
  if (!oledBuf) {
    Serial.println("[FETCHFRAME-OLED] malloc failed");
    return false;
  }
  memset(oledBuf, 0x00, OLED_BUF_SIZE);

  {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;

    // &screen= pour que le serveur sache quel buffer envoyer
    String url = String(SERVER_URL) + "/api/pull-frame?deviceId=" + deviceId
                 + "&screen=" + String(SCREEN_OLED) + "&fmt=bin";
    if (!http.begin(client, url)) {
      Serial.println("[FETCHFRAME-OLED] begin() failed");
      free(oledBuf);
      return false;
    }
    http.setTimeout(20000);
    http.useHTTP10(true);

    int code = http.GET();
    Serial.printf("[HTTP GET] /api/pull-frame (OLED) → %d\n", code);

    if (code == 404) {
      http.end();
      Serial.println("[FETCHFRAME-OLED] Pas de frame");
      free(oledBuf);
      return true;
    }
    if (code != 200) {
      http.end();
      Serial.printf("[FETCHFRAME-OLED] HTTP error: %d\n", code);
      free(oledBuf);
      return false;
    }

    auto readFull = [](WiFiClient* s, uint8_t* dst, size_t len) -> size_t {
      size_t total = 0;
      unsigned long t0 = millis();
      while (total < len && millis() - t0 < 15000) {
        if (s->available()) {
          size_t got = s->readBytes(dst + total, len - total);
          if (got > 0) total += got;
        } else { delay(10); }
      }
      return total;
    };

    WiFiClient* stream = http.getStreamPtr();
    size_t bRead = readFull(stream, oledBuf, OLED_BUF_SIZE);
    http.end();

    Serial.printf("[FETCHFRAME-OLED] lu=%u expected=%u\n", bRead, OLED_BUF_SIZE);

    if (bRead != OLED_BUF_SIZE) {
      Serial.println("[FETCHFRAME-OLED] lecture incomplète");
      free(oledBuf);
      return false;
    }
  }
  // TLS fermé

  if (!displayOLED(oledBuf, OLED_BUF_SIZE)) {
    Serial.println("[FETCHFRAME-OLED] display failed — frame conservée serveur");
    free(oledBuf);
    return false;
  }

  free(oledBuf);

  lastFrameId           = frameId;
  hasDisplayedFrame     = true;
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId    = "";
  ackFrame(frameId);

  Serial.printf("[FETCHFRAME-OLED] ✅ frameId=%s source=%s\n",
                frameId.c_str(), frameSource.c_str());
  logHeapState("FETCHFRAME-OLED-AFTER");
  return true;
}

// ─── FETCH FRAME E27 ───────────────────────────────────────────────────────
bool doFetchFrameE27(const String& frameId, const String& frameSource) {
  logHeapState("FETCHFRAME-E27-BEFORE");

  uint8_t* e27Buf = (uint8_t*)malloc(E27_BUF_SIZE);
  if (!e27Buf) {
    Serial.println("[FETCHFRAME-E27] malloc failed");
    return false;
  }
  memset(e27Buf, 0xFF, E27_BUF_SIZE);

  {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;

    // &screen= obligatoire — device multi-screen
    String url = String(SERVER_URL) + "/api/pull-frame?deviceId=" + deviceId
                 + "&screen=" + String(SCREEN_E27) + "&fmt=bin";
    if (!http.begin(client, url)) {
      Serial.println("[FETCHFRAME-E27] begin() failed");
      free(e27Buf);
      return false;
    }
    http.setTimeout(20000);
    http.useHTTP10(true);

    int code = http.GET();
    Serial.printf("[HTTP GET] /api/pull-frame (E27) → %d\n", code);

    if (code == 404) {
      http.end();
      Serial.println("[FETCHFRAME-E27] Pas de frame");
      free(e27Buf);
      return true;
    }
    if (code != 200) {
      http.end();
      Serial.printf("[FETCHFRAME-E27] HTTP error: %d\n", code);
      free(e27Buf);
      return false;
    }

    auto readFull = [](WiFiClient* s, uint8_t* dst, size_t len) -> size_t {
      size_t total = 0;
      unsigned long t0 = millis();
      while (total < len && millis() - t0 < 15000) {
        if (s->available()) {
          size_t got = s->readBytes(dst + total, len - total);
          if (got > 0) total += got;
        } else { delay(10); }
      }
      return total;
    };

    WiFiClient* stream = http.getStreamPtr();
    size_t bRead = readFull(stream, e27Buf, E27_BUF_SIZE);
    http.end();

    Serial.printf("[FETCHFRAME-E27] lu=%u expected=%u\n", bRead, E27_BUF_SIZE);

    if (bRead != E27_BUF_SIZE) {
      Serial.println("[FETCHFRAME-E27] lecture incomplète");
      free(e27Buf);
      return false;
    }
  }
  // TLS fermé

  if (!displayE27Buffer(e27Buf)) {
    Serial.println("[FETCHFRAME-E27] display failed — frame conservée serveur");
    free(e27Buf);
    return false;
  }

  free(e27Buf);

  lastFrameId           = frameId;
  hasDisplayedFrame     = true;
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId    = "";
  ackFrame(frameId);

  Serial.printf("[FETCHFRAME-E27] ✅ frameId=%s source=%s\n",
                frameId.c_str(), frameSource.c_str());
  logHeapState("FETCHFRAME-E27-AFTER");
  return true;
}

// ─── PULL ──────────────────────────────────────────────────────────────────
bool doPull() {
  logHeapState("PULL-BEFORE");

  String newFrameId     = "";
  String newFrameSource = "none";
  String newScreen      = "";
  String newCandId      = "";
  String newBlockHash   = "";
  int    newBlockIndex  = -1;

  {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;

    String url = String(SERVER_URL) + "/api/pull?deviceId=" + deviceId;
    if (!http.begin(client, url)) {
      Serial.println("[PULL] begin() failed");
      return true;
    }
    http.setTimeout(20000);
    http.useHTTP10(true);

    int code = http.GET();
    Serial.printf("[HTTP GET] /api/pull → %d\n", code);

    if (code == 429) {
      String rresp = http.getString();
      http.end();
      int retrySec = 60;
      DynamicJsonDocument rateDoc(256);
      if (deserializeJson(rateDoc, rresp) == DeserializationError::Ok)
        retrySec = max(1, (int)(rateDoc["retryAfter"] | 60));
      Serial.printf("[PULL] 429 retryAfter=%ds\n", retrySec);
      unsigned long retryMs = (unsigned long)retrySec * 1000UL;
      if (retryMs > PULL_INTERVAL) retryMs = PULL_INTERVAL;
      lastPullMs = millis() - (PULL_INTERVAL - retryMs);
      return true;
    }

    if (code != 200) {
      http.end();
      Serial.printf("[PULL] HTTP error: %d\n", code);
      return true;
    }

    // Doc réduit : on ne lit plus le buffer OLED ici
    DynamicJsonDocument doc(1024);
    DeserializationError err = deserializeJson(doc, http.getStream());
    http.end();

    if (err) {
      Serial.print("[PULL] JSON error: ");
      Serial.println(err.c_str());
      return true;
    }

    JsonObject chain = doc["chain"];
    if (!chain.isNull()) {
      newBlockHash  = chain["blockHash"]  | "";
      newBlockIndex = chain["blockIndex"] | -1;
    }

    JsonObject pend = doc["pendingValidation"];
    if (!pend.isNull()) newCandId = pend["candidateId"] | "";

    newFrameSource = doc["frameSource"] | "none";
    newFrameId     = doc["frameId"]     | "";
    newScreen      = doc["screen"]      | "";

    // Fallback frame{}
    if (newFrameId.length() == 0) {
      JsonObject frameObj = doc["frame"];
      if (!frameObj.isNull()) {
        newFrameId = frameObj["frameId"] | "";
        newScreen  = frameObj["screen"]  | "";
      }
    }
  }
  // TLS fermé

  // ── Mise à jour état chaîne ──
  if (newBlockHash.length() > 0 && newBlockHash != currentBlockHash) {
    currentBlockHash  = newBlockHash;
    currentBlockIndex = newBlockIndex;
    saveBlockHashToEEPROM(currentBlockHash);
    Serial.printf("[PULL] Nouveau bloc #%d hash=%s...\n",
                  currentBlockIndex, currentBlockHash.substring(0, 12).c_str());
  }

  if (newCandId.length() > 0) {
    pendingCandidateId = newCandId;
    Serial.println("[PULL] Candidat en attente: " + pendingCandidateId);
  }

  // ── Pas de frame ──
  if (newFrameSource == "none" || newFrameId.length() == 0) {
    Serial.println("[PULL] Aucune frame");
    logHeapState("PULL-DONE-NONE");
    return true;
  }

  // ── Frame déjà affichée ──
  if (newFrameId == lastFrameId) {
    Serial.println("[PULL] Frame déjà affichée");
    return true;
  }

  // ── Dispatch vers le bon fetch ──
  if (newScreen == SCREEN_OLED) {
    Serial.printf("[PULL] Nouvelle frame OLED frameId=%s source=%s → fetch\n",
                  newFrameId.c_str(), newFrameSource.c_str());
    doFetchFrameOLED(newFrameId, newFrameSource);
    return true;
  }

  if (newScreen == SCREEN_E27) {
    Serial.printf("[PULL] Nouvelle frame E27 frameId=%s source=%s → fetch\n",
                  newFrameId.c_str(), newFrameSource.c_str());
    doFetchFrameE27(newFrameId, newFrameSource);
    return true;
  }

  // Screen absent du JSON → on essaie E27 par défaut si frameSource != none
  // (cas où le serveur ne retourne pas le champ screen)
  if (newScreen.length() == 0 && newFrameSource != "none") {
    Serial.println("[PULL] screen absent — tentative E27 par défaut");
    doFetchFrameE27(newFrameId, newFrameSource);
    return true;
  }

  Serial.println("[PULL] screen inconnu: " + newScreen);
  return true;
}



// ─── VALIDATION ────────────────────────────────────────────────────────────
bool doValidate() {
  if (pendingCandidateId.length() == 0) return true;

  Serial.println("[VALIDATE] Debut: " + pendingCandidateId);
  logHeapState("VALIDATE-BEFORE");

  String resp;
  bool ok = httpGet("/api/validate-candidate?deviceId=" + deviceId, resp);

  if (!ok || resp.length() == 0) {
    Serial.println("[VALIDATE] Echec HTTP");
    pendingCandidateId = "";
    return true;
  }

  DynamicJsonDocument doc(512);
  DeserializationError err = deserializeJson(doc, resp);
  resp = "";

  if (err) {
    Serial.print("[VALIDATE] JSON err: "); Serial.println(err.c_str());
    pendingCandidateId = "";
    return true;
  }

  if (doc["alreadyVoted"] | false) {
    Serial.println("[VALIDATE] Déjà voté");
    pendingCandidateId = "";
    return true;
  }

  if (doc["candidate"].isNull()) {
    Serial.println("[VALIDATE] Pas de candidat actif");
    pendingCandidateId = "";
    return true;
  }

  JsonObject cand    = doc["candidate"];
  String candidateId = cand["candidateId"] | "";

  if (candidateId.length() == 0) {
    Serial.println("[VALIDATE] candidateId absent");
    pendingCandidateId = "";
    return true;
  }

  float score = cand["score_server"] | 0.5f;
  Serial.printf("[VALIDATE] candidateId=%s score=%.3f\n", candidateId.c_str(), score);

  String signature = signV1(candidateId, score);
  char   scoreStr[8];
  dtostrf(score, 1, 3, scoreStr);

  String body = String("{\"deviceId\":\"") + deviceId + "\","
                "\"candidateId\":\"" + candidateId + "\","
                "\"entropy\":"     + scoreStr + ","
                "\"transitions\":" + scoreStr + ","
                "\"rle\":"         + scoreStr + ","
                "\"score\":"       + scoreStr + ","
                "\"signature\":\"" + signature + "\"}";

  pendingCandidateId = "";

  String vResp;
  bool vOk = httpPost("/api/validation-result", body, vResp);

  if (vOk) {
    Serial.println("[VALIDATE] Vote OK");
    if (vResp.indexOf("\"blockMined\":true") >= 0)
      Serial.println("[VALIDATE] BLOC MINE");
  } else {
    Serial.println("[VALIDATE] Echec vote");
  }

  logHeapState("VALIDATE-AFTER");
  return true;
}

// ─── SETUP ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] Proof-of-Draw multiscreen v2.0");

  eepromInit();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Connexion");
  int i = 0;
  while (WiFi.status() != WL_CONNECTED && i++ < 40) {
    delay(500); Serial.print("."); yield();
  }
  Serial.println();
  Serial.println("[WIFI] IP: " + WiFi.localIP().toString());
  Serial.printf("[HEAP] après WiFi: %u bytes\n", ESP.getFreeHeap());

  if (keysAlreadyGenerated()) {
    loadKeysFromEEPROM();
    Serial.println("[KEYS] Clés chargées depuis EEPROM");
    Serial.println("[KEYS] Public: " + bytesToHex(publicKey, 32));
  }

  currentBlockHash = loadBlockHashFromEEPROM();
  if (currentBlockHash.length() > 0)
    Serial.println("[CHAIN] BlockHash restauré: " + currentBlockHash);

  while (!registered) {
    if (doRegister()) break;
    delay(5000);
  }

  if (paired) {
    ensureOLEDReady();
    Serial.println("[BOOT] Premier pull immédiat...");
    doPull();
  }

  lastPullMs     = millis();
  lastValidateMs = millis();
  Serial.println("[BOOT] Prêt. Pull dans " + String(PULL_INTERVAL / 1000) + "s");
}

// ─── LOOP ──────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // ── Re-registration si perdu ──
  if (!registered) {
    if (!doRegister()) { delay(5000); return; }
  }

  // ── Attente appairage ──
  if (!paired) {
    if (now - lastPullMs >= 300000UL) {
      Serial.println("[PAIRING] recheck register...");
      bool wasPaired = paired;
      doRegister();
      lastPullMs = millis();
      if (!wasPaired && paired) {
        Serial.println("[PAIRING] appairage détecté → restart");
        delay(1000);
        ESP.restart();
      }
    }
    delay(250);
    return;
  }

  // ── Pull périodique ──
  if (now - lastPullMs >= PULL_INTERVAL) {
    String prevCandidateId = pendingCandidateId;
    doPull();
    lastPullMs = millis();

    if (pendingCandidateId.length() > 0 && pendingCandidateId != prevCandidateId) {
      Serial.println("[LOOP] Nouveau candidat, reset timer validation");
      lastValidateMs = millis();
    }
  }

  // ── Validation candidat ──
  if (pendingCandidateId.length() > 0 &&
      millis() - lastValidateMs >= VALIDATE_INTERVAL) {
    doValidate();
    lastValidateMs = millis();

    Serial.println("[LOOP] Bloc miné — pull immédiat");
    delay(2000);
    doPull();
    lastPullMs = millis();
  }

  delay(IDLE_DELAY_MS);
}