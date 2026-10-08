// pod_uno_r4_tft18.ino
// Proof-of-Draw — Firmware UNO R4 WiFi + TFT 1.8" ST7735S (128×160 RGB565)
//
// ⚠ NON TESTÉ SUR LE MATÉRIEL (06/10/2026).
// Le protocole réseau dérive des ports R4 existants et le câblage du firmware ESP8266 TFT 1.8".
// Le sketch doit être compilé et mesuré sur une vraie UNO R4 WiFi + ST7735S avant de retirer cet avertissement.
// Images fixes RGB565 prises en charge. Animations et scene-v1 restent volontairement non annoncées avant ce test.
//
// Même protocole et même type d'écran serveur (« tft18 ») que esp8266/esp_tft1.8 :
//   register → pull (métadonnées légères) → pull-frame?fmt=bin (40960 o) → affichage en flux → ACK,
//   validation distribuée (validate-candidate → vote signé Ed25519 → validation-result), ré-validation (obs-confirm), blocs possédés.
// Le serveur ne change pas : cet appareil est un écran tft18 comme les autres.
//
// Différences avec l'ESP8266 (toutes voulues) :
//   • Wi-Fi/TLS sur le coprocesseur ESP32-S3 (WiFiSSLClient) : plus de BearSSL dans la RAM → pas de free()/malloc() des buffers autour
//     des connexions ; une seule ligne RGB565 (256 o) est gardée en RAM pendant le flux ;
//   • lecture du flux par pod_http.h (lecture « readFull » sur réponse fragmentée, chunked accepté), identique au firmware TFT ;
//   • pile principale de 1 Ko seulement sur la R4 (cœur Arduino) : aucun gros tableau local, tout est statique ;
//   • aucune image complète de 40 Ko n'est allouée : chaque ligne reçue est immédiatement envoyée au TFT ;
//   • après un redémarrage l'écran est repeint par le serveur, car ce TFT ne conserve pas naturellement son image.
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
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <qrcode.h>
#include <Ed25519.h>
#include <SHA256.h>
#include "pod_http.h"
#include "pod_vote_r4.h"

// POD_RENDER_V1_BEGIN
// ─── Rendu v1 EN FLUX (lot 8B-2A) — INACTIF PAR DÉFAUT ────────────────────────────────────────────────────────────────────────────────────────────
// 0 (défaut) : comportement d'avant, octet pour octet (image streamée ligne par ligne, cartel dessiné ensuite par drawCartel).
// 1 : chaque ligne reçue est composée par le noyau gelé consensus-pod/src/podRenderStream.h (layoutVersion 1 : cartel, fit) — UNE ligne source + UNE ligne de sortie, les tampons g_rowBytes / g_rowPixels
//     EXISTANTS — et écrite au TFT telle qu'elle est hachée (renderHash) ; frameHash (octets reçus) et renderHash sont CALCULÉS et seulement journalisés — l'ACK, les routes et le rapport de rendu ne sont PAS modifiés.
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
#define SCREEN_TYPE         "tft18"
#define FIRMWARE_VERSION    "r4tft18-1.1"
#define PULL_INTERVAL       60000UL                // 1 min
#define VALIDATE_INTERVAL   30000UL                // 30 s : candidat en attente
#define HTTP_TIMEOUT_MS     20000UL

// ─── GÉOMÉTRIE ─────────────────────────────────────────────────────────────
#define TFT_CS  10
#define TFT_DC  9
#define TFT_RST 8
#define IMG_W 128
#define IMG_H 160
#define ROW_BYTES (IMG_W * 2)
#define FRAME_BYTES (IMG_W * IMG_H * 2)

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

#if ARDUINOJSON_VERSION_MAJOR >= 7
  #define JSON_DOC(name, cap) JsonDocument name
#else
  #define JSON_DOC(name, cap) DynamicJsonDocument name(cap)
#endif

// ─── OBJETS / ÉTAT ─────────────────────────────────────────────────────────
Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);
static uint8_t g_rowBytes[ROW_BYTES];
static uint16_t g_rowPixels[IMG_W];
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

// ─── TFT : affichage en flux, sans tampon plein écran ────────────────────────
#define C_BLACK 0x0000
#define C_WHITE 0xFFFF
#define C_NAVY  0x08C5
#define C_GOLD  0xFEA0
#define C_DARK  0x10C4
#define C_GREY  0x7BEF
#define C_RED   0xF800

static void tftStatus(const String& line1, const String& line2 = "", uint16_t bg = C_NAVY) {
  tft.fillScreen(bg);
  tft.setTextWrap(false);
  tft.setTextColor(C_GOLD, bg); tft.setTextSize(2); tft.setCursor(5, 8); tft.print("PoD");
  tft.drawFastHLine(0, 28, IMG_W, C_GOLD);
  tft.setTextColor(C_WHITE, bg); tft.setTextSize(1); tft.setCursor(5, 44); tft.print(line1);
  if (line2.length()) { tft.setTextColor(C_GREY, bg); tft.setCursor(5, 60); tft.print(line2); }
}

#if !POD_RENDER_V1   // cartel dessiné par-dessus / image streamée d'avant : remplacés par le noyau de rendu v1
static String fitText(const String& input, int chars) {
  String out = asciiFold(input);
  if ((int)out.length() > chars) out = out.substring(0, max(0, chars - 1)) + ".";
  return out;
}

static void drawCartel() {
  const int topH = 13, botY = IMG_H - 14;
  tft.fillRect(0, 0, IMG_W, topH, C_DARK);
  tft.fillRect(0, botY, IMG_W, IMG_H - botY, C_DARK);
  tft.setTextSize(1); tft.setTextWrap(false);
  tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(2, 3);
  tft.print(currentBlockIndex >= 0 ? "PoD #" + String(currentBlockIndex) : String("Proof-of-Draw"));
  String label = pendingArtistName.length() ? pendingArtistName + " - " + pendingWorkTitle : pendingWorkTitle;
  tft.setTextColor(C_WHITE, C_DARK); tft.setCursor(2, botY + 3); tft.print(fitText(label, 20));
}

static bool streamFrame(podhttp::Reader<WiFiSSLClient>& rd) {
  tft.startWrite();
  tft.setAddrWindow(0, 0, IMG_W, IMG_H);
  bool ok = true;
  for (int y = 0; y < IMG_H; y++) {
    if (rd.readBody(g_rowBytes, ROW_BYTES) != ROW_BYTES) { ok = false; break; }
    for (int x = 0; x < IMG_W; x++) {
      g_rowPixels[x] = (uint16_t)g_rowBytes[x * 2] | ((uint16_t)g_rowBytes[x * 2 + 1] << 8);
    }
    tft.writePixels(g_rowPixels, IMG_W, true);
  }
  tft.endWrite();
  return ok;
}

#endif

#if POD_RENDER_V1
// ─── Rendu v1 en flux : composition ligne par ligne ──────────────────────────────────────────────────────────────────────────────────────────────
// Mémoire (UNO R4, pile principale ≈ 1 Ko : objet et tampons GLOBAUX) : PodTftRenderer 424 o + ligne source g_rowBytes 256 o + ligne de sortie g_rowPixels 256 o (ces deux tampons existaient déjà) + 130 o de hashes.
// Aucune image entière, aucune grille. Ordre des octets : le noyau produit le RGB565 LITTLE-ENDIAN du plan (les octets hachés dans renderHash) ; sur la R4 (little-endian) g_rowPixels les lit comme des mots natifs,
// exactement comme l'ancien chemin (`g_rowPixels[x] = lo | hi << 8`), et writePixels(..., block=true, bigEndian=false) les envoie : le tampon remis au pilote EST celui qui alimente renderHash.
// L'API du pilote (writePixels) ne retourne aucune erreur : une écriture partielle n'est détectable que par l'échec de lecture / de composition AVANT la fin (alors : abandon, aucun ACK).
static PodTftRenderer<PodSha256Rw> g_podTft;
static char g_podFrameHex[65], g_podRenderHex[65];

// Retour : 0 = échec (aucun ACK) · 2 = rendu calculé ET remis au TFT.
static uint8_t podStreamFrame(podhttp::Reader<WiFiSSLClient>& rd) {
  const PodRenderSpec spec = pod_render_spec(POD_R_TFT18);
  const PodRenderMeta meta = { (const uint8_t*)pendingDisplayTs.c_str(), (size_t)pendingDisplayTs.length(), (int32_t)currentBlockIndex,
                               (const uint8_t*)pendingArtistName.c_str(), (size_t)pendingArtistName.length(), (const uint8_t*)pendingWorkTitle.c_str(), (size_t)pendingWorkTitle.length() };
  if (!g_podTft.begin(spec, POD_RENDER_MODE_DEFAULT, meta)) { logf("[RENDER] paramètres refusés — abandon"); return 0; }
  tft.startWrite();
  tft.setAddrWindow(0, 0, IMG_W, IMG_H);
  bool ok = true;
  while (ok && !g_podTft.allRowsEmitted()) {
    while (ok && g_podTft.needsSource()) ok = rd.readBody(g_rowBytes, ROW_BYTES) == ROW_BYTES && g_podTft.consumeSource(g_rowBytes);
    if (!ok) { logf("[RENDER] ligne source %u illisible", (unsigned)g_podTft.outY); break; }
    ok = g_podTft.emitRow(g_rowBytes, (uint8_t*)g_rowPixels);
    if (!ok) { logf("[RENDER] composition refusée"); break; }
    tft.writePixels(g_rowPixels, IMG_W, true);   // exactement les octets hachés
  }
  while (ok && g_podTft.sourceRemaining()) ok = rd.readBody(g_rowBytes, ROW_BYTES) == ROW_BYTES && g_podTft.consumeSource(g_rowBytes);   // l'image reçue est lue et hachée EN ENTIER
  tft.endWrite();
  if (!ok || !g_podTft.finish(g_podFrameHex, g_podRenderHex)) { logf("[RENDER] image abandonnée (aucun ACK) — l'écran peut être PARTIELLEMENT redessiné"); return 0; }
  return 2;
}
#endif

// ─── Onboarding ────────────────────────────────────────────────────────────
static void displayKeyMaterialOnce() {
  const String pubHex = bytesToHex(publicKey, 32), privHex = bytesToHex(privateKey, 32);
  logf("[KEYS] PubKey: %s", pubHex.c_str());
  tft.fillScreen(C_WHITE);
  tft.setTextWrap(false); tft.setTextSize(1);
  tft.setTextColor(C_BLACK, C_WHITE); tft.setCursor(3, 3); tft.print("PROOF-OF-DRAW / CLES");
  tft.drawFastHLine(0, 14, IMG_W, C_BLACK);
  tft.setCursor(3, 20); tft.print("PUBLIQUE:");
  for (int l = 0; l < 4; l++) { tft.setCursor(3, 31 + l * 10); tft.print(pubHex.substring(l * 16, l * 16 + 16)); }
  tft.setTextColor(C_RED, C_WHITE); tft.setCursor(3, 76); tft.print("PRIVEE - A NOTER:");
  for (int l = 0; l < 4; l++) { tft.setCursor(3, 87 + l * 10); tft.print(privHex.substring(l * 16, l * 16 + 16)); }
  tft.setTextColor(C_BLACK, C_WHITE); tft.setCursor(3, 134); tft.print("Affichee une seule fois");
  logf("[KEYS] clés affichées — 60 s pour les noter");
  delay(60000UL);
}

static void displayOnboardingQR(const String& onboardUrl, const String& code, const String& mac) {
  static QRCode qr;
  static uint8_t qrData[600];
  memset(qrData, 0, sizeof(qrData));
  int res = qrcode_initText(&qr, qrData, 4, ECC_LOW, onboardUrl.c_str());
  if (res < 0) res = qrcode_initText(&qr, qrData, 5, ECC_LOW, onboardUrl.c_str());
  tft.fillScreen(C_NAVY);
  tft.setTextWrap(false); tft.setTextSize(1); tft.setTextColor(C_GOLD, C_NAVY); tft.setCursor(3, 3); tft.print("SCAN TO PAIR");
  if (res >= 0) {
    int scale = min(2, (IMG_W - 12) / qr.size); if (scale < 1) scale = 1;
    const int px = qr.size * scale, x0 = (IMG_W - px) / 2, y0 = 16;
    tft.fillRect(x0 - 3, y0 - 3, px + 6, px + 6, C_WHITE);
    for (int y = 0; y < qr.size; y++) for (int x = 0; x < qr.size; x++)
      if (qrcode_getModule(&qr, x, y)) tft.fillRect(x0 + x * scale, y0 + y * scale, scale, scale, C_BLACK);
  }
  tft.setTextColor(C_GOLD, C_NAVY); tft.setTextSize(2);
  int cx = max(0, (IMG_W - (int)code.length() * 12) / 2); tft.setCursor(cx, 126); tft.print(code);
  String m = mac; m.replace(":", ""); m.toUpperCase();
  tft.setTextSize(1); tft.setTextColor(C_GREY, C_NAVY); tft.setCursor(3, 150); tft.print("MAC:" + m);
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
  bool shown = false, noFrame = false;
  {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", "/api/pull-frame?deviceId=" + deviceId + "&screen=" SCREEN_TYPE "&fmt=bin", nullptr);
    logf("[HTTP GET] /api/pull-frame -> %d (contenu %ld)", code, c.rd.contentLength());
    if (code == 404) noFrame = true;
    else if (code == 200 && (c.rd.contentLength() < 0 || c.rd.contentLength() == FRAME_BYTES)) {
#if POD_RENDER_V1
      shown = podStreamFrame(c.rd) == 2 && c.rd.complete();
#else
      shown = streamFrame(c.rd) && c.rd.complete();
#endif
    } else if (code == 200) {
      logf("[FRAME] taille annoncée %ld != %d (le serveur sert-il bien tft18 ?)", c.rd.contentLength(), FRAME_BYTES);
    }
    c.client.stop();
  }
  if (noFrame) { logf("[FRAME] pas de frame disponible"); return true; }
  if (!shown) { logf("[FRAME] image incomplète — pas d'ACK, nouvel essai au prochain pull"); return false; }

#if POD_RENDER_V1
  logf("[RENDER] calculé ET remis au TFT — mode=%u frameHash=%s renderHash=%s", (unsigned)POD_RENDER_MODE_DEFAULT, g_podFrameHex, g_podRenderHex);   // le cartel fait partie de l'image rendue
#else
  drawCartel();
#endif
  lastFrameId = frameId;                              // RAM seulement : après reboot le TFT doit être repeint
  lastFrameWasConsensus = frameSource == "consensus";
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
  if (newFrameId == lastFrameId) { logf("[PULL] frame déjà affichée"); return true; }
  logf("[PULL] nouvelle frame %s (%s)", newFrameId.c_str(), newFrameSource.c_str());

  doFetchFrame(newFrameId, newFrameSource);          // échec : on retourne quand même true (pas de boucle pull→échec→pull)
  reportMem("après pull");
  return true;
}

// ─── VALIDATION RÉELLE (vote v2) — ⚠ NON TESTÉE SUR LA CARTE ─────────────
static uint8_t g_voteChunk[256];
static uint8_t g_voteScratch[4736];   // tampon de l'OLED (1 024 o) et de l'e-ink 2,9" (4 736 o) : un candidat de N'IMPORTE QUEL écran est relu (le serveur ne l'oblige pas à voter pour son type)

static bool doValidateV2(const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash) {
  PodScreenKind kind;
  if (!podKindFromName(screenName.c_str(), &kind)) {
    logf("[VALIDATE2] écran inconnu : %s", screenName.c_str());
    return false;
  }
  PodCheck chk; memset(&chk, 0, sizeof(chk));
  {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", String("/api/candidate-frame?candidateId=") + candidateId, nullptr);
    chk.http = code;
    if (code == 200) podCheckStream(c.rd, kind, bytes, g_voteScratch, sizeof(g_voteScratch), g_voteChunk, sizeof(g_voteChunk), &chk);
    c.client.stop();
  }
  if (!chk.ok) { logf("[VALIDATE2] calcul impossible (%u/%u octets)", (unsigned)chk.bytes, (unsigned)bytes); return false; }
  bool accept = false; const char* reason = podVerdict(chk, announcedHash, &accept);
  const String msg = podVoteMessage(deviceId, candidateId, chk.hash, chk.m, accept);
  uint8_t sig[64]; Ed25519::sign(sig, privateKey, publicKey, (const uint8_t*)msg.c_str(), msg.length());
  const String body = String("{\"v\":2,\"deviceId\":\"") + deviceId + "\",\"candidateId\":\"" + candidateId + "\",\"rawHash\":\"" + chk.hash + "\"," +
                      "\"e\":" + String((unsigned long)chk.m.e) + ",\"t\":" + String((unsigned long)chk.m.t) + ",\"r\":" + String((unsigned long)chk.m.r) + "," +
                      "\"verdict\":\"" + (accept ? "accept" : "reject") + "\"" + (accept ? String("") : String(",\"reason\":\"") + reason + "\"") +
                      ",\"signature\":\"" + bytesToHex(sig, 64) + "\"}";
  String resp; const int code = httpCall("POST", "/api/validation-result", &body, resp);
  logf("[VALIDATE2] e=%lu t=%lu r=%lu verdict=%s HTTP=%d", (unsigned long)chk.m.e, (unsigned long)chk.m.t, (unsigned long)chk.m.r, accept ? "accept" : reason, code);
  // 403 « Signature » = clé publique désynchronisée côté serveur : on se ré-enregistre pour la renvoyer (comme le chemin v1), le prochain cycle votera.
  if (code != 200 && resp.indexOf("Signature") >= 0) { logf("[VALIDATE2] resynchronisation de la clé publique (re-register)"); doRegister(); }
  return code == 200 && resp.indexOf("\"blockMined\":true") >= 0;
}

// ─── VALIDATION ────────────────────────────────────────────────────────────
static bool doValidate() {
  if (pendingCandidateId.length() == 0) return false;
  String resp;
  if (httpCall("GET", "/api/validate-candidate?deviceId=" + deviceId, nullptr, resp) != 200 || resp.length() == 0) { pendingCandidateId = ""; return false; }
  JSON_DOC(doc, 768);
  if (deserializeJson(doc, resp)) { pendingCandidateId = ""; return false; }
  if ((doc["alreadyVoted"] | false) || doc["candidate"].isNull()) { pendingCandidateId = ""; return false; }
  JsonObject cand = doc["candidate"];
  const String candidateId = cand["candidateId"] | "";
  if (candidateId.length() == 0) { pendingCandidateId = ""; return false; }
  if (!cand["v2"].isNull()) {
    const String screen = cand["v2"]["screen"] | "";
    const size_t bytes = cand["v2"]["bytes"] | 0;
    const String hash = cand["v2"]["hash"] | "";
    pendingCandidateId = "";
    return doValidateV2(candidateId, screen, bytes, hash);
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
  logf("\n[BOOT] Proof-of-Draw UNO R4 WiFi + TFT 1.8\" — %s", FIRMWARE_VERSION);
  logf("[WARNING] PORT NON TESTE SUR LE MATERIEL — 06/10/2026");
  reportMem("boot");

  pinMode(TFT_CS, OUTPUT); digitalWrite(TFT_CS, HIGH);
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(0);
  tftStatus("Connexion Wi-Fi...");

  if (WiFi.status() == WL_NO_MODULE) { logf("[WIFI] module absent"); while (true) delay(1000); }
  logf("[WIFI] firmware du module: %s", WiFi.firmwareVersion());
  if (strlen(WIFI_SSID) == 0) logf("[WIFI] SSID vide : créer secrets.h (voir secrets.h.example)");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries++ < 4) {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  }
  if (WiFi.status() != WL_CONNECTED) { logf("[WIFI] échec — redémarrage"); tftStatus("Wi-Fi impossible", "Redemarrage...", C_RED); delay(3000); NVIC_SystemReset(); }
  logf("[WIFI] IP: %s", WiFi.localIP().toString().c_str());
  tftStatus("Wi-Fi connecte", WiFi.localIP().toString());

  if (!keysAlreadyGenerated()) generateKeys();
  else { loadKeysFromEEPROM(); logf("[KEYS] clés chargées: %s", bytesToHex(publicKey, 32).c_str()); }
  selfTestEd25519();

  currentBlockHash = loadBlockHashFromEEPROM();
  {
    bool ok = currentBlockHash.length() >= 8;
    for (unsigned i = 0; i < currentBlockHash.length() && ok; i++) { const char c = currentBlockHash[i]; ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
    if (!ok) currentBlockHash = "";
  }
  lastFrameId = "";                                 // le TFT perd son image : forcer un nouveau fetch après chaque démarrage

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
