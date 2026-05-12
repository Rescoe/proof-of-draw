// esp_canvas_pull_waveshare.ino — v1.5 — HTTPS Vercel + anti-OOM
// CHANGEMENTS vs v1.4 :
// 1. WiFiClientSecure + setInsecure() pour HTTPS
// 2. L'écran e-ink est initialisé APRÈS le register (libère ~10KB pendant TLS)
// 3. Les buffers nextBlack/nextRed passent en static local dans doPull()
//    pour ne pas peser sur le heap global pendant le handshake TLS
// 4. PULL_INTERVAL et PING_INTERVAL espacés (sobriété + rate limit serveur)

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>   // ← HTTPS
#include <ArduinoJson.h>
#include <qrcode.h>
#include "epd2in9b_V4.h"
#include "epdif.h"

// ─── CONFIG ────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "Livebox-D190";
const char* WIFI_PASSWORD = "Q2gueWg3UaYJo2VN7C";

#define SERVER_URL      "https://proof-of-draw.vercel.app"
//#define SERVER_URL      "http://192.168.1.13:3000"

#define SCREEN_TYPE     "eink29bwr"
#define PING_INTERVAL   0UL          // ping désactivé — le pull suffit
#define PULL_INTERVAL   60000UL         // 15 min (cohérent avec rotation des œuvres)
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

unsigned long lastRefreshMs = 0;
bool einkReady = false;   // ← NOUVEAU : l'écran n'est init qu'après register

uint8_t* blackBuf  = nullptr;
uint8_t* redBuf    = nullptr;

// ─── STATE ─────────────────────────────────────────────────────────────────
// ─── PATCH esp_canvas_pull_waveshare.ino ───────────────────────────────────
// Remplace uniquement les variables d'état + la fonction doRegister()
// Le reste du fichier est inchangé.

// ─── STATE (remplace le bloc STATE existant) ────────────────────────────────
String deviceId, pairCode, canvasUrl;
bool   registered  = false;
bool   paired      = false;   // ← NOUVEAU : true si déjà onboardé côté serveur
bool   frameReady  = false;
unsigned long lastPingMs = 0, lastPullMs = 0;

String lastFrameId = "";
bool hasDisplayedFrame = false;


// ─── PIXEL HELPERS ────────────────────────────────────────────────────────
/*
  ============================================================
  ORIENTATION E-PAPER WAVESHARE 2.9" B V4 (296x128)
  Écran utilisé en HORIZONTAL, nappe/câble à GAUCHE.
  ============================================================

  REPÈRE LOGIQUE UTILISÉ PAR LE CODE :
  - x = 0 .. 295  (largeur logique)
  - y = 0 .. 127  (hauteur logique)

  PROBLÈME RENCONTRÉ :
  - Le driver/buffer natif de l'écran n'est pas dans le même repère
    que notre mise en page logique.
  - Si on dessine directement sans transformation, l'image apparaît
    mal orientée.
  - Attention : un MIROIR n'est PAS une rotation.
    Un miroir retourne aussi les lettres (texte illisible / inversé).
    Ici on veut une vraie rotation, pas du texte en miroir.

  SOLUTION VALIDÉE POUR L'AFFICHAGE CORRECT EN HORIZONTAL
  (écran horizontal, nappe à gauche) :
  - Appliquer une rotation de 90° vers la gauche (antihoraire)
    lors de l'écriture des pixels dans le buffer.
  - Transformation validée :
        xr = y;
        yr = x;

  Implémentation :

    inline void setPixel(uint8_t* buf, int x, int y) {
      if (x < 0 || x >= IMG_W || y < 0 || y >= IMG_H) return;
      int xr = y;
      int yr = x;
      int byteIndex = (yr * 16) + (xr / 8);   // 16 = 128 / 8
      int bitMask = 0x80 >> (xr & 7);
      buf[byteIndex] &= ~bitMask;
    }

  POURQUOI ÇA MARCHE :
  - Notre layout (textes, QR, etc.) est pensé en 296x128.
  - Le buffer physique de l'écran attend les pixels dans un repère
    différent.
  - Cette transformation équivaut à une rotation gauche de 90°
    adaptée au packing mémoire du panneau.
  - Résultat : QR + texte affichés dans le bon sens, sans miroir.

  SI ON VEUT PASSER L'ÉCRAN EN PORTRAIT "DROIT" PLUS TARD :
  - Depuis cette base horizontale correcte, il faudra encore faire
    une rotation de 90° vers la gauche.
  - Donc : PORTRAIT DROIT = encore 90° antihoraire par rapport
    au rendu horizontal validé ici.
  - Important : il faudra faire une vraie rotation du repère,
    PAS un flip/mirror, sinon le texte redeviendra inversé.

  RÈGLE PRATIQUE À RETENIR :
  - Rotation = texte lisible.
  - Mirror/flip = texte inversé.
  - Si les lettres deviennent à l'envers, ce n'est pas la bonne
    transformation : on a introduit un miroir au lieu d'une rotation.

  MÉMO RAPIDE :
  - Horizontal nappe à gauche : setPixel() avec
        xr = y;
        yr = x;
  - Portrait droit depuis cette config :
        encore 90° à gauche à partir de ce repère
        (à recalculer proprement si on change tout le layout).
*/
inline void setPixel(uint8_t* buf, int x, int y) {
  if (x < 0 || x >= IMG_W || y < 0 || y >= IMG_H) return;

  // Base correcte : rotation 90° antihoraire
  int xr = y;
  int yr = IMG_W - 1 - x;   // 295 - x

  // Correction du miroir restant sur Y
  yr = IMG_W - 1 - yr;      // revient à yr = x

  int byteIndex = (yr * (IMG_H / 8)) + (xr / 8);
  int bitMask   = 0x80 >> (xr & 7);

  buf[byteIndex] &= ~bitMask;
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
bool initDisplayForRefresh() {
  unsigned long elapsed = millis() - lastRefreshMs;
  if (elapsed < EINK_MIN_REFRESH_MS) {
    delay(EINK_MIN_REFRESH_MS - elapsed);
  }

  if (epd.Init() != 0) {
    Serial.println("[EINK] Init failed");
    return false;
  }

  return true;
}

bool refreshDisplay() {
  if (!initDisplayForRefresh()) return false;

  epd.Display(blackBuf, redBuf);
  epd.Sleep();
  lastRefreshMs = millis();
  return true;
}

bool clearDisplayWhite() {
  if (!initDisplayForRefresh()) return false;

  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  epd.Display(blackBuf, redBuf);
  epd.Sleep();
  lastRefreshMs = millis();
  return true;
}

bool ackFrame(const String& frameId) {
  if (frameId.length() == 0) return false;

  String body = "{\"deviceId\":\"" + deviceId + "\",\"frameId\":\"" + frameId + "\"}";
  String resp;
  bool ok = httpPost("/api/ack-frame", body, resp);
  Serial.printf("[ACK] frameId=%s -> %s\n", frameId.c_str(), ok ? "OK" : "FAIL");
  return ok;
}

// ─── AFFICHAGE QR CODE ─────────────────────────────────────────────────────
// Orientation validée : écran horizontal, nappe à gauche.
// Pour afficher correctement sans miroir : rotation 90° à gauche
// du repère logique vers le buffer physique.
// NE PAS utiliser de flip/mirror : ça inverse le texte.
// Si passage en portrait droit plus tard : refaire encore une
// rotation 90° à gauche à partir de cette base.
void displayQR(const String& onboardUrl, const String& code, const String& mac) {
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

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

  String title    = "RESCOE - PROOF-OF-DRAW";
  String subtitle = "TECHNOLOGY";
  String macShort = mac; 
  macShort.replace(":", ""); 
  macShort.toUpperCase();
  String macLine  = "MAC:" + macShort;
  String codeLine = "CODE:" + code; 
  codeLine.toUpperCase();

  const int screenW = IMG_W;   // 296
  const int screenH = IMG_H;   // 128
  const int textH = 7;
  const int lineGap = 3;
  const int quietZone = 2;

  const int topPad = 4;
  const int sidePad = 6;
  const int bottomPad = 4;
  const int gapTitleToQr = 6;
  const int gapQrToText = 6;

  const int titleBlockH = textH + 2 + textH;
  const int infoBlockH  = textH + lineGap + textH;

  int totalModules = qrcode.size + quietZone * 2;
  int usableW = screenW - sidePad * 2;
  int usableH = screenH - topPad - titleBlockH - gapTitleToQr - gapQrToText - infoBlockH - bottomPad;

  int scale = min(usableW / totalModules, usableH / totalModules);
  if (scale < 1) scale = 1;

  int qrPx = totalModules * scale;

  int titleY1 = topPad;
  int titleY2 = titleY1 + textH + 2;

  int qrX0 = (screenW - qrPx) / 2;
  int qrY0 = topPad + titleBlockH + gapTitleToQr;

  int textY1 = qrY0 + qrPx + gapQrToText;
  int textY2 = textY1 + textH + lineGap;

  auto centerText = [&](const String& s) -> int {
    return (screenW - textWidth(s)) / 2;
  };

  drawText(blackBuf, centerText(title),    titleY1, title);
  drawText(blackBuf, centerText(subtitle), titleY2, subtitle);

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

  drawText(blackBuf, centerText(macLine),  textY1, macLine);
  drawText(blackBuf, centerText(codeLine), textY2, codeLine);

  refreshDisplay();
}



// ─── HTTP HELPERS HTTPS ────────────────────────────────────────────────────
// setInsecure() = pas de vérif certificat.
// Acceptable pour un projet artistique DIY — l'ESP8266 n'a pas assez de RAM
// pour charger une CA bundle complète. Le trafic reste chiffré.

bool httpPost(const String& path, const String& body, String& resp) {
  WiFiClientSecure client;
  client.setInsecure();   // ← HTTPS sans vérif CA (anti-OOM)
  HTTPClient http;
  http.begin(client, String(SERVER_URL) + path);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);
  int code = http.POST(body);
  resp = (code > 0) ? http.getString() : "";
  http.end();
  Serial.printf("[HTTP POST] %s → %d\n", path.c_str(), code);
  return code == 200;
}

bool httpGet(const String& path, String& resp) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, String(SERVER_URL) + path);
  http.setTimeout(10000);
  int code = http.GET();
  resp = (code > 0) ? http.getString() : "";
  http.end();
  Serial.printf("[HTTP GET] %s → %d\n", path.c_str(), code);
  return code == 200;
}

// ─── REGISTER ──────────────────────────────────────────────────────────────
// ─── REGISTER ──────────────────────────────────────────────────────────────
// ⚠️  L'écran N'EST PAS initialisé avant cette fonction.
// Le handshake TLS a besoin de toute la RAM disponible.
// On init l'écran APRÈS avoir reçu la réponse du serveur.

bool doRegister() {
  String mac = WiFi.macAddress();
  mac.toLowerCase();

  // Libère un max de heap avant le handshake TLS
  String body = "{\"mac\":\"" + mac + "\",\"screens\":[\"" + SCREEN_TYPE + "\"],\"firmware\":\"1.5\"}";
  String resp;

  Serial.printf("[HEAP] avant register: %u bytes\n", ESP.getFreeHeap());

  if (!httpPost("/api/register", body, resp)) {
    Serial.println("[REGISTER] Echec HTTP");
    return false;
  }

  Serial.printf("[HEAP] après register: %u bytes\n", ESP.getFreeHeap());

  DynamicJsonDocument doc(512);   // réduit de 1024 à 512 — suffisant pour la réponse
  if (deserializeJson(doc, resp)) {
    Serial.println("[REGISTER] JSON error");
    return false;
  }

  deviceId  = doc["deviceId"].as<String>();
  pairCode  = doc["pairCode"].as<String>();
  canvasUrl = doc["canvasUrl"].as<String>();
  paired    = doc["paired"] | false;
  registered = true;

  Serial.println("[REGISTER] deviceId : " + deviceId);
  Serial.println("[REGISTER] paired   : " + String(paired ? "oui" : "non"));

  // ✅ Init e-ink ICI, après le register, une fois TLS libéré
  if (!einkReady) {
    Serial.printf("[HEAP] avant malloc: %u bytes\n", ESP.getFreeHeap());

    blackBuf = (uint8_t*)malloc(BUF_SIZE);
    redBuf   = (uint8_t*)malloc(BUF_SIZE);

    if (!blackBuf || !redBuf) {
      Serial.println("[EINK] ERREUR malloc — heap insuffisant");
      // Pas de crash : on réessaiera au prochain boot
      registered = false;
      return false;
    }

    memset(blackBuf, 0xFF, BUF_SIZE);
    memset(redBuf,   0xFF, BUF_SIZE);
    einkReady = true;

    Serial.printf("[HEAP] après malloc: %u bytes\n", ESP.getFreeHeap());
  }

// Dans doRegister(), tout à la fin, après displayQR() :
if (!paired) {
  String onboardUrl = String(SERVER_URL) + "/onboard?code=" + pairCode;
  displayQR(onboardUrl, pairCode, mac);
  
  // Redémarre proprement après avoir affiché le QR
  // Le prochain boot verra paired=true et aura un heap propre pour les pulls
  Serial.println("[REGISTER] Restart dans 3s pour libérer heap TLS...");
  delay(3000);
  ESP.restart();
} else {
    Serial.println("[REGISTER] Deja appaire, pas de QR");
  }

  return true;
}


// ─── PING ──────────────────────────────────────────────────────────────────
// Libère les buffers image pendant le handshake TLS puis les réalloue
void doPing() {
  free(blackBuf); blackBuf = nullptr;
  free(redBuf);   redBuf   = nullptr;

  String body = "{\"deviceId\":\"" + deviceId + "\"}";
  String resp;
  httpPost("/api/ping", body, resp);

  blackBuf = (uint8_t*)malloc(BUF_SIZE);
  redBuf   = (uint8_t*)malloc(BUF_SIZE);
  if (!blackBuf || !redBuf) { Serial.println("[PING] malloc failed"); ESP.restart(); }
}


// ─── PULL ──────────────────────────────────────────────────────────────────
void clearToWhiteAndRefresh() {
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);
  refreshDisplay();
}


// ─── PULL ──────────────────────────────────────────────────────────────────
void doPull() {
  // Libère les buffers image pour donner de la RAM au handshake TLS (~9.5KB récupérés)
  free(blackBuf); blackBuf = nullptr;
  free(redBuf);   redBuf   = nullptr;

  Serial.printf("[HEAP] avant pull: %u bytes\n", ESP.getFreeHeap());

  String resp;
  bool ok = httpGet("/api/pull?deviceId=" + deviceId, resp);
  Serial.println("[RAW] " + resp.substring(0, 200));
  
  // Réalloue immédiatement, qu'on ait une frame ou non
  blackBuf = (uint8_t*)malloc(BUF_SIZE);
  redBuf   = (uint8_t*)malloc(BUF_SIZE);
  if (!blackBuf || !redBuf) {
    Serial.println("[PULL] malloc failed après requête");
    ESP.restart();
    return;
  }

  if (!ok) {
    Serial.println("[PULL] Echec HTTP");
    return;
  }

  if (resp.indexOf("\"frame\":null") >= 0) {
    Serial.println("[PULL] Aucune frame");
    return;
  }

  // Extraction manuelle — évite DynamicJsonDocument sur grosse réponse
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
  String blackB64 = extractField("black");
  String redB64   = extractField("red");

  if (screen != SCREEN_TYPE || blackB64.isEmpty() || redB64.isEmpty()) {
    Serial.println("[PULL] Champs manquants ou screen incompatible");
    return;
  }

  if (frameId.length() > 0 && frameId == lastFrameId) {
    Serial.println("[PULL] Frame déjà affichée");
    return;
  }

  // Décode directement dans blackBuf/redBuf — pas de buffers temporaires supplémentaires
  // (ils viennent d'être réalloués proprement, ils sont vides)
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  size_t blackLen = base64Decode(blackB64.c_str(), blackB64.length(), blackBuf, BUF_SIZE);
  size_t redLen   = base64Decode(redB64.c_str(),   redB64.length(),   redBuf,   BUF_SIZE);

  Serial.printf("[PULL] decode black=%u red=%u\n", (unsigned)blackLen, (unsigned)redLen);

  if (blackLen != BUF_SIZE || redLen != BUF_SIZE) {
    Serial.println("[PULL] Taille invalide");
    memset(blackBuf, 0xFF, BUF_SIZE);
    memset(redBuf,   0xFF, BUF_SIZE);
    return;
  }

  if (hasDisplayedFrame) {
    Serial.println("[PULL] Hard clear avant nouveau dessin");
    if (!clearDisplayWhite()) return;
    delay(3000);
  }

  if (!refreshDisplay()) return;

  frameReady       = true;
  hasDisplayedFrame = true;
  lastFrameId      = frameId;

  if (!ackFrame(frameId))
    Serial.println("[PULL] WARNING: ack échoué");
  else
    Serial.println("[PULL] ✅ Frame affichée + ack");
}


// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] ESP Canvas Pull v1.5 HTTPS");

  // ⚠️  PAS d'init e-ink ici — on garde la RAM pour le handshake TLS

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Connexion");
  int i = 0;
  while (WiFi.status() != WL_CONNECTED && i++ < 40) { delay(500); Serial.print("."); }
  Serial.println("\n[WIFI] IP: " + WiFi.localIP().toString());
  Serial.printf("[HEAP] après WiFi: %u bytes libres\n", ESP.getFreeHeap());

  while (!registered) { doRegister(); if (!registered) delay(5000); }
  lastPingMs = lastPullMs = millis();
}

void loop() {
  unsigned long now = millis();
  if (!registered) { doRegister(); delay(5000); return; }
  // if (now - lastPingMs >= PING_INTERVAL) { doPing(); lastPingMs = now; } // ← supprime
  if (now - lastPullMs >= PULL_INTERVAL) { doPull(); lastPullMs = now; }
  delay(100);
}
