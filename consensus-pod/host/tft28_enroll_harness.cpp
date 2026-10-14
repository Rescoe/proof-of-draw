// consensus-pod/host/tft28_enroll_harness.cpp — LOT TFT28-PREVIEW-ENROLL-1 : exécute sur l'HÔTE le VRAI setup() puis la VRAIE loop() du firmware COMPLET (arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino) compilé avec
// -DPOD_PREVIEW_ENROLL=1 (POD_VOTE_CANARY = 0, POD_CANARY = 0), contre les bibliothèques simulées de consensus-pod/host/tft28/ (réseau scripté, TFT, tactile, carte SD avec COMPTEURS d'accès, piles dédiées PodNet / PodEd
// réelles en mode hôte, EEPROM simulée) et la vraie bibliothèque Crypto (auto-test Ed25519). Il imprime des FAITS (« FACT clé=valeur », « LOG <ligne> ») ; les verdicts sont rendus par tests/tft28PreviewEnroll.test.ts.
//   tft28_enroll_harness <scénario>   (unpaired | paired | regfail | http500)
#define POD_NET_HOST_TEST 1
#define POD_ED_HOST_TEST 1
#include "tft28_mock.h"
extern "C" { char g_fakeRam[8192]; char g_fakeStack[1024 + 64]; }
asm(".globl __HeapLimit\n.set __HeapLimit, g_fakeRam+4096\n.globl __StackLimit\n.set __StackLimit, g_fakeStack\n.globl __StackTop\n.set __StackTop, g_fakeStack+1024\n");
extern "C" char* harness_sbrk(int) { return g_fakeRam + 1000; }
#define sbrk harness_sbrk
static inline volatile uint8_t* harnessFrame() { return (volatile uint8_t*)g_fakeStack + 700; }
#define __builtin_frame_address(x) harnessFrame()
template <class T> static inline T max(T a, T b) { return a > b ? a : b; }
// L'arrêt sûr du firmware (for (;;) { __asm volatile("nop"); }, silencieux) est OBSERVABLE : exception à son entrée.
struct HarnessStop {};
static void harnessStopTrap();
#define __asm harnessStopTrap(); __asm__
#define setup tft28_setup
#define loop tft28_loop
#include "sketch_body.inc"
#undef setup
#undef loop
#undef __asm
static void harnessStopTrap() { throw HarnessStop(); }
#undef __builtin_frame_address
#include "RNG.h"
RNGClass::RNGClass() {}
RNGClass::~RNGClass() {}
void RNGClass::rand(uint8_t*, size_t) { std::abort(); }
RNGClass RNG;

static std::string http(int code, const std::string& body) {
  return "HTTP/1.1 " + std::to_string(code) + " X\r\nContent-Length: " + std::to_string(body.size()) + "\r\nConnection: close\r\n\r\n" + body;
}
struct EK {
  std::string registerJson = "{\"deviceId\":\"dev_TEST0002\",\"pairCode\":\"WXYZ2345\",\"paired\":false}";
  int registerFails = 0, registerCode = 200;
};
static EK E;
static NetScript route(const NetRequest& r) {
  NetScript s;
  if (r.path.rfind("/api/register", 0) == 0) {
    if (E.registerFails > 0) { E.registerFails--; s.response = http(500, "{\"error\":\"boom\"}"); return s; }
    s.response = http(E.registerCode, E.registerCode == 200 ? E.registerJson : std::string("{\"error\":\"x\"}")); return s;
  }
  s.response = http(404, "{}"); return s;   // TOUTE autre route (pull, validate, candidate-frame, validation-result, ack, pull-frame, block-clip...) serait une faute : le test exige zéro requête
}
static int countReq(const char* path) { int n = 0; for (auto& r : g_requests) if (r.path.rfind(path, 0) == 0) n++; return n; }

int main(int argc, char** argv) {
  const std::string sc = argc > 1 ? argv[1] : "unpaired";
  uint8_t seed[32]; for (int i = 0; i < 32; i++) seed[i] = (uint8_t)(i * 7 + 3);
  g_us = 1000000; g_requests.clear(); g_route = route; g_idleHook = nullptr; E = EK();
  g_sd = SdState(); g_tft = TftState(); Serial.log.clear();
  podNetTestHook = nullptr; podNetTestFailAlloc = 0; podNetTestNested = 0; podEdTestHook = nullptr; podEdTestFailAlloc = 0; podEdTestNested = 0;
  std::memset(g_fakeStack, 0, sizeof g_fakeStack);
  for (int i = 0; i < 32; i++) { EEPROM.m[i] = seed[i]; privateKey[i] = seed[i]; }   // clés déjà générées et cohérentes (carte de production déjà utilisée)
  PodEd::derivePublicKey(publicKey, privateKey);
  EEPROM.m[64] = 0xED; for (int i = 0; i < 32; i++) EEPROM.m[65 + i] = publicKey[i];
  EEPROM.m[97] = 0x01;
  registered = false; paired = false; deviceId = ""; pairCode = ""; lastFrameId = "";
  if (sc == "paired") E.registerJson = "{\"deviceId\":\"dev_TEST0002\",\"pairCode\":\"WXYZ2345\",\"paired\":true}";
  if (sc == "regfail") E.registerFails = 100;
  if (sc == "http500") E.registerCode = 500;
  g_hwTft = g_hwTouch = g_hwSd = g_hwOnSd = 0; g_touchPollCount = 0;
  const int eepromPutsBefore = EEPROM.puts;
  int stopped = 0, crashed = 0;
  try {
    tft28_setup();
    const int setupReq = (int)g_requests.size();
    std::printf("FACT setup_requests=%d\n", setupReq);
    for (int i = 0; i < 200; i++) { g_us += 15 * 1000000ull; tft28_loop(); }
  } catch (HarnessStop&) { stopped = 1; } catch (HarnessReset&) { crashed = 1; }
  std::printf("FACT scenario=%s\nFACT stopped=%d\nFACT crashed=%d\n", sc.c_str(), stopped, crashed);
  std::printf("FACT enroll_halted=%d\n", g_enrollHalted ? 1 : 0);
  std::printf("FACT registered=%d\nFACT paired=%d\nFACT deviceId=%s\nFACT pairCode=%s\n", registered ? 1 : 0, paired ? 1 : 0, deviceId.c_str(), pairCode.c_str());
  std::printf("FACT requests_total=%d\nFACT registers=%d\n", (int)g_requests.size(), countReq("/api/register"));
  std::printf("FACT pulls=%d\nFACT validates=%d\nFACT reads=%d\nFACT posts=%d\nFACT acks=%d\nFACT pullframes=%d\nFACT clips=%d\nFACT obs=%d\nFACT bench=%d\n", countReq("/api/pull?"), countReq("/api/validate-candidate"), countReq("/api/candidate-frame"), countReq("/api/validation-result"), countReq("/api/ack-frame"), countReq("/api/pull-frame"), countReq("/api/block-clip"), countReq("/api/obs-confirm"), countReq("/api/bench"));
  for (auto& r : g_requests) std::printf("REQ %s\n", r.path.c_str());
  std::printf("FACT hw_tft=%ld\nFACT hw_touch=%ld\nFACT hw_sd=%ld\nFACT hw_onsd=%ld\n", g_hwTft, g_hwTouch, g_hwSd, g_hwOnSd);
  std::printf("FACT tft_bus=%ld\nFACT tft_fills=%ld\nFACT tft_texts=%ld\nFACT tft_windows=%ld\nFACT touch_polls=%ld\n", g_tft.busBytes, g_tft.fills, g_tft.texts, g_tft.windows, g_touchPollCount);
  std::printf("FACT sd_opens=%ld\nFACT sd_writes=%ld\nFACT sd_reads=%ld\nFACT sd_removes=%ld\n", g_sd.opens, g_sd.writes, g_sd.reads, g_sd.removes);
  bool lockBlank = true; for (int i = 5120; i < 7168; i++) if (EEPROM.m[i] != 0xFF) lockBlank = false;
  std::printf("FACT lock_blank=%d\nFACT eeprom_puts=%d\n", lockBlank ? 1 : 0, EEPROM.puts - eepromPutsBefore);
  size_t pos = 0; const std::string& L = Serial.log;
  while (pos < L.size()) { size_t e = L.find('\n', pos); if (e == std::string::npos) e = L.size(); const std::string line = L.substr(pos, e - pos); if (line.find("[ENROLL") != std::string::npos || line.find("[BOOT") != std::string::npos || line.find("[REGISTER") != std::string::npos || line.find("[WIFI") != std::string::npos || line.find("[PULL") != std::string::npos || line.find("[VOTE") != std::string::npos || line.find("[VALIDATE") != std::string::npos || line.find("[TOUCH") != std::string::npos || line.find("[SD") != std::string::npos || line.find("[FRAME") != std::string::npos || line.find("[ACK") != std::string::npos) std::printf("LOG %s\n", line.c_str()); pos = e + 1; }
  return 0;
}
