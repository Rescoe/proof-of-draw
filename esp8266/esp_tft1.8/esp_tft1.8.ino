// esp_tft1.8.ino
// Proof-of-Draw — Firmware TFT 1.8" (ST7735) sur ESP8266 NodeMCU
//
// Identique dans son fonctionnement aux firmwares e-ink :
//   1. Génération paire de clés ED25519 V1 au premier boot → EEPROM
//   2. Affichage onboarding QR + clés sur TFT (unique au premier boot)
//   3. Pull léger (metadata JSON) + fetch frame séparé (RGB565, streaming ligne/ligne)
//   4. Boucle validate → mine → pull immédiat
//   5. Ring buffer EEPROM pour blocs possédés (10 slots × 32 chars)
//   6. Carte SD pour log blocs possédés (frame RGB565 trop grande pour malloc/restore)
//
// Hardware :
//   ESP8266 NodeMCU — 3.3V logique → aucun convertisseur de tension requis
//   RB-TFT1.8 (ST7735) — 128×160 RGB565 — alim + logique 3.3V ✓
//
// Câblage NodeMCU ↔ RB-TFT1.8 (selon les labels sérigraphiés du module) :
//
//   ┌─ Connecteur TFT ──────────────────────────────────────────────────┐
//   │  VCC → 3.3V                                                       │
//   │  GND → GND                                                        │
//   │  CS  → D2  (GPIO4)                                                │
//   │  RES → D0  (GPIO16)                                               │
//   │  DC  → D1  (GPIO5)                                                │
//   │  SDA → D7  (GPIO13)  [HW SPI MOSI]                               │
//   │  SCL → D5  (GPIO14)  [HW SPI SCK]                                │
//   │  BLK → 3.3V          [rétroéclairage toujours allumé]            │
//   └───────────────────────────────────────────────────────────────────┘
//
//   ┌─ Connecteur SD card ──────────────────────────────────────────────┐
//   │  CS   → D4  (GPIO2)   [HIGH au boot → SD désélectionné ✓]       │
//   │  MOSI → D7  (GPIO13)  [même signal que TFT SDA — bus partagé]   │
//   │  SCLK → D5  (GPIO14)  [même signal que TFT SCL — bus partagé]   │
//   │  MISO → D6  (GPIO12)  [HW SPI MISO — absent côté TFT]           │
//   └───────────────────────────────────────────────────────────────────┘
//
//   Note : le bus SPI est physiquement partagé entre TFT et SD.
//   Le TFT utilise SOFTWARE SPI (bit-banging via digitalWrite) pour éviter
//   les conflits d'init avec la SD qui utilise le hardware SPI (SPI.begin).
//   Un switch explicite spiForSD() / spiForTFT() est nécessaire avant chaque
//   opération SD pour rendre GPIO13/14 au périphérique SPI puis les restituer.
//
// Format frame (pull-frame) :
//   /api/pull-frame?deviceId=...&screen=tft18&fmt=bin
//   → 40960 bytes RGB565 little-endian (128×160×2)
//   Convention little-endian : byte[off]=low, byte[off+1]=high
//   Avantage streaming : aucun malloc large — lecture et affichage ligne par ligne

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <SPI.h>
#include <SD.h>
#include <qrcode.h>
#include <EEPROM.h>
#include <Ed25519.h>       // Bibliothèque Crypto (rhempel) — ED25519 réel

// ─── CONFIG ────────────────────────────────────────────────────────────────
const char* WIFI_SSID = "Livebox-D190";
const char* WIFI_PASSWORD = "Q2gueWg3UaYJo2VN7C";


#define SERVER_URL        "https://proof-of-draw.vercel.app"
#define SCREEN_TYPE       "tft18"
#define FIRMWARE_VERSION  "tft18-1.0"
#define PULL_INTERVAL     60000UL   // 1 min
#define VALIDATE_INTERVAL 30000UL   // 30s

// ─── PINS NodeMCU ──────────────────────────────────────────────────────────
// Côté TFT :
#define TFT_CS   4   // CS  → D2 (GPIO4)
#define TFT_DC   5   // DC  → D1 (GPIO5)
#define TFT_RST  16  // RES → D0 (GPIO16)
#define TFT_MOSI 13  // SDA → D7 (GPIO13) — MOSI explicite pour SW SPI
#define TFT_SCK  14  // SCL → D5 (GPIO14) — SCK  explicite pour SW SPI

// Côté SD card :
#define SD_CS    2   // CS   → D4 (GPIO2) — GPIO2 HIGH au boot = SD désélectionné ✓
// SD MOSI → D7 (GPIO13) — même fil que TFT SDA (bus SPI partagé)
// SD SCLK → D5 (GPIO14) — même fil que TFT SCL (bus SPI partagé)
// SD MISO → D6 (GPIO12) — HW SPI MISO

// ─── SCREEN ────────────────────────────────────────────────────────────────
#define TFT_W           128
#define TFT_H           160
#define TFT_ROW_BYTES   (TFT_W * 2)              // 256 bytes par ligne RGB565
#define TFT_BUF_SIZE    (TFT_W * TFT_H * 2)     // 40960 bytes — RGB565 complet (référence SD)

// Couleurs web3/premium (RGB565)
#define C_BLACK   0x0000   // noir pur
#define C_WHITE   0xFFFF   // blanc pur
#define C_NAVY    0x08C5   // navy profond (#0a1828) — fond principal
#define C_GOLD    0xFEA0   // or (#FFD700) — accent premium
#define C_DARK    0x10C4   // surface sombre (#111827) — bandes cartel
#define C_GREY    0x7BEF   // gris moyen — texte secondaire

// ─── EEPROM layout (identique esp_eink_2.9BWR) ────────────────────────────
// [0..31]   : clé privée (32 bytes)
// [32..63]  : blockHash courant (32 hex chars)
// [64]      : keyGenerated flag
// [65..96]  : clé publique (32 bytes)
// [97]      : onboarding shown flag
// [98]      : owned_head   — index de tête du ring buffer (0-9)
// [99]      : owned_count  — nombre de slots valides (0-10)
// [100..419]: owned slots  — 10 × 32 bytes = 320 bytes
// [420..511]: réservé
#define EEPROM_SIZE           512
#define EEPROM_PRIVKEY_OFF    0
#define EEPROM_BLOCKHASH_OFF  32
#define EEPROM_FLAG_OFF       64
#define EEPROM_PUBKEY_OFF     65
#define KEY_GENERATED_FLAG    0xED   // 0xED = ED25519 réel (0x01 = ancienne V1 fake)
#define EEPROM_ONBOARDING_OFF 97
#define ONBOARDING_SHOWN_FLAG 0x01
#define EEPROM_OWNED_HEAD_OFF  98
#define EEPROM_OWNED_COUNT_OFF 99
#define EEPROM_OWNED_SLOTS_OFF 100
#define OWNED_SLOTS_MAX        10
#define OWNED_HASH_LEN         32   // 32 premiers chars du hash hex (64 chars complets)

// ─── SD paths ──────────────────────────────────────────────────────────────
#define SD_DIR        "/pod"
#define SD_FRAME_PATH "/pod/frame.bin"  // dernier frame RGB565 (40960 bytes) — non restauré au boot (malloc impossible)
#define SD_OWNED_PATH "/pod/owned.txt"  // hash complet 64 chars par ligne

// ─── OBJECTS ───────────────────────────────────────────────────────────────
// SOFTWARE SPI obligatoire : le hardware SPI (SD) et le software SPI (TFT)
// partagent GPIO13/14. SD.begin() appelle SPI.begin() qui reconfigure ces pins
// en mode périphérique SPI, rendant le software SPI inopérant sans un switch
// explicite. Solution validée : SW SPI pour TFT + spiForSD/spiForTFT wrappers.
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_MOSI, TFT_SCK, TFT_RST);
bool sdAvailable = false;

// ─── STATE ─────────────────────────────────────────────────────────────────
String deviceId, pairCode, canvasUrl;
bool   registered = false;
bool   paired     = false;
String lastFrameId           = "";
bool   hasDisplayedFrame     = false;
bool   lastFrameWasConsensus = false;

uint8_t privateKey[32];
uint8_t publicKey[32];
bool    keysLoaded = false;

String currentBlockHash  = "";
int    currentBlockIndex = -1;

String pendingCandidateId    = "";
unsigned long lastPullMs     = 0;
unsigned long lastValidateMs = 0;
unsigned long nextPullIntervalMs = PULL_INTERVAL;

String pendingWorkTitle  = "";
String pendingArtistName = "";
String pendingDisplayTs  = "";

String pendingObsHashes = "";
String pendingObsTarget = "";

bool qrDisplayed = false;  // true quand le QR d'onboarding est à l'écran

// ─── DEBUG HEAP ────────────────────────────────────────────────────────────
void logHeapState(const char* tag) {
  Serial.printf("[%s] heap=%u maxBlock=%u frag=%u%%\n",
                tag, ESP.getFreeHeap(),
                ESP.getMaxFreeBlockSize(),
                ESP.getHeapFragmentation());
}

// ─── EEPROM helpers (identiques 29BWR) ────────────────────────────────────
void eepromInit() { EEPROM.begin(EEPROM_SIZE); }

bool keysAlreadyGenerated()    { return EEPROM.read(EEPROM_FLAG_OFF) == KEY_GENERATED_FLAG; }
bool onboardingAlreadyShown()  { return EEPROM.read(EEPROM_ONBOARDING_OFF) == ONBOARDING_SHOWN_FLAG; }

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
  for (int i = 0; i < 32; i++) EEPROM.write(EEPROM_BLOCKHASH_OFF + i, (uint8_t)h[i]);
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

// ─── BLOCS POSSÉDÉS — EEPROM ring buffer (identique 29BWR) ────────────────

void saveOwnedBlockHash(const String& fullHash);  // forward décl. (appelle aussi SD)

void saveOwnedBlockHashEEPROM(const String& fullHash) {
  if (fullHash.length() < 16) return;

  String h = fullHash.length() >= OWNED_HASH_LEN
             ? fullHash.substring(0, OWNED_HASH_LEN)
             : fullHash;
  while ((int)h.length() < OWNED_HASH_LEN) h += ' ';

  uint8_t head  = EEPROM.read(EEPROM_OWNED_HEAD_OFF);
  uint8_t count = EEPROM.read(EEPROM_OWNED_COUNT_OFF);
  if (head  >= OWNED_SLOTS_MAX) head  = 0;
  if (count  > OWNED_SLOTS_MAX) count = 0;

  // Dédup : évite double écriture si re-notification
  for (uint8_t i = 0; i < count; i++) {
    uint8_t slot = (head - count + i + OWNED_SLOTS_MAX) % OWNED_SLOTS_MAX;
    int off = EEPROM_OWNED_SLOTS_OFF + slot * OWNED_HASH_LEN;
    bool match = true;
    for (int j = 0; j < OWNED_HASH_LEN && match; j++) {
      if ((char)EEPROM.read(off + j) != h[j]) match = false;
    }
    if (match) { Serial.println("[OWNED] EEPROM: déjà présent, skip"); return; }
  }

  int slotOff = EEPROM_OWNED_SLOTS_OFF + head * OWNED_HASH_LEN;
  for (int i = 0; i < OWNED_HASH_LEN; i++)
    EEPROM.write(slotOff + i, (uint8_t)h[i]);

  head  = (head + 1) % OWNED_SLOTS_MAX;
  count = min((int)count + 1, (int)OWNED_SLOTS_MAX);
  EEPROM.write(EEPROM_OWNED_HEAD_OFF,  head);
  EEPROM.write(EEPROM_OWNED_COUNT_OFF, count);
  EEPROM.commit();

  Serial.printf("[OWNED] EEPROM: %s... (%u/%u slots)\n",
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

// ─── SPI switch — obligatoire avant toute opération SD ou TFT ─────────────
//
// Problème : SD.begin() appelle SPI.begin() qui place GPIO13 (MOSI) et
// GPIO14 (SCK) en mode "périphérique SPI matériel". Dans cet état, les appels
// digitalWrite(13/14, ...) du software SPI TFT n'atteignent plus le pin physique
// (le périphérique SPI override la sortie GPIO). Le TFT devient muet.
//
// Solution : avant chaque bloc d'opérations SD, passer en hardware SPI ;
// après, libérer le périphérique et restaurer GPIO mode pour le software SPI TFT.

void spiForSD() {
  // Configure GPIO13/14 en mode périphérique SPI matériel pour la SD
  SPI.begin();
}

void spiForTFT() {
  // Libère le périphérique SPI matériel et restaure GPIO output pour SW SPI TFT
  SPI.end();
  delayMicroseconds(10);
  pinMode(TFT_MOSI, OUTPUT);
  pinMode(TFT_SCK,  OUTPUT);
  digitalWrite(TFT_CS, HIGH);   // TFT désélectionné
  digitalWrite(SD_CS,  HIGH);   // SD  désélectionné
}

// ─── SD helpers ────────────────────────────────────────────────────────────

void initSD() {
  spiForSD();
  sdAvailable = SD.begin(SD_CS);
  if (sdAvailable) {
    Serial.println("[SD] Carte OK");
    if (!SD.exists(SD_DIR)) SD.mkdir(SD_DIR);
  } else {
    Serial.println("[SD] Pas de carte — fonctionnement sans SD");
  }
  // Toujours restaurer le software SPI TFT après SD.begin()
  spiForTFT();
}

// Sauvegarde le dernier frame 1bpp sur SD (restauration au prochain boot).
void saveFrameToSD(const uint8_t* buf) {
  if (!sdAvailable) return;
  spiForSD();
  if (SD.exists(SD_FRAME_PATH)) SD.remove(SD_FRAME_PATH);
  File f = SD.open(SD_FRAME_PATH, FILE_WRITE);
  if (f) {
    f.write(buf, TFT_BUF_SIZE);
    f.close();
    Serial.println("[SD] frame.bin sauvegardé");
  } else {
    Serial.println("[SD] Impossible d'ouvrir frame.bin");
  }
  spiForTFT();
}

// Charge le dernier frame depuis SD dans buf (TFT_BUF_SIZE bytes).
// Retourne true si le fichier existait et avait la bonne taille.
bool loadFrameFromSD(uint8_t* buf) {
  if (!sdAvailable) return false;
  spiForSD();
  File f = SD.open(SD_FRAME_PATH, FILE_READ);
  if (!f) { spiForTFT(); return false; }
  size_t sz = f.size();
  if (sz != TFT_BUF_SIZE) { f.close(); spiForTFT(); return false; }
  f.read(buf, TFT_BUF_SIZE);
  f.close();
  spiForTFT();
  Serial.println("[SD] frame.bin restauré");
  return true;
}

// Ajoute le hash complet (64 chars) dans /pod/owned.txt — append illimité.
void saveOwnedHashToSD(const String& fullHash) {
  if (!sdAvailable || fullHash.length() < 16) return;
  spiForSD();
  File f = SD.open(SD_OWNED_PATH, FILE_WRITE);
  if (f) {
    String h = fullHash.length() > 64 ? fullHash.substring(0, 64) : fullHash;
    f.print(h);
    f.print(",");
    f.println(millis());
    f.close();
    Serial.printf("[SD] owned.txt: %s...\n", h.substring(0, 12).c_str());
  }
  spiForTFT();
}

// Sauvegarde dans EEPROM (ring buffer) ET dans SD (historique complet).
void saveOwnedBlockHash(const String& fullHash) {
  saveOwnedBlockHashEEPROM(fullHash);
  saveOwnedHashToSD(fullHash);
}

// ─── Génération de clés ED25519 réelle ───────────────────────────────────────

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
String signED25519(const String& candidateId, float score) {
  char scoreStr[8];
  dtostrf(score, 1, 3, scoreStr);
  String message = deviceId + ":" + candidateId + ":" + String(scoreStr);

  uint8_t sig[64];
  Ed25519::sign(sig, privateKey, publicKey,
                (const uint8_t*)message.c_str(), message.length());

  return bytesToHex(sig, 64);  // 128 chars hex
}

// ─── HTTP helpers (identiques 29BWR) ──────────────────────────────────────
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
  resp = (code > 0) ? http.getString() : "";
  http.end();
  Serial.printf("[HTTP GET] %s → %d (%u bytes)\n", path.c_str(), code, resp.length());
  return code == 200 || code == 429;
}

// ─── TFT DISPLAY ───────────────────────────────────────────────────────────

// Initialisation du TFT.
// Le RB-TFT1.8 (Joy-IT) requiert INITR_GREENTAB — confirmé par la doc officielle.
// Si l'image reste décalée de 2px, c'est normal avec GREENTAB (offset interne du contrôleur).
void initTFT() {
  // RB-TFT1.8 (Joy-IT / ST7735) — INITR_BLACKTAB : colstart=0, rowstart=0
  // Élimine le décalage 2px gauche / 1px haut produit par INITR_GREENTAB
  // (GREENTAB ajoute colstart=2, rowstart=1 qui décale l'image sur ce module)
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(0);  // portrait, câble en bas
  tft.fillScreen(C_BLACK);
  Serial.println("[TFT] initialisé 128×160 (BLACKTAB, offset corrigé)");
}

// Affiche un message de status centré — utilisé pendant le boot et les erreurs.
// Fond navy par défaut pour cohérence palette web3/premium.
void tftStatus(const String& line1, const String& line2 = "", uint16_t bg = C_NAVY) {
  tft.fillScreen(bg);

  // Mini barre RESCOE en haut
  tft.fillRect(0, 0, TFT_W, 14, C_DARK);
  tft.drawFastHLine(0, 14, TFT_W, C_GOLD);
  tft.setTextColor(C_GOLD, C_DARK);
  tft.setTextSize(1);
  tft.setCursor(3, 4);
  tft.print("RESCOE");

  // Message centré verticalement
  tft.setTextColor(C_WHITE, bg);
  tft.setTextSize(1);
  tft.setCursor(4, 72);
  tft.println(line1);
  if (line2.length() > 0) {
    tft.setTextColor(C_GREY, bg);
    tft.setCursor(4, 84);
    tft.println(line2);
  }
}

// Brûle les bandes cartel (header + footer 14px) directement sur le TFT.
// Appelé après renderFrameToTFT() — surimpose le texte sur l'artwork.
// Palette web3/premium : fond C_DARK, séparateur C_GOLD, "RESCOE" en or.
void burnTFTCartel() {
  const int BAND = 14;

  // ── Bande supérieure ──────────────────────────────────────────────────────
  tft.fillRect(0, 0, TFT_W, BAND, C_DARK);
  tft.drawFastHLine(0, BAND, TFT_W, C_GOLD);

  // "RESCOE" en or à gauche
  tft.setTextColor(C_GOLD, C_DARK);
  tft.setTextSize(1);
  tft.setCursor(3, 4);
  tft.print("RESCOE");

  // Numéro de bloc à droite (gris clair)
  if (currentBlockIndex >= 0) {
    String blk = "#" + String(currentBlockIndex);
    tft.setTextColor(C_GREY, C_DARK);
    int bx = TFT_W - (int)blk.length() * 6 - 3;
    if (bx < 50) bx = 50;
    tft.setCursor(bx, 4);
    tft.print(blk);
  }

  // ── Bande inférieure ──────────────────────────────────────────────────────
  int footerY = TFT_H - BAND;
  tft.fillRect(0, footerY, TFT_W, BAND, C_DARK);
  tft.drawFastHLine(0, footerY, TFT_W, C_GOLD);

  String botLine = "";
  if (pendingArtistName.length() > 0 && pendingWorkTitle.length() > 0)
    botLine = pendingArtistName + " \x7E " + pendingWorkTitle;  // tilde ~ comme séparateur
  else if (pendingArtistName.length() > 0) botLine = pendingArtistName;
  else if (pendingWorkTitle.length() > 0)  botLine = pendingWorkTitle;
  if (botLine.length() == 0) botLine = "Proof-of-Draw";
  if ((int)botLine.length() > 21) botLine = botLine.substring(0, 21);

  tft.setTextColor(C_WHITE, C_DARK);
  tft.setTextSize(1);
  tft.setCursor(3, footerY + 4);
  tft.print(botLine);
}

// Affiche un frame RGB565 depuis un buffer complet (restauration SD boot).
//
// ⚠️ ORDRE DES BYTES — explication complète :
//   Le serveur stocke le RGB565 en LITTLE-ENDIAN : buf[off]=LSB, buf[off+1]=MSB.
//   Le ST7735 attend les pixels en BIG-ENDIAN sur le bus SPI : high byte en premier.
//   writePixels() avec bigEndian=false tente de corriger l'ordre, MAIS le résultat
//   dépend de la version de la bibliothèque et du mode SPI (HW vs SW).
//
//   Solution sans ambiguïté : swapper explicitement les bytes avant writePixels(),
//   puis appeler writePixels(..., bigEndian=true) pour qu'il n'y ait AUCUN swap interne.
//   Ainsi : rowBuf[0]=MSB, rowBuf[1]=LSB → writePixels envoie MSB en premier ✓
//
// ⚠️ setAddrWindow(x, y, w, h) : w et h sont LARGEUR et HAUTEUR (pas des coords de fin).
void renderFrameToTFT(const uint8_t* frameBuf) {
  uint8_t rowBuf[TFT_ROW_BYTES];  // 256 bytes sur la stack pour le swap

  tft.startWrite();
  tft.setAddrWindow(0, 0, TFT_W, TFT_H);   // fenêtre exacte 128×160 ✓
  for (int y = 0; y < TFT_H; y++) {
    const uint8_t* src = frameBuf + y * TFT_ROW_BYTES;
    // Swap little-endian → big-endian pour le ST7735
    for (int i = 0; i < TFT_ROW_BYTES; i += 2) {
      rowBuf[i]     = src[i + 1]; // MSB en premier
      rowBuf[i + 1] = src[i];     // LSB en second
    }
    // bigEndian=true : pas de swap interne — les bytes sont déjà dans le bon ordre
    tft.writePixels((uint16_t*)rowBuf, TFT_W, true, true);
    yield();
  }
  tft.endWrite();
  burnTFTCartel();
}

// ─── AFFICHAGE ONBOARDING TFT ──────────────────────────────────────────────
void displayKeyMaterialOnce() {
  String pubHex  = bytesToHex(publicKey,  32);
  String privHex = bytesToHex(privateKey, 32);

  Serial.println("[KEYS] Public:  " + pubHex);
  Serial.println("[KEYS] Private: " + privHex);

  tft.fillScreen(C_WHITE);
  tft.setTextColor(C_BLACK, C_WHITE);
  tft.setTextSize(1);
  tft.setCursor(2, 2);
  tft.println("PROOF-OF-DRAW KEYS");

  // Ligne de séparation
  tft.drawFastHLine(0, 12, TFT_W, C_BLACK);

  tft.setCursor(2, 16);
  tft.println("PUBLIC KEY:");
  for (int line = 0; line < 4; line++) {
    tft.println(pubHex.substring(line * 16, line * 16 + 16));
  }

  // Clé privée en rouge (warning visuel)
  tft.setTextColor(0xF800, C_WHITE);
  tft.println("PRIVATE (ONCE!):");
  for (int line = 0; line < 4; line++) {
    tft.println(privHex.substring(line * 16, line * 16 + 16));
  }
  tft.setTextColor(C_BLACK, C_WHITE);
  tft.println("SAVE PRIVATE KEY !");

  Serial.println("[KEYS] Clés affichées — 60s pour noter");
  delay(60000);
  Serial.println("[KEYS] Délai écoulé");
}

void displayOnboardingTFT(const String& onboardUrl, const String& code, const String& mac) {
  Serial.println("[ONBOARD] displayOnboardingTFT() — url len=" + String(onboardUrl.length()));
  Serial.println("[ONBOARD] url: " + onboardUrl);

  // ── Fond navy ─────────────────────────────────────────────────────────────
  tft.fillScreen(C_NAVY);

  // ── Barre titre : "RESCOE" en or + "proof-of-draw" en gris ───────────────
  const int TITLE_H = 18;
  tft.fillRect(0, 0, TFT_W, TITLE_H, C_DARK);
  tft.drawFastHLine(0, TITLE_H, TFT_W, C_GOLD);

  tft.setTextSize(1);
  tft.setTextColor(C_GOLD, C_DARK);
  tft.setCursor(3, 3);
  tft.print("RESCOE");

  tft.setTextColor(C_GREY, C_DARK);
  tft.setCursor(52, 3);
  tft.print("proof-of-draw");

  // ── QR code — buffer v7, tentatives v3→v7 ECC_LOW ────────────────────────
  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(7)];
  memset(qrcodeData, 0, qrcode_getBufferSize(7));

  int qrResult = -1;
  for (int ver = 3; ver <= 7 && qrResult < 0; ver++) {
    qrResult = qrcode_initText(&qrcode, qrcodeData, ver, ECC_LOW, onboardUrl.c_str());
    Serial.printf("[ONBOARD] QR v%d ECC_LOW → %d\n", ver, qrResult);
  }

  if (qrResult >= 0) {
    Serial.printf("[ONBOARD] QR OK — size=%d modules\n", qrcode.size);

    // Zone QR : y=21..122 (101px) — fond blanc pour lisibilité scanner
    const int QR_ZONE_Y = 21;
    const int QR_ZONE_H = 96;
    int scale = min(QR_ZONE_H / qrcode.size, (TFT_W - 8) / qrcode.size);
    if (scale < 1) scale = 1;
    int qrPx = qrcode.size * scale;
    int qrX0 = (TFT_W - qrPx) / 2;
    int qrY0 = QR_ZONE_Y + (QR_ZONE_H - qrPx) / 2;

    // Quiet zone blanche (4px margin) pour lisibilité maximale
    tft.fillRect(qrX0 - 4, qrY0 - 4, qrPx + 8, qrPx + 8, C_WHITE);

    for (int qy = 0; qy < qrcode.size; qy++) {
      for (int qx = 0; qx < qrcode.size; qx++) {
        uint16_t c = qrcode_getModule(&qrcode, qx, qy) ? C_BLACK : C_WHITE;
        if (scale == 1) {
          tft.drawPixel(qrX0 + qx, qrY0 + qy, c);
        } else {
          tft.fillRect(qrX0 + qx * scale, qrY0 + qy * scale, scale, scale, c);
        }
      }
      yield();
    }

    // ── Code pair en or, centré sous le QR ───────────────────────────────────
    int codeY = QR_ZONE_Y + QR_ZONE_H + 5;  // y=122
    tft.setTextColor(C_GOLD, C_NAVY);
    tft.setTextSize(2);
    int codeX = (TFT_W - (int)code.length() * 12) / 2;
    if (codeX < 0) codeX = 0;
    tft.setCursor(codeX, codeY);
    tft.print(code);

    // MAC compacte en gris en bas
    String macShort = mac;
    macShort.replace(":", "");
    macShort.toUpperCase();
    tft.setTextSize(1);
    tft.setTextColor(C_GREY, C_NAVY);
    int macX = (TFT_W - (int)(4 + macShort.length()) * 6) / 2;
    if (macX < 2) macX = 2;
    tft.setCursor(macX, codeY + 20);
    tft.print("MAC:" + macShort);

  } else {
    // ── Fallback texte : QR impossible — affiche code pair en grand ──────────
    Serial.println("[ONBOARD] QR FAIL — fallback texte");

    tft.setTextColor(C_GREY, C_NAVY);
    tft.setTextSize(1);
    tft.setCursor(4, 26);
    tft.println("Ouvrez ce lien :");

    // URL sur 2 lignes max
    tft.setTextColor(C_WHITE, C_NAVY);
    tft.setCursor(2, 38);
    tft.println(onboardUrl.substring(0, 21));
    if (onboardUrl.length() > 21) {
      tft.setCursor(2, 48);
      tft.println(onboardUrl.substring(21, 42));
    }

    tft.drawFastHLine(0, 62, TFT_W, C_GOLD);

    // Code pair en or, taille 3
    tft.setTextColor(C_GOLD, C_NAVY);
    tft.setTextSize(3);
    int codeX = (TFT_W - (int)code.length() * 18) / 2;
    if (codeX < 0) codeX = 0;
    tft.setCursor(codeX, 72);
    tft.print(code);

    tft.setTextSize(1);
    tft.setTextColor(C_GREY, C_NAVY);
    tft.setCursor(4, 114);
    tft.print("Entrez ce code sur");
    tft.setCursor(4, 124);
    tft.print("le site pour appairer");

    String macShort = mac;
    macShort.replace(":", "");
    macShort.toUpperCase();
    tft.setCursor(2, 140);
    tft.print("MAC:" + macShort);
  }

  qrDisplayed = true;  // flag : ne pas effacer lors des re-checks d'appairage
  Serial.println("[ONBOARD] Affichage terminé");
}

// ─── OBS-CONFIRM ───────────────────────────────────────────────────────────
bool doObsConfirm() {
  if (pendingObsHashes.length() == 0) return true;

  String body = "{\"deviceId\":\"" + deviceId
              + "\",\"blockHashes\":" + pendingObsHashes;
  if (pendingObsTarget.length() == 64)
    body += ",\"targetBlockHash\":\"" + pendingObsTarget + "\"";
  body += "}";

  String resp;
  bool ok = httpPost("/api/obs-confirm", body, resp);
  Serial.printf("[OBS-CONFIRM] ok=%d resp=%s\n", ok, resp.c_str());
  pendingObsHashes = "";
  pendingObsTarget = "";
  return ok;
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

// ─── REGISTER ───────────────────────────────────────────────────────────────
bool doRegister() {
  String mac = WiFi.macAddress();
  mac.toLowerCase();

  String pubHex      = keysLoaded ? bytesToHex(publicKey, 32) : "";
  String ownedHashes = loadOwnedHashesJson();
  String body = "{\"mac\":\"" + mac + "\",\"screens\":[\"" + SCREEN_TYPE + "\"],"
                "\"firmware\":\"" + String(FIRMWARE_VERSION) + "\","
                "\"publicKey\":\"" + pubHex + "\","
                "\"ownedHashes\":" + ownedHashes + "}";
  String resp;

  Serial.printf("[REGISTER] heap avant: %u\n", ESP.getFreeHeap());
  // Ne pas écraser le QR d'onboarding si déjà affiché (re-check appairage)
  if (!qrDisplayed) {
    tftStatus("Enregistrement...", "");
  }

  if (!httpPost("/api/register", body, resp)) {
    Serial.println("[REGISTER] Echec HTTP");
    tftStatus("Register echoue", "Retry 5s...", 0xF800);
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
    if (!keysAlreadyGenerated()) generateKeys();
    displayKeyMaterialOnce();
    String onboardUrl = String(SERVER_URL) + "/onboard?code=" + pairCode;
    displayOnboardingTFT(onboardUrl, pairCode, mac);
    setOnboardingShown();
    Serial.println("[REGISTER] Onboarding affiché — restart dans 3s");
    delay(3000);
    ESP.restart();
  } else if (!paired) {
    Serial.println("[REGISTER] Attente appairage...");
    displayOnboardingTFT(String(SERVER_URL) + "/onboard?code=" + pairCode, pairCode, mac);
  } else {
    Serial.println("[REGISTER] Déjà appairé");
    qrDisplayed = false;
    tftStatus("Connecte", deviceId.length() > 0 ? deviceId : "");
  }

  return true;
}

// ─── FETCH FRAME ────────────────────────────────────────────────────────────
// Streaming ligne par ligne RGB565 — AUCUN malloc TFT_BUF_SIZE (40960 bytes).
// Un seul rowBuf[256] sur la stack, lu depuis le stream réseau puis envoyé
// directement au TFT via SW SPI. Limite mémoire ESP8266 respectée.
bool doFetchFrame(const String& frameId, const String& frameSource) {
  logHeapState("FETCHFRAME-BEFORE");

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  String url = String(SERVER_URL) + "/api/pull-frame?deviceId=" + deviceId
               + "&screen=" + String(SCREEN_TYPE) + "&fmt=bin";

  if (!http.begin(client, url)) {
    Serial.println("[FETCHFRAME] begin() failed");
    return false;
  }
  http.setTimeout(25000);
  http.useHTTP10(true);

  int code = http.GET();
  Serial.printf("[HTTP GET] /api/pull-frame (tft18 RGB565 %uB) → %d\n",
                (unsigned)TFT_BUF_SIZE, code);

  if (code == 404) {
    http.end();
    Serial.println("[FETCHFRAME] Pas de frame disponible");
    return true;
  }
  if (code != 200) {
    http.end();
    Serial.printf("[FETCHFRAME] HTTP error: %d\n", code);
    return false;
  }

  // ── Streaming ligne par ligne ─────────────────────────────────────────────
  // Chaque ligne = TFT_ROW_BYTES (256 bytes) lu depuis le stream HTTP,
  // puis écrit immédiatement au ST7735 via writePixels.
  // La fenêtre d'adresse couvre l'écran entier — le contrôleur avance
  // automatiquement de ligne en ligne sans re-envoyer CASET/RASET.
  WiFiClient* stream = http.getStreamPtr();
  uint8_t rowBuf[TFT_ROW_BYTES];  // 256 bytes sur la stack — sûr ✓
  size_t totalRead = 0;
  bool   success   = true;
  unsigned long t0 = millis();

  tft.startWrite();
  tft.setAddrWindow(0, 0, TFT_W, TFT_H);   // w=128, h=160 — largeur/hauteur, pas coords de fin ✓

  for (int y = 0; y < TFT_H; y++) {
    size_t rowRead = 0;
    unsigned long rowT0 = millis();

    // Lire exactement TFT_ROW_BYTES depuis le stream (timeout 4s par ligne)
    while (rowRead < (size_t)TFT_ROW_BYTES && millis() - rowT0 < 4000) {
      if (stream->available()) {
        rowRead += stream->readBytes(rowBuf + rowRead, TFT_ROW_BYTES - rowRead);
      } else {
        delay(2);
      }
    }

    if (rowRead != (size_t)TFT_ROW_BYTES) {
      Serial.printf("[FETCHFRAME] ligne %d: lu=%u/%u — timeout\n",
                    y, rowRead, TFT_ROW_BYTES);
      success = false;
      break;
    }

    // Swap little-endian (serveur) → big-endian (ST7735 attend MSB en premier sur SPI).
    // On fait le swap ici explicitement et on passe bigEndian=true pour qu'il n'y ait
    // AUCUN swap interne dans writePixels — résultat sans ambiguïté quelle que soit
    // la version de la bibliothèque Adafruit.
    for (int i = 0; i < TFT_ROW_BYTES; i += 2) {
      uint8_t t   = rowBuf[i];
      rowBuf[i]   = rowBuf[i + 1]; // MSB en premier
      rowBuf[i+1] = t;             // LSB en second
    }
    tft.writePixels((uint16_t*)rowBuf, TFT_W, true, true); // bigEndian=true ✓
    totalRead += rowRead;
    yield();  // watchdog ESP8266
  }

  tft.endWrite();
  http.end();

  Serial.printf("[FETCHFRAME] lu=%u/%u en %lums — %s\n",
                totalRead, (unsigned)TFT_BUF_SIZE, millis() - t0,
                success ? "OK" : "INCOMPLET");

  if (!success) {
    Serial.println("[FETCHFRAME] stream incomplet — frame partielle abandonnée");
    return false;
  }

  // Superposer le cartel (header RESCOE + footer artiste/titre)
  burnTFTCartel();

  hasDisplayedFrame     = true;
  lastFrameId           = frameId;
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId    = "";

  ackFrame(frameId);

  Serial.printf("[FETCHFRAME] ✅ frameId=%s source=%s\n",
                frameId.c_str(), frameSource.c_str());
  logHeapState("FETCHFRAME-AFTER");
  return true;
}

// ─── PULL ───────────────────────────────────────────────────────────────────
bool doPull() {
  logHeapState("PULL-BEFORE");

  String newBlockHash   = "";
  int    newBlockIndex  = -1;
  String newCandId      = "";
  String newFrameId     = "";
  String newFrameSource = "none";
  int    pullRetryAfter = 60;

  {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;

    String url = String(SERVER_URL) + "/api/pull?deviceId=" + deviceId;
    if (!http.begin(client, url)) {
      Serial.println("[PULL] begin() failed");
      return false;
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
      return false;
    }

    DynamicJsonDocument doc(2048);
    DeserializationError err = deserializeJson(doc, http.getStream());
    http.end();

    if (err) {
      Serial.print("[PULL] JSON error: "); Serial.println(err.c_str());
      return false;
    }

    // ── Chaîne ────────────────────────────────────────────────────────────
    JsonObject chain = doc["chain"];
    if (!chain.isNull()) {
      newBlockHash  = chain["blockHash"]  | "";
      newBlockIndex = chain["blockIndex"] | -1;
    }

    // ── Candidat de validation ────────────────────────────────────────────
    JsonObject pend = doc["pendingValidation"];
    if (!pend.isNull()) newCandId = pend["candidateId"] | "";

    // ── Frame ─────────────────────────────────────────────────────────────
    newFrameSource = doc["frameSource"] | "none";
    newFrameId     = doc["frameId"]     | "";
    pullRetryAfter = doc["retryAfter"]  | 60;
    if (pullRetryAfter <= 0) pullRetryAfter = 60;

    if (newFrameId.length() == 0) {
      JsonObject frameObj = doc["frame"];
      if (!frameObj.isNull()) newFrameId = frameObj["frameId"] | "";
    }

    // ── Métadonnées cartel ────────────────────────────────────────────────
    JsonObject cm = doc["cartelMeta"];
    if (!cm.isNull()) {
      pendingWorkTitle  = cm["workTitle"]      | "";
      pendingArtistName = cm["drawArtistName"] | "";
      pendingDisplayTs  = cm["displayTs"]      | "";
      currentBlockIndex = cm["blockIndex"]     | currentBlockIndex;
      Serial.printf("[PULL] cartel: title=%s artist=%s ts=%s bloc=%d\n",
                    pendingWorkTitle.c_str(), pendingArtistName.c_str(),
                    pendingDisplayTs.c_str(), currentBlockIndex);
    }

    // ── Tâche d'observation (Axe 3) ───────────────────────────────────────
    JsonObject obs = doc["pendingObservation"];
    if (!obs.isNull()) {
      JsonArray hArr = obs["blockHashes"].as<JsonArray>();
      if (hArr.size() > 0) {
        String hashArr = "[";
        for (size_t i = 0; i < hArr.size(); i++) {
          if (i > 0) hashArr += ",";
          hashArr += "\""; hashArr += hArr[i].as<String>(); hashArr += "\"";
        }
        hashArr += "]";
        pendingObsHashes = hashArr;
        pendingObsTarget = obs["targetBlockHash"] | "";
        Serial.printf("[PULL] obsTask hashes=%u\n", hArr.size());
      }
    }

    // ── Bloc nouvellement possédé (one-shot) ──────────────────────────────
    const char* newlyOwned = doc["ownedBlock"] | "";
    if (strlen(newlyOwned) >= 16) {
      Serial.println("[OWNED] Nouveau bloc possédé: " + String(newlyOwned).substring(0, 12) + "...");
      saveOwnedBlockHash(String(newlyOwned));
    }
  }
  // TLS fermé

  // Adapte l'intervalle de pull selon activité serveur
  nextPullIntervalMs = (newFrameSource == "none" && newCandId.length() == 0)
                     ? (unsigned long)pullRetryAfter * 1000UL
                     : PULL_INTERVAL;
  Serial.printf("[PULL] nextInterval=%lus\n", nextPullIntervalMs / 1000UL);

  // Nouveau bloc chaîne
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
    return true;
  }

  if (newFrameId == lastFrameId) {
    Serial.println("[PULL] Frame déjà affichée");
    return true;
  }

  Serial.printf("[PULL] Nouvelle frame frameId=%s source=%s\n",
                newFrameId.c_str(), newFrameSource.c_str());

  doFetchFrame(newFrameId, newFrameSource);
  return true;
}

// ─── VALIDATION (identique 29BWR — V1 echo score_server) ──────────────────
bool doValidate() {
  if (pendingCandidateId.length() == 0) return false;

  Serial.println("[VALIDATE] Debut: " + pendingCandidateId);
  logHeapState("VALIDATE-BEFORE");

  // Pas de frameBuf à libérer ici (contrairement à 29BWR) — TFT ne garde
  // pas de buffer RAM persistant, l'image reste dans le controller.

  String resp;
  bool ok = httpGet("/api/validate-candidate?deviceId=" + deviceId, resp);

  if (!ok || resp.length() == 0) {
    Serial.println("[VALIDATE] Echec HTTP");
    pendingCandidateId = "";
    return false;
  }

  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, resp)) {
    Serial.println("[VALIDATE] JSON error");
    pendingCandidateId = "";
    return false;
  }

  if (doc["alreadyVoted"] | false) {
    Serial.println("[VALIDATE] Déjà voté");
    pendingCandidateId = "";
    return false;
  }

  if (doc["candidate"].isNull()) {
    Serial.println("[VALIDATE] Pas de candidat actif");
    pendingCandidateId = "";
    return false;
  }

  JsonObject cand    = doc["candidate"];
  String candidateId = cand["candidateId"] | "";

  if (candidateId.length() == 0) {
    pendingCandidateId = "";
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
  }

  logHeapState("VALIDATE-AFTER");
  return blockMined;
}

// ─── SETUP ──────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] Proof-of-Draw TFT 1.8\" v1.0");

  eepromInit();

  // TFT en premier — affiche le boot screen pendant la connexion WiFi
  initTFT();
  tftStatus("Proof-of-Draw", "Connexion WiFi...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Connexion");
  int i = 0;
  while (WiFi.status() != WL_CONNECTED && i++ < 40) {
    delay(500); Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WIFI] IP: " + WiFi.localIP().toString());
    tftStatus("WiFi OK", WiFi.localIP().toString());
  } else {
    Serial.println("[WIFI] Echec connexion");
    tftStatus("WiFi FAIL", "Redemarrage...", 0xF800);
    delay(3000);
    ESP.restart();
  }
  Serial.printf("[HEAP] après WiFi: %u bytes\n", ESP.getFreeHeap());

  // SD card — après TFT, avant le premier fetch réseau
  initSD();

  // Migration V1 → ED25519 réel
  if (EEPROM.read(EEPROM_FLAG_OFF) == 0x01) {
    Serial.println("[KEYS] Clés V1 détectées — migration vers ED25519 réel");
    EEPROM.write(EEPROM_FLAG_OFF,       0x00);
    EEPROM.write(EEPROM_ONBOARDING_OFF, 0x00);
    EEPROM.commit();
  }

  // Chargement clés EEPROM
  if (keysAlreadyGenerated()) {
    loadKeysFromEEPROM();
    Serial.println("[KEYS] Clés ED25519 chargées: " + bytesToHex(publicKey, 32));
  }

  // Restauration blockHash EEPROM
  currentBlockHash = loadBlockHashFromEEPROM();
  if (currentBlockHash.length() > 0)
    Serial.println("[CHAIN] BlockHash restauré: " + currentBlockHash);

  // Restauration dernière frame depuis SD — désactivée en RGB565 (TFT_BUF_SIZE=40960B).
  // malloc(40960) échouerait sur ESP8266 (heap ~30KB après BearSSL).
  // La frame sera rechargée au premier pull réseau.
  // (Code conservé pour référence — ré-activer si streaming SD implémenté.)
  //
  // if (sdAvailable) {
  //   uint8_t* restoreBuf = (uint8_t*)malloc(TFT_BUF_SIZE);
  //   if (restoreBuf) {
  //     if (loadFrameFromSD(restoreBuf)) {
  //       renderFrameToTFT(restoreBuf);
  //       hasDisplayedFrame = true;
  //       Serial.println("[BOOT] Frame restaurée depuis SD");
  //     }
  //     free(restoreBuf);
  //   }
  // }

  // Register (TLS)
  while (!registered) {
    if (doRegister()) break;
    delay(5000);
  }

  if (paired) {
    Serial.println("[BOOT] Premier pull immédiat...");
    doPull();
  }

  lastPullMs     = millis();
  lastValidateMs = millis();
  Serial.println("[BOOT] Prêt. Pull dans " + String(PULL_INTERVAL / 1000) + "s");
}

// ─── LOOP ────────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // Re-registration si perdu
  if (!registered) {
    if (!doRegister()) { delay(5000); return; }
  }

  // Attente appairage
  if (!paired) {
    if (now - lastPullMs >= 60000UL) {
      bool wasPaired = paired;
      doRegister();
      lastPullMs = millis();
      if (!wasPaired && paired) {
        Serial.println("[PAIRING] Appairage → restart");
        delay(1000); ESP.restart();
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
      Serial.println("[LOOP] Nouveau candidat — reset timer validation");
      lastValidateMs = millis();
    }
  }

  // Revalidation (Axe 3)
  if (pendingObsHashes.length() > 0) doObsConfirm();

  // Validation candidat
  if (pendingCandidateId.length() > 0 &&
      millis() - lastValidateMs >= VALIDATE_INTERVAL) {

    bool blockMined = doValidate();
    lastValidateMs = millis();

    if (blockMined) {
      Serial.println("[LOOP] Bloc miné — pull immédiat");
      delay(2000);  // laisse BearSSL libérer ses buffers TLS
      doPull();
      lastPullMs = millis();
    }
  }

  delay(100);
}
