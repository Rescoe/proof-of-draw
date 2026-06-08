// esp_eink_2.7BW.ino
// Proof-of-Draw — Firmware e-ink 2.7" BW v2.0
//
// Identique au firmware multiscreen (oled+eink2.7BW) dans sa logique,
// mais sans OLED — un seul écran E-ink 2.7" noir/blanc.
//
// Fonctionnalités :
//   1. Paire ED25519 générée au premier boot → EEPROM
//   2. Pull léger (metadata) + fetch frame binaire via /api/pull-frame
//   3. Validation distribuée : vote indépendant du type d'écran
//   4. Cartel paysage (câble à gauche) : timestamp + artiste + titre
//   5. Onboarding : QR code + code d'appairage sur l'écran
//   6. Boutons KEY1-4 : rappellent à l'écran l'un des 4 derniers dessins
//      affichés (stockés en LittleFS, cartel inclus). Le nouveau dessin
//      envoyé par le serveur reste toujours prioritaire, et le rythme de
//      rafraîchissement minimal (E27_MIN_REFRESH_MS, 3 min) est respecté
//      aussi bien pour les rappels que pour les nouveaux dessins —
//      préservation de la durée de vie de l'e-ink.
//      Rotation : chaque nouveau dessin va dans le slot le plus ancien
//      (slot_head), qui avance ensuite de 1 — "le nouveau prend la place
//      du dernier slot, et ainsi de suite".
//
// CONTRAINTES MÉMOIRE :
//   → SPI reste actif toute la session (pas de bascule I2C/SPI)
//   → Le buffer pixel (5808 bytes) est alloué uniquement pendant doFetchFrame()
//     et lors de l'affichage/sauvegarde d'un slot
//   → heap disponible avant pull : ~47KB
//   → LittleFS : 4 slots × ~5888 bytes (~23.5KB de flash, hors partition FS)

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <qrcode.h>
#include <EEPROM.h>
#include <LittleFS.h>      // Stockage local des dessins (slots KEY1-4)
#include "epd2in7_V2.h"
#include "epdif.h"
#include <Ed25519.h>       // Bibliothèque Crypto (rhempel) — ED25519 réel

// ─── CONFIG ────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "Livebox-D190";
const char* WIFI_PASSWORD = "Q2gueWg3UaYJo2VN7C";

#define SERVER_URL       "https://proof-of-draw.vercel.app"
#define SCREEN_TYPE      "eink27bw"
#define FIRMWARE_VERSION "eink27bw-2.0"

#define PULL_INTERVAL      60000UL   // 1 min
#define VALIDATE_INTERVAL  30000UL   // 30s — check si candidat en attente
#define E27_MIN_REFRESH_MS 180000UL  // 3 min minimum — spec Waveshare 2.7" BW V2

// ─── BOUTONS KEY1-4 ────────────────────────────────────────────────────────
// Le module driver e-ink utilise déjà D0/D1/D2/D8 (cf epdif.h). Les broches
// ci-dessous sont les GPIO restantes d'un NodeMCU/Wemos D1 mini — à adapter
// selon le câblage réel des 4 boutons KEY1-4 du kit Waveshare.
// Câblage attendu : bouton entre la broche et GND, pull-up interne (actif LOW).
// ⚠️ KEY4_PIN = D3 (GPIO0) est une broche de mode boot : ne pas la maintenir
//    appuyée pendant la mise sous tension (sinon mode flashing).
#define KEY1_PIN D5   // GPIO14
#define KEY2_PIN D6   // GPIO12
#define KEY3_PIN D7   // GPIO13
#define KEY4_PIN D3   // GPIO0
#define SLOT_COUNT       4
#define KEY_DEBOUNCE_MS  250UL

// ─── EEPROM layout ─────────────────────────────────────────────────────────
// [0..31]   : clé privée ED25519 (32 bytes)
// [32..63]  : blockHash courant (32 bytes ASCII)
// [64]      : keyGenerated flag (0xED = ED25519 réel)
// [65..96]  : clé publique (32 bytes)
// [97]      : onboarding shown flag
// [98]      : owned_head   — index de tête du ring buffer (0-9)
// [99]      : owned_count  — nombre de slots valides (0-10)
// [100..419]: owned slots  — 10 × 32 bytes = 320 bytes (hashes de blocs possédés)
// [420]      : slot_head — index (0-3) du PROCHAIN slot KEY1-4 à écrire (rotation)
// [421..511]: réservé
#define EEPROM_SIZE           512
#define EEPROM_PRIVKEY_OFF    0
#define EEPROM_BLOCKHASH_OFF  32
#define EEPROM_FLAG_OFF       64
#define EEPROM_PUBKEY_OFF     65
#define EEPROM_ONBOARDING_OFF 97
#define ONBOARDING_SHOWN_FLAG 0x01
#define KEY_GENERATED_FLAG    0xED   // 0xED = ED25519 réel (0x01 = ancienne V1 fake)
#define EEPROM_OWNED_HEAD_OFF  98
#define EEPROM_OWNED_COUNT_OFF 99
#define EEPROM_OWNED_SLOTS_OFF 100
#define OWNED_SLOTS_MAX        10
#define OWNED_HASH_LEN         32
#define EEPROM_SLOT_HEAD_OFF   420

// ─── ÉCRAN 2.7" BW ─────────────────────────────────────────────────────────
// Résolution driver : portrait 176×264
// Résolution canvas : paysage 264×176 (câble à gauche, rotation 90° CW)
#define E27_WIDTH    176   // largeur portrait = hauteur paysage
#define E27_HEIGHT   264   // hauteur portrait = largeur paysage
#define E27_BUF_SIZE ((E27_WIDTH * E27_HEIGHT) / 8)  // 5808 bytes

Epd epd27;
unsigned long lastE27RefreshMs = 0;

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
unsigned long nextPullIntervalMs = PULL_INTERVAL;

uint8_t privateKey[32];
uint8_t publicKey[32];
bool    keysLoaded = false;

String currentBlockHash  = "";
int    currentBlockIndex = -1;

// Métadonnées cartel (lues depuis cartelMeta du pull)
String pendingWorkTitle  = "";
String pendingArtistName = "";
String pendingDisplayTs  = "";

// Ré-validation (Axe 3)
String pendingObsHashes = "";
String pendingObsTarget = "";

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

  // Validation de cohérence (défense contre coupure power pendant commit)
  uint8_t derived[32];
  Ed25519::derivePublicKey(derived, privateKey);
  if (memcmp(derived, publicKey, 32) != 0) {
    Serial.println("[KEYS] Clé publique EEPROM incohérente → recalcul depuis clé privée");
    memcpy(publicKey, derived, 32);
    for (int i = 0; i < 32; i++) EEPROM.write(EEPROM_PUBKEY_OFF + i, publicKey[i]);
    EEPROM.commit();
    Serial.println("[KEYS] Clé publique corrigée et sauvegardée");
  }
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

// ─── Blocs possédés (EEPROM ring buffer) ───────────────────────────────────
void saveOwnedBlockHash(const String& fullHash) {
  if (fullHash.length() < 16) return;

  String h = fullHash.length() >= OWNED_HASH_LEN
             ? fullHash.substring(0, OWNED_HASH_LEN)
             : fullHash;
  while ((int)h.length() < OWNED_HASH_LEN) h += ' ';

  uint8_t head  = EEPROM.read(EEPROM_OWNED_HEAD_OFF);
  uint8_t count = EEPROM.read(EEPROM_OWNED_COUNT_OFF);
  if (head  >= OWNED_SLOTS_MAX) head  = 0;
  if (count >  OWNED_SLOTS_MAX) count = 0;

  for (uint8_t i = 0; i < count; i++) {
    uint8_t slot = (head - count + i + OWNED_SLOTS_MAX) % OWNED_SLOTS_MAX;
    int off = EEPROM_OWNED_SLOTS_OFF + slot * OWNED_HASH_LEN;
    bool match = true;
    for (int j = 0; j < OWNED_HASH_LEN && match; j++) {
      if ((char)EEPROM.read(off + j) != h[j]) match = false;
    }
    if (match) { Serial.println("[OWNED] Hash déjà stocké, skip"); return; }
  }

  int slotOff = EEPROM_OWNED_SLOTS_OFF + head * OWNED_HASH_LEN;
  for (int i = 0; i < OWNED_HASH_LEN; i++)
    EEPROM.write(slotOff + i, (uint8_t)h[i]);

  head  = (head + 1) % OWNED_SLOTS_MAX;
  count = min((int)count + 1, (int)OWNED_SLOTS_MAX);
  EEPROM.write(EEPROM_OWNED_HEAD_OFF,  head);
  EEPROM.write(EEPROM_OWNED_COUNT_OFF, count);
  EEPROM.commit();

  Serial.printf("[OWNED] Bloc sauvegardé: %s... (%u/%u slots)\n",
                h.substring(0, 8).c_str(), count, OWNED_SLOTS_MAX);
}

String loadOwnedHashesJson() {
  uint8_t head  = EEPROM.read(EEPROM_OWNED_HEAD_OFF);
  uint8_t count = EEPROM.read(EEPROM_OWNED_COUNT_OFF);
  if (head  >= OWNED_SLOTS_MAX) head  = 0;
  if (count  > OWNED_SLOTS_MAX) count = 0;
  if (count == 0) return "[]";

  String json = "[";
  bool first = true;
  for (uint8_t i = 0; i < count; i++) {
    uint8_t slot = (head - 1 - i + OWNED_SLOTS_MAX) % OWNED_SLOTS_MAX;
    int off = EEPROM_OWNED_SLOTS_OFF + slot * OWNED_HASH_LEN;
    String h = "";
    for (int j = 0; j < OWNED_HASH_LEN; j++) {
      char c = (char)EEPROM.read(off + j);
      if (c == ' ' || c == '\0') break;
      h += c;
    }
    if (h.length() >= 8) {
      if (!first) json += ",";
      json += "\"" + h + "\"";
      first = false;
    }
  }
  json += "]";
  return json;
}

// ─── Génération de clés ED25519 ───────────────────────────────────────────
void generateKeys() {
  Serial.println("[KEYS] Génération paire ED25519...");
  randomSeed(analogRead(A0) ^ millis() ^ (uint32_t)WiFi.RSSI());
  for (int i = 0; i < 32; i++) {
    privateKey[i] = (uint8_t)(random(256) ^ (analogRead(A0) & 0xFF));
    delayMicroseconds(100);
  }
  Ed25519::derivePublicKey(publicKey, privateKey);
  keysLoaded = true;
  saveKeysToEEPROM();
  Serial.println("[KEYS] Paire ED25519 générée et sauvegardée");
  Serial.println("[KEYS] PubKey: " + bytesToHex(publicKey, 32));
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

// ─── Signature ED25519 ───────────────────────────────────────────────────────
// Message signé : "deviceId:candidateId:score" (3 décimales)
String signED25519(const String& candidateId, float score) {
  char scoreStr[8];
  dtostrf(score, 1, 3, scoreStr);
  String message = deviceId + ":" + candidateId + ":" + String(scoreStr);

  uint8_t sig[64];
  Ed25519::sign(sig, privateKey, publicKey,
                (const uint8_t*)message.c_str(), message.length());

  String sigHex = bytesToHex(sig, 64);

  // Debug : imprime pubKey + message + signature pour vérification manuelle
  // avec /api/debug/verify-sig?secret=X&pubKey=...&msg=...&sig=...
  Serial.println("[SIGN] PUBKEY: " + bytesToHex(publicKey, 32));
  Serial.println("[SIGN] MSG: " + message);
  Serial.println("[SIGN] SIG: " + sigHex);

  return sigHex;
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
  return code == 200 || code == 429;
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

// ─── PIXEL / TEXT HELPERS (portrait 176×264) ───────────────────────────────
// Convention driver : 1 = blanc, 0 = noir
// byteIndex = (E27_WIDTH-1-x)/8 + y*(E27_WIDTH/8)  avec x=col portrait, y=ligne portrait
// bit = 0x80 >> ((E27_WIDTH-1-x) & 7)

inline void setPixelE27(uint8_t* buf, int x, int y) {
  if (!buf || x < 0 || x >= E27_WIDTH || y < 0 || y >= E27_HEIGHT) return;
  int xr = E27_WIDTH - 1 - x;
  int byteIndex = (xr / 8) + y * (E27_WIDTH / 8);
  buf[byteIndex] &= ~(0x80 >> (xr & 7));
}

// ─── FONCTIONS PAYSAGE (câble à gauche, rotation 90° sens horaire) ────────
// Portrait : PW=176, PH=264
// Paysage  : LW=264, LH=176 (ce que voit l'utilisateur)
// Mapping paysage(lx,ly) → portrait(px,py) : px=ly, py=(PH-1)-lx
//
// Pour le texte : col du glyphe (0..4) → direction lecture (lx), row (0..6) → hauteur (ly)

void drawCharE27_landscape(uint8_t* buf, int lx, int ly, char c, int scale = 1) {
  int idx = charIndex(c);
  for (int col = 0; col < 5; col++) {
    uint8_t bits = pgm_read_byte(&FONT_5x7[idx][col]);
    for (int row = 0; row < 7; row++) {
      if (bits & (0x40 >> row)) {
        for (int s1 = 0; s1 < scale; s1++)
          for (int s2 = 0; s2 < scale; s2++) {
            int lx_px = lx + col * scale + s1;
            int ly_px = ly + row * scale + s2;
            int bufCol = ly_px;                    // pas de mirroir : voir CLAUDE.md (bufCol = y_canvas)
            int bufRow = E27_HEIGHT - 1 - lx_px;    // bufRow = (H-1) - x_canvas
            if (bufCol < 0 || bufCol >= E27_WIDTH || bufRow < 0 || bufRow >= E27_HEIGHT) continue;
            buf[(bufCol / 8) + bufRow * (E27_WIDTH / 8)] &= ~(0x80 >> (bufCol & 7));
          }
      }
    }
  }
}

void drawTextE27_landscape(uint8_t* buf, int lx, int ly, const String& text, int scale = 1) {
  int cx = lx;
  for (unsigned int i = 0; i < text.length(); i++) {
    drawCharE27_landscape(buf, cx, ly, text.charAt(i), scale);
    cx += 6 * scale;
    yield();
  }
}

int textWidthE27_landscape(const String& text, int scale = 1) {
  return (int)text.length() * 6 * scale;
}

// Efface des colonnes portrait (= bandes horizontales en paysage) → blanc
void clearPortraitCols(uint8_t* buf, int pxStart, int pxEnd) {
  for (int px = pxStart; px <= pxEnd && px < E27_WIDTH; px++) {
    int bufCol = px; // pas de mirroir : voir CLAUDE.md (bufCol = y_canvas)
    for (int bufRow = 0; bufRow < E27_HEIGHT; bufRow++) {
      buf[(bufCol / 8) + bufRow * (E27_WIDTH / 8)] |= (0x80 >> (bufCol & 7));
    }
  }
}

// Ligne séparatrice horizontale en paysage (= colonne portrait noire)
void drawLandscapeSepLine(uint8_t* buf, int portraitX) {
  int bufCol = portraitX; // pas de mirroir
  for (int bufRow = 0; bufRow < E27_HEIGHT; bufRow++) {
    buf[(bufCol / 8) + bufRow * (E27_WIDTH / 8)] &= ~(0x80 >> (bufCol & 7));
  }
}

// ─── CARTEL PAYSAGE ─────────────────────────────────────────────────────────
// Bande SUPÉRIEURE paysage (top ~13px) : timestamp + "Block #N"
// Bande INFÉRIEURE paysage (bottom ~13px) : artiste - titre
void burnEinkCartel_landscape(uint8_t* buf,
                               const String& workTitle,
                               const String& artistName,
                               const String& ts,
                               int blockIndex = -1) {
  if (!buf) return;
  const int BAND = 13;
  // LH = E27_WIDTH = 176, LW = E27_HEIGHT = 264

  // ── Bande supérieure ──
  clearPortraitCols(buf, 0, BAND - 1);
  drawLandscapeSepLine(buf, BAND - 1);

  String topLine = ts.length() > 0 ? ts : "PROOF-OF-DRAW";
  if (blockIndex >= 0) topLine += " Block #" + String(blockIndex);
  while (topLine.length() > 0 && textWidthE27_landscape(topLine, 1) > E27_HEIGHT - 4)
    topLine.remove(topLine.length() - 1);
  int topLx = max(0, (E27_HEIGHT - textWidthE27_landscape(topLine, 1)) / 2);
  drawTextE27_landscape(buf, topLx, 2, topLine, 1);

  // ── Bande inférieure ──
  int botPxStart = E27_WIDTH - BAND;
  clearPortraitCols(buf, botPxStart, E27_WIDTH - 1);
  drawLandscapeSepLine(buf, botPxStart);

  String botLine;
  if (artistName.length() > 0 && workTitle.length() > 0)
    botLine = artistName + " - " + workTitle;
  else if (artistName.length() > 0)
    botLine = artistName;
  else if (workTitle.length() > 0)
    botLine = workTitle;

  while (botLine.length() > 0 && textWidthE27_landscape(botLine, 1) > E27_HEIGHT - 4)
    botLine.remove(botLine.length() - 1);

  int botLx = max(0, (E27_HEIGHT - textWidthE27_landscape(botLine, 1)) / 2);
  drawTextE27_landscape(buf, botLx, botPxStart + 2, botLine, 1);
}

// ─── E27 DISPLAY ───────────────────────────────────────────────────────────
bool initE27ForRefresh() {
  unsigned long elapsed = millis() - lastE27RefreshMs;
  if (elapsed < E27_MIN_REFRESH_MS) {
    unsigned long wait = E27_MIN_REFRESH_MS - elapsed;
    Serial.printf("[E27] attente refresh %lums\n", wait);
    delay(wait);
  }
  ESP.wdtFeed();
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

// ─── SLOTS LOCAUX KEY1-4 (LittleFS) ────────────────────────────────────────
// Donne une utilité aux 4 boutons KEY1-4 du module : rappeler à l'écran l'un
// des 4 derniers dessins affichés, sans jamais dépasser le rythme d'usure de
// l'e-ink (E27_MIN_REFRESH_MS). Le NOUVEAU dessin envoyé par le serveur reste
// TOUJOURS prioritaire ; un rappel de slot ne fait qu'attendre son tour.
//
// Rotation : chaque dessin nouvellement affiché est sauvegardé dans le slot
// "le plus ancien" (slot_head), qui avance ensuite de 1 (mod 4) — exactement
// comme demandé : "le nouveau dessin prend la place du dernier slot, et ainsi
// de suite". Le buffer sauvegardé contient déjà le cartel incrusté, donc le
// rappel réaffiche une image strictement identique à ce qui avait été montré.
struct SlotMeta {
  char    title[32];
  char    artist[24];
  char    displayTs[20];
  int32_t blockIndex;
};
#define SLOT_META_SIZE sizeof(SlotMeta)
#define SLOT_FILE_SIZE (SLOT_META_SIZE + E27_BUF_SIZE)

const uint8_t KEY_PINS[SLOT_COUNT] = { KEY1_PIN, KEY2_PIN, KEY3_PIN, KEY4_PIN };
unsigned long lastKeyMs[SLOT_COUNT] = { 0, 0, 0, 0 };
int           requestedSlot         = 0;   // 0 = aucune demande ; 1..4 = slot demandé

String slotPath(int idx) { return "/slot" + String(idx) + ".bin"; }

int loadSlotHead() {
  int h = EEPROM.read(EEPROM_SLOT_HEAD_OFF);
  if (h < 0 || h >= SLOT_COUNT) h = 0;
  return h;
}

void saveSlotHead(int h) {
  EEPROM.write(EEPROM_SLOT_HEAD_OFF, (uint8_t)h);
  EEPROM.commit();
}

bool slotExists(int idx) {
  return LittleFS.exists(slotPath(idx));
}

// Sauvegarde le buffer (cartel déjà incrusté) + métadonnées dans le slot de
// rotation courant, puis avance la tête. Appelée juste après un affichage
// réussi d'un nouveau dessin (consensus ou personnel).
void saveCurrentFrameToSlot(const uint8_t* buf) {
  int head = loadSlotHead();

  SlotMeta meta;
  memset(&meta, 0, sizeof(meta));
  pendingWorkTitle.toCharArray(meta.title,      sizeof(meta.title));
  pendingArtistName.toCharArray(meta.artist,    sizeof(meta.artist));
  pendingDisplayTs.toCharArray(meta.displayTs,  sizeof(meta.displayTs));
  meta.blockIndex = currentBlockIndex;

  File f = LittleFS.open(slotPath(head), "w");
  if (!f) {
    Serial.println("[SLOTS] échec écriture — slot non sauvegardé");
    return;
  }
  f.write((uint8_t*)&meta, sizeof(meta));
  f.write(buf, E27_BUF_SIZE);
  f.close();

  Serial.printf("[SLOTS] dessin sauvegardé → slot %d (%s — %s)\n",
                head + 1, meta.title, meta.artist);

  saveSlotHead((head + 1) % SLOT_COUNT);
}

// Charge et affiche le slot demandé (1..4). Le cartel est déjà incrusté dans
// le buffer sauvegardé : pas besoin de le redessiner.
bool displaySlot(int slotNum) {
  int idx = slotNum - 1;
  if (idx < 0 || idx >= SLOT_COUNT) return false;

  if (!slotExists(idx)) {
    Serial.printf("[SLOTS] KEY%d → slot %d vide\n", slotNum, slotNum);
    return false;
  }

  File f = LittleFS.open(slotPath(idx), "r");
  if (!f || f.size() != (size_t)SLOT_FILE_SIZE) {
    Serial.printf("[SLOTS] slot %d corrompu — ignoré\n", slotNum);
    if (f) f.close();
    return false;
  }

  SlotMeta meta;
  f.read((uint8_t*)&meta, sizeof(meta));

  uint8_t* buf = (uint8_t*)malloc(E27_BUF_SIZE);
  if (!buf) {
    Serial.println("[SLOTS] malloc failed");
    f.close();
    return false;
  }
  f.read(buf, E27_BUF_SIZE);
  f.close();

  Serial.printf("[SLOTS] KEY%d → affichage slot %d : %s — %s (%s)\n",
                slotNum, slotNum, meta.title, meta.artist, meta.displayTs);

  bool ok = displayE27Buffer(buf);
  free(buf);

  if (ok) {
    lastFrameId       = "slot:" + String(slotNum);
    hasDisplayedFrame = true;
  }
  return ok;
}

void setupButtons() {
  for (int i = 0; i < SLOT_COUNT; i++) pinMode(KEY_PINS[i], INPUT_PULLUP);
  Serial.println("[KEYS] KEY1-4 initialisés (rappel de slots e-ink)");
}

// Lecture non bloquante avec anti-rebond. Une seule demande en attente à la
// fois — appuyer sur une autre touche remplace simplement la précédente.
void pollButtons() {
  unsigned long now = millis();
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (digitalRead(KEY_PINS[i]) == LOW && (now - lastKeyMs[i] > KEY_DEBOUNCE_MS)) {
      lastKeyMs[i]  = now;
      requestedSlot = i + 1;
      Serial.printf("[KEY%d] appui détecté → rappel slot %d demandé\n", i + 1, i + 1);
    }
  }
}

// Honore une demande de rappel de slot SI le délai mini de rafraîchissement
// e-ink est respecté. Sinon la demande patiente — elle sera retentée au tour
// de loop() suivant. Un nouveau dessin serveur, lui, met systématiquement à
// jour lastE27RefreshMs en premier : il garde donc toujours la priorité.
void processSlotRequest() {
  if (requestedSlot == 0) return;

  if (millis() - lastE27RefreshMs < E27_MIN_REFRESH_MS) {
    return; // pas encore le moment — on retentera plus tard, sans perdre la demande
  }

  int slot = requestedSlot;
  requestedSlot = 0;
  displaySlot(slot);
}

// ─── AFFICHAGE CLÉS (unique au premier boot) ────────────────────────────────
void displayKeyMaterialOnce() {
  String pubHex  = bytesToHex(publicKey,  32);
  String privHex = bytesToHex(privateKey, 32);

  Serial.println("[KEYS] Affichage clé publique (une seule fois)");
  Serial.println("[KEYS] PubKey: " + pubHex);

  uint8_t* buf = (uint8_t*)malloc(E27_BUF_SIZE);
  if (!buf) { Serial.println("[KEYS] malloc failed"); return; }
  memset(buf, 0xFF, E27_BUF_SIZE);

  // Texte portrait (lisible câble en bas)
  // On utilise drawTextE27 portrait pour cette page technique
  auto setP = [buf](int x, int y) {
    if (x < 0 || x >= E27_WIDTH || y < 0 || y >= E27_HEIGHT) return;
    int xr = E27_WIDTH - 1 - x;
    buf[(xr / 8) + y * (E27_WIDTH / 8)] &= ~(0x80 >> (xr & 7));
  };
  auto drawCharP = [&](int x, int y, char c) {
    int idx = charIndex(c);
    for (int col = 0; col < 5; col++) {
      uint8_t bits = pgm_read_byte(&FONT_5x7[idx][col]);
      for (int row = 0; row < 7; row++) {
        if (bits & (0x40 >> row)) setP(x + col, y + row);
      }
    }
  };
  auto drawStrP = [&](int x, int y, const String& s) {
    int cx = x;
    for (unsigned int i = 0; i < s.length(); i++) { drawCharP(cx, y, s[i]); cx += 6; }
  };

  drawStrP(4, 8,  "PROOF-OF-DRAW KEYS");
  for (int x = 4; x < E27_WIDTH - 4; x++) setP(x, 18);

  drawStrP(4, 24, "PUBLIC KEY:");
  for (int line = 0; line < 4; line++)
    drawStrP(4, 36 + line * 12, pubHex.substring(line * 16, line * 16 + 16));

  for (int x = 4; x < E27_WIDTH - 4; x++) setP(x, 88);

  drawStrP(4, 94, "PRIVATE KEY:");
  for (int line = 0; line < 4; line++)
    drawStrP(4, 106 + line * 12, privHex.substring(line * 16, line * 16 + 16));

  for (int x = 4; x < E27_WIDTH - 4; x++) setP(x, 160);
  drawStrP(4, 166, "SAVE NOW - ONE TIME");
  drawStrP(4, 178, "SCREEN WILL NOT");
  drawStrP(4, 190, "SHOW AGAIN");

  displayE27Buffer(buf);
  free(buf);

  Serial.println("[KEYS] Clés affichées — 60s pour noter");
  delay(60000);
  Serial.println("[KEYS] Délai écoulé");
}

// ─── QR ONBOARDING ─────────────────────────────────────────────────────────
void displayOnboardingE27(const String& onboardUrl, const String& code, const String& mac) {
  uint8_t* buf = (uint8_t*)malloc(E27_BUF_SIZE);
  if (!buf) { Serial.println("[E27] onboarding malloc failed"); return; }
  memset(buf, 0xFF, E27_BUF_SIZE);

  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(5)];
  int qrResult = qrcode_initText(&qrcode, qrcodeData, 4, ECC_MEDIUM, onboardUrl.c_str());
  if (qrResult < 0)
    qrResult = qrcode_initText(&qrcode, qrcodeData, 5, ECC_MEDIUM, onboardUrl.c_str());

  // Portrait : titre en haut, QR au centre, code + MAC en bas
  auto setP = [buf](int x, int y) {
    if (x < 0 || x >= E27_WIDTH || y < 0 || y >= E27_HEIGHT) return;
    int xr = E27_WIDTH - 1 - x;
    buf[(xr / 8) + y * (E27_WIDTH / 8)] &= ~(0x80 >> (xr & 7));
  };
  auto drawCharP = [&](int x, int y, char c) {
    int idx = charIndex(c);
    for (int col = 0; col < 5; col++) {
      uint8_t bits = pgm_read_byte(&FONT_5x7[idx][col]);
      for (int row = 0; row < 7; row++) {
        if (bits & (0x40 >> row)) setP(x + col, y + row);
      }
    }
  };
  auto drawStrP = [&](int x, int y, const String& s) {
    int cx = x;
    for (unsigned int i = 0; i < s.length(); i++) { drawCharP(cx, y, s[i]); cx += 6; }
  };
  auto strW = [](const String& s) { return (int)s.length() * 6; };

  String title = "PROOF-OF-DRAW";
  drawStrP((E27_WIDTH - strW(title)) / 2, 8, title);
  drawStrP((E27_WIDTH - strW("SCAN TO PAIR")) / 2, 20, "SCAN TO PAIR");

  if (qrResult >= 0) {
    const int qz = 2, scale = 3;
    int qrPx = (qrcode.size + qz * 2) * scale;
    int qrX0 = (E27_WIDTH - qrPx) / 2, qrY0 = 38;
    for (int my = 0; my < qrcode.size; my++) {
      for (int mx = 0; mx < qrcode.size; mx++) {
        if (!qrcode_getModule(&qrcode, mx, my)) continue;
        for (int dy = 0; dy < scale; dy++)
          for (int dx = 0; dx < scale; dx++)
            setP(qrX0 + (mx + qz) * scale + dx, qrY0 + (my + qz) * scale + dy);
      }
      yield();
    }
  }

  String macShort = mac; macShort.replace(":", ""); macShort.toUpperCase();
  String codeLine = "CODE: " + code;
  String macLine  = "MAC: " + macShort;

  drawStrP((E27_WIDTH - strW(codeLine)) / 2, 210, codeLine);
  drawStrP((E27_WIDTH - strW(macLine))  / 2, 226, macLine);

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

  String pubHex      = keysLoaded ? bytesToHex(publicKey, 32) : "";
  String ownedHashes = loadOwnedHashesJson();
  String body =
    "{\"mac\":\"" + mac + "\","
    "\"screens\":[\"" + String(SCREEN_TYPE) + "\"],"
    "\"firmware\":\"" + String(FIRMWARE_VERSION) + "\","
    "\"publicKey\":\"" + pubHex + "\","
    "\"ownedHashes\":" + ownedHashes + "}";

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
    displayKeyMaterialOnce();
    String onboardUrl = String(SERVER_URL) + "/onboard?code=" + pairCode;
    displayOnboardingE27(onboardUrl, pairCode, mac);
    setOnboardingShown();
    Serial.println("[REGISTER] Restart dans 3s...");
    delay(3000);
    ESP.restart();
  } else if (!paired) {
    Serial.println("[REGISTER] Non appairé — ré-affichage QR...");
    String onboardUrl = String(SERVER_URL) + "/onboard?code=" + pairCode;
    displayOnboardingE27(onboardUrl, pairCode, mac);
  } else {
    Serial.println("[REGISTER] Déjà appairé");
  }

  return true;
}

// ─── FETCH FRAME ───────────────────────────────────────────────────────────
bool doFetchFrame(const String& frameId, const String& frameSource) {
  logHeapState("FETCHFRAME-BEFORE");

  uint8_t* e27Buf = (uint8_t*)malloc(E27_BUF_SIZE);
  if (!e27Buf) {
    Serial.println("[FETCHFRAME] malloc failed");
    return false;
  }
  memset(e27Buf, 0xFF, E27_BUF_SIZE);

  {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;

    String url = String(SERVER_URL) + "/api/pull-frame?deviceId=" + deviceId
                 + "&screen=" + String(SCREEN_TYPE) + "&fmt=bin";
    if (!http.begin(client, url)) {
      Serial.println("[FETCHFRAME] begin() failed");
      free(e27Buf);
      return false;
    }
    http.setTimeout(20000);
    http.useHTTP10(true);

    int code = http.GET();
    Serial.printf("[HTTP GET] /api/pull-frame → %d\n", code);

    if (code == 404) {
      http.end();
      Serial.println("[FETCHFRAME] Pas de frame");
      free(e27Buf);
      return true;
    }
    if (code != 200) {
      http.end();
      Serial.printf("[FETCHFRAME] HTTP error: %d\n", code);
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

    Serial.printf("[FETCHFRAME] lu=%u expected=%u\n", bRead, E27_BUF_SIZE);

    if (bRead != E27_BUF_SIZE) {
      Serial.println("[FETCHFRAME] lecture incomplète");
      free(e27Buf);
      return false;
    }
  }
  // TLS fermé — heap libéré avant l'affichage e-ink

  // Cartel paysage (bandes de métadonnées haut/bas)
  burnEinkCartel_landscape(e27Buf, pendingWorkTitle, pendingArtistName,
                           pendingDisplayTs, currentBlockIndex);

  if (!displayE27Buffer(e27Buf)) {
    Serial.println("[FETCHFRAME] display failed");
    free(e27Buf);
    return false;
  }

  // Conserve ce dessin (cartel inclus) dans la rotation locale des slots
  // KEY1-4, pour rappel ultérieur sans re-télécharger ni re-solliciter le réseau.
  saveCurrentFrameToSlot(e27Buf);

  free(e27Buf);

  lastFrameId           = frameId;
  hasDisplayedFrame     = true;
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId    = "";
  ackFrame(frameId);

  Serial.printf("[FETCHFRAME] ✅ frameId=%s source=%s\n",
                frameId.c_str(), frameSource.c_str());
  logHeapState("FETCHFRAME-AFTER");
  return true;
}

// ─── PULL ──────────────────────────────────────────────────────────────────
bool doPull() {
  logHeapState("PULL-BEFORE");

  String newFrameId     = "";
  String newFrameSource = "none";
  String newCandId      = "";
  String newBlockHash   = "";
  int    newBlockIndex  = -1;
  int    pullRetryAfter = 60;

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

    DynamicJsonDocument doc(2048);
    DeserializationError err = deserializeJson(doc, http.getStream());
    http.end();

    if (err) {
      Serial.print("[PULL] JSON error: "); Serial.println(err.c_str());
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
    pullRetryAfter = max(1, (int)(doc["retryAfter"] | 60));

    // Fallback frame{} pour frameId si absent à la racine
    if (newFrameId.length() == 0) {
      JsonObject frameObj = doc["frame"];
      if (!frameObj.isNull()) newFrameId = frameObj["frameId"] | "";
    }

    // Métadonnées cartel
    JsonObject cm = doc["cartelMeta"];
    if (!cm.isNull()) {
      const char* wt = cm["workTitle"]      | "";
      const char* an = cm["drawArtistName"] | "";
      const char* dt = cm["displayTs"]      | "";
      int         bi = cm["blockIndex"]     | -1;
      if (strlen(wt) > 0) pendingWorkTitle  = String(wt);
      else                 pendingWorkTitle  = "";
      if (strlen(an) > 0) pendingArtistName = String(an);
      else                 pendingArtistName = "";
      if (strlen(dt) > 0) pendingDisplayTs  = String(dt);
      if (bi >= 0)        currentBlockIndex = bi;
      Serial.printf("[PULL] cartel: title=%s artist=%s ts=%s bloc=%d\n",
                    wt, an, dt, bi);
    }

    // Tâche d'observation (Axe 3)
    JsonObject obs = doc["pendingObservation"];
    if (!obs.isNull()) {
      JsonArray hashes = obs["blockHashes"].as<JsonArray>();
      if (hashes.size() > 0) {
        String hashArr = "[";
        for (size_t i = 0; i < hashes.size(); i++) {
          if (i > 0) hashArr += ",";
          hashArr += "\""; hashArr += hashes[i].as<String>(); hashArr += "\"";
        }
        hashArr += "]";
        pendingObsHashes = hashArr;
        pendingObsTarget = String(obs["targetBlockHash"] | "");
      }
    }

    // Notification de bloc possédé (one-shot)
    const char* newlyOwned = doc["ownedBlock"] | "";
    if (strlen(newlyOwned) >= 16) {
      Serial.println("[OWNED] Nouveau bloc possédé: " + String(newlyOwned).substring(0, 12) + "...");
      saveOwnedBlockHash(String(newlyOwned));
    }
  }
  // TLS fermé

  // Ajuste l'intervalle de pull
  if (newFrameSource == "none" && newCandId.length() == 0) {
    nextPullIntervalMs = (unsigned long)pullRetryAfter * 1000UL;
  } else {
    nextPullIntervalMs = PULL_INTERVAL;
  }
  Serial.printf("[PULL] nextInterval=%lus (retryAfter=%d)\n",
                nextPullIntervalMs / 1000UL, pullRetryAfter);

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

  if (newFrameSource == "none" || newFrameId.length() == 0) {
    Serial.println("[PULL] Aucune frame");
    logHeapState("PULL-DONE-NONE");
    return true;
  }

  if (newFrameId == lastFrameId) {
    Serial.println("[PULL] Frame déjà affichée");
    return true;
  }

  Serial.printf("[PULL] Nouvelle frame frameId=%s source=%s → fetch\n",
                newFrameId.c_str(), newFrameSource.c_str());
  doFetchFrame(newFrameId, newFrameSource);
  return true;
}

// ─── OBS-CONFIRM (Axe 3) ─────────────────────────────────────────────────
bool doObsConfirm() {
  if (pendingObsHashes.length() == 0) return true;
  Serial.println("[OBS] Confirmation: " + pendingObsHashes);

  String body = "{\"deviceId\":\"" + deviceId
              + "\",\"blockHashes\":" + pendingObsHashes;
  if (pendingObsTarget.length() == 64)
    body += ",\"targetBlockHash\":\"" + pendingObsTarget + "\"";
  body += "}";

  String resp;
  bool ok = httpPost("/api/obs-confirm", body, resp);
  Serial.printf("[OBS] confirm → %s\n", ok ? "OK" : "FAIL");
  pendingObsHashes = "";
  pendingObsTarget = "";
  return ok;
}

// ─── VALIDATION ────────────────────────────────────────────────────────────
// Retourne true si un bloc vient d'être miné (quorum atteint).
bool doValidate() {
  if (pendingCandidateId.length() == 0) return false;

  Serial.println("[VALIDATE] Debut: " + pendingCandidateId);
  logHeapState("VALIDATE-BEFORE");

  // Pas de buffer pixel global à libérer (e-ink garde l'image sans alimentation).
  // Le heap est disponible directement pour les deux connexions TLS.

  String resp;
  bool ok = httpGet("/api/validate-candidate?deviceId=" + deviceId, resp);

  if (!ok || resp.length() == 0) {
    Serial.println("[VALIDATE] Echec HTTP");
    pendingCandidateId = "";
    logHeapState("VALIDATE-AFTER");
    return false;
  }

  DynamicJsonDocument doc(512);
  DeserializationError err = deserializeJson(doc, resp);
  resp = "";

  if (err) {
    Serial.print("[VALIDATE] JSON err: "); Serial.println(err.c_str());
    pendingCandidateId = "";
    logHeapState("VALIDATE-AFTER");
    return false;
  }

  if (doc["alreadyVoted"] | false) {
    Serial.println("[VALIDATE] Déjà voté");
    pendingCandidateId = "";
    logHeapState("VALIDATE-AFTER");
    return false;
  }

  if (doc["candidate"].isNull()) {
    Serial.println("[VALIDATE] Pas de candidat actif");
    pendingCandidateId = "";
    logHeapState("VALIDATE-AFTER");
    return false;
  }

  JsonObject cand    = doc["candidate"];
  String candidateId = cand["candidateId"] | "";

  if (candidateId.length() == 0) {
    Serial.println("[VALIDATE] candidateId absent");
    pendingCandidateId = "";
    logHeapState("VALIDATE-AFTER");
    return false;
  }

  float score = cand["score_server"] | 0.5f;
  Serial.printf("[VALIDATE] candidateId=%s score=%.3f\n", candidateId.c_str(), score);

  String signature = signED25519(candidateId, score);
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
  bool blockMined = false;

  if (vOk) {
    Serial.println("[VALIDATE] Vote OK");
    if (vResp.indexOf("\"blockMined\":true") >= 0) {
      Serial.println("[VALIDATE] BLOC MINE");
      blockMined = true;
    }
  } else {
    Serial.println("[VALIDATE] Echec vote");
    if (vResp.indexOf("Signature") >= 0) {
      Serial.println("[VALIDATE] Re-register pour resynchroniser publicKey...");
      doRegister();
      Serial.println("[VALIDATE] Re-register terminé — retry au prochain cycle");
    }
  }

  logHeapState("VALIDATE-AFTER");
  return blockMined;
}

// ─── SETUP ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] Proof-of-Draw eink27bw v2.0");

  eepromInit();

  // LittleFS : stockage local des 4 slots de rappel (KEY1-4)
  if (!LittleFS.begin()) {
    Serial.println("[FS] mount échoué — formatage...");
    LittleFS.format();
    LittleFS.begin();
  }
  setupButtons();

  // SPI init unique — pas de bascule I2C (écran unique)
  SPI.begin();

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

  // Migration V1 → ED25519 réel
  if (EEPROM.read(EEPROM_FLAG_OFF) == 0x01) {
    Serial.println("[KEYS] Clés V1 détectées — migration vers ED25519 réel");
    EEPROM.write(EEPROM_FLAG_OFF,       0x00);
    EEPROM.write(EEPROM_ONBOARDING_OFF, 0x00);
    EEPROM.commit();
  }

  // Clés ED25519 : générer ou charger AVANT tout register/TLS
  if (!keysAlreadyGenerated()) {
    generateKeys();
  } else {
    loadKeysFromEEPROM();
    Serial.println("[KEYS] Clés ED25519 chargées depuis EEPROM");
    Serial.println("[KEYS] PubKey: " + bytesToHex(publicKey, 32));
  }

  // BlockHash EEPROM : valider avant utilisation
  currentBlockHash = loadBlockHashFromEEPROM();
  {
    bool validHex = currentBlockHash.length() >= 8;
    for (unsigned int j = 0; j < currentBlockHash.length() && validHex; j++) {
      char c = currentBlockHash[j];
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
        validHex = false;
    }
    if (!validHex) currentBlockHash = "";
  }
  if (currentBlockHash.length() > 0)
    Serial.println("[CHAIN] BlockHash restauré: " + currentBlockHash);

  while (!registered) {
    if (doRegister()) break;
    delay(5000);
  }

  Serial.println("[BOOT] Premier pull immédiat...");
  doPull();

  lastPullMs     = millis();
  lastValidateMs = millis();
  Serial.println("[BOOT] Prêt. Pull dans " + String(PULL_INTERVAL / 1000) + "s");
}

// ─── LOOP ──────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // Boutons KEY1-4 : rappel de dessins stockés localement (toujours scruté,
  // mais honoré seulement quand le protocole et le rythme e-ink le permettent)
  pollButtons();

  if (!registered) {
    if (!doRegister()) { delay(5000); return; }
  }

  // Attente appairage
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

  // Pull périodique
  if (now - lastPullMs >= nextPullIntervalMs) {
    String prevCandidateId = pendingCandidateId;
    doPull();
    lastPullMs = millis();

    if (pendingCandidateId.length() > 0 && pendingCandidateId != prevCandidateId) {
      Serial.println("[LOOP] Nouveau candidat, reset timer validation");
      lastValidateMs = millis();
    }
  }

  // Observation (Axe 3)
  if (pendingObsHashes.length() > 0) {
    doObsConfirm();
  }

  // Validation candidat
  if (pendingCandidateId.length() > 0 &&
      millis() - lastValidateMs >= VALIDATE_INTERVAL) {
    bool blockMined = doValidate();
    lastValidateMs = millis();

    if (blockMined) {
      Serial.println("[LOOP] Bloc miné — pull immédiat");
      delay(2000);
      doPull();
      lastPullMs = millis();
    }
  }

  // Rappel de slot KEY1-4 : traité en dernier, donc seulement si aucun
  // nouveau dessin n'a sollicité l'écran ce tour-ci (priorité au protocole).
  processSlotRequest();

  delay(100);
}
