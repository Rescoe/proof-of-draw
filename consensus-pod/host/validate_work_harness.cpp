// host/validate_work_harness.cpp — DOVALIDATE-JSON-STACK-FIX1 : exécute, sur l'hôte, le CODE RÉEL du décodage de la réponse /api/validate-candidate (valCharsOk, validateParseWork, validateParseOnWorkStack, validateWorkFailed,
// doValidateDecode), extrait mot pour mot du sketch UNO R4 e-ink 2,9″ par tests/validateJsonStack.test.ts (fichier « validate_extract.inc », blocs de canari retirés), contre ArduinoJson RÉEL, la classe String
// simulée (consensus-pod/host/shim/Arduino.h) et la logique réelle de podNetStack.h (POD_NET_HOST_TEST : garde écrasée, malloc impossible, imbrication).
//   validate_work_harness  →  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// Prouve : (1) validation réelle (v2) et ancien chemin (v1, score, défaut 0,5) ; (2) déjà voté / candidat nul / identifiant vide : rien à voter, silencieux ; (3) identifiant, écran, hash, taille invalides, absents, trop
// courts, trop longs, hors alphabet, de mauvais type : REFUSÉS, jamais tronqués ; (4) JSON tronqué / illisible ; (5) TOUT OU RIEN : les paramètres de sortie ne changent QU'avec un résultat complet et valide ;
// (6) NOMEM / NESTED / GUARD / MARGIN et allocation de la structure impossible : aucun vote ; GUARD = arrêt sûr AVANT tout journal. Ne prouve PAS la profondeur réelle sur la carte (canari).
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

static bool g_failNew = false;
void* operator new(std::size_t n, const std::nothrow_t&) noexcept { if (g_failNew) return nullptr; return std::malloc(n); }

#include "validate_extract.inc"

static int g_checks = 0;
static std::vector<std::string> g_fail;
#define CHECK(cond, msg) do { g_checks++; if (!(cond)) g_fail.push_back(std::string(msg) + " [" #cond "]"); } while (0)

struct Out { String cid, screen, hash; size_t bytes; float score; int mode; };
static Out fresh() { Out o; o.cid = "C0"; o.screen = "S0"; o.hash = "H0"; o.bytes = 7; o.score = 0.123f; o.mode = -1; return o; }
static bool untouched(const Out& o) { return o.cid == "C0" && o.screen == "S0" && o.hash == "H0" && o.bytes == 7 && o.score == 0.123f; }
static void resetState() { g_log.clear(); g_failNew = false; podNetTestHook = nullptr; podNetTestFailAlloc = 0; podNetTestNested = 0; }
static Out run(const std::string& body) { Out o = fresh(); String resp(body.c_str()); o.mode = doValidateDecode(resp, o.cid, o.screen, o.bytes, o.hash, o.score); return o; }

static const std::string UUID = "3f2b8c1e-9a47-4d0b-8e55-1c6d7a90b2f4";
static const std::string H64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
static std::string v2(const std::string& cid, const std::string& screen, const std::string& bytes, const std::string& hash) {
  return "{\"candidate\":{\"candidateId\":\"" + cid + "\",\"score_server\":0.5,\"v2\":{\"screen\":\"" + screen + "\",\"bytes\":" + bytes + ",\"hash\":\"" + hash + "\"}}}";
}

int main() {
  // ── validation RÉELLE (v2)
  resetState();
  { Out o = run(v2(UUID, "eink29bwr", "9472", H64)); CHECK(o.mode == 1, "v2 : mode 1"); CHECK(o.cid == UUID.c_str() && o.screen == "eink29bwr" && o.bytes == 9472 && o.hash == H64.c_str(), "v2 : sorties exactes"); CHECK(o.score == 0.123f, "v2 : score non touché"); }
  resetState();
  { Out o = run(v2(UUID, "tft28", "153600", "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789")); CHECK(o.mode == 1 && o.bytes == 153600, "v2 : hash en majuscules et taille du TFT 2,8″ acceptés"); }
  resetState();
  { Out o = run(v2(UUID, "oled096", "1024", H64)); CHECK(o.mode == 1 && o.screen == "oled096", "v2 : OLED"); }
  // ── ancien chemin (v1)
  resetState();
  { Out o = run("{\"candidate\":{\"candidateId\":\"" + UUID + "\",\"score_server\":0.73}}"); CHECK(o.mode == 2 && o.cid == UUID.c_str() && o.score > 0.729f && o.score < 0.731f, "v1 : score du serveur"); CHECK(o.screen == "S0" && o.hash == "H0" && o.bytes == 7, "v1 : sorties v2 non touchées"); }
  resetState();
  { Out o = run("{\"candidate\":{\"candidateId\":\"" + UUID + "\"}}"); CHECK(o.mode == 2 && o.score == 0.5f, "v1 : score absent = 0,5"); }
  // ── rien à voter (silencieux)
  struct Skip { std::string name, body; };
  std::vector<Skip> skip = {
    { "déjà voté", "{\"alreadyVoted\":true,\"candidate\":{\"candidateId\":\"" + UUID + "\"}}" },
    { "candidat absent", "{}" },
    { "candidat nul", "{\"candidate\":null}" },
    { "identifiant vide", "{\"candidate\":{\"candidateId\":\"\",\"score_server\":0.5}}" },
    { "identifiant de type nombre (traité comme vide)", "{\"candidate\":{\"candidateId\":123456789,\"score_server\":0.5}}" },
    { "identifiant absent", "{\"candidate\":{\"score_server\":0.5}}" },
  };
  for (const Skip& s : skip) { resetState(); Out o = run(s.body); CHECK(o.mode == 0 && untouched(o) && g_log.empty(), "rien à voter, silencieux : " + s.name); }
  // ── refus (jamais tronqué, tout ou rien)
  struct Bad { std::string name, body; };
  std::vector<Bad> bad = {
    { "identifiant trop court", v2("abc", "eink29bwr", "9472", H64) },
    { "identifiant de 65 car.", v2(std::string(65, 'a'), "eink29bwr", "9472", H64) },
    { "identifiant avec guillemet", v2("3f2b8c1e\\\"x9a47-4d0b", "eink29bwr", "9472", H64) },
    { "identifiant avec espace", v2("3f2b8c1e 9a47-4d0b", "eink29bwr", "9472", H64) },
    { "identifiant avec & (URL)", v2("3f2b8c1e&x=9a47-4d0b", "eink29bwr", "9472", H64) },
    { "écran vide", v2(UUID, "", "9472", H64) },
    { "écran de 17 car.", v2(UUID, std::string(17, 'a'), "9472", H64) },
    { "écran en majuscules", v2(UUID, "EINK29BWR", "9472", H64) },
    { "écran avec caractère interdit", v2(UUID, "eink-29", "9472", H64) },
    { "hash de 63 car.", v2(UUID, "eink29bwr", "9472", H64.substr(0, 63)) },
    { "hash de 65 car.", v2(UUID, "eink29bwr", "9472", H64 + "0") },
    { "hash non hexadécimal", v2(UUID, "eink29bwr", "9472", std::string(63, 'a') + "g") },
    { "hash vide", v2(UUID, "eink29bwr", "9472", "") },
    { "taille 0", v2(UUID, "eink29bwr", "0", H64) },
    { "taille négative", v2(UUID, "eink29bwr", "-5", H64) },
    { "taille énorme", v2(UUID, "eink29bwr", "262145", H64) },
    { "taille absente", "{\"candidate\":{\"candidateId\":\"" + UUID + "\",\"v2\":{\"screen\":\"eink29bwr\",\"hash\":\"" + H64 + "\"}}}" },
    { "taille de type chaîne", v2(UUID, "eink29bwr", "\"9472\"", H64) },
    { "v2 vide", "{\"candidate\":{\"candidateId\":\"" + UUID + "\",\"v2\":{}}}" },
  };
  for (const Bad& b : bad) { resetState(); Out o = run(b.body); CHECK(o.mode == 0 && untouched(o), "refusé sans effet : " + b.name); CHECK(g_log.find("rejet") != std::string::npos, "journal du refus : " + b.name); }
  // ── JSON tronqué / illisible
  { std::string full = v2(UUID, "eink29bwr", "9472", H64); for (size_t cut : { size_t(1), size_t(20), full.size() / 2, full.size() - 1 }) { resetState(); Out o = run(full.substr(0, cut)); CHECK(o.mode == 0 && untouched(o), "tronqué à " + std::to_string(cut)); } }
  resetState();
  { Out o = run("<html>502</html>"); CHECK(o.mode == 0 && untouched(o) && g_log.find("JSON illisible") != std::string::npos, "HTML : JSON illisible"); }
  resetState();
  { Out o = run(""); CHECK(o.mode == 0 && untouched(o), "corps vide"); }
  // ── pile de travail en échec : aucun vote
  const std::string good = v2(UUID, "eink29bwr", "9472", H64);
  resetState(); podNetTestFailAlloc = 1;
  { Out o = run(good); CHECK(o.mode == 0 && untouched(o), "NOMEM : rien"); CHECK(g_log.find("NON exécutée") != std::string::npos, "NOMEM : « NON exécutée »"); }
  resetState(); podNetTestNested = 1;
  { Out o = run(good); CHECK(o.mode == 0 && untouched(o), "NESTED : rien"); CHECK(g_log.find("NON exécutée") != std::string::npos, "NESTED : « NON exécutée »"); }
  resetState(); podNetTestHook = [](uint8_t* low, size_t, uint8_t*) { low[0] = 0; };
  { Out o = run(good); CHECK(o.mode == 0 && untouched(o), "MARGIN : réponse décodée mais AUCUN vote"); CHECK(g_log.find("EXÉCUTÉE") != std::string::npos, "MARGIN : « EXÉCUTÉE mais rejetée »"); }
  resetState(); podNetTestHook = [](uint8_t*, size_t, uint8_t* guard) { guard[0] = 0; };
  { bool halted = false; try { run(good); } catch (const Halt&) { halted = true; } CHECK(halted, "GUARD : arrêt sûr"); CHECK(g_log.empty(), "GUARD : AUCUN journal avant l'arrêt"); }
  resetState(); podNetTestHook = [](uint8_t* low, size_t n, uint8_t*) { low[n - 100] = 0; };
  { Out o = run(good); CHECK(o.mode == 1, "marge confortable : accepté"); }
  resetState(); g_failNew = true;
  { Out o = run(good); CHECK(o.mode == 0 && untouched(o) && g_log.find("mémoire insuffisante") != std::string::npos, "new impossible : rejeté sans effet"); }
  resetState();
  { Out o = run(good); CHECK(o.mode == 1, "retour à la normale"); }
  // ── réponse réelle du serveur (champs supplémentaires ignorés)
  resetState();
  { Out o = run("{\"alreadyVoted\":false,\"candidate\":{\"candidateId\":\"" + UUID + "\",\"screen\":\"eink29bwr\",\"score_server\":0.61,\"expiresAt\":1790000000000,\"kind\":\"image\",\"v2\":{\"screen\":\"eink29bwr\",\"bytes\":9472,\"hash\":\"" + H64 + "\"}},\"votes\":{\"count\":1,\"needed\":3}}"); CHECK(o.mode == 1 && o.bytes == 9472, "réponse réelle du serveur"); }

  if (!g_fail.empty()) { for (const std::string& f : g_fail) std::printf("ECART : %s\n", f.c_str()); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
