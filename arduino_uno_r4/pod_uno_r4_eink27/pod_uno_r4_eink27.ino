// pod_uno_r4_eink27.ino
// Proof-of-Draw — Firmware UNO R4 WiFi + écran e-ink Waveshare 2.7" V2 (noir / blanc, 264×176)
//
// ⚠ NON TESTÉ SUR LE MATÉRIEL (06/10/2026).
// Le protocole réseau dérive du port R4 e-ink 2.9" et le pilote du firmware ESP8266 e-ink 2.7".
// Le sketch doit être compilé et mesuré sur une vraie UNO R4 WiFi + Waveshare 2.7" avant de retirer cet avertissement.
//
// Même protocole et même type d'écran serveur (« eink27bw ») que esp8266/esp_eink_2.7BW :
//   register → pull (métadonnées légères) → pull-frame?fmt=bin (5808 o) → affichage → ACK,
//   validation distribuée (validate-candidate → vote signé Ed25519 → validation-result), ré-validation (obs-confirm), blocs possédés.
// Le serveur ne change pas : cet appareil est un écran eink27bw comme les autres.
//
// Différences avec l'ESP8266 (toutes voulues) :
//   • Wi-Fi/TLS sur le coprocesseur ESP32-S3 (WiFiSSLClient) : plus de BearSSL dans la RAM → pas de free()/malloc() des buffers autour
//     des connexions ; le plan pixel (5808 o) est un tampon STATIQUE ;
//   • lecture du flux par pod_http.h (lecture « readFull » sur réponse fragmentée, chunked accepté), identique au firmware TFT ;
//   • pile principale de 1 Ko seulement sur la R4 (cœur Arduino) : aucun gros tableau local, tout est statique ;
//   • la dernière image reste affichée (e-ink) ET son frameId est mémorisé en EEPROM : un redémarrage ne ré-affiche pas (et ne re-ACK pas)
//     une œuvre déjà à l'écran. Le frameId est effacé dès qu'un écran d'appairage remplace l'œuvre ;
//   • le cartel est dessiné dans le repère paysage de l'IMAGE du serveur (haut = haut), voir setPix() ;
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
#include "podEdStack.h"   // POD_ED_STACK : Ed25519 sur PILE DÉDIÉE (la pile principale de la R4 n'a que 1 024 o) — docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md
#include "podNetStack.h"   // POD_NET_STACK : transactions réseau/TLS ET journal sur PILE DÉDIÉE (connect() déborde de 456 o sous __StackLimit) — docs/LOT_8B2B2_NETSTACK_FIX1_2026_10_09.md, docs/LOT_8B2B2_NETSTACK_FIX2_2026_10_09.md
#include <SHA256.h>
#include "pod_http.h"
#include "epd2in7_V2.h"
#include "pod_vote_r4.h"

// POD_RENDER_V1_BEGIN
// ─── Rendu v1 EN FLUX (lot 8B-2A / 8B-2B-1) — INACTIF PAR DÉFAUT ──────────────────────────────────────────────────────────────────────────────────────────
// 0 (défaut) : comportement d'avant, octet pour octet (cartel gravé en place dans le tampon, affichage du tampon complet).
// 1 : l'image reçue (plan unique, JAMAIS modifié) est rendue par le noyau gelé consensus-pod/src/podRenderStream.h (layoutVersion 1 : cartel, fit) et remise au pilote PAR MORCEAUX de 32 octets (DisplayStream) ;
//     frameHash (octets reçus) et renderHash (octets remis) sont CALCULÉS et seulement journalisés — l'ACK, les routes et le rapport de rendu ne sont PAS modifiés.
// ⚠ NON ESSAYÉ SUR LA CARTE. Ne pas activer sans canari matériel : docs/LOT_8B2B1_PROPAGATION_2026_10_08.md.
#ifndef POD_RENDER_V1
#define POD_RENDER_V1 0
#endif
#ifndef POD_RENDER_MODE_DEFAULT
#define POD_RENDER_MODE_DEFAULT POD_R_FIT   // constante de compilation : le réglage cartelMode n'est PAS exposé (pas d'interface, pas de réglage serveur)
#endif
#if POD_RENDER_V1
#include "podRenderStream.h"
#include "crypto_uno_r4.h"
#include <new>
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
#define SCREEN_TYPE         "eink27bw"             // profil serveur 264×176 noir/blanc (lib/screenProfiles.ts)
#define FIRMWARE_VERSION    "r4eink27-1.1"
#define PULL_INTERVAL       60000UL                // 1 min
#define VALIDATE_INTERVAL   30000UL                // 30 s : candidat en attente
#define HTTP_TIMEOUT_MS     20000UL
#define EINK_MIN_REFRESH_MS 180000UL               // 3 min minimum — recommandation du panneau Waveshare 2.7" V2
#define CLEAR_BEFORE_IMAGE  0                      // un seul rafraîchissement complet par œuvre pour préserver le panneau

// ─── GÉOMÉTRIE ─────────────────────────────────────────────────────────────
#define IMG_W    264                               // image du serveur (paysage)
#define IMG_H    176
#define EPD_BYTES_PER_ROW 22                       // 176 / 8
#define BUF_SIZE ((EPD_WIDTH * EPD_HEIGHT) / 8)   // 5808
#define FRAME_BYTES BUF_SIZE

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
Epd epd;
static uint8_t blackBuf[BUF_SIZE];                 // 0 = noir
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
// POD_LOG_STACK (NETSTACK-FIX2) : le formatage (vsnprintf) et l'écriture USB (Serial) descendent d'environ 450 o sous leur appelant ; appelés depuis setup → doRegister → httpCall (608 o de cadres) ils dépassent
// les 1 024 o de la pile principale (canari du 09/10/2026 : 24 o sous __StackLimit). Sur la pile PRINCIPALE, logf s'exécute donc sur une petite pile dédiée (POD_LOG_STACK_TOTAL) ; sur une pile dédiée (dans une
// transaction réseau), directement. Échec (malloc, garde, marge) : la ligne est ABANDONNÉE — un journal ne doit jamais arrêter le firmware.
struct LogJob { const char* fmt; va_list* ap; };
static void logfEmit(void* p) {
  static char b[256];                              // statique : la pile du cœur R4 ne fait que 1 Ko
  LogJob* j = static_cast<LogJob*>(p);
  vsnprintf(b, sizeof(b), j->fmt, *j->ap);
  Serial.println(b);
}
static void logf(const char* fmt, ...) {
  va_list ap; va_start(ap, fmt);
  LogJob j = { fmt, &ap };
  if (podNetOnMainStack()) PodNet::runSized(logfEmit, &j, POD_LOG_STACK_TOTAL);
  else logfEmit(&j);
  va_end(ap);
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
  if (!PodEd::derivePublicKey(derived, privateKey)) logf("[KEYS] cohérence NON vérifiée : calcul Ed25519 impossible (pile dédiée) — clé publique de l'EEPROM conservée");   // POD_ED_STACK
  else if (memcmp(derived, publicKey, 32) != 0) {       // écriture interrompue entre clé privée et publique
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
  if (!PodEd::derivePublicKey(publicKey, privateKey)) { logf("[KEYS] génération ANNULÉE : calcul Ed25519 impossible (pile dédiée) — aucune clé enregistrée"); memset(privateKey, 0, 32); return; }   // POD_ED_STACK
  keysLoaded = true;
  saveKeysToEEPROM();
  logf("[KEYS] PubKey: %s", bytesToHex(publicKey, 32).c_str());
}
static String signED25519(const String& candidateId, float score) {
  const int m = (int)(score * 1000.0f + 0.5f);     // « 0.543 » : 3 décimales, comme toFixed(3) côté serveur
  char scoreStr[12]; snprintf(scoreStr, sizeof(scoreStr), "%d.%03d", m / 1000, m % 1000);
  const String message = deviceId + ":" + candidateId + ":" + scoreStr;
  uint8_t sig[64];
  if (!PodEd::sign(sig, privateKey, publicKey, (const uint8_t*)message.c_str(), message.length())) { logf("[VOTE] signature impossible (pile Ed25519 dédiée) — vote NON envoyé"); return String(); }   // POD_ED_STACK
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

/** POD_NET_STACK : la transaction TLS COMPLÈTE (connect, requête, en-têtes, corps, stop) dans une fonction à part (noinline) : sa fermeture, son PodNetInfo et son cadre ont DISPARU avant le journal et le traitement
 *  de la réponse. Résultats dans les variables de l'APPELANT ; client.stop() est TOUJOURS appelé, même si request() échoue après l'ouverture du client. */
static bool __attribute__((noinline)) netHttpRaw(const char* method, const String& path, const String* body, int& code, bool& complete, PodNetInfo& ni) {
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    code = c.request(method, path, body);
    if (code >= 0) { size_t len = 0; complete = c.rd.readBodyString(g_body, sizeof(g_body), &len); }
    c.client.stop();
  };
  return podNetRun(tx, &ni);
}

/** Appel JSON : retourne le code HTTP (>0) et le corps dans resp ; <0 = échec réseau/lecture/corps incomplet ; -4 = pile dédiée indisponible, transaction NON exécutée ; -5 = transaction EXÉCUTÉE mais résultat local REJETÉ (garde/marge). */
static int httpCall(const char* method, const String& path, const String* body, String& resp) {
  resp = "";
  int code = -4; bool complete = false; PodNetInfo ni;
  const bool ran = netHttpRaw(method, path, body, code, complete, ni);
  if (!ran) { logf("[HTTP %s] pile réseau dédiée : %s (erreur %u, marge %u o)%s", method, podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin, podNetExecuted(ni) ? " — la requête a PU atteindre le serveur (POST, vote ou ACK possibles)" : ""); return podNetExecuted(ni) ? -5 : -4; }
  logf("[HTTP %s] %s -> %d", method, path.length() > 60 ? (path.substring(0, 60) + "...").c_str() : path.c_str(), code);
  if (code < 0) { if (code == -2) logf("[HTTP] connexion TLS impossible (voir l'en-tête du sketch)"); return code; }
  if (!complete) { logf("[HTTP] corps incomplet ou > %u octets", (unsigned)sizeof(g_body) - 1); return -3; }
  resp = String(g_body);
  return code;
}

// ─── DESSIN dans les plans e-ink ───────────────────────────────────────────
// Repère = celui de l'IMAGE du serveur (lib/canvasToScreen.ts, eink27bw) : x 0..263 vers la droite, y 0..175 vers le bas.
//   bufRow = x          bufCol = 175 - y          octet = bufRow*22 + bufCol/8          bit = 7 - bufCol%8
// Un bit à 0 = pixel noir.
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
static void clearBothPlanes() { memset(blackBuf, 0xFF, BUF_SIZE); }
/** Lignes y0..y1 de l'image remises à blanc. */
#if !POD_RENDER_V1   // utilisé seulement par burnCartel
static void whiteRows(int y0, int y1) {
  for (int x = 0; x < IMG_W; x++) for (int y = y0; y <= y1; y++) clearPix(blackBuf, x, y);
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
/** Réveille, envoie blackBuf (ou une page blanche), puis met le panneau en veille. */
static bool refreshPanel(bool white) {
  waitMinRefreshGap();
  const unsigned long t0 = millis();
  SPI.begin();
  SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
  const bool ok = epd.Init() == 0;
  if (ok) { if (white) epd.Clear(); else epd.Display(blackBuf); epd.Sleep(); }
  SPI.endTransaction();
  lastRefreshMs = millis(); hasRefreshed = true;
  logf("[EINK] %s %s en %lu ms", white ? "page blanche" : "image", ok ? "affichée" : "ECHEC", millis() - t0);
  return ok;
}

#if POD_RENDER_V1
// ─── Rendu v1 en flux : calcul ET remise au pilote ───────────────────────────────────────────────────────────────────────────────────────────────
// Mémoire (UNO R4, pile principale ≈ 1 Ko : AUCUN objet sur la pile, et AUCUNE nouvelle variable globale) : le renderer (PodEinkRenderer) et son hash (65 o) vivent dans g_podScratch[600], qui REMPLACE le tableau
// `static uint8_t qrData[600]` de displayOnboardingQR (désormais une référence sur la MÊME zone) : le QR d'appairage et le rendu d'une image ne sont jamais vivants en même temps (appairage avant le premier pull de
// frame ; chaque rendu reconstruit son objet par new placé — la zone contient peut-être un QR périmé). Bilan statique : 0 o de plus qu'avant (le chemin v1 ne consomme que ce que qrData consommait déjà).
// Retour : 0 = échec AVANT la fin de la remise · 1 = TOUTES les données ET la commande de rafraîchissement ont été envoyées, mais la FIN PHYSIQUE du rafraîchissement n'est pas confirmée (BUSY expiré : l'image peut être affichée
// ou en cours d'affichage) · 2 = remis et rafraîchissement terminé (ReadBusy() bloque sans délai). Seul 2 est un succès (sinon AUCUN ACK, le serveur réessaiera). ⚠ État de l'écran après un échec : NON garanti inchangé
// — la page blanche CLEAR_BEFORE_IMAGE peut venir d'être affichée ; une production interrompue laisse la RAM du panneau partiellement écrite sans lancer le rafraîchissement.
struct PodScratch { PodEinkRenderer<PodSha256Rw> r; char hex[65]; };
static_assert(sizeof(PodScratch) <= 600, "PodScratch doit tenir dans g_podScratch (la zone de qrData)");
alignas(PodScratch) static uint8_t g_podScratch[600];   // alignement GARANTI par le type (SHA256 de la bibliothèque Crypto : destructeur non trivial, alignement possible de 8 o)
static unsigned int podRenderProduce(void* ctx, unsigned char* out, unsigned int cap) { return static_cast<PodEinkRenderer<PodSha256Rw>*>(ctx)->read(out, cap); }

// ⚠ Paramètre `void*` et non `PodScratch*` : le préprocesseur Arduino génère les prototypes EN TÊTE de fichier, avant la déclaration de PodScratch.
static uint8_t podRenderRun(void* scratch) {   // plusieurs sorties : l'objet est construit et DÉTRUIT par podRenderAndShow() (sortie unique)
  PodScratch* S = static_cast<PodScratch*>(scratch);
  const PodRenderSpec spec = pod_render_spec(POD_R_EINK27);
  const PodRenderMeta meta = { (const uint8_t*)pendingDisplayTs.c_str(), (size_t)pendingDisplayTs.length(), (int32_t)currentBlockIndex,
                               (const uint8_t*)pendingArtistName.c_str(), (size_t)pendingArtistName.length(), (const uint8_t*)pendingWorkTitle.c_str(), (size_t)pendingWorkTitle.length() };
  if (!S->r.frameHash(spec, blackBuf, nullptr, BUF_SIZE, S->hex)) { logf("[RENDER] frameHash impossible — abandon"); return 0; }
  logf("[RENDER] frameHash=%s", S->hex);
  if (!S->r.begin(spec, POD_RENDER_MODE_DEFAULT, meta, blackBuf, nullptr, BUF_SIZE)) { logf("[RENDER] paramètres refusés — abandon"); return 0; }
  waitMinRefreshGap();
  const unsigned long t0 = millis();
  SPI.begin();
  SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
  const bool initOk = epd.Init() == 0;
  bool delivered = false;
  if (initOk) { delivered = epd.DisplayStream(podRenderProduce, &S->r); epd.Sleep(); }
  SPI.endTransaction();
  lastRefreshMs = millis(); hasRefreshed = true;
  if (!initOk) { logf("[RENDER] panneau non initialisé — abandon, aucune donnée envoyée (l'écran peut être resté blanc)"); return 0; }
  if (!delivered) { logf("[RENDER] production interrompue — rafraîchissement NON lancé (RAM du panneau partiellement écrite ; l'écran garde son état physique, éventuellement blanc)"); return 0; }
  if (!S->r.finish(S->hex)) { logf("[RENDER] renderHash incomplet — abandon"); return 0; }
  logf("[RENDER] calculé ET remis au pilote en %lu ms — mode=%u renderHash=%s", millis() - t0, (unsigned)POD_RENDER_MODE_DEFAULT, S->hex);
  return 2;
}

// Point d'entrée UNIQUE du rendu v1 : construit l'objet par new PLACÉ dans g_podScratch (aucune allocation dynamique), exécute, puis le DÉTRUIT explicitement — sur tous les chemins, car podRenderRun() est
// la seule fonction qui a plusieurs sorties et ce wrapper n'en a qu'une. La zone est donc réellement libre (durée de vie terminée, SHA256::~SHA256() a effacé son état) avant toute réutilisation par le QR d'appairage.
static uint8_t podRenderAndShow() {
  PodScratch* S = new (g_podScratch) PodScratch();
  const uint8_t code = podRenderRun(S);
  S->~PodScratch();
  return code;
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
  drawText(blackBuf, 4, 66, "PRIV:");
  for (int l = 0; l < 4; l++) {
    drawText(blackBuf, 34, 20 + l * 10, pubHex.substring(l * 16, l * 16 + 16));
    drawText(blackBuf, 34, 66 + l * 10, privHex.substring(l * 16, l * 16 + 16));
  }
  hLine(blackBuf, 109, 10, IMG_W - 11);
  const String w1 = "SAVE THESE KEYS NOW", w2 = "PRIVATE KEY SHOWN ONCE";
  drawText(blackBuf, centerX(w1), 112, w1);
  drawText(blackBuf, centerX(w2), 120, w2);
  persistFrameId("");                                // l'œuvre précédente n'est plus à l'écran
  lastFrameId = "";
  refreshPanel(false);
  logf("[KEYS] Clés affichées — 60 s pour les noter");
  delay(60000UL);
}

static void displayOnboardingQR(const String& onboardUrl, const String& code, const String& mac) {
  static QRCode qr;
#if POD_RENDER_V1
  uint8_t (&qrData)[600] = g_podScratch;             // zone PARTAGÉE avec le renderer (jamais vivants en même temps) : net 0 o de RAM statique — voir g_podScratch
#else
  static uint8_t qrData[600];                        // qrcode_getBufferSize(5) tient largement dedans (vérifié ci-dessous)
#endif
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
  drawText(blackBuf, centerX(codeLine), textY1 + 10, codeLine);
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
  PodNetInfo ni;                                     // POD_NET_STACK : la transaction tourne sur la pile réseau dédiée
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", "/api/pull-frame?deviceId=" + deviceId + "&screen=" SCREEN_TYPE "&fmt=bin", nullptr);
    logf("[HTTP GET] /api/pull-frame -> %d (contenu %ld)", code, c.rd.contentLength());
    if (code == 404) noFrame = true;
    else if (code == 200 && (c.rd.contentLength() < 0 || c.rd.contentLength() == FRAME_BYTES)) {
      // Lecture complète garantie par pod_http.h (boucle jusqu'au compte exact ou au timeout) : jamais d'image hachée
      const size_t b = c.rd.readBody(blackBuf, BUF_SIZE);
      logf("[FRAME] lu=%u attendu=%u", (unsigned)b, (unsigned)BUF_SIZE);
      got = (b == BUF_SIZE && c.rd.complete());
    } else if (code == 200) {
      logf("[FRAME] taille annoncée %ld != %d (le serveur sert-il bien eink27bw ?)", c.rd.contentLength(), FRAME_BYTES);
    }
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  if (!ran) { got = false; noFrame = false; logf("[FRAME] pile réseau dédiée : %s (erreur %u, marge %u o) — image NON présentée, pas d'ACK", podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin); }
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

// ─── VALIDATION RÉELLE (vote v2) — ⚠ NON TESTÉE SUR LA CARTE ─────────────
static uint8_t g_voteChunk[256];

// POD_NET_STACK : lecture du candidat sur la pile réseau dédiée. Fonction à part (noinline) : ses variables ne vivent que pendant la transaction, FERMÉE avant la signature (jamais imbriquée dans PodEd),
// et ne gonflent pas le cadre de doValidate, qui porte ensuite l'appel de signature. Échec de la pile dédiée : chk remis à zéro (chk.ok = false) → « calcul impossible », pas de vote.
static void __attribute__((noinline)) netReadCandidate(const String& candidateId, PodScreenKind kind, size_t bytes, PodCheck& chk) {
  PodNetInfo ni;
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", String("/api/candidate-frame?candidateId=") + candidateId, nullptr);
    chk.http = code;
    if (code == 200) podCheckStream(c.rd, kind, bytes, blackBuf, BUF_SIZE, g_voteChunk, sizeof(g_voteChunk), &chk);
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  if (!ran) { memset(&chk, 0, sizeof(chk)); logf("[VALIDATE2] pile réseau dédiée : %s (erreur %u, marge %u o) — pas de vote", podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin); }
}

static bool doValidateV2(const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash) {
  PodScreenKind kind;
  // Un appareil relit un candidat de N'IMPORTE QUEL écran (le serveur ne l'oblige pas à voter pour son type) : blackBuf (≥ 4 736 o) sert de tampon pour l'OLED et l'e-ink 2,9".
  if (!podKindFromName(screenName.c_str(), &kind)) {
    logf("[VALIDATE2] écran inconnu : %s", screenName.c_str());
    return false;
  }
  PodCheck chk; memset(&chk, 0, sizeof(chk));
  netReadCandidate(candidateId, kind, bytes, chk);
  if (!chk.ok) { logf("[VALIDATE2] calcul impossible (%u/%u octets)", (unsigned)chk.bytes, (unsigned)bytes); return false; }
  bool accept = false; const char* reason = podVerdict(chk, announcedHash, &accept);
  const String msg = podVoteMessage(deviceId, candidateId, chk.hash, chk.m, accept);
  uint8_t sig[64]; if (!PodEd::sign(sig, privateKey, publicKey, (const uint8_t*)msg.c_str(), msg.length())) { logf("[VALIDATE2] signature impossible (pile Ed25519 dédiée) — vote NON envoyé"); return false; }   // POD_ED_STACK
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
  if (signature.length() == 0) { pendingCandidateId = ""; return false; }   // POD_ED_STACK : signature impossible → pas de vote
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
  PodEdInfo infoS, infoV; memset(&infoV, 0, sizeof(infoV));   // POD_ED_STACK
  const bool signedOk = PodEd::sign(sig, privateKey, publicKey, msg, strlen(msg), &infoS);
  const unsigned long tSign = millis() - t;
  t = millis();
  const bool ok = signedOk && PodEd::verify(sig, publicKey, msg, strlen(msg), &infoV);   // POD_ED_STACK
  logf("[SELFTEST] Ed25519 signature %lu ms, vérification %lu ms -> %s", tSign, millis() - t, ok ? "OK" : "ECHEC");
  reportMem("après Ed25519");
  logf("[ED25519] pile dédiée (utilisé/marge, o) : sign %u/%u, verify %u/%u ; erreurs sign=%u verify=%u (0 = aucune) ; alloué %u o (garde %u o, marge minimale exigée %u o)", (unsigned)infoS.used, (unsigned)infoS.margin, (unsigned)infoV.used, (unsigned)infoV.margin, (unsigned)infoS.err, (unsigned)infoV.err, (unsigned)POD_ED_STACK_TOTAL, (unsigned)POD_ED_GUARD_BYTES, (unsigned)POD_ED_MARGIN_MIN);   // POD_ED_STACK
}

// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
void setup() {
  paintStack();
  Serial.begin(115200);
  while (!Serial && millis() < 2500) {}
  logf("\n[BOOT] Proof-of-Draw UNO R4 WiFi + e-ink 2.7\" BW — %s", FIRMWARE_VERSION);
  logf("[WARNING] PORT NON TESTE SUR LE MATERIEL — 06/10/2026");
  reportMem("boot");

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
