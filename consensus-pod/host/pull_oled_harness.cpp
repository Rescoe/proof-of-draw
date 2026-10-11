// host/pull_oled_harness.cpp — LOT8B2B3 : exécute, sur l'hôte, le CODE RÉEL du décodage de /api/pull du sketch UNO R4 e-ink 2,7″ + OLED (région extraite mot pour mot par
// tests/r4Eink27Propagation.test.ts dans « pull_extract.inc »), contre ArduinoJson RÉEL : le champ « screen » (racine, puis frame.screen), ses bornes, et l'absence d'effet de bord sur rejet.
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
#define max(a, b) ((a) > (b) ? (a) : (b))
#define PULL_INTERVAL 60000UL

static std::string g_log;
struct Halt { int code; };
static void logf(const char* fmt, ...) { char b[512]; va_list ap; va_start(ap, fmt); std::vsnprintf(b, sizeof(b), fmt, ap); va_end(ap); g_log += b; g_log += "\n"; }
[[noreturn]] static void logfSafeStop() { throw Halt{ 1 }; }
static unsigned long millis() { return 100000UL; }
static String asciiFold(const String& s) { return s; }

// état global simulé du firmware (valeurs initiales reconnaissables)
String pendingWorkTitle, pendingArtistName, pendingDisplayTs, pendingObsHashes, pendingObsTarget, currentBlockHash, pendingCandidateId;
int currentBlockIndex = 3;
unsigned long lastPullMs = 7, nextPullIntervalMs = 5;
static int g_nSaveOwned = 0, g_nSaveBlock = 0, g_seq = 0, g_seqOwned = 0, g_seqBlock = 0;
static String g_savedOwned, g_savedBlock;
static void saveOwnedBlockHash(const String& h) { g_nSaveOwned++; g_savedOwned = h; g_seqOwned = ++g_seq; }
static void saveBlockHashToEEPROM(const String& h) { g_nSaveBlock++; g_savedBlock = h; g_seqBlock = ++g_seq; }

#include "pull_extract.inc"

static int g_checks = 0;
static std::vector<std::string> g_fail;
#define CHECK(cond, msg) do { g_checks++; if (!(cond)) g_fail.push_back(std::string(msg) + " [" #cond "]"); } while (0)
struct Out { int rc; String frameId, frameSource, screen; };
static Out run(const std::string& body, int code = 200) { String resp(body.c_str()); Out o; o.rc = doPullStage(resp, code, o.frameId, o.frameSource, o.screen); return o; }
static void reset() { pendingWorkTitle = "T0"; currentBlockHash = "oldhash"; pendingCandidateId = "C0"; currentBlockIndex = 3; g_nSaveOwned = g_nSaveBlock = 0; g_log.clear(); podNetTestHook = nullptr; podNetTestFailAlloc = 0; podNetTestNested = 0; }

int main() {
  // 1. screen à la racine
  reset(); { Out o = run("{\"frameId\":\"fr-1\",\"frameSource\":\"consensus\",\"screen\":\"oled096\"}"); CHECK(o.rc == 1 && o.frameId == "fr-1" && o.screen == "oled096", "racine oled096"); }
  reset(); { Out o = run("{\"frameId\":\"fr-1\",\"frameSource\":\"consensus\",\"screen\":\"eink27bw\"}"); CHECK(o.rc == 1 && o.screen == "eink27bw", "racine eink27bw"); }
  // 2. screen absent => vide (le sketch retombe sur l'e-ink, comme avant)
  reset(); { Out o = run("{\"frameId\":\"fr-1\",\"frameSource\":\"consensus\"}"); CHECK(o.rc == 1 && o.screen == "", "absent => vide"); }
  // 3. frame{frameId, screen} quand frameId racine absent ; l'ancien « fo["screen"] | newScreen » : absent => on garde celui de la racine
  reset(); { Out o = run("{\"frameSource\":\"consensus\",\"screen\":\"eink27bw\",\"frame\":{\"frameId\":\"fr-2\",\"screen\":\"oled096\"}}"); CHECK(o.rc == 1 && o.frameId == "fr-2" && o.screen == "oled096", "frame.screen prioritaire"); }
  reset(); { Out o = run("{\"frameSource\":\"consensus\",\"screen\":\"oled096\",\"frame\":{\"frameId\":\"fr-2\"}}"); CHECK(o.rc == 1 && o.frameId == "fr-2" && o.screen == "oled096", "frame sans screen : racine conservée"); }
  reset(); { Out o = run("{\"frameSource\":\"consensus\",\"frame\":{\"frameId\":\"fr-2\",\"screen\":\"oled096\"}}"); CHECK(o.rc == 1 && o.screen == "oled096", "frame.screen seul"); }
  // 4. bornes : 16 caractères acceptés, 17 REFUSÉS (jamais tronqués), rien d'appliqué
  reset(); { Out o = run("{\"frameId\":\"fr-1\",\"frameSource\":\"consensus\",\"screen\":\"abcdefghijklmnop\",\"chain\":{\"blockHash\":\"nouveau\",\"blockIndex\":9},\"ownedBlock\":\"0123456789abcdef0123\"}"); CHECK(o.rc == 1 && o.screen == "abcdefghijklmnop", "16 car. acceptés"); }
  reset(); { Out o = run("{\"frameId\":\"fr-1\",\"frameSource\":\"consensus\",\"screen\":\"abcdefghijklmnopq\",\"chain\":{\"blockHash\":\"nouveau\",\"blockIndex\":9},\"ownedBlock\":\"0123456789abcdef0123\"}");
    CHECK(o.rc == 0 && o.frameId == "" && o.screen == "" && currentBlockHash == "oldhash" && currentBlockIndex == 3 && g_nSaveOwned == 0 && g_nSaveBlock == 0 && pendingCandidateId == "C0", "17 car. : REFUSÉ, rien d'appliqué"); }
  reset(); { Out o = run("{\"frameSource\":\"consensus\",\"frame\":{\"frameId\":\"fr-2\",\"screen\":\"abcdefghijklmnopq\"}}"); CHECK(o.rc == 0 && o.screen == "", "frame.screen trop long : REFUSÉ"); }
  // 5. échec de pile de travail (allocation) : rien d'appliqué, screen vide
  reset(); podNetTestFailAlloc = 1; { Out o = run("{\"frameId\":\"fr-1\",\"frameSource\":\"consensus\",\"screen\":\"oled096\"}"); CHECK(o.rc == 0 && o.screen == "" && currentBlockHash == "oldhash", "NOMEM"); }
  // 6. 429 : terminé, aucun écran
  reset(); { Out o = run("{\"retryAfter\":30}", 429); CHECK(o.rc == 2 && o.screen == "", "429"); }
  // 7. JSON tronqué : rejeté
  reset(); { Out o = run("{\"frameId\":\"fr-1\",\"screen\":\"oled0"); CHECK(o.rc == 0 && o.screen == "", "tronqué"); }

  if (!g_fail.empty()) { for (auto& f : g_fail) std::printf("FAIL %s\n", f.c_str()); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
