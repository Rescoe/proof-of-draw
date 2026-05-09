// esp_canvas_pull_waveshare.ino — v1.4 — Pull-based + QR + Waveshare driver
#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>
#include <qrcode.h>
#include "epd2in9b_V4.h"
#include "epdif.h"

// ─── CONFIG ────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "Livebox-D190";
const char* WIFI_PASSWORD = "Q2gueWg3UaYJo2VN7C";
#define SERVER_URL      "http://192.168.1.13:3000"
#define SCREEN_TYPE     "eink29bwr"
#define PING_INTERVAL   300000UL   // 5 min
#define PULL_INTERVAL   60000UL    // 1 min
#define EINK_MIN_REFRESH_MS 10000UL

// ─── ÉCRAN WAVESHARE 2.9" BWR ──────────────────────────────────────────────
// Driver portrait interne : 128 colonnes × 296 lignes
// epd.Display(black, red) attend deux buffers de 128*296/8 = 4736 bytes
// Dans chaque buffer : byte[x * 16 + y/8], bit = 0x80 >> (y%8)
// 0 = pixel actif, 1 = blanc
#define IMG_W    296
#define IMG_H    128
#define BUF_SIZE ((IMG_H * IMG_W) / 8)   // 4736

Epd epd;
uint8_t blackBuf[BUF_SIZE];
uint8_t redBuf[BUF_SIZE];
unsigned long lastRefreshMs = 0;

// ─── STATE ─────────────────────────────────────────────────────────────────
String deviceId, pairCode, canvasUrl;
bool   registered  = false;
bool   frameReady  = false;   // true quand un frame pull a été chargé dans les buffers
unsigned long lastPingMs = 0, lastPullMs = 0;

// ─── PIXEL HELPERS ────────────────────────────────────────────────────────
// L'écran physique est paysage 296×128.
// Le driver Waveshare epd2in9b_V4 attend les buffers en mode portrait (128×296)
// organisés ainsi :
//   byte index = col * (IMG_H/8) + (row/8)   où col ∈ [0,127], row ∈ [0,295]
//   bit mask   = 0x80 >> (row % 8)
// Pour afficher en paysage : on pose x ∈ [0,295], y ∈ [0,127]
//   → col = 127 - y,  row = x
inline void setPixel(uint8_t* buf, int x, int y) {
  if (x < 0 || x >= IMG_W || y < 0 || y >= IMG_H) return;
  int col       = 127 - y;
  int row       = x;
  int byteIndex = col * (IMG_H / 8) + (row / 8);
  uint8_t mask  = 0x80 >> (row % 8);
  if (byteIndex >= 0 && byteIndex < BUF_SIZE)
    buf[byteIndex] &= ~mask;
}

// ─── FONT 5×7 ─────────────────────────────────────────────────────────────
// Chaque char : 5 colonnes de 7 bits (bit 6 = haut, bit 0 = bas)
// Index 0-9 → '0'-'9', 10-35 → 'A'-'Z', 36 → ':'  37 → '.'  38 → '-'  39 → '/'  40 → ' '
static const uint8_t FONT_5x7[][5] PROGMEM = {
  {0x3E,0x51,0x49,0x45,0x3E}, // 0
  {0x00,0x42,0x7F,0x40,0x00}, // 1
  {0x42,0x61,0x51,0x49,0x46}, // 2
  {0x21,0x41,0x45,0x4B,0x31}, // 3
  {0x18,0x14,0x12,0x7F,0x10}, // 4
  {0x27,0x45,0x45,0x45,0x39}, // 5
  {0x3C,0x4A,0x49,0x49,0x30}, // 6
  {0x01,0x71,0x09,0x05,0x03}, // 7
  {0x36,0x49,0x49,0x49,0x36}, // 8
  {0x06,0x49,0x49,0x29,0x1E}, // 9
  {0x7C,0x12,0x11,0x12,0x7C}, // A
  {0x7F,0x49,0x49,0x49,0x36}, // B
  {0x3E,0x41,0x41,0x41,0x22}, // C
  {0x7F,0x41,0x41,0x22,0x1C}, // D
  {0x7F,0x49,0x49,0x49,0x41}, // E
  {0x7F,0x09,0x09,0x09,0x01}, // F
  {0x3E,0x41,0x49,0x49,0x7A}, // G
  {0x7F,0x08,0x08,0x08,0x7F}, // H
  {0x00,0x41,0x7F,0x41,0x00}, // I
  {0x20,0x40,0x41,0x3F,0x01}, // J
  {0x7F,0x08,0x14,0x22,0x41}, // K
  {0x7F,0x40,0x40,0x40,0x40}, // L
  {0x7F,0x02,0x0C,0x02,0x7F}, // M
  {0x7F,0x04,0x08,0x10,0x7F}, // N
  {0x3E,0x41,0x41,0x41,0x3E}, // O
  {0x7F,0x09,0x09,0x09,0x06}, // P
  {0x3E,0x41,0x51,0x21,0x5E}, // Q
  {0x7F,0x09,0x19,0x29,0x46}, // R
  {0x46,0x49,0x49,0x49,0x31}, // S
  {0x01,0x01,0x7F,0x01,0x01}, // T
  {0x3F,0x40,0x40,0x40,0x3F}, // U
  {0x1F,0x20,0x40,0x20,0x1F}, // V
  {0x3F,0x40,0x38,0x40,0x3F}, // W
  {0x63,0x14,0x08,0x14,0x63}, // X
  {0x07,0x08,0x70,0x08,0x07}, // Y
  {0x61,0x51,0x49,0x45,0x43}, // Z
  {0x00,0x36,0x36,0x00,0x00}, // : (36)
  {0x00,0x60,0x60,0x00,0x00}, // . (37)
  {0x08,0x08,0x08,0x08,0x08}, // - (38)
  {0x02,0x01,0x02,0x04,0x02}, // / (39) 
  {0x00,0x00,0x00,0x00,0x00}, // ' ' (40)
};

int charIndex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
  if (c >= 'a' && c <= 'z') return c - 'a' + 10; // minuscules → majuscules
  if (c == ':') return 36;
  if (c == '.') return 37;
  if (c == '-') return 38;
  if (c == '/') return 39;
  return 40; // espace par défaut
}

// Dessine un caractère en x,y (coin supérieur gauche) dans buf
// Chaque char = 5px large + 1px espace = 6px total
void drawChar(uint8_t* buf, int x, int y, char c) {
  int idx = charIndex(c);
  for (int col = 0; col < 5; col++) {
    uint8_t bits = pgm_read_byte(&FONT_5x7[idx][col]);
    for (int row = 0; row < 7; row++) {
      if (bits & (0x40 >> row))          // bit 6 = haut
        setPixel(buf, x + col, y + row);
    }
  }
}

void drawText(uint8_t* buf, int x, int y, const String& text) {
  int cx = x;
  for (unsigned int i = 0; i < text.length(); i++) {
    drawChar(buf, cx, y, text.charAt(i));
    cx += 6;   // 5px + 1px espace
  }
}

// Retourne la largeur en pixels d'un texte (pour centrage)
int textWidth(const String& text) {
  return text.length() * 6;
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
  size_t out = 0; int buf = 0, bits = 0;
  for (size_t i = 0; i < srcLen && out < dstMax; i++) {
    int8_t val = (int8_t)pgm_read_byte(&B64_TABLE[(uint8_t)src[i]]);
    if (val < 0) continue;
    buf = (buf << 6) | val; bits += 6;
    if (bits >= 8) { bits -= 8; dst[out++] = (buf >> bits) & 0xFF; }
  }
  return out;
}

// ─── AFFICHAGE E-INK ───────────────────────────────────────────────────────
bool refreshDisplay() {
  unsigned long elapsed = millis() - lastRefreshMs;
  if (elapsed < EINK_MIN_REFRESH_MS) {
    delay(EINK_MIN_REFRESH_MS - elapsed);
  }
  if (epd.Init() != 0) { Serial.println("[EINK] Init failed"); return false; }
  epd.Display(blackBuf, redBuf);
  epd.Sleep();
  lastRefreshMs = millis();
  return true;
}

// ─── AFFICHAGE QR CODE ─────────────────────────────────────────────────────
// Layout écran paysage 296×128 :
//   Zone QR  : partie gauche/centre (carré centré verticalement)
//   Zone texte: bande droite ~100px ou bande basse selon la taille du QR
//
// On choisit un layout simple :
//   - QR à gauche, carré le plus grand possible en hauteur (128px)
//   - Texte à droite du QR : MAC sur une ligne, CODE sur la suivante
void displayQR(const String& onboardUrl, const String& code, const String& mac) {
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  Serial.println("[QR] URL : " + onboardUrl);
  Serial.println("[QR] CODE: " + code);
  Serial.println("[QR] MAC : " + mac);

  // ── Génération du QR ──────────────────────────────────────────
  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(5)];

  int qrResult = qrcode_initText(&qrcode, qrcodeData, 4, ECC_MEDIUM, onboardUrl.c_str());
  if (qrResult < 0) {
    qrResult = qrcode_initText(&qrcode, qrcodeData, 5, ECC_MEDIUM, onboardUrl.c_str());
    if (qrResult < 0) {
      Serial.println("[QR] Erreur génération QR");
      refreshDisplay();
      return;
    }
  }

  // ── Préparation du texte ──────────────────────────────────────
  String macShort = mac;
  macShort.replace(":", "");
  macShort.toUpperCase();

  String macLine  = "MAC:" + macShort;
  String codeLine = "CODE:" + code;
  codeLine.toUpperCase();

  // ── Layout écran paysage 296×128 ──────────────────────────────
  // QR centré horizontalement, texte dessous
  const int marginTop   = 4;
  const int marginSide  = 4;
  const int marginBot   = 4;
  const int quietZone   = 2;   // modules
  const int gapQrText   = 4;   // px
  const int lineGap     = 3;   // px
  const int textH       = 7;
  const int textBlockH  = textH + lineGap + textH;

  int totalModules = qrcode.size + quietZone * 2;

  // On réserve la hauteur du texte en bas,
  // le QR prend le reste sans jamais sortir de l’écran.
  int maxQrW = IMG_W - marginSide * 2;
  int maxQrH = IMG_H - marginTop - gapQrText - textBlockH - marginBot;

  int scaleX = maxQrW / totalModules;
  int scaleY = maxQrH / totalModules;
  int scale  = min(scaleX, scaleY);
  if (scale < 1) scale = 1;

  int qrPx = totalModules * scale;

  // QR centré horizontalement
  int qrX0 = (IMG_W - qrPx) / 2;
  int qrY0 = marginTop;

  // ── Dessin du QR ──────────────────────────────────────────────
  for (int my = 0; my < qrcode.size; my++) {
    for (int mx = 0; mx < qrcode.size; mx++) {
      if (!qrcode_getModule(&qrcode, mx, my)) continue;

      int px0 = qrX0 + (mx + quietZone) * scale;
      int py0 = qrY0 + (my + quietZone) * scale;

      for (int dy = 0; dy < scale; dy++) {
        for (int dx = 0; dx < scale; dx++) {
          setPixel(blackBuf, px0 + dx, py0 + dy);
        }
      }
    }
  }

  // ── Texte sous le QR ──────────────────────────────────────────
  int textY1 = qrY0 + qrPx + gapQrText;
  int textY2 = textY1 + textH + lineGap;

  // Tronquage si une ligne dépasse la largeur écran
  int maxChars = IMG_W / 6;  // 1 char = 6 px avec ta font 5x7 + 1 espace
  if ((int)macLine.length() > maxChars) {
    macLine = macLine.substring(0, maxChars);
  }
  if ((int)codeLine.length() > maxChars) {
    codeLine = codeLine.substring(0, maxChars);
  }

  int macX  = (IMG_W - textWidth(macLine)) / 2;
  int codeX = (IMG_W - textWidth(codeLine)) / 2;

  drawText(blackBuf, macX,  textY1, macLine);
  drawText(blackBuf, codeX, textY2, codeLine);

  refreshDisplay();
}

// ─── HTTP HELPERS ──────────────────────────────────────────────────────────
bool httpPost(const String& path, const String& body, String& resp) {
  WiFiClient client; HTTPClient http;
  http.begin(client, SERVER_URL + path);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  resp = http.getString();
  http.end();
  Serial.printf("[HTTP POST] %s → %d\n", path.c_str(), code);
  return code == 200;
}

bool httpGet(const String& path, String& resp) {
  WiFiClient client; HTTPClient http;
  http.begin(client, SERVER_URL + path);
  int code = http.GET();
  resp = http.getString();
  http.end();
  Serial.printf("[HTTP GET] %s → %d\n", path.c_str(), code);
  return code == 200;
}

// ─── REGISTER ──────────────────────────────────────────────────────────────
bool doRegister() {
  String mac = WiFi.macAddress();
  mac.toLowerCase();

  String body = "{\"mac\":\"" + mac + "\",\"screens\":[\"" + SCREEN_TYPE + "\"],\"firmware\":\"1.4\"}";
  String resp;
  if (!httpPost("/api/register", body, resp)) return false;

  DynamicJsonDocument doc(1024);
  if (deserializeJson(doc, resp)) {
    Serial.println("[REGISTER] JSON error");
    return false;
  }

  deviceId  = doc["deviceId"].as<String>();
  pairCode  = doc["pairCode"].as<String>();
  // canvasUrl contient déjà /draw/deviceId/eink29bwr depuis le serveur
  canvasUrl = doc["canvasUrl"].as<String>();

  registered = true;

  // L'URL affiché dans le QR → page onboard avec le code
  String onboardUrl = String(SERVER_URL) + "/onboard?code=" + pairCode;

  Serial.println("[REGISTER] deviceId : " + deviceId);
  Serial.println("[REGISTER] pairCode : " + pairCode);
  Serial.println("[REGISTER] canvasUrl: " + canvasUrl);
  Serial.println("[REGISTER] QR URL   : " + onboardUrl);

  displayQR(onboardUrl, pairCode, mac);
  return true;
}

// ─── PING ──────────────────────────────────────────────────────────────────
void doPing() {
  String body = "{\"deviceId\":\"" + deviceId + "\"}";
  String resp;
  httpPost("/api/ping", body, resp);
}

// ─── PULL ──────────────────────────────────────────────────────────────────
void doPull() {
  String resp;
  String path = "/api/pull?deviceId=" + deviceId;

  WiFiClient client;
  HTTPClient http;
  http.begin(client, String(SERVER_URL) + path);
  int code = http.GET();
  resp = http.getString();
  http.end();
  Serial.printf("[HTTP GET] %s → %d\n", path.c_str(), code);

  if (code == 404) {
    Serial.println("[PULL] device inconnu → re-register");
    registered = false;
    deviceId = pairCode = canvasUrl = "";
    return;
  }
  if (code != 200) return;

  // ── Parse JSON ────────────────────────────────────────────────
  // Réponse attendue : { "frame": { "screen":"eink29bwr", "black":"...", "red":"..." } }
  // ou               : { "frame": null }
  //
  // Sur ESP8266 la mémoire est limitée : on alloue juste ce qu'il faut.
  // Les chaînes base64 font ~6315 chars chacune (4736 bytes encodés).
  // On utilise des pointeurs directs dans le String resp pour éviter la copie.

  // Vérification rapide : frame null ?
  if (resp.indexOf("\"frame\":null") >= 0 || resp.indexOf("\"frame\": null") >= 0) {
    Serial.println("[PULL] Aucun frame disponible");
    return;
  }

  // Extraction manuelle des champs base64 pour économiser la RAM
  // (ArduinoJson avec 2×6315 chars dépasse facilement les 32KB d'ESP8266)
  auto extractB64 = [&](const String& key) -> String {
    String search = "\"" + key + "\":\"";
    int start = resp.indexOf(search);
    if (start < 0) return "";
    start += search.length();
    int end = resp.indexOf("\"", start);
    if (end < 0) return "";
    return resp.substring(start, end);
  };

  String blackB64 = extractB64("black");
  String redB64   = extractB64("red");

  if (blackB64.length() == 0 || redB64.length() == 0) {
    Serial.println("[PULL] Champs black/red manquants");
    return;
  }

  Serial.printf("[PULL] black=%d  red=%d  chars\n", blackB64.length(), redB64.length());

  size_t blackLen = base64Decode(blackB64.c_str(), blackB64.length(), blackBuf, BUF_SIZE);
  size_t redLen   = base64Decode(redB64.c_str(),   redB64.length(),   redBuf,   BUF_SIZE);

  Serial.printf("[PULL] décodé black=%zu red=%zu bytes\n", blackLen, redLen);

  if (blackLen == 0 || redLen == 0) {
    Serial.println("[PULL] Décodage base64 échoué");
    return;
  }

  frameReady = true;
  refreshDisplay();
  Serial.println("[PULL] ✅ Frame affichée");
}

// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] ESP Canvas Pull v1.4");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Connexion");
  int i = 0;
  while (WiFi.status() != WL_CONNECTED && i++ < 40) { delay(500); Serial.print("."); }
  Serial.println("\n[WIFI] IP: " + WiFi.localIP().toString());

  if (epd.Init() != 0) { Serial.println("[EINK] INIT FAILED"); return; }
  Serial.println("[EINK] OK");

  while (!registered) { doRegister(); if (!registered) delay(5000); }
  lastPingMs = lastPullMs = millis();
}

void loop() {
  unsigned long now = millis();

  if (!registered) { doRegister(); delay(5000); return; }

  if (now - lastPingMs >= PING_INTERVAL) { doPing(); lastPingMs = now; }
  if (now - lastPullMs >= PULL_INTERVAL) { doPull(); lastPullMs = now; }

  delay(100);
}
