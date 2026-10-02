// pod_uno_r4.ino
// Proof-of-Draw — Firmware UNO R4 WiFi + shield « 2.8" TFT Touch » (ILI9341 240×320 + STMPE610 + microSD)
//
// Même protocole que les firmwares ESP8266 (register → pull → frame/scene → ACK, validation Ed25519, observation),
// porté sur l'UNO R4 WiFi :
//   • le Wi-Fi/TLS passe par le coprocesseur ESP32-S3 (WiFiSSLClient) : plus de BearSSL dans la RAM du microcontrôleur ;
//   • l'appareil se déclare « tft18 » (128×160) : le serveur n'a RIEN à changer. L'image est agrandie ×1,5 (192×240) au centre
//     de l'écran 240×320, avec un cartel natif (titre / artiste / n° de bloc) en bandes haute et basse ;
//   • œuvres ANA animées (scene-v1) : le paquet ANAS (≤ 4 Ko) est téléchargé, vérifié, puis rejoué localement (2 FPS) ;
//   • tactile (STMPE610) : un toucher REJOUE l'animation en cours, ou, sur une image fixe, force un pull immédiat.
//
// Câblage : le shield s'enfiche tel quel sur l'UNO R4 WiFi (TFT CS 10 / DC 9, tactile CS 8, SD CS 4 — non utilisée ici).
// Bibliothèques : Adafruit ILI9341, Adafruit GFX, Adafruit BusIO, Adafruit STMPE610, ArduinoJson (≥ 6, testé 7.4), QRCode, Crypto (Ed25519, SHA256).
// Carte : « Arduino UNO R4 WiFi ». Moniteur série : 115200.
//
// ⚠ Débit : la liaison RA4M1 ↔ ESP32-S3 est à 115200 bauds → une image complète (40 960 o) met plusieurs secondes ;
//   un paquet de scène (≤ 4 Ko) moins d'une seconde. Les temps réels sont affichés au Serial ([FRAME] / [SCENE]).
// ⚠ TLS : le coprocesseur vérifie le certificat avec son lot de certificats racine. Si « connexion TLS impossible » s'affiche,
//   mettre à jour le firmware du module Wi-Fi (IDE → Outils → Updater le firmware) et/ou ajouter le certificat racine du serveur.

#include <Arduino.h>
#include <malloc.h>
#include <stdarg.h>
#include <WiFiS3.h>
#include <SPI.h>
#include <EEPROM.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Adafruit_STMPE610.h>
#include <qrcode.h>
#include <Ed25519.h>
#include <SHA256.h>
#include "pod_http.h"
#include "pod_scale.h"
#include "ana_scene_v1.h"   // copie identique de esp8266/esp_tft1.8/ana_scene_v1.h (vérifié par tests/podHttpR4.test.ts)

// ─── CONFIG ────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "AndroidF";
const char* WIFI_PASSWORD = "Lincoln55";

#define SERVER_HOST       "proof-of-draw.vercel.app"
#define SCREEN_TYPE       "tft18"            // profil serveur 128×160 RGB565 (agrandi ×1,5 ici)
#define FIRMWARE_VERSION  "r4tft28-1.0"
#define TOUCH_ENABLED     0                  // 0 = tactile ignoré (rien n'est initialisé) ; 1 = toucher = rejeu de la scène / pull immédiat
#define PULL_INTERVAL     60000UL
#define VALIDATE_INTERVAL 30000UL
#define HTTP_TIMEOUT_MS   20000UL

// scene-v1 : le serveur compile pour la classe « f2 » du TFT ; ne pas déclarer plus tant que lib/scene/delivery.ts n'a pas de classe f4+.
#define SCENE_MAX_FPS       2
#define SCENE_MAX_PACKAGE   4096
#define SCENE_MAX_FAILS     2

// ─── PINS (shield Adafruit 2.8" TFT Touch) ─────────────────────────────────
#define TFT_CS    10
#define TFT_DC    9
#define STMPE_CS  8
#define SD_CS     4

// ─── GÉOMÉTRIE ─────────────────────────────────────────────────────────────
#define SRC_W   128
#define SRC_H   160
#define SRC_ROW_BYTES (SRC_W * 2)
#define SRC_BYTES     (SRC_W * SRC_H * 2)     // 40960
#define SCR_W   240
#define SCR_H   320
#define ART_W   192                           // 128 × 1,5
#define ART_H   240                           // 160 × 1,5
#define ART_X   ((SCR_W - ART_W) / 2)         // 24
#define ART_Y   ((SCR_H - ART_H) / 2)         // 40
#define BAND_H  ART_Y                         // bandes cartel haute/basse

// agrandissement ×1,5 « plus proche voisin » : voir pod_scale.h (testé sur PC contre le moteur de référence)
using podscale::up;

// Couleurs RGB565
#define C_BLACK  0x0000
#define C_WHITE  0xFFFF
#define C_NAVY   0x08C5
#define C_GOLD   0xFEA0
#define C_DARK   0x10C4
#define C_GREY   0x7BEF
#define C_RED    0xF800

// ─── EEPROM (flash de données de la R4 : 8 Ko, pas de commit) — même carte mémoire que les firmwares ESP ─────────────
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

// ─── OBJETS ────────────────────────────────────────────────────────────────
Adafruit_ILI9341  tft(TFT_CS, TFT_DC);
Adafruit_STMPE610 ts(STMPE_CS);
bool touchOk = false;

// ─── ÉTAT ──────────────────────────────────────────────────────────────────
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
bool   pullNow = false;                         // posé par un toucher

String pendingWorkTitle = "", pendingArtistName = "";
String pendingObsHashes = "", pendingObsTarget = "";

String sceneFailFrameId = "";
int    sceneFailCount = 0;

// scène courante conservée (≤ 4 Ko, tampon statique : pas de fragmentation du tas) pour pouvoir la REJOUER au toucher
static uint8_t scenePkg[SCENE_MAX_PACKAGE];
static anascene::Scene curScene;
static bool   sceneLoaded = false;

static char     g_body[3072];                   // corps JSON des réponses
static uint16_t g_srcRow[SRC_W];                // une ligne source, octets big-endian (voir presentRect)
static uint16_t g_dstRow[ART_W];                // une ligne agrandie

// ─── LOG ───────────────────────────────────────────────────────────────────
static void logf(const char* fmt, ...) {
  static char b[256];                       // statique : la pile du cœur R4 ne fait que 1 Ko
  va_list ap; va_start(ap, fmt); vsnprintf(b, sizeof(b), fmt, ap); va_end(ap);
  Serial.println(b);
}

// ─── MÉMOIRE : 32 Ko de RAM, PILE PRINCIPALE DE 1 Ko SEULEMENT (cœur Arduino R4, BSP_CFG_STACK_MAIN_BYTES = 0x400) ─────────
// Le cœur désactive la protection de pile (MSPLIM = 0) : une pile qui dépasse 1 Ko descend dans le HAUT du tas (zone libre tant que
// le tas est peu rempli). Ed25519 a besoin d'environ 1,7 Ko : ça tient parce que le tas est presque vide à ce moment-là.
// Règle de ce firmware : jamais de gros bloc (hors tampon image de scène, alloué seulement pendant la lecture) ni de gros tableau
// local. Les diagnostics [MEM] affichent le tas libre et la profondeur de pile atteinte : à relever au premier essai.
extern "C" char* sbrk(int incr);
extern char __HeapLimit;                    // symbole de l'éditeur de liens : fin du tas = bas de la pile principale
static const uint32_t STACK_PAINT_BYTES = 2048;
static uint32_t freeHeapBytes() {
  struct mallinfo mi = mallinfo();
  return (uint32_t)mi.fordblks + (uint32_t)(&__HeapLimit - (char*)sbrk(0));
}
static void paintStack() { for (volatile uint8_t* p = (volatile uint8_t*)&__HeapLimit - STACK_PAINT_BYTES; p < (volatile uint8_t*)&__HeapLimit; p++) *p = 0xA5; }
/** Profondeur de pile maximale atteinte depuis paintStack() : 1 Ko de pile propre + ce qui a débordé dans le haut du tas. */
static uint32_t stackDepthBytes() {
  const uint8_t* lo = (const uint8_t*)&__HeapLimit - STACK_PAINT_BYTES;
  const uint8_t* p = lo;
  while (p < (const uint8_t*)&__HeapLimit && *p == 0xA5) p++;
  return 1024 + (uint32_t)((const uint8_t*)&__HeapLimit - p);
}
static void reportMem(const char* tag) { logf("[MEM] %s: tas libre %lu o, pile max ~%lu o", tag, (unsigned long)freeHeapBytes(), (unsigned long)stackDepthBytes()); }

// ─── Texte : ASCII seulement (police 5×7 de GFX) — replie les accents UTF-8 ─────────────────
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
  if (memcmp(derived, publicKey, 32) != 0) {   // écriture interrompue entre clé privée et publique
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
  const int m = (int)(score * 1000.0f + 0.5f);               // « 0.543 » : 3 décimales, comme toFixed(3) côté serveur
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

// ─── Affichage ─────────────────────────────────────────────────────────────
static void tftStatus(const String& line1, const String& line2 = "", uint16_t bg = C_NAVY) {
  tft.setRotation(0);
  tft.fillScreen(bg);
  tft.fillRect(0, 0, SCR_W, 28, C_DARK);
  tft.drawFastHLine(0, 28, SCR_W, C_GOLD);
  tft.setTextSize(2); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(8, 7); tft.print("RESCOE");
  tft.setTextColor(C_WHITE, bg); tft.setCursor(8, 140); tft.print(asciiFold(line1));
  if (line2.length()) { tft.setTextSize(1); tft.setTextColor(C_GREY, bg); tft.setCursor(8, 168); tft.print(asciiFold(line2)); }
}

/** Marges noires autour de l'œuvre (192×240 au centre) — appelé avant de dessiner une image. */
static void beginArt() {
  tft.fillRect(0, ART_Y, ART_X, ART_H, C_BLACK);
  tft.fillRect(ART_X + ART_W, ART_Y, SCR_W - ART_X - ART_W, ART_H, C_BLACK);
}

/** Bandes de cartel natives (texte 2× plus net que sur le TFT 1,8") : « RESCOE #bloc » en haut, titre + artiste en bas. */
static void burnCartel() {
  tft.fillRect(0, 0, SCR_W, BAND_H - 1, C_DARK);
  tft.drawFastHLine(0, BAND_H - 1, SCR_W, C_GOLD);
  tft.setTextSize(2); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(8, 12); tft.print("RESCOE");
  if (currentBlockIndex >= 0) {
    const String blk = "#" + String(currentBlockIndex);
    tft.setTextColor(C_GREY, C_DARK); tft.setCursor(SCR_W - 8 - (int)blk.length() * 12, 12); tft.print(blk);
  }
  const int fy = ART_Y + ART_H;
  tft.fillRect(0, fy + 1, SCR_W, SCR_H - fy - 1, C_DARK);
  tft.drawFastHLine(0, fy, SCR_W, C_GOLD);
  String title = asciiFold(pendingWorkTitle), artist = asciiFold(pendingArtistName);
  if (title.length() == 0) title = "Proof-of-Draw";
  if (title.length() > 19) title = title.substring(0, 19);
  if (artist.length() > 38) artist = artist.substring(0, 38);
  tft.setTextSize(2); tft.setTextColor(C_WHITE, C_DARK); tft.setCursor(8, fy + 6); tft.print(title);
  if (artist.length()) { tft.setTextSize(1); tft.setTextColor(C_GREY, C_DARK); tft.setCursor(8, fy + 26); tft.print(artist); }
}

// ─── Image fixe : flux 40 960 o RGB565 little-endian, ligne par ligne ───────
static bool streamFrame(podhttp::Reader<WiFiSSLClient>& rd) {
  bool ok = true;
  uint8_t* be = (uint8_t*)g_srcRow;                       // la ligne est lue ET convertie sur place (pas de tableau local : pile de 1 Ko)
  podscale::openWindow(tft, ART_X, ART_Y, 0, 0, SRC_W, SRC_H);   // = fenêtre 192×240
  for (int y = 0; y < SRC_H; y++) {
    if (rd.readBody(be, SRC_ROW_BYTES) != (size_t)SRC_ROW_BYTES) { logf("[FRAME] ligne %d incomplète", y); ok = false; break; }
    for (int i = 0; i < SRC_ROW_BYTES; i += 2) { const uint8_t t = be[i]; be[i] = be[i + 1]; be[i + 1] = t; }   // LE serveur -> BE bus SPI
    podscale::pushRow(tft, be, 0, SRC_W, y, g_dstRow);
  }
  tft.endWrite();
  return ok;
}

static bool ackFrame(const String& frameId, const char* mode = nullptr) {
  if (frameId.length() == 0) return false;
  String body = "{\"deviceId\":\"" + deviceId + "\",\"frameId\":\"" + frameId + "\"";
  if (mode) body += ",\"mode\":\"" + String(mode) + "\"";
  body += "}";
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
    else if (code == 200 && (c.rd.contentLength() < 0 || c.rd.contentLength() == SRC_BYTES)) {
      beginArt();
      shown = streamFrame(c.rd) && c.rd.complete();
    }
    c.client.stop();
  }
  if (noFrame) { logf("[FRAME] pas de frame disponible"); return true; }
  if (!shown) { logf("[FRAME] image incomplète — affichage conservé, pas d'ACK"); return false; }
  burnCartel();
  sceneLoaded = false;                                   // l'image fixe remplace la scène : un toucher = pull
  lastFrameId = frameId;
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId = "";
  logf("[FRAME] OK en %lu ms (frameId=%s source=%s)", millis() - t0, frameId.c_str(), frameSource.c_str());
  ackFrame(frameId);
  return true;
}

// ─── scene-v1 ──────────────────────────────────────────────────────────────
/** Pousse un rectangle de la scène (coordonnées source) agrandi ×1,5 : fenêtre d'adresse exacte, lignes répétées 1 ou 2 fois. */
static void pushScaledRect(const anascene::Fb& fb, const anascene::Scene& sc, const anascene::Rect& r) {
  podscale::openWindow(tft, ART_X, ART_Y, r.x, r.y, r.w, r.h);
  anascene::presentRect(fb, sc, r, g_srcRow, [&](const uint16_t* row, int n, int y) {
    podscale::pushRow(tft, (const uint8_t*)row, r.x, n, y, g_dstRow);
  });
  tft.endWrite();
}

/** Joue la scène : tick 0 plein cadre, puis uniquement le rectangle sale. Aucun réseau. false = tampon image impossible. */
static bool playScene(const anascene::Scene& sc) {
  const size_t fbBytes = anascene::Fb::bytesFor(SRC_W, SRC_H);
  uint8_t* fbMem = (uint8_t*)malloc(fbBytes);
  if (!fbMem) { logf("[SCENE] malloc(%u) impossible", (unsigned)fbBytes); return false; }
  anascene::Fb fb; fb.init(fbMem, SRC_W, SRC_H);

  const int fps = anascene::effectiveFps(sc, SCENE_MAX_FPS);
  const unsigned long frameMs = 1000UL / (unsigned long)fps;
  const int total = (int)sc.durationTicks * (int)sc.loopCount;
  logf("[SCENE] lecture: %d ticks x %d boucle(s), %d FPS (scène %d, écran max %d)", sc.durationTicks, sc.loopCount, fps, sc.tickRate, SCENE_MAX_FPS);

  beginArt();
  unsigned long renderMax = 0, pushMax = 0, pixels = 0; int overruns = 0;
  const unsigned long start = millis();
  for (int step = 0; step < total; step++) {
    const int tick = step % sc.durationTicks;
    const unsigned long deadline = start + (unsigned long)(step + 1) * frameMs;   // échéancier absolu

    const unsigned long t0 = micros();
    anascene::renderTick(sc, fb, tick);
    const unsigned long tRender = micros() - t0;

    anascene::Rect r;
    if (step == 0) r = { 0, 0, SRC_W, SRC_H, true };
    else           r = anascene::dirtyRectBetween(sc, anascene::prevTickOf(sc, tick), tick);
    const unsigned long t1 = micros();
    if (r.valid) { pushScaledRect(fb, sc, r); pixels += (unsigned long)r.w * r.h; }
    const unsigned long tPush = micros() - t1;

    if (tRender > renderMax) renderMax = tRender;
    if (tPush > pushMax) pushMax = tPush;
    if ((long)(millis() - deadline) > 0) overruns++;
    while ((long)(millis() - deadline) < 0) delay(1);
  }
  reportMem("fin de lecture (tampon image encore alloué)");
  free(fbMem);
  logf("[SCENE] terminé: %d frames en %lu ms (cible %lu) — rendu max %lu us, envoi TFT max %lu us, pixels %lu (plein = %lu), dépassements %d",
       total, millis() - start, (unsigned long)total * frameMs, renderMax, pushMax, pixels, (unsigned long)total * SRC_W * SRC_H, overruns);
  return true;
}

/** Télécharge le paquet ANAS dans scenePkg (TLS fermé au retour). httpCode 404 = pas de scène pour nous. */
static bool fetchScenePackage(const String& artifactId, size_t announced, int* httpCode) {
  Conn c(HTTP_TIMEOUT_MS);
  const int code = c.request("GET", "/api/pull-frame?deviceId=" + deviceId + "&screen=" SCREEN_TYPE "&kind=scene&artifactId=" + artifactId + "&fmt=bin", nullptr);
  *httpCode = code;
  logf("[HTTP GET] /api/pull-frame kind=scene (%u o annoncés) -> %d", (unsigned)announced, code);
  if (code != 200) { c.client.stop(); return false; }
  const long declared = c.rd.contentLength();
  if (declared >= 0 && (size_t)declared != announced) { logf("[SCENE] Content-Length %ld != %u annoncés", declared, (unsigned)announced); c.client.stop(); return false; }
  const unsigned long t0 = millis();
  const size_t got = c.rd.readBody(scenePkg, announced);
  const bool ok = got == announced && c.rd.complete();
  c.client.stop();
  logf("[SCENE] reçu %u/%u o en %lu ms", (unsigned)got, (unsigned)announced, millis() - t0);
  return ok;
}

/** Frame annoncée « scène » par /api/pull. Repli : image fixe (pas de pointeur, 404, tampon impossible) ; paquet invalide = on garde l'affichage, pas d'ACK. */
static bool doFetchScene(const String& frameId, const String& frameSource, const String& artifactId, size_t announced, const String& hash16) {
  if (artifactId.length() == 0 || announced < anascene::HEADER_BYTES + 4 || announced > SCENE_MAX_PACKAGE) {
    logf("[SCENE] pointeur inexploitable — image fixe");
    return doFetchFrame(frameId, frameSource);
  }
  if (sceneFailFrameId != frameId) { sceneFailFrameId = frameId; sceneFailCount = 0; }
  if (sceneFailCount >= SCENE_MAX_FAILS) { logf("[SCENE] trop d'échecs — image fixe"); return doFetchFrame(frameId, frameSource); }

  int httpCode = 0;
  const bool received = fetchScenePackage(artifactId, announced, &httpCode);
  if (httpCode == 404) { logf("[SCENE] 404 — image fixe"); return doFetchFrame(frameId, frameSource); }

  anascene::Scene sc;
  anascene::Err perr = received ? anascene::parse(scenePkg, announced, anascene::PROFILE_TFT, sc) : anascene::ERR_TRUNCATED;
  if (received && perr == anascene::OK && hash16.length() == 16) {
    char got[17];
    for (int i = 0; i < 8; i++) snprintf(got + 2 * i, 3, "%02x", scenePkg[24 + i]);
    if (!hash16.equalsIgnoreCase(String(got))) perr = anascene::ERR_HEADER;   // identité : 8 octets de hash annoncés = ceux du paquet
  }
  if (perr != anascene::OK) {
    sceneFailCount++;
    sceneLoaded = false;
    logf("[SCENE] paquet refusé (%s, échec %d/%d) — affichage conservé, aucun ACK", received ? anascene::errName(perr) : "réception incomplète", sceneFailCount, SCENE_MAX_FAILS);
    return false;
  }
  curScene = sc; sceneLoaded = true;                       // curScene pointe dans scenePkg (statique) : rejouable au toucher
  if (!playScene(curScene)) { sceneLoaded = false; return doFetchFrame(frameId, frameSource); }
  burnCartel();
  lastFrameId = frameId;
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId = "";
  sceneFailCount = 0;
  ackFrame(frameId, "scene");
  logf("[SCENE] OK frameId=%s source=%s", frameId.c_str(), frameSource.c_str());
  return true;
}

// ─── Tactile ───────────────────────────────────────────────────────────────
// Un toucher : rejoue l'animation en cours (scène), sinon force un pull immédiat (image fixe / rien à l'écran).
static void drainTouch() {
  while (!ts.bufferEmpty()) ts.getPoint();
  ts.writeRegister8(STMPE_INT_STA, 0xFF);
}
static void serviceTouch() {
  if (!touchOk || !ts.touched()) return;
  const unsigned long t0 = millis();
  while (ts.touched() && millis() - t0 < 1500UL) { delay(5); }   // attend le relâchement (anti-rebond)
  drainTouch();
  delay(120);
  if (sceneLoaded) {
    logf("[TOUCH] rejeu de la scène");
    playScene(curScene);
    burnCartel();
  } else {
    logf("[TOUCH] pull immédiat");
    pullNow = true;
  }
  drainTouch();
}
static bool waitTapOrTimeout(unsigned long ms) {   // pour l'écran des clés : touché = continuer
  const unsigned long t0 = millis();
  while (millis() - t0 < ms) { if (touchOk && ts.touched()) { drainTouch(); return true; } delay(50); }
  return false;
}

// ─── Onboarding ────────────────────────────────────────────────────────────
static void displayKeyMaterialOnce() {
  const String pubHex = bytesToHex(publicKey, 32), privHex = bytesToHex(privateKey, 32);
  logf("[KEYS] PubKey: %s", pubHex.c_str());   // la clé privée n'est JAMAIS écrite au Serial
  tft.setRotation(0);
  tft.fillScreen(C_WHITE);
  tft.setTextColor(C_BLACK, C_WHITE); tft.setTextSize(2); tft.setCursor(8, 6); tft.print("PROOF-OF-DRAW");
  tft.drawFastHLine(0, 28, SCR_W, C_BLACK);
  tft.setTextSize(1);
  tft.setCursor(8, 40); tft.print("CLE PUBLIQUE :");
  for (int l = 0; l < 2; l++) { tft.setCursor(8, 54 + l * 12); tft.print(pubHex.substring(l * 32, l * 32 + 32)); }
  tft.setTextColor(C_RED, C_WHITE);
  tft.setCursor(8, 100); tft.print("CLE PRIVEE (UNE SEULE FOIS) :");
  for (int l = 0; l < 2; l++) { tft.setCursor(8, 114 + l * 12); tft.print(privHex.substring(l * 32, l * 32 + 32)); }
  tft.setTextColor(C_BLACK, C_WHITE);
  tft.setCursor(8, 160); tft.print("Notez la cle privee MAINTENANT.");
  tft.setCursor(8, 176); tft.print("Touchez l'ecran pour continuer");
  tft.setCursor(8, 188); tft.print("(sinon suite automatique dans 60 s).");
  logf("[KEYS] Clés affichées — 60 s (ou toucher)");
  waitTapOrTimeout(60000UL);
}

static void displayOnboardingTFT(const String& onboardUrl, const String& code, const String& macStr) {
  tft.setRotation(0);
  tft.fillScreen(C_NAVY);
  tft.fillRect(0, 0, SCR_W, 28, C_DARK);
  tft.drawFastHLine(0, 28, SCR_W, C_GOLD);
  tft.setTextSize(2); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(8, 7); tft.print("RESCOE");
  tft.setTextSize(1); tft.setTextColor(C_GREY, C_DARK); tft.setCursor(110, 12); tft.print("proof-of-draw");

  QRCode qr; uint8_t qrData[qrcode_getBufferSize(7)];
  memset(qrData, 0, sizeof(qrData));
  int res = -1;
  for (int ver = 3; ver <= 7 && res < 0; ver++) res = qrcode_initText(&qr, qrData, ver, ECC_LOW, onboardUrl.c_str());
  if (res >= 0) {
    int scale = 190 / qr.size; if (scale < 1) scale = 1;
    const int px = qr.size * scale, x0 = (SCR_W - px) / 2, y0 = 40;
    tft.fillRect(x0 - 6, y0 - 6, px + 12, px + 12, C_WHITE);
    for (int qy = 0; qy < qr.size; qy++) for (int qx = 0; qx < qr.size; qx++)
      tft.fillRect(x0 + qx * scale, y0 + qy * scale, scale, scale, qrcode_getModule(&qr, qx, qy) ? C_BLACK : C_WHITE);
  } else {
    tft.setTextSize(1); tft.setTextColor(C_WHITE, C_NAVY); tft.setCursor(8, 50); tft.print("Ouvrez : " + onboardUrl.substring(0, 28));
  }
  const int cs = ((int)code.length() * 24 <= 224) ? 4 : 3;
  tft.setTextSize(cs); tft.setTextColor(C_GOLD, C_NAVY);
  int cx = (SCR_W - (int)code.length() * 6 * cs) / 2; if (cx < 0) cx = 0;
  tft.setCursor(cx, 252); tft.print(code);
  String m = macStr; m.replace(":", ""); m.toUpperCase();
  tft.setTextSize(1); tft.setTextColor(C_GREY, C_NAVY); tft.setCursor(8, 300); tft.print("MAC:" + m);
  tft.setCursor(8, 288); tft.print("Scannez le QR ou entrez le code sur le site");
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
                      // capacité scene-v1 : strictement la forme du contrat ; toute autre valeur = pas de scene-v1
                      "\"sceneCapability\":{\"sceneV1\":true,\"maxPackageBytes\":4096,\"maxEntities\":24,"
                      "\"maxFps\":" + String(SCENE_MAX_FPS) + ",\"dirtyRectangles\":true,\"firmwareVersion\":\"" FIRMWARE_VERSION "\"},"
                      "\"ownedHashes\":" + loadOwnedHashesJson() + "}";
  String resp;
  if (httpCall("POST", "/api/register", &body, resp) != 200) {
    tftStatus("Register echoue", "Nouvel essai dans 5 s...", C_RED);
    return false;
  }
  JSON_DOC(doc, 768);
  if (deserializeJson(doc, resp)) { logf("[REGISTER] JSON illisible"); return false; }
  deviceId   = doc["deviceId"].as<String>();
  pairCode   = doc["pairCode"].as<String>();
  paired     = doc["paired"] | false;
  registered = true;
  logf("[REGISTER] deviceId=%s paired=%s", deviceId.c_str(), paired ? "oui" : "non");

  if (!paired && !onboardingAlreadyShown()) {
    displayKeyMaterialOnce();
    displayOnboardingTFT(String("https://" SERVER_HOST "/onboard?code=") + pairCode, pairCode, mac);
    setOnboardingShown();
  } else if (!paired) {
    displayOnboardingTFT(String("https://" SERVER_HOST "/onboard?code=") + pairCode, pairCode, mac);
  } else {
    tftStatus("Connecte", deviceId);
  }
  return true;
}

// ─── PULL ──────────────────────────────────────────────────────────────────
static bool doPull() {
  String newBlockHash = "", newCandId = "", newFrameId = "", newFrameSource = "none";
  int newBlockIndex = -1, pullRetryAfter = 60;
  String newKind = "frame", sceneArtifactId = "", sceneHash16 = "";
  size_t sceneBytes = 0;

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

    newKind = doc["kind"] | "frame";
    JsonObject sceneObj = doc["scene"];
    if (newKind == "scene" && !sceneObj.isNull()) {
      sceneArtifactId = sceneObj["artifactId"] | "";
      sceneBytes      = (size_t)(sceneObj["bytes"] | 0);
      sceneHash16     = sceneObj["hash"] | "";
    }
    if (newFrameId.length() == 0) { JsonObject fo = doc["frame"]; if (!fo.isNull()) newFrameId = fo["frameId"] | ""; }

    JsonObject cm = doc["cartelMeta"];
    if (!cm.isNull()) {
      pendingWorkTitle  = cm["workTitle"] | "";
      pendingArtistName = cm["drawArtistName"] | "";
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
  logf("[PULL] nouvelle frame %s (%s, %s)", newFrameId.c_str(), newFrameSource.c_str(), newKind.c_str());

  if (newKind == "scene") doFetchScene(newFrameId, newFrameSource, sceneArtifactId, sceneBytes, sceneHash16);
  else                    doFetchFrame(newFrameId, newFrameSource);
  reportMem("après pull");
  return true;
}

// ─── VALIDATION ────────────────────────────────────────────────────────────
static bool doValidate() {
  if (pendingCandidateId.length() == 0) return false;
  String resp;
  if (httpCall("GET", "/api/validate-candidate?deviceId=" + deviceId, nullptr, resp) != 200 || resp.length() == 0) { pendingCandidateId = ""; return false; }
  JSON_DOC(doc, 512);
  if (deserializeJson(doc, resp)) { pendingCandidateId = ""; return false; }
  if ((doc["alreadyVoted"] | false) || doc["candidate"].isNull()) { pendingCandidateId = ""; return false; }
  JsonObject cand = doc["candidate"];
  const String candidateId = cand["candidateId"] | "";
  if (candidateId.length() == 0) { pendingCandidateId = ""; return false; }
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
    logf("[VALIDATE] vote OK");
    if (vResp.indexOf("\"blockMined\":true") >= 0) { logf("[VALIDATE] BLOC MINÉ"); blockMined = true; }
  } else {
    logf("[VALIDATE] vote refusé (%d)", vCode);
    if (vResp.indexOf("Signature") >= 0) { logf("[VALIDATE] resynchronisation de la clé publique (re-register)"); doRegister(); }
  }
  return blockMined;
}

// ─── AUTO-TEST Ed25519 (au boot) : prouve que signature + vérification passent dans 1 Ko de pile + marge du tas ────────────
static void selfTestEd25519() {
  static const char msg[] = "pod-r4-selftest";
  uint8_t sig[64];
  unsigned long t = millis();
  Ed25519::sign(sig, privateKey, publicKey, msg, strlen(msg));
  const unsigned long tSign = millis() - t;
  t = millis();
  const bool ok = Ed25519::verify(sig, publicKey, msg, strlen(msg));
  const unsigned long tVerify = millis() - t;
  logf("[SELFTEST] Ed25519 signature %lu ms, vérification %lu ms -> %s", tSign, tVerify, ok ? "OK" : "ECHEC");
  reportMem("après Ed25519");
}

// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
void setup() {
  paintStack();                                         // avant tout : permet de mesurer la profondeur de pile
  Serial.begin(115200);
  while (!Serial && millis() < 2500) {}
  logf("\n[BOOT] Proof-of-Draw UNO R4 WiFi + TFT 2.8\" tactile — %s", FIRMWARE_VERSION);
  reportMem("boot");

  pinMode(TFT_CS, OUTPUT);   digitalWrite(TFT_CS, HIGH);
  pinMode(STMPE_CS, OUTPUT); digitalWrite(STMPE_CS, HIGH);
  pinMode(SD_CS, OUTPUT);    digitalWrite(SD_CS, HIGH);     // microSD non utilisée : désélectionnée sur le bus partagé

  tft.begin();
  tft.setRotation(0);
#if TOUCH_ENABLED
  touchOk = ts.begin();
  logf("[TOUCH] STMPE610 %s", touchOk ? "détecté" : "NON détecté (toucher désactivé)");
#else
  logf("[TOUCH] désactivé (TOUCH_ENABLED 0)");
#endif
  tftStatus("Proof-of-Draw", "Connexion WiFi...");

  if (WiFi.status() == WL_NO_MODULE) { tftStatus("Module WiFi absent", "", C_RED); while (true) delay(1000); }
  logf("[WIFI] firmware du module: %s", WiFi.firmwareVersion());
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries++ < 4) {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  }
  if (WiFi.status() != WL_CONNECTED) { logf("[WIFI] échec"); tftStatus("WiFi FAIL", "Redemarrage...", C_RED); delay(3000); NVIC_SystemReset(); }
  logf("[WIFI] IP: %s", WiFi.localIP().toString().c_str());
  tftStatus("WiFi OK", WiFi.localIP().toString());

  if (!keysAlreadyGenerated()) generateKeys();
  else { loadKeysFromEEPROM(); logf("[KEYS] clés chargées: %s", bytesToHex(publicKey, 32).c_str()); }

  selfTestEd25519();

  currentBlockHash = loadBlockHashFromEEPROM();
  {
    bool ok = currentBlockHash.length() >= 8;
    for (unsigned i = 0; i < currentBlockHash.length() && ok; i++) { const char c = currentBlockHash[i]; ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
    if (!ok) currentBlockHash = "";
  }

  while (!registered) { if (doRegister()) break; delay(5000); }
  if (paired) { logf("[BOOT] premier pull immédiat"); doPull(); }
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

  serviceTouch();

  if (pullNow || now - lastPullMs >= nextPullIntervalMs) {
    pullNow = false;
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
  delay(40);
}
