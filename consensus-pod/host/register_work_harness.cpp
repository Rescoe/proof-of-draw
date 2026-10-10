// host/register_work_harness.cpp — REGISTER-JSON-STACK-FIX1 : exécute, sur l'hôte, le CODE RÉEL du décodage de la réponse /api/register (regDeviceIdOk, regPairCodeOk, registerParseWork, registerParseOnWorkStack,
// registerWorkFailed, doRegisterDecode), extrait mot pour mot du sketch UNO R4 e-ink 2,9″ par tests/registerJsonStack.test.ts (fichier « register_extract.inc », blocs de canari retirés), contre ArduinoJson RÉEL,
// la classe String simulée (consensus-pod/host/shim/Arduino.h) et la logique réelle de podNetStack.h (POD_NET_HOST_TEST : garde écrasée, malloc impossible, imbrication).
//   register_work_harness  →  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// Prouve : (1) appairé / non appairé / paired absent ; (2) pairCode absent accepté seulement si appairé ; (3) deviceId et pairCode invalides, absents, trop courts, trop longs, hors alphabet, de mauvais type : REFUSÉS,
// jamais tronqués ; (4) JSON tronqué / illisible ; (5) TOUT OU RIEN : deviceId, pairCode, paired, registered ne changent QU'avec un résultat complet et valide ; (6) NOMEM / NESTED / GUARD / MARGIN de la pile de travail
// et échec de l'allocation de la structure : rien n'est inscrit ; GUARD = arrêt sûr AVANT tout journal. Ne prouve PAS la profondeur réelle sur la carte (canari).
#define POD_NET_HOST_TEST 1
#include <cstdio>
#include <cstdlib>
#include <cstdarg>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>
#include <new>
#include <Arduino.h>
#include <ArduinoJson.h>
#include "podNetStack.h"

#if ARDUINOJSON_VERSION_MAJOR >= 7
  #define JSON_DOC(name, cap) JsonDocument name
#else
  #define JSON_DOC(name, cap) DynamicJsonDocument name(cap)
#endif

static std::string g_log;
struct Halt { int code; };
static void logf(const char* fmt, ...) { char b[512]; va_list ap; va_start(ap, fmt); std::vsnprintf(b, sizeof(b), fmt, ap); va_end(ap); g_log += b; g_log += "\n"; }
[[noreturn]] static void logfSafeStop() { throw Halt{ 1 }; }

// allocation de la structure : panne injectable
static bool g_failNew = false;
void* operator new(std::size_t n, const std::nothrow_t&) noexcept { if (g_failNew) return nullptr; return std::malloc(n); }

String deviceId, pairCode;
bool paired = false, registered = false;

#include "register_extract.inc"

static int g_checks = 0;
static std::vector<std::string> g_fail;
#define CHECK(cond, msg) do { g_checks++; if (!(cond)) g_fail.push_back(std::string(msg) + " [" #cond "]"); } while (0)

static void resetState() {
  deviceId = "D0"; pairCode = "P0"; paired = false; registered = false; g_log.clear();
  g_failNew = false; podNetTestHook = nullptr; podNetTestFailAlloc = 0; podNetTestNested = 0;
}
static bool untouched() { return deviceId == "D0" && pairCode == "P0" && !paired && !registered; }
static bool run(const std::string& body) { String resp(body.c_str()); return doRegisterDecode(resp); }
static std::string mk(const std::string& id, const std::string& pc, const char* pairedJson) {
  std::string s = "{";
  if (!id.empty()) s += "\"deviceId\":\"" + id + "\",";
  if (!pc.empty()) s += "\"pairCode\":\"" + pc + "\",";
  s += "\"canvasUrl\":\"https://x/draw/dev_W29I1TW7/eink29bwr\",\"artistName\":null";
  if (pairedJson) s += std::string(",\"paired\":") + pairedJson;
  return s + "}";
}

int main() {
  const std::string ID = "dev_W29I1TW7", PC = "ABCD2345";
  // ── appairé / non appairé
  resetState();
  CHECK(run(mk(ID, PC, "true")), "appairé : accepté");
  CHECK(deviceId == ID.c_str() && pairCode == PC.c_str() && paired && registered, "appairé : état inscrit");
  resetState();
  CHECK(run(mk(ID, PC, "false")), "non appairé : accepté");
  CHECK(deviceId == ID.c_str() && pairCode == PC.c_str() && !paired && registered, "non appairé : état inscrit");
  resetState();
  CHECK(run(mk(ID, "", "true")), "appairé sans pairCode : accepté");
  CHECK(deviceId == ID.c_str() && pairCode == "" && paired && registered, "appairé sans pairCode : pairCode vide");
  resetState();
  CHECK(run(mk(ID, PC, nullptr)), "paired absent : accepté comme non appairé (comme avant)");
  CHECK(!paired && registered && pairCode == PC.c_str(), "paired absent : false");
  resetState();
  CHECK(run(mk(ID, PC, "\"oui\"")), "paired de mauvais type : traité comme false (comme avant)");
  CHECK(!paired && registered, "paired de mauvais type : false");
  // ── refus (tout ou rien, jamais de troncature)
  struct Bad { std::string name, body; };
  std::vector<Bad> bad = {
    { "non appairé sans pairCode", mk(ID, "", "false") },
    { "paired absent sans pairCode", mk(ID, "", nullptr) },
    { "deviceId absent", mk("", PC, "false") },
    { "deviceId trop court", mk("dev_W29I1TW", PC, "false") },
    { "deviceId trop long (13)", mk("dev_W29I1TW7X", PC, "false") },
    { "deviceId très long", mk("dev_" + std::string(300, 'A'), PC, "false") },
    { "deviceId en minuscules", mk("dev_w29i1tw7", PC, "false") },
    { "deviceId sans préfixe", mk("xyz_W29I1TW7", PC, "false") },
    { "deviceId avec caractère interdit", mk("dev_W29I1T-7", PC, "false") },
    { "pairCode trop court", mk(ID, "ABCD234", "false") },
    { "pairCode trop long", mk(ID, "ABCD23456", "false") },
    { "pairCode très long", mk(ID, std::string(200, 'A'), "false") },
    { "pairCode hors alphabet (O)", mk(ID, "ABCDO345", "false") },
    { "pairCode hors alphabet (0)", mk(ID, "ABCD0345", "false") },
    { "pairCode hors alphabet (minuscule)", mk(ID, "abcd2345", "false") },
    { "pairCode invalide MÊME si appairé", mk(ID, "ABCD234", "true") },
    { "deviceId de type nombre", "{\"deviceId\":12345,\"pairCode\":\"ABCD2345\",\"paired\":false}" },
    { "deviceId null", "{\"deviceId\":null,\"pairCode\":\"ABCD2345\",\"paired\":false}" },
    { "objet vide", "{}" },
    { "tableau", "[1,2,3]" },
    { "corps vide", "" },
  };
  for (const Bad& b : bad) { resetState(); CHECK(!run(b.body) && untouched(), "refusé sans effet : " + b.name); CHECK(g_log.find("rejet") != std::string::npos || g_log.find("illisible") != std::string::npos, "journal du refus : " + b.name); }
  // ── JSON tronqué / illisible
  resetState();
  { std::string full = mk(ID, PC, "false"); for (size_t cut : { size_t(1), size_t(10), full.size() / 2, full.size() - 1 }) { resetState(); CHECK(!run(full.substr(0, cut)) && untouched(), "tronqué à " + std::to_string(cut)); } }
  resetState();
  CHECK(!run("<html>502 Bad Gateway</html>") && untouched() && g_log.find("JSON illisible") != std::string::npos, "HTML : JSON illisible");
  // ── pile de travail en échec : rien n'est inscrit
  resetState(); podNetTestFailAlloc = 1;
  CHECK(!run(mk(ID, PC, "false")) && untouched(), "NOMEM : rien d'inscrit"); CHECK(g_log.find("NON exécutée") != std::string::npos, "NOMEM : « NON exécutée »");
  resetState(); podNetTestNested = 1;
  CHECK(!run(mk(ID, PC, "false")) && untouched(), "NESTED : rien d'inscrit"); CHECK(g_log.find("NON exécutée") != std::string::npos, "NESTED : « NON exécutée »");
  resetState(); podNetTestHook = [](uint8_t* low, size_t, uint8_t*) { low[0] = 0; };
  CHECK(!run(mk(ID, PC, "false")) && untouched(), "MARGIN : réponse décodée mais RIEN d'inscrit"); CHECK(g_log.find("EXÉCUTÉE") != std::string::npos, "MARGIN : « EXÉCUTÉE mais rejetée »");
  resetState(); podNetTestHook = [](uint8_t*, size_t, uint8_t* guard) { guard[0] = 0; };
  { bool halted = false; try { run(mk(ID, PC, "false")); } catch (const Halt&) { halted = true; }
    CHECK(halted, "GUARD : arrêt sûr"); CHECK(g_log.empty(), "GUARD : AUCUN journal avant l'arrêt"); CHECK(untouched(), "GUARD : rien d'inscrit"); }
  resetState(); podNetTestHook = [](uint8_t* low, size_t n, uint8_t*) { low[n - 100] = 0; };   // 100 o utilisés : marge énorme
  CHECK(run(mk(ID, PC, "false")) && registered, "marge confortable : accepté");
  // ── allocation de la structure impossible
  resetState(); g_failNew = true;
  CHECK(!run(mk(ID, PC, "false")) && untouched() && g_log.find("mémoire insuffisante") != std::string::npos, "new impossible : rejeté sans effet");
  resetState();
  CHECK(run(mk(ID, PC, "false")), "retour à la normale après la panne");
  // ── la réponse réelle du serveur (champs supplémentaires ignorés)
  resetState();
  CHECK(run("{\"deviceId\":\"dev_W29I1TW7\",\"pairCode\":\"ZZZZ9999\",\"canvasUrl\":\"https://proof-of-draw.vercel.app/draw/dev_W29I1TW7/eink29bwr\",\"paired\":true,\"artistName\":\"Roubzi\"}") && deviceId == "dev_W29I1TW7" && pairCode == "ZZZZ9999", "réponse réelle du serveur");
  // l'alphabet exact du serveur
  { const char* alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; for (int i = 0; i < 32; i++) { std::string pc(8, alpha[i]); resetState(); CHECK(run(mk(ID, pc, "false")) && pairCode == pc.c_str(), std::string("alphabet : ") + alpha[i]); } }
  { const char* no = "IO01ilo"; for (const char* p = no; *p; p++) { std::string pc(8, *p); resetState(); CHECK(!run(mk(ID, pc, "false")) && untouched(), std::string("hors alphabet : ") + *p); } }

  if (!g_fail.empty()) { for (const std::string& f : g_fail) std::printf("ECART : %s\n", f.c_str()); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
