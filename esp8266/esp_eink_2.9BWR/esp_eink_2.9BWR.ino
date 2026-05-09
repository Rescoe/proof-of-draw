/**
 * @file    esp_canvas_receiver.ino
 * @brief   ESP8266 — Récepteur WiFi pour ESPCanvas (Next.js)
 *          Écran : E-Ink 2.9" BWR Waveshare (epd2in9b_V4)
 *
 * ══════════════════════════════════════════════════════════════
 *  PINOUT — identique au projet generative-seed-BWR
 * ══════════════════════════════════════════════════════════════
 *  EPD_SCK    D5  GPIO14
 *  EPD_MOSI   D7  GPIO13
 *  EPD_CS     D8  GPIO15
 *  EPD_DC     D2  GPIO4
 *  EPD_RST    D1  GPIO5
 *  EPD_BUSY   D0  GPIO16
 *
 * ══════════════════════════════════════════════════════════════
 *  LIBRAIRIES REQUISES (Arduino Library Manager)
 * ══════════════════════════════════════════════════════════════
 *  - ESP8266WiFi       (built-in board package)
 *  - ESP8266WebServer  (built-in board package)
 *  - ArduinoJson       v6.x  (Benoit Blanchon)
 *  + les fichiers driver Waveshare déjà dans ton projet :
 *    epd2in9b_V4.h / epd2in9b_V4.cpp / epdif.h / epdif.cpp
 *    (copie-les dans le même dossier que ce .ino)
 *
 * ══════════════════════════════════════════════════════════════
 *  PROTOCOLE REÇU depuis Next.js  POST /frame
 * ══════════════════════════════════════════════════════════════
 *  Content-Type: application/json
 *  {
 *    "screen": "eink29bwr",
 *    "data":   "<base64 PNG — 296×128 px, RGB ou RGBA>"
 *  }
 *
 *  L'app envoie un PNG dessiné sur canvas HTML.
 *  On le décode et on le convertit en deux buffers 1-bit :
 *    • blackBuf  : pixels noirs  (luminosité < THRESH_BLACK)
 *    • redBuf    : pixels rouges (teinte rouge dominante)
 *    • reste     : blanc (rien dans aucun buffer)
 *
 * ══════════════════════════════════════════════════════════════
 *  ENDPOINTS HTTP
 * ══════════════════════════════════════════════════════════════
 *  GET  /ping   → {"ok":true,"screen":"eink29bwr","ip":"..."}
 *  POST /frame  → reçoit JSON, affiche sur l'écran
 *  GET  /status → état actuel (last frame, free heap, etc.)
 */

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include "epd2in9b_V4.h"

// ╔══════════════════════════════════════════════════════════════╗
// ║  ⚙  CONFIGURATION — MODIFIE ICI                            ║
// ╚══════════════════════════════════════════════════════════════╝

const char* WIFI_SSID     = "";
const char* WIFI_PASSWORD = "";

// Port HTTP (80 par défaut — doit correspondre au port saisi dans /onboard)
const uint16_t HTTP_PORT = 80;

// Délai minimum entre deux refresh e-ink (ms).
// Waveshare recommande 180s en production pour préserver l'écran.
// Mettre 10000 (10s) pour les tests, 180000 pour la prod.
const unsigned long EINK_MIN_REFRESH_MS = 10000UL;

// ╔══════════════════════════════════════════════════════════════╗
// ║  CONSTANTES ÉCRAN                                           ║
// ╚══════════════════════════════════════════════════════════════╝

// Résolution logique du driver Waveshare epd2in9b_V4
// L'écran physique est 296×128, mais le driver gère les buffers
// en largeur = 128 (axe rapide en SPI), hauteur = 296.
// Notre canvas Next.js envoie une image 296×128 px (paysage).
// On la transpose ici pour correspondre à l'orientation driver.

#define IMG_W    296   // largeur image reçue (canvas HTML)
#define IMG_H    128   // hauteur image reçue (canvas HTML)

// Taille d'un buffer 1-bit pour le driver
// Le driver attend EPD_WIDTH=128 bits/ligne × EPD_HEIGHT=296 lignes
// = 128*296/8 = 4736 octets
#define BUF_SIZE  ((EPD_WIDTH * EPD_HEIGHT) / 8)   // 4736

// Seuils de détection couleur (sur valeurs 0-255)
#define THRESH_BLACK  80    // luminosité <= seuil → pixel noir
#define THRESH_RED_R  150   // canal rouge minimum pour "rouge"
#define THRESH_RED_G  80    // canal vert maximum pour "rouge"
#define THRESH_RED_B  80    // canal bleu maximum pour "rouge"

// ╔══════════════════════════════════════════════════════════════╗
// ║  GLOBALS                                                    ║
// ╚══════════════════════════════════════════════════════════════╝

Epd epd;
ESP8266WebServer server(HTTP_PORT);

// Buffers e-ink : 0xFF = tout blanc (bit à 1 = UNCOLORED dans Waveshare)
static uint8_t blackBuf[BUF_SIZE];
static uint8_t redBuf[BUF_SIZE];

// État
unsigned long lastRefreshMs  = 0;
unsigned long framesReceived = 0;
bool          displayReady   = false;
String        lastError      = "";

// ╔══════════════════════════════════════════════════════════════╗
// ║  BASE64 DECODER                                             ║
// ║  Décode inline dans un buffer fourni.                       ║
// ║  Retourne le nombre d'octets écrits, ou 0 si erreur.       ║
// ╚══════════════════════════════════════════════════════════════╝

static const int8_t B64_TABLE[256] PROGMEM = {
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,  // 0-15
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,  // 16-31
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,  // 32-47  (+, /)
  52,53,54,55,56,57,58,59,60,61,-1,-1,-1, 0,-1,-1,  // 48-63  (0-9, =)
  -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14, // 64-79  (A-O)
  15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,  // 80-95  (P-Z)
  -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40, // 96-111 (a-o)
  41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1,  // 112-127 (p-z)
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,  // 128-143
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,  // 144-159
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,  // 160-175
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,  // 176-191
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,  // 192-207
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,  // 208-223
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,  // 224-239
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1   // 240-255
};

size_t base64Decode(const char* src, size_t srcLen, uint8_t* dst, size_t dstMax) {
  size_t out = 0;
  int buf = 0, bits = 0;
  for (size_t i = 0; i < srcLen && out < dstMax; i++) {
    int8_t val = (int8_t)pgm_read_byte(&B64_TABLE[(uint8_t)src[i]]);
    if (val < 0) continue;   // skip whitespace / padding / invalid
    buf = (buf << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      dst[out++] = (buf >> bits) & 0xFF;
    }
  }
  return out;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  PNG PARSER MINIMAL                                         ║
// ║                                                             ║
// ║  On ne décode PAS le PNG complet (zlib = trop lourd).      ║
// ║  À la place, le canvas Next.js DOIT envoyer un PNG         ║
// ║  non compressé (compression level 0) ou on utilise         ║
// ║  une autre stratégie :                                      ║
// ║                                                             ║
// ║  STRATÉGIE RETENUE pour le MVP :                           ║
// ║  Le serveur Next.js convertit le PNG en données brutes      ║
// ║  RGB (3 octets/pixel) avant d'encoder en base64.           ║
// ║  → payload = base64(rawRGB : 296×128×3 octets)             ║
// ║  → 113664 octets bruts → ~151552 chars base64              ║
// ║                                                             ║
// ║  L'ESP reçoit et décode directement les pixels RGB.        ║
// ║  Pas besoin de décompresseur PNG.                          ║
// ║                                                             ║
// ║  Voir api/draw/route.ts : convertir canvas en rawRGB       ║
// ╚══════════════════════════════════════════════════════════════╝

// Convertit un pixel RGB en couleur e-ink
// Retourne : 0 = blanc, 1 = noir, 2 = rouge
uint8_t classifyPixel(uint8_t r, uint8_t g, uint8_t b) {
  // Rouge dominant ?
  if (r >= THRESH_RED_R && g <= THRESH_RED_G && b <= THRESH_RED_B) {
    return 2;  // rouge
  }
  // Luminosité (approximation rapide sans float)
  // lum = 0.299R + 0.587G + 0.114B ≈ (3R + 6G + B) / 10
  uint16_t lum = ((uint16_t)r * 3 + (uint16_t)g * 6 + (uint16_t)b) / 10;
  if (lum <= THRESH_BLACK) {
    return 1;  // noir
  }
  return 0;  // blanc
}

// Écrire un pixel dans un buffer 1-bit
// Convention Waveshare : 0 = COLORED, 1 = UNCOLORED (blanc)
// Les buffers sont initialisés à 0xFF (tout blanc)
// Pour colorier un pixel : mettre le bit à 0
inline void setPixelBuf(uint8_t* buf, int byteX, int y, int bitInByte) {
  // byteX = index byte dans la ligne, y = ligne, bitInByte = bit 7..0
  int idx = y * (EPD_WIDTH / 8) + byteX;
  if (idx >= (int)BUF_SIZE) return;
  buf[idx] &= ~(1 << bitInByte);   // mettre bit à 0 = COLORED
}

// ── Convertit les pixels RGB bruts en blackBuf + redBuf ─────────────────
// L'image reçue est en orientation PAYSAGE : 296 colonnes × 128 lignes.
// Le driver Waveshare epd2in9b_V4 attend les buffers en orientation
// PORTRAIT : EPD_WIDTH=128 octets/ligne × EPD_HEIGHT=296 lignes,
// avec les bits MSB-first sur l'axe X.
//
// Mapping :
//   pixel(col, row) dans l'image  →  bit dans le buffer driver
//   Le driver affiche en rotation 90°, ce qui donne l'orientation paysage
//   sur l'écran physique 296×128.
//
//   Si l'image apparaît tournée de 90°, décommenter le bloc "rotation"
//   et commenter le bloc "direct". Tout dépend de comment tu tiens l'écran.

void rgbToEinkBuffers(const uint8_t* rgb, size_t rgbLen) {
  // Vider les buffers (tout blanc)
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  // Nombre de pixels attendus
  const int totalPixels = IMG_W * IMG_H;   // 296×128 = 37888
  const int maxPixels   = (int)(rgbLen / 3);
  const int pixels      = min(totalPixels, maxPixels);

  for (int i = 0; i < pixels; i++) {
    uint8_t r = rgb[i * 3 + 0];
    uint8_t g = rgb[i * 3 + 1];
    uint8_t b = rgb[i * 3 + 2];

    uint8_t color = classifyPixel(r, g, b);
    if (color == 0) continue;   // blanc → rien à faire

    // Position dans l'image source (paysage 296×128)
    int col = i % IMG_W;   // 0..295
    int row = i / IMG_W;   // 0..127

    // ── Mapping vers le buffer driver (portrait EPD_WIDTH=128, EPD_HEIGHT=296)
    // Option A : rotation 90° sens horaire
    //   bufCol = (IMG_H - 1 - row)    → 0..127
    //   bufRow = col                   → 0..295
    // Option B : rotation 90° sens anti-horaire
    //   bufCol = row                   → 0..127
    //   bufRow = (IMG_W - 1 - col)    → 0..295
    //
    // Essaie A en premier. Si l'image est retournée, passe à B.
    // Si l'image est à l'endroit mais miroir, inverse juste un axe.

    // ── Option A (rotation 90° CW) ──────────────────────────────
    int bufCol = (IMG_H - 1 - row);   // 0..127
    int bufRow = col;                  // 0..295

    // ── Option B (rotation 90° CCW) — décommenter si besoin ────
    // int bufCol = row;
    // int bufRow = (IMG_W - 1 - col);

    // Position bit dans le buffer
    int byteX    = bufCol / 8;      // 0..15  (EPD_WIDTH/8 = 16)
    int bitInByte = 7 - (bufCol % 8);  // MSB-first

    if (color == 1) setPixelBuf(blackBuf, byteX, bufRow, bitInByte);
    else            setPixelBuf(redBuf,   byteX, bufRow, bitInByte);
  }
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  AFFICHAGE E-INK                                           ║
// ╚══════════════════════════════════════════════════════════════╝

bool refreshDisplay() {
  // Garde-fou : respecter le délai minimum
  if (lastRefreshMs > 0) {
    unsigned long elapsed = millis() - lastRefreshMs;
    if (elapsed < EINK_MIN_REFRESH_MS) {
      unsigned long wait = EINK_MIN_REFRESH_MS - elapsed;
      Serial.printf("[EINK] Délai minimum non atteint, attente %lu ms\n", wait);
      // On attend (bloquant) — pour le MVP c'est acceptable
      // En prod : mettre en queue non-bloquante
      delay(wait);
    }
  }

  Serial.println(F("[EINK] Init..."));
  if (epd.Init() != 0) {
    lastError = "epd.Init() failed";
    Serial.println(F("[EINK] INIT FAILED"));
    return false;
  }

  Serial.println(F("[EINK] Display..."));
  epd.Display(blackBuf, redBuf);

  Serial.println(F("[EINK] Sleep..."));
  epd.Sleep();

  lastRefreshMs = millis();
  framesReceived++;

  Serial.printf("[EINK] Refresh OK (#%lu)\n", framesReceived);
  return true;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  HELPERS HTTP                                               ║
// ╚══════════════════════════════════════════════════════════════╝

void setCORS() {
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

void sendJSON(int code, const String& json) {
  setCORS();
  server.send(code, "application/json", json);
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  HANDLERS HTTP                                              ║
// ╚══════════════════════════════════════════════════════════════╝

// ── GET /ping ────────────────────────────────────────────────────────────
void handlePing() {
  String ip = WiFi.localIP().toString();
  String json = "{\"ok\":true,\"screen\":\"eink29bwr\","
                "\"ip\":\"" + ip + "\","
                "\"frames\":" + String(framesReceived) + ","
                "\"heap\":" + String(ESP.getFreeHeap()) + "}";
  sendJSON(200, json);
  Serial.println(F("[HTTP] GET /ping → 200"));
}

// ── GET /status ──────────────────────────────────────────────────────────
void handleStatus() {
  unsigned long sinceRefresh = lastRefreshMs > 0 ? (millis() - lastRefreshMs) / 1000 : 0;
  String json = "{"
    "\"screen\":\"eink29bwr\","
    "\"frames\":" + String(framesReceived) + ","
    "\"lastRefreshSec\":" + String(sinceRefresh) + ","
    "\"heap\":" + String(ESP.getFreeHeap()) + ","
    "\"uptime\":" + String(millis() / 1000) + ","
    "\"lastError\":\"" + lastError + "\""
    "}";
  sendJSON(200, json);
}

// ── OPTIONS (CORS preflight) ─────────────────────────────────────────────
void handleOptions() {
  setCORS();
  server.send(204);
}

// ── POST /frame ──────────────────────────────────────────────────────────
//
// Flux de traitement :
//  1. Lire le body JSON (peut être volumineux !)
//  2. Parser JSON : {screen, data}
//  3. Décoder le base64 → octets RGB bruts
//  4. Convertir RGB → blackBuf + redBuf
//  5. Appeler refreshDisplay()
//
// ATTENTION MÉMOIRE :
//  L'image 296×128 RGB = 113664 octets bruts
//  Encodée en base64 = ~151552 caractères
//  + overhead JSON  ≈ 152000 octets
//  L'ESP8266 a 80KB RAM libre après le stack WiFi.
//  → On NE peut PAS charger tout le body en String.
//
//  SOLUTION : on lit le body en streaming et on décode
//  le base64 à la volée dans un buffer statique RGB partagé.
//  Le buffer RGB fait 113664 octets → trop grand pour la RAM !
//
//  SOLUTION FINALE (MVP) :
//  Réduire la résolution dans l'app Next.js à ce qui est
//  transmissible : on envoie les données déjà binarisées
//  (1 bit/pixel) depuis Next.js, pas du RGB.
//
//  FORMAT OPTIMISÉ :
//  {
//    "screen": "eink29bwr",
//    "black":  "<base64 de blackBuf : 4736 octets → ~6316 chars>",
//    "red":    "<base64 de redBuf   : 4736 octets → ~6316 chars>"
//  }
//  Total JSON ≈ 13000 caractères → CONFORTABLE pour l'ESP.
//
//  L'app Next.js fait la conversion couleur→1bit (on implémente ça côté JS).
//  L'ESP reçoit directement les buffers prêts à envoyer à l'écran.
//
// ─────────────────────────────────────────────────────────────────────────

// Buffer statique pour décoder les données base64 → buffers 1-bit
// On réutilise blackBuf/redBuf directement (4736 octets chacun)

void handleFrame() {
  setCORS();
  Serial.println(F("[HTTP] POST /frame reçu"));

  // ── 1. Lire le body ──────────────────────────────────────────
  if (!server.hasArg("plain") || server.arg("plain").length() == 0) {
    sendJSON(400, "{\"error\":\"No body\"}");
    return;
  }

  const String& body = server.arg("plain");
  Serial.printf("[HTTP] Body size: %u bytes\n", body.length());

  // ── 2. Parser JSON ───────────────────────────────────────────
  // On utilise un JsonDocument en mode streaming pour économiser la RAM
  // ArduinoJson v6 : DynamicJsonDocument
  // Taille du document : on a besoin de stocker 2 strings base64 ~6300 chars chacune
  // + overhead JSON. On alloue 16KB sur le tas.
  DynamicJsonDocument doc(16384);
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    lastError = String("JSON: ") + err.c_str();
    sendJSON(400, "{\"error\":\"JSON parse error: " + String(err.c_str()) + "\"}");
    Serial.println("[HTTP] JSON error: " + String(err.c_str()));
    return;
  }

  const char* screen    = doc["screen"];
  const char* blackB64  = doc["black"];
  const char* redB64    = doc["red"];

  if (!screen) {
    sendJSON(400, "{\"error\":\"Missing field: screen\"}");
    return;
  }
  if (!blackB64 || !redB64) {
    sendJSON(400, "{\"error\":\"Missing fields: black / red (expected pre-converted 1-bit buffers)\"}");
    return;
  }

  Serial.printf("[HTTP] screen=%s  black_b64_len=%u  red_b64_len=%u\n",
                screen, strlen(blackB64), strlen(redB64));

  // ── 3. Vérifier que c'est bien pour nous ─────────────────────
  if (strcmp(screen, "eink29bwr") != 0) {
    sendJSON(400, "{\"error\":\"Wrong screen type, expected eink29bwr\"}");
    return;
  }

  // ── 4. Décoder les buffers base64 → buffers 1-bit ────────────
  size_t blackLen = base64Decode(blackB64, strlen(blackB64), blackBuf, BUF_SIZE);
  size_t redLen   = base64Decode(redB64,   strlen(redB64),   redBuf,   BUF_SIZE);

  Serial.printf("[B64] black: %u octets  red: %u octets\n", blackLen, redLen);

  if (blackLen < BUF_SIZE / 2 || redLen < BUF_SIZE / 2) {
    // Données trop courtes — probablement une erreur d'encodage
    lastError = "Buffer too short after decode";
    sendJSON(400, "{\"error\":\"Decoded buffers too short\","
                  "\"blackLen\":" + String(blackLen) + ","
                  "\"redLen\":"   + String(redLen)   + ","
                  "\"expected\":" + String(BUF_SIZE)  + "}");
    return;
  }

  // ── 5. Afficher ───────────────────────────────────────────────
  Serial.println(F("[EINK] Lancement refresh..."));
  bool ok = refreshDisplay();

  if (ok) {
    lastError = "";
    sendJSON(200, "{\"ok\":true,\"frames\":" + String(framesReceived) + "}");
  } else {
    sendJSON(500, "{\"ok\":false,\"error\":\"" + lastError + "\"}");
  }
}

// ── 404 ──────────────────────────────────────────────────────────────────
void handleNotFound() {
  setCORS();
  server.send(404, "application/json", "{\"error\":\"Not found\"}");
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  SETUP                                                      ║
// ╚══════════════════════════════════════════════════════════════╝

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n\n╔══════════════════════════════╗"));
  Serial.println(F(  "║  ESP Canvas Receiver  v1.0   ║"));
  Serial.println(F(  "║  E-Ink 2.9\" BWR              ║"));
  Serial.println(F(  "╚══════════════════════════════╝\n"));

  // ── Mémoire dispo ─────────────────────────────────────────────
  Serial.printf("[MEM] Free heap: %u bytes\n", ESP.getFreeHeap());
  Serial.printf("[MEM] blackBuf: %u  redBuf: %u  total: %u bytes\n",
                (unsigned)sizeof(blackBuf), (unsigned)sizeof(redBuf),
                (unsigned)(sizeof(blackBuf) + sizeof(redBuf)));

  // ── Init buffers (tout blanc) inutile ca bousille l'ecran pour rien ─────────────────────────────────
  //memset(blackBuf, 0xFF, BUF_SIZE);
  //memset(redBuf,   0xFF, BUF_SIZE);

  // ── WiFi ──────────────────────────────────────────────────────
  Serial.printf("[WiFi] Connexion à %s ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (++attempt > 40) {
      // Timeout 20s — redémarrer
      Serial.println(F("\n[WiFi] TIMEOUT — reboot"));
      ESP.restart();
    }
  }

  Serial.println();
  Serial.println("[WiFi] Connecté !");
  Serial.printf("[WiFi] IP : %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("[WiFi] RSSI : %d dBm\n", WiFi.RSSI());

  // ── Init e-ink ────────────────────────────────────────────────
  Serial.println(F("[EINK] Init..."));
  if (epd.Init() != 0) {
    Serial.println(F("[EINK] INIT FAILED — check wiring:"));
    Serial.println(F("  SCK=D5  MOSI=D7  CS=D8  DC=D2  RST=D1  BUSY=D0"));
    // On n'arrête pas — le WiFi reste actif pour le diagnostic
    displayReady = false;
  } else {
    Serial.println(F("[EINK] Init OK"));

    Serial.println(F("[EINK] Prêt"));
    displayReady = true;
    lastRefreshMs = millis();
  }

  // ── Serveur HTTP ──────────────────────────────────────────────
  server.on("/ping",        HTTP_GET,     handlePing);
  server.on("/status",      HTTP_GET,     handleStatus);
  server.on("/frame",       HTTP_POST,    handleFrame);
  server.on("/frame",       HTTP_OPTIONS, handleOptions);
  server.on("/ping",        HTTP_OPTIONS, handleOptions);
  server.on("/status",      HTTP_OPTIONS, handleOptions);
  server.onNotFound(handleNotFound);

  server.begin();
  Serial.printf("[HTTP] Serveur démarré sur port %u\n", HTTP_PORT);
  Serial.println(F("──────────────────────────────────"));
  Serial.println("[READY] POST http://" + WiFi.localIP().toString() + "/frame");
  Serial.println("[READY] GET  http://" + WiFi.localIP().toString() + "/ping");
  Serial.println(F("──────────────────────────────────\n"));
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  LOOP                                                       ║
// ╚══════════════════════════════════════════════════════════════╝

void loop() {
  server.handleClient();

  // Yield pour éviter le watchdog reset sur ESP8266
  yield();
}
