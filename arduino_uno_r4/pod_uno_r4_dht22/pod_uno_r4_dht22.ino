// pod_uno_r4_dht22.ino
// Proof-of-Draw — capteur de TEMPÉRATURE + HUMIDITÉ : UNO R4 WiFi + DHT22 (AM2302). Mesures vers /api/sensor (production : 1 / heure ; essai : 1 / 5 min), historique dans « Mon profil » (🌡 Mesures) et dans la vue réseau.
//
// Compilé, flashé et VALIDÉ sur la carte par le porteur (12/10/2026) ; écrit sans chaîne ARM. Le réseau (pile TLS dédiée, pile Wi-Fi dédiée, pile de travail JSON, journal) est la copie des blocs VALIDÉS du firmware e-ink 2,9″, canari retiré.
// Seul code neuf : dht22.h (décodage testé sur l'hôte) et doSensor() (mesure + diagnostic Wi-Fi : signal reçu et latence du dernier envoi).
// Ce capteur ne calcule rien, ne vote pas, n'affiche rien et n'entre dans AUCUNE pool : il s'enregistre avec screens = ["sensor"].
//
// CÂBLAGE : DHT22  VCC → 3,3 V · GND → GND · DATA → D2 (résistance de rappel 10 kΩ DATA↔3,3 V si le module n'en a pas : les modules à 3 broches l'ont déjà).
// MISE EN SERVICE : copier secrets.h.example en secrets.h (Wi-Fi 2,4 GHz) · bibliothèque ArduinoJson (la même que les autres firmwares) · téléverser · ouvrir le moniteur série (115200) :
//   « Code d'appairage : XXXXXXXX » → sur le site : Mon profil → « + Ajouter un ESP » (ou /onboard) → saisir le code. La 1re mesure part dans la minute qui suit l'appairage, puis 1 par heure.
//
// Coût Redis par capteur : ≈ 8 commandes/heure (lib/sensorData.ts). Le serveur refuse (sans écrire) toute mesure arrivée moins de 50 min après la précédente.

#include <Arduino.h>
#include <malloc.h>
#include <stdarg.h>
#include <WiFiS3.h>
#include <ArduinoJson.h>
#include "pod_http.h"
#include "podNetStack.h"   // transactions TLS, appels au module Wi-Fi et journal sur PILES DÉDIÉES (la pile principale du cœur R4 ne fait que 1 024 o)
#include "dht22.h"
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
#define FIRMWARE_VERSION    "r4dht22-1.1"
#define DHT_PIN             2                      // D2
// PRODUCTION : 1 mesure / heure. (Essai : 300000UL = 5 min, accepté par le serveur seulement jusqu'au 16/10/2026 00:00 UTC ; au-delà le serveur refuse toute mesure < 50 min après la précédente.)
#define SENSOR_INTERVAL_MS  3600000UL              // 1 mesure par heure
#define SENSOR_RETRY_MS     300000UL               // après un échec (lecture ou réseau) : nouvel essai dans 5 min
#define HTTP_TIMEOUT_MS     20000UL

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
  const String body = "{\"mac\":\"" + mac + "\",\"screens\":[\"" SCREEN_TYPE "\"],\"firmware\":\"" FIRMWARE_VERSION "\",\"sensors\":[\"temp\",\"hum\",\"rssi\",\"lat\"]}";   // grandeurs mesurées (lib/measures.ts)
  String resp;
  if (httpCall("POST", "/api/register", &body, resp) != 200) { logf("[REGISTER] échec — nouvel essai dans 5 s"); return false; }
  if (!doRegisterDecode(resp)) return false;
  logf("[REGISTER] deviceId=%s paired=%s", deviceId.c_str(), paired ? "oui" : "non");
  if (!paired) logf("[PAIR] Code d'appairage : %s  → Mon profil → « + Ajouter un ESP » (ou /onboard)", pairCode.c_str());
  return true;
}

// ─── MESURE ────────────────────────────────────────────────────────────────
// Retour : true = mesure acceptée OU refusée proprement par l'anti-rafale du serveur (rien à refaire avant une heure) ; false = lecture, réseau ou serveur en échec (nouvel essai dans 5 min).
static unsigned long g_lastLatMs = 0;                      // durée du dernier POST /api/sensor réussi (joint à la mesure suivante)
static bool doSensor() {
  int16_t c10 = 0; uint16_t h10 = 0;
  if (!dht22Read(DHT_PIN, c10, h10)) { logf("[DHT22] lecture impossible (câblage D2 ? résistance de rappel ?) — nouvel essai dans 5 min"); return false; }
  logf("[DHT22] %d.%d C, %u.%u %%", (int)(c10 / 10), (int)(c10 < 0 ? -(c10 % 10) : c10 % 10), (unsigned)(h10 / 10), (unsigned)(h10 % 10));
  // Diagnostic Wi-Fi joint à la mesure (aucune requête de plus) : signal reçu (dBm) et temps de réponse du DERNIER envoi réussi (ms)
  int32_t rssi = 0; const bool haveRssi = wifiRssi(rssi) && rssi < 0 && rssi >= -127;
  String m = "{\"temp\":" + String((int)c10) + ",\"hum\":" + String((unsigned)h10);
  if (haveRssi) m += ",\"rssi\":" + String((int)rssi);
  if (g_lastLatMs > 0 && g_lastLatMs <= 60000UL) m += ",\"lat\":" + String((unsigned)g_lastLatMs);
  m += "}";
  const String body = "{\"deviceId\":\"" + deviceId + "\",\"pairCode\":\"" + pairCode + "\",\"m\":" + m + "}";
  String resp;
  const unsigned long tPost = millis();
  const int code = httpCall("POST", "/api/sensor", &body, resp);
  if (code == 200) g_lastLatMs = millis() - tPost;
  if (code == 200) { logf("[SENSOR] mesure envoyée"); return true; }
  if (code == 403) { logf("[SENSOR] refusé (403) : code d'appairage changé, capteur supprimé ou non appairé — nouvelle inscription"); registered = false; paired = false; return false; }
  if (code == 404) logf("[SENSOR] 404 : la route /api/sensor n'existe pas sur ce serveur (site pas encore déployé avec le capteur ?)");
  logf("[SENSOR] échec (%d) — nouvel essai dans 5 min", code);
  return false;
}

// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
static unsigned long lastRegisterMs = 0, nextSensorDelayMs = 0, lastSensorMs = 0;
static bool firstSensor = true;

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 2500) {}
  logf("\n[BOOT] Proof-of-Draw UNO R4 WiFi + DHT22 — %s", FIRMWARE_VERSION);
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
  while (!registered) { if (doRegister()) break; delay(5000); }
  lastRegisterMs = millis();
  logf("[BOOT] prêt — une mesure toutes les %lu min", SENSOR_INTERVAL_MS / 60000UL);
}

void loop() {
  const unsigned long now = millis();
  if (wifiStatus() != WL_CONNECTED) { wifiBegin(); delay(5000); return; }
  if (!registered) { if (!doRegister()) { delay(5000); return; } lastRegisterMs = millis(); }

  if (!paired) {                                   // en attente d'appairage : on redemande toutes les minutes (5 inscriptions/min/IP au plus côté serveur)
    if (now - lastRegisterMs >= 60000UL) {
      doRegister();
      lastRegisterMs = millis();
      if (paired) { logf("[PAIR] appairé : première mesure"); firstSensor = true; }
    }
    delay(250);
    return;
  }

  if (firstSensor || now - lastSensorMs >= nextSensorDelayMs) {
    firstSensor = false;
    const bool ok = doSensor();
    lastSensorMs = millis();
    nextSensorDelayMs = ok ? SENSOR_INTERVAL_MS : SENSOR_RETRY_MS;
  }
  delay(1000);
}
