// pod_uno_r4.ino
// Proof-of-Draw — Firmware UNO R4 WiFi + shield « 2.8" TFT Touch » (ILI9341 240×320 + STMPE610 + microSD)
//
// Même protocole que les firmwares ESP8266 (register → pull → image → ACK, validation Ed25519, observation, blocs possédés),
// porté sur l'UNO R4 WiFi :
//   • le Wi-Fi/TLS passe par le coprocesseur ESP32-S3 (WiFiSSLClient) : plus de BearSSL dans la RAM du microcontrôleur ;
//   • l'appareil se déclare « tft28 » (240×320 RGB565, 153 600 o) : l'œuvre occupe TOUT l'écran. Pas de scene-v1 sur cet écran :
//     une œuvre ANA arrive comme image fixe (son aperçu), comme sur les écrans e-ink ;
//   • tactile (STMPE610) : un toucher AFFICHE ou CACHE le cartel — bande haute « RESCOE · #bloc », bande basse « titre · artiste » —
//     par-dessus l'œuvre en plein écran ;
//   • microSD : la dernière image y est gardée (/pod/frame.bin). Elle sert à cacher le cartel (on redessine les deux bandes depuis la
//     carte, sans re-télécharger) et à réafficher l'œuvre au redémarrage. Sans carte : l'œuvre reste en plein écran, sans cartel.
//
// Câblage : le shield s'enfiche tel quel sur l'UNO R4 WiFi (TFT CS 10 / DC 9, tactile CS 8, microSD CS 4).
// Bibliothèques : Adafruit ILI9341, Adafruit GFX, Adafruit BusIO, Adafruit STMPE610, ArduinoJson (≥ 6, testé 7.4), QRCode, Crypto, SD.
// Carte : « Arduino UNO R4 WiFi ». Moniteur série : 115200.
//
// ⚠ Débit : la liaison RA4M1 ↔ ESP32-S3 est à 115200 bauds → une image complète (153 600 o) met une vingtaine de secondes à arriver
//   (elle se dessine de haut en bas pendant ce temps). Les temps réels sont affichés au Serial ([FRAME]).
// ⚠ TLS : le coprocesseur vérifie le certificat avec son lot de certificats racine. Si « connexion TLS impossible » s'affiche,
//   mettre à jour le firmware du module Wi-Fi (IDE → Outils → Updater le firmware) et/ou ajouter le certificat racine du serveur.

#include <Arduino.h>
#include <malloc.h>
#include <stdarg.h>
#include <WiFiS3.h>
#include <SPI.h>
#include <SD.h>
#include <EEPROM.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Adafruit_STMPE610.h>
#include <qrcode.h>
#include <Ed25519.h>
#include "podEdStack.h"   // POD_ED_STACK : Ed25519 sur PILE DÉDIÉE (la pile principale de la R4 n'a que 1 024 o) — docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md
#include "podNetStack.h"   // POD_NET_STACK : transactions réseau/TLS ET journal sur PILE DÉDIÉE (connect() déborde de 456 o sous __StackLimit) — docs/LOT_8B2B2_NETSTACK_FIX1_2026_10_09.md, docs/LOT_8B2B2_NETSTACK_FIX2_2026_10_09.md
#include <SHA256.h>
#include "pod_http.h"
#include "pod_bench.h"
#include "pod_vote_r4.h"       // validation réelle (vote v2) : SHA-256 + métriques entières en flux — ⚠ NON TESTÉ sur la carte

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Wi-Fi : copier secrets.h.example en secrets.h (ignoré par git) puis renseigner SSID / mot de passe (2,4 GHz).
#if __has_include("secrets.h")
  #include "secrets.h"
  const char* WIFI_SSID     = SECRET_WIFI_SSID;
  const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;
#else
  const char* WIFI_SSID     = "";            // ← créer secrets.h (voir secrets.h.example)
  const char* WIFI_PASSWORD = "";
#endif

#define SERVER_HOST       "proof-of-draw.vercel.app"
#define SCREEN_TYPE       "tft28"            // profil serveur 240×320 RGB565 (lib/screenProfiles.ts)
#define FIRMWARE_VERSION  "r4tft28-2.5"
#define TOUCH_ENABLED     1                  // toucher = afficher / cacher le cartel
#define PULL_INTERVAL     60000UL
#define VALIDATE_INTERVAL 30000UL
#define HTTP_TIMEOUT_MS   20000UL

// Banc d'essai d'animation (voir docs/BENCH_ANIMATION.md) : le propriétaire l'active depuis l'app ; l'appareil le découvre dans /api/pull
// ("benchMode") puis interroge /api/bench/poll toutes les 3 s pendant au plus 31 min.
#define BENCH_POLL_MS      3000UL
#define BENCH_MODE_MAX_MS  (31UL * 60UL * 1000UL)
#define BENCH_MAX_CLIP     9216        // octets : le clip + la copie 1 Ko de l'image courante vivent dans le tas pendant la lecture
#define BENCH_FRAME        1024        // = podbench::FRAME_BYTES (les macros FRAME_BYTES / ROW_BYTES de ce sketch masquent les constantes de pod_bench.h)
#define BENCH_HDR          20          // = podbench::HEADER_BYTES
static_assert(podbench::W * podbench::H / 8 == BENCH_FRAME && podbench::HEADER_BYTES == BENCH_HDR, "pod_bench.h : constantes désynchronisées");

// ─── PINS (shield Adafruit 2.8" TFT Touch) ─────────────────────────────────
#define TFT_CS    10
#define TFT_DC    9
#define STMPE_CS  8
#define SD_CS     4

// ─── GÉOMÉTRIE : écran 240×320 portrait, l'œuvre en occupe la totalité ─────
#define SCR_W         240
#define SCR_H         320
#define ROW_BYTES     (SCR_W * 2)                 // 480
#define FRAME_BYTES   (SCR_W * SCR_H * 2)         // 153 600
#define BAND_TOP_H    40                          // cartel haut : y 0..39
#define BAND_BOT_Y    272                         // cartel bas : y 272..319 (48 px)
#define BAND_BOT_H    (SCR_H - BAND_BOT_Y)

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

// ─── microSD : dernière image + son cartel ─────────────────────────────────
#define SD_DIR    "/pod"
#define SD_FRAME  "/pod/frame.bin"                // 153 600 o RGB565 little-endian, tel que reçu du serveur
#define SD_META   "/pod/meta.txt"                 // 4 lignes : frameId, n° de bloc, titre, artiste (écrit APRÈS l'image complète)
#define SD_ANIM   "/pod/anim.bin"                 // clip PBC1 de l'animation affichée (≤ 9 216 o), joué en boucle sans rien demander au serveur
#define SD_ANIM_META "/pod/anim.txt"              // 2 lignes : hash du bloc, frameId de l'affiche (écrit APRÈS le clip complet)

#if ARDUINOJSON_VERSION_MAJOR >= 7
  #define JSON_DOC(name, cap) JsonDocument name
#else
  #define JSON_DOC(name, cap) DynamicJsonDocument name(cap)
#endif

// ─── OBJETS ────────────────────────────────────────────────────────────────
Adafruit_ILI9341  tft(TFT_CS, TFT_DC);
Adafruit_STMPE610 ts(STMPE_CS);
bool touchOk = false;
bool sdOk = false;                                // carte lisible
bool sdFrameValid = false;                        // /pod/frame.bin complet = l'image affichée → cartel masquable
bool cartelVisible = false;                       // les bandes sont dessinées par-dessus l'œuvre
const char* sdWhy = "SD absente";                 // raison affichée dans le cartel quand il ne peut pas être masqué ("" = tout va bien)

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

String pendingWorkTitle = "", pendingArtistName = "";
String pendingObsHashes = "", pendingObsTarget = "";

bool benchMode = false;                           // mode banc d'essai actif (annoncé par /api/pull)
unsigned long benchModeSince = 0, lastBenchPollMs = 0;
String lastBenchClipId = "";
static bool g_quietHttp = false;                  // pas de ligne [HTTP] pour chaque poll réussi (toutes les 3 s)

// Animation RÉSIDENTE (r4tft28-2.4) : /api/pull annonce un pointeur `anim` (hash du bloc) ; le clip est téléchargé UNE fois (/api/block-clip, mis en
// cache par le CDN), rangé sur la carte microSD, puis joué EN BOUCLE sans AUCUNE requête (coût Redis nul entre deux pulls). L'affiche (image fixe) reste
// la repli : toucher = pause + cartel, re-toucher (ou 60 s) = reprise. Redémarrage : l'animation reprend depuis la carte.
enum AnimEnd : uint8_t { AE_TIME = 0, AE_TOUCH, AE_ERROR };   // déclaré ici : les prototypes que l'IDE génère passent AVANT le reste du code
bool   animOn = false;                            // un clip est sur la carte et correspond à l'œuvre affichée
bool   animPaused = false;                        // en pause (toucher) : l'affiche et le cartel sont à l'écran
unsigned long animPausedSince = 0;
String animHash = "";                             // bloc dont le clip est sur la carte
String pendingAnimHash = "";                      // pointeur reçu par le dernier pull
size_t pendingAnimBytes = 0;

static char     g_body[3072];                   // corps JSON des réponses
static uint16_t g_row[SCR_W];                   // une ligne d'image (octets little-endian reçus, puis big-endian pour le bus)
static void fastPixels(const uint16_t* colors, uint32_t len);   // envoi d'un bloc de pixels par le cœur SPI (défini avec le banc d'essai)

// ─── LOG ───────────────────────────────────────────────────────────────────
// POD_LOG_STACK (NETSTACK-FIX2) : le formatage (vsnprintf) et l'écriture USB (Serial) descendent d'environ 450 o sous leur appelant ; appelés depuis setup → doRegister → httpCall (608 o de cadres) ils dépassent
// les 1 024 o de la pile principale (canari du 09/10/2026 : 24 o sous __StackLimit). Sur la pile PRINCIPALE, logf s'exécute donc sur une petite pile dédiée (POD_LOG_STACK_TOTAL) ; sur une pile dédiée (dans une
// transaction réseau), directement. Échec (malloc, garde, marge) : la ligne est ABANDONNÉE — un journal ne doit jamais arrêter le firmware.
// NETSTACK-FIX3 : GUARD = la garde de la pile de journal a été écrasée → le voisin au tas est corrompu : faute persistante, ARRÊT SÛR (aucun pull, vote, ACK ni affichage), jamais « une ligne perdue ».
// MARGIN (garde intacte, marge < 128 o) : fatal dans le build de canari seulement ; en production la ligne a été écrite et on continue (NOMEM : ligne abandonnée).
static void __attribute__((noinline, noreturn)) logfSafeStop() {
  Serial.println(F("[LOG] faute memoire persistante de la pile de journal (garde ecrasee) : ARRET SUR - aucun pull, vote, ACK ni affichage. Debrancher la carte, reflasher le firmware stable."));
  for (;;) { __asm volatile("nop"); }
}
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
  if (podNetOnMainStack()) {
    PodNetInfo li;
    PodNet::runSized(logfEmit, &j, POD_LOG_STACK_TOTAL, &li);
    if (li.err == POD_NET_GUARD) logfSafeStop();
  } else logfEmit(&j);
  va_end(ap);
}

// ─── MÉMOIRE : 32 Ko de RAM, PILE PRINCIPALE DE 1 Ko SEULEMENT (cœur Arduino R4, BSP_CFG_STACK_MAIN_BYTES = 0x400) ─────────
// Le cœur désactive la protection de pile (MSPLIM = 0) : une pile qui dépasse 1 Ko descend dans le HAUT du tas (zone libre tant que
// le tas est peu rempli). Ed25519 a besoin d'environ 1,4 Ko : il s'exécute désormais sur une PILE DÉDIÉE (podEdStack.h), plus dans le haut du tas (POD_ED_STACK).
// Règle de ce firmware : aucun gros bloc ni gros tableau local (tampons statiques). Les diagnostics [MEM] affichent le tas libre et
// la profondeur de pile atteinte : à relever au premier essai.
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
  if (!PodEd::derivePublicKey(derived, privateKey)) logf("[KEYS] cohérence NON vérifiée : calcul Ed25519 impossible (pile dédiée) — clé publique de l'EEPROM conservée");   // POD_ED_STACK
  else if (memcmp(derived, publicKey, 32) != 0) {   // écriture interrompue entre clé privée et publique
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
  if (!PodEd::derivePublicKey(publicKey, privateKey)) { logf("[KEYS] génération ANNULÉE : calcul Ed25519 impossible (pile dédiée) — aucune clé enregistrée"); memset(privateKey, 0, 32); return; }   // POD_ED_STACK
  keysLoaded = true;
  saveKeysToEEPROM();
  logf("[KEYS] PubKey: %s", bytesToHex(publicKey, 32).c_str());
}
static String signED25519(const String& candidateId, float score) {
  const int m = (int)(score * 1000.0f + 0.5f);               // « 0.543 » : 3 décimales, comme toFixed(3) côté serveur
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
  if (!(g_quietHttp && code == 200)) logf("[HTTP %s] %s -> %d", method, path.length() > 60 ? (path.substring(0, 60) + "...").c_str() : path.c_str(), code);
  if (code < 0) { if (code == -2) logf("[HTTP] connexion TLS impossible (voir l'en-tête du sketch)"); return code; }
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

/** Pousse g_row (déjà en octets BIG-endian) sur la ligne y : fenêtre d'une ligne, puis 240 pixels. */
static void pushRow(int y) {
  tft.startWrite();
  tft.setAddrWindow(0, y, SCR_W, 1);
  fastPixels(g_row, SCR_W);                  // envoi par bloc (voir « BANC D'ESSAI » plus bas) au lieu de deux appels SPI par pixel
  tft.endWrite();
}
static void swapRowBytes() {
  uint8_t* b = (uint8_t*)g_row;
  for (int i = 0; i < ROW_BYTES; i += 2) { const uint8_t t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; }
}

/** Cartel PAR-DESSUS l'œuvre : « RESCOE #bloc » en haut, titre + artiste en bas. Redessiné à chaque toucher « afficher ». */
static void drawCartel() {
  tft.fillRect(0, 0, SCR_W, BAND_TOP_H - 1, C_DARK);
  tft.drawFastHLine(0, BAND_TOP_H - 1, SCR_W, C_GOLD);
  tft.setTextSize(2); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(8, 12); tft.print("RESCOE");
  if (currentBlockIndex >= 0) {
    const String blk = "#" + String(currentBlockIndex);
    tft.setTextColor(C_GREY, C_DARK); tft.setCursor(SCR_W - 8 - (int)blk.length() * 12, 12); tft.print(blk);
  }
  tft.fillRect(0, BAND_BOT_Y + 1, SCR_W, BAND_BOT_H - 1, C_DARK);
  tft.drawFastHLine(0, BAND_BOT_Y, SCR_W, C_GOLD);
  String title = asciiFold(pendingWorkTitle), artist = asciiFold(pendingArtistName);
  if (title.length() == 0) title = "Proof-of-Draw";
  if (title.length() > 19) title = title.substring(0, 19);
  if (artist.length() > 26) artist = artist.substring(0, 26);
  tft.setTextSize(2); tft.setTextColor(C_WHITE, C_DARK); tft.setCursor(8, BAND_BOT_Y + 8); tft.print(title);
  if (artist.length()) { tft.setTextSize(1); tft.setTextColor(C_GREY, C_DARK); tft.setCursor(8, BAND_BOT_Y + 32); tft.print(artist); }
  // Pastille d'état de la carte SD (bas droite) : « SD ok » = le cartel pourra être masqué ; sinon la raison, en rouge
  const String badge = sdFrameValid ? String("SD ok") : String(sdWhy);
  tft.setTextSize(1); tft.setTextColor(sdFrameValid ? C_GREY : C_RED, C_DARK);
  tft.setCursor(SCR_W - 8 - (int)badge.length() * 6, BAND_BOT_Y + 32); tft.print(badge);
}

// ─── microSD ───────────────────────────────────────────────────────────────
static void initSD() {
  digitalWrite(TFT_CS, HIGH); digitalWrite(STMPE_CS, HIGH);
  for (int attempt = 0; attempt < 3 && !sdOk; attempt++) { sdOk = SD.begin(SD_CS); if (!sdOk) delay(250); }   // certaines cartes ne répondent qu'au 2e essai
  if (sdOk && !SD.exists(SD_DIR)) SD.mkdir(SD_DIR);
  sdWhy = sdOk ? "SD sans image" : "SD absente";
  logf("[SD] %s", sdOk ? "carte lisible (cache de l'image + cartel masquable)" : "carte absente, non formatée FAT/FAT32 ou illisible -> œuvre en plein écran SANS cartel masquable");
}

/** Redessine les lignes y0..y0+n-1 depuis /pod/frame.bin (lues séquentiellement, converties LE -> BE). */
static bool restoreRows(int y0, int n) {
  File f = SD.open(SD_FRAME, FILE_READ);
  if (!f) return false;
  if (f.size() != (unsigned long)FRAME_BYTES) { f.close(); return false; }
  bool ok = f.seek((uint32_t)y0 * ROW_BYTES);
  for (int i = 0; ok && i < n; i++) {
    ok = f.read((uint8_t*)g_row, ROW_BYTES) == ROW_BYTES;
    if (!ok) break;
    swapRowBytes();
    pushRow(y0 + i);
  }
  f.close();
  return ok;
}

static void saveMeta(const String& frameId) {
  if (!sdOk) return;
  if (SD.exists(SD_META)) SD.remove(SD_META);
  File f = SD.open(SD_META, FILE_WRITE);
  if (!f) return;
  f.println(frameId);
  f.println(currentBlockIndex);
  f.println(pendingWorkTitle);
  f.println(pendingArtistName);
  f.close();
}

static void animLoadMarker();
/** Au démarrage : réaffiche la dernière œuvre depuis la carte (sans attendre le réseau) et retrouve son cartel. */
static void restoreLastFrame() {
  if (!sdOk || !SD.exists(SD_META) || !SD.exists(SD_FRAME)) return;
  File m = SD.open(SD_META, FILE_READ);
  if (!m) return;
  String id = m.readStringUntil('\n'); id.trim();
  String blk = m.readStringUntil('\n'); blk.trim();
  String title = m.readStringUntil('\n'); title.trim();
  String artist = m.readStringUntil('\n'); artist.trim();
  m.close();
  if (id.length() == 0) return;
  const unsigned long t0 = millis();
  if (!restoreRows(0, SCR_H)) { logf("[SD] image enregistrée illisible"); return; }
  lastFrameId = id; currentBlockIndex = blk.toInt(); pendingWorkTitle = title; pendingArtistName = artist;
  sdFrameValid = true; cartelVisible = false;
  logf("[SD] dernière œuvre réaffichée en %lu ms (frameId=%s)", millis() - t0, id.c_str());
  animLoadMarker();                                          // c'était une animation ? elle reprend depuis la carte
}

// ─── Image : flux 153 600 o RGB565 little-endian, ligne par ligne, plein écran ──
/** Lit 320 lignes, les range sur la carte (si présente) ET les affiche au fur et à mesure. true = image complète. */
static bool streamFrame(podhttp::Reader<WiFiSSLClient>& rd) {
  bool ok = true;
  File f;
  bool saving = false;
  if (sdOk) {
    if (SD.exists(SD_FRAME)) SD.remove(SD_FRAME);
    f = SD.open(SD_FRAME, FILE_WRITE);
    saving = (bool)f;
    if (!saving) { sdWhy = "SD ouverture"; logf("[SD] impossible d'ouvrir %s en écriture", SD_FRAME); }
  } else logf("[SD] pas de carte : l'image ne sera pas conservée");
  uint8_t* raw = (uint8_t*)g_row;
  for (int y = 0; y < SCR_H; y++) {
    if (rd.readBody(raw, ROW_BYTES) != (size_t)ROW_BYTES) { logf("[FRAME] ligne %d incomplète", y); ok = false; break; }
    if (saving && f.write(raw, ROW_BYTES) != (size_t)ROW_BYTES) { saving = false; sdWhy = "SD ecriture"; logf("[SD] écriture interrompue ligne %d (carte pleine / protégée ?)", y); }
    swapRowBytes();                                          // LE serveur -> BE bus SPI
    pushRow(y);
    if ((y % 80) == 79) logf("[FRAME] %d/%d lignes", y + 1, SCR_H);
  }
  if (f) f.close();
  sdFrameValid = ok && saving;                               // copie complète : le cartel pourra être masqué
  if (sdFrameValid) sdWhy = "";
  if (sdOk && !sdFrameValid && SD.exists(SD_FRAME)) SD.remove(SD_FRAME);
  return ok;
}

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
  PodNetInfo ni;                                     // POD_NET_STACK : la transaction tourne sur la pile réseau dédiée
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", "/api/pull-frame?deviceId=" + deviceId + "&screen=" SCREEN_TYPE "&fmt=bin", nullptr);
    logf("[HTTP GET] /api/pull-frame -> %d (contenu %ld)", code, c.rd.contentLength());
    if (code == 404) noFrame = true;
    else if (code == 200 && (c.rd.contentLength() < 0 || c.rd.contentLength() == FRAME_BYTES)) {
      cartelVisible = false;                                 // une nouvelle image remplace tout, cartel compris
      shown = streamFrame(c.rd) && c.rd.complete();
    } else if (code == 200) {
      logf("[FRAME] taille annoncée %ld != %d (le serveur sert-il bien tft28 ?)", c.rd.contentLength(), FRAME_BYTES);
    }
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  if (!ran) { shown = false; noFrame = false; logf("[FRAME] pile réseau dédiée : %s (erreur %u, marge %u o) — pas d'ACK ; l'écran a pu être partiellement ou totalement redessiné", podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin); }
  if (noFrame) { logf("[FRAME] pas de frame disponible"); return true; }
  if (!shown) { logf("[FRAME] image incomplète — pas d'ACK, nouvel essai au prochain pull"); sdFrameValid = false; return false; }
  lastFrameId = frameId;
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId = "";
  if (sdFrameValid) saveMeta(frameId);
  logf("[FRAME] OK en %lu ms (frameId=%s source=%s, cache SD: %s)", millis() - t0, frameId.c_str(), frameSource.c_str(), sdFrameValid ? "oui" : "non");
  ackFrame(frameId);
  return true;
}

// ─── Tactile : un toucher affiche / cache le cartel ────────────────────────
static void drainTouch() {
  while (!ts.bufferEmpty()) ts.getPoint();
  ts.writeRegister8(STMPE_INT_STA, 0xFF);
}
static void toggleCartel() {
  if (lastFrameId.length() == 0) return;                     // rien d'affiché : rien à habiller
  // Sans carte SD le cartel s'AFFICHE quand même, mais ne peut pas être masqué (la R4 n'a pas la RAM pour garder les pixels qu'il
  // recouvre) : il reste jusqu'à la prochaine image. La pastille rouge « SD absente » le dit à l'écran ; avec une carte, tout est automatique.
  if (!cartelVisible) {
    drawCartel();
    cartelVisible = true;
    logf("[TOUCH] cartel affiché");
    return;
  }
  // Masquer : on redessine les deux bandes depuis la copie sur la carte (pas de re-téléchargement)
  if (!sdFrameValid && sdOk && SD.exists(SD_FRAME)) {        // l'indicateur a pu être perdu : on revalide d'après la taille du fichier
    File chk = SD.open(SD_FRAME, FILE_READ);
    if (chk) { sdFrameValid = (chk.size() == (unsigned long)FRAME_BYTES); chk.close(); if (sdFrameValid) sdWhy = ""; }
  }
  if (!sdFrameValid) {
    logf("[TOUCH] cartel NON masquable : %s (voir les lignes [SD] ci-dessus)", sdWhy);
    drawCartel();                                            // rafraîchit la pastille rouge pour montrer pourquoi
    return;
  }
  const unsigned long t0 = millis();
  if (restoreRows(0, BAND_TOP_H) && restoreRows(BAND_BOT_Y, BAND_BOT_H)) {
    cartelVisible = false; logf("[TOUCH] cartel masqué en %lu ms", millis() - t0);
    if (animOn && animPaused) { animPaused = false; logf("[ANIM] reprise"); }
  }
  else { sdFrameValid = false; sdWhy = "SD lecture"; logf("[TOUCH] lecture de /pod/frame.bin impossible : cartel conservé"); drawCartel(); }
}
static void serviceTouch() {
  if (!touchOk || !ts.touched()) return;
  const unsigned long t0 = millis();
  while (ts.touched() && millis() - t0 < 1500UL) { delay(5); }   // attend le relâchement (anti-rebond)
  drainTouch();
  delay(120);
  toggleCartel();
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
  // Pas de « sceneCapability » : cet écran n'est pas un lecteur de scènes, le serveur lui sert toujours une image fixe.
  const String body = "{\"mac\":\"" + mac + "\",\"screens\":[\"" SCREEN_TYPE "\"],"
                      "\"firmware\":\"" FIRMWARE_VERSION "\","
                      "\"publicKey\":\"" + (keysLoaded ? bytesToHex(publicKey, 32) : String("")) + "\","
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
static void maybeFetchAnim(const String& frameId);
static void animForget();
static bool doPull() {
  String newBlockHash = "", newCandId = "", newFrameId = "", newFrameSource = "none";
  bool newBenchMode = false;
  int newBlockIndex = -1, pullRetryAfter = 60;
  String cmTitle = "", cmArtist = "";                       // cartel annoncé par CE pull : appliqué seulement si le pull apporte une nouvelle image
  int cmBlock = -1;
  bool hasCartel = false;

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
    newBenchMode = doc["benchMode"] | false;
    pendingAnimHash = ""; pendingAnimBytes = 0;
    JsonObject an = doc["anim"];                                // pointeur d'animation (écran à firmware >= 2.4 seulement)
    if (!an.isNull()) { pendingAnimHash = an["hash"] | ""; pendingAnimBytes = (size_t)(an["bytes"] | 0); }
    if (pullRetryAfter <= 0) pullRetryAfter = 60;
    if (newFrameId.length() == 0) { JsonObject fo = doc["frame"]; if (!fo.isNull()) newFrameId = fo["frameId"] | ""; }

    JsonObject cm = doc["cartelMeta"];
    if (!cm.isNull()) {
      cmTitle  = cm["workTitle"] | "";
      cmArtist = cm["drawArtistName"] | "";
      cmBlock  = cm["blockIndex"] | -1;
      hasCartel = true;
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

  if (newBenchMode && !benchMode) { benchModeSince = millis(); lastBenchPollMs = 0; logf("[BENCH] mode banc d'essai ACTIVÉ par l'app (poll toutes les %lu s)", BENCH_POLL_MS / 1000UL); }
  if (!newBenchMode && benchMode) logf("[BENCH] mode banc d'essai désactivé");
  benchMode = newBenchMode;
  nextPullIntervalMs = (newFrameSource == "none" && newCandId.length() == 0) ? (unsigned long)pullRetryAfter * 1000UL : PULL_INTERVAL;
  if (newBlockHash.length() > 0 && newBlockHash != currentBlockHash) {
    currentBlockHash = newBlockHash;                         // currentBlockIndex = bloc de l'IMAGE AFFICHÉE : il ne suit pas la tête de chaîne
    saveBlockHashToEEPROM(currentBlockHash);
    logf("[PULL] nouveau bloc #%d", newBlockIndex);
  }
  if (newCandId.length() > 0) pendingCandidateId = newCandId;

  if (newFrameSource == "none" || newFrameId.length() == 0) { logf("[PULL] aucune frame"); return true; }
  if (newFrameId == lastFrameId) { logf("[PULL] frame déjà affichée"); maybeFetchAnim(newFrameId); return true; }
  logf("[PULL] nouvelle frame %s (%s)", newFrameId.c_str(), newFrameSource.c_str());
  // Le cartel appartient à l'image : sur un pull sans nouvelle image, le serveur répond avec la tête de chaîne, qui n'est pas forcément
  // l'œuvre affichée (image renvoyée depuis une galerie, par exemple). On ne l'applique donc qu'ici.
  if (hasCartel) {
    pendingWorkTitle = cmTitle; pendingArtistName = cmArtist;
    if (cmBlock >= 0) currentBlockIndex = cmBlock;
    logf("[PULL] cartel: %s / %s (bloc %d)", asciiFold(pendingWorkTitle).c_str(), asciiFold(pendingArtistName).c_str(), currentBlockIndex);
  }

  const bool fetched = doFetchFrame(newFrameId, newFrameSource) && lastFrameId == newFrameId;
  if (fetched) {
    if (pendingAnimHash.length() == 64) maybeFetchAnim(newFrameId);   // l'affiche est à l'écran : on rapatrie le clip sur la carte
    else animForget();                                                // nouvelle image fixe : l'animation précédente s'arrête
  }
  reportMem("après pull");
  return true;
}

// ─── VALIDATION RÉELLE (vote v2) — ⚠ NON TESTÉE SUR LA CARTE ─────────────
// Le serveur annonce le candidat (écran, taille, SHA-256) ; la R4 lit le contenu BRUT en flux, recalcule le hash et les métriques entières, décide d'un verdict objectif,
// le signe (Ed25519) et vote. Elle relit un candidat de N'IMPORTE QUEL écran (le serveur ne l'oblige pas à voter pour son type) ; le tampon que demandent l'OLED (1 024 o)
// et l'e-ink 2,9" (4 736 o) est statique (la pile de la R4 est petite). Un candidat tft28 (153 600 o) est lu en flux, sans tampon d'image.
static uint8_t g_voteChunk[256];
static uint8_t g_voteScratch[4736];

// POD_NET_STACK : lecture du candidat sur la pile réseau dédiée. Fonction à part (noinline) : ses variables ne vivent que pendant la transaction, FERMÉE avant la signature (jamais imbriquée dans PodEd),
// et ne gonflent pas le cadre de doValidate, qui porte ensuite l'appel de signature. Échec de la pile dédiée : chk remis à zéro (chk.ok = false) → « calcul impossible », pas de vote.
static void __attribute__((noinline)) netReadCandidate(const String& candidateId, PodScreenKind kind, size_t bytes, PodCheck& chk) {
  PodNetInfo ni;
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", String("/api/candidate-frame?candidateId=") + candidateId, nullptr);
    chk.http = code;
    logf("[HTTP GET] /api/candidate-frame -> %d", code);
    if (code == 200) podCheckStream(c.rd, kind, bytes, g_voteScratch, sizeof(g_voteScratch), g_voteChunk, sizeof(g_voteChunk), &chk);
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  if (!ran) { memset(&chk, 0, sizeof(chk)); logf("[VALIDATE2] pile réseau dédiée : %s (erreur %u, marge %u o) — pas de vote", podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin); }
}

static bool doValidateV2(const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash) {
  PodScreenKind kind;
  if (!podKindFromName(screenName.c_str(), &kind)) { logf("[VALIDATE2] écran inconnu : %s", screenName.c_str()); return false; }
  reportMem("VALIDATE2-avant");
  PodCheck chk; memset(&chk, 0, sizeof(chk));
  netReadCandidate(candidateId, kind, bytes, chk);
  if (!chk.ok) { logf("[VALIDATE2] lecture/calcul impossible (http=%d, %u/%u octets)", chk.http, (unsigned)chk.bytes, (unsigned)bytes); return false; }

  bool accept = false;
  const char* reason = podVerdict(chk, announcedHash, &accept);
  logf("[VALIDATE2] %s %u o en %lu ms | e=%lu t=%lu r=%lu s=%lu | verdict=%s %s", screenName.c_str(), (unsigned)chk.bytes, (unsigned long)chk.ms,
       (unsigned long)chk.m.e, (unsigned long)chk.m.t, (unsigned long)chk.m.r, (unsigned long)chk.m.s, accept ? "accept" : "reject", reason);
  logf("[VALIDATE2] hash=%s", chk.hash);

  const String msg = podVoteMessage(deviceId, candidateId, chk.hash, chk.m, accept);
  uint8_t sig[64];
  const unsigned long ts = millis();
  if (!PodEd::sign(sig, privateKey, publicKey, (const uint8_t*)msg.c_str(), msg.length())) { logf("[VALIDATE2] signature impossible (pile Ed25519 dédiée) — vote NON envoyé"); return false; }   // POD_ED_STACK
  logf("[VALIDATE2] signature en %lu ms", millis() - ts);
  const String body = String("{\"v\":2,\"deviceId\":\"") + deviceId + "\",\"candidateId\":\"" + candidateId + "\",\"rawHash\":\"" + chk.hash + "\"," +
                      "\"e\":" + String((unsigned long)chk.m.e) + ",\"t\":" + String((unsigned long)chk.m.t) + ",\"r\":" + String((unsigned long)chk.m.r) + "," +
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
    // 403 « Signature » = clé publique désynchronisée côté serveur : on se ré-enregistre pour la renvoyer (comme le chemin v1), le prochain cycle votera.
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
    logf("[VALIDATE] vote OK");
    if (vResp.indexOf("\"blockMined\":true") >= 0) { logf("[VALIDATE] BLOC MINÉ"); blockMined = true; }
  } else {
    logf("[VALIDATE] vote refusé (%d)", vCode);
    if (vResp.indexOf("Signature") >= 0) { logf("[VALIDATE] resynchronisation de la clé publique (re-register)"); doRegister(); }
  }
  return blockMined;
}

// ─── BANC D'ESSAI D'ANIMATION ───────────────────────────────────────────────
// Envoi des pixels PAR BLOCS. Adafruit_SPITFT::writePixels envoie, sur la R4, chaque pixel par deux appels SPI.transfer(octet) séparés (≈ 4,3 µs par
// pixel mesuré au banc d'essai). Le cœur R4 sait envoyer un bloc en mots de 32 bits : on l'appelle directement. transfer(buf, n) écrase le tampon
// avec la réception, d'où la copie dans g_tx32 (alignée 32 bits). La fenêtre d'adressage reste posée par la bibliothèque (DC déjà haut après RAMWR).
static uint32_t g_tx32[SCR_W / 2];                  // 480 o : une ligne de 240 pixels RGB565
static void fastPixels(const uint16_t* colors, uint32_t len) {
  if (!len || len > (uint32_t)SCR_W) return;
  const uint32_t bytes = len * 2;
  memcpy(g_tx32, colors, bytes);
  SPI.transfer((void*)g_tx32, bytes);
}
/** Même interface que Adafruit_ILI9341 pour pod_bench.h, mais writePixels passe par fastPixels. */
struct FastTft {
  void startWrite() { tft.startWrite(); }
  void endWrite() { tft.endWrite(); }
  void setAddrWindow(int x, int y, int w, int h) { tft.setAddrWindow(x, y, w, h); }
  void writePixels(uint16_t* c, uint32_t len, bool, bool) { fastPixels(c, len); }
};

static void postBenchResult(const String& clipId, uint32_t frames, unsigned long expectedMs, unsigned long elapsedMs, unsigned long workSumUs,
                            unsigned long workMaxUs, uint32_t overruns, unsigned long maxLateMs, long minSlackMs, unsigned long downloadMs,
                            size_t bytes, bool stopped, const char* error) {
  String body = "{\"deviceId\":\"" + deviceId + "\",\"clipId\":\"" + clipId + "\",\"frames\":" + String(frames)
              + ",\"expectedMs\":" + String(expectedMs) + ",\"elapsedMs\":" + String(elapsedMs)
              + ",\"avgWorkUs\":" + String(frames ? workSumUs / frames : 0UL) + ",\"maxWorkUs\":" + String(workMaxUs)
              + ",\"overruns\":" + String(overruns) + ",\"maxLateMs\":" + String(maxLateMs) + ",\"minSlackMs\":" + String(minSlackMs)
              + ",\"downloadMs\":" + String(downloadMs)
              + ",\"bytes\":" + String((unsigned long)bytes) + ",\"heapFree\":" + String((unsigned long)freeHeapBytes())
              + ",\"stopped\":" + (stopped ? "true" : "false");
  if (error) body += String(",\"error\":\"") + error + "\"";
  body += "}";
  String resp;
  httpCall("POST", "/api/bench/result", &body, resp);
}

/** Un contrôle rapide : mode actif ? quel clip ? Retourne 1 = lu, 0 = échec réseau/lecture (429 compris). */
static int benchPollOnce(bool& mode, String& clipId, size_t& bytes) {
  String resp;
  g_quietHttp = true;
  const int code = httpCall("GET", "/api/bench/poll?deviceId=" + deviceId, nullptr, resp);
  g_quietHttp = false;
  if (code == 429) return 0;
  if (code != 200) { logf("[BENCH] poll en erreur (%d)", code); return 0; }
  JSON_DOC(doc, 384);
  if (deserializeJson(doc, resp)) return 0;
  mode = doc["mode"] | false;
  JsonObject c = doc["clip"];
  clipId = ""; bytes = 0;
  if (!c.isNull()) { clipId = c["clipId"] | ""; bytes = (size_t)(c["bytes"] | 0); }
  return 1;
}

enum BenchStop : uint8_t { BS_DONE = 0, BS_TOUCH, BS_CHECK, BS_CAP };
#define BENCH_LOOP_CHECK_MS 20000UL                 // clip en boucle : on vérifie auprès du serveur toutes les 20 s (l'animation se fige ~2 s)
#define BENCH_LOOP_MAX_MS   (60UL * 60UL * 1000UL)  // et on s'arrête de toute façon au bout d'une heure

/** Télécharge le clip (TLS fermé ensuite), le valide entièrement, le joue en mesurant, renvoie les mesures, puis remet l'œuvre (carte SD). */
// POD_NET_STACK : téléchargement du clip sur la pile réseau dédiée (fonction à part, noinline : ses variables ne gonflent pas le cadre de loop(), où ce code est inliné)
static bool __attribute__((noinline)) netGetBenchClip(const String& clipId, uint8_t* clip, size_t announced) {
  bool got = false;
  PodNetInfo ni;
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", "/api/bench/clip?deviceId=" + deviceId + "&clipId=" + clipId, nullptr);
    if (code == 200 && (c.rd.contentLength() < 0 || (size_t)c.rd.contentLength() == announced))
      got = c.rd.readBody(clip, announced) == announced && c.rd.complete();
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  if (!ran) { got = false; logf("[BENCH] pile réseau dédiée : %s (erreur %u, marge %u o) — clip NON retenu", podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin); }
  return got;
}

static void playBenchClip(const String& clipId, size_t announced) {
  logf("[BENCH] clip %s : %u octets annoncés", clipId.c_str(), (unsigned)announced);
  lastBenchClipId = clipId;                                   // jamais rejoué en boucle, même en cas d'échec
  if (announced < (size_t)(BENCH_HDR + 5 + BENCH_FRAME) || announced > BENCH_MAX_CLIP) {
    logf("[BENCH] taille refusée (%u)", (unsigned)announced);
    postBenchResult(clipId, 0, 0, 0, 0, 0, 0, 0, 0, 0, announced, false, "taille refusee");
    return;
  }
  uint8_t* clip = (uint8_t*)malloc(announced);
  uint8_t* cur = (uint8_t*)malloc(BENCH_FRAME);
  if (!clip || !cur) {
    free(clip); free(cur);
    logf("[BENCH] mémoire insuffisante");
    postBenchResult(clipId, 0, 0, 0, 0, 0, 0, 0, 0, 0, announced, false, "memoire");
    return;
  }

  const unsigned long tDl = millis();
  bool got = netGetBenchClip(clipId, clip, announced);
  const unsigned long downloadMs = millis() - tDl;
  podbench::Clip pc;
  podbench::Err perr = got ? podbench::parse(clip, announced, pc, cur) : podbench::ERR_SIZE;
  if (!got || perr != podbench::OK) {
    logf("[BENCH] clip refusé (%s)", got ? podbench::errName(perr) : "téléchargement incomplet");
    free(clip); free(cur);
    postBenchResult(clipId, 0, 0, 0, 0, 0, 0, 0, 0, downloadMs, announced, false, got ? "clip invalide" : "telechargement");
    return;
  }
  const bool infinite = (pc.loops == 0);
  logf("[BENCH] reçu en %lu ms — %u images, %s, lecture", downloadMs, (unsigned)pc.frames, infinite ? "EN BOUCLE (toucher = arrêt)" : (String((unsigned)pc.loops) + " boucle(s)").c_str());

  tft.setRotation(0);
  tft.fillScreen(pc.bg);
  cartelVisible = false;                                      // l'écran est désormais celui du banc d'essai
  FastTft ft;
  uint32_t frames = 0, overruns = 0;
  unsigned long workSum = 0, workMax = 0, maxLate = 0, expectedMs = 0, elapsedMs = 0, lastTouchChk = millis();
  long minSlack = 0x7FFFFFFF;
  bool stopped = false;
  const unsigned long tStart = millis();
  unsigned long lastCheck = tStart;
  BenchStop why = BS_DONE;
  for (;;) {
    const unsigned long segStart = millis();
    unsigned long target = segStart;                          // instant où l'image courante DOIT commencer à apparaître
    unsigned long startedMs = segStart;                       // instant où sa peinture a réellement commencé
    unsigned long workStartUs = micros();
    why = BS_DONE;
    podbench::play(pc, cur, ft, g_row, [&](uint32_t, uint16_t delayMs) -> bool {
      const unsigned long workUs = micros() - workStartUs;     // appliquer la différence + peindre
      const long late = (long)(startedMs - target);            // RETARD DE DÉMARRAGE : > 0 seulement si l'image précédente a débordé sur son délai
      if (late > 5) { overruns++; if ((unsigned long)late > maxLate) maxLate = (unsigned long)late; }
      workSum += workUs; if (workUs > workMax) workMax = workUs;
      frames++; expectedMs += delayMs;
      target += delayMs;                                       // horloge ABSOLUE : pas de dérive cumulée
      const long slack = (long)(target - millis());            // marge restante avant l'image suivante (négative = en retard)
      if (slack < minSlack) minSlack = slack;
      while ((long)(millis() - target) < 0) {
        if (touchOk && millis() - lastTouchChk > 200UL) { lastTouchChk = millis(); if (ts.touched()) { drainTouch(); stopped = true; why = BS_TOUCH; return false; } }
        delay(1);
      }
      if (infinite && millis() - lastCheck >= BENCH_LOOP_CHECK_MS) { why = BS_CHECK; return false; }
      if (infinite && millis() - tStart > BENCH_LOOP_MAX_MS) { why = BS_CAP; return false; }
      startedMs = millis(); workStartUs = micros();
      return true;
    });
    elapsedMs += millis() - segStart;
    if (why != BS_CHECK) break;
    // Clip en boucle : le serveur veut-il toujours CE clip ? (un nouvel envoi ou l'arrêt du mode interrompt la boucle)
    bool mode = true; String id; size_t b = 0;
    const int ok = benchPollOnce(mode, id, b);
    lastCheck = millis();
    if (ok && !mode) { benchMode = false; logf("[BENCH] mode terminé côté serveur : fin de la boucle"); break; }
    if (ok && id.length() > 0 && id != clipId) { logf("[BENCH] nouveau clip %s : fin de la boucle", id.c_str()); break; }
  }
  logf("[BENCH] lecture %s : %lu images en %lu ms (prévu %lu) — travail moy %lu us, max %lu us, retards de démarrage %lu (max %lu ms), marge min %ld ms",
       why == BS_TOUCH ? "INTERROMPUE (toucher)" : "terminée", (unsigned long)frames, elapsedMs, expectedMs, frames ? workSum / frames : 0UL, workMax,
       (unsigned long)overruns, maxLate, minSlack == 0x7FFFFFFF ? 0L : minSlack);
  free(clip); free(cur);                                      // libérés AVANT d'ouvrir une connexion TLS pour les mesures
  postBenchResult(clipId, frames, expectedMs, elapsedMs, workSum, workMax, overruns, maxLate, minSlack == 0x7FFFFFFF ? 0L : minSlack, downloadMs, announced, stopped, nullptr);
  if (sdFrameValid) {                                         // l'œuvre revient depuis la carte SD
    const unsigned long tr = millis();
    if (restoreRows(0, SCR_H)) logf("[BENCH] œuvre remise en place depuis la carte SD en %lu ms", millis() - tr);
  }
}

static void doBenchPoll() {
  bool mode = false; String id; size_t bytes = 0;
  if (!benchPollOnce(mode, id, bytes)) return;
  if (!mode) { benchMode = false; logf("[BENCH] mode terminé côté serveur"); return; }
  if (id.length() > 0 && id != lastBenchClipId) playBenchClip(id, bytes);
}

// ─── Animation résidente : clip sur la microSD, lecture en boucle ───────────
/** L'œuvre affichée n'est plus une animation : on oublie le clip (et le marqueur) pour qu'un redémarrage n'affiche pas l'ancienne. */
static void animForget() {
  if (animOn) logf("[ANIM] arrêt : nouvelle image fixe");
  animOn = false; animPaused = false; animHash = "";
  if (!sdOk) return;
  if (SD.exists(SD_ANIM_META)) SD.remove(SD_ANIM_META);
  if (SD.exists(SD_ANIM)) SD.remove(SD_ANIM);
}

/** Au démarrage : si la carte porte le clip de l'œuvre qui vient d'être réaffichée, l'animation reprend. */
static void animLoadMarker() {
  if (!sdOk || !SD.exists(SD_ANIM_META) || !SD.exists(SD_ANIM)) return;
  File m = SD.open(SD_ANIM_META, FILE_READ);
  if (!m) return;
  String hash = m.readStringUntil('\n'); hash.trim();
  String fid = m.readStringUntil('\n'); fid.trim();
  m.close();
  if (hash.length() != 64 || fid != lastFrameId) { logf("[ANIM] clip de la carte ne correspond pas à l'œuvre : ignoré"); return; }
  animOn = true; animPaused = false; animHash = hash;
  logf("[ANIM] clip trouvé sur la carte (bloc %s…) : lecture en boucle", hash.substring(0, 12).c_str());
}

/** Télécharge le clip du bloc (TLS fermé ensuite), le valide ENTIÈREMENT, le range sur la carte puis marque l'animation comme active. */
// POD_NET_STACK : téléchargement du clip sur la pile réseau dédiée (fonction à part, noinline : ses variables ne gonflent pas le cadre de loop(), où ce code est inliné)
static bool __attribute__((noinline)) netGetBlockClip(const String& hash, uint8_t* clip, size_t announced) {
  bool got = false;
  PodNetInfo ni;
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", "/api/block-clip?hash=" + hash, nullptr);
    logf("[HTTP GET] /api/block-clip -> %d (contenu %ld)", code, c.rd.contentLength());
    if (code == 200 && (c.rd.contentLength() < 0 || (size_t)c.rd.contentLength() == announced))
      got = c.rd.readBody(clip, announced) == announced && c.rd.complete();
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  if (!ran) { got = false; logf("[ANIM] pile réseau dédiée : %s (erreur %u, marge %u o) — clip NON retenu", podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin); }
  return got;
}

static bool fetchAnimToSd(const String& hash, size_t announced) {
  if (!sdOk) { logf("[ANIM] pas de carte SD : animation non lue (l'affiche reste à l'écran)"); return false; }
  if (announced < (size_t)(BENCH_HDR + 5 + BENCH_FRAME) || announced > BENCH_MAX_CLIP) { logf("[ANIM] taille refusée (%u)", (unsigned)announced); return false; }
  uint8_t* clip = (uint8_t*)malloc(announced);
  uint8_t* cur = (uint8_t*)malloc(BENCH_FRAME);
  if (!clip || !cur) { free(clip); free(cur); logf("[ANIM] mémoire insuffisante"); return false; }
  const unsigned long t0 = millis();
  bool got = netGetBlockClip(hash, clip, announced);
  podbench::Clip pc;
  const podbench::Err perr = got ? podbench::parse(clip, announced, pc, cur) : podbench::ERR_SIZE;
  free(cur);
  if (!got || perr != podbench::OK) {
    logf("[ANIM] clip refusé (%s)", got ? podbench::errName(perr) : "téléchargement incomplet");
    free(clip);
    return false;
  }
  // Rangement : clip COMPLET d'abord, marqueur ensuite (un arrêt en cours d'écriture ne laisse jamais un clip à moitié « actif »)
  if (SD.exists(SD_ANIM_META)) SD.remove(SD_ANIM_META);
  if (SD.exists(SD_ANIM)) SD.remove(SD_ANIM);
  bool saved = false;
  File f = SD.open(SD_ANIM, FILE_WRITE);
  if (f) { saved = f.write(clip, announced) == announced; f.close(); }
  free(clip);
  if (!saved) { logf("[ANIM] écriture du clip sur la carte impossible"); if (SD.exists(SD_ANIM)) SD.remove(SD_ANIM); return false; }
  File m = SD.open(SD_ANIM_META, FILE_WRITE);
  if (m) { m.println(hash); m.println(lastFrameId); m.close(); }
  animOn = true; animPaused = false; animHash = hash;
  logf("[ANIM] clip reçu en %lu ms, %u images, rangé sur la carte (%u o) : lecture en boucle", millis() - t0, (unsigned)pc.frames, (unsigned)announced);
  return true;
}

static void maybeFetchAnim(const String& frameId) {
  if (pendingAnimHash.length() != 64) return;
  if (animOn && animHash == pendingAnimHash) return;         // déjà sur la carte
  if (frameId != lastFrameId) return;                        // l'affiche doit être ce qui est à l'écran
  fetchAnimToSd(pendingAnimHash, pendingAnimBytes);
}

/** Joue le clip de la carte EN BOUCLE pendant au plus `budgetMs` (le temps avant la prochaine tâche réseau), puis rend la main. */
static AnimEnd runResidentAnim(unsigned long budgetMs) {
  File f = SD.open(SD_ANIM, FILE_READ);
  if (!f) { logf("[ANIM] clip illisible"); return AE_ERROR; }
  const size_t n = f.size();
  if (n < (size_t)(BENCH_HDR + 5 + BENCH_FRAME) || n > BENCH_MAX_CLIP) { f.close(); logf("[ANIM] taille de clip invalide (%u)", (unsigned)n); return AE_ERROR; }
  uint8_t* clip = (uint8_t*)malloc(n);
  uint8_t* cur = (uint8_t*)malloc(BENCH_FRAME);
  if (!clip || !cur) { free(clip); free(cur); f.close(); logf("[ANIM] mémoire insuffisante pour la lecture"); return AE_ERROR; }
  const bool rd = f.read(clip, n) == (int)n;
  f.close();
  podbench::Clip pc;
  const podbench::Err perr = rd ? podbench::parse(clip, n, pc, cur) : podbench::ERR_SIZE;
  if (!rd || perr != podbench::OK) { free(clip); free(cur); logf("[ANIM] clip de la carte refusé (%s)", rd ? podbench::errName(perr) : "lecture"); return AE_ERROR; }

  tft.setRotation(0);
  tft.fillScreen(pc.bg);
  cartelVisible = false;
  FastTft ft;
  const unsigned long tEnd = millis() + budgetMs;
  unsigned long target = millis(), lastTouchChk = millis();
  AnimEnd why = AE_TIME;
  podbench::play(pc, cur, ft, g_row, [&](uint32_t, uint16_t delayMs) -> bool {
    target += delayMs;                                        // horloge ABSOLUE : pas de dérive cumulée
    while ((long)(millis() - target) < 0) {
      if (touchOk && millis() - lastTouchChk > 200UL) { lastTouchChk = millis(); if (ts.touched()) { drainTouch(); why = AE_TOUCH; return false; } }
      if ((long)(millis() - tEnd) >= 0) return false;
      delay(1);
    }
    return (long)(millis() - tEnd) < 0;
  });
  free(clip); free(cur);
  return why;
}

/** Un toucher pendant l'animation : pause sur l'affiche, avec le cartel. */
static void onAnimTouch() {
  animPaused = true; animPausedSince = millis();
  if (!(sdFrameValid && restoreRows(0, SCR_H))) tft.fillScreen(C_BLACK);
  drawCartel(); cartelVisible = true;
  logf("[ANIM] pause (toucher) : re-toucher ou attendre 60 s pour reprendre");
}

/** Temps avant la prochaine tâche réseau (pull, vote, ré-validation) : l'animation ne la retarde jamais. */
static unsigned long msUntilNextTask() {
  long r = (long)(lastPullMs + nextPullIntervalMs - millis());
  if (pendingCandidateId.length() > 0) { const long v = (long)(lastValidateMs + VALIDATE_INTERVAL - millis()); if (v < r) r = v; }
  if (pendingObsHashes.length() > 0) r = 0;
  return r < 0 ? 0UL : (unsigned long)r;
}

// ─── AUTO-TEST Ed25519 (au boot) : signature + vérification sur la pile dédiée (podEdStack.h), garde et marge mesurées (POD_ED_STACK) ────────────
static void selfTestEd25519() {
  static const char msg[] = "pod-r4-selftest";
  uint8_t sig[64];
  unsigned long t = millis();
  PodEdInfo infoS, infoV; memset(&infoV, 0, sizeof(infoV));   // POD_ED_STACK
  const bool signedOk = PodEd::sign(sig, privateKey, publicKey, msg, strlen(msg), &infoS);
  const unsigned long tSign = millis() - t;
  t = millis();
  const bool ok = signedOk && PodEd::verify(sig, publicKey, msg, strlen(msg), &infoV);   // POD_ED_STACK
  const unsigned long tVerify = millis() - t;
  logf("[SELFTEST] Ed25519 signature %lu ms, vérification %lu ms -> %s", tSign, tVerify, ok ? "OK" : "ECHEC");
  reportMem("après Ed25519");
  logf("[ED25519] pile dédiée (utilisé/marge, o) : sign %u/%u, verify %u/%u ; erreurs sign=%u verify=%u (0 = aucune) ; alloué %u o (garde %u o, marge minimale exigée %u o)", (unsigned)infoS.used, (unsigned)infoS.margin, (unsigned)infoV.used, (unsigned)infoV.margin, (unsigned)infoS.err, (unsigned)infoV.err, (unsigned)POD_ED_STACK_TOTAL, (unsigned)POD_ED_GUARD_BYTES, (unsigned)POD_ED_MARGIN_MIN);   // POD_ED_STACK
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
  pinMode(SD_CS, OUTPUT);    digitalWrite(SD_CS, HIGH);

  tft.begin();
  tft.setRotation(0);
#if TOUCH_ENABLED
  touchOk = ts.begin();
  logf("[TOUCH] STMPE610 %s", touchOk ? "détecté (toucher = afficher / cacher le cartel)" : "NON détecté (toucher désactivé)");
#else
  logf("[TOUCH] désactivé (TOUCH_ENABLED 0)");
#endif
  tftStatus("Proof-of-Draw", "Connexion WiFi...");
  initSD();

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
  if (paired) {
    restoreLastFrame();                                 // la dernière œuvre revient tout de suite depuis la carte SD
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

  serviceTouch();

  // Animation résidente : lue depuis la carte, en boucle, entre deux tâches réseau (jamais de requête pour elle)
  if (animOn && animPaused && millis() - animPausedSince > 60000UL) { animPaused = false; logf("[ANIM] reprise (60 s)"); }
  if (animOn && !animPaused && !benchMode) {
    const unsigned long budget = msUntilNextTask();
    if (budget > 400UL) {
      const AnimEnd e = runResidentAnim(budget);
      if (e == AE_TOUCH) onAnimTouch();
      else if (e == AE_ERROR) { animOn = false; logf("[ANIM] lecture impossible : animation abandonnée (l'affiche reste)"); if (sdFrameValid) restoreRows(0, SCR_H); }
      return;                                                 // `now` est périmé : on repart d'une horloge fraîche
    }
  }

  if (benchMode) {
    if (millis() - benchModeSince > BENCH_MODE_MAX_MS) { benchMode = false; logf("[BENCH] mode expiré (31 min)"); }
    else if (millis() - lastBenchPollMs >= BENCH_POLL_MS) { lastBenchPollMs = millis(); doBenchPoll(); }
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
  delay(40);
}
