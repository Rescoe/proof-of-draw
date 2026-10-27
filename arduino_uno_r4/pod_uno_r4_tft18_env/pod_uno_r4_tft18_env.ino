// pod_uno_r4_tft18_env.ino — PRODUIT COMPLET R4 (26/10/2026) : UNO R4 WiFi + TFT 1,8″ (œuvres, cartel) + VOTE RÉEL v2 + capteurs DHT22 / SGP40 + mise à jour OTA R4-B.
// Dérivé de pod_uno_r4_tft18 (affichage, clés, vote, ACK) + des correctifs de mémoire VALIDÉS sur carte dans les autres firmwares R4 : client TLS borné (PodBoundedSSL), register / pull / validate décodés sur la pile
// de travail dédiée (podWorkRun), + pod_uno_r4_station (capteurs, OTA). Écran serveur « tft18 » (compté dans le quorum dès r4tft18-1.1 : lib/voteCapability.ts).
// ÉTAT : COMPILÉ seulement (cœur 1.6.0) ; JAMAIS flashé, jamais essayé sur la carte (ni vote, ni image, ni capteur, ni OTA de ce produit). Drapeaux : POD_SENSORS = 0, POD_OTA_R4 = 0 par défaut (firmware = r4tft18 corrigé).
// Voir docs/PRODUIT_R4_TFT18_ENV_2026_10_26.md (câblage, protocole du premier essai, ce qui n'est pas prouvé).
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
#if __has_include("pod_build_flags.h")
  #include "pod_build_flags.h"   // drapeaux de BANC (IGNORÉ par git) : FIRMWARE_VERSION, POD_SENSORS, POD_OTA_R4, OTAR4_*
#endif
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
#include "podEdStack.h"   // POD_ED_STACK : Ed25519 sur PILE DÉDIÉE (la pile principale de la R4 n'a que 1 024 o) — docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md
#ifndef POD_NET_STACK_TOTAL
#define POD_NET_STACK_TOTAL 3072u   // le flux de l'image (Adafruit + SPI) s'écrit DANS la transaction TLS : 1 024 o de plus que les autres firmwares R4
#endif
#include "podNetStack.h"   // POD_NET_STACK : transactions réseau/TLS ET journal sur PILE DÉDIÉE (connect() déborde de 456 o sous __StackLimit) — docs/LOT_8B2B2_NETSTACK_FIX1_2026_10_09.md, docs/LOT_8B2B2_NETSTACK_FIX2_2026_10_09.md
#include <SHA256.h>
#include "pod_http.h"
#include "pod_vote_r4.h"
#include "pod_ssl_bounded.h"   // client TLS à réception modem BORNÉE (240 o) : validé sur carte (e-ink 2,9″ 11/10, TFT 2,8″ 13/10, capteur R4 12/10)
#include "dht22.h"
#include "sgp40.h"
#include <Wire.h>
#include <new>

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
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION    "r4tft18-2.0"
#endif
#ifndef POD_SENSORS
#define POD_SENSORS 0                                // 1 : DHT22 (D2) + SGP40 (I2C) lus toutes les 30 min, envoyés toutes les heures à /api/sensor (comme la station)
#endif
#ifndef POD_ENV_DISPLAY
#define POD_ENV_DISPLAY 0                            // 1 : écran de STATION (28/10/2026) — page « mesures » et page « animation » en alternance toutes les ENV_PAGE_MS ; une nouvelle œuvre s'affiche ENV_PAGE_MS puis l'alternance reprend. Exige POD_SENSORS.
#endif
#if POD_ENV_DISPLAY && !POD_SENSORS
#error "POD_ENV_DISPLAY exige POD_SENSORS=1"
#endif
#ifndef ENV_PAGE_MS
#define ENV_PAGE_MS 60000UL                          // durée de chaque page (essai : 1 minute)
#endif
#ifndef POD_SD_CS_PIN
#define POD_SD_CS_PIN 0                              // 0 = rien ; sinon broche CS du lecteur SD du module, tenue HAUTE pour qu'il reste muet sur le bus SPI partagé (la SD n'est pas utilisée par ce firmware)
#endif
#ifndef POD_OTA_R4
#define POD_OTA_R4 0                                 // 1 : client OTA R4-B (manifeste signé Ed25519), famille uno-r4-wifi-tft18
#endif
#ifndef OTAR4_COMPILED_SEQ
#define OTAR4_COMPILED_SEQ 1
#endif
#define DHT_PIN             2
#define READ_INTERVAL_MS    1800000UL
#define POST_INTERVAL_MS    3600000UL
#define SPEED_EVERY_N_POSTS 1
#define SENSOR_RETRY_MS     300000UL
#define SGP_WARMUP_SAMPLES  12
#if POD_OTA_R4
  #define OTAR4_FAMILY "uno-r4-wifi-tft18"
  #define OTAR4_KIND "tft18"
  #if __has_include("pod_ota_r4_keys.h")
    #include "pod_ota_r4_keys.h"
  #endif
#endif
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
#if POD_ENV_DISPLAY
static uint8_t g_envPage = 0;                      // 0 = mesures, 1 = animation, 255 = une œuvre est à l'écran (ne pas la recouvrir avant ENV_PAGE_MS)
static bool g_envFull = true;                      // la page doit être redessinée en entier
static unsigned long g_envPageAtMs = 0;
#define ENV_DIRTY() (g_envFull = true)             // tout autre affichage (état, QR…) a recouvert la page
#define ENV_ART_SHOWN() do { g_envPage = 255; g_envPageAtMs = millis(); } while (0)
#else
#define ENV_DIRTY() ((void)0)
#define ENV_ART_SHOWN() ((void)0)
#endif

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
// NETSTACK-FIX3 : GUARD = la garde de la pile de journal a été écrasée → le voisin au tas est corrompu : faute persistante, ARRÊT SÛR SILENCIEUX (aucun pull, vote, ACK ni affichage ; la carte se tait), jamais « une ligne perdue ».
// MARGIN (garde intacte, marge < 128 o) : fatal dans le build de canari seulement ; en production la ligne a été écrite et on continue (NOMEM : ligne abandonnée).
static void __attribute__((noinline, noreturn)) logfSafeStop() {
  for (;;) { __asm volatile("nop"); }              // NETSTACK-FIX3-R1 : AUCUNE E/S, AUCUNE allocation, AUCUN retour (appelée depuis un cadre quelconque de la pile principale : un Serial.println ici peut lui-même la déborder)
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
static void reportMem(const char* tag) { logf("[MEM] %s: tas libre %lu o, zone 0xA5 sous la pile %lu o (INDICATIF : NON fiable des la 1re pile temporaire)", tag, (unsigned long)freeHeapBytes(), (unsigned long)stackDepthBytes()); }

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

// ─── MODULE Wi-Fi sur PILE DÉDIÉE (NETSTACK-WIFI-CALLS-FIX1, 09/10/2026) ──────────────────────────────────
// Canari FIX3-R1 (matériel) : WiFi.macAddress() appelé depuis doRegister détruit le marqueur de pile (24 o sous __StackLimit) : chaque appel au module (ModemClass → vsnprintf) pose une feuille de 400 – 600 o sur le cadre
// de l'appelant. TOUT appel direct au module hors transaction PodNet passe donc par ces fonctions : il s'exécute sur POD_WIFI_STACK_TOTAL o pris un instant au tas (garde 64 o, filigrane, marge >= 128 o, objectif 256 o).
// Résultats chez l'APPELANT (variables captées par référence) ; jamais imbriqué (NESTED : un appel déjà sur une pile dédiée n'est pas ré-enveloppé) ; ÉCHEC FERMÉ : valeur « inconnue », chaîne vide ou false — jamais un résultat
// partiel (NOMEM, NESTED, GUARD, MARGIN). Les appels faits PAR une transaction PodNet (WiFiSSLClient dans podNetRun) restent sur la pile réseau.
#define POD_WIFI_UNKNOWN 0xFEu                         // état Wi-Fi inconnu (appel en échec) : ni WL_CONNECTED ni WL_NO_MODULE
static void __attribute__((noinline)) wifiFailed(const char* what, const PodNetInfo& ni) {   // attribut : le générateur de prototypes de l IDE placerait sinon le prototype AVANT la définition de PodNetInfo
  if (ni.err == POD_NET_GUARD) logfSafeStop();             // garde écrasée : le voisin au tas est corrompu — arrêt sûr silencieux, AVANT tout journal (logf alloue au tas)
  logf("[WIFI] %s : pile Wi-Fi dédiée : %s (erreur %u, marge %u o) — résultat IGNORÉ", what, podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin);
}
static uint8_t __attribute__((noinline)) wifiStatusT(const char* tag) {
  uint8_t st = POD_WIFI_UNKNOWN; PodNetInfo ni; (void)tag;           // tag : seulement pour le relevé du canari
  auto wx = [&]() { st = (uint8_t)WiFi.status(); };
  const bool ran = podWifiRun(wx, &ni);
  if (!ran) { wifiFailed("status", ni); return POD_WIFI_UNKNOWN; }
  return st;
}
static uint8_t wifiStatus() { return wifiStatusT(nullptr); }
static String __attribute__((noinline)) wifiFirmware() {
  String fw; PodNetInfo ni;
  auto wx = [&]() { fw = String(WiFi.firmwareVersion()); };
  const bool ran = podWifiRun(wx, &ni);
  if (!ran) { wifiFailed("firmwareVersion", ni); return String("?"); }
  return fw;
}
static void __attribute__((noinline)) wifiBegin() {
  PodNetInfo ni;
  auto wx = [&]() { WiFi.begin(WIFI_SSID, WIFI_PASSWORD); };
  const bool ran = podWifiRun(wx, &ni);
  if (!ran) wifiFailed("begin", ni);
}
static bool __attribute__((noinline)) wifiMac(uint8_t m[6]) {
  PodNetInfo ni;
  auto wx = [&]() { WiFi.macAddress(m); };
  const bool ran = podWifiRun(wx, &ni);
  if (!ran) { memset(m, 0, 6); wifiFailed("macAddress", ni); return false; }
  return true;
}
static bool __attribute__((noinline)) wifiRssi(int32_t& rssi) {
  PodNetInfo ni; int32_t r = 0;
  auto wx = [&]() { r = (int32_t)WiFi.RSSI(); };
  const bool ran = podWifiRun(wx, &ni);
  if (!ran) { rssi = 0; wifiFailed("RSSI", ni); return false; }
  rssi = r;
  return true;
}
static String __attribute__((noinline)) wifiIpString() {
  String ip; PodNetInfo ni;                  // la chaîne « a.b.c.d » est formée SUR la pile dédiée (IPAddress::toString → sniprintf : jamais sur la pile principale)
  auto wx = [&]() { ip = WiFi.localIP().toString(); };
  const bool ran = podWifiRun(wx, &ni);
  if (!ran) { wifiFailed("localIP", ni); return String("?"); }
  return ip;
}

// ─── Clés Ed25519 ──────────────────────────────────────────────────────────
// Entropie : bruit des entrées analogiques flottantes + gigue d'horloge + MAC + RSSI, condensés par SHA-256.
// (Même niveau que les firmwares ESP : suffisant pour identifier un écran, PAS un générateur certifié.)
static bool gatherEntropy(uint8_t out[32]) {
  SHA256 h; h.reset();
  uint8_t mac[6] = {0}; int32_t rssi = 0;
  if (!wifiMac(mac) || !wifiRssi(rssi)) { memset(out, 0, 32); return false; }   // NETSTACK-WIFI-CALLS-FIX1 : échec fermé — aucune entropie partielle
  h.update(mac, 6);
  h.update(&rssi, sizeof(rssi));
  for (int i = 0; i < 384; i++) {
    const uint16_t v = (uint16_t)analogRead(A0 + (i % 6));
    const uint32_t m = micros();
    h.update(&v, sizeof(v)); h.update(&m, sizeof(m));
    delayMicroseconds(29 + (v & 15));
  }
  h.finalize(out, 32);
  return true;
}
static void generateKeys() {
  logf("[KEYS] Génération de la paire Ed25519...");
  if (!gatherEntropy(privateKey)) { logf("[KEYS] génération ANNULÉE : module Wi-Fi indisponible (pile dédiée) — aucune clé enregistrée"); memset(privateKey, 0, 32); return; }
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
// À partir d'ici le nom WiFiSSLClient désigne PodBoundedSSL (pod_ssl_bounded.h) : chaque lecture TLS demande au module AU PLUS 240 o.
#define WiFiSSLClient PodBoundedSSL
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

// ─── TFT : affichage en flux, sans tampon plein écran ────────────────────────
#define C_BLACK 0x0000
#define C_WHITE 0xFFFF
#define C_NAVY  0x08C5
#define C_GOLD  0xFEA0
#define C_DARK  0x10C4
#define C_GREY  0x7BEF
#define C_RED   0xF800

static void tftStatusImpl(const String& line1, const String& line2, uint16_t bg) {
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

static void drawCartelImpl() {
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
static void displayKeyMaterialOnceImpl() {
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

static void displayOnboardingQRImpl(const String& onboardUrl, const String& code, const String& mac) {
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

// ─── Enveloppes d'affichage : TFT / QR sur la PILE DE TRAVAIL dédiée (podWorkRun, 2 048 o, garde + marge contrôlées) ───────────────────────
static void __attribute__((noinline)) tftWorkFailed(const char* what, const PodNetInfo& ni) {
  if (ni.err == POD_NET_GUARD) logfSafeStop();                    // garde écrasée : le voisin au tas est corrompu — arrêt sûr silencieux AVANT tout journal
  logf("[TFT] %s : pile de travail dédiée : %s (erreur %u, marge %u o) — affichage ignoré", what, podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin);
}
static void __attribute__((noinline)) tftStatus(const String& line1, const String& line2 = "", uint16_t bg = C_NAVY) { ENV_DIRTY(); PodNetInfo ni; auto wk = [&]() { tftStatusImpl(line1, line2, bg); }; if (!podWorkRun(wk, &ni)) tftWorkFailed("tftStatus", ni); }
#if !POD_RENDER_V1
static void __attribute__((noinline)) drawCartel() { PodNetInfo ni; auto wk = [&]() { drawCartelImpl(); }; if (!podWorkRun(wk, &ni)) tftWorkFailed("drawCartel", ni); }
#endif
static void __attribute__((noinline)) displayKeyMaterialOnce() { PodNetInfo ni; auto wk = [&]() { displayKeyMaterialOnceImpl(); }; if (!podWorkRun(wk, &ni)) tftWorkFailed("clés à l'écran", ni); }
static void __attribute__((noinline)) displayOnboardingQR(const String& u, const String& c, const String& m) { PodNetInfo ni; auto wk = [&]() { displayOnboardingQRImpl(u, c, m); }; if (!podWorkRun(wk, &ni)) tftWorkFailed("QR d'appairage", ni); }
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
  PodNetInfo ni;                                     // POD_NET_STACK : la transaction tourne sur la pile réseau dédiée
  auto tx = [&]() {
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
  };
  const bool ran = podNetRun(tx, &ni);
  if (!ran) { shown = false; noFrame = false; logf("[FRAME] pile réseau dédiée : %s (erreur %u, marge %u o) — pas d'ACK ; l'écran a pu être partiellement ou totalement redessiné", podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin); }
  if (noFrame) { logf("[FRAME] pas de frame disponible"); return true; }
  if (!shown) { logf("[FRAME] image incomplète — pas d'ACK, nouvel essai au prochain pull"); return false; }

#if POD_RENDER_V1
  logf("[RENDER] calculé ET remis au TFT — mode=%u frameHash=%s renderHash=%s", (unsigned)POD_RENDER_MODE_DEFAULT, g_podFrameHex, g_podRenderHex);   // le cartel fait partie de l'image rendue
#else
  drawCartel();
#endif
  lastFrameId = frameId;                              // RAM seulement : après reboot le TFT doit être repeint
  ENV_ART_SHOWN();                                    // station : l'œuvre reste ENV_PAGE_MS à l'écran avant que les pages mesures / animation reprennent
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
// NETSTACK-WIFI-CALLS-FIX1 : chiffre hexadécimal minuscule (MAC « aa:bb:cc:dd:ee:ff » dans un char[18], sans snprintf)
static char macHexDigit(uint8_t v) { return (char)(v < 10 ? '0' + v : 'a' + (v - 10)); }
// L'adresse MAC vient du module Wi-Fi (pile dédiée, wifiMac) ; échec → chaîne VIDE : doRegister n'inscrit pas.
static String macString() {
  uint8_t m[6] = {0};
  if (!wifiMac(m)) return String();
  char b[18];
  for (uint8_t i = 0; i < 6; i++) { b[3 * i] = macHexDigit(m[i] >> 4); b[3 * i + 1] = macHexDigit(m[i] & 15); b[3 * i + 2] = (i < 5) ? ':' : '\0'; }
  return String(b);
}

enum RegisterStatus : uint8_t { REG_P_NONE = 0, REG_P_OK = 1, REG_P_JSON = 2, REG_P_INVALID = 3 };
struct RegisterParsed {
  uint8_t status;                  // RegisterStatus : exploitable seulement pour REG_P_OK
  bool paired;
  const char* jsonErr;             // texte statique de DeserializationError (REG_P_JSON)
  char deviceId[13];               // 12 caractères + NUL
  char pairCode[9];                // 8 caractères + NUL, ou vide (appairé, code absent)
  RegisterParsed() : status(REG_P_NONE), paired(false), jsonErr(nullptr) { deviceId[0] = 0; pairCode[0] = 0; }
};
static bool __attribute__((noinline)) regDeviceIdOk(const char* s) {
  if (strlen(s) != 12 || s[0] != 'd' || s[1] != 'e' || s[2] != 'v' || s[3] != '_') return false;
  for (uint8_t i = 4; i < 12; i++) if (!((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return false;
  return true;
}
static bool __attribute__((noinline)) regPairCodeOk(const char* s) {
  static const char* const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  if (strlen(s) != 8) return false;
  for (uint8_t i = 0; i < 8; i++) if (strchr(ALPHA, s[i]) == nullptr) return false;
  return true;
}
// Exécutée SUR LA PILE DE TRAVAIL (voir registerParseOnWorkStack). Ne touche à AUCUN état global : tout va dans r.
static void __attribute__((noinline)) registerParseWork(const String& resp, RegisterParsed& r) {
  JSON_DOC(doc, 768);
  const DeserializationError err = deserializeJson(doc, resp, DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING));
  if (err) { r.jsonErr = err.c_str(); r.status = REG_P_JSON; return; }
  const char* id = doc["deviceId"] | "";
  const char* pc = doc["pairCode"] | "";
  const bool isPaired = doc["paired"] | false;
  if (!regDeviceIdOk(id)) { r.status = REG_P_INVALID; return; }
  if (pc[0] != '\0' ? !regPairCodeOk(pc) : !isPaired) { r.status = REG_P_INVALID; return; }
  memcpy(r.deviceId, id, 12); r.deviceId[12] = '\0';
  if (pc[0] != '\0') { memcpy(r.pairCode, pc, 8); r.pairCode[8] = '\0'; }
  r.paired = isPaired;
  r.status = REG_P_OK;
}
static bool __attribute__((noinline)) registerParseOnWorkStack(const String& resp, RegisterParsed& r, PodNetInfo& ni) {
  auto rk = [&]() { registerParseWork(resp, r); };
  return podWorkRun(rk, &ni);
}
// Échec de la pile de travail : rien n'est inscrit. GUARD => le tas voisin peut être corrompu (logf alloue) : arrêt sûr silencieux AVANT tout journal.
static void __attribute__((noinline)) registerWorkFailed(const PodNetInfo& ni) {
  if (ni.err == POD_NET_GUARD) logfSafeStop();
  logf("[REGISTER] analyse JSON sur la pile de travail ECHOUEE (err %u) : %s ; inscription rejetée, rien n'est inscrit", (unsigned)ni.err, podNetWhy(ni));
}
// Décodage + inscription de l'état, dans cet ordre, APRÈS le retour de httpCall. Retour : true = réponse complète et valide, état inscrit ; false = rien n'a changé.
static bool __attribute__((noinline)) doRegisterDecode(const String& resp) {
  RegisterParsed* const r = new (std::nothrow) RegisterParsed();
  if (!r) { logf("[REGISTER] réponse rejetée : mémoire insuffisante"); return false; }
  PodNetInfo ni;
  const bool ran = registerParseOnWorkStack(resp, *r, ni);
  bool ok = false;
  if (!ran) registerWorkFailed(ni);
  else if (r->status == REG_P_JSON) logf("[REGISTER] JSON illisible: %s", r->jsonErr);
  else if (r->status != REG_P_OK) logf("[REGISTER] réponse rejetée : deviceId ou code d'appairage absent, trop court, trop long ou invalide");
  else { deviceId = r->deviceId; pairCode = r->pairCode; paired = r->paired; registered = true; ok = true; }
  delete r;
  return ok;
}


#if POD_SENSORS
#define SENSORS_JSON ",\"sensors\":[\"temp\",\"hum\",\"voc\",\"rssi\",\"lat\",\"dl\"]"
#else
#define SENSORS_JSON ""
#endif
static bool doRegister() {
  const String mac = macString();
  if (mac.length() == 0) { logf("[REGISTER] adresse MAC indisponible (module Wi-Fi, pile dédiée) : inscription ANNULÉE"); return false; }
  const String body = "{\"mac\":\"" + mac + "\",\"screens\":[\"" SCREEN_TYPE "\"],"
                      "\"firmware\":\"" FIRMWARE_VERSION "\","
                      "\"publicKey\":\"" + (keysLoaded ? bytesToHex(publicKey, 32) : String("")) + "\","
                      "\"ownedHashes\":" + loadOwnedHashesJson() +
                      SENSORS_JSON "}";
  String resp;
  if (httpCall("POST", "/api/register", &body, resp) != 200) { logf("[REGISTER] échec — nouvel essai dans 5 s"); return false; }
  if (!doRegisterDecode(resp)) return false;
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
#define PULL_ID_MAX     64
#define PULL_SRC_MAX    16
#define PULL_TITLE_MAX  255
#define PULL_ARTIST_MAX 127
#define PULL_TS_MAX     63
#define PULL_OBS_MAX    8
#include <new>
enum PullStatus : uint8_t { PULL_P_NONE = 0, PULL_P_OK = 1, PULL_P_RATE = 2, PULL_P_JSON = 3, PULL_P_BOUNDS = 4, PULL_P_HEAP = 5 };
struct PullParsed {
  uint8_t status;                  // PullStatus : le résultat n'est exploitable que pour PULL_P_OK et PULL_P_RATE
  bool hasCartel, hasObs;
  int blockIndex, retryAfter, cartelBlockIndex, rateRetrySec;
  const char* jsonErr;             // texte statique de DeserializationError (PULL_P_JSON)
  String blockHash, candId, frameSource, frameId, workTitle, artistName, displayTs, obsHashes, obsTarget, owned;
  PullParsed() : status(PULL_P_NONE), hasCartel(false), hasObs(false), blockIndex(-1), retryAfter(60), cartelBlockIndex(-1), rateRetrySec(60), jsonErr(nullptr) {}
};
// copie bornée d'un identifiant : au-delà de max => PULL_P_BOUNDS ; copie incomplète (tas) => PULL_P_HEAP
static bool __attribute__((noinline)) pullSetId(String& dst, const char* src, size_t max, PullParsed& r) {
  const size_t n = strlen(src);
  if (n > max) { r.status = PULL_P_BOUNDS; return false; }
  dst = "";
  if (n > 0 && !dst.concat(src, (unsigned int)n)) { r.status = PULL_P_HEAP; return false; }
  if (dst.length() != n) { r.status = PULL_P_HEAP; return false; }
  return true;
}
// copie d'un texte de cartel, TRONQUÉE à une frontière de caractère UTF-8 au-delà de max
static bool __attribute__((noinline)) pullSetText(String& dst, const char* src, size_t max, PullParsed& r) {
  size_t n = strlen(src);
  if (n > max) { n = max; while (n > 0 && (((uint8_t)src[n]) & 0xC0) == 0x80) n--; }
  dst = "";
  if (n > 0 && !dst.concat(src, (unsigned int)n)) { r.status = PULL_P_HEAP; return false; }
  if (dst.length() != n) { r.status = PULL_P_HEAP; return false; }
  return true;
}
// Exécutée SUR LA PILE DE TRAVAIL (voir pullParseOnWorkStack). Ne touche à AUCUN état global : tout va dans r.
static void __attribute__((noinline)) pullParseWork(const String& resp, int code, PullParsed& r) {
  if (code == 429) {
    JSON_DOC(rate, 256);
    r.rateRetrySec = 60;
    if (deserializeJson(rate, resp, DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING)) == DeserializationError::Ok) r.rateRetrySec = max(1, (int)(rate["retryAfter"] | 60));
    r.status = PULL_P_RATE;
    return;
  }
  JSON_DOC(doc, 2048);
  const DeserializationError err = deserializeJson(doc, resp, DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING));
  if (err) { r.jsonErr = err.c_str(); r.status = PULL_P_JSON; return; }

  JsonObject chain = doc["chain"];
  if (!chain.isNull()) { if (!pullSetId(r.blockHash, chain["blockHash"] | "", PULL_ID_MAX, r)) return; r.blockIndex = chain["blockIndex"] | -1; }
  JsonObject pend = doc["pendingValidation"];
  if (!pend.isNull() && !pullSetId(r.candId, pend["candidateId"] | "", PULL_ID_MAX, r)) return;

  if (!pullSetId(r.frameSource, doc["frameSource"] | "none", PULL_SRC_MAX, r)) return;
  if (!pullSetId(r.frameId, doc["frameId"] | "", PULL_ID_MAX, r)) return;
  r.retryAfter = doc["retryAfter"] | 60;
  if (r.retryAfter <= 0) r.retryAfter = 60;
  if (r.frameId.length() == 0) { JsonObject fo = doc["frame"]; if (!fo.isNull() && !pullSetId(r.frameId, fo["frameId"] | "", PULL_ID_MAX, r)) return; }

  JsonObject cm = doc["cartelMeta"];
  if (!cm.isNull()) {
    r.hasCartel = true;
    if (!pullSetText(r.workTitle, cm["workTitle"] | "", PULL_TITLE_MAX, r)) return;
    if (!pullSetText(r.artistName, cm["drawArtistName"] | "", PULL_ARTIST_MAX, r)) return;
    if (!pullSetText(r.displayTs, cm["displayTs"] | "", PULL_TS_MAX, r)) return;
    r.cartelBlockIndex = cm["blockIndex"] | r.cartelBlockIndex;
  }
  JsonObject obs = doc["pendingObservation"];
  if (!obs.isNull()) {
    JsonArray hArr = obs["blockHashes"].as<JsonArray>();
    if (hArr.size() > 0) {
      if (hArr.size() > PULL_OBS_MAX) { r.status = PULL_P_BOUNDS; return; }
      String arr = "[";
      size_t want = 1;
      for (size_t i = 0; i < hArr.size(); i++) {
        const String h = hArr[i].as<String>();                 // conversion JsonVariant -> String : la chaîne la plus profonde (584 o), sur la pile de travail
        if (h.length() > PULL_ID_MAX) { r.status = PULL_P_BOUNDS; return; }
        if (i) { arr += ","; want += 1; }
        arr += "\""; arr += h; arr += "\"";
        want += h.length() + 2;
      }
      arr += "]"; want += 1;
      if (arr.length() != want) { r.status = PULL_P_HEAP; return; }
      r.obsHashes = arr;
      if (r.obsHashes.length() != want) { r.status = PULL_P_HEAP; return; }
      if (!pullSetId(r.obsTarget, obs["targetBlockHash"] | "", PULL_ID_MAX, r)) return;
      r.hasObs = true;
    }
  }
  if (!pullSetId(r.owned, doc["ownedBlock"] | "", PULL_ID_MAX, r)) return;
  r.status = PULL_P_OK;
}
// Lanceur : la fermeture et son PodNetInfo ne vivent que le temps de l'appel (noinline : cadre rendu avant la suite de doPull)
static bool __attribute__((noinline)) pullParseOnWorkStack(const String& resp, int code, PullParsed& r, PodNetInfo& ni) {
  auto wk = [&]() { pullParseWork(resp, code, r); };
  return podWorkRun(wk, &ni);
}
// Échec de la pile de travail (NOMEM, NESTED, GUARD, MARGIN) : rien n'est appliqué. GUARD = garde écrasée => le tas voisin peut être corrompu (logf alloue) : arrêt sûr silencieux AVANT tout journal.
static void __attribute__((noinline)) pullWorkFailed(const PodNetInfo& ni) {
  if (ni.err == POD_NET_GUARD) logfSafeStop();
  logf("[PULL] analyse JSON sur la pile de travail ECHOUEE (err %u) : %s ; pull rejeté, rien n'est appliqué", (unsigned)ni.err, podNetWhy(ni));
}

// Analyse + application, dans cet ordre (la réponse est DÉJÀ reçue, TLS fermé). Retour : 0 = pull ÉCHOUÉ (rien d'appliqué) ; 1 = pull appliqué, décision de frame à prendre ; 2 = terminé (429, rien d'autre à faire).
static int __attribute__((noinline)) doPullApply(PullParsed& r, const String& resp, int code, String& frameId, String& frameSource) {
  r.cartelBlockIndex = currentBlockIndex;
  PodNetInfo ni;
  const bool ran = pullParseOnWorkStack(resp, code, r, ni);
  if (!ran) { pullWorkFailed(ni); return 0; }
  if (r.status == PULL_P_RATE) {
    unsigned long retryMs = (unsigned long)r.rateRetrySec * 1000UL;
    if (retryMs > PULL_INTERVAL) retryMs = PULL_INTERVAL;
    lastPullMs = millis() - (PULL_INTERVAL - retryMs);
    logf("[PULL] 429 retryAfter=%ds", r.rateRetrySec);
    return 2;
  }
  if (r.status == PULL_P_JSON) { logf("[PULL] JSON: %s", r.jsonErr); return 0; }
  if (r.status != PULL_P_OK) { logf("[PULL] réponse rejetée : %s", r.status == PULL_P_BOUNDS ? "champ hors bornes" : "mémoire insuffisante"); return 0; }

  if (r.hasCartel) {
    pendingWorkTitle = r.workTitle; pendingArtistName = r.artistName; pendingDisplayTs = r.displayTs; currentBlockIndex = r.cartelBlockIndex;
    logf("[PULL] cartel: %s / %s (bloc %d)", asciiFold(pendingWorkTitle).c_str(), asciiFold(pendingArtistName).c_str(), currentBlockIndex);
  }
  if (r.hasObs) { pendingObsHashes = r.obsHashes; pendingObsTarget = r.obsTarget; }
  if (r.owned.length() >= 16) saveOwnedBlockHash(r.owned);

  nextPullIntervalMs = (r.frameSource == "none" && r.candId.length() == 0) ? (unsigned long)r.retryAfter * 1000UL : PULL_INTERVAL;
  if (r.blockHash.length() > 0 && r.blockHash != currentBlockHash) {
    currentBlockHash = r.blockHash; currentBlockIndex = r.blockIndex;
    saveBlockHashToEEPROM(currentBlockHash);
    logf("[PULL] nouveau bloc #%d", currentBlockIndex);
  }
  if (r.candId.length() > 0) pendingCandidateId = r.candId;
  frameId = r.frameId; frameSource = r.frameSource;
  return 1;
}
// La grosse structure PullParsed vit au TAS (pile principale : 1 024 o), le temps d'un pull ; échec de l'allocation => pull rejeté. Aucune structure volumineuse dans les cadres de doPull ni de doFetchFrame.
static int __attribute__((noinline)) doPullStage(const String& resp, int code, String& frameId, String& frameSource) {
  PullParsed* const r = new (std::nothrow) PullParsed();
  if (!r) { logf("[PULL] réponse rejetée : mémoire insuffisante"); return 0; }
  const int rc = doPullApply(*r, resp, code, frameId, frameSource);
  delete r;
  return rc;
}

static bool doPull() {
  String newFrameId = "", newFrameSource = "none";
  int st = 0;
  {
    String resp;
    const int code = httpCall("GET", "/api/pull?deviceId=" + deviceId, nullptr, resp);
    if (code != 429 && code != 200) { logf("[PULL] erreur HTTP %d", code); return false; }
    st = doPullStage(resp, code, newFrameId, newFrameSource);
  }                                                  // resp libérée ici, avant toute image
  if (st == 0) return false;
  if (st == 2) return true;

  if (newFrameSource == "none" || newFrameId.length() == 0) { logf("[PULL] aucune frame");
  return true; }
  if (newFrameId == lastFrameId) { logf("[PULL] frame déjà affichée"); return true; }
  logf("[PULL] nouvelle frame %s (%s)", newFrameId.c_str(), newFrameSource.c_str());

  doFetchFrame(newFrameId, newFrameSource);          // échec : on retourne quand même true (pas de boucle pull→échec→pull)
  reportMem("après pull");
  return true;
}

// ─── VALIDATION RÉELLE (vote v2) — ⚠ NON TESTÉE SUR LA CARTE ─────────────
static uint8_t g_voteChunk[256];
static uint8_t g_voteScratch[4736];   // tampon de l'OLED (1 024 o) et de l'e-ink 2,9" (4 736 o) : un candidat de N'IMPORTE QUEL écran est relu (le serveur ne l'oblige pas à voter pour son type)

// POD_NET_STACK : lecture du candidat sur la pile réseau dédiée. Fonction à part (noinline) : ses variables ne vivent que pendant la transaction, FERMÉE avant la signature (jamais imbriquée dans PodEd),
// et ne gonflent pas le cadre de doValidate, qui porte ensuite l'appel de signature. Échec de la pile dédiée : chk remis à zéro (chk.ok = false) → « calcul impossible », pas de vote.
static void __attribute__((noinline)) netReadCandidate(const String& candidateId, PodScreenKind kind, size_t bytes, PodCheck& chk) {
  PodNetInfo ni;
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", String("/api/candidate-frame?candidateId=") + candidateId, nullptr);
    chk.http = code;
    if (code == 200) podCheckStream(c.rd, kind, bytes, g_voteScratch, sizeof(g_voteScratch), g_voteChunk, sizeof(g_voteChunk), &chk);
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  if (!ran) { memset(&chk, 0, sizeof(chk)); logf("[VALIDATE2] pile réseau dédiée : %s (erreur %u, marge %u o) — pas de vote", podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin); }
}

static bool doValidateV2(const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash) {
  PodScreenKind kind;
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

// ─── VALIDATION ──────────────────────────────────────────────────────────�
enum ValidateStatus : uint8_t { VAL_P_NONE = 0, VAL_P_OK = 1, VAL_P_JSON = 2, VAL_P_INVALID = 3 };
struct ValidateParsed {
  uint8_t status;                  // ValidateStatus : exploitable seulement pour VAL_P_OK
  bool skip, hasV2;                // skip = déjà voté / pas de candidat / identifiant vide (rien à faire)
  int bytes;
  float score;
  const char* jsonErr;             // texte statique de DeserializationError (VAL_P_JSON)
  char candidateId[65];
  char screen[17];
  char hash[65];
  ValidateParsed() : status(VAL_P_NONE), skip(false), hasV2(false), bytes(0), score(0.5f), jsonErr(nullptr) { candidateId[0] = 0; screen[0] = 0; hash[0] = 0; }
};
static bool __attribute__((noinline)) valCharsOk(const char* s, size_t minLen, size_t maxLen, const char* alphabetKind) {
  const size_t n = strlen(s);
  if (n < minLen || n > maxLen) return false;
  for (size_t i = 0; i < n; i++) {
    const char c = s[i];
    const bool digit = (c >= '0' && c <= '9'), lower = (c >= 'a' && c <= 'z'), upper = (c >= 'A' && c <= 'Z');
    switch (alphabetKind[0]) {
      case 'i': if (!(digit || lower || upper || c == '-')) return false; break;      // identifiant : [0-9A-Za-z-]
      case 'e': if (!(digit || lower || c == '_')) return false; break;               // écran : [a-z0-9_]
      default:  if (!(digit || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false; break;   // hexadécimal
    }
  }
  return true;
}
// Exécutée SUR LA PILE DE TRAVAIL (voir validateParseOnWorkStack). Ne touche à AUCUN état global : tout va dans r.
static void __attribute__((noinline)) validateParseWork(const String& resp, ValidateParsed& r) {
  JSON_DOC(doc, 768);   // 512 avant la validation réelle : la réponse porte aussi { v2: écran, taille, hash } (≈ 110 o)
  const DeserializationError err = deserializeJson(doc, resp, DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING));
  if (err) { r.jsonErr = err.c_str(); r.status = VAL_P_JSON; return; }
  if ((doc["alreadyVoted"] | false) || doc["candidate"].isNull()) { r.skip = true; r.status = VAL_P_OK; return; }
  JsonObject cand = doc["candidate"];
  const char* cid = cand["candidateId"] | "";
  if (cid[0] == '\0') { r.skip = true; r.status = VAL_P_OK; return; }
  if (!valCharsOk(cid, 8, 64, "i")) { r.status = VAL_P_INVALID; return; }
  if (!cand["v2"].isNull()) {
    const char* sc = cand["v2"]["screen"] | "";
    const int b = cand["v2"]["bytes"] | 0;
    const char* h = cand["v2"]["hash"] | "";
    if (!valCharsOk(sc, 1, 16, "e") || !valCharsOk(h, 64, 64, "h") || b < 1 || b > 262144) { r.status = VAL_P_INVALID; return; }
    memcpy(r.screen, sc, strlen(sc) + 1); memcpy(r.hash, h, 65); r.bytes = b; r.hasV2 = true;
  } else {
    r.score = cand["score_server"] | 0.5f;
  }
  memcpy(r.candidateId, cid, strlen(cid) + 1);
  r.status = VAL_P_OK;
}
static bool __attribute__((noinline)) validateParseOnWorkStack(const String& resp, ValidateParsed& r, PodNetInfo& ni) {
  auto vk = [&]() { validateParseWork(resp, r); };
  return podWorkRun(vk, &ni);
}
// Échec de la pile de travail : aucun vote. GUARD => le tas voisin peut être corrompu (logf alloue) : arrêt sûr silencieux AVANT tout journal.
static void __attribute__((noinline)) validateWorkFailed(const PodNetInfo& ni) {
  if (ni.err == POD_NET_GUARD) logfSafeStop();
  logf("[VALIDATE] analyse JSON sur la pile de travail ECHOUEE (err %u) : %s ; aucun vote", (unsigned)ni.err, podNetWhy(ni));
}
// Décodage de la réponse, APRÈS le retour de httpCall. Retour : 0 = rien à voter (déjà voté, pas de candidat, réponse refusée, échec de pile) ; 1 = validation RÉELLE (v2) ; 2 = ancien chemin (v1, score du serveur).
// Les paramètres de sortie ne sont écrits QUE dans les deux branches valides.
static int __attribute__((noinline)) doValidateDecode(const String& resp, String& candidateId, String& v2screen, size_t& v2bytes, String& v2hash, float& score) {
  ValidateParsed* const r = new (std::nothrow) ValidateParsed();
  if (!r) { logf("[VALIDATE] réponse rejetée : mémoire insuffisante"); return 0; }
  PodNetInfo ni;
  const bool ran = validateParseOnWorkStack(resp, *r, ni);
  int mode = 0;
  if (!ran) validateWorkFailed(ni);
  else if (r->status == VAL_P_JSON) logf("[VALIDATE] JSON illisible: %s", r->jsonErr);
  else if (r->status != VAL_P_OK) logf("[VALIDATE] réponse rejetée : identifiant, écran, hash ou taille absent, hors bornes ou invalide");
  else if (r->skip) mode = 0;
  else if (r->hasV2) { candidateId = r->candidateId; v2screen = r->screen; v2hash = r->hash; v2bytes = (size_t)r->bytes; mode = 1; }
  else { candidateId = r->candidateId; score = r->score; mode = 2; }
  delete r;
  return mode;
}

static bool doValidate() {
  if (pendingCandidateId.length() == 0) return false;
  String candidateId, v2screen, v2hash;
  size_t v2bytes = 0;
  float score = 0.5f;
  int mode = 0;
  {
    String resp;
    if (httpCall("GET", "/api/validate-candidate?deviceId=" + deviceId, nullptr, resp) != 200 || resp.length() == 0) { pendingCandidateId = ""; return false; }
    mode = doValidateDecode(resp, candidateId, v2screen, v2bytes, v2hash, score);
  }                                                  // resp libérée ici, avant la lecture du candidat, la signature et le vote
  if (mode == 0) { pendingCandidateId = ""; return false; }
  // Validation RÉELLE : si le serveur annonce { v2 }, on revérifie le contenu au lieu de recopier son score (anciens serveurs / animations : chemin v1 ci-dessous).
  if (mode == 1) { pendingCandidateId = ""; return doValidateV2(candidateId, v2screen, v2bytes, v2hash); }

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

#if POD_SENSORS
// ─── CAPTEURS (DHT22 + SGP40) — repris de pod_uno_r4_station (r4env-1.1) ─────────────────────────────────
#define SPEED_PATH  "/speedtest.bin"
#define SPEED_BYTES 4096UL
static uint32_t __attribute__((noinline)) netSpeedTest() {
  uint32_t kbps = 0; PodNetInfo ni;
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", SPEED_PATH, nullptr);
    if (code == 200 && (c.rd.contentLength() < 0 || c.rd.contentLength() == (long)SPEED_BYTES)) {
      const unsigned long t0 = millis();
      size_t total = 0;
      while (total < SPEED_BYTES) {
        const size_t want = (SPEED_BYTES - total) < sizeof(g_body) ? (SPEED_BYTES - total) : sizeof(g_body);
        const size_t r = c.rd.readBody((uint8_t*)g_body, want);
        if (r == 0) break;
        total += r;
      }
      const unsigned long dt = millis() - t0;
      if (total == SPEED_BYTES && c.client.fault() == 0 && dt > 0) { kbps = (uint32_t)((SPEED_BYTES * 8UL) / dt); if (kbps == 0) kbps = 1; }
    }
    c.client.stop();
  };
  if (!podNetRun(tx, &ni)) return 0;
  return kbps;
}

static unsigned long g_lastLatMs = 0;                      // durée du dernier POST /api/sensor réussi (joint à l'envoi suivant)

// ─── LECTURES EN TAMPON, ENVOI GROUPÉ ──────────────────────────────────────
// La température est LUE toutes les 30 min (48 points/jour) mais ENVOYÉE une fois par heure, plusieurs lectures par POST : même coût Redis qu'une mesure horaire (8 commandes par envoi,
// quel que soit le nombre de lectures). Les lectures restent en RAM (12 au plus = 6 h) tant que l'envoi n'a pas réussi : une coupure Internet ne fait plus perdre de points.
// Chaque lecture porte son ÂGE à l'envoi (le serveur calcule l'heure : la carte n'a pas d'horloge). Un redémarrage de la carte perd les lectures non envoyées (RAM).
#define RING_MAX 12
#define NO_T   ((int16_t)-32768)
#define NO_H   ((uint16_t)0xFFFF)
struct Reading { uint32_t tMs; int16_t c10; uint16_t h10; uint16_t voc; };   // température absente : NO_T ; humidité absente : NO_H ; gaz absent : 0
static Reading g_ring[RING_MAX];
static uint8_t g_n = 0;                                    // lectures en attente, la plus ANCIENNE en premier
static uint32_t g_posts = 0;                               // nombre d'envois (cadence du test de débit)

static void pushReading(int16_t c10, uint16_t h10, uint16_t voc) {
  if (g_n == RING_MAX) { for (uint8_t i = 1; i < RING_MAX; i++) g_ring[i - 1] = g_ring[i]; g_n = RING_MAX - 1; }   // tampon plein : la plus ancienne est abandonnée
  g_ring[g_n].tMs = millis(); g_ring[g_n].c10 = c10; g_ring[g_n].h10 = h10; g_ring[g_n].voc = voc; g_n++;
}

// Dernières valeurs lues (affichage local + compensation du SGP40)
static int16_t  g_lastT = NO_T;
static uint16_t g_lastH = NO_H, g_lastVoc = 0;
static int32_t  g_rssi = 0;
static unsigned long g_lastSendMs = 0, g_lastReadAtMs = 0;
static bool g_sendOk = false, g_sgpSeen = false;

/** Lit le SGP40 (compensé par la dernière mesure DHT22) : 12 mesures à 1 Hz, retient la dernière. 0 = capteur absent / illisible. Le bus I2C est exercé SUR LA PILE DE TRAVAIL (la pile principale ne fait que 1 024 o). */
static uint16_t __attribute__((noinline)) readSgp40() {
  uint16_t raw = 0; bool any = false; PodNetInfo ni;
  const int h10 = (g_lastH == NO_H) ? 500 : (int)g_lastH, t10 = (g_lastT == NO_T) ? 250 : (int)g_lastT;
  auto wk = [&]() {
    for (uint8_t i = 0; i < SGP_WARMUP_SAMPLES; i++) {
      uint16_t v = 0;
      if (sgp40Measure(h10, t10, v)) { raw = v; any = true; } else if (i == 0) return;   // rien à la première : capteur absent, inutile d'attendre 12 s
      delay(965);
    }
  };
  if (!podWorkRun(wk, &ni)) { logf("[SGP40] pile de travail indisponible (%s) : mesure abandonnée", podNetWhy(ni)); return 0; }
  return any ? raw : 0;
}

/** Lit le DHT22 et le SGP40 et met la lecture en tampon. true = au moins une grandeur lue. */
static bool takeReading() {
  int16_t c10 = NO_T; uint16_t h10 = NO_H;
  int16_t tt = 0; uint16_t hh = 0;
  bool dhtOk = false;
#ifndef POD_NO_DHT
  dhtOk = dht22Read(DHT_PIN, tt, hh);
#endif
  if (dhtOk) { c10 = tt; h10 = hh; g_lastT = tt; g_lastH = hh; logf("[DHT22] %d.%d C, %u.%u %%", (int)(tt / 10), (int)(tt < 0 ? -(tt % 10) : tt % 10), (unsigned)(hh / 10), (unsigned)(hh % 10)); }
  else logf("[DHT22] lecture impossible (câblage D2 ? alimentation ? ordre des broches ?)");
#ifdef POD_NO_SGP
  const uint16_t voc = 0;
#else
  const uint16_t voc = readSgp40();
#endif
  if (voc) { g_lastVoc = voc; g_sgpSeen = true; logf("[SGP40] %u ticks (brut ; plus bas = plus de gaz)", (unsigned)voc); }
  else logf("[SGP40] lecture impossible (câble Grove sur SDA/SCL ? adresse 0x59 ?)");
  if (c10 == NO_T && h10 == NO_H && voc == 0) return false;
  pushReading(c10, h10, voc);
  g_lastReadAtMs = millis();
  return true;
}

/** Envoie les lectures en tampon (+ diagnostic de la liaison). true = reçues et stockées par le serveur (tampon vidé). */
static bool doPost() {
  // Diagnostic de la liaison, joint à l'envoi (aucune requête de plus sauf le test de débit, un fichier statique du CDN) : signal reçu, temps de réponse du DERNIER envoi, débit
  int32_t rssi = 0; const bool haveRssi = wifiRssi(rssi) && rssi < 0 && rssi >= -127;
  if (haveRssi) g_rssi = rssi;
  uint32_t dl = 0;
  if ((g_posts % SPEED_EVERY_N_POSTS) == 0) {
    dl = netSpeedTest();
    if (dl > 0) logf("[DEBIT] %lu kbit/s (test de %lu o)", (unsigned long)dl, (unsigned long)SPEED_BYTES); else logf("[DEBIT] test impossible (l'envoi part sans débit)");
  }
  String r = "[";
  const unsigned long nowMs = millis();
  for (uint8_t i = 0; i < g_n; i++) {
    const unsigned long ageS = (nowMs - g_ring[i].tMs) / 1000UL;      // millis() non signé : exact même après le dépassement des 49 jours
    if (i) r += ",";
    r += "{\"a\":" + String((unsigned)ageS);
    if (g_ring[i].c10 != NO_T) r += ",\"temp\":" + String((int)g_ring[i].c10);
    if (g_ring[i].h10 != NO_H) r += ",\"hum\":" + String((unsigned)g_ring[i].h10);
    if (g_ring[i].voc != 0) r += ",\"voc\":" + String((unsigned)g_ring[i].voc);
    r += "}";
  }
  r += "]";
  String m = "{";
  bool first = true;
  if (haveRssi) { m += "\"rssi\":" + String((int)rssi); first = false; }
  if (g_lastLatMs > 0 && g_lastLatMs <= 60000UL) { m += String(first ? "" : ",") + "\"lat\":" + String((unsigned)g_lastLatMs); first = false; }
  if (dl > 0 && dl <= 1000000UL) { m += String(first ? "" : ",") + "\"dl\":" + String((unsigned)dl); first = false; }
  m += "}";
  String body = "{\"deviceId\":\"" + deviceId + "\",\"pairCode\":\"" + pairCode + "\",\"r\":" + r;
  if (!first) body += ",\"m\":" + m;
  body += "}";
  String resp;
  const unsigned long tPost = millis();
  const int code = httpCall("POST", "/api/sensor", &body, resp);
  if (code == 200) {
    g_lastLatMs = millis() - tPost;
    if (resp.indexOf("\"stored\":true") >= 0) { logf("[SENSOR] %u lecture(s) envoyée(s) et stockée(s)", (unsigned)g_n); g_n = 0; g_posts++; return true; }
    logf("[SENSOR] envoi refusé par l'anti-rafale du serveur (trop tôt après le précédent) : les %u lecture(s) restent en attente", (unsigned)g_n);
    return false;
  }
  if (code == 403) { logf("[SENSOR] refusé (403) : code d'appairage changé, capteur supprimé ou non appairé — nouvelle inscription (lectures conservées)"); registered = false; paired = false; return false; }
  if (code == 404) logf("[SENSOR] 404 : la route /api/sensor n'existe pas sur ce serveur (site pas encore déployé avec le capteur ?)");
  logf("[SENSOR] échec (%d) — %u lecture(s) conservée(s), nouvel essai dans 5 min", code, (unsigned)g_n);
  return false;
}


static unsigned long g_lastReadMs = 0, g_nextReadDelayMs = 0, g_lastPostMs = 0, g_nextPostDelayMs = 0;
static bool g_firstRead = true, g_firstPost = true;
/** Lectures et envois des capteurs : indépendants du pull et du vote. L'envoi exige un appareil appairé (code d'appairage). */
static void __attribute__((noinline)) sensorsTick() {
  if (g_firstRead || millis() - g_lastReadMs >= g_nextReadDelayMs) {
    const bool ok = takeReading();
    g_firstRead = false; g_lastReadMs = millis();
    g_nextReadDelayMs = ok ? READ_INTERVAL_MS : SENSOR_RETRY_MS;
  }
  if (paired && g_n > 0 && (g_firstPost || millis() - g_lastPostMs >= g_nextPostDelayMs)) {
    const bool ok = doPost();
    g_firstPost = false; g_lastPostMs = millis();
    g_nextPostDelayMs = ok ? POST_INTERVAL_MS : SENSOR_RETRY_MS;
    g_sendOk = ok; if (ok) g_lastSendMs = millis();
  }
}

#if POD_ENV_DISPLAY
// ─── Écran de station (28/10/2026) : page « mesures » ↔ page « animation » toutes les ENV_PAGE_MS ───────────────────────────────────────────
// Lectures VIVANTES, pour l'écran seulement : DHT22 toutes les 5 s, SGP40 chaque seconde (le chauffage reste allumé), RSSI toutes les 15 s. Elles n'alimentent PAS le tampon d'envoi (lecture / 30 min, envoi / h, inchangés).
// TOUT dessin passe par podWorkRun (pile de travail dédiée) ; aucun tableau, aucune String : des tampons de 12 octets et des entiers. Les œuvres reçues restent ENV_PAGE_MS à l'écran (aucune copie n'est gardée : la SD viendra).
#include <math.h>
static unsigned long g_envDhtAt = 0, g_envDhtOkAt = 0, g_envSgpAt = 0, g_envRssiAt = 0, g_envDrawAt = 0, g_envFrameAt = 0;
static int32_t g_envRssi = 0;
static uint8_t g_envFrame = 0;
static int16_t g_envRing[3];                       // rayons précédents des anneaux (animation) — −1 = rien à effacer
static int16_t g_envDot[6][2];                     // positions précédentes des points en orbite
static int16_t g_envCore = -1;

static uint16_t envColor(uint8_t r, uint8_t g, uint8_t b) { return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3); }
/** Température -> couleur : bleu (≤ 10 °C) … vert … rouge (≥ 30 °C). */
static uint16_t envTempColor() {
  int t10 = (g_lastT == NO_T) ? 220 : (int)g_lastT;
  if (t10 < 100) t10 = 100; if (t10 > 300) t10 = 300;
  const int x = (t10 - 100) * 255 / 200;           // 0..255
  if (x < 128) return envColor(0, (uint8_t)(x * 2), (uint8_t)(255 - x * 2));
  return envColor((uint8_t)((x - 128) * 2), (uint8_t)(255 - (x - 128) * 2), 0);
}
/** "-12.3" aligné à droite sur w caractères (v10 = dixièmes). */
static void envFmt10(char* o, int w, int v10) {
  char b[10]; uint8_t k = 0; const bool neg = v10 < 0; unsigned a = neg ? (unsigned)(-v10) : (unsigned)v10;
  b[k++] = (char)('0' + a % 10); b[k++] = '.'; a /= 10;
  do { b[k++] = (char)('0' + a % 10); a /= 10; } while (a && k < 8);
  if (neg) b[k++] = '-';
  int n = 0; for (int i = 0; i < w - k; i++) o[n++] = ' ';
  for (int i = k - 1; i >= 0; i--) o[n++] = b[i];
  o[n] = 0;
}
static void envFmtU(char* o, int w, unsigned v) {
  char b[10]; uint8_t k = 0;
  do { b[k++] = (char)('0' + v % 10); v /= 10; } while (v && k < 8);
  int n = 0; for (int i = 0; i < w - k; i++) o[n++] = ' ';
  for (int i = k - 1; i >= 0; i--) o[n++] = b[i];
  o[n] = 0;
}
static void envBar(int y, int pct, uint16_t col) {
  if (pct < 0) pct = 0; if (pct > 100) pct = 100;
  const int w = 120, f = w * pct / 100;
  tft.drawRect(3, y, w + 2, 7, C_GREY);
  tft.fillRect(4, y + 1, f, 5, col);
  tft.fillRect(4 + f, y + 1, w - f, 5, C_BLACK);
}
static void envDrawDataImpl(bool full) {
  const unsigned long now = millis();
  tft.setTextWrap(false);
  char b[12];
  if (full) {
    tft.fillScreen(C_BLACK);
    tft.fillRect(0, 0, IMG_W, 14, C_DARK);
    tft.setTextSize(1); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(3, 3); tft.print("PoD STATION");
    tft.setTextColor(C_GREY, C_BLACK);
    tft.setCursor(3, 18); tft.print("TEMPERATURE");
    tft.setCursor(3, 62); tft.print("HUMIDITE");
    tft.setCursor(3, 104); tft.print("AIR (brut, haut = sain)");
  }
  const bool fresh = g_envDhtOkAt != 0 && now - g_envDhtOkAt < 30000UL;
  // temperature
  tft.setTextSize(3); tft.setTextColor(fresh ? envTempColor() : C_GREY, C_BLACK); tft.setCursor(3, 29);
  if (fresh && g_lastT != NO_T) { envFmt10(b, 5, g_lastT); tft.print(b); } else tft.print("  -- ");
  tft.setTextSize(2); tft.setTextColor(C_WHITE, C_BLACK); tft.setCursor(98, 33); tft.print("C");
  // humidite
  tft.setTextSize(2); tft.setTextColor(fresh ? 0x07FF : C_GREY, C_BLACK); tft.setCursor(3, 72);
  if (fresh && g_lastH != NO_H) { envFmt10(b, 5, g_lastH); tft.print(b); tft.print("%"); } else tft.print("  -- ");
  envBar(91, (fresh && g_lastH != NO_H) ? (int)(g_lastH / 10) : 0, 0x07FF);
  // air
  tft.setTextSize(2); tft.setTextColor(g_sgpSeen ? C_WHITE : C_GREY, C_BLACK); tft.setCursor(3, 114);
  if (g_sgpSeen) { envFmtU(b, 5, g_lastVoc); tft.print(b); } else tft.print("  -- ");
  int air = 0; if (g_sgpSeen) { air = ((int)g_lastVoc - 20000) / 120; }                // 20 000 -> 0 %, 32 000 -> 100 % (indicatif, non calibré)
  envBar(133, air, air > 55 ? 0x07E0 : (air > 25 ? C_GOLD : C_RED));
  // pied
  tft.fillRect(0, 146, IMG_W, 14, C_DARK);
  tft.setTextSize(1); tft.setTextColor(C_WHITE, C_DARK); tft.setCursor(3, 150);
  if (g_envRssi < 0) { tft.print("Wi-Fi "); envFmtU(b, 0, (unsigned)(-g_envRssi)); tft.print("-"); tft.print(b); } else tft.print("Wi-Fi ?");
  tft.setTextColor(g_sendOk ? 0x07E0 : C_GREY, C_DARK); tft.setCursor(70, 150);
  if (g_sendOk) { tft.print("envoi "); envFmtU(b, 0, (unsigned)((now - g_lastSendMs) / 60000UL)); tft.print(b); tft.print("m"); } else tft.print("envoi en attente");
}
/** Une image de l'animation : 3 anneaux qui respirent (couleur = température), un coeur (couleur = humidité), 6 points en orbite (vitesse = air). Efface seulement ce qu'elle a dessiné. */
static void envDrawAnimImpl(bool full, unsigned long now) {
  const int cx = 64, cy = 78;
  if (full) {
    tft.fillScreen(C_BLACK);
    tft.fillRect(0, 0, IMG_W, 14, C_DARK);
    tft.setTextSize(1); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(3, 3); tft.print("PoD STATION");
    for (uint8_t i = 0; i < 3; i++) g_envRing[i] = -1;
    for (uint8_t i = 0; i < 6; i++) g_envDot[i][0] = -1;
    g_envCore = -1;
  }
  const float t = (float)now / 1000.0f;
  const uint16_t col = envTempColor();
  for (uint8_t i = 0; i < 3; i++) if (g_envRing[i] >= 0) tft.drawCircle(cx, cy, g_envRing[i], C_BLACK);
  for (uint8_t i = 0; i < 6; i++) if (g_envDot[i][0] >= 0) tft.fillCircle(g_envDot[i][0], g_envDot[i][1], 3, C_BLACK);
  for (uint8_t i = 0; i < 3; i++) {
    const int r = 14 + i * 13 + (int)(5.0f * sinf(t * 1.6f - (float)i * 0.9f));
    tft.drawCircle(cx, cy, r, col); g_envRing[i] = (int16_t)r;
  }
  const int core = 6 + (int)(3.0f * sinf(t * 3.2f));
  if (g_envCore != core) { tft.fillCircle(cx, cy, 11, C_BLACK); tft.fillCircle(cx, cy, core, g_lastH == NO_H ? C_GREY : envColor(0, 160, 255)); g_envCore = core; }
  const float speed = (g_sgpSeen && g_lastVoc < 24000) ? 1.8f : 0.7f;                       // air chargé : les points s'agitent
  for (uint8_t i = 0; i < 6; i++) {
    const float a = t * speed + (float)i * 1.0471976f;
    const int x = cx + (int)(54.0f * cosf(a)), y = cy + (int)(54.0f * sinf(a));
    tft.fillCircle(x, y, 3, i & 1 ? C_GOLD : C_WHITE); g_envDot[i][0] = (int16_t)x; g_envDot[i][1] = (int16_t)y;
  }
  if (g_envFrame == 0 || full) {                                                              // texte rafraîchi ~1 fois par seconde
    char b[12];
    tft.fillRect(0, 146, IMG_W, 14, C_DARK);
    tft.setTextSize(1); tft.setTextColor(C_WHITE, C_DARK); tft.setCursor(3, 150);
    if (g_lastT != NO_T) { envFmt10(b, 0, g_lastT); tft.print(b); tft.print("C "); }
    if (g_lastH != NO_H) { envFmt10(b, 0, g_lastH); tft.print(b); tft.print("% "); }
    if (g_sgpSeen) { envFmtU(b, 0, g_lastVoc); tft.print(b); }
  }
}
static void __attribute__((noinline)) envDrawData(bool full) { PodNetInfo ni; auto wk = [&]() { envDrawDataImpl(full); }; if (!podWorkRun(wk, &ni)) tftWorkFailed("page mesures", ni); }
static void __attribute__((noinline)) envDrawAnim(bool full, unsigned long now) { PodNetInfo ni; auto wk = [&]() { envDrawAnimImpl(full, now); }; if (!podWorkRun(wk, &ni)) tftWorkFailed("page animation", ni); }
/** Lectures vives (DHT22 / SGP40 / RSSI) : jamais dans une transaction réseau, jamais sur le tampon d'envoi. */
static void __attribute__((noinline)) envSample(unsigned long now) {
  if (g_envDhtAt == 0 || now - g_envDhtAt >= 5000UL) {
    int16_t tt = 0; uint16_t hh = 0; g_envDhtAt = now; if (g_envDhtAt == 0) g_envDhtAt = 1;
    if (dht22Read(DHT_PIN, tt, hh)) { g_lastT = tt; g_lastH = hh; g_envDhtOkAt = now ? now : 1; }
  }
  if (now - g_envSgpAt >= 1000UL) {
    g_envSgpAt = now; uint16_t raw = 0; bool ok = false; PodNetInfo ni;
    const int h10 = (g_lastH == NO_H) ? 500 : (int)g_lastH, t10 = (g_lastT == NO_T) ? 250 : (int)g_lastT;
    auto wk = [&]() { ok = sgp40Measure(h10, t10, raw); };
    if (podWorkRun(wk, &ni) && ok && raw) { g_lastVoc = raw; g_sgpSeen = true; }
  }
  if (now - g_envRssiAt >= 15000UL) { int32_t r = 0; g_envRssiAt = now; if (wifiRssi(r) && r < 0 && r >= -127) g_envRssi = r; }
}
static void __attribute__((noinline)) envTick() {
  const unsigned long now = millis();
  envSample(now);
  if (g_envPage == 255) {                           // une œuvre est à l'écran : on la laisse ENV_PAGE_MS
    if (now - g_envPageAtMs < ENV_PAGE_MS) return;
    g_envPage = 0; g_envFull = true; g_envPageAtMs = now;
  } else if (now - g_envPageAtMs >= ENV_PAGE_MS) {
    g_envPage ^= 1; g_envFull = true; g_envPageAtMs = now;
    logf("[ENV] page %s", g_envPage ? "animation" : "mesures");
  }
  if (g_envPage == 0) {
    if (g_envFull || now - g_envDrawAt >= 1000UL) { envDrawData(g_envFull); g_envFull = false; g_envDrawAt = now; }
  } else if (g_envFull || now - g_envFrameAt >= 50UL) {
    envDrawAnim(g_envFull, now); g_envFull = false; g_envFrameAt = now; g_envFrame = (uint8_t)((g_envFrame + 1) % 16);
  }
}
#endif
#endif
#if POD_OTA_R4
#include "pod_ota_r4_client.h"
static unsigned long g_otaNextMs = OTAR4_CHECK_FIRST_MS;
/** Une passe OTA (réseau + staging + éventuelle programmation). Bloque la boucle le temps du téléchargement (≈ 50 s pour 120 Ko). */
static void __attribute__((noinline)) otaTick(bool force) {
  if (!force && millis() < g_otaNextMs) return;
  const otar4::Result res = otar4::checkOnce(true);
  g_otaNextMs = millis() + ((res == otar4::R_NET_FAIL || res == otar4::R_STAGE_FAIL || res == otar4::R_DEFERRED_HOST || res == otar4::R_ERROR) ? OTAR4_RETRY_MS : OTAR4_CHECK_EVERY_MS);
  logf("[OTA] résultat : %s ; prochaine vérification dans %lu s", otar4::resultName(res), (unsigned long)((g_otaNextMs - millis()) / 1000UL));
}
#endif

// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
void setup() {
  paintStack();
  Serial.begin(115200);
  while (!Serial && millis() < 2500) {}
  logf("\n[BOOT] Proof-of-Draw UNO R4 WiFi + TFT 1.8\" — %s", FIRMWARE_VERSION);
  logf("[WARNING] PRODUIT R4 TFT 1,8 ENV : COMPILE SEULEMENT, JAMAIS ESSAYE SUR LA CARTE (26/10/2026)");
#if POD_SENSORS && !defined(POD_NO_WIRE_BEGIN)
  Wire.begin();
#endif
  reportMem("boot");

  pinMode(TFT_CS, OUTPUT); digitalWrite(TFT_CS, HIGH);
#if POD_SD_CS_PIN
  pinMode(POD_SD_CS_PIN, OUTPUT); digitalWrite(POD_SD_CS_PIN, HIGH);   // lecteur SD du module : muet tant qu'il n'est pas utilisé
#endif
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(0);
  tftStatus("Connexion Wi-Fi...");

  if (wifiStatusT("status (module present ?)") == WL_NO_MODULE) { logf("[WIFI] module absent"); while (true) delay(1000); }
  logf("[WIFI] firmware du module: %s", wifiFirmware().c_str());
  if (strlen(WIFI_SSID) == 0) logf("[WIFI] SSID vide : créer secrets.h (voir secrets.h.example)");
  int tries = 0;
  while (wifiStatus() != WL_CONNECTED && tries++ < 4) {
    wifiBegin();
    for (int i = 0; i < 20 && wifiStatus() != WL_CONNECTED; i++) delay(500);
  }
  if (wifiStatus() != WL_CONNECTED) { logf("[WIFI] échec — redémarrage"); tftStatus("Wi-Fi impossible", "Redemarrage...", C_RED); delay(3000); NVIC_SystemReset(); }
  logf("[WIFI] IP: %s", wifiIpString().c_str());
  tftStatus("Wi-Fi connecte", wifiIpString());

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
#if POD_OTA_R4
  otar4::setServer(OTAR4_HOST, OTAR4_PORT, OTAR4_BASE);
  otar4::confirmBoot();
#endif
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
#if POD_SENSORS && !defined(POD_NO_SENSORS_TICK)
  sensorsTick();
#endif
#if POD_OTA_R4
  if (Serial.available()) { const int ch = Serial.peek(); if (ch == 'o') { while (Serial.available()) Serial.read(); otaTick(true); } else if (ch == 'f') { while (Serial.available()) Serial.read(); otar4::dumpBlocks(); }
#if OTAR4_LAB_TEST
    else if (ch == 't') { while (Serial.available()) Serial.read(); otar4::testDownload("/logo.png"); }   // banc : TLS + staging, 10 Ko
    else if (ch >= '1' && ch <= '5') { while (Serial.available()) Serial.read(); static const char* const T[] = {"/b130.bin", "/b150.bin", "/b160.bin", "/b200.bin", "/b245.bin"}; otar4::testDownload(T[ch - '1']); }   // banc : capacité du staging du module
#endif
  }   // laboratoire : o = vérifier maintenant, f = data flash
  otaTick(false);                                  // la mise à jour ne dépend NI de l'appairage NI des capteurs
#endif

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

#if POD_ENV_DISPLAY
  envTick();
#endif
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
#if POD_ENV_DISPLAY
  delay(20);                                         // animation : ≈ 15 images / s
#else
  delay(100);
#endif
}
