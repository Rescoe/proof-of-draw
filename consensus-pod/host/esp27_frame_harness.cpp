// consensus-pod/host/esp27_frame_harness.cpp — LOT8B2C-ESP8266-EINK27-OLED-CANARY-1 : exécute sur l'HÔTE le CODE RÉEL de esp_eink_2.7BW_OLED.ino (fragments extraits mot pour mot par tests/esp8266Eink27OledCanary.test.ts dans
// esp27_*.inc) et de epd2in7_V2.cpp (ReadBusy, DisplayStream) contre un environnement ESP8266 SIMULÉ (esp_mock/esp_mock.h + esp27_mock.h : HTTP/TLS, tas, horloge virtuelle, panneau, bus SPI / I2C avec le conflit GPIO12, OLED,
// LittleFS, RTC). Compilé en trois configurations : OFF, ON (POD_RENDER_V1=1), CANARI (1/1), avec ou sans HARNESS_VOTE (doPull, doValidate, doObsConfirm — ArduinoJson réel).
//   esp27_frame_harness  →  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// Ce que l'hôte PROUVE : plan de 5 808 o exact sous fragmentation, TLS fermé AVANT toute opération du panneau, plan relu de la flash APRÈS le TLS, refus (tronqué / trop long / surplus), pannes d'allocation / flash / TLS, tampons et fichier
// temporaire libérés sur chaque échec, aucun ACK hors succès (l'ACK DÉCIDE du succès en canari), aucun vote, bus SPI/I2C et OLED corrects après l'e-ink, BUSY borné et mesuré en canari (infini en production, documenté), producteur ≤ 32 o avec
// yield, renderHash/frameHash recalculés. Ce qu'il NE PROUVE PAS : BearSSL réel, tas réel, durées réelles, chien de garde matériel, panneau et OLED réels, ORIENTATION physique.
#include "esp_mock/esp27_mock.h"
#include "../src/adapters/crypto_posix.h"
typedef PodSha256Host PodSha256Br;
#include "podRenderStream.h"
#define POD_RENDER_MODE_DEFAULT POD_R_FIT
using std::max;   // Arduino.h fournit max() : le doPull extrait l'appelle sans qualification
#ifndef POD_RENDER_V1
#error "POD_RENDER_V1 doit être défini (-DPOD_RENDER_V1=0|1)"
#endif
#ifndef POD_CANARY
#define POD_CANARY 0
#endif
#ifdef HARNESS_VOTE
#include <ArduinoJson.h>
#endif

// ── modules de l'animation / du banc d'essai : stubs qui COMPTENT les appels (le sketch réel les appelle depuis doPull) ─────────────────────────────
namespace podanimesp {
  struct State { bool fsOk = true; bool on = false; String pendingHash; size_t pendingBytes = 0; };
  static int g_onPull = 0, g_acquire = 0, g_forget = 0;
  inline void onPull(State& st, const char* hash, size_t bytes) { g_onPull++; st.pendingHash = (hash && std::strlen(hash) == 64) ? String(hash) : String(""); st.pendingBytes = st.pendingHash.length() ? bytes : 0; }
  inline bool acquire(State&, const String&) { g_acquire++; ev("ANIM acquire (requete de clip)"); return false; }
  inline void forget(State&) { g_forget++; }
}
namespace podbenchesp { struct State { bool mode = false; }; static int g_onPull = 0; static bool g_lastMode = false; inline void onPull(State& s, bool m) { g_onPull++; g_lastMode = m; s.mode = m; } }
extern podbenchesp::State g_bench;
podbenchesp::State g_bench;

// ── pilote simulé : ReadBusy() et DisplayStream() RÉELS sont extraits de epd2in7_V2.cpp (esp27_driver.inc) ────────────────────────────────────────
static uint64_t g_busyUntilUs = 0; static bool g_busyStuck = false; static uint64_t g_refreshBusyUs = 3500000ULL; static uint32_t g_spiByteUs = 6;
class Epd {
 public:
  unsigned int busy_pin = 16; unsigned int WIDTH = 176, HEIGHT = 264;
  typedef unsigned int (*ProduceFn)(void* ctx, unsigned char* out, unsigned int cap);
  int Init() {
    ev("epd_init"); if (g_liveClients > 0) ev("VIOLATION epd_init pendant TLS"); if (!g_spiActive) ev("VIOLATION epd_init sans SPI actif");
    if (g_epdInit) return g_epdInit;
    g_busyUntilUs = g_us + 120000; ReadBusy();          // comme Init() : après le reset, puis après SWRESET
    SendCommand(0x12); g_busyUntilUs = g_us + 40000; ReadBusy();
    return 0;
  }
  void Sleep() { ev("epd_sleep"); }
  void Display(const unsigned char* b) { ev("epd_display"); if (g_liveClients > 0) ev("VIOLATION epd_display pendant TLS"); panel[0x24].assign(b, b + 5808); TurnOnDisplay(); }
  void SendCommand(unsigned char c) {
    cur = c; panel[c].clear(); if (cmdCount++ == 0) ev("epd_first_command");
    if (g_liveClients > 0) ev("VIOLATION commande pendant TLS"); if (!g_spiActive) ev("VIOLATION commande sans SPI actif"); noteNoFeedGap();
  }
  void SendData(unsigned char d) { panel[cur].push_back(d); advanceUs(g_spiByteUs); noteNoFeedGap(); }
  void TurnOnDisplay() { SendCommand(0x22); SendData(0xF7); SendCommand(0x20); g_busyUntilUs = g_us + g_refreshBusyUs; ReadBusy(); ev("epd_refresh"); refreshes++; }
  void ReadBusy();
  bool DisplayStream(ProduceFn produce, void* ctx);
  bool DisplayStreamReal(ProduceFn produce, void* ctx);
  static int DigitalRead(unsigned int) { return (g_busyStuck || g_us < g_busyUntilUs) ? 1 : 0; }
  static void DelayMs(unsigned int ms) { delay(ms); }
  std::map<int, std::vector<uint8_t>> panel; int cur = 0, refreshes = 0, cmdCount = 0;
  static inline int g_epdInit = 0;
};
static unsigned int g_failProduceAt = 0, s_callNo = 0; static Epd::ProduceFn s_realProduce; static void* s_realCtx; static uint32_t g_producerCalls = 0, g_producerMaxCap = 0;
static unsigned int tramp(void*, unsigned char* out, unsigned int cap) { s_callNo++; g_producerCalls++; if (cap > g_producerMaxCap) g_producerMaxCap = cap; if (g_failProduceAt && s_callNo == g_failProduceAt) { ev("producteur interrompu"); return 0; } noteNoFeedGap(); return s_realProduce(s_realCtx, out, cap); }
bool Epd::DisplayStream(ProduceFn produce, void* ctx) { s_realProduce = produce; s_realCtx = ctx; s_callNo = 0; return DisplayStreamReal(tramp, nullptr); }

extern "C" { char _data_start; char _bss_end; }   // symboles de l'éditeur de liens ESP8266 (RAM statique) : valeurs factices sur l'hôte
#include "esp27_cfg.inc"
podanimesp::State g_anim;   // défini dans le sketch plus bas (état de l'animation) ; ici seul fsOk compte

// ── dépendances simulées du code extrait ──────────────────────────────────────────────────────────────────────�
static std::string g_postPaths;
bool httpPost(const String& path, const String& body, String& resp) { (void)body; g_httpPostCalls++; WiFiClientSecure tlsForPost; tlsForPost.tlsOpen(); g_lastPostPath = path.c_str(); g_postPaths += path.c_str(); g_postPaths += ";"; ev(std::string("POST ") + path.c_str()); resp = ""; if (path == "/api/ack-frame") { g_ackCalls++; return g_ackResult; } return true; }
bool httpGet(const String& path, String& resp) { g_httpGetCalls++; ev(std::string("GET ") + path.c_str()); resp = ""; return false; }
static int g_validateV2Calls = 0, g_registerCalls = 0, g_signCalls = 0, g_ownedSaves = 0, g_blockSaves = 0, g_fetchOledCalls = 0;
bool doValidateV2(const String&, const String&, size_t, const String&) { g_validateV2Calls++; ev("doValidateV2"); return false; }
bool doRegister() { g_registerCalls++; ev("doRegister"); return true; }
String signED25519(const String&, float) { g_signCalls++; ev("sign"); return String("sig"); }
char* dtostrf(double v, signed char, unsigned char p, char* s) { std::snprintf(s, 16, "%.*f", p, v); return s; }
static void oledBufFreeForTLS() {}
static void oledBufRestoreAfterTLS() {}
void saveOwnedBlockHash(const String&) { g_ownedSaves++; }
void saveBlockHashToEEPROM(const String&) { g_blockSaves++; }
bool doFetchFrameOLED(const String&, const String&) { g_fetchOledCalls++; ev("doFetchFrameOLED"); return true; }
// gravure du cartel en place (chemin OFF) : fonction du sketch non extraite, remplacée par un témoin
static int g_burnCalls = 0;
void burnEinkCartel_landscape(uint8_t*, const String&, const String&, const String&, int) { g_burnCalls++; ev("burn_cartel"); }
#include "esp27_bus.inc"
#include "esp27_ack.inc"
#include "esp27_display.inc"
#include "esp27_fetch.inc"
#ifdef HARNESS_VOTE
#include "esp27_pull.inc"
#include "esp27_vote.inc"
#endif
#define DisplayStream DisplayStreamReal
#include "esp27_driver.inc"
#undef DisplayStream

// ── mini cadre de test ─────────────────────────────────────────────────────────────────────────────
static int g_checks = 0; static std::vector<std::string> g_fail;
#define CHECK(cond, msg) do { g_checks++; if (!(cond)) g_fail.push_back(std::string(msg) + " [" #cond "]"); } while (0)

static const size_t PLANE = 5808;
static std::vector<uint8_t> mkFrame(int kind, uint32_t seed) {   // 5 808 o : plan BW unique (1 = blanc, 0 = encre)
  std::vector<uint8_t> f(PLANE, 0xFF); uint32_t x = seed * 2654435761u + 12345;
  auto rnd = [&]() { x = x * 1103515245u + 12345u; return (uint8_t)(x >> 16); };
  switch (kind) {
    case 0: for (size_t i = 0; i < PLANE; i++) f[i] = rnd() | rnd(); break;            // bruit clairsemé
    case 1: break;                                                                      // tout blanc (uniforme)
    case 2: std::fill(f.begin(), f.end(), 0x00); break;                                // tout noir (uniforme)
    case 4: f[2000] = 0x7F; break;                                                      // presque uniforme : un pixel noir
  }
  return f;
}
static std::string frameHex(const std::vector<uint8_t>& f) { PodSha256Host h; const PodRenderSpec s = pod_render_spec(POD_R_EINK27); pod_render_hash_begin_frame(h, s); h.update(f.data(), PLANE); char hex[65]; pod_render_hash_end(h, hex); return hex; }
static std::string renderHexOfPanel(Epd& e) { PodSha256Host h; const PodRenderSpec s = pod_render_spec(POD_R_EINK27); pod_render_hash_begin_render(h, s, POD_R_FIT); h.update(e.panel[0x24].data(), e.panel[0x24].size()); char hex[65]; pod_render_hash_end(h, hex); return hex; }
static std::string field(const std::string& log, const char* key) { size_t p = log.find(key); if (p == std::string::npos) return ""; p += std::strlen(key); size_t q = p; while (q < log.size() && std::isxdigit((unsigned char)log[q])) q++; return log.substr(p, q - p); }
static int logCount(const char* needle) { int n = 0; size_t q = 0; while ((q = Serial.log.find(needle, q)) != std::string::npos) { n++; q++; } return n; }
static bool logHas(const char* needle) { return Serial.log.find(needle) != std::string::npos; }
static std::vector<uint8_t> artPattern() { std::vector<uint8_t> a(1024); for (size_t i = 0; i < a.size(); i++) a[i] = (uint8_t)(i * 7 + 3); return a; }

static void resetWorld() {
  g_ev.clear(); Serial.log.clear(); g_allocs.clear(); g_outstanding = g_peakOutstanding = 0; g_mallocCount = 0; g_failMallocAt = 0; g_heapTotal = 38000; g_tlsBytes = 0; g_leakBytes = 0; WiFiClientSecure::g_leakOnClose = 0; g_fragBytes = 2000;
  g_us = 1000000; g_pump = nullptr; g_yields = 0; g_wdt = 0; g_liveClients = 0; g_ackCalls = 0; g_ackResult = true; g_httpGetCalls = g_httpPostCalls = 0; g_postPaths.clear(); g_lastFeedUs = g_us; g_maxNoFeedUs = 0;
  g_scn = Scn(); g_failProduceAt = 0; g_producerCalls = 0; g_producerMaxCap = 0; Epd::g_epdInit = 0; g_contStack = 3000; g_rst = { 0, 0, 0, 0, 0, 0, 0 }; std::memset(g_rtc, 0, sizeof g_rtc); g_haltOnDelayLoop = false;
  g_validateV2Calls = g_registerCalls = g_signCalls = g_ownedSaves = g_blockSaves = g_fetchOledCalls = 0; podanimesp::g_onPull = podanimesp::g_acquire = podanimesp::g_forget = 0; podbenchesp::g_onPull = 0; podbenchesp::g_lastMode = false;
  g_busyUntilUs = 0; g_busyStuck = false; g_refreshBusyUs = 3500000ULL;
  g_spiActive = false; g_wireOn = true; g_gpio12Spi = false; g_spiBegins = g_spiEnds = g_wireBegins = g_txDepth = 0; g_oledBeginOk = true; g_oledBegins = g_oledDisplays = 0; g_oledShown.clear();
  g_fs.clear(); g_fsOpenWriteFails = false; g_fsWriteFailAfter = -1; g_anim.fsOk = true; g_anim.on = false; g_anim.pendingHash = "";
  lastFrameIdE27 = ""; lastFrameIdOLED = ""; hasDisplayedFrame = false; lastFrameWasConsensus = false; pendingCandidateId = ""; pendingObsHashes = ""; pendingObsTarget = "";
  deviceId = "dev_TEST0001"; pendingWorkTitle = "Chat - pain"; pendingArtistName = "Roubzi"; pendingDisplayTs = "10/10/2026 09:15 (Paris)"; currentBlockIndex = 7;
  nextPullIntervalMs = PULL_INTERVAL; lastPullMs = 0; g_netFails = 0; oledTickActive = false; oledTicker = ""; lastTickMs = 0;
  epd27 = Epd(); lastE27RefreshMs = millis() - E27_MIN_REFRESH_MS;   // pas d'attente de 180 s sauf test dédié
  { const auto a = artPattern(); std::memcpy(g_oledArt, a.data(), a.size()); oledArtBuf = g_oledArt; oledReady = true; lastScreenWasSPI = false; }   // état d'une carte démarrée : OLED prête, une affiche en mémoire
#if POD_RENDER_V1 && POD_CANARY
  g_pcRtc = { 0, 0, 0, 0 }; g_pcStepMs = 0; g_pcHeapPre = 0; g_pcMinHeap = 0xFFFFFFFFUL; g_pcCalls = 0; g_pcEnterUs = 0; g_pcLastEndUs = 0; g_pcMaxCallUs = 0; g_pcMaxGapUs = 0; g_pcMinStack = 0xFFFF;
  g_pcBusyCalls = g_pcBusyTotalMs = g_pcBusyMaxMs = g_pcBusyTimeouts = 0;
#endif
}
struct Res { bool ret = false; bool restarted = false; bool halted = false; };
static Res fetch(const std::vector<uint8_t>& frame, const char* id = "frame-1") {
  Res r; g_scn.body = frame; g_pump = [] {};
  try { r.ret = doFetchFrameE27(id, "personal"); } catch (HostRestart&) { r.restarted = true; } catch (HostHalt&) { r.halted = true; }
  return r;
}
static bool nothingHeld() { return g_outstanding == 0 && g_fs.empty(); }
/** Échec fermé : aucun ACK, aucun rendu, rien d'acquitté, rien de tenu (RAM et flash), aucune violation de bus. */
static bool failClosed(const char* why, bool displayed = false) {
  const bool ok = g_ackCalls == 0 && evIndex("POST /api/ack-frame") < 0 && lastFrameIdE27 == "" && nothingHeld() && evIndex("VIOLATION") < 0 && (displayed || (epd27.refreshes == 0 && !hasDisplayedFrame));
  if (!ok) g_fail.push_back(std::string("échec fermé violé : ") + why + " [ack=" + std::to_string(g_ackCalls) + " id=" + lastFrameIdE27.c_str() + " tenu=" + std::to_string(g_outstanding) + " fichiers=" + std::to_string(g_fs.size()) + " refresh=" + std::to_string(epd27.refreshes) + "]");
  g_checks++; return ok;
}
/** Bus après un affichage e-ink : SPI libéré, aucune transaction ouverte, OLED à ré-initialiser (oledReady faux) — état identique à displayE27Buffer() d'origine. */
static bool busIsClean() { return !g_spiActive && g_txDepth == 0 && !lastScreenWasSPI && g_spiBegins == g_spiEnds; }

int main() {
  const PodRenderSpec spec = pod_render_spec(POD_R_EINK27);
  // ═══ S1 : chemin nominal via la FLASH (LittleFS) ═══════════════════════════════════════════════════════════
  {
    resetWorld(); const auto f = mkFrame(0, 1); Res r = fetch(f);
    CHECK(r.ret, "S1 succès");
    CHECK(g_ackCalls == 1 && evCount("POST /api/ack-frame") == 1, "S1 un seul ACK");
    const int dtor = evIndex("tls_dtor"), init = evIndex("epd_init"), first = evIndex("epd_first_command"), ack = evIndex("POST /api/ack-frame"), refresh = evIndex("epd_refresh"), disp = evIndex("epd_display"), plane = evIndex("malloc_dummy");
    (void)plane;
#if POD_RENDER_V1
    CHECK(dtor >= 0 && init > dtor && first > dtor, "S1 TLS FERMÉ (client détruit) AVANT toute opération du panneau");
    CHECK(ack > refresh && refresh > first, "S1 ACK APRÈS le rafraîchissement du panneau");
#else
    CHECK(dtor >= 0 && init > dtor && disp > init, "S1 (OFF) TLS FERMÉ AVANT toute opération du panneau");
    CHECK(ack > disp, "S1 (OFF) ACK APRÈS Display()");
    (void)first; (void)refresh;
#endif
    CHECK(evIndex("VIOLATION") < 0, "S1 aucune violation (panneau pendant TLS, panneau sans SPI, OLED sur SPI)");
    CHECK(lastFrameIdE27 == "frame-1" && hasDisplayedFrame, "S1 état mis à jour après succès");
    CHECK(g_outstanding == 0 && g_fs.empty(), "S1 plan libéré AVANT l'ACK et fichier temporaire supprimé");
    CHECK(Serial.log.find("via flash") != std::string::npos, "S1 réception par la flash (aucun plan en RAM pendant le TLS)");
    CHECK(g_liveClients == 0, "S1 aucun client TLS vivant");
    CHECK(epd27.panel[0x24].size() == PLANE, "S1 un plan de 5 808 o remis au pilote");
    CHECK(busIsClean(), "S1 SPI libéré, aucune transaction ouverte");
#if POD_RENDER_V1
    CHECK(frameHex(f) == field(Serial.log, "frameHash="), "S1 frameHash recalculé indépendamment (octets reçus)");
    CHECK(renderHexOfPanel(epd27) == field(Serial.log, "renderHash="), "S1 renderHash recalculé sur les octets REMIS au pilote");
    CHECK(g_producerMaxCap <= 32 && g_producerCalls >= 182, "S1 producteur appelé par morceaux de 32 o au plus (5 808 / 32 = 182 appels)");
    CHECK(g_yields >= g_producerCalls, "S1 yield() à chaque morceau");
#else
    CHECK(g_burnCalls >= 1 && epd27.panel[0x24].size() == PLANE, "S1 (OFF) cartel gravé en place puis plan remis");
#endif
    CHECK(g_maxNoFeedUs < 3000000ULL, "S1 jamais 3 s sans delay()/yield()/wdtFeed() : le chien de garde logiciel n'expire pas");
  }
  // ═══ S1b : même chemin sans système de fichiers (RAM, ancien chemin) ═════════════════════════════════════════
  {
    resetWorld(); g_anim.fsOk = false; const auto f = mkFrame(0, 2); Res r = fetch(f);
    CHECK(r.ret && g_ackCalls == 1 && lastFrameIdE27 == "frame-1", "S1b RAM : succès et un ACK");
    CHECK(Serial.log.find("via RAM") != std::string::npos && g_fs.empty() && g_outstanding == 0, "S1b RAM : plan libéré avant l'ACK, aucun fichier");
#if POD_RENDER_V1
    CHECK(frameHex(f) == field(Serial.log, "frameHash="), "S1b RAM : frameHash exact");
#endif
  }
  // ═══ S2 : fragmentation (flash et RAM) ═════════════════════════════════════════════════════════════════════
  {
    const std::vector<std::vector<size_t>> pats = { {1}, {7}, {239, 240, 241}, {1448}, {5808}, {5807, 1}, {1, 5807}, {100, 333, 5000}, {2, 3, 5, 7, 11, 13, 17, 19, 23, 4096} };
    int ok = 0, n = 0;
    for (int ram = 0; ram < 2; ram++) for (size_t pi = 0; pi < pats.size(); pi++) {
      resetWorld(); g_anim.fsOk = !ram; const auto f = mkFrame(0, 7 + (int)pi); g_scn.chunks = pats[pi]; g_scn.chunkEveryMs = pats[pi][0] <= 2 ? 1 : 5;
      Res r = fetch(f); n++;
      bool good = r.ret && g_ackCalls == 1 && g_outstanding == 0 && g_fs.empty();
#if POD_RENDER_V1
      good = good && frameHex(f) == field(Serial.log, "frameHash=");
#else
      good = good && epd27.panel[0x24].size() == PLANE;
#endif
      if (good) ok++; else g_fail.push_back("S2 fragmentation " + std::string(ram ? "RAM " : "flash ") + std::to_string(pi));
    }
    g_checks++; if (ok != n) g_fail.push_back("S2 fragmentation : " + std::to_string(ok) + "/" + std::to_string(n));
    int bad = 0; uint32_t x = 99;
    for (int i = 0; i < 200; i++) {
      resetWorld(); g_anim.fsOk = (i & 1); const auto f = mkFrame(i % 4, i); g_scn.chunks.clear(); for (int k = 0; k < 40; k++) { x = x * 1103515245u + 12345u; g_scn.chunks.push_back(1 + (x >> 16) % 1500); } g_scn.chunkEveryMs = 1 + i % 4;
      Res r = fetch(f); if (!(r.ret && g_ackCalls == 1)) bad++;
    }
    CHECK(bad == 0, "S2 200 découpages aléatoires : réussite et un ACK chacun");
  }
  // ═══ S3 : corps tronqué / silence ═══════════════════════════════════════════════════════════════════════════
  for (int variant = 0; variant < 3; variant++) for (int ram = 0; ram < 2; ram++) {
    resetWorld(); g_anim.fsOk = !ram; auto f = mkFrame(0, 3);
    if (variant == 0) f.resize(PLANE - 1);            // un octet de moins
    if (variant == 1) f.resize(PLANE / 2);
    if (variant == 2) f.resize(10);
    g_scn.contentLength = (int)PLANE;                 // annoncé complet
    Res r = fetch(f);
    CHECK(!r.ret, "S3 retourne false"); failClosed("S3 tronqué");
    CHECK(evIndex("tls_dtor") >= 0 && g_liveClients == 0, "S3 TLS fermé aussi sur l'échec");
    CHECK(millis() - 1000 >= 14000, "S3 attente bornée (≈ 15 s virtuelles), pas de boucle infinie");
  }
  // ═══ S4 : corps trop long / surplus / Content-Length inconnu ═════════════════════════════════════════════════
  {
    resetWorld(); auto f = mkFrame(0, 4); f.insert(f.end(), 8, 0xAB); g_scn.contentLength = (int)PLANE + 8;
    Res r = fetch(f);
#if POD_RENDER_V1 && POD_CANARY
    CHECK(!r.ret, "S4a CANARI : Content-Length 5816 refusé"); failClosed("S4a");
    CHECK(logHas("REFUS : corps de taille inattendue"), "S4a message de refus");
#else
    CHECK(r.ret && g_ackCalls == 1, "S4a (hors canari) les octets en trop sont vidés par http.end() : comportement existant, conservé");
#endif
    resetWorld(); auto g = mkFrame(0, 5); g.insert(g.end(), 8, 0xCD); g_scn.contentLength = (int)PLANE; g_scn.chunks = { PLANE + 8 };   // 8 octets en trop DÉJÀ arrivés
    r = fetch(g);
#if POD_RENDER_V1 && POD_CANARY
    CHECK(!r.ret, "S4b CANARI : surplus disponible refusé"); failClosed("S4b");
#else
    CHECK(r.ret && g_ackCalls == 1, "S4b (hors canari) surplus ignoré : comportement existant");
#endif
    resetWorld(); auto h = mkFrame(0, 6); g_scn.contentLength = -1; r = fetch(h);
#if POD_RENDER_V1 && POD_CANARY
    CHECK(!r.ret, "S4c CANARI : Content-Length absent / inconnu (-1) REFUSÉ même si 5 808 octets exacts arrivent"); failClosed("S4c");
    CHECK(logHas("REFUS : corps de taille inattendue"), "S4c message de refus");
#else
    CHECK(r.ret && g_ackCalls == 1, "S4c (hors canari) Content-Length inconnu (-1) : accepté si 5 808 octets exacts arrivent (comportement existant)");
#endif
    resetWorld(); auto h2 = mkFrame(0, 9); g_scn.contentLength = (int)PLANE; r = fetch(h2);
    CHECK(r.ret && g_ackCalls == 1, "S4e Content-Length EXACT (5 808) : accepté, ACK");
    resetWorld(); auto k = mkFrame(0, 7); g_scn.contentLength = (int)PLANE - 1; r = fetch(k);   // en-tête annonce 1 octet de moins que le plan attendu
#if POD_RENDER_V1 && POD_CANARY
    CHECK(!r.ret, "S4d CANARI : Content-Length trop COURT refusé"); failClosed("S4d");
#else
    (void)r;
#endif
  }
  // ═══ S5 : allocation / flash impossibles ═════════════════════════════════════════════════════════════════════
  {
    // flash : ouverture du fichier temporaire impossible => repli sur la RAM ; si le malloc du repli échoue aussi => aucun TLS
    resetWorld(); g_fsOpenWriteFails = true; g_failMallocAt = 1; Res r = fetch(mkFrame(0, 8));
    CHECK(!r.ret, "S5a flash KO + malloc KO : false"); failClosed("S5a"); CHECK(evIndex("tls_ctor") < 0 && g_httpGetCalls == 0, "S5a aucun TLS ouvert");
    // RAM : malloc KO => aucun TLS
    resetWorld(); g_anim.fsOk = false; g_failMallocAt = 1; r = fetch(mkFrame(0, 8));
    CHECK(!r.ret, "S5b RAM, malloc KO : false"); failClosed("S5b"); CHECK(evIndex("tls_ctor") < 0 && g_httpGetCalls == 0, "S5b aucun TLS ouvert");
    // flash : le plan ne peut pas être ALLOUÉ APRÈS le TLS (malloc KO au moment de la relecture) => fichier supprimé, aucun rendu, aucun ACK
    resetWorld(); g_failMallocAt = 1; r = fetch(mkFrame(0, 9));
    CHECK(!r.ret, "S5c flash : malloc KO après le TLS : false"); failClosed("S5c"); CHECK(evIndex("tls_dtor") >= 0, "S5c le TLS a été fermé avant l'allocation");
    // flash : écriture KO en cours de réception
    resetWorld(); g_fsWriteFailAfter = 1000; r = fetch(mkFrame(0, 10));
    CHECK(!r.ret, "S5d écriture flash KO : false"); failClosed("S5d");
  }
  // ═══ S6 : codes HTTP et begin() ═════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); g_scn.code = 404; Res r = fetch(mkFrame(0, 9)); CHECK(r.ret, "S6 404 : pas de frame, true"); failClosed("S6 404");
    resetWorld(); g_scn.code = 500; r = fetch(mkFrame(0, 9)); CHECK(!r.ret, "S6 500 : false"); failClosed("S6 500");
    resetWorld(); g_scn.beginFails = true; r = fetch(mkFrame(0, 9)); CHECK(!r.ret, "S6 begin() : false"); failClosed("S6 begin");
    resetWorld(); g_scn.code = -1; r = fetch(mkFrame(0, 9)); CHECK(!r.ret, "S6 TLS impossible (GET -1) : false"); failClosed("S6 TLS -1"); CHECK(g_netFails == 1 && logHas("échec réseau #1"), "S6 TLS impossible : noteNet compte l'échec");
  }
  // ═══ S7 : panneau / pilote (ON, CANARI) ═══════════════════════════════════════════════════════════════════════
#if POD_RENDER_V1
  {
    resetWorld(); Epd::g_epdInit = -1; Res r = fetch(mkFrame(0, 10));
    CHECK(!r.ret, "S7a Init() en échec : false"); failClosed("S7a");
    CHECK(epd27.cmdCount == 0, "S7a aucune donnée envoyée au panneau");
    CHECK(logHas("panneau non initialisé"), "S7a message");
    CHECK(busIsClean(), "S7a SPI libéré après l'échec d'initialisation");
#if POD_CANARY
    CHECK(oledReady, "S7a CANARI : l'OLED est re-vérifié et ré-initialisé même après un échec du panneau");
#else
    CHECK(oledReady, "S7a OBSERVATION (comportement d'ORIGINE, non corrigé) : après un échec d'initialisation du panneau, oledReady reste VRAI alors que le SPI a pris GPIO12 — seul le succès de l'e-ink le remet à faux");
#endif
    for (unsigned at : { 1u, 2u, 50u, 100u, 182u }) {
      resetWorld(); g_failProduceAt = at; r = fetch(mkFrame(0, 11));
      CHECK(!r.ret, "S7b producteur interrompu : false"); failClosed("S7b producteur");
      CHECK(evIndex("epd_refresh") < 0, "S7b rafraîchissement NON lancé après interruption");
      CHECK(busIsClean(), "S7b SPI libéré après l'interruption");
#if POD_CANARY
      CHECK(oledReady, "S7b CANARI : OLED re-vérifié");
#else
      CHECK(!oledReady, "S7b OLED à ré-initialiser (oledReady faux) après l'interruption du flux");
#endif
    }
    resetWorld(); CHECK(podRenderAndShowE27(nullptr) == 0, "S7c plan absent : 0"); CHECK(epd27.cmdCount == 0 && g_ackCalls == 0, "S7c rien envoyé");
  }
#endif
  // ═══ S8 : images défavorables ═════════════════════════════════════════════════════════════════════════════════
  for (int kind : { 1, 2, 4 }) {
    resetWorld(); const auto f = mkFrame(kind, 20 + kind); Res r = fetch(f);
    CHECK(r.ret && g_ackCalls == 1, "S8 image spéciale : succès et ACK");
#if POD_RENDER_V1
    CHECK(g_producerMaxCap <= 32 && g_producerCalls == 182, "S8 182 appels du producteur de ≤ 32 o, quelle que soit l'image");
    CHECK(renderHexOfPanel(epd27) == field(Serial.log, "renderHash="), "S8 renderHash cohérent");
    if (kind == 1) { int ink = 0; for (size_t i = 0; i < PLANE; i++) if (epd27.panel[0x24][i] != 0xFF) ink++; CHECK(ink > 0, "S8 image blanche : le cartel est tout de même gravé par le noyau"); }
#endif
  }
  // ═══ S9 : bus SPI / I2C et OLED — après un affichage e-ink, l'OLED doit être de nouveau utilisable ═══════════════
  {
    resetWorld(); const auto f = mkFrame(0, 30); const int spiBeginsBefore = g_spiBegins; Res r = fetch(f);
    CHECK(r.ret, "S9 succès");
    CHECK(g_spiBegins == spiBeginsBefore + 1 && g_spiEnds == g_spiBegins && g_txDepth == 0, "S9 un SPI.begin / un SPI.end, aucune transaction ouverte");
    CHECK(evIndex("Wire.begin") < evIndex("SPI.begin"), "S9 I2C remis proprement avant le SPI (comme activateSPI)");
    CHECK(!g_spiActive && !lastScreenWasSPI, "S9 SPI libéré, lastScreenWasSPI faux");
#if POD_RENDER_V1 && POD_CANARY
    CHECK(oledReady && g_oledDisplays >= 1 && g_wireOn && !g_gpio12Spi, "S9 CANARI : OLED ré-initialisé (Wire.begin puis oled.begin) après l'e-ink, GPIO12 rendu à l'I2C");
    CHECK(g_oledShown.size() == 1024 && std::equal(g_oledShown.begin(), g_oledShown.end(), artPattern().begin()), "S9 CANARI : l'affiche OLED est remise à l'écran à l'identique");
    CHECK(logHas("OLED apres l'e-ink : pret_avant=0 spi_actif_avant=0 reinit=OK affiche_en_memoire=1"), "S9 CANARI : diagnostic OLED journalisé");
#else
    CHECK(!oledReady, "S9 (hors canari) oledReady faux après l'e-ink : tickerStep() ré-initialise l'OLED (comportement d'origine)");
#endif
    // tickerStep : après l'e-ink l'OLED redémarre sans violation et affiche le ticker
    oledTicker = "Chat - pain / Roubzi"; oledTickActive = true; oledTickTotal = 200; oledTickStep = 0; lastTickMs = 0; oledReady = false; lastScreenWasSPI = true; g_spiActive = true; g_wireOn = false; g_gpio12Spi = true;   // état juste après un rendu
    g_ev.clear(); g_us += 100000; tickerStep();
    CHECK(oledReady && g_oledDisplays >= 1 && evIndex("VIOLATION") < 0, "S9 tickerStep après l'e-ink : OLED ré-initialisé et affiché, aucune violation de bus");
    CHECK(evIndex("SPI.end") < evIndex("Wire.begin") && evIndex("Wire.begin") < evIndex("oled.begin"), "S9 ordre : SPI.end, Wire.begin, oled.begin");
    // l'OLED seul (frame OLED / ticker) n'est pas perturbé par le chemin e-ink : displayOLED sans SPI
    resetWorld(); g_ev.clear(); std::vector<uint8_t> art = artPattern(); CHECK(displayOLED(art.data(), 1024), "S9 displayOLED seul : succès"); CHECK(evIndex("SPI.begin") < 0 && evIndex("VIOLATION") < 0, "S9 displayOLED seul : n'ouvre pas le SPI");
    // échec de l'OLED après l'e-ink : n'affecte pas le succès de l'e-ink (canari : journalisé, jamais décisif)
    resetWorld(); g_oledBeginOk = false; r = fetch(mkFrame(0, 31));
    CHECK(r.ret && g_ackCalls == 1 && lastFrameIdE27 == "frame-1", "S9 OLED en panne : l'e-ink reste un succès acquitté");
#if POD_RENDER_V1 && POD_CANARY
    CHECK(logHas("reinit=ECHEC") && logHas("OLED verifie apres l'e-ink"), "S9 OLED en panne : diagnostic ECHEC, étape journalisée");
#endif
  }
  // ═══ S10 : ACK refusé ═══════════════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); g_ackResult = false; Res r = fetch(mkFrame(0, 40));
    CHECK(g_ackCalls == 1 && evCount("POST /api/ack-frame") == 1, "S10 ACK refusé : UN SEUL essai réseau, pas de boucle");
#if POD_RENDER_V1 && POD_CANARY
    CHECK(!r.ret, "S10 CANARI : ACK refusé => retour false (le serveur reproposera la frame)");
    CHECK(lastFrameIdE27 == "", "S10 CANARI : frame NON marquée acquittée (lastFrameIdE27 inchangé)");
    CHECK(hasDisplayedFrame && epd27.refreshes >= 1, "S10 CANARI : l'écran a pu être affiché (dit clairement)");
    CHECK(logHas("ECHEC ACK") && !logHas("ACK recu") && logHas("N'EST PAS acquittee"), "S10 CANARI : échec journalisé, jamais « ACK reçu »");
    CHECK(g_pcRtc.phase != PCP_DONE, "S10 CANARI : aucune phase TERMINE");
    CHECK(g_outstanding == 0 && g_fs.empty(), "S10 CANARI : plan libéré");
    CHECK(logCount("flux pilote :") == 1, "S10 CANARI : rapport du flux émis UNE fois (après le rendu), pas le rapport de succès final");
    // le prochain pull (même frame, lastFrameIdE27 inchangé) la retente et, ACK accepté, la valide
    g_ackResult = true; g_ev.clear(); r = fetch(mkFrame(0, 40));
    CHECK(r.ret && lastFrameIdE27 == "frame-1", "S10 CANARI : le nouvel essai (prochain pull) réussit une fois l'ACK accepté");
#else
    CHECK(r.ret && lastFrameIdE27 == "frame-1", "S10 (production) ACK refusé : comportement existant conservé (résultat ignoré)");
#endif
  }
  // ═══ S11 : cycles répétés — aucune fuite ═════════════════════════════════════════════════════════════════════
  {
    resetWorld(); size_t maxOut = 0; for (int i = 0; i < 20; i++) {
      g_ev.clear(); g_scn = Scn(); lastFrameIdE27 = ""; Res r = fetch(mkFrame(0, 50 + i)); CHECK(r.ret, "S11 cycle"); if (g_outstanding > maxOut) maxOut = g_outstanding;
      if (i % 5 == 4) { g_failMallocAt = g_mallocCount + 1; Res q = fetch(mkFrame(0, 99)); CHECK(!q.ret && g_outstanding == 0 && g_fs.empty(), "S11 échec intercalé : tout libéré"); g_failMallocAt = 0; }
    }
    CHECK(maxOut == 0, "S11 rien n'est tenu après chaque cycle (le plan est libéré avant l'ACK)");
  }
  // ═══ S12 : attente minimale entre deux rafraîchissements (180 s) — documentée ═════════════════════════════════════
  {
    resetWorld(); lastE27RefreshMs = millis(); Res r = fetch(mkFrame(0, 60));
    CHECK(r.ret && logHas("[E27] attente refresh"), "S12 deux affichages rapprochés : attente de E27_MIN_REFRESH_MS (≈ 180 s) AVANT l'initialisation du panneau, TLS déjà fermé");
    CHECK(g_maxNoFeedUs < 3000000ULL, "S12 l'attente de 180 s se fait par delay() : le chien de garde est nourri");
  }
  // ═══ B : BUSY du pilote 2,7″ ═════════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); Res r = fetch(mkFrame(0, 70));
    CHECK(r.ret && g_maxNoFeedUs < 3000000ULL, "B1 BUSY normal : succès, chien de garde nourri");
#if POD_RENDER_V1 && POD_CANARY
    CHECK(g_pcBusyCalls == 3 && g_pcBusyTimeouts == 0 && g_pcBusyMaxMs >= 3400 && g_pcBusyMaxMs < 3700 && g_pcBusyTotalMs > 3500, "B1 CANARI : 3 attentes mesurées (2 à l'Init, 1 au rafraîchissement ≈ 3,5 s), aucun dépassement");
    CHECK(logHas("BUSY apres Init : attentes=2") && logHas("BUSY apres le rafraichissement : attentes=3"), "B1 CANARI : rapports BUSY journalisés");
    CHECK(!logHas("ALERTE : BUSY anormalement long"), "B1 CANARI : pas d'alerte BUSY en nominal");
    // BUSY bloqué à 1 (câble, polarité) : plafond de 20 s, on CONTINUE (comme le 2,9″ validé), tout est dit ; aucun reset
    resetWorld(); g_busyStuck = true; r = fetch(mkFrame(0, 71));
    CHECK(!r.halted && !r.restarted, "B2 CANARI : BUSY bloqué : pas de blocage infini, pas de reset");
    CHECK(g_pcBusyTimeouts == 3 && g_pcBusyMaxMs >= 20000 && g_pcBusyMaxMs < 20500, "B2 CANARI : 3 attentes plafonnées à 20 s (≈ 60 s au total), dépassements comptés");
    CHECK(logHas("e-Paper busy TIMEOUT (plafond canari)") && logHas("ALERTE : BUSY anormalement long ou bloque"), "B2 CANARI : TIMEOUT et ALERTE journalisés");
    CHECK(g_maxNoFeedUs < 3000000ULL, "B2 CANARI : chien de garde nourri pendant les 60 s d'attente (delay à chaque pas de 100 ms)");
    CHECK(!r.ret && g_ackCalls == 0 && evCount("POST /api/ack-frame") == 0, "B2 CANARI : BUSY plafonné => AUCUN ACK (échec fermé)");
    CHECK(lastFrameIdE27 == "" && g_pcRtc.phase != PCP_DONE && !logHas("ACK recu") && logHas("REFUS ACK : BUSY"), "B2 CANARI : frame NON acquittée, refus journalisé, jamais « ACK reçu »");
    CHECK(hasDisplayedFrame && g_outstanding == 0 && g_fs.empty() && g_oledDisplays >= 1, "B2 CANARI : ressources libérées, OLED remis en état, l'écran a PU être affiché (dit)");
    // BUSY long mais non plafonné (9 s > 8 s d'alerte) : même refus
    resetWorld(); g_refreshBusyUs = 9000000ULL; r = fetch(mkFrame(0, 72));
    CHECK(!r.ret && g_ackCalls == 0 && lastFrameIdE27 == "" && g_pcBusyTimeouts == 0 && logHas("REFUS ACK : BUSY"), "B4 CANARI : BUSY de 9 s (> alerte 8 s, sous le plafond) => aucun ACK, rien d'acquitté");
    // BUSY à la limite (7,5 s) : succès
    resetWorld(); g_refreshBusyUs = 7500000ULL; r = fetch(mkFrame(0, 73));
    CHECK(r.ret && g_ackCalls == 1 && lastFrameIdE27 == "frame-1", "B5 CANARI : BUSY de 7,5 s (sous l'alerte) : succès");
    // compteurs antérieurs à la frame (affichage d'avant) : remis à zéro, aucun faux refus
    resetWorld(); g_pcBusyTimeouts = 2; g_pcBusyMaxMs = 25000; r = fetch(mkFrame(0, 74));
    CHECK(r.ret && g_ackCalls == 1 && !logHas("REFUS ACK"), "B6 CANARI : compteurs BUSY d'un affichage ANTÉRIEUR ignorés (instantané avant le rendu)");
#else
    // PRODUCTION : ReadBusy() n'a AUCUN plafond. On le prouve en l'appelant DIRECTEMENT avec BUSY bloqué et la garde « delay en boucle » : il ne rend jamais la main de lui-même.
    resetWorld(); g_busyStuck = true; g_haltOnDelayLoop = true; bool returned = false, halted = false;
    try { epd27.ReadBusy(); returned = true; } catch (HostHalt&) { halted = true; }
    CHECK(halted && !returned, "B2 production : BUSY bloqué => ReadBusy() ne rend JAMAIS la main (attente indéfinie, documentée)");
    CHECK(g_ackCalls == 0, "B2 production : aucun ACK pendant l'attente");
#endif
#if POD_RENDER_V1 && POD_CANARY
    // canari : même appel direct => rend la main après le plafond de 20 s
    resetWorld(); g_busyStuck = true; g_haltOnDelayLoop = false; epd27.ReadBusy();
    CHECK(g_pcBusyTimeouts == 1 && g_pcBusyCalls == 1 && g_us - 1000000ULL >= 20000000ULL && g_us - 1000000ULL < 20300000ULL, "B3 CANARI : ReadBusy() direct avec BUSY bloqué rend la main après ≈ 20 s (un dépassement compté)");
#endif
  }
  // ═══ O : orientation / géométrie ════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); Res r = fetch(mkFrame(0, 80));
    CHECK(epd27.WIDTH == 176 && epd27.HEIGHT == 264 && E27_BUF_SIZE == 5808 && (176 / 8) * 264 == 5808, "O1 géométrie : contrôleur 176×264 portrait, plan de 5 808 o = 22 octets × 264 lignes");
#if POD_RENDER_V1
    CHECK(r.ret, "O1 spécification de rendu EINK27 valide");
    CHECK(epd27.panel[0x24].size() == 22u * 264u, "O1 le pilote reçoit exactement 22 × 264 octets");
#endif
  }
#if POD_RENDER_V1 && POD_CANARY
  // ═══ C1 : pré-vol TLS ═════════════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); g_heapTotal = 20000; Res r = fetch(mkFrame(0, 90));
    CHECK(!r.ret, "C1 tas insuffisant : refus"); failClosed("C1"); CHECK(evIndex("tls_ctor") < 0 && g_httpGetCalls == 0, "C1 aucun client TLS construit"); CHECK(logHas("REFUS pre-vol TLS"), "C1 message");
    resetWorld(); g_fragBytes = 30000; g_heapTotal = 45000; r = fetch(mkFrame(0, 91)); CHECK(!r.ret, "C1b bloc contigu insuffisant : refus"); failClosed("C1b");
    resetWorld(); g_heapTotal = 38000; r = fetch(mkFrame(0, 92)); CHECK(r.ret, "C1c tas nominal : accepté");
    // RAM : le plan de 5 808 o est tenu pendant le TLS => le pré-vol voit moins de tas
    resetWorld(); g_anim.fsOk = false; g_heapTotal = 29500; r = fetch(mkFrame(0, 93)); CHECK(!r.ret, "C1d RAM : 5 808 o tenus + tas juste => refus avant le TLS"); failClosed("C1d");
    resetWorld(); g_anim.fsOk = true; g_heapTotal = 29500; r = fetch(mkFrame(0, 94)); CHECK(r.ret, "C1e flash : même tas, aucun plan en RAM pendant le TLS => accepté");
  }
  // ═══ A : ACK en canari ═════════════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); Res r = fetch(mkFrame(0, 100));
    CHECK(r.ret && g_ackCalls == 1 && lastFrameIdE27 == "frame-1" && g_pcRtc.phase == PCP_OLED, "A1 ACK 200 : succès, frame acquittée");
    CHECK(logHas("ACK recu (HTTP 200)") && !logHas("ECHEC ACK"), "A1 journal");
    CHECK(evCount("tls_ctor") == 2 && evCount("POST /api/ack-frame") == 1, "A1 deux TLS (téléchargement, ACK), un seul ACK");
    CHECK(g_pcRtc.abn == 0, "A1 le succès remet le compteur de resets anormaux à zéro");
    // mémoire insuffisante AVANT l'ACK : la fermeture TLS laisse 15 000 o « perdus » => le pré-vol refuse l'ACK
    resetWorld(); WiFiClientSecure::g_leakOnClose = 15000; r = fetch(mkFrame(0, 101));
    CHECK(!r.ret, "A3 mémoire insuffisante avant l'ACK : false"); CHECK(g_ackCalls == 0 && evIndex("POST /api/ack-frame") < 0, "A3 AUCUN ACK envoyé"); CHECK(evCount("tls_ctor") == 1 && g_httpPostCalls == 0, "A3 aucun second TLS ouvert");
    CHECK(lastFrameIdE27 == "" && g_pcRtc.phase != PCP_DONE, "A3 frame non acquittée, aucun faux TERMINE");
    CHECK(hasDisplayedFrame && epd27.refreshes >= 1, "A3 l'écran a pu être affiché : dit"); CHECK(logHas("REFUS pre-vol TLS") && logHas("N'EST PAS acquittee") && !logHas("ACK recu"), "A3 diagnostic explicite");
    CHECK(g_outstanding == 0 && g_fs.empty(), "A3 plan libéré");
  }
  // ═══ C2 : tas non restitué ═══════════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); WiFiClientSecure::g_leakOnClose = 3000; Res r = fetch(mkFrame(0, 110)); CHECK(logHas("ALERTE tas non restitue"), "C2 fuite de 3 000 o signalée");
    resetWorld(); r = fetch(mkFrame(0, 111)); CHECK(logHas("tas restitue apres la fermeture TLS") && !logHas("ALERTE tas"), "C2 pas d'alerte sans fuite");
  }
  // ═══ C3 : trace RTC, étapes, statistiques ═══════════════════════════════════════════════════════════════════
  {
    resetWorld(); Res r = fetch(mkFrame(0, 120));
    CHECK(g_pcRtc.phase == PCP_OLED && g_rtc[0] == PCR_MAGIC, "C3 la dernière phase RTC est OLED_VERIFIE (juste après TERMINE)");
    for (const char* tag : { "frame e-ink 2,7 : debut", "destination du plan", "pre-vol TLS avant le telechargement", "TLS ouvert", "corps lu", "TLS FERME", "plan de 5808 o pret", "frameHash calcule", "panneau initialise", "flux remis au pilote", "renderHash", "rendu OK, pre-vol TLS avant l'ACK", "ACK recu (HTTP 200)", "OLED verifie apres l'e-ink" })
      CHECK(logHas(tag), std::string("C3 étape journalisée : ") + tag);
    CHECK(logHas("flux pilote : 182 appels du producteur"), "C3 rapport du flux (182 appels)"); CHECK(g_pcMinStack == 3000, "C3 pile cont minimale relevée");
    CHECK(logHas("destination du plan : fichier flash ouvert"), "C3 destination = flash");
    resetWorld(); Epd::g_epdInit = -1; r = fetch(mkFrame(0, 121));
    CHECK(g_pcRtc.phase == PCP_OLED && logHas("ECHEC rendu/affichage : AUCUN ACK"), "C3 échec du panneau : message d'échec, l'OLED est tout de même re-vérifié");
    CHECK(g_pcRtc.phase != PCP_DONE, "C3 aucune phase TERMINE après l'échec");
  }
  // ═══ C4 : démarrage, cause de reset, arrêt après deux resets anormaux ═══════════════════════════════════════
  {
    resetWorld(); g_rst.reason = 0; canaryBoot();
    CHECK(logHas("BUILD LOT8B2C-ESP8266-EINK27-OLED-CANARY-1") && !logHas("ALERTE : redemarrage ANORMAL"), "C4 démarrage normal : empreinte, pas d'alerte");
    CHECK(logHas("RAM statique=") && logHas("ORIENTATION PHYSIQUE A JUGER") && logHas("controleur 176x264 (portrait)") && logHas("plan BW unique 5808 o"), "C4 RAM statique et orientation affichées");
    resetWorld(); g_rst.reason = 3; canaryBoot(); CHECK(logHas("ALERTE : redemarrage ANORMAL") && g_pcRtc.abn == 1, "C4 reset ANORMAL détecté (1er)");
    uint32_t savedRtc[4]; std::memcpy(savedRtc, g_rtc, sizeof savedRtc);
    Serial.log.clear(); g_rst.reason = 2; std::memcpy(g_rtc, savedRtc, sizeof savedRtc); g_haltOnDelayLoop = true; g_pcRtc = { 0, 0, 0, 0 };
    bool halted = false; try { canaryBoot(); } catch (HostHalt&) { halted = true; }
    CHECK(halted && logHas("ARRET : deux redemarrages anormaux consecutifs"), "C4 deuxième reset anormal consécutif : ARRÊT sans réseau"); CHECK(g_httpGetCalls == 0 && g_httpPostCalls == 0, "C4 aucune requête");
    resetWorld(); g_rst.reason = 0; g_rtc[0] = PCR_MAGIC; g_rtc[3] = 1; canaryBoot(); CHECK(g_pcRtc.abn == 0, "C4 un reset normal remet le compteur à zéro");
    resetWorld(); g_rst.reason = 4; canaryBoot(); CHECK(logHas("redemarrage logiciel (ESP.restart)") && !logHas("ALERTE : redemarrage ANORMAL"), "C4 reset logiciel (ESP.restart, [HEAL]) : noté, non anormal");
  }
#endif
  // ═══ P : doPull — le VRAI doPull (réponses /api/pull simulées) ══════════════════════════════════════════════
#ifdef HARNESS_VOTE
  {
    auto pullWith = [](const char* json, int code, const char* lastId) {
      resetWorld(); lastFrameIdE27 = lastId; pendingCandidateId = ""; nextPullIntervalMs = 12345UL;
      g_scn = Scn(); g_scn.code = code; g_scn.body.assign(json, json + std::strlen(json));
      return doPull();
    };
    // P1 : frame déjà affichée (id e-ink) sans candidat => retryAfter du serveur ; un seul GET
    CHECK(pullWith("{\"frameSource\":\"personal\",\"frameId\":\"f1\",\"screen\":\"eink27bw\",\"retryAfter\":900}", 200, "f1") && nextPullIntervalMs == 900000UL && g_httpGetCalls == 1 && logHas("Frame déjà affichée"), "P1 frame e-ink identique + retryAfter 900 => 900 s, un seul GET, aucun téléchargement");
    // P2 : frame nouvelle => fetch e-ink immédiat
    pullWith("{\"frameSource\":\"personal\",\"frameId\":\"f2\",\"screen\":\"eink27bw\",\"retryAfter\":300}", 200, "f1"); CHECK(logHas("Nouvelle frame E27 frameId=f2") && g_httpGetCalls >= 2, "P2 frame nouvelle : récupérée immédiatement (second GET vers /api/pull-frame)");
    // P4 : le pointeur d'animation et le mode banc d'essai du pull
    pullWith("{\"frameSource\":\"none\",\"retryAfter\":300,\"benchMode\":true,\"anim\":{\"hash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"bytes\":7707}}", 200, "");
#if POD_RENDER_V1 && POD_CANARY
    CHECK(podbenchesp::g_lastMode == false && g_anim.pendingHash.length() == 0 && podanimesp::g_acquire == 0 && logHas("IGNORES en build canari") && evIndex("ANIM acquire") < 0, "P4 CANARI : banc d'essai et animation annoncés IGNORÉS, aucune requête de clip");
#else
    CHECK(podbenchesp::g_lastMode == true && g_anim.pendingHash.length() == 64, "P4 production : banc d'essai et pointeur d'animation transmis (inchangé)");
#endif
    // P5 : candidat annoncé : retenu (puis oublié par doValidate en canari), rythme nominal
    CHECK(pullWith("{\"frameSource\":\"none\",\"retryAfter\":900,\"pendingValidation\":{\"candidateId\":\"cand-1\"}}", 200, "") && pendingCandidateId == "cand-1" && nextPullIntervalMs == PULL_INTERVAL, "P5 candidat annoncé => retenu, rythme nominal (inchangé)");
    // P6 : 429 / 500 / JSON invalide inchangés
    CHECK(pullWith("{\"retryAfter\":30}", 429, "f1") && nextPullIntervalMs == 12345UL, "P6 429 : intervalle non touché");
    CHECK(pullWith("{}", 500, "f1") && nextPullIntervalMs == 12345UL, "P6b HTTP 500 : intervalle non touché");
  }
#endif
  // ═══ V : vote (doValidate / doObsConfirm) ══════════════════════════════════════════════════════════════════════
#ifdef HARNESS_VOTE
  {
    resetWorld(); pendingCandidateId = "cand-0123456789";
    const bool ret = doValidate();
#if POD_RENDER_V1 && POD_CANARY
    CHECK(!ret, "V1 canari : doValidate retourne false (aucun bloc miné)");
    CHECK(g_httpGetCalls == 0 && g_httpPostCalls == 0 && g_signCalls == 0 && g_validateV2Calls == 0 && g_registerCalls == 0, "V1 canari : AUCUN appel réseau, signature, vote v2 ni re-register");
    CHECK(pendingCandidateId == "", "V1 canari : candidat oublié localement");
    CHECK(logHas("AUCUN vote en build canari"), "V1 canari : message explicite");
    CHECK(logCount("\n") == 1, "V1 canari : UNE seule ligne");
    CHECK(g_outstanding == 0 && g_allocs.empty() && evIndex("malloc") < 0, "V1 canari : aucune allocation");
    CHECK(evIndex("POST /api/validation-result") < 0 && evIndex("GET /api/validate-candidate") < 0, "V1 canari : ni validation-result ni validate-candidate");
    resetWorld(); CHECK(!doValidate() && Serial.log.empty() && g_httpGetCalls == 0, "V1 canari : rien à faire sans candidat");
    resetWorld(); pendingObsHashes = "[\"a\"]"; pendingObsTarget = "t"; CHECK(doObsConfirm(), "V2 canari : doObsConfirm retourne true"); CHECK(g_httpPostCalls == 0 && pendingObsHashes == "" && logHas("IGNOREE en build canari"), "V2 canari : aucune requête /api/obs-confirm, tâche oubliée");
#else
    (void)ret;
    CHECK(g_httpGetCalls == 1 && evIndex("GET /api/validate-candidate?deviceId=dev_TEST0001") >= 0, "V1 production : doValidate interroge /api/validate-candidate (chemin de vote inchangé)");
    CHECK(!logHas("CANARY"), "V1 production : aucun message de canari");
    resetWorld(); pendingObsHashes = "[\"a\"]"; pendingObsTarget = "t"; doObsConfirm(); CHECK(g_httpPostCalls == 1 && g_lastPostPath == "/api/obs-confirm", "V2 production : /api/obs-confirm envoyé (inchangé)");
#endif
  }
#endif
  if (!g_fail.empty()) { for (auto& f : g_fail) std::printf("FAIL %s\n", f.c_str()); std::printf("log série :\n%s\n", Serial.log.substr(0, 1800).c_str()); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
