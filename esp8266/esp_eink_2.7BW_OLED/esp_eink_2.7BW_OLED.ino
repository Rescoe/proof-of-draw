#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ArduinoJson.h>

#include <SPI.h>
#include <Wire.h>

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include "epd2in7_V2.h"

// =====================================================
// WIFI
// =====================================================

const char* WIFI_SSID = "";
const char* WIFI_PASSWORD = "";

String lastScreen = "";
// =====================================================
// SERVER
// =====================================================

ESP8266WebServer server(80);

// =====================================================
// OLED 128x64
// =====================================================

#define OLED_SDA D6  // GPIO12 - NOUVEAU pour I2C
#define OLED_SCL D4  // GPIO2  - NOUVEAU pour I2C
#define OLED_RST -1

#define OLED_WIDTH 128
#define OLED_HEIGHT 64
#define OLED_BUF_SIZE ((OLED_WIDTH * OLED_HEIGHT) / 8)

Adafruit_SSD1306 oled(
  OLED_WIDTH,
  OLED_HEIGHT,
  &Wire,
  OLED_RST
);

uint8_t oledBuf[OLED_BUF_SIZE];

// =====================================================
// EINK 2.7
// =====================================================

#define E27_WIDTH 176
#define E27_HEIGHT 264
#define E27_BUF_SIZE ((E27_WIDTH * E27_HEIGHT) / 8)

Epd epd27;

uint8_t e27Buf[E27_BUF_SIZE];

// =====================================================
// GLOBALS
// =====================================================

DynamicJsonDocument doc(16384);

String lastError = "";

unsigned long framesReceived = 0;

// =====================================================
// BASE64
// =====================================================

static const int8_t B64_TABLE[256] PROGMEM = {
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,
  52,53,54,55,56,57,58,59,60,61,-1,-1,-1, 0,-1,-1,
  -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,
  15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
  -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
  41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1
};

size_t base64Decode(
  const char* src,
  size_t srcLen,
  uint8_t* dst,
  size_t dstMax
) {
  size_t out = 0;

  int buf = 0;
  int bits = 0;

  for (size_t i = 0; i < srcLen && out < dstMax; i++) {

    int8_t val =
      (int8_t)pgm_read_byte(
        &B64_TABLE[(uint8_t)src[i]]
      );

    if (val < 0) continue;

    buf = (buf << 6) | val;
    bits += 6;

    if (bits >= 8) {

      bits -= 8;

      dst[out++] =
        (buf >> bits) & 0xFF;
    }
  }

  return out;
}

// =====================================================
// HELPERS
// =====================================================

void setCORS() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void sendJSON(int code, const String& json) {
  setCORS();
  server.send(code, "application/json", json);
}

void sendError(int code, const String& msg) {

  lastError = msg;

  String json =
    "{"
    "\"ok\":false,"
    "\"error\":\"" + msg + "\""
    "}";

  sendJSON(code, json);

  Serial.printf("[ERR] %s\n", msg.c_str());
}

// =====================================================
// OLED
// =====================================================

bool initOLED() {

  Wire.begin(OLED_SDA, OLED_SCL);

  bool ok = oled.begin(
    SSD1306_SWITCHCAPVCC,
    0x3C
  );

  if (!ok) {
    Serial.println("[OLED] init failed");
    return false;
  }

  return true;
}
bool recoverOledAfterEink() {

  Serial.println("[OLED] recover after EINK");

  SPI.end();

  delay(20);

  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(100000);

  delay(20);

  uint8_t* fb = oled.getBuffer();

  memcpy(fb, oledBuf, OLED_BUF_SIZE);

  oled.display();

  Serial.println("[OLED] recovered");

  return true;
}


void displayOLED() {
  Serial.println("[OLED] Starting...");

  uint8_t* fb = oled.getBuffer();
  memcpy(fb, oledBuf, OLED_BUF_SIZE);

  oled.display();
  Serial.println("[OLED] Displayed OK");
}


// =====================================================
// E27
// =====================================================

bool initE27() {

  SPI.begin();

  int r = epd27.Init();

  if (r != 0) {
    Serial.println("[E27] init failed");
    return false;
  }

  return true;
}

void displayE27() {

  SPI.begin();

  delay(10);

  if (epd27.Init() != 0) {
    Serial.println("[E27] reinit failed");
    return;
  }

  epd27.Display(e27Buf);

  epd27.Sleep();

  SPI.end();

  Serial.println("[E27] Displayed OK");
}

// =====================================================
// ROUTES
// =====================================================

void handlePing() {

  String json =
    "{"
    "\"ok\":true,"
    "\"ip\":\"" + WiFi.localIP().toString() + "\","
    "\"heap\":" + String(ESP.getFreeHeap()) + ","
    "\"frames\":" + String(framesReceived) + ","
    "\"lastError\":\"" + lastError + "\""
    "}";

  sendJSON(200, json);
}

void handleRoot() {

  sendJSON(
    200,
    "{\"ok\":true,\"name\":\"ESP Screen Receiver\"}"
  );
}




void handleFrame() {
  if (!server.hasArg("plain")) {
    sendError(400, "Missing body");
    return;
  }

  const String& body = server.arg("plain");
  Serial.printf("[HTTP] body=%u heap=%u\n", body.length(), ESP.getFreeHeap());

  doc.clear();
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    sendError(400, String("JSON parse error: ") + err.c_str());
    return;
  }

  const char* screen = doc["screen"];
  const char* bufferB64 = doc["buffer"];
  const char* blackB64 = doc["black"];
  const char* redB64 = doc["red"];

  // 🔍 DEBUG IMMÉDIAT — à voir dans Serial Monitor
  Serial.printf("[DEBUG] screen='%s' buffer=%s black=%s red=%s\n",
    screen ? screen : "NULL",
    bufferB64 ? "OK" : "NULL",
    blackB64 ? "OK" : "NULL",
    redB64 ? "OK" : "NULL"
  );

  if (!screen) {
    sendError(400, "Missing screen");
    return;
  }

  // =====================================================
  // OLED — screen="oled096"
  // =====================================================
if (strcmp(screen, "oled096") == 0) {
  if (!bufferB64) {
    sendError(400, "Missing buffer for oled096");
    return;
  }

  size_t len = base64Decode(bufferB64, strlen(bufferB64), oledBuf, OLED_BUF_SIZE);
  Serial.printf("[OLED] decoded=%u expected=%u\n", len, OLED_BUF_SIZE);

  if (len != OLED_BUF_SIZE) {
    sendError(400, "OLED buffer size mismatch");
    return;
  }

  bool ok = true;

  if (lastScreen == "eink27bw") {
    ok = recoverOledAfterEink();
  } else {
    displayOLED();
  }

  if (!ok) {
    sendError(500, "OLED display failed");
    return;
  }

  lastScreen = "oled096";
  framesReceived++;
  sendJSON(200, "{\"ok\":true}");
  return;
}

  // =====================================================
  // E27 — screen="eink27bw"  
  // =====================================================
  if (strcmp(screen, "eink27bw") == 0) {
    if (!bufferB64) {
      sendError(400, "Missing buffer for eink27bw");
      return;
    }
    size_t len = base64Decode(bufferB64, strlen(bufferB64), e27Buf, E27_BUF_SIZE);
    // Dans handleFrame(), APRÈS base64Decode pour OLED/E27
Serial.printf("[DEBUG] buffer[0]=0x%02X buffer[1]=0x%02X\n", e27Buf[0], e27Buf[1]);
Serial.printf("[DEBUG] buffer[last]=0x%02X\n", e27Buf[E27_BUF_SIZE-1]);

    Serial.printf("[E27] decoded=%u expected=%u\n", len, E27_BUF_SIZE);
    if (len != E27_BUF_SIZE) {
      sendError(400, "E27 buffer size mismatch");
      return;
    }
  displayE27();
  lastScreen = "eink27bw";
  framesReceived++;
  sendJSON(200, "{\"ok\":true}");
  return;
  }

  // =====================================================
  // EINK 2.9 BWR — screen="eink29bwr" (NOUVEAU !)
  // =====================================================
  if (strcmp(screen, "eink29bwr") == 0) {
    if (!blackB64 || !redB64) {
      sendError(400, "Missing black/red for eink29bwr");
      return;
    }

    // Constantes EINK 2.9 BWR Waveshare (à adapter à ton driver)
    #define E29_WIDTH 128
    #define E29_HEIGHT 296  
    #define E29_BUF_SIZE ((E29_WIDTH * E29_HEIGHT) / 8)  // 4736 bytes

    // Buffers statiques pour E29 (ajoute-les en global si pas déjà fait)
    static uint8_t e29BlackBuf[E29_BUF_SIZE];
    static uint8_t e29RedBuf[E29_BUF_SIZE];

    size_t blackLen = base64Decode(blackB64, strlen(blackB64), e29BlackBuf, E29_BUF_SIZE);
    size_t redLen = base64Decode(redB64, strlen(redB64), e29RedBuf, E29_BUF_SIZE);

    Serial.printf("[E29BWR] black=%u red=%u expected=%u\n", blackLen, redLen, E29_BUF_SIZE);

    if (blackLen != E29_BUF_SIZE || redLen != E29_BUF_SIZE) {
      sendError(400, "E29BWR buffer size mismatch");
      return;
    }

    // Affichage E29 BWR (adapte à ton driver Waveshare)
    // epd29.Display(e29BlackBuf, e29RedBuf);  // ← À implémenter
    Serial.println("[E29BWR] displayed (TODO: implémenter driver)");

    framesReceived++;
    sendJSON(200, "{\"ok\":true}");
    return;
  }

  sendError(400, String("Unknown screen: ") + screen);
}





void handleOptions() {
  setCORS();
  server.send(204);
}

void handleNotFound() {
  sendError(404, "Not found");
}

// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  Serial.println();
  Serial.println("=== ESP SCREEN RECEIVER ===");

  memset(oledBuf, 0x00, OLED_BUF_SIZE);
  memset(e27Buf, 0xFF, E27_BUF_SIZE);

  // OLED
  initOLED();
 
  // EINK
  initE27();

  // WIFI

  WiFi.mode(WIFI_STA);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );

  Serial.print("WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  Serial.println(
    "IP: " + WiFi.localIP().toString()
  );

  // ROUTES

  server.on("/", HTTP_GET, handleRoot);

  server.on("/ping", HTTP_GET, handlePing);

  server.on("/frame", HTTP_POST, handleFrame);

  server.on("/frame", HTTP_OPTIONS, handleOptions);

  server.onNotFound(handleNotFound);

  server.begin();

  Serial.printf(
    "[READY] heap=%u\n",
    ESP.getFreeHeap()
  );
}

// =====================================================
// LOOP
// =====================================================

void loop() {

  server.handleClient();

  yield();
}