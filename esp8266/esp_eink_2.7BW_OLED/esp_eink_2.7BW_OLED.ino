// esp_multiscreen_pull.ino — v1.0
// Supporte : oled096 (128x64) + eink27bw (176x264)
// Même architecture que esp_eink_2.9BWR v1.5 :
// - Pull-based (pas de serveur HTTP sur l'ESP)
// - HTTPS Vercel
// - Anti-OOM : malloc post-register, free/malloc autour de TLS
// - Rate limit respecté côté firmware (pull toutes les 15min)
// - paired : pas de QR si déjà onboardé

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

#include <SPI.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "epd2in7_V2.h"

// ─── CONFIG ────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "TON_SSID";
const char* WIFI_PASSWORD = "TON_MOT_DE_PASSE";

#define SERVER_URL       "https://proof-of-draw.vercel.app"
#define FIRMWARE_VERSION "multiscreen-1.0"

// Screens déclarés au register — l'app proposera les deux
// L'utilisateur choisit lequel dessiner depuis /draw
#define SCREEN_OLED  "oled096"
#define SCREEN_E27   "eink27bw"

#define PULL_INTERVAL  900000UL   // 15 min — cohérent avec rate limit serveur
#define PING_INTERVAL  0UL        // désactivé — le pull fait le ping implicitement

// ─── OLED 128×64 ───────────────────────────────────────────────────────────
#define OLED_SDA     D6
#define OLED_SCL     D4
#define OLED_RST     -1
#define OLED_WIDTH   128
#define OLED_HEIGHT  64
#define OLED_BUF_SIZE ((OLED_WIDTH * OLED_HEIGHT) / 8)   // 1024 bytes

Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RST);
bool oledReady = false;

// ─── EINK 2.7" BW ──────────────────────────────────────────────────────────
#define E27_WIDTH    176
#define E27_HEIGHT   264
#define E27_BUF_SIZE ((E27_WIDTH * E27_HEIGHT) / 8)   // 5808 bytes

Epd epd27;
bool e27Ready = false;

// ─── Buffers alloués dynamiquement post-register ───────────────────────────
// Libérés pendant les handshakes TLS pour éviter OOM
uint8_t* oledBuf = nullptr;
uint8_t* e27Buf  = nullptr;

// ─── STATE ─────────────────────────────────────────────────────────────────
String deviceId, pairCode, canvasUrl;
bool   registered        = false;
bool   paired            = false;
bool   screensReady      = false;
unsigned long lastPullMs = 0;
String lastFrameId       = "";
bool   hasDisplayedFrame = false;
String lastScreen        = "";

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
  Serial.printf("[HTTP POST] %s → %d\n", path.c_str(), code);
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
  Serial.printf("[HTTP GET] %s → %d (%u bytes)\n", path.c_str(), code, resp.length());
  return code == 200;
}

// ─── INIT ÉCRANS ──────────────────────────────────────────────────────────
// Appelé UNE SEULE FOIS après le register — buffers alloués ici
bool initScreens() {
  Serial.printf("[HEAP] avant init écrans: %u bytes\n", ESP.getFreeHeap());

  // Alloue les buffers
  oledBuf = (uint8_t*)malloc(OLED_BUF_SIZE);
  e27Buf  = (uint8_t*)malloc(E27_BUF_SIZE);

  if (!oledBuf || !e27Buf) {
    Serial.println("[INIT] ERREUR malloc buffers");
    return false;
  }

  memset(oledBuf, 0x00, OLED_BUF_SIZE);
  memset(e27Buf,  0xFF, E27_BUF_SIZE);

  // Init OLED
  Wire.begin(OLED_SDA, OLED_SCL);
  oledReady = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!oledReady) Serial.println("[OLED] init failed");
  else            Serial.println("[OLED] ready");

  // Init E27
  SPI.begin();
  e27Ready = (epd27.Init() == 0);
  if (!e27Ready) Serial.println("[E27] init failed");
  else           Serial.println("[E27] ready");

  Serial.printf("[HEAP] après init écrans: %u bytes\n", ESP.getFreeHeap());
  screensReady = true;
  return true;
}

// ─── AFFICHAGE OLED ────────────────────────────────────────────────────────
void displayOLED() {
  if (!oledReady) return;

  // Si on venait de l'eink, SPI a pris le bus — on relance I2C
  if (lastScreen == SCREEN_E27) {
    SPI.end();
    delay(20);
    Wire.begin(OLED_SDA, OLED_SCL);
    Wire.setClock(100000);
    delay(20);
  }

  uint8_t* fb = oled.getBuffer();
  memcpy(fb, oledBuf, OLED_BUF_SIZE);
  oled.display();
  Serial.println("[OLED] displayed");
}

// ─── AFFICHAGE E27 ─────────────────────────────────────────────────────────
void displayE27() {
  if (!e27Ready) return;

  SPI.begin();
  delay(10);

  if (epd27.Init() != 0) {
    Serial.println("[E27] reinit failed");
    return;
  }

  epd27.Display(e27Buf);
  epd27.Sleep();
  SPI.end();
  Serial.println("[E27] displayed");
}

// ─── FONT 5×7 (pour QR text) ───────────────────────────────────────────────
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

// Affiche le QR + infos sur l'OLED au lieu de l'e-ink
// (l'OLED est plus rapide et toujours disponible pour l'onboarding)
void displayQROnOLED(const String& code, const String& mac) {
  if (!oledReady) return;
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);
  oled.println("PROOF-OF-DRAW");
  oled.println("Scannez ou saisissez:");
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
  Serial.println("[OLED] QR code displayed");
}

// ─── ACK ───────────────────────────────────────────────────────────────────
bool ackFrame(const String& frameId) {
  if (frameId.length() == 0) return false;
  String body = "{\"deviceId\":\"" + deviceId + "\",\"frameId\":\"" + frameId + "\"}";
  String resp;
  return httpPost("/api/ack-frame", body, resp);
}

// ─── REGISTER ──────────────────────────────────────────────────────────────
// ⚠️  Écrans NON initialisés avant cette fonction — RAM réservée pour TLS
bool doRegister() {
  String mac = WiFi.macAddress();
  mac.toLowerCase();

  // Déclare les deux écrans supportés
  String body =
    "{\"mac\":\"" + mac + "\","
    "\"screens\":[\"" + SCREEN_OLED + "\",\"" + SCREEN_E27 + "\"],"
    "\"firmware\":\"" + FIRMWARE_VERSION + "\"}";

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

  deviceId  = doc["deviceId"].as<String>();
  pairCode  = doc["pairCode"].as<String>();
  canvasUrl = doc["canvasUrl"].as<String>();
  paired    = doc["paired"] | false;
  registered = true;

  Serial.println("[REGISTER] deviceId : " + deviceId);
  Serial.println("[REGISTER] paired   : " + String(paired ? "oui" : "non"));

  // Init écrans APRÈS le register — TLS a libéré sa RAM
  if (!screensReady) {
    if (!initScreens()) {
      registered = false;
      return false;
    }
  }

  if (!paired) {
    // Affiche le code sur l'OLED pour onboarding
    displayQROnOLED(pairCode, mac);
    Serial.println("[REGISTER] code affiché sur OLED, restart dans 3s...");
    delay(3000);
    ESP.restart();
  } else {
    Serial.println("[REGISTER] déjà appairé, pas d'affichage QR");
  }

  return true;
}

// ─── PULL ──────────────────────────────────────────────────────────────────
void doPull() {
  // Libère les buffers pour TLS
  free(oledBuf); oledBuf = nullptr;
  free(e27Buf);  e27Buf  = nullptr;

  Serial.printf("[HEAP] avant pull: %u bytes\n", ESP.getFreeHeap());

  String resp;
  bool ok = httpGet("/api/pull?deviceId=" + deviceId, resp);

  // Réalloue immédiatement
  oledBuf = (uint8_t*)malloc(OLED_BUF_SIZE);
  e27Buf  = (uint8_t*)malloc(E27_BUF_SIZE);

  if (!oledBuf || !e27Buf) {
    Serial.println("[PULL] malloc failed");
    ESP.restart();
    return;
  }

  if (!ok) { Serial.println("[PULL] Echec HTTP"); return; }
  if (resp.indexOf("\"frame\":null") >= 0) { Serial.println("[PULL] Aucune frame"); return; }

  // Extraction des champs
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
  String bufB64   = extractField("buffer");   // OLED + E27
  String blackB64 = extractField("black");    // E29 (ignoré ici)
  String redB64   = extractField("red");      // E29 (ignoré ici)

  if (frameId.length() > 0 && frameId == lastFrameId) {
    Serial.println("[PULL] frame déjà affichée");
    return;
  }

  Serial.println("[PULL] screen=" + screen + " frameId=" + frameId);

  // ── OLED ──────────────────────────────────────────────────────────────────
  if (screen == SCREEN_OLED) {
    if (bufB64.isEmpty()) { Serial.println("[PULL] buffer manquant pour OLED"); return; }

    memset(oledBuf, 0x00, OLED_BUF_SIZE);
    size_t len = base64Decode(bufB64.c_str(), bufB64.length(), oledBuf, OLED_BUF_SIZE);
    Serial.printf("[OLED] decoded=%u expected=%u\n", len, OLED_BUF_SIZE);

    if (len != OLED_BUF_SIZE) { Serial.println("[PULL] taille OLED invalide"); return; }

    displayOLED();
    lastScreen = SCREEN_OLED;
    lastFrameId = frameId;
    ackFrame(frameId);
    Serial.println("[PULL] ✅ OLED affiché + ack");
    return;
  }

  // ── E27 ───────────────────────────────────────────────────────────────────
  if (screen == SCREEN_E27) {
    if (bufB64.isEmpty()) { Serial.println("[PULL] buffer manquant pour E27"); return; }

    memset(e27Buf, 0xFF, E27_BUF_SIZE);
    size_t len = base64Decode(bufB64.c_str(), bufB64.length(), e27Buf, E27_BUF_SIZE);
    Serial.printf("[E27] decoded=%u expected=%u\n", len, E27_BUF_SIZE);

    if (len != E27_BUF_SIZE) { Serial.println("[PULL] taille E27 invalide"); return; }

    displayE27();
    lastScreen = SCREEN_E27;
    lastFrameId = frameId;
    ackFrame(frameId);
    Serial.println("[PULL] ✅ E27 affiché + ack");
    return;
  }

  Serial.println("[PULL] screen inconnu: " + screen);
}

// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] ESP Multiscreen Pull v1.0");

  // ⚠️  Pas d'init écrans ici — RAM réservée pour TLS

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Connexion");
  int i = 0;
  while (WiFi.status() != WL_CONNECTED && i++ < 40) { delay(500); Serial.print("."); }
  Serial.println("\n[WIFI] IP: " + WiFi.localIP().toString());
  Serial.printf("[HEAP] après WiFi: %u bytes\n", ESP.getFreeHeap());

  while (!registered) { doRegister(); if (!registered) delay(5000); }
  lastPullMs = millis();
}

void loop() {
  unsigned long now = millis();
  if (!registered) { doRegister(); delay(5000); return; }
  if (now - lastPullMs >= PULL_INTERVAL) { doPull(); lastPullMs = now; }
  delay(100);
}
