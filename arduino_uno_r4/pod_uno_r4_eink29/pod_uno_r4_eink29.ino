// pod_uno_r4_eink29.ino
// Proof-of-Draw — Firmware UNO R4 WiFi + écran e-ink Waveshare 2.9" module B (noir / blanc / rouge, 296×128)
//
// Même protocole et même type d'écran serveur (« eink29bwr ») que esp8266/esp_eink_2.9BWR :
//   register → pull (métadonnées ~300 o) → pull-frame?fmt=bin (9472 o : noir 4736 + rouge 4736) → affichage → ACK,
//   validation distribuée (validate-candidate → vote signé Ed25519 → validation-result), ré-validation (obs-confirm), blocs possédés.
// Le serveur ne change pas : cet appareil est un écran eink29bwr comme les autres.
//
// Différences avec l'ESP8266 (toutes voulues) :
//   • Wi-Fi/TLS sur le coprocesseur ESP32-S3 (WiFiSSLClient) : plus de BearSSL dans la RAM → pas de free()/malloc() des buffers autour
//     des connexions ; les deux plans pixel (2 × 4736 o) sont des tampons STATIQUES ;
//   • lecture du flux par pod_http.h (lecture « readFull » sur réponse fragmentée, chunked accepté), identique au firmware TFT ;
//   • pile principale de 1 Ko seulement sur la R4 (cœur Arduino) : aucun gros tableau local, tout est statique ;
//   • la dernière image reste affichée (e-ink) ET son frameId est mémorisé en EEPROM : un redémarrage ne ré-affiche pas (et ne re-ACK pas)
//     une œuvre déjà à l'écran. Le frameId est effacé dès qu'un écran d'appairage remplace l'œuvre ;
//   • le cartel est dessiné dans le repère de l'IMAGE du serveur (haut = haut), voir setPix() ;
//   • pas de seconde connexion pendant un rafraîchissement : l'écran e-ink bloque ~15 s, le réseau n'est pas touché pendant ce temps.
//
// Câblage (module 8 fils → UNO R4 WiFi) : VCC→3.3V · GND→GND · DIN→D11 · CLK→D13 · CS→D10 · DC→D9 · RST→D8 · BUSY→D7
// Bibliothèques : ArduinoJson (≥ 6, testé 7.x), QRCode (ricmoo), Crypto (rweather), WiFiS3 / SPI / EEPROM (fournies avec le cœur R4).
// Carte : « Arduino UNO R4 WiFi ». Moniteur série : 115200.
// Wi-Fi : copier secrets.h.example en secrets.h (ignoré par git) puis renseigner SSID / mot de passe (2,4 GHz).
//
// ⚠ TLS : le coprocesseur vérifie le certificat avec son lot de certificats racine. Si « connexion TLS impossible » s'affiche,
//   mettre à jour le firmware du module Wi-Fi (IDE → Outils → Updater le firmware).

#include <Arduino.h>
#include <malloc.h>
#include <stdarg.h>
#include <WiFiS3.h>
#include <SPI.h>
#include <EEPROM.h>
#include <ArduinoJson.h>
#include <qrcode.h>
#include <Ed25519.h>
#include <SHA256.h>
#include "pod_http.h"
#include "epd29b.h"
#include "pod_vote_r4.h"       // validation réelle (vote v2) : SHA-256 + métriques entières en flux — ⚠ NON TESTÉ sur la carte

// POD_RENDER_V1_BEGIN
// ─── Rendu v1 EN FLUX (lot 8B-2A) — INACTIF PAR DÉFAUT ────────────────────────────────────────────────────────────────────────────────────────────
// 0 (défaut) : comportement d'avant, octet pour octet (cartel gravé par burnCartel dans blackBuf, epd.display des plans complets).
// 1 : l'image reçue (blackBuf / redBuf, JAMAIS modifiés) est rendue par le noyau gelé consensus-pod/src/podRenderStream.h (layoutVersion 1 : cartel, fit) et remise au pilote PAR MORCEAUX de 32 octets
//     (Epd29b::displayStream) ; frameHash (octets reçus) et renderHash (octets remis) sont CALCULÉS et seulement journalisés — l'ACK, les routes et le rapport de rendu ne sont PAS modifiés.
// ⚠ NON ESSAYÉ SUR LA CARTE. Ne pas activer sans le lot 8B-2B (canari) : docs/LOT_8B2A_INTEGRATION_CANARIS_2026_10_08.md.
#ifndef POD_RENDER_V1
#define POD_RENDER_V1 0
#endif
#ifndef POD_RENDER_MODE_DEFAULT
#define POD_RENDER_MODE_DEFAULT POD_R_FIT   // constante de compilation : le réglage cartelMode n'est PAS exposé (pas d'interface, pas de réglage serveur)
#endif
#if POD_RENDER_V1
#include "podRenderStream.h"
#include "crypto_uno_r4.h"
#endif
// POD_RENDER_V1_END

// ─── CONFIG ────────────────────────────────────────────────────────────────
#if __has_include("secrets.h")
  #include "secrets.h"
  const char* WIFI_SSID     = SECRET_WIFI_SSID;
  const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;
#else
  const char* WIFI_SSID     = "";            // ← renseigner (ou créer secrets.h)
  const char* WIFI_PASSWORD = "";
#endif

#define SERVER_HOST         "proof-of-draw.vercel.app"
#define SCREEN_TYPE         "eink29bwr"            // profil serveur 296×128 noir/blanc/rouge (lib/screenProfiles.ts)
#define FIRMWARE_VERSION    "r4eink29-1.1"
#define PULL_INTERVAL       60000UL                // 1 min
#define VALIDATE_INTERVAL   30000UL                // 30 s : candidat en attente
#define HTTP_TIMEOUT_MS     20000UL
#define EINK_MIN_REFRESH_MS 10000UL                // jamais deux rafraîchissements à moins de 10 s (durée de vie du panneau)
#define CLEAR_BEFORE_IMAGE  1                      // page blanche avant chaque nouvelle œuvre (comme l'ESP) : limite les rémanences, +15 s

// ─── GÉOMÉTRIE ─────────────────────────────────────────────────────────────
#define IMG_W    296                               // image du serveur (paysage)
#define IMG_H    128
#define BUF_SIZE EPD_BUF_SIZE                      // 4736 = 16 octets × 296 lignes
#define FRAME_BYTES (BUF_SIZE * 2)                 // 9472

// ─── EEPROM (flash de données de la R4, pas de commit) — même carte mémoire que les firmwares ESP ─────────────
#define EEPROM_PRIVKEY_OFF     0
#define EEPROM_BLOCKHASH_OFF   32
#define EEPROM_FLAG_OFF        64
#define EEPROM_PUBKEY_OFF      65
#define KEY_GENERATED_FLAG     0xED
#define EEPROM_ONBOARDING_OFF  97
#define ONBOARDING_SHOWN_FLAG  0x01
#define EEPROM_OWNED_HEAD_OFF  98
#define EEPROM_OWNED_COUNT_OFF 99
#define EEPROM_OWNED_SLOTS_OFF 100
#define OWNED_SLOTS_MAX        10
#define OWNED_HASH_LEN         32
#define EEPROM_FRAMEID_OFF     420                 // 32 caractères : début du frameId affiché (zone « réservée » des ESP)
#define FRAMEID_LEN            32

#if ARDUINOJSON_VERSION_MAJOR >= 7
  #define JSON_DOC(name, cap) JsonDocument name
#else
  #define JSON_DOC(name, cap) DynamicJsonDocument name(cap)
#endif

// ─── OBJETS / ÉTAT ─────────────────────────────────────────────────────────
Epd29b epd;
static uint8_t blackBuf[BUF_SIZE];                 // 0 = noir
static uint8_t redBuf[BUF_SIZE];                   // 0 = rouge
unsigned long lastRefreshMs = 0;
bool hasRefreshed = false;
bool onboardingDrawn = false;                      // écran d'appairage déjà dessiné depuis ce démarrage

String deviceId, pairCode;
bool   registered = false, paired = false;
String lastFrameId = "";
bool   lastFrameWasConsensus = false;

uint8_t privateKey[32], publicKey[32];
bool    keysLoaded = false;

String currentBlockHash = "";
int    currentBlockIndex = -1;
String pendingCandidateId = "";
unsigned long lastPullMs = 0, lastValidateMs = 0, nextPullIntervalMs = PULL_INTERVAL;

String pendingWorkTitle = "", pendingArtistName = "", pendingDisplayTs = "";
String pendingObsHashes = "", pendingObsTarget = "";

static char g_body[3072];                          // corps JSON des réponses

// ─── LOG ───────────────────────────────────────────────────────────────────
static void logf(const char* fmt, ...) {
  static char b[256];                              // statique : la pile du cœur R4 ne fait que 1 Ko
  va_list ap; va_start(ap, fmt); vsnprintf(b, sizeof(b), fmt, ap); va_end(ap);
  Serial.println(b);
}

// ─── MÉMOIRE (cf. pod_uno_r4.ino : pile principale de 1 Ko, protection désactivée) ─────────
extern "C" char* sbrk(int incr);
extern char __HeapLimit;
static const uint32_t STACK_PAINT_BYTES = 2048;
static uint32_t freeHeapBytes() {
  struct mallinfo mi = mallinfo();
  return (uint32_t)mi.fordblks + (uint32_t)(&__HeapLimit - (char*)sbrk(0));
}
static void paintStack() { for (volatile uint8_t* p = (volatile uint8_t*)&__HeapLimit - STACK_PAINT_BYTES; p < (volatile uint8_t*)&__HeapLimit; p++) *p = 0xA5; }
static uint32_t stackDepthBytes() {
  const uint8_t* lo = (const uint8_t*)&__HeapLimit - STACK_PAINT_BYTES;
  const uint8_t* p = lo;
  while (p < (const uint8_t*)&__HeapLimit && *p == 0xA5) p++;
  return 1024 + (uint32_t)((const uint8_t*)&__HeapLimit - p);
}
static void reportMem(const char* tag) { logf("[MEM] %s: tas libre %lu o, pile max ~%lu o", tag, (unsigned long)freeHeapBytes(), (unsigned long)stackDepthBytes()); }

// ─── Texte : ASCII seulement (police 5×7, majuscules) — replie les accents UTF-8 ─────────────────
static String asciiFold(const String& in) {
  static const char* L1 = "AAAAAAACEEEEIIIIDNOOOOO*OUUUUYTsaaaaaaaceeeeiiiidnooooo/ouuuuyty";   // U+00C0..U+00FF
  String out; out.reserve(in.length());
  for (unsigned i = 0; i < in.length(); i++) {
    const uint8_t c = (uint8_t)in[i];
    if (c < 0x80) { out += (char)(c >= 32 && c < 127 ? c : ' '); continue; }
    if (c == 0xC3 && i + 1 < in.length()) { const uint8_t d = (uint8_t)in[++i]; out += (d >= 0x80 && d < 0xC0) ? L1[d - 0x80] : '?'; continue; }
    if (c >= 0xC0) { out += '?'; while (i + 1 < in.length() && ((uint8_t)in[i + 1] & 0xC0) == 0x80) i++; }
  }
  return out;
}

// ─── EEPROM ────────────────────────────────────────────────────────────────
static String bytesToHex(const uint8_t* buf, size_t len) {
  String hex; hex.reserve(len * 2);
  for (size_t i = 0; i < len; i++) { if (buf[i] < 16) hex += "0"; hex += String(buf[i], HEX); }
  return hex;
}
static bool keysAlreadyGenerated()   { return EEPROM.read(EEPROM_FLAG_OFF) == KEY_GENERATED_FLAG; }
static bool onboardingAlreadyShown() { return EEPROM.read(EEPROM_ONBOARDING_OFF) == ONBOARDING_SHOWN_FLAG; }
static void setOnboardingShown()     { EEPROM.update(EEPROM_ONBOARDING_OFF, ONBOARDING_SHOWN_FLAG); }

static void saveKeysToEEPROM() {
  for (int i = 0; i < 32; i++) EEPROM.update(EEPROM_PRIVKEY_OFF + i, privateKey[i]);
  for (int i = 0; i < 32; i++) EEPROM.update(EEPROM_PUBKEY_OFF + i, publicKey[i]);
  EEPROM.update(EEPROM_FLAG_OFF, KEY_GENERATED_FLAG);
}
static void loadKeysFromEEPROM() {
  for (int i = 0; i < 32; i++) privateKey[i] = EEPROM.read(EEPROM_PRIVKEY_OFF + i);
  for (int i = 0; i < 32; i++) publicKey[i]  = EEPROM.read(EEPROM_PUBKEY_OFF + i);
  uint8_t derived[32];
  Ed25519::derivePublicKey(derived, privateKey);
  if (memcmp(derived, publicKey, 32) != 0) {       // écriture interrompue entre clé privée et publique
    logf("[KEYS] Clé publique incohérente -> recalcul depuis la clé privée");
    memcpy(publicKey, derived, 32);
    for (int i = 0; i < 32; i++) EEPROM.update(EEPROM_PUBKEY_OFF + i, publicKey[i]);
  }
  keysLoaded = true;
}
static void saveBlockHashToEEPROM(const String& hash) {
  String h = hash.length() >= 32 ? hash.substring(0, 32) : hash;
  while (h.length() < 32) h += ' ';
  for (int i = 0; i < 32; i++) EEPROM.update(EEPROM_BLOCKHASH_OFF + i, (uint8_t)h[i]);
}
static String loadBlockHashFromEEPROM() {
  String hash = "";
  for (int i = 0; i < 32; i++) { char c = (char)EEPROM.read(EEPROM_BLOCKHASH_OFF + i); if (c == ' ' || c == '\0') break; hash += c; }
  return hash;
}

// frameId affiché : on n'en garde que le début (32 car.), suffisant pour reconnaître une œuvre déjà à l'écran
static String frameKey(const String& id) { return id.length() > FRAMEID_LEN ? id.substring(0, FRAMEID_LEN) : id; }
static void persistFrameId(const String& id) {
  const String k = frameKey(id);
  for (int i = 0; i < FRAMEID_LEN; i++) EEPROM.update(EEPROM_FRAMEID_OFF + i, i < (int)k.length() ? (uint8_t)k[i] : (uint8_t)' ');
}
static String loadFrameId() {
  String s = "";
  for (int i = 0; i < FRAMEID_LEN; i++) {
    const uint8_t c = EEPROM.read(EEPROM_FRAMEID_OFF + i);
    if (c == ' ' || c < 33 || c > 126) break;       // EEPROM vierge (0xFF) ou fin de chaîne -> chaîne vide
    s += (char)c;
  }
  return s;
}

// Anneau des blocs possédés (10 × 32 caractères), identique aux autres firmwares
static void saveOwnedBlockHash(const String& fullHash) {
  if (fullHash.length() < 16) return;
  String h = fullHash.length() >= OWNED_HASH_LEN ? fullHash.substring(0, OWNED_HASH_LEN) : fullHash;
  while ((int)h.length() < OWNED_HASH_LEN) h += ' ';
  uint8_t head = EEPROM.read(EEPROM_OWNED_HEAD_OFF), count = EEPROM.read(EEPROM_OWNED_COUNT_OFF);
  if (head >= OWNED_SLOTS_MAX) head = 0;
  if (count > OWNED_SLOTS_MAX) count = 0;
  for (uint8_t i = 0; i < count; i++) {
    const uint8_t slot = (head - count + i + OWNED_SLOTS_MAX) % OWNED_SLOTS_MAX;
    const int off = EEPROM_OWNED_SLOTS_OFF + slot * OWNED_HASH_LEN;
    bool match = true;
    for (int j = 0; j < OWNED_HASH_LEN && match; j++) if ((char)EEPROM.read(off + j) != h[j]) match = false;
    if (match) { logf("[OWNED] déjà présent"); return; }
  }
  const int slotOff = EEPROM_OWNED_SLOTS_OFF + head * OWNED_HASH_LEN;
  for (int i = 0; i < OWNED_HASH_LEN; i++) EEPROM.update(slotOff + i, (uint8_t)h[i]);
  head = (head + 1) % OWNED_SLOTS_MAX;
  count = (count + 1 > OWNED_SLOTS_MAX) ? OWNED_SLOTS_MAX : count + 1;
  EEPROM.update(EEPROM_OWNED_HEAD_OFF, head);
  EEPROM.update(EEPROM_OWNED_COUNT_OFF, count);
  logf("[OWNED] %s... (%u/%u)", h.substring(0, 8).c_str(), count, OWNED_SLOTS_MAX);
}
static String loadOwnedHashesJson() {
  uint8_t head = EEPROM.read(EEPROM_OWNED_HEAD_OFF), count = EEPROM.read(EEPROM_OWNED_COUNT_OFF);
  if (head >= OWNED_SLOTS_MAX) head = 0;
  if (count > OWNED_SLOTS_MAX) count = 0;
  if (count == 0) return "[]";
  String json = "["; bool first = true;
  for (uint8_t i = 0; i < count; i++) {
    const uint8_t slot = (head - 1 - i + OWNED_SLOTS_MAX) % OWNED_SLOTS_MAX;
    const int off = EEPROM_OWNED_SLOTS_OFF + slot * OWNED_HASH_LEN;
    String h = "";
    for (int j = 0; j < OWNED_HASH_LEN; j++) { char c = (char)EEPROM.read(off + j); if (c == ' ' || c == '\0') break; h += c; }
    if (h.length() >= 8) { if (!first) json += ","; json += "\"" + h + "\""; first = false; }
  }
  return json + "]";
}

// ─── Clés Ed25519 ──────────────────────────────────────────────────────────
// Entropie : bruit des entrées analogiques flottantes + gigue d'horloge + MAC + RSSI, condensés par SHA-256.
// (Même niveau que les firmwares ESP : suffisant pour identifier un écran, PAS un générateur certifié.)
static void gatherEntropy(uint8_t out[32]) {
  SHA256 h; h.reset();
  uint8_t mac[6] = {0}; WiFi.macAddress(mac); h.update(mac, 6);
  const int32_t rssi = WiFi.RSSI(); h.update(&rssi, sizeof(rssi));
  for (int i = 0; i < 384; i++) {
    const uint16_t v = (uint16_t)analogRead(A0 + (i % 6));
    const uint32_t m = micros();
    h.update(&v, sizeof(v)); h.update(&m, sizeof(m));
    delayMicroseconds(29 + (v & 15));
  }
  h.finalize(out, 32);
}
static void generateKeys() {
  logf("[KEYS] Génération de la paire Ed25519...");
  gatherEntropy(privateKey);
  Ed25519::derivePublicKey(publicKey, privateKey);
  keysLoaded = true;
  saveKeysToEEPROM();
  logf("[KEYS] PubKey: %s", bytesToHex(publicKey, 32).c_str());
}
static String signED25519(const String& candidateId, float score) {
  const int m = (int)(score * 1000.0f + 0.5f);     // « 0.543 » : 3 décimales, comme toFixed(3) côté serveur
  char scoreStr[12]; snprintf(scoreStr, sizeof(scoreStr), "%d.%03d", m / 1000, m % 1000);
  const String message = deviceId + ":" + candidateId + ":" + scoreStr;
  uint8_t sig[64];
  Ed25519::sign(sig, privateKey, publicKey, (const uint8_t*)message.c_str(), message.length());
  return bytesToHex(sig, 64);
}

// ─── HTTP (WiFiSSLClient + pod_http.h) ─────────────────────────────────────
struct Conn {
  WiFiSSLClient client;
  podhttp::Reader<WiFiSSLClient> rd;
  explicit Conn(uint32_t timeoutMs) : rd(client, timeoutMs) {}
  /** Connecte, envoie la requête, lit les en-têtes. Retourne le code HTTP, -2 = connexion TLS impossible, -1 = réponse illisible. */
  int request(const char* method, const String& path, const String* body) {
    if (!client.connect(SERVER_HOST, 443)) return -2;
    String req = String(method) + " " + path + " HTTP/1.1\r\nHost: " SERVER_HOST "\r\nUser-Agent: pod-r4/" FIRMWARE_VERSION "\r\nAccept: */*\r\nConnection: close\r\n";
    if (body) req += "Content-Type: application/json\r\nContent-Length: " + String(body->length()) + "\r\n";
    req += "\r\n";
    if (body) req += *body;
    client.print(req);
    return rd.readHeaders();
  }
};

/** Appel JSON : retourne le code HTTP (>0) et le corps dans resp ; <0 = échec réseau/lecture/corps incomplet. */
static int httpCall(const char* method, const String& path, const String* body, String& resp) {
  resp = "";
  Conn c(HTTP_TIMEOUT_MS);
  const int code = c.request(method, path, body);
  logf("[HTTP %s] %s -> %d", method, path.length() > 60 ? (path.substring(0, 60) + "...").c_str() : path.c_str(), code);
  if (code < 0) { if (code == -2) logf("[HTTP] connexion TLS impossible (voir l'en-tête du sketch)"); return code; }
  size_t len = 0;
  const bool complete = c.rd.readBodyString(g_body, sizeof(g_body), &len);
  c.client.stop();
  if (!complete) { logf("[HTTP] corps incomplet ou > %u octets", (unsigned)sizeof(g_body) - 1); return -3; }
  resp = String(g_body);
  return code;
}

// ─── DESSIN dans les plans e-ink ───────────────────────────────────────────
// Repère = celui de l'IMAGE du serveur (lib/canvasToScreen.ts, eink29bwr) : x 0..295 vers la droite, y 0..127 vers le bas.
//   bufRow = x          bufCol = 127 - y          octet = bufRow*16 + bufCol/8          bit = 7 - bufCol%8
// Un bit à 0 = pixel actif (noir dans blackBuf, rouge dans redBuf).
static inline void setPix(uint8_t* buf, int x, int y) {
  if ((unsigned)x >= IMG_W || (unsigned)y >= IMG_H) return;
  const int bufCol = (IMG_H - 1) - y;
  buf[x * EPD_BYTES_PER_ROW + (bufCol >> 3)] &= (uint8_t)~(0x80 >> (bufCol & 7));
}
static inline void clearPix(uint8_t* buf, int x, int y) {
  if ((unsigned)x >= IMG_W || (unsigned)y >= IMG_H) return;
  const int bufCol = (IMG_H - 1) - y;
  buf[x * EPD_BYTES_PER_ROW + (bufCol >> 3)] |= (uint8_t)(0x80 >> (bufCol & 7));
}
static void clearBothPlanes() { memset(blackBuf, 0xFF, BUF_SIZE); memset(redBuf, 0xFF, BUF_SIZE); }
/** Lignes y0..y1 de l'image remises à blanc (noir ET rouge). */
#if !POD_RENDER_V1   // utilisé seulement par burnCartel
static void whiteRows(int y0, int y1) {
  for (int x = 0; x < IMG_W; x++) for (int y = y0; y <= y1; y++) { clearPix(blackBuf, x, y); clearPix(redBuf, x, y); }
}
#endif
static void hLine(uint8_t* buf, int y, int x0 = 0, int x1 = IMG_W - 1) { for (int x = x0; x <= x1; x++) setPix(buf, x, y); }

// Police 5×7 : une colonne = un octet, bit 0 = ligne du HAUT (police classique). Chiffres, A-Z, « : . - / # », espace.
static const uint8_t FONT_5x7[][5] = {
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
  {0x02,0x01,0x02,0x04,0x02},{0x00,0x00,0x00,0x00,0x00},{0x14,0x7F,0x14,0x7F,0x14},
};
static int charIndex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
  if (c >= 'a' && c <= 'z') return c - 'a' + 10;     // minuscules rendues en majuscules
  if (c == ':') return 36; if (c == '.') return 37;
  if (c == '-') return 38; if (c == '/') return 39;
  if (c == '#') return 41;
  return 40;                                          // espace / inconnu
}
static void drawChar(uint8_t* buf, int x, int y, char c, int scale) {
  const int idx = charIndex(c);
  for (int col = 0; col < 5; col++) {
    const uint8_t bits = FONT_5x7[idx][col];
    for (int row = 0; row < 7; row++) {
      if (!(bits & (1 << row))) continue;
      for (int dy = 0; dy < scale; dy++) for (int dx = 0; dx < scale; dx++) setPix(buf, x + col * scale + dx, y + row * scale + dy);
    }
  }
}
static void drawText(uint8_t* buf, int x, int y, const String& text, int scale = 1) {
  for (unsigned i = 0; i < text.length(); i++) { drawChar(buf, x, y, text[i], scale); x += 6 * scale; }
}
static int textWidth(const String& t, int scale = 1) { return (int)t.length() * 6 * scale; }
static int centerX(const String& t, int scale = 1) { const int w = (IMG_W - textWidth(t, scale)) / 2; return w < 0 ? 0 : w; }

#if !POD_RENDER_V1   // le cartel gravé en place n'existe pas avec le rendu v1 (cartel calculé par le noyau)
/** Cartel PAR-DESSUS l'œuvre : bande haute (date · #bloc), bande basse (artiste - titre), 13 px chacune, texte noir sur blanc. */
static void burnCartel(const String& workTitle, const String& artistName, const String& ts, int blockIndex) {
  const int BAND = 13;
  whiteRows(0, BAND - 1);
  hLine(blackBuf, BAND);
  String top = ts.length() > 0 ? asciiFold(ts) : String("PROOF-OF-DRAW");
  if (blockIndex >= 0) top += " #" + String(blockIndex);
  top.toUpperCase();
  while (top.length() > 0 && textWidth(top) > IMG_W - 4) top.remove(top.length() - 1);
  drawText(blackBuf, centerX(top), 3, top);

  const int sep = IMG_H - BAND - 1;                  // 114
  whiteRows(sep + 1, IMG_H - 1);
  hLine(blackBuf, sep);
  const String t = asciiFold(workTitle), a = asciiFold(artistName);
  String bot = (a.length() && t.length()) ? a + " - " + t : (a.length() ? a : t);
  if (bot.length() == 0) bot = "Proof-of-Draw";
  bot.toUpperCase();
  while (bot.length() > 0 && textWidth(bot) > IMG_W - 4) bot.remove(bot.length() - 1);
  drawText(blackBuf, centerX(bot), sep + 3, bot);
}

#endif

// ─── Écran e-ink ───────────────────────────────────────────────────────────
static void waitMinRefreshGap() {
  if (!hasRefreshed) return;
  const unsigned long elapsed = millis() - lastRefreshMs;
  if (elapsed < EINK_MIN_REFRESH_MS) { logf("[EINK] attente %lu ms (écart minimal entre rafraîchissements)", EINK_MIN_REFRESH_MS - elapsed); delay(EINK_MIN_REFRESH_MS - elapsed); }
}
/** Réveille, envoie blackBuf/redBuf (ou page blanche), met en veille. true = rafraîchissement terminé. */
static bool refreshPanel(bool white) {
  waitMinRefreshGap();
  const unsigned long t0 = millis();
  if (!epd.init()) { logf("[EINK] init échoué"); lastRefreshMs = millis(); hasRefreshed = true; return false; }
  const bool ok = white ? epd.displayWhite() : epd.display(blackBuf, redBuf);
  epd.sleep();
  lastRefreshMs = millis(); hasRefreshed = true;
  logf("[EINK] %s %s en %lu ms", white ? "page blanche" : "image", ok ? "affichée" : "ECHEC", millis() - t0);
  return ok;
}

#if POD_RENDER_V1
// ─── Rendu v1 en flux : calcul ET remise au pilote ───────────────────────────────────────────────────────────────────────────────────────────────
// Mémoire (UNO R4, pile principale ≈ 1 Ko : TOUS les objets sont GLOBAUX) : PodEinkRenderer 272 o (son contexte SHA sert AUSSI au frameHash : pas de second contexte) + 65 o de hash (statique), plus les plans blackBuf / redBuf EXISTANTS (2 × 4 736 o, jamais modifiés) ; le seul
// tampon de pile est le morceau de 32 o du pilote. Aucune grille, aucun tampon final. Retour : 0 = échec AVANT la remise · 1 = rendu calculé mais NON remis (panneau resté BUSY) · 2 = calculé ET remis.
static PodEinkRenderer<PodSha256Rw> g_podEink;
static uint32_t podRenderProduce(void* ctx, uint8_t* out, uint32_t cap) { return static_cast<PodEinkRenderer<PodSha256Rw>*>(ctx)->read(out, cap); }

static uint8_t podRenderAndShow() {
  const PodRenderSpec spec = pod_render_spec(POD_R_EINK29);
  const PodRenderMeta meta = { (const uint8_t*)pendingDisplayTs.c_str(), (size_t)pendingDisplayTs.length(), (int32_t)currentBlockIndex,
                               (const uint8_t*)pendingArtistName.c_str(), (size_t)pendingArtistName.length(), (const uint8_t*)pendingWorkTitle.c_str(), (size_t)pendingWorkTitle.length() };
  static char hex[65];   // statique (65 o de BSS, partagé frameHash puis renderHash) : rien sur la pile de 1 Ko — marge statique de ce firmware : voir docs/LOT_8B2A
  if (!g_podEink.frameHash(spec, blackBuf, redBuf, BUF_SIZE, hex)) { logf("[RENDER] frameHash impossible — abandon"); return 0; }
  logf("[RENDER] frameHash=%s", hex);
  if (!g_podEink.begin(spec, POD_RENDER_MODE_DEFAULT, meta, blackBuf, redBuf, BUF_SIZE)) { logf("[RENDER] paramètres refusés — abandon"); return 0; }
  waitMinRefreshGap();
  const unsigned long t0 = millis();
  if (!epd.init()) { logf("[RENDER] panneau non initialisé — abandon, rien n'est envoyé"); lastRefreshMs = millis(); hasRefreshed = true; return 0; }
  const int8_t sent = epd.displayStream(podRenderProduce, &g_podEink);
  epd.sleep();
  lastRefreshMs = millis(); hasRefreshed = true;
  if (sent == -1) { logf("[RENDER] production interrompue — le panneau n'a PAS été rafraîchi"); return 0; }
  if (!g_podEink.finish(hex)) { logf("[RENDER] renderHash incomplet — abandon"); return 0; }
  if (sent != 0) { logf("[RENDER] rendu CALCULÉ (renderHash=%s) mais NON remis : le panneau n'a pas fini (BUSY)", hex); return 1; }
  logf("[RENDER] calculé ET remis au pilote en %lu ms — mode=%u renderHash=%s", millis() - t0, (unsigned)POD_RENDER_MODE_DEFAULT, hex);
  return 2;
}
#endif

// ─── Onboarding ────────────────────────────────────────────────────────────
static void displayKeyMaterialOnce() {
  const String pubHex = bytesToHex(publicKey, 32), privHex = bytesToHex(privateKey, 32);
  logf("[KEYS] PubKey: %s", pubHex.c_str());         // la clé privée n'est JAMAIS écrite au Serial
  clearBothPlanes();
  const String title = "PROOF-OF-DRAW KEYS";
  drawText(blackBuf, centerX(title), 3, title);
  hLine(blackBuf, 13, 10, IMG_W - 11);
  drawText(blackBuf, 4, 20, "PUB:");
  drawText(redBuf, 4, 66, "PRIV:");
  for (int l = 0; l < 4; l++) {
    drawText(blackBuf, 34, 20 + l * 10, pubHex.substring(l * 16, l * 16 + 16));
    drawText(redBuf, 34, 66 + l * 10, privHex.substring(l * 16, l * 16 + 16));
  }
  hLine(blackBuf, 109, 10, IMG_W - 11);
  const String w1 = "SAVE THESE KEYS NOW", w2 = "PRIVATE KEY SHOWN ONCE";
  drawText(redBuf, centerX(w1), 112, w1);
  drawText(redBuf, centerX(w2), 120, w2);
  persistFrameId("");                                // l'œuvre précédente n'est plus à l'écran
  lastFrameId = "";
  refreshPanel(false);
  logf("[KEYS] Clés affichées — 60 s pour les noter");
  delay(60000UL);
}

static void displayOnboardingQR(const String& onboardUrl, const String& code, const String& mac) {
  static QRCode qr;
  static uint8_t qrData[600];                        // qrcode_getBufferSize(5) tient largement dedans (vérifié ci-dessous)
  if (qrcode_getBufferSize(5) > sizeof(qrData)) { logf("[QR] tampon trop petit"); return; }
  memset(qrData, 0, sizeof(qrData));
  int res = qrcode_initText(&qr, qrData, 4, ECC_MEDIUM, onboardUrl.c_str());
  if (res < 0) res = qrcode_initText(&qr, qrData, 5, ECC_MEDIUM, onboardUrl.c_str());
  if (res < 0) { logf("[QR] URL trop longue pour le QR"); return; }

  clearBothPlanes();
  const String title = "PROOF-OF-DRAW", sub = "SCAN TO PAIR";
  String m = mac; m.replace(":", ""); m.toUpperCase();
  const String macLine = "MAC:" + m, codeLine = "CODE:" + code;

  const int quiet = 2, topPad = 4, sidePad = 6, bottomPad = 4, titleH = 16, infoH = 17, gap = 6;
  const int total = qr.size + quiet * 2;
  const int usableW = IMG_W - sidePad * 2;
  const int usableH = IMG_H - topPad - titleH - gap - gap - infoH - bottomPad;
  int scale = min(usableW / total, usableH / total); if (scale < 1) scale = 1;
  const int qrPx = total * scale;
  const int qrX0 = (IMG_W - qrPx) / 2, qrY0 = topPad + titleH + gap;
  const int textY1 = qrY0 + qrPx + gap;

  drawText(blackBuf, centerX(title), topPad, title);
  drawText(blackBuf, centerX(sub), topPad + 9, sub);
  for (int my = 0; my < qr.size; my++)
    for (int mx = 0; mx < qr.size; mx++) {
      if (!qrcode_getModule(&qr, mx, my)) continue;
      for (int dy = 0; dy < scale; dy++) for (int dx = 0; dx < scale; dx++)
        setPix(blackBuf, qrX0 + (mx + quiet) * scale + dx, qrY0 + (my + quiet) * scale + dy);
    }
  drawText(blackBuf, centerX(macLine), textY1, macLine);
  drawText(redBuf, centerX(codeLine), textY1 + 10, codeLine);   // code d'appairage en rouge
  persistFrameId("");
  lastFrameId = "";
  refreshPanel(false);
}

// ─── ACK / image ───────────────────────────────────────────────────────────
static bool ackFrame(const String& frameId) {
  if (frameId.length() == 0) return false;
  const String body = "{\"deviceId\":\"" + deviceId + "\",\"frameId\":\"" + frameId + "\"}";
  String resp;
  const bool ok = httpCall("POST", "/api/ack-frame", &body, resp) == 200;
  logf("[ACK] %s -> %s", frameId.c_str(), ok ? "OK" : "FAIL");
  return ok;
}

static bool doFetchFrame(const String& frameId, const String& frameSource) {
  const unsigned long t0 = millis();
  bool got = false, noFrame = false;
  {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", "/api/pull-frame?deviceId=" + deviceId + "&screen=" SCREEN_TYPE "&fmt=bin", nullptr);
    logf("[HTTP GET] /api/pull-frame -> %d (contenu %ld)", code, c.rd.contentLength());
    if (code == 404) noFrame = true;
    else if (code == 200 && (c.rd.contentLength() < 0 || c.rd.contentLength() == FRAME_BYTES)) {
      // Lecture complète garantie par pod_http.h (boucle jusqu'au compte exact ou au timeout) : jamais d'image hachée
      const size_t b = c.rd.readBody(blackBuf, BUF_SIZE);
      const size_t r = (b == BUF_SIZE) ? c.rd.readBody(redBuf, BUF_SIZE) : 0;
      logf("[FRAME] lu noir=%u rouge=%u attendu=%u", (unsigned)b, (unsigned)r, (unsigned)BUF_SIZE);
      got = (b == BUF_SIZE && r == BUF_SIZE);
    } else if (code == 200) {
      logf("[FRAME] taille annoncée %ld != %d (le serveur sert-il bien eink29bwr ?)", c.rd.contentLength(), FRAME_BYTES);
    }
    c.client.stop();
  }
  if (noFrame) { logf("[FRAME] pas de frame disponible"); return true; }
  if (!got) { logf("[FRAME] image incomplète — pas d'ACK, nouvel essai au prochain pull"); return false; }

#if !POD_RENDER_V1
  burnCartel(pendingWorkTitle, pendingArtistName, pendingDisplayTs, currentBlockIndex);
#endif

  persistFrameId("");                                // pendant le rafraîchissement l'écran est dans un état incertain
#if CLEAR_BEFORE_IMAGE
  if (hasRefreshed || lastFrameId.length() > 0) refreshPanel(true);
#endif
#if POD_RENDER_V1
  if (podRenderAndShow() != 2) { logf("[FRAME] affichage échoué — frame conservée côté serveur"); return false; }   // 2 = rendu calculé ET remis au pilote
#else
  if (!refreshPanel(false)) { logf("[FRAME] affichage échoué — frame conservée côté serveur"); return false; }
#endif

  lastFrameId = frameKey(frameId);
  persistFrameId(frameId);
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId = "";
  logf("[FRAME] OK en %lu ms (frameId=%s source=%s)", millis() - t0, frameId.c_str(), frameSource.c_str());
  ackFrame(frameId);
  return true;
}

// ─── OBS-CONFIRM ───────────────────────────────────────────────────────────
static bool doObsConfirm() {
  if (pendingObsHashes.length() == 0) return true;
  String body = "{\"deviceId\":\"" + deviceId + "\",\"blockHashes\":" + pendingObsHashes;
  if (pendingObsTarget.length() == 64) body += ",\"targetBlockHash\":\"" + pendingObsTarget + "\"";
  body += "}";
  String resp;
  const bool ok = httpCall("POST", "/api/obs-confirm", &body, resp) == 200;
  logf("[OBS-CONFIRM] ok=%d", ok);
  pendingObsHashes = ""; pendingObsTarget = "";
  return ok;
}

// ─── REGISTER ──────────────────────────────────────────────────────────────
static String macString() {
  uint8_t m[6] = {0}; WiFi.macAddress(m);
  char b[18]; snprintf(b, sizeof(b), "%02x:%02x:%02x:%02x:%02x:%02x", m[0], m[1], m[2], m[3], m[4], m[5]);
  return String(b);
}

static bool doRegister() {
  const String mac = macString();
  const String body = "{\"mac\":\"" + mac + "\",\"screens\":[\"" SCREEN_TYPE "\"],"
                      "\"firmware\":\"" FIRMWARE_VERSION "\","
                      "\"publicKey\":\"" + (keysLoaded ? bytesToHex(publicKey, 32) : String("")) + "\","
                      "\"ownedHashes\":" + loadOwnedHashesJson() + "}";
  String resp;
  if (httpCall("POST", "/api/register", &body, resp) != 200) { logf("[REGISTER] échec — nouvel essai dans 5 s"); return false; }
  JSON_DOC(doc, 768);
  if (deserializeJson(doc, resp)) { logf("[REGISTER] JSON illisible"); return false; }
  deviceId   = doc["deviceId"].as<String>();
  pairCode   = doc["pairCode"].as<String>();
  paired     = doc["paired"] | false;
  registered = true;
  logf("[REGISTER] deviceId=%s paired=%s", deviceId.c_str(), paired ? "oui" : "non");

  if (!paired && !onboardingDrawn) {
    const String url = String("https://" SERVER_HOST "/onboard?code=") + pairCode;
    if (!onboardingAlreadyShown()) {
      displayKeyMaterialOnce();                      // clés (une seule fois dans la vie de l'appareil), puis QR
      displayOnboardingQR(url, pairCode, mac);
      setOnboardingShown();
    } else {
      displayOnboardingQR(url, pairCode, mac);       // boots suivants non appairés : QR seul
    }
    onboardingDrawn = true;                          // pas de re-rafraîchissement toutes les minutes pendant l'attente
  } else if (paired) {
    logf("[REGISTER] appairé");
  }
  return true;
}

// ─── PULL ──────────────────────────────────────────────────────────────────
static bool doPull() {
  String newBlockHash = "", newCandId = "", newFrameId = "", newFrameSource = "none";
  int newBlockIndex = -1, pullRetryAfter = 60;

  {
    String resp;
    const int code = httpCall("GET", "/api/pull?deviceId=" + deviceId, nullptr, resp);
    if (code == 429) {
      int retrySec = 60;
      JSON_DOC(rate, 256);
      if (deserializeJson(rate, resp) == DeserializationError::Ok) retrySec = max(1, (int)(rate["retryAfter"] | 60));
      unsigned long retryMs = (unsigned long)retrySec * 1000UL;
      if (retryMs > PULL_INTERVAL) retryMs = PULL_INTERVAL;
      lastPullMs = millis() - (PULL_INTERVAL - retryMs);
      logf("[PULL] 429 retryAfter=%ds", retrySec);
      return true;
    }
    if (code != 200) { logf("[PULL] erreur HTTP %d", code); return false; }

    JSON_DOC(doc, 2048);
    const DeserializationError err = deserializeJson(doc, resp);
    if (err) { logf("[PULL] JSON: %s", err.c_str()); return false; }

    JsonObject chain = doc["chain"];
    if (!chain.isNull()) { newBlockHash = chain["blockHash"] | ""; newBlockIndex = chain["blockIndex"] | -1; }
    JsonObject pend = doc["pendingValidation"];
    if (!pend.isNull()) newCandId = pend["candidateId"] | "";

    newFrameSource = doc["frameSource"] | "none";
    newFrameId     = doc["frameId"] | "";
    pullRetryAfter = doc["retryAfter"] | 60;
    if (pullRetryAfter <= 0) pullRetryAfter = 60;
    if (newFrameId.length() == 0) { JsonObject fo = doc["frame"]; if (!fo.isNull()) newFrameId = fo["frameId"] | ""; }

    JsonObject cm = doc["cartelMeta"];
    if (!cm.isNull()) {
      pendingWorkTitle  = cm["workTitle"] | "";
      pendingArtistName = cm["drawArtistName"] | "";
      pendingDisplayTs  = cm["displayTs"] | "";
      currentBlockIndex = cm["blockIndex"] | currentBlockIndex;
      logf("[PULL] cartel: %s / %s (bloc %d)", asciiFold(pendingWorkTitle).c_str(), asciiFold(pendingArtistName).c_str(), currentBlockIndex);
    }
    JsonObject obs = doc["pendingObservation"];
    if (!obs.isNull()) {
      JsonArray hArr = obs["blockHashes"].as<JsonArray>();
      if (hArr.size() > 0) {
        String arr = "[";
        for (size_t i = 0; i < hArr.size(); i++) { if (i) arr += ","; arr += "\""; arr += hArr[i].as<String>(); arr += "\""; }
        pendingObsHashes = arr + "]";
        pendingObsTarget = obs["targetBlockHash"] | "";
      }
    }
    const char* owned = doc["ownedBlock"] | "";
    if (strlen(owned) >= 16) saveOwnedBlockHash(String(owned));
  }

  nextPullIntervalMs = (newFrameSource == "none" && newCandId.length() == 0) ? (unsigned long)pullRetryAfter * 1000UL : PULL_INTERVAL;
  if (newBlockHash.length() > 0 && newBlockHash != currentBlockHash) {
    currentBlockHash = newBlockHash; currentBlockIndex = newBlockIndex;
    saveBlockHashToEEPROM(currentBlockHash);
    logf("[PULL] nouveau bloc #%d", currentBlockIndex);
  }
  if (newCandId.length() > 0) pendingCandidateId = newCandId;

  if (newFrameSource == "none" || newFrameId.length() == 0) { logf("[PULL] aucune frame"); return true; }
  if (frameKey(newFrameId) == lastFrameId) { logf("[PULL] frame déjà affichée"); return true; }
  logf("[PULL] nouvelle frame %s (%s)", newFrameId.c_str(), newFrameSource.c_str());

  doFetchFrame(newFrameId, newFrameSource);          // échec : on retourne quand même true (pas de boucle pull→échec→pull)
  reportMem("après pull");
  return true;
}

// ─── VALIDATION RÉELLE (vote v2) ───────────────────────────────────────────
// ⚠ NON TESTÉ sur la carte (docs/CANARI_R4_EINK29.md). Le serveur annonce le candidat (écran, taille, SHA-256) ; ici la R4 lit le contenu BRUT en flux, recalcule
// le hash et les métriques entières, décide d'un verdict objectif, le signe (Ed25519) et vote. Aucune image n'est gardée : blackBuf sert de tampon « noir » pendant
// la lecture (il est ré-écrit en entier avant le prochain affichage) ; le morceau de lecture est statique (la pile de la R4 est petite).
// Un appareil relit un candidat de N'IMPORTE QUEL écran (le serveur ne l'oblige pas à voter pour son type) : blackBuf (≥ 4 736 o) sert de tampon pour l'OLED et l'e-ink 2,9".
static uint8_t g_voteChunk[256];

static bool doValidateV2(const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash) {
  PodScreenKind kind;
  if (!podKindFromName(screenName.c_str(), &kind)) { logf("[VALIDATE2] écran inconnu: %s", screenName.c_str()); return false; }
  reportMem("VALIDATE2-avant");

  PodCheck chk;
  memset(&chk, 0, sizeof(chk));
  {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", String("/api/candidate-frame?candidateId=") + candidateId, nullptr);
    chk.http = code;
    logf("[HTTP GET] /api/candidate-frame -> %d", code);
    if (code == 200) podCheckStream(c.rd, kind, bytes, blackBuf, BUF_SIZE, g_voteChunk, sizeof(g_voteChunk), &chk);
    c.client.stop();
  }
  if (!chk.ok) {
    logf("[VALIDATE2] lecture/calcul impossible (http=%d, %u/%u octets)", chk.http, (unsigned)chk.bytes, (unsigned)bytes);
    return false;
  }

  bool accept = false;
  const char* reason = podVerdict(chk, announcedHash, &accept);
  logf("[VALIDATE2] %s %u o en %lu ms | e=%lu t=%lu r=%lu s=%lu | verdict=%s %s", screenName.c_str(), (unsigned)chk.bytes, (unsigned long)chk.ms,
       (unsigned long)chk.m.e, (unsigned long)chk.m.t, (unsigned long)chk.m.r, (unsigned long)chk.m.s, accept ? "accept" : "reject", reason);
  logf("[VALIDATE2] hash=%s", chk.hash);

  const String msg = podVoteMessage(deviceId, candidateId, chk.hash, chk.m, accept);
  uint8_t sig[64];
  unsigned long ts = millis();
  Ed25519::sign(sig, privateKey, publicKey, (const uint8_t*)msg.c_str(), msg.length());
  logf("[VALIDATE2] signature en %lu ms", millis() - ts);

  const String body = String("{\"v\":2,\"deviceId\":\"") + deviceId + "\",\"candidateId\":\"" + candidateId + "\",\"rawHash\":\"" + chk.hash + "\","
                      "\"e\":" + String((unsigned long)chk.m.e) + ",\"t\":" + String((unsigned long)chk.m.t) + ",\"r\":" + String((unsigned long)chk.m.r) + ","
                      "\"verdict\":\"" + (accept ? "accept" : "reject") + "\"" + (accept ? String("") : String(",\"reason\":\"") + reason + "\"") +
                      ",\"signature\":\"" + bytesToHex(sig, 64) + "\"}";
  String vResp;
  const int vCode = httpCall("POST", "/api/validation-result", &body, vResp);
  bool mined = false;
  if (vCode == 200) {
    logf("[VALIDATE2] Vote OK");
    if (vResp.indexOf("\"blockMined\":true") >= 0) { logf("[VALIDATE2] BLOC MINÉ"); mined = true; }
    if (vResp.indexOf("\"rejectObserved\":true") >= 0) logf("[VALIDATE2] refus enregistré par le serveur (non bloquant)");
  } else {
    logf("[VALIDATE2] Echec vote (%d) : 403 = signature, 422 = hash/métriques différents du serveur — %s", vCode, vResp.c_str());
    if (vResp.indexOf("Signature") >= 0) { logf("[VALIDATE2] resynchronisation de la clé publique (re-register)"); doRegister(); }
  }
  reportMem("VALIDATE2-après");
  return mined;
}

// ─── VALIDATION ────────────────────────────────────────────────────────────
static bool doValidate() {
  if (pendingCandidateId.length() == 0) return false;
  String resp;
  if (httpCall("GET", "/api/validate-candidate?deviceId=" + deviceId, nullptr, resp) != 200 || resp.length() == 0) { pendingCandidateId = ""; return false; }
  JSON_DOC(doc, 768);   // 512 avant la validation réelle : la réponse porte aussi { v2: écran, taille, hash } (≈ 110 o)
  if (deserializeJson(doc, resp)) { pendingCandidateId = ""; return false; }
  if ((doc["alreadyVoted"] | false) || doc["candidate"].isNull()) { pendingCandidateId = ""; return false; }
  JsonObject cand = doc["candidate"];
  const String candidateId = cand["candidateId"] | "";
  if (candidateId.length() == 0) { pendingCandidateId = ""; return false; }
  // Validation RÉELLE : si le serveur annonce { v2 }, on revérifie le contenu au lieu de recopier son score (anciens serveurs / animations : chemin v1 ci-dessous).
  if (!cand["v2"].isNull()) {
    const String v2screen = cand["v2"]["screen"] | "";
    const size_t v2bytes  = cand["v2"]["bytes"] | 0;
    const String v2hash   = cand["v2"]["hash"] | "";
    pendingCandidateId = "";
    return doValidateV2(candidateId, v2screen, v2bytes, v2hash);
  }
  const float score = cand["score_server"] | 0.5f;

  const String signature = signED25519(candidateId, score);
  const int m = (int)(score * 1000.0f + 0.5f);
  char sc[12]; snprintf(sc, sizeof(sc), "%d.%03d", m / 1000, m % 1000);
  const String body = String("{\"deviceId\":\"") + deviceId + "\",\"candidateId\":\"" + candidateId + "\","
                      "\"entropy\":" + sc + ",\"transitions\":" + sc + ",\"rle\":" + sc + ",\"score\":" + sc + ","
                      "\"signature\":\"" + signature + "\"}";
  pendingCandidateId = "";

  String vResp;
  const int vCode = httpCall("POST", "/api/validation-result", &body, vResp);
  bool blockMined = false;
  if (vCode == 200) {
    logf("[VALIDATE] vote OK (score %s)", sc);
    if (vResp.indexOf("\"blockMined\":true") >= 0) { logf("[VALIDATE] BLOC MINÉ"); blockMined = true; }
  } else {
    logf("[VALIDATE] vote refusé (%d)", vCode);
    if (vResp.indexOf("Signature") >= 0) { logf("[VALIDATE] resynchronisation de la clé publique (re-register)"); doRegister(); }
  }
  return blockMined;
}

// ─── AUTO-TEST Ed25519 (au boot) ───────────────────────────────────────────
static void selfTestEd25519() {
  static const char msg[] = "pod-r4-selftest";
  uint8_t sig[64];
  unsigned long t = millis();
  Ed25519::sign(sig, privateKey, publicKey, msg, strlen(msg));
  const unsigned long tSign = millis() - t;
  t = millis();
  const bool ok = Ed25519::verify(sig, publicKey, msg, strlen(msg));
  logf("[SELFTEST] Ed25519 signature %lu ms, vérification %lu ms -> %s", tSign, millis() - t, ok ? "OK" : "ECHEC");
  reportMem("après Ed25519");
}

// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
void setup() {
  paintStack();
  Serial.begin(115200);
  while (!Serial && millis() < 2500) {}
  logf("\n[BOOT] Proof-of-Draw UNO R4 WiFi + e-ink 2.9\" BWR — %s", FIRMWARE_VERSION);
  reportMem("boot");

  epd.begin();
  clearBothPlanes();

  if (WiFi.status() == WL_NO_MODULE) { logf("[WIFI] module absent"); while (true) delay(1000); }
  logf("[WIFI] firmware du module: %s", WiFi.firmwareVersion());
  if (strlen(WIFI_SSID) == 0) logf("[WIFI] SSID vide : créer secrets.h (voir secrets.h.example)");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries++ < 4) {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  }
  if (WiFi.status() != WL_CONNECTED) { logf("[WIFI] échec — redémarrage"); delay(3000); NVIC_SystemReset(); }
  logf("[WIFI] IP: %s", WiFi.localIP().toString().c_str());

  if (!keysAlreadyGenerated()) generateKeys();
  else { loadKeysFromEEPROM(); logf("[KEYS] clés chargées: %s", bytesToHex(publicKey, 32).c_str()); }
  selfTestEd25519();

  currentBlockHash = loadBlockHashFromEEPROM();
  {
    bool ok = currentBlockHash.length() >= 8;
    for (unsigned i = 0; i < currentBlockHash.length() && ok; i++) { const char c = currentBlockHash[i]; ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
    if (!ok) currentBlockHash = "";
  }
  lastFrameId = loadFrameId();                       // œuvre déjà à l'écran avant le redémarrage (l'e-ink la conserve)
  if (lastFrameId.length() > 0) logf("[BOOT] œuvre déjà affichée : %s", lastFrameId.c_str());

  while (!registered) { if (doRegister()) break; delay(5000); }
  if (paired) {
    logf("[BOOT] premier pull immédiat");
    doPull();
  }
  lastPullMs = millis(); lastValidateMs = millis();
  logf("[BOOT] prêt — pull toutes les %lu s", PULL_INTERVAL / 1000UL);
}

void loop() {
  const unsigned long now = millis();

  if (!registered) { if (!doRegister()) { delay(5000); return; } }

  if (!paired) {
    if (now - lastPullMs >= 60000UL) {
      const bool wasPaired = paired;
      doRegister();
      lastPullMs = millis();
      if (!wasPaired && paired) { logf("[PAIRING] appairé -> redémarrage"); delay(1000); NVIC_SystemReset(); }
    }
    delay(250);
    return;
  }

  if (now - lastPullMs >= nextPullIntervalMs) {
    const String prevCand = pendingCandidateId;
    doPull();
    lastPullMs = millis();
    if (pendingCandidateId.length() > 0 && pendingCandidateId != prevCand) lastValidateMs = millis();
  }

  if (pendingObsHashes.length() > 0) doObsConfirm();

  if (pendingCandidateId.length() > 0 && millis() - lastValidateMs >= VALIDATE_INTERVAL) {
    const bool mined = doValidate();
    lastValidateMs = millis();
    if (mined) { delay(2000); doPull(); lastPullMs = millis(); }
  }
  delay(100);
}
