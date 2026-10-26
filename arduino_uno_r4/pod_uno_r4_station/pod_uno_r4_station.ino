// pod_uno_r4_station.ino — STATION DE MONITORING (26/10/2026) : UNO R4 WiFi + DHT22 (température, humidité) + SGP40 Grove (gaz, VOC brut) + TFT 1,8″ ST7735 (relevé local en direct).
// Dérivé de pod_uno_r4_dht22 (r4dht22-1.3, VALIDÉ sur carte le 12/10/2026) : même réseau (piles dédiées, TLS borné), mêmes cadences (lecture 30 min, envoi 1 h, 8 commandes Redis par envoi), même route /api/sensor.
// Nouveautés : SGP40 (grandeur « voc » du registre lib/measures.ts) et affichage local. Cette carte n'est PAS un écran de consensus : elle s'enregistre avec screens = ["sensor"] (ni vote, ni pool, ni quorum).
// ÉTAT : COMPILÉ seulement (cœurs 1.5.3 / 1.6.0) + pilote SGP40 testé sur l'hôte. JAMAIS flashé, jamais essayé sur la carte, aucun SGP40 ni TFT branché au moment de l'écriture.
//
// CÂBLAGE (R4 = logique 5 V, broches 5 V disponibles) :
//   DHT22   VCC → 5 V · GND → GND · DATA → D2 (module 3 broches : rappel déjà monté ; DHT22 nu : 10 kΩ DATA↔VCC). ORDRE DES BROCHES VARIABLE selon le module : lire les inscriptions (+ / OUT / −).
//   SGP40   câble Grove : rouge VCC → 5 V (le module Grove accepte 3,3 V ou 5 V et adapte les niveaux) · noir GND · jaune SCL → SCL · blanc SDA → SDA (les deux broches I2C à côté de AREF, ou A5 / A4 : même bus « Wire »).
//   TFT 1,8″ ST7735 (module 8 broches) : VCC → 5 V · GND → GND · CS → D10 · RESET → D8 · A0/DC → D9 · SDA (MOSI) → D11 · SCK → D13 · LED (rétro-éclairage) → 3,3 V (via 100 Ω si la carte n'a pas de résistance) · SD_CS non utilisé.
//   D13 est l'horloge SPI du TFT : aucune LED, aucun autre périphérique dessus.
// MISE EN SERVICE : copier secrets.h.example en secrets.h · bibliothèques ArduinoJson, Adafruit GFX, Adafruit ST7735 · téléverser · moniteur série 115200 · appairer avec le code affiché (écran et série) : Mon profil → « + Ajouter un ESP ».
// MESURE GAZ : le chauffage du SGP40 met ≈ 10 s à se stabiliser : la carte prend 12 mesures à 1 Hz à chaque cycle et garde la dernière. Valeur en « ticks » (plus bas = plus de gaz), relative à la puce.
#include <Arduino.h>
#if __has_include("pod_build_flags.h")
  #include "pod_build_flags.h"   // drapeaux de BANC (IGNORÉ par git) : FIRMWARE_VERSION, POD_OTA_R4, OTAR4_TLS, OTAR4_LAB_HOST, OTAR4_LAB_PORT, OTAR4_COMPILED_SEQ, OTAR4_ALLOW_HOST, OTAR4_RETRY_MS
#endif
#include <malloc.h>
#include <stdarg.h>
#include <WiFiS3.h>
#include <ArduinoJson.h>
#include "pod_http.h"
#include "pod_ssl_bounded.h"   // client TLS à réception modem BORNÉE (240 o) : validé sur carte (e-ink 2,9″, 11/10/2026) ; indispensable pour le test de débit (4 Ko lus d'un coup = abort() avec le client du cœur)
#include "podNetStack.h"   // transactions TLS, appels au module Wi-Fi et journal sur PILES DÉDIÉES (la pile principale du cœur R4 ne fait que 1 024 o)
#include "dht22.h"
#include "sgp40.h"
#include <Wire.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <new>

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
#define SCREEN_TYPE         "sensor"               // pas un écran : voir lib/sensorData.ts
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION    "r4env-1.1"
#endif
#define DHT_PIN             2                      // D2
#define TFT_CS              10
#define TFT_DC              9
#define TFT_RST             8
#define SGP_WARMUP_SAMPLES  12                     // mesures à 1 Hz avant de retenir la valeur (chauffage de la plaque)
// CADENCES. Température et humidité : LUES toutes les 30 min (48 points/jour), ENVOYÉES toutes les heures (2 lectures par envoi : 8 commandes Redis par envoi, comme une mesure horaire).
// Diagnostic de la liaison (signal, latence, débit) : une fois par ENVOI. Le serveur refuse (sans écrire) un envoi arrivé moins de 50 min après le précédent.
#define READ_INTERVAL_MS    1800000UL              // lecture du DHT22 : 30 min
#define POST_INTERVAL_MS    3600000UL              // envoi : 1 h
#define SPEED_EVERY_N_POSTS 1                      // test de débit : tous les N envois (1 = chaque heure ; 2 = toutes les 2 h)
#define SENSOR_RETRY_MS     300000UL               // après un échec (lecture ou réseau) : nouvel essai dans 5 min
#define HTTP_TIMEOUT_MS     20000UL

// ─── MISE À JOUR À DISTANCE (OTA R4-B, 26/10/2026) — éteinte par défaut ──────────────────────────────────
// POD_OTA_R4 = 0 : AUCUN octet du client OTA n'est compilé (firmware identique à r4env-1.0 hors numéro de version et de séquence). À 1 : manifeste signé Ed25519 -> binaire brut -> staging du module ->
// relecture -> ota.update(). Famille « uno-r4-wifi-sensor » (station sans vote). Séquence anti-rejeu : OTAR4_COMPILED_SEQ (à AUGMENTER à chaque build publié), enregistrée en data flash (blocs 2 et 3).
// Clés : pod_ota_r4_keys.h (IGNORÉ par git ; ota-lab/r4-ota5/tools/make-keys-header.mjs) définit OTAR4_PUB_A_HEX ; sans lui l'OTA est INACTIVE (échec fermé). Laboratoire : -DOTAR4_TLS=0 -DOTAR4_LAB_HOST=\"192.168.1.12\" -DOTAR4_LAB_PORT=8081.
#ifndef POD_OTA_R4
#define POD_OTA_R4 0
#endif
#ifndef OTAR4_COMPILED_SEQ
#define OTAR4_COMPILED_SEQ 1
#endif
#if POD_OTA_R4
  #define OTAR4_FAMILY "uno-r4-wifi-sensor"
  #define OTAR4_KIND "sensor"
  #if __has_include("pod_ota_r4_keys.h")
    #include "pod_ota_r4_keys.h"
  #endif
#endif

#if ARDUINOJSON_VERSION_MAJOR >= 7
  #define JSON_DOC(name, cap) JsonDocument name
#else
  #define JSON_DOC(name, cap) DynamicJsonDocument name(cap)
#endif

String deviceId, pairCode;
bool   registered = false, paired = false;
static char g_body[512];                           // corps JSON des réponses (petites)

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
    if (li.err == POD_NET_GUARD
       ) logfSafeStop();
  } else logfEmit(&j);
  va_end(ap);
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


static char macHexDigit(uint8_t v) { return (char)(v < 10 ? '0' + v : 'a' + (v - 10)); }
// L'adresse MAC vient du module Wi-Fi (pile dédiée, wifiMac) ; échec → chaîne VIDE : doRegister n'inscrit pas.
static String macString() {
  uint8_t m[6] = {0};
  if (!wifiMac(m)) return String();
  char b[18];
  for (uint8_t i = 0; i < 6; i++) { b[3 * i] = macHexDigit(m[i] >> 4); b[3 * i + 1] = macHexDigit(m[i] & 15); b[3 * i + 2] = (i < 5) ? ':' : '\0'; }
  return String(b);
}


#include <new>
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


static bool doRegister() {
  const String mac = macString();
  if (mac.length() == 0) { logf("[REGISTER] adresse MAC indisponible (module Wi-Fi, pile dédiée) : inscription ANNULÉE"); return false; }
  const String body = "{\"mac\":\"" + mac + "\",\"screens\":[\"" SCREEN_TYPE "\"],\"firmware\":\"" FIRMWARE_VERSION "\",\"sensors\":[\"temp\",\"hum\",\"voc\",\"rssi\",\"lat\",\"dl\"]}";   // grandeurs mesurées (lib/measures.ts)
  String resp;
  if (httpCall("POST", "/api/register", &body, resp) != 200) { logf("[REGISTER] échec — nouvel essai dans 5 s"); return false; }
  if (!doRegisterDecode(resp)) return false;
  logf("[REGISTER] deviceId=%s paired=%s", deviceId.c_str(), paired ? "oui" : "non");
  if (!paired) logf("[PAIR] Code d'appairage : %s  → Mon profil → « + Ajouter un ESP » (ou /onboard)", pairCode.c_str());
  return true;
}

// ─── MESURE ────────────────────────────────────────────────────────────────
// Retour : true = mesure acceptée OU refusée proprement par l'anti-rafale du serveur (rien à refaire avant une heure) ; false = lecture, réseau ou serveur en échec (nouvel essai dans 5 min).
// ─── TEST DE DÉBIT ─────────────────────────────────────────────────────────
// Télécharge public/speedtest.bin (4 096 o, fichier STATIQUE servi par le CDN : aucune commande Redis, aucune fonction serveur) et chronomètre la lecture du corps. Résultat en kbit/s (octets x 8 bits / ms),
// 0 = échec (la mesure part quand même, sans cette grandeur). C'est le débit EFFECTIF de bout en bout (Internet + Wi-Fi + module + UART de la carte), pas la capacité de la box.
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
static const char* g_otaMsg = nullptr;                      // état OTA affiché (nullptr : rien)

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
  if (dht22Read(DHT_PIN, tt, hh)) { c10 = tt; h10 = hh; g_lastT = tt; g_lastH = hh; logf("[DHT22] %d.%d C, %u.%u %%", (int)(tt / 10), (int)(tt < 0 ? -(tt % 10) : tt % 10), (unsigned)(hh / 10), (unsigned)(hh % 10)); }
  else logf("[DHT22] lecture impossible (câblage D2 ? alimentation ? ordre des broches ?)");
  const uint16_t voc = readSgp40();
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

// ─── AFFICHAGE LOCAL (TFT 1,8″ ST7735, 128 x 160, portrait) ───────────────────────────────────────────
// Tout appel Adafruit (GFX + SPI : plusieurs centaines d'octets de pile) s'exécute SUR LA PILE DE TRAVAIL (podWorkRun) : la pile principale du cœur R4 ne fait que 1 024 o. Texte opaque (fond effacé par ligne), ASCII seul (police GFX).
// Jamais pendant une transaction réseau. Un échec de la pile de travail laisse l'écran tel quel (le monitoring série et l'envoi continuent).
static Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);
static bool g_tftOk = false;
#define C_BG    0x0000
#define C_WHITE 0xFFFF
#define C_GREY  0x8410
#define C_RED   0xF800
#define C_GREEN 0x07E0
#define C_AMBER 0xFDA0
#define C_CYAN  0x07FF
static void tftLine(int y, uint8_t size, uint16_t fg, const char* txt) {
  tft.fillRect(0, y, 128, 8 * size + 2, C_BG);
  tft.setTextSize(size); tft.setTextColor(fg, C_BG); tft.setCursor(2, y + 1); tft.print(txt);
}
static void __attribute__((noinline)) drawStationWork() {
  char b[24];
  tft.fillRect(0, 0, 128, 13, C_AMBER); tft.setTextSize(1); tft.setTextColor(C_BG, C_AMBER); tft.setCursor(3, 3); tft.print("PoD STATION  " FIRMWARE_VERSION);
  tft.drawFastHLine(0, 13, 128, C_WHITE);
  tftLine(18, 1, C_GREY, "TEMPERATURE");
  if (g_lastT != NO_T) { snprintf(b, sizeof b, "%d.%d C", (int)(g_lastT / 10), (int)(g_lastT < 0 ? -(g_lastT % 10) : g_lastT % 10)); tftLine(28, 3, C_RED, b); } else tftLine(28, 3, C_GREY, "--");
  tftLine(56, 1, C_GREY, "HUMIDITE");
  if (g_lastH != NO_H) { snprintf(b, sizeof b, "%u.%u %%", (unsigned)(g_lastH / 10), (unsigned)(g_lastH % 10)); tftLine(66, 3, C_CYAN, b); } else tftLine(66, 3, C_GREY, "--");
  tftLine(94, 1, C_GREY, "GAZ (VOC brut, bas = + de gaz)");
  if (g_lastVoc) { snprintf(b, sizeof b, "%u", (unsigned)g_lastVoc); tftLine(104, 2, C_GREEN, b); } else tftLine(104, 2, C_GREY, g_sgpSeen ? "--" : "SGP40 ?");
  if (g_rssi < 0) snprintf(b, sizeof b, "Wi-Fi %d dBm", (int)g_rssi); else snprintf(b, sizeof b, "Wi-Fi ?");
  tftLine(126, 1, C_WHITE, b);
  if (!registered) tftLine(138, 1, C_AMBER, "connexion au serveur...");
  else if (!paired) { snprintf(b, sizeof b, "CODE %s", pairCode.c_str()); tftLine(138, 1, C_AMBER, b); }
  else if (g_lastSendMs == 0) tftLine(138, 1, C_GREY, "1er envoi dans < 1 h");
  else { const unsigned m = (unsigned)((millis() - g_lastSendMs) / 60000UL); snprintf(b, sizeof b, "envoi %s il y a %u min", g_sendOk ? "OK" : "ECHEC", m); tftLine(138, 1, g_sendOk ? C_GREEN : C_RED, b); }
  if (g_otaMsg) { snprintf(b, sizeof b, "OTA: %s", g_otaMsg); tftLine(149, 1, C_AMBER, b); }
  else if (g_n > 0) { snprintf(b, sizeof b, "%u en attente", (unsigned)g_n); tftLine(149, 1, C_GREY, b); } else tftLine(149, 1, C_GREY, "");
}
static void __attribute__((noinline)) drawStation() {
  if (!g_tftOk) return;
  PodNetInfo ni;
  auto wk = [&]() { drawStationWork(); };
  if (!podWorkRun(wk, &ni)) logf("[TFT] pile de travail indisponible (%s) : affichage non rafraichi", podNetWhy(ni));
}
static void __attribute__((noinline)) initTft() {
  PodNetInfo ni;
  auto wk = [&]() { tft.initR(INITR_BLACKTAB); tft.setRotation(0); tft.fillScreen(C_BG); g_tftOk = true; };
  if (!podWorkRun(wk, &ni)) logf("[TFT] initialisation impossible (%s) : la station fonctionne sans écran", podNetWhy(ni));
}

#if POD_OTA_R4
#include "pod_ota_r4_client.h"
static unsigned long g_otaNextMs = OTAR4_CHECK_FIRST_MS;
/** Une passe OTA (réseau + staging + éventuelle programmation). Bloque la boucle le temps du téléchargement (≈ 40 s pour 100 Ko). */
static void __attribute__((noinline)) otaTick(bool force) {
  if (!force && millis() < g_otaNextMs) return;
  g_otaMsg = "verification"; drawStation();
  const otar4::Result res = otar4::checkOnce(true);
  g_otaMsg = (res == otar4::R_NO_UPDATE) ? nullptr : otar4::resultName(res);
  drawStation();
  g_otaNextMs = millis() + ((res == otar4::R_NET_FAIL || res == otar4::R_STAGE_FAIL || res == otar4::R_DEFERRED_HOST || res == otar4::R_ERROR) ? OTAR4_RETRY_MS : OTAR4_CHECK_EVERY_MS);
  logf("[OTA] résultat : %s ; prochaine vérification dans %lu s", otar4::resultName(res), (unsigned long)((g_otaNextMs - millis()) / 1000UL));
}
#endif

// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
static unsigned long lastRegisterMs = 0, lastReadMs = 0, lastPostMs = 0, nextReadDelayMs = 0, nextPostDelayMs = 0;
static bool firstRead = true, firstPost = true, g_everPaired = false;

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 2500) {}
  logf("\n[BOOT] Proof-of-Draw UNO R4 WiFi — STATION (DHT22 + SGP40 + TFT 1,8) — %s", FIRMWARE_VERSION);
  Wire.begin();
  initTft();
  drawStation();
  if (wifiStatus() == WL_NO_MODULE) { logf("[WIFI] module absent"); while (true) delay(1000); }
  logf("[WIFI] firmware du module: %s", wifiFirmware().c_str());
  if (strlen(WIFI_SSID) == 0) logf("[WIFI] SSID vide : créer secrets.h (voir secrets.h.example)");
  int tries = 0;
  while (wifiStatus() != WL_CONNECTED && tries++ < 4) {
    wifiBegin();
    for (int i = 0; i < 20 && wifiStatus() != WL_CONNECTED; i++) delay(500);
  }
  if (wifiStatus() != WL_CONNECTED) { logf("[WIFI] échec — redémarrage"); delay(3000); NVIC_SystemReset(); }
  logf("[WIFI] IP: %s", wifiIpString().c_str());
  drawStation();
  while (!registered) { if (doRegister()) break; delay(5000); }
#if POD_OTA_R4
  {
    otar4::setServer(OTAR4_HOST, OTAR4_PORT, OTAR4_BASE);
    otar4::confirmBoot();
  }
#endif
  lastRegisterMs = millis();
  logf("[BOOT] prêt — lecture toutes les %lu min, envoi toutes les %lu min", READ_INTERVAL_MS / 60000UL, POST_INTERVAL_MS / 60000UL);
}

void loop() {
  static unsigned long lastDrawMs = 0;
  if (millis() - lastDrawMs >= 30000UL) { drawStation(); lastDrawMs = millis(); }   // âge de l'envoi, état Wi-Fi : aucune requête réseau
  if (paired) g_everPaired = true;
  // LECTURES : indépendantes du réseau (elles continuent pendant une coupure Wi-Fi/Internet et s'accumulent dans le tampon)
  if (g_everPaired && (firstRead || millis() - lastReadMs >= nextReadDelayMs)) {
    const bool ok = takeReading();
    firstRead = false;
    lastReadMs = millis();
    nextReadDelayMs = ok ? READ_INTERVAL_MS : SENSOR_RETRY_MS;
    drawStation();
  }

#if POD_OTA_R4
  if (Serial.available()) { const int ch = Serial.peek(); if (ch == 'o') { while (Serial.available()) Serial.read(); otaTick(true); } else if (ch == 'f') { while (Serial.available()) Serial.read(); otar4::dumpBlocks(); } }   // laboratoire : o = vérifier maintenant, f = data flash
#endif
  if (wifiStatus() != WL_CONNECTED) { wifiBegin(); delay(5000); return; }
  if (!registered) { if (!doRegister()) { delay(5000); return; } lastRegisterMs = millis(); }

#if POD_OTA_R4
  otaTick(false);                                  // la mise à jour ne dépend NI de l'appairage NI des capteurs
#endif
  if (!paired) {                                   // en attente d'appairage : on redemande toutes les minutes (5 inscriptions/min/IP au plus côté serveur)
    if (millis() - lastRegisterMs >= 60000UL) {
      doRegister();
      lastRegisterMs = millis();
      if (paired) { logf("[PAIR] appairé : premier envoi"); firstPost = true; }
    }
    delay(250);
    return;
  }

  // ENVOI : toutes les heures, ou dès que le réseau est de retour après un échec (5 min)
  if (g_n > 0 && (firstPost || millis() - lastPostMs >= nextPostDelayMs)) {
    const bool ok = doPost();
    firstPost = false;
    lastPostMs = millis();
    nextPostDelayMs = ok ? POST_INTERVAL_MS : SENSOR_RETRY_MS;
    g_sendOk = ok; if (ok) g_lastSendMs = millis();
    drawStation();
  }
  delay(1000);
}
