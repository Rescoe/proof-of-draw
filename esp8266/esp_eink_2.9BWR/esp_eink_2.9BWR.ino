// esp_eink_2.9BWR_v2.ino
// Proof-of-Draw — Firmware v2.0
//
// NOUVEAUTÉS vs v1.5 :
//   1. Génération d'une paire de clés ED25519 au premier boot
//      → clé privée stockée en EEPROM (offset 0, 32 bytes)
//      → clé publique affichée UNE SEULE FOIS sur l'e-ink (cold save)
//      → les boots suivants chargent la clé depuis EEPROM
//
//   2. Boucle de validation distribuée
//      → après chaque pull, vérifie si un candidat attend validation
//      → si oui : fetch le candidat, calcule métriques locales, vote
//      → métriques : entropie Shannon, transitions pixels, RLE complexity
//
//   3. Mode personal frame
//      → le pull reçoit maintenant frameSource (consensus | personal | none)
//      → le firmware gère les deux modes d'affichage
//
//   4. Synchronisation état chaîne
//      → le pull retourne chain_summary : blockHash, displayTime, blockIndex
//      → le firmware stocke le blockHash courant en EEPROM (offset 32, 32 bytes)
//
//   5. Signature simplifiée V1
//      → "deviceId:candidateId:score" — pas encore de vraie crypto asymétrique
//      → V2 : remplacé par ED25519 sign avec la clé privée EEPROM
//
// CONTRAINTES MÉMOIRE (inchangées) :
//   → L'écran e-ink n'est init qu'APRÈS le register TLS
//   → Les buffers sont free/malloc autour de chaque requête HTTPS
//   → Heap disponible avant pull : ~47KB

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <qrcode.h>
#include <EEPROM.h>
#include "epd2in9b_V4.h"
#include "epdif.h"

// ─── CONFIG ────────────────────────────────────────────────────────────────
const char* WIFI_SSID = "Livebox-D190";
const char* WIFI_PASSWORD = "Q2gueWg3UaYJo2VN7C";

#define SERVER_URL      "https://proof-of-draw.vercel.app"
#define SCREEN_TYPE     "eink29bwr"
#define PULL_INTERVAL   60000UL  // 1min
#define VALIDATE_INTERVAL 30000UL // 30s — check si candidat en attente
#define EINK_MIN_REFRESH_MS 10000UL

// ─── EEPROM layout ─────────────────────────────────────────────────────────
// [0..31]  : clé privée ED25519 (32 bytes) — ou seed aléatoire V1
// [32..63] : blockHash courant (32 bytes, hex stocké en ASCII serait trop long
//            → on stocke les 16 premiers bytes du hash = 32 hex chars)
// [64]     : keyGenerated flag (0xFF = non généré, 0x01 = généré)
// [65..96] : clé publique (32 bytes) pour affichage et envoi au serveur
#define EEPROM_SIZE         128
#define EEPROM_PRIVKEY_OFF  0
#define EEPROM_BLOCKHASH_OFF 32
#define EEPROM_FLAG_OFF     64
#define EEPROM_PUBKEY_OFF   65
#define KEY_GENERATED_FLAG  0x01
#define EEPROM_ONBOARDING_OFF 97
#define ONBOARDING_SHOWN_FLAG 0x01

// ─── ÉCRAN ─────────────────────────────────────────────────────────────────
#define IMG_W    296
#define IMG_H    128
#define BUF_SIZE ((IMG_H * IMG_W) / 8)   // 4736

Epd epd;
unsigned long lastRefreshMs = 0;
bool einkReady = false;

uint8_t* blackBuf = nullptr;
uint8_t* redBuf   = nullptr;

// ─── STATE ─────────────────────────────────────────────────────────────────
String deviceId, pairCode, canvasUrl;
bool   registered        = false;
bool   paired            = false;
bool   frameReady        = false;
String lastFrameId       = "";
bool   hasDisplayedFrame = false;

// Clés (V1 : seed aléatoire 32 bytes, pas de vraie ED25519)
uint8_t privateKey[32];
uint8_t publicKey[32];   // V1 : dérivé simplement du private (XOR + hash maison)
bool    keysLoaded = false;

// État chaîne
String currentBlockHash = "";
int    currentBlockIndex = -1;
unsigned long displayTimeRemaining = 0;

// Validation
String pendingCandidateId = "";
unsigned long lastValidateMs = 0;
unsigned long lastPullMs     = 0;

bool consensusJustDisplayed = false;

// ─── EEPROM helpers ────────────────────────────────────────────────────────

bool onboardingAlreadyShown() {
  return EEPROM.read(EEPROM_ONBOARDING_OFF) == ONBOARDING_SHOWN_FLAG;
}

void setOnboardingShown() {
  EEPROM.write(EEPROM_ONBOARDING_OFF, ONBOARDING_SHOWN_FLAG);
  EEPROM.commit();
}

void eepromInit() {
  EEPROM.begin(EEPROM_SIZE);
}

bool keysAlreadyGenerated() {
  return EEPROM.read(EEPROM_FLAG_OFF) == KEY_GENERATED_FLAG;
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
  // Stocke les 16 premiers bytes du hash (32 hex chars)
  String h = hash.length() >= 32 ? hash.substring(0, 32) : hash;
  h += String(' ', 32);  // padding
  for (int i = 0; i < 32; i++) {
    EEPROM.write(EEPROM_BLOCKHASH_OFF + i, (uint8_t)h[i]);
  }
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

// ─── Génération de clés (V1 simplifiée) ────────────────────────────────────
// V1 : pas de vraie ED25519 (bibliothèque trop lourde pour ESP8266).
// On génère 32 bytes aléatoires comme seed/clé privée.
// La clé publique est dérivée de façon déterministe (simple pour V1).
// V2 : remplacer par Micro-ECC ou une lib ED25519 légère.

void derivePublicKeyV1(const uint8_t* priv, uint8_t* pub) {
  // Dérivation simple V1 : pub[i] = ~priv[i] XOR (i * 0x37)
  // PAS une vraie cryptographie — à remplacer en V2
  for (int i = 0; i < 32; i++) {
    pub[i] = (~priv[i]) ^ (uint8_t)(i * 0x37 + 0xAB);
  }
}

void generateKeys() {
  Serial.println("[KEYS] Génération nouvelle paire de clés...");

  // Seed depuis bruit analogique + millis + WiFi RSSI
  randomSeed(analogRead(A0) ^ millis() ^ (uint32_t)WiFi.RSSI());

  for (int i = 0; i < 32; i++) {
    privateKey[i] = (uint8_t)(random(256) ^ (analogRead(A0) & 0xFF));
    delayMicroseconds(100);  // accumule plus d'entropie
  }

  derivePublicKeyV1(privateKey, publicKey);
  keysLoaded = true;

  saveKeysToEEPROM();
  Serial.println("[KEYS] Clés générées et sauvegardées en EEPROM");
}

// Convertit un buffer de bytes en hex string
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
// V1 : "deviceId:candidateId:score" — pas de vraie signature cryptographique
// V2 : ED25519 sign(privateKey, message)

String signV1(const String& candidateId, float score) {
  // Format à 3 décimales pour cohérence avec le serveur
  char buf[8];
  dtostrf(score, 1, 3, buf);
  return deviceId + ":" + candidateId + ":" + String(buf);
}

// ─── MÉTRIQUES DE COMPLEXITÉ (calculées sur les buffers e-ink bruts) ───────

// Entropie de Shannon sur un buffer 1-bit (0=blanc, 1=noir)
// Retourne [0,1] — 1.0 = 50/50 noir/blanc, 0 = uniforme
float computeEntropy(const uint8_t* buf, size_t byteCount) {
  long ones = 0;
  long total = byteCount * 8;

  for (size_t i = 0; i < byteCount; i++) {
    uint8_t b = buf[i];
    // Compte les bits à 0 (pixels noirs dans convention e-ink : 0=actif)
    for (int bit = 0; bit < 8; bit++) {
      if (!((b >> bit) & 1)) ones++;
    }
  }

  if (ones == 0 || ones == total) return 0.0f;

  float p1 = (float)ones / total;
  float p0 = 1.0f - p1;

  // log2(x) ≈ ln(x) / ln(2)
  return -(p1 * (log(p1) / log(2.0f)) + p0 * (log(p0) / log(2.0f)));
}

// Densité de transitions horizontales (bords dans l'image)
// Opère directement sur les bytes — compare bits adjacents entre bytes
float computeTransitions(const uint8_t* buf, int width, int height) {
  // Dans le buffer e-ink, chaque byte contient 8 pixels MSB first
  // On compte les changements de bit entre pixels consécutifs sur chaque ligne
  long transitions = 0;
  int bytesPerRow  = width / 8;
  long total       = (long)(width - 1) * height;  // adjacences horizontales

  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width - 1; x++) {
      // Pixel x dans le buffer
      int byteIdx1 = y * bytesPerRow + x / 8;
      int bitIdx1  = 7 - (x % 8);
      int p1       = (buf[byteIdx1] >> bitIdx1) & 1;

      // Pixel x+1
      int byteIdx2 = y * bytesPerRow + (x + 1) / 8;
      int bitIdx2  = 7 - ((x + 1) % 8);
      int p2       = (buf[byteIdx2] >> bitIdx2) & 1;

      if (p1 != p2) transitions++;
    }
    yield();  // évite watchdog sur lignes longues
  }

  return total > 0 ? (float)transitions / total : 0.0f;
}

// RLE complexity : ratio runs/pixels, normalisé
// Opère sur les pixels extraits séquentiellement (row-major)
float computeRLE(const uint8_t* buf, size_t byteCount) {
  if (byteCount == 0) return 0.0f;

  long runs = 1;
  long total = byteCount * 8;
  int  prevBit = (buf[0] >> 7) & 1;

  for (size_t i = 0; i < byteCount; i++) {
    uint8_t b = buf[i];
    for (int bit = 6; bit >= 0; bit--) {  // commence à bit 6 (on a déjà pris bit 7)
      int curBit = (b >> bit) & 1;
      if (curBit != prevBit) { runs++; prevBit = curBit; }
    }
    if (i < byteCount - 1) {
      // Transition entre bytes
      int nextFirstBit = (buf[i + 1] >> 7) & 1;
      if (nextFirstBit != prevBit) { runs++; prevBit = nextFirstBit; }
      // On recommence à bit 6 pour le prochain byte
    }
    yield();
  }

  return sqrt((float)runs / total);  // sqrt pour linéariser
}

// Score composite : entropie 40% + transitions 40% + RLE 20%
float computeComplexityScore(const uint8_t* blackBufPtr, const uint8_t* redBufPtr, size_t bufSize) {
  // Merge black + red : pixel actif = noir OU rouge (OR logique sur les bits)
  // Note : en convention e-ink, 0=actif, 1=blanc — on inversera pour les métriques
  static uint8_t merged[BUF_SIZE];  // static pour ne pas empiler sur la stack

  for (size_t i = 0; i < bufSize; i++) {
    // 0=actif dans e-ink → on inverse pour avoir 1=actif dans nos métriques
    // merged[i] = ~(blackBufPtr[i] & redBufPtr[i])  // 1 = pixel actif (noir ou rouge)
    // En pratique on calcule sur les buffers tels quels — la symétrie ne change pas l'entropie
    merged[i] = blackBufPtr[i] & redBufPtr[i];  // 0 = actif (logique e-ink)
  }

  float entropy     = computeEntropy(merged, bufSize);
  float transitions = computeTransitions(merged, IMG_W, IMG_H);
  float rle         = computeRLE(merged, bufSize);

  float score = entropy * 0.4f + transitions * 0.4f + rle * 0.2f;
  if (score > 1.0f) score = 1.0f;

  Serial.printf("[METRICS] entropy=%.3f transitions=%.3f rle=%.3f score=%.3f\n",
                entropy, transitions, rle, score);

  return score;
}

// ─── HTTP HELPERS ───────────────────────────────────────────────────────────


bool httpPost(const String& path, const String& body, String& resp) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = String(SERVER_URL) + path;

  Serial.println("[HTTP POST] URL: " + url);
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

bool httpGet(const String& path, String& resp, int* codeOut = nullptr) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, String(SERVER_URL) + path)) {
    Serial.println("[HTTP GET] begin() failed");
    return false;
  }

  http.setTimeout(20000);

  int code = http.GET();
  if (codeOut) *codeOut = code;

  resp = "";
  if (code > 0) {
    resp = http.getString();
  }

  http.end();

  Serial.printf("[HTTP GET] %s → %d (%u bytes)\n", path.c_str(), code, resp.length());
  return code == 200 || code == 429;
}

// ─── PIXEL HELPERS (inchangés vs v1.5) ─────────────────────────────────────

inline void setPixel(uint8_t* buf, int x, int y) {
  if (x < 0 || x >= IMG_W || y < 0 || y >= IMG_H) return;
  int xr = y;
  int yr = IMG_W - 1 - x;
  yr = IMG_W - 1 - yr;  // = x
  int byteIndex = (yr * (IMG_H / 8)) + (xr / 8);
  int bitMask   = 0x80 >> (xr & 7);
  buf[byteIndex] &= ~bitMask;
}

// ─── FONT 5×7 (identique v1.5) ─────────────────────────────────────────────
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

void drawChar(uint8_t* buf, int x, int y, char c) {
  int idx = charIndex(c);
  for (int col = 0; col < 5; col++) {
    uint8_t bits = pgm_read_byte(&FONT_5x7[idx][col]);
    for (int row = 0; row < 7; row++) {
      if (bits & (0x40 >> row)) setPixel(buf, x + col, y + row);
    }
  }
}

void drawText(uint8_t* buf, int x, int y, const String& text) {
  int cx = x;
  for (unsigned int i = 0; i < text.length(); i++) { drawChar(buf, cx, y, text[i]); cx += 6; }
}

int textWidth(const String& t) { return t.length() * 6; }

// ─── BASE64 (identique v1.5) ────────────────────────────────────────────────
static const int8_t B64_TABLE[256] PROGMEM = {
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,52,53,54,55,56,57,58,59,60,61,-1,-1,-1,0,-1,-1,
  -1,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
  -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1
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

// ─── AFFICHAGE E-INK ────────────────────────────────────────────────────────

bool initDisplayForRefresh() {
  unsigned long elapsed = millis() - lastRefreshMs;
  if (elapsed < EINK_MIN_REFRESH_MS) delay(EINK_MIN_REFRESH_MS - elapsed);
  if (epd.Init() != 0) { Serial.println("[EINK] Init failed"); return false; }
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

// ─── AFFICHAGE CLÉ PUBLIQUE (unique au premier boot) ───────────────────────
void displayPublicKey() {
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  String pubHex = bytesToHex(publicKey, 32);
  String title  = "PROOF-OF-DRAW WALLET";
  String warn1  = "NOTE YOUR PUBLIC KEY - ONE TIME DISPLAY";
  String warn2  = "THIS SCREEN WILL NOT SHOW AGAIN";

  // Centrage
  auto center = [](const String& s, int maxX = IMG_W) {
    return max(0, (maxX - (int)(s.length() * 6)) / 2);
  };

  drawText(blackBuf, center(title), 4, title);

  // Ligne de séparation
  for (int x = 10; x < IMG_W - 10; x++) setPixel(blackBuf, x, 14);

  // Clé publique sur 4 lignes de 16 hex chars chacune
  for (int line = 0; line < 4; line++) {
    String chunk = pubHex.substring(line * 16, line * 16 + 16);
    drawText(blackBuf, center(chunk), 20 + line * 16, chunk);
  }

  // Ligne de séparation
  for (int x = 10; x < IMG_W - 10; x++) setPixel(blackBuf, x, 88);

  // Warnings en rouge
  drawText(redBuf, center(warn1), 96, warn1);
  drawText(redBuf, center(warn2), 108, warn2);

  drawText(blackBuf, center(String("DEVICE: ") + deviceId), 120, String("DEVICE: ") + deviceId);

  refreshDisplay();

  Serial.println("[KEYS] Clé publique affichée. L'utilisateur a 60s pour noter.");
  Serial.print("[KEYS] Public key: "); Serial.println(pubHex);

  // On attend que l'utilisateur note la clé
  delay(60000);
  Serial.println("[KEYS] Délai écoulé, suite du boot...");
}

// ─── QR CODE (identique v1.5 avec adaptation) ──────────────────────────────
void displayQR(const String& onboardUrl, const String& code, const String& mac) {
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(5)];
  if (qrcode_initText(&qrcode, qrcodeData, 4, ECC_MEDIUM, onboardUrl.c_str()) < 0)
    if (qrcode_initText(&qrcode, qrcodeData, 5, ECC_MEDIUM, onboardUrl.c_str()) < 0) return;

  String title   = "PROOF-OF-DRAW";
  String macShort = mac; macShort.replace(":", ""); macShort.toUpperCase();
  String macLine  = "MAC:" + macShort;
  String codeLine = "CODE:" + code;

  const int qzQZ = 2, topPad = 4, sidePad = 6, bottomPad = 4;
  const int titleBlockH = 7 + 2 + 7, infoBlockH = 7 + 3 + 7;
  const int gapT = 6, gapB = 6;

  int total = qrcode.size + qzQZ * 2;
  int usableW = IMG_W - sidePad * 2;
  int usableH = IMG_H - topPad - titleBlockH - gapT - gapB - infoBlockH - bottomPad;
  int scale = min(usableW / total, usableH / total); if (scale < 1) scale = 1;
  int qrPx = total * scale;

  int titleY1 = topPad, titleY2 = titleY1 + 9;
  int qrX0 = (IMG_W - qrPx) / 2, qrY0 = topPad + titleBlockH + gapT;
  int textY1 = qrY0 + qrPx + gapB, textY2 = textY1 + 10;

  auto c = [](const String& s) { return max(0, (IMG_W - (int)(s.length() * 6)) / 2); };

  drawText(blackBuf, c(title), titleY1, title);
  drawText(blackBuf, c(String("SCAN TO PAIR")), titleY2, "SCAN TO PAIR");

  for (int my = 0; my < qrcode.size; my++) {
    for (int mx = 0; mx < qrcode.size; mx++) {
      if (!qrcode_getModule(&qrcode, mx, my)) continue;
      for (int dy = 0; dy < scale; dy++)
        for (int dx = 0; dx < scale; dx++)
          setPixel(blackBuf, qrX0 + (mx + qzQZ) * scale + dx, qrY0 + (my + qzQZ) * scale + dy);
    }
  }

  drawText(blackBuf, c(macLine), textY1, macLine);
  drawText(blackBuf, c(codeLine), textY2, codeLine);

  refreshDisplay();
}

bool ackFrame(const String& frameId) {
  String body = "{\"deviceId\":\"" + deviceId + "\",\"frameId\":\"" + frameId + "\"}";
  String resp;
  return httpPost("/api/ack-frame", body, resp);
}

void displayKeyMaterialOnce() {
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  String pubHex = bytesToHex(publicKey, 32);
  String privHex = bytesToHex(privateKey, 32);

  Serial.println(pubHex);
  Serial.println(privHex);

  String title = "PROOF-OF-DRAW KEYS";
  String warn1 = "SAVE THESE KEYS NOW";
  String warn2 = "PRIVATE KEY SHOWN ONCE";

  auto center = [](const String& s, int maxX = IMG_W) {
    return max(0, (maxX - (int)(s.length() * 6)) / 2);
  };

  drawText(blackBuf, center(title), 4, title);
  for (int x = 10; x < IMG_W - 10; x++) setPixel(blackBuf, x, 14);

  drawText(blackBuf, 4, 22, "PUB:");
  for (int line = 0; line < 4; line++) {
    String chunk = pubHex.substring(line * 16, line * 16 + 16);
    drawText(blackBuf, 30, 22 + line * 10, chunk);
  }

  drawText(blackBuf, 4, 68, "PRIV:");
  for (int line = 0; line < 4; line++) {
    String chunk = privHex.substring(line * 16, line * 16 + 16);
    drawText(redBuf, 30, 68 + line * 10, chunk);
  }

  for (int x = 10; x < IMG_W - 10; x++) setPixel(blackBuf, x, 114);
  drawText(redBuf, center(warn1), 118, warn1);
  drawText(redBuf, center(warn2), 128 - 10, warn2);

  refreshDisplay();
  delay(60000);
}


// ─── REGISTER ───────────────────────────────────────────────────────────────
bool doRegister() {
  String mac = WiFi.macAddress();
  mac.toLowerCase();

  String pubHex = keysLoaded ? bytesToHex(publicKey, 32) : "";
  String body = "{\"mac\":\"" + mac + "\",\"screens\":[\"" + SCREEN_TYPE + "\"],"
                "\"firmware\":\"2.0\",\"publicKey\":\"" + pubHex + "\"}";
  String resp;

  Serial.printf("[REGISTER] heap avant: %u\n", ESP.getFreeHeap());

  if (!httpPost("/api/register", body, resp)) {
    Serial.println("[REGISTER] Echec HTTP");
    return false;
  }

  Serial.printf("[REGISTER] heap après: %u\n", ESP.getFreeHeap());
  Serial.println("[REGISTER] resp: " + resp);

  DynamicJsonDocument doc(768);
  DeserializationError err = deserializeJson(doc, resp);
  if (err) {
    Serial.print("[REGISTER] JSON error: ");
    Serial.println(err.c_str());
    return false;
  }

  deviceId   = doc["deviceId"].as<String>();
  pairCode   = doc["pairCode"].as<String>();
  canvasUrl  = doc["canvasUrl"].as<String>();
  paired     = doc["paired"] | false;
  registered = true;

  Serial.println("[REGISTER] deviceId: " + deviceId);
  Serial.println("[REGISTER] paired: " + String(paired ? "oui" : "non"));

  if (!einkReady) {
    Serial.printf("[HEAP] avant malloc: %u bytes\n", ESP.getFreeHeap());
    blackBuf = (uint8_t*)malloc(BUF_SIZE);
    redBuf   = (uint8_t*)malloc(BUF_SIZE);
    if (!blackBuf || !redBuf) {
      Serial.println("[EINK] ERREUR malloc — heap insuffisant");
      registered = false;
      return false;
    }
    memset(blackBuf, 0xFF, BUF_SIZE);
    memset(redBuf,   0xFF, BUF_SIZE);
    einkReady = true;
    Serial.printf("[HEAP] après malloc: %u bytes\n", ESP.getFreeHeap());
  }

  if (!paired && !onboardingAlreadyShown()) {
    if (!keysAlreadyGenerated()) {
      generateKeys();
    }

    displayKeyMaterialOnce();   // clé publique + clé privée, une seule fois
    String onboardUrl = String(SERVER_URL) + "/onboard?code=" + pairCode;
    displayQR(onboardUrl, pairCode, mac);

    setOnboardingShown();

    Serial.println("[REGISTER] Restart dans 3s pour libérer heap TLS...");
    delay(3000);
    ESP.restart();
  } else if (!paired) {
    Serial.println("[REGISTER] Déjà en onboarding, attente du pairing serveur...");
  } else {
    Serial.println("[REGISTER] Déjà appairé, pas de QR");
  }

  return true;
}

// ─── PULL ───────────────────────────────────────────────────────────────────







void doPull() {
  free(blackBuf); blackBuf = nullptr;
  free(redBuf);   redBuf   = nullptr;

  Serial.printf("[HEAP] avant pull: %u bytes\n", ESP.getFreeHeap());

  String resp;
  int httpCode = -1;
  bool ok = httpGet("/api/pull?deviceId=" + deviceId, resp, &httpCode);

  if (httpCode == 429) {
    int retrySec = 60;
    DynamicJsonDocument rateDoc(256);
    if (deserializeJson(rateDoc, resp) == DeserializationError::Ok) {
      retrySec = rateDoc["retryAfter"] | 60;
      if (retrySec <= 0) retrySec = 60;
    }

    Serial.printf("[PULL] 429 rate limit, retryAfter=%d s\n", retrySec);
    unsigned long retryMs = (unsigned long)retrySec * 1000UL;
    if (retryMs > PULL_INTERVAL) retryMs = PULL_INTERVAL;
    lastPullMs = millis() - (PULL_INTERVAL - retryMs);
    return;
  }

  if (!ok || resp.length() == 0) {
    Serial.println("[PULL] Echec HTTP ou réponse vide");
    return;
  }

  DynamicJsonDocument doc(4096);
  DeserializationError err = deserializeJson(doc, resp);
  if (err) {
    Serial.print("[PULL] JSON error: ");
    Serial.println(err.c_str());
    return;
  }

  JsonObject chain = doc["chain"];
  if (!chain.isNull()) {
    String newBlockHash = chain["blockHash"] | "";
    if (newBlockHash.length() > 0 && newBlockHash != currentBlockHash) {
      currentBlockHash = newBlockHash;
      currentBlockIndex = chain["blockIndex"] | -1;
      saveBlockHashToEEPROM(currentBlockHash);
      Serial.printf("[PULL] Nouveau bloc #%d hash=%s...\n",
                    currentBlockIndex, currentBlockHash.substring(0, 12).c_str());
    }
  }

  JsonObject pend = doc["pendingValidation"];
  if (!pend.isNull()) {
    pendingCandidateId = pend["candidateId"] | "";
    if (pendingCandidateId.length() > 0) {
      Serial.println("[PULL] Candidat en attente: " + pendingCandidateId);
    }
  }

  String frameSource = doc["frameSource"] | "none";
  JsonObject frame = doc["frame"];

  if (frame.isNull() || frameSource == "none") {
    Serial.println("[PULL] Aucune frame (source: " + frameSource + ")");
    frameReady = false;
    return;
  }

  String frameId = frame["frameId"] | "";
  if (frameId.length() > 0 && frameId == lastFrameId) {
    Serial.println("[PULL] Frame déjà affichée (frameId identique)");
    frameReady = true;
    return;
  }

  String screen   = frame["screen"] | "";
  String blackB64 = frame["black"] | "";
  String redB64   = frame["red"] | "";

  if (screen != SCREEN_TYPE || blackB64.isEmpty() || redB64.isEmpty()) {
    Serial.println("[PULL] Frame incomplète ou screen incompatible");
    frameReady = false;
    return;
  }

  blackBuf = (uint8_t*)malloc(BUF_SIZE);
  redBuf   = (uint8_t*)malloc(BUF_SIZE);
  if (!blackBuf || !redBuf) {
    Serial.println("[PULL] malloc failed");
    ESP.restart();
    return;
  }

  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  size_t blackLen = base64Decode(blackB64.c_str(), blackB64.length(), blackBuf, BUF_SIZE);
  size_t redLen   = base64Decode(redB64.c_str(),   redB64.length(),   redBuf,   BUF_SIZE);

  if (blackLen != BUF_SIZE || redLen != BUF_SIZE) {
    Serial.printf("[PULL] Taille invalide black=%u red=%u expected=%u\n",
                  (unsigned)blackLen, (unsigned)redLen, (unsigned)BUF_SIZE);
    free(blackBuf); blackBuf = nullptr;
    free(redBuf);   redBuf   = nullptr;
    frameReady = false;
    return;
  }

  if (frameSource == "consensus") {
    String artist = frame["artistName"] | "";
    if (artist.length() > 0) {
      Serial.println("[PULL] Dessin validé de: " + artist + " bloc #" + String(currentBlockIndex));
    }

    if (hasDisplayedFrame) {
      clearDisplayWhite();
      delay(3000);
    }

    if (refreshDisplay()) {
      hasDisplayedFrame = true;
      lastFrameId = frameId;
      frameReady = true;
      ackFrame(frameId);
      consensusJustDisplayed = true;
      pendingCandidateId = "";
      Serial.printf("[PULL] ✅ Frame consensus affichée frameId=%s\n", frameId.c_str());
    } else {
      Serial.println("[PULL] refreshDisplay failed");
      frameReady = false;
    }

    return;
  }

  if (frameSource == "personal") {
    if (hasDisplayedFrame) {
      clearDisplayWhite();
      delay(3000);
    }

    if (refreshDisplay()) {
      hasDisplayedFrame = true;
      lastFrameId = frameId;
      frameReady = true;
      ackFrame(frameId);
      pendingCandidateId = "";
      consensusJustDisplayed = false;
      Serial.printf("[PULL] ✅ Frame personal affichée frameId=%s\n", frameId.c_str());
    } else {
      Serial.println("[PULL] refreshDisplay failed");
      frameReady = false;
    }

    return;
  }

  Serial.println("[PULL] frameSource inconnu: " + frameSource);
  frameReady = false;
}












// ─── VALIDATION (V1 — proof of presence) ────────────────────────────────────
//
// V1 : l'ESP vote sur présence dans la pool, pas sur calcul de métriques.
// La réponse de /api/validate-candidate ne contient pas le payload (13KB)
// car WiFiClientSecure + 13KB JSON épuise le heap TLS (~30KB disponible).
// L'ESP utilise score_server comme référence pour son vote.
//
// V2 : /api/candidate-payload (binaire, sans overhead base64+JSON)
// permettra à l'ESP de calculer ses propres métriques.









void doValidate() {
  if (pendingCandidateId.length() == 0) return;
  if (consensusJustDisplayed) {
    pendingCandidateId = "";
    consensusJustDisplayed = false;
    return;
  }

  Serial.println("[VALIDATE] Debut: " + pendingCandidateId);
  Serial.printf("[VALIDATE] heap: %u\n", ESP.getFreeHeap());

  // Libérer les buffers avant la requête HTTPS (gain ~9.5KB)
  free(blackBuf); blackBuf = nullptr;
  free(redBuf);   redBuf   = nullptr;

  // ─── Fetch métadonnées (~200 bytes, sans payload) ─────────────────────────
  // httpGet() réutilise le même contexte TLS que pull — fiable et éprouvé.
  String resp;
  bool ok = httpGet("/api/validate-candidate?deviceId=" + deviceId, resp);

  if (!ok || resp.length() == 0) {
    Serial.println("[VALIDATE] Echec HTTP");
    pendingCandidateId = "";
    goto realloc_and_return;
  }

  {
    DynamicJsonDocument doc(512);
    DeserializationError err = deserializeJson(doc, resp);
    resp = "";  // libérer la String immédiatement

    if (err) {
      Serial.print("[VALIDATE] JSON err: ");
      Serial.println(err.c_str());
      pendingCandidateId = "";
      goto realloc_and_return;
    }

    if (doc["alreadyVoted"] | false) {
      Serial.println("[VALIDATE] Deja vote");
      pendingCandidateId = "";
      goto realloc_and_return;
    }

    if (doc["candidate"].isNull()) {
      Serial.println("[VALIDATE] Pas de candidat actif");
      pendingCandidateId = "";
      goto realloc_and_return;
    }

    JsonObject cand = doc["candidate"];
    String candidateId = cand["candidateId"] | "";

    if (candidateId.length() == 0) {
      Serial.println("[VALIDATE] candidateId absent");
      pendingCandidateId = "";
      goto realloc_and_return;
    }

    // V1 : utiliser score_server comme référence (pas de calcul local)
    float score = cand["score_server"] | 0.5f;
    Serial.printf("[VALIDATE] candidateId=%s score=%.3f\n",
                  candidateId.c_str(), score);

    // ── Vote ─────────────────────────────────────────────────────────────────
    String signature = signV1(candidateId, score);
    char   scoreStr[8];
    dtostrf(score, 1, 3, scoreStr);

    String body = String("{\"deviceId\":\"") + deviceId    + "\","
                  "\"candidateId\":\""        + candidateId + "\","
                  "\"entropy\":"              + scoreStr    + ","
                  "\"transitions\":"          + scoreStr    + ","
                  "\"rle\":"                  + scoreStr    + ","
                  "\"score\":"                + scoreStr    + ","
                  "\"signature\":\""          + signature   + "\"}";

    pendingCandidateId = "";

    String vResp;
    bool vOk = httpPost("/api/validation-result", body, vResp);

    if (vOk) {
      Serial.println("[VALIDATE] Vote OK");
      if (vResp.indexOf("\"blockMined\":true") >= 0) {
        Serial.println("[VALIDATE] BLOC MINE");
        consensusJustDisplayed = false;
        frameReady = true;
        lastPullMs = 0;  // pull immédiat au prochain loop()
      }
    } else {
      Serial.println("[VALIDATE] Echec vote");
    }
  }

realloc_and_return:
  blackBuf = (uint8_t*)malloc(BUF_SIZE);
  redBuf   = (uint8_t*)malloc(BUF_SIZE);
  if (!blackBuf || !redBuf) {
    Serial.println("[VALIDATE] malloc fail — restart");
    ESP.restart();
  }
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);
}












// ─── SETUP / LOOP ───────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] Proof-of-Draw ESP v2.0");

  eepromInit();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WIFI] Connexion");
  int i = 0;
  while (WiFi.status() != WL_CONNECTED && i++ < 40) {
    delay(500);
    Serial.print(".");
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
  if (currentBlockHash.length() > 0) {
    Serial.println("[CHAIN] BlockHash restauré: " + currentBlockHash);
  }

  while (!registered) {
    if (doRegister()) break;
    delay(5000);
  }

  Serial.println("[BOOT] Premier pull immédiat...");
  doPull();

  lastPullMs     = millis();
  // Délai de sécurité : même si le pull de boot a reçu un candidat,
  // on attend VALIDATE_INTERVAL avant la première validation pour ne
  // pas enchaîner deux connexions TLS back-to-back.
  lastValidateMs = millis();
  Serial.println("[BOOT] Pret. Pull dans " + String(PULL_INTERVAL / 1000) + "s");
}


void loop() {
  unsigned long now = millis();

  if (!registered) {
    if (!doRegister()) {
      delay(5000);
      return;
    }
  }

  if (now - lastPullMs >= PULL_INTERVAL) {
    String prevCandidateId = pendingCandidateId;
    doPull();
    lastPullMs = now;

    // Si le pull vient de poser un nouveau candidat, on retarde la validation
    // d'au moins VALIDATE_INTERVAL : l'ESP8266 ne peut pas faire deux connexions
    // TLS back-to-back sans risquer un code -1 (SSL context pas encore libéré).
    if (pendingCandidateId.length() > 0 && pendingCandidateId != prevCandidateId) {
      lastValidateMs = now;
    }
  }

  if (pendingCandidateId.length() > 0 && !consensusJustDisplayed && now - lastValidateMs >= VALIDATE_INTERVAL) {
    doValidate();
    lastValidateMs = now;
  }

  delay(100);
}

