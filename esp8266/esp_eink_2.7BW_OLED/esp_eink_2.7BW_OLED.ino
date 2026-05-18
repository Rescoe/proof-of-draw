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
// [0..31]    : clé privée (32 bytes)
// [32..63]   : blockHash courant (32 bytes ASCII)
// [64]       : keyGenerated flag
// [65..96]   : clé publique (32 bytes)
// [97]       : onboarding shown flag
// [98]       : OLED frame saved flag (0x5A = valide)
// [99..1122] : OLED frame buffer (1024 bytes)
// [1123..1202]: OLED ticker text sauvegardé (80 bytes, null-terminated)
#define EEPROM_SIZE            1210
#define EEPROM_PRIVKEY_OFF     0
#define EEPROM_BLOCKHASH_OFF   32
#define EEPROM_FLAG_OFF        64
#define EEPROM_PUBKEY_OFF      65
#define EEPROM_ONBOARDING_OFF  97
#define EEPROM_OLED_FLAG_OFF   98
#define EEPROM_OLED_BUF_OFF    99
#define EEPROM_OLED_TICK_OFF   (EEPROM_OLED_BUF_OFF + OLED_BUF_SIZE)  // 99+1024 = 1123
#define EEPROM_OLED_TICK_LEN   80
#define KEY_GENERATED_FLAG     0x01
#define ONBOARDING_SHOWN_FLAG  0x01
#define OLED_FRAME_SAVED_FLAG  0x5A

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

String pendingCandidateId     = "";
unsigned long lastPullMs      = 0;
unsigned long lastValidateMs  = 0;
unsigned long nextPullIntervalMs = PULL_INTERVAL;  // adapté par retryAfter serveur

// Clés
uint8_t privateKey[32];
uint8_t publicKey[32];
bool    keysLoaded = false;

// État chaîne
String currentBlockHash  = "";
int    currentBlockIndex = -1;

// ─── MÉTADONNÉES CARTEL ─────────────────────────────────────────────────────
// Lues depuis le JSON de /api/pull, appliquées lors du fetch frame
String pendingWorkTitle  = "";   // titre de l'œuvre (≤80 chars)
String pendingArtistName = "";   // nom de l'artiste (≤40 chars)
String pendingDisplayTs  = "";   // timestamp formaté "DD/MM HH:MM" (UTC)

// ─── REVALIDATION (Axe 3) ───────────────────────────────────────────────────
// Tâche d'observation envoyée par le serveur quand le device est idle.
// Contient les hashes des blocs à re-confirmer (JSON array stringifié).
// Aucun changement d'affichage — confirmation purement réseau.
String pendingObsHashes  = "";   // ex: ["abcd...","1234..."]
String pendingObsTarget  = "";   // hash du bloc cible (contient les entrées revalidated[])

// ─── TICKER OLED NON-BLOQUANT ────────────────────────────────────────────────
// Le buffer artwork est alloué une seule fois sur le heap et réutilisé.
// Le ticker tourne en boucle infinie via tickerStep() appelé dans loop().
// Quand un nouveau frame arrive, setOLEDFrame() remplace le contenu.
uint8_t*      oledArtBuf    = nullptr;   // buffer artwork persistant (OLED_BUF_SIZE)
String        oledTicker    = "";        // texte en cours de défilement
int           oledTickStep  = 0;         // position courante (px, 0 = texte à droite)
int           oledTickTotal = 0;         // OLED_WIDTH + textWidth = distance totale
bool          oledTickActive = false;    // ticker en cours ?
unsigned long lastTickMs    = 0;         // timestamp dernier pas (throttle 35ms)

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

// ─── Persistance frame OLED ────────────────────────────────────────────────
// Sauvegarde le buffer OLED (1024 bytes) + le texte du ticker
// afin de restaurer le dernier affichage après un redémarrage.
// Le E-ink n'en a pas besoin (rétention sans alimentation).

void saveOLEDFrameToEEPROM(const uint8_t* buf, const String& ticker) {
  Serial.println("[EEPROM] Sauvegarde frame OLED...");
  // Buffer pixel (1024 octets)
  for (int i = 0; i < OLED_BUF_SIZE; i++) {
    EEPROM.write(EEPROM_OLED_BUF_OFF + i, buf[i]);
    if (i % 128 == 0) yield();  // éviter watchdog sur longue boucle
  }
  // Ticker text (max EEPROM_OLED_TICK_LEN - 1 chars + '\0')
  int tlen = min((int)ticker.length(), EEPROM_OLED_TICK_LEN - 1);
  for (int i = 0; i < tlen; i++)
    EEPROM.write(EEPROM_OLED_TICK_OFF + i, (uint8_t)ticker.charAt(i));
  EEPROM.write(EEPROM_OLED_TICK_OFF + tlen, 0);  // null terminator
  // Flag en dernier (valide uniquement si écriture complète)
  EEPROM.write(EEPROM_OLED_FLAG_OFF, OLED_FRAME_SAVED_FLAG);
  EEPROM.commit();
  Serial.printf("[EEPROM] Frame OLED sauvegardée (%d bytes buf, ticker: \"%s\")\n",
                OLED_BUF_SIZE, ticker.c_str());
}

// Retourne true si une frame valide a été restaurée.
// buf doit pointer sur un buffer alloué de OLED_BUF_SIZE bytes.
// ticker est rempli avec le texte sauvegardé (vide si aucun).

bool loadOLEDFrameFromEEPROM(uint8_t* buf, String& ticker) {
  if (EEPROM.read(EEPROM_OLED_FLAG_OFF) != OLED_FRAME_SAVED_FLAG) {
    Serial.println("[EEPROM] Pas de frame OLED sauvegardée");
    return false;
  }
  for (int i = 0; i < OLED_BUF_SIZE; i++) {
    buf[i] = EEPROM.read(EEPROM_OLED_BUF_OFF + i);
    if (i % 128 == 0) yield();
  }
  ticker = "";
  for (int i = 0; i < EEPROM_OLED_TICK_LEN - 1; i++) {
    char c = (char)EEPROM.read(EEPROM_OLED_TICK_OFF + i);
    if (c == '\0') break;
    ticker += c;
  }
  Serial.printf("[EEPROM] Frame OLED restaurée — ticker: \"%s\"\n", ticker.c_str());
  return true;
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
// ─── BUS helpers ───────────────────────────────────────────────────────────

void activateSPI() {
  // Coupe I2C proprement (Wire.end() n'existe pas sur ESP8266
  // → on réinitialise Wire pour libérer les pins sans crash)
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

// ─── CARTEL E-INK ──────────────────────────────────────────────────────────
// Blanchit une bande horizontale dans le buffer E27 (remet les bytes à 0xFF).
// Le buffer E27 est organisé en rows de (E27_WIDTH/8) = 22 bytes.
// Un bit à 1 = blanc, un bit à 0 = noir (convention e-ink Waveshare).

void clearBandE27(uint8_t* buf, int yStart, int yEnd) {
  const int bytesPerRow = E27_WIDTH / 8;  // 22
  for (int y = yStart; y <= yEnd && y < E27_HEIGHT; y++) {
    memset(buf + y * bytesPerRow, 0xFF, bytesPerRow);
  }
}

// ─── FONCTIONS PAYSAGE (câble à gauche, rotation 90° sens horaire) ────────────
//
// Repères :
//   Portrait  : PW=176, PH=264 — tel que stocké dans le buffer
//   Paysage   : LW=264, LH=176 — tel que vu par l'utilisateur
//
// Transformation paysage→portrait : px=ly, py=(PH-1)-lx
//   soit : setPixelE27(buf, ly, E27_HEIGHT-1-lx)
//
// Caractère 5×7 en paysage (rotation 90° CW dans le buffer portrait) :
//   - lx : direction de lecture (gauche→droite en paysage) — avance de 6px/char (5 cols + gap)
//   - ly : hauteur du glyphe (haut→bas en paysage)          — 7px (7 rows du font)
//   - col du glyphe (0..4) → axe lx (lecture)
//   - row du glyphe (0..6) → axe ly (hauteur)

// Efface des colonnes portrait (= bandes horizontales en paysage)
void clearPortraitCols(uint8_t* buf, int pxStart, int pxEnd) {
  for (int px = pxStart; px <= pxEnd && px < E27_WIDTH; px++) {
    for (int py = 0; py < E27_HEIGHT; py++) {
      int xr = E27_WIDTH - 1 - px;
      int byteIdx = (xr / 8) + py * (E27_WIDTH / 8);
      buf[byteIdx] |= (0x80 >> (xr & 7));  // bit=1 = blanc
    }
  }
}

// Ligne séparatrice : colonne portrait noire = ligne horizontale en paysage
void drawLandscapeSepLine(uint8_t* buf, int portraitX) {
  for (int py = 0; py < E27_HEIGHT; py++)
    setPixelE27(buf, portraitX, py);
}

// Dessine un caractère lisible en paysage (rotation 90° CW appliquée au buffer portrait).
// Mapping : col du glyphe → direction lecture (lx), row du glyphe → hauteur (ly).
// paysage(lx+col, ly+row) → portrait : px = ly+row, py = (PH-1) - (lx+col)
void drawCharE27_landscape(uint8_t* buf, int lx, int ly, char c, int scale = 1) {
  int idx = charIndex(c);
  for (int col = 0; col < 5; col++) {
    uint8_t bits = pgm_read_byte(&FONT_5x7[idx][col]);
    for (int row = 0; row < 7; row++) {
      if (bits & (0x40 >> row)) {
        for (int s1 = 0; s1 < scale; s1++)
          for (int s2 = 0; s2 < scale; s2++) {
            int lx_px = lx + col * scale + s1;  // cols  → lx (direction de lecture) ✓
            int ly_px = ly + row * scale + s2;  // rows  → ly (hauteur du glyphe)    ✓
            // Paysage → portrait : px = ly_px, py = (PH-1) - lx_px
            setPixelE27(buf, ly_px, E27_HEIGHT - 1 - lx_px);
          }
      }
    }
  }
}

void drawTextE27_landscape(uint8_t* buf, int lx, int ly, const String& text, int scale = 1) {
  int cx = lx;
  for (unsigned int i = 0; i < text.length(); i++) {
    drawCharE27_landscape(buf, cx, ly, text.charAt(i), scale);
    cx += 6 * scale;  // 5px de large (cols) + 1px gap dans la direction de lecture
    yield();
  }
}

int textWidthE27_landscape(const String& text, int scale = 1) {
  return (int)text.length() * 6 * scale;
}

// Brûle un cartel PAYSAGE dans le buffer E27 :
//   - Bande SUPÉRIEURE paysage (ly=0..BAND-1 = portrait cols gauches)  : timestamp + bloc
//   - Bande INFÉRIEURE paysage (ly=LH-BAND..LH-1 = portrait cols droites) : artiste + titre
//
// Les bandes couvrent ~13px sur chaque bord paysage (top/bottom).
// L'artwork est légèrement rogné mais la composition reste lisible.

void burnEinkCartel_landscape(uint8_t* buf,
                               const String& workTitle,
                               const String& artistName,
                               const String& ts,
                               int blockIndex = -1) {
  if (!buf) return;
  const int BAND = 13;    // largeur en paysage-Y (= colonnes portrait)
  // LH = E27_WIDTH = 176 (hauteur paysage = largeur portrait)
  // LW = E27_HEIGHT = 264 (largeur paysage = hauteur portrait)

  // ── Bande supérieure paysage : portrait cols [0..BAND-1] ─────────────────
  clearPortraitCols(buf, 0, BAND - 1);
  drawLandscapeSepLine(buf, BAND - 1);  // séparateur à ly=BAND-1

  // Texte : timestamp + numéro de bloc
  String topLine = ts.length() > 0 ? ts : "PROOF-OF-DRAW";
  if (blockIndex >= 0) topLine += " Block #" + String(blockIndex);
  // Tronquer si trop large (LW=264)
  while (topLine.length() > 0 && textWidthE27_landscape(topLine, 1) > E27_HEIGHT - 4)
    topLine.remove(topLine.length() - 1);
  // Centrage en lx (LW=E27_HEIGHT=264)
  int topLx = max(0, (E27_HEIGHT - textWidthE27_landscape(topLine, 1)) / 2);
  // Position ly : 2px de marge depuis le bord (ly=2, glyphe 7px → s'étend jusqu'à ly=8)
  drawTextE27_landscape(buf, topLx, 2, topLine, 1);

  // ── Bande inférieure paysage : portrait cols [E27_WIDTH-BAND..E27_WIDTH-1] ──
  int botPxStart = E27_WIDTH - BAND;  // 163
  clearPortraitCols(buf, botPxStart, E27_WIDTH - 1);
  drawLandscapeSepLine(buf, botPxStart);  // séparateur à ly=163

  String botLine;
  if (artistName.length() > 0 && workTitle.length() > 0)
    botLine = artistName + " - " + workTitle;
  else if (artistName.length() > 0)
    botLine = artistName;
  else if (workTitle.length() > 0)
    botLine = workTitle;

  while (botLine.length() > 0 && textWidthE27_landscape(botLine, 1) > E27_HEIGHT - 4)
    botLine.remove(botLine.length() - 1);

  int botLx  = max(0, (E27_HEIGHT - textWidthE27_landscape(botLine, 1)) / 2);
  // Position ly : 2px au-dessus du séparateur (botPxStart+2 = 165)
  drawTextE27_landscape(buf, botLx, botPxStart + 2, botLine, 1);
}

// Brûle un cartel fixe dans le buffer E27 (mode portrait, conservé pour référence) :
//   - Bande haute  (13px) : displayTs (horodatage)
//   - Bande basse  (13px) : artistName + " · " + workTitle (tronqué)
// Les bandes recouvrent le bord de l'artwork — pas de redimensionnement du canvas.

// blockIndex : numéro du bloc courant (-1 = absent)
void burnEinkCartel(uint8_t* buf,
                    const String& workTitle,
                    const String& artistName,
                    const String& ts,
                    int blockIndex = -1) {
  if (!buf) return;
  const int BAND = 13;  // hauteur de chaque bande en pixels

  // ── Bande supérieure : timestamp + numéro de bloc ─────────────────────────
  clearBandE27(buf, 0, BAND - 1);
  // Ligne de séparation : dernière ligne de la bande (pixels noirs)
  for (int x = 0; x < E27_WIDTH; x++) setPixelE27(buf, x, BAND - 1);
  // Texte : "DD/MM HH:MM  #N" (centré), fallback "PROOF-OF-DRAW"
  String topLine = ts.length() > 0 ? ts : "PROOF-OF-DRAW";
  if (blockIndex >= 0) topLine += "  #" + String(blockIndex);
  // Si trop long, on tronque le timestamp pour garder le numéro de bloc
  while (topLine.length() > 0 && textWidthE27(topLine, 1) > E27_WIDTH - 4) {
    topLine.remove(topLine.length() - 1);
  }
  int topX = max(0, (E27_WIDTH - textWidthE27(topLine, 1)) / 2);
  drawTextE27(buf, topX, 2, topLine, 1);

  // ── Bande inférieure : artiste + titre ────────────────────────────────────
  int botBandY = E27_HEIGHT - BAND;
  clearBandE27(buf, botBandY, E27_HEIGHT - 1);
  // Ligne de séparation en haut de la bande
  for (int x = 0; x < E27_WIDTH; x++) setPixelE27(buf, x, botBandY);

  String botLine;
  if (artistName.length() > 0 && workTitle.length() > 0)
    botLine = artistName + " \xB7 " + workTitle;  // "·" latin-1
  else if (artistName.length() > 0)
    botLine = artistName;
  else if (workTitle.length() > 0)
    botLine = workTitle;
  else
    botLine = "";

  // Tronquer si trop long pour la largeur de l'écran
  while (botLine.length() > 0 && textWidthE27(botLine, 1) > E27_WIDTH - 4) {
    botLine.remove(botLine.length() - 1);
  }
  if (botLine.length() == 0 && workTitle.length() > 0) {
    botLine = workTitle.substring(0, min((int)workTitle.length(), 26));
  }
  int botX = max(0, (E27_WIDTH - textWidthE27(botLine, 1)) / 2);
  drawTextE27(buf, botX, botBandY + 2, botLine, 1);
}

// ─── OLED ──────────────────────────────────────────────────────────────────

bool ensureOLEDReady() {
  // Force toujours Wire sur les bons pins avant toute opération OLED
  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(100000);
  delay(10);

  if (oledReady) return true;

  oledReady = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!oledReady) {
    Serial.println("[OLED] init failed");
    return false;
  }
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

  // Si on vient du SPI, on coupe SPI proprement avant de toucher I2C
  if (lastScreenWasSPI) {
    SPI.endTransaction();
    SPI.end();
    delay(50);  // laisse le bus se stabiliser
    lastScreenWasSPI = false;
  }

  // Réinitialise Wire sur les bons pins dans tous les cas
  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(100000);
  delay(20);

  // Re-init du contrôleur SSD1306
  // Nécessaire si on a coupé l'alimentation ou switché le bus
  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("[OLED] begin() failed");
    oledReady = false;
    return false;
  }
  oledReady = true;
  delay(10);  // laisse le SSD1306 finir son init interne

  // Copie le buffer et envoie
  memcpy(oled.getBuffer(), buf, OLED_BUF_SIZE);
  oled.display();

  Serial.println("[OLED] displayed");
  return true;
}


// ─── TICKER OLED NON-BLOQUANT ────────────────────────────────────────────────
//
// setOLEDFrame() : enregistre un nouveau frame artwork + ticker.
//   Alloue oledArtBuf une seule fois ; les appels suivants réutilisent le slot.
//   Réinitialise le scroll à 0 (le texte repart de la droite).
//
// tickerStep() : avance d'un pas (2px) si 35ms se sont écoulées.
//   Appelé dans loop() — non-bloquant, rend la main immédiatement.
//   Boucle infinie : quand le texte sort à gauche, il revient à droite.

void setOLEDFrame(const uint8_t* artBuf, const String& ticker) {
  if (!artBuf) return;

  // Allouer le buffer global la première fois
  if (!oledArtBuf) {
    oledArtBuf = (uint8_t*)malloc(OLED_BUF_SIZE);
    if (!oledArtBuf) {
      Serial.println("[TICKER] malloc oledArtBuf failed");
      return;
    }
  }
  memcpy(oledArtBuf, artBuf, OLED_BUF_SIZE);

  oledTicker   = ticker;
  oledTickStep = 0;
  // 6px/char (police Adafruit 1×) ; texte doit traverser écran + sa propre largeur
  const int CHAR_W = 6;
  oledTickTotal    = OLED_WIDTH + (int)ticker.length() * CHAR_W;
  oledTickActive   = (ticker.length() > 0);

  Serial.printf("[TICKER] setOLEDFrame ticker=\"%s\" total=%d\n",
                ticker.c_str(), oledTickTotal);
}

void tickerStep() {
  if (!oledTickActive || !oledArtBuf || oledTicker.length() == 0) return;

  unsigned long now = millis();
  if (now - lastTickMs < 60) return;  // ~16 fps — vitesse réduite pour lisibilité
  lastTickMs = now;

  // ── Réinitialisation bus si on vient du SPI (E-ink) ──────────────────────
  if (lastScreenWasSPI) {
    SPI.endTransaction();
    SPI.end();
    delay(20);
    Wire.begin(OLED_SDA, OLED_SCL);
    Wire.setClock(100000);
    delay(10);
    if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) return;
    oledReady = true;
    lastScreenWasSPI = false;
  } else if (!oledReady) {
    Wire.begin(OLED_SDA, OLED_SCL);
    Wire.setClock(100000);
    delay(10);
    if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) return;
    oledReady = true;
  }

  // ── Rendu du pas courant ──────────────────────────────────────────────────
  memcpy(oled.getBuffer(), oledArtBuf, OLED_BUF_SIZE);
  // Page 0 = octets [0..127] = 8 premières lignes → fond noir pour le ticker
  memset(oled.getBuffer(), 0x00, OLED_WIDTH);
  oled.setTextWrap(false);
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor((int16_t)(OLED_WIDTH - oledTickStep), 0);
  oled.print(oledTicker);
  oled.display();

  // ── Avance + boucle infinie ───────────────────────────────────────────────
  oledTickStep += 2;
  if (oledTickStep > oledTickTotal) {
    oledTickStep = 0;  // le texte repart de la droite
  }
}

// ─── E27 DISPLAY ───────────────────────────────────────────────────────────
bool initE27ForRefresh() {
  unsigned long elapsed = millis() - lastE27RefreshMs;
  if (elapsed < E27_MIN_REFRESH_MS) {
    unsigned long wait = E27_MIN_REFRESH_MS - elapsed;
    Serial.printf("[E27] attente refresh %lums\n", wait);
    delay(wait);
  }

  activateSPI();  // lastScreenWasSPI = true ici

  if (epd27.Init() != 0) {
    Serial.println("[E27] Init failed");
    SPI.endTransaction();
    SPI.end();
    lastScreenWasSPI = false;
    return false;
  }
  return true;
}

bool displayE27Buffer(const uint8_t* buf) {
  if (!buf) return false;
  if (!initE27ForRefresh()) return false;

  epd27.Display(buf);
  epd27.Sleep();

  SPI.endTransaction();
  SPI.end();
  lastScreenWasSPI = false;  // libère SPI après chaque usage E27

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

  // ── Composition du ticker ────────────────────────────────────────────────────
  // Format : "TITRE  |  ARTISTE  #N  DD/MM HH:MM"
  // Toujours calculé même si certains champs sont vides.
  {
    String ticker = "";
    if (pendingWorkTitle.length() > 0)
      ticker += pendingWorkTitle;
    if (pendingArtistName.length() > 0)
      ticker += (ticker.length() > 0 ? "  |  " : "") + pendingArtistName;
    if (currentBlockIndex >= 0)
      ticker += "  Block #" + String(currentBlockIndex);
    if (pendingDisplayTs.length() > 0)
      ticker += "  " + pendingDisplayTs;

    Serial.println("[TICKER] " + (ticker.length() > 0 ? ticker : "(vide)"));

    // Démarre le ticker non-bloquant (boucle infinie dans loop())
    setOLEDFrame(oledBuf, ticker);

    // Persistance EEPROM : sauvegarde frame + ticker pour restauration boot
    saveOLEDFrameToEEPROM(oledBuf, ticker);
  }

  free(oledBuf);  // le buffer local est libéré ; oledArtBuf (global) garde sa copie

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

  // ── Cartel e-ink PAYSAGE (câble à gauche) : brûler AVANT l'affichage ────────
  // Bande supérieure paysage : timestamp + "Block #N"
  // Bande inférieure paysage : artiste - titre
  // Texte rotationné 90° sens horaire pour être lisible en paysage.
  if (pendingWorkTitle.length() > 0 || pendingArtistName.length() > 0
      || pendingDisplayTs.length() > 0 || currentBlockIndex >= 0) {
    Serial.printf("[E27] Cartel landscape: ts=%s artist=%s title=%s bloc=%d\n",
                  pendingDisplayTs.c_str(), pendingArtistName.c_str(),
                  pendingWorkTitle.c_str(), currentBlockIndex);
    burnEinkCartel_landscape(e27Buf, pendingWorkTitle, pendingArtistName,
                             pendingDisplayTs, currentBlockIndex);
  }

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
  int    pullRetryAfter = 60;  // valeur par défaut, remplacée par doc["retryAfter"]

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

    // Doc étendu : inclut workTitle (≤80) + drawArtistName (≤40) + displayTs (≤12)
    DynamicJsonDocument doc(2048);
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
    pullRetryAfter = doc["retryAfter"]  | 60;
    if (pullRetryAfter <= 0) pullRetryAfter = 60;

    // ── Métadonnées cartel (à la racine, plus fiable que doc["frame"]) ─────────
    // Le serveur expose cartelMeta{workTitle, drawArtistName, displayTs, blockIndex}
    // indépendamment du chemin de validation.
    {
      JsonObject cm = doc["cartelMeta"];
      if (!cm.isNull()) {
        const char* wt = cm["workTitle"]      | "";
        const char* an = cm["drawArtistName"] | "";
        const char* dt = cm["displayTs"]      | "";
        int         bi = cm["blockIndex"]     | -1;
        if (strlen(wt) > 0) { pendingWorkTitle  = String(wt); pendingWorkTitle.trim(); }
        else                   pendingWorkTitle  = "";
        if (strlen(an) > 0) { pendingArtistName = String(an); pendingArtistName.trim(); }
        else                   pendingArtistName = "";
        if (strlen(dt) > 0)    pendingDisplayTs  = String(dt);
        if (bi >= 0)           currentBlockIndex = bi;
        Serial.printf("[PULL] cartel: title=%s artist=%s ts=%s bloc=%d\n",
                      wt, an, dt, bi);
      }
    }

    // Fallback frame{} pour les champs frameId/screen si absents à la racine
    if (newFrameId.length() == 0) {
      JsonObject frameObj = doc["frame"];
      if (!frameObj.isNull()) {
        newFrameId = frameObj["frameId"] | "";
        newScreen  = frameObj["screen"]  | "";
      }
    }

    // ── Tâche d'observation (revalidation de blocs antérieurs) ────────────────
    // Uniquement quand le device est idle (le serveur ne peuple ce champ que dans ce cas).
    // L'ESP ne change PAS son affichage — il confirme juste la présence des blocs.
    {
      JsonObject obs = doc["pendingObservation"];
      if (!obs.isNull()) {
        JsonArray hashes = obs["blockHashes"].as<JsonArray>();
        if (hashes.size() > 0) {
          String hashArr = "[";
          for (size_t i = 0; i < hashes.size(); i++) {
            if (i > 0) hashArr += ",";
            const char* h = hashes[i] | "";
            hashArr += "\"";
            hashArr += h;
            hashArr += "\"";
          }
          hashArr += "]";
          pendingObsHashes = hashArr;
          // targetBlockHash : identifie le bloc qui contient les entrées revalidated[]
          const char* tgt = obs["targetBlockHash"] | "";
          pendingObsTarget = String(tgt);
          Serial.println("[PULL] Tâche obs hashes: " + pendingObsHashes);
          if (pendingObsTarget.length() > 0)
            Serial.println("[PULL] Tâche obs target: " + pendingObsTarget.substring(0, 12) + "...");
        }
      }
    }
  }
  // TLS fermé

  // Ajuste l'intervalle de pull selon l'activité réseau signalée par le serveur
  if (newFrameSource == "none" && newCandId.length() == 0) {
    // Réseau idle → on respecte le retryAfter du serveur (typiquement 300s)
    nextPullIntervalMs = (unsigned long)pullRetryAfter * 1000UL;
  } else {
    // Activité détectée (frame ou candidat) → retour au rythme nominal
    nextPullIntervalMs = PULL_INTERVAL;
  }
  Serial.printf("[PULL] nextInterval=%lus (retryAfter=%d)\n",
                nextPullIntervalMs / 1000UL, pullRetryAfter);

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



// ─── OBS-CONFIRM (Axe 3 : revalidation de blocs antérieurs) ───────────────
// Envoie la confirmation que cet ESP a "observé" les blocs de la tâche reçue.
// Aucun changement d'affichage : uniquement une requête POST vers le serveur.
bool doObsConfirm() {
  if (pendingObsHashes.length() == 0) return true;

  Serial.println("[OBS] Confirmation observation: " + pendingObsHashes);

  // Inclure targetBlockHash pour que le serveur retrouve le bon bloc
  // sans avoir à chercher dans toute la chaîne
  String body = "{\"deviceId\":\"" + deviceId
              + "\",\"blockHashes\":" + pendingObsHashes;
  if (pendingObsTarget.length() == 64) {  // hash valide = 64 chars hex
    body += ",\"targetBlockHash\":\"" + pendingObsTarget + "\"";
  }
  body += "}";

  String resp;
  bool ok = httpPost("/api/obs-confirm", body, resp);

  Serial.printf("[OBS] confirm → %s resp: %s\n", ok ? "OK" : "FAIL", resp.c_str());
  pendingObsHashes = "";   // toujours vider, même en cas d'échec
  pendingObsTarget = "";
  return ok;
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

    // ── Restauration EEPROM : affiche la dernière frame OLED avant le pull ──────
    // Permet de revoir le dernier dessin immédiatement après redémarrage,
    // sans attendre le prochain cycle pull (WiFi + serveur).
    // setOLEDFrame() démarre le ticker non-bloquant (boucle via loop()).
    {
      uint8_t* savedBuf = (uint8_t*)malloc(OLED_BUF_SIZE);
      if (savedBuf) {
        String savedTicker = "";
        if (loadOLEDFrameFromEEPROM(savedBuf, savedTicker)) {
          Serial.println("[BOOT] Restauration frame OLED depuis EEPROM");
          displayOLED(savedBuf, OLED_BUF_SIZE);     // affichage immédiat
          setOLEDFrame(savedBuf, savedTicker);       // démarre le ticker infini
        }
        free(savedBuf);  // local freed ; setOLEDFrame a copié dans oledArtBuf
      } else {
        Serial.println("[BOOT] malloc EEPROM restore échoué — skip");
      }
    }

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

  // ── Ticker OLED non-bloquant ─────────────────────────────────────────────
  // Appelé à chaque tour, avance d'un pas seulement si 35ms se sont écoulées.
  // Boucle infinie : le texte revient à droite après être sorti à gauche.
  tickerStep();

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
  if (now - lastPullMs >= nextPullIntervalMs) {
    String prevCandidateId = pendingCandidateId;
    doPull();
    lastPullMs = millis();

    if (pendingCandidateId.length() > 0 && pendingCandidateId != prevCandidateId) {
      Serial.println("[LOOP] Nouveau candidat, reset timer validation");
      lastValidateMs = millis();
    }
  }

  // ── Observation (revalidation blocs) ──
  // Dépend uniquement de la présence d'une tâche obs — pas de timer
  if (pendingObsHashes.length() > 0) {
    doObsConfirm();
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

  // Pas de delay fixe ici : tickerStep() gère son propre throttle (35ms).
  // Un yield() suffit pour nourrir le watchdog ESP8266 entre les tours de boucle.
  yield();
}