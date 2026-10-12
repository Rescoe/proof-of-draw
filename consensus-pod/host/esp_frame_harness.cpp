// consensus-pod/host/esp_frame_harness.cpp — LOT8B2C-ESP8266-EINK29-CANARY-1 : exécute sur l'HÔTE le CODE RÉEL de esp_eink_2.9BWR.ino (fragments extraits mot pour mot par tests/esp8266Eink29Canary.test.ts dans
// esp_*.inc) contre un environnement ESP8266 SIMULÉ (consensus-pod/host/esp_mock/esp_mock.h : HTTP/TLS, tas, horloge virtuelle, panneau, RTC). Compilé en trois configurations : OFF, ON (POD_RENDER_V1=1), CANARI (1/1).
//   esp_frame_harness  →  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// Ce que l'hôte PROUVE : ordre des opérations (TLS fermé AVANT le rendu), réception exacte de 9 472 o sous fragmentation, refus (tronqué / trop long / surplus), pannes d'allocation, tampons libérés sur chaque échec, aucun ACK hors succès,
// aucun vote en canari, pré-vol TLS, trace RTC, cause de reset, producteur ≤ 32 o avec yield, renderHash/frameHash recalculés. Ce qu'il NE PROUVE PAS : BearSSL réel, tas réel, durées réelles, chien de garde matériel, panneau réel.
#include "esp_mock/esp_mock.h"
#include "../src/adapters/crypto_posix.h"
typedef PodSha256Host PodSha256Br;
#include "podRenderStream.h"
#define POD_RENDER_MODE_DEFAULT POD_R_FIT
#ifndef POD_RENDER_V1
#error "POD_RENDER_V1 doit être défini (-DPOD_RENDER_V1=0|1)"
#endif
#ifndef POD_CANARY
#define POD_CANARY 0
#endif
#ifdef HARNESS_VOTE
#include <ArduinoJson.h>
#endif

// ── pilote simulé : l'Epd::DisplayStream RÉEL est extrait de epd2in9b_V4.cpp (esp_driver.inc) ────────────────────────────
class Epd {
 public:
  unsigned width = 128, height = 296;
  typedef unsigned int (*ProduceFn)(void* ctx, unsigned char* out, unsigned int cap);
  int Init() { ev("epd_init"); if (g_liveClients > 0) ev("VIOLATION epd_init pendant TLS"); return g_epdInit; }
  void Sleep() { ev("epd_sleep"); }
  void Display(const unsigned char* b, const unsigned char* r) { ev("epd_display"); if (g_liveClients > 0) ev("VIOLATION epd_display pendant TLS"); panel[0x24].assign(b, b + 4736); panel[0x26].resize(4736); for (int i = 0; i < 4736; i++) panel[0x26][i] = (uint8_t)~r[i]; refreshes++; }
  void SendCommand(unsigned char c) { cur = c; panel[c].clear(); if (cmdCount++ == 0) ev("epd_first_command"); if (g_liveClients > 0) ev("VIOLATION commande pendant TLS"); }
  void SendData(unsigned char d) { panel[cur].push_back(d); advanceUs(g_spiByteUs); }
  void TurnOnDisplay() { ev("epd_refresh"); refreshes++; }
  bool DisplayStream(ProduceFn produce, void* ctx);
  bool DisplayStreamReal(ProduceFn produce, void* ctx);
  std::map<int, std::vector<uint8_t>> panel; int cur = 0, refreshes = 0, cmdCount = 0;
  static inline int g_epdInit = 0; static inline uint32_t g_spiByteUs = 6;
};
static unsigned int g_failProduceAt = 0, s_callNo = 0; static Epd::ProduceFn s_realProduce; static void* s_realCtx; static uint32_t g_producerCalls = 0, g_producerMaxCap = 0;
static unsigned int tramp(void*, unsigned char* out, unsigned int cap) { s_callNo++; g_producerCalls++; if (cap > g_producerMaxCap) g_producerMaxCap = cap; if (g_failProduceAt && s_callNo == g_failProduceAt) { ev("producteur interrompu"); return 0; } return s_realProduce(s_realCtx, out, cap); }
bool Epd::DisplayStream(ProduceFn produce, void* ctx) { s_realProduce = produce; s_realCtx = ctx; s_callNo = 0; return DisplayStreamReal(tramp, nullptr); }

extern "C" { char _data_start; char _bss_end; }   // symboles de l'éditeur de liens ESP8266 (RAM statique) : valeurs factices sur l'hôte
#include "esp_cfg.inc"
#include "esp_state.inc"

// ── dépendances simulées du code extrait ───────────────────────────────────────────────────────────────────────────
static std::string g_postPaths;
bool httpPost(const String& path, const String& body, String& resp) { (void)body; g_httpPostCalls++; WiFiClientSecure tlsForPost; tlsForPost.tlsOpen();   /* chaque POST ouvre un TLS complet (BearSSL), fermé à la sortie */ g_lastPostPath = path.c_str(); g_postPaths += path.c_str(); g_postPaths += ";"; ev(std::string("POST ") + path.c_str()); resp = ""; if (path == "/api/ack-frame") { g_ackCalls++; return g_ackResult; } return true; }
bool httpGet(const String& path, String& resp, int* codeOut = nullptr) { g_httpGetCalls++; ev(std::string("GET ") + path.c_str()); resp = ""; if (codeOut) *codeOut = 200; return false; }
static int g_validateV2Calls = 0, g_registerCalls = 0, g_signCalls = 0;
bool doValidateV2(const String&, const String&, size_t, const String&) { g_validateV2Calls++; ev("doValidateV2"); return false; }
bool doRegister() { g_registerCalls++; ev("doRegister"); return true; }
String signED25519(const String&, float) { g_signCalls++; ev("sign"); return String("sig"); }
char* dtostrf(double v, signed char, unsigned char p, char* s) { std::snprintf(s, 16, "%.*f", p, v); return s; }

// gravure du cartel en place (chemin OFF) : fonction du sketch non extraite, remplacée par un témoin
static int g_burnCalls = 0;
void burnEinkCartel_29(uint8_t*, uint8_t*, const String&, const String&, const String&, int) { g_burnCalls++; ev("burn_cartel"); }
#include "esp_display.inc"
#include "esp_ack.inc"
#include "esp_fetch.inc"
#ifdef HARNESS_VOTE
static int g_ownedSaves = 0, g_blockSaves = 0;
void saveOwnedBlockHash(const String&) { g_ownedSaves++; }
void saveBlockHashToEEPROM(const String&) { g_blockSaves++; }
#include "esp_pull.inc"
#include "esp_vote.inc"
#endif
#define DisplayStream DisplayStreamReal
#include "esp_driver.inc"
#undef DisplayStream

// ── mini cadre de test ───────────────────────────────────────────────────────────────────────────────────────────
static int g_checks = 0; static std::vector<std::string> g_fail;
#define CHECK(cond, msg) do { g_checks++; if (!(cond)) g_fail.push_back(std::string(msg) + " [" #cond "]"); } while (0)
static std::string logHas(const char* needle) { return Serial.log.find(needle) != std::string::npos ? "oui" : "non"; }

static std::vector<uint8_t> mkFrame(int kind, uint32_t seed) {   // 9 472 o : plan noir puis plan rouge (1 = blanc, 0 = encre)
  std::vector<uint8_t> f(9472, 0xFF); uint32_t x = seed * 2654435761u + 12345;
  auto rnd = [&]() { x = x * 1103515245u + 12345u; return (uint8_t)(x >> 16); };
  switch (kind) {
    case 0: for (int i = 0; i < 4736; i++) f[i] = rnd() | rnd();                 // bruit clairsemé noir
            for (int i = 0; i < 4736; i++) f[4736 + i] = (rnd() & rnd() & rnd()) | 0xC3; break;
    case 1: break;                                                               // tout blanc (uniforme)
    case 2: std::fill(f.begin(), f.begin() + 4736, 0x00); break;                 // tout noir (uniforme)
    case 3: std::fill(f.begin() + 4736, f.end(), 0x00); break;                   // tout rouge
    case 4: f[2000] = 0x7F; break;                                                // presque uniforme : un pixel noir
    case 5: std::fill(f.begin(), f.end(), 0x00); break;                          // noir ET rouge partout : le rouge l'emporte
  }
  return f;
}
static std::string frameHex(const std::vector<uint8_t>& f) { PodSha256Host h; const PodRenderSpec s = pod_render_spec(POD_R_EINK29); pod_render_hash_begin_frame(h, s); h.update(f.data(), 9472); char hex[65]; pod_render_hash_end(h, hex); return hex; }
static std::string renderHexOfPanel(Epd& e) {
  PodSha256Host h; const PodRenderSpec s = pod_render_spec(POD_R_EINK29); pod_render_hash_begin_render(h, s, POD_R_FIT);
  h.update(e.panel[0x24].data(), e.panel[0x24].size());
  std::vector<uint8_t> red(e.panel[0x26].size()); for (size_t i = 0; i < red.size(); i++) red[i] = (uint8_t)~e.panel[0x26][i];   // le pilote inverse le plan rouge : le hash couvre le plan LOGIQUE
  h.update(red.data(), red.size()); char hex[65]; pod_render_hash_end(h, hex); return hex;
}
static std::string field(const std::string& log, const char* key) { size_t p = log.find(key); if (p == std::string::npos) return ""; p += std::strlen(key); size_t q = p; while (q < log.size() && std::isxdigit((unsigned char)log[q])) q++; return log.substr(p, q - p); }

static void resetWorld() {
  g_ev.clear(); Serial.log.clear(); g_allocs.clear(); g_outstanding = g_peakOutstanding = 0; g_mallocCount = 0; g_failMallocAt = 0; g_heapTotal = 38000; g_tlsBytes = 0; g_leakBytes = 0; WiFiClientSecure::g_leakOnClose = 0; g_fragBytes = 2000;
  g_us = 1000000; g_pump = nullptr; g_yields = 0; g_wdt = 0; g_liveClients = 0; g_ackCalls = 0; g_ackResult = true; g_httpGetCalls = g_httpPostCalls = 0; g_postPaths.clear();
  g_scn = Scn(); g_failProduceAt = 0; g_producerCalls = 0; g_producerMaxCap = 0; Epd::g_epdInit = 0; g_contStack = 3000; g_rst = { 0, 0, 0, 0, 0, 0, 0 }; std::memset(g_rtc, 0, sizeof g_rtc); g_haltOnDelayLoop = false;
  g_validateV2Calls = g_registerCalls = g_signCalls = 0;
  blackBuf = redBuf = nullptr; einkReady = true; hasDisplayedFrame = false; lastFrameId = ""; frameReady = false; lastFrameWasConsensus = false; lastRefreshMs = 0; pendingCandidateId = ""; pendingObsHashes = ""; pendingObsTarget = "";
  deviceId = "dev_TEST0001"; pendingWorkTitle = "Chat - pain"; pendingArtistName = "Roubzi"; pendingDisplayTs = "10/10/2026 09:15 (Paris)"; currentBlockIndex = 7;
  epd = Epd();
#if POD_RENDER_V1 && POD_CANARY
  g_pcRtc = { 0, 0, 0, 0 }; g_pcStepMs = 0; g_pcHeapPre = 0; g_pcMinHeap = 0xFFFFFFFFUL; g_pcCalls = 0; g_pcEnterUs = 0; g_pcLastEndUs = 0; g_pcMaxCallUs = 0; g_pcMaxGapUs = 0; g_pcMinStack = 0xFFFF;
#endif
}
struct Res { bool ret = false; bool restarted = false; };
static Res fetch(const std::vector<uint8_t>& frame) {
  Res r; g_scn.body = frame; g_pump = [] {};
  try { r.ret = doFetchFrame("frame-1", "personal"); } catch (HostRestart&) { r.restarted = true; }
  return r;
}
static bool nothingHeld() { return g_outstanding == 0 && blackBuf == nullptr && redBuf == nullptr; }
static bool noAckNoRender(const char* why) {
  const bool ok = g_ackCalls == 0 && evIndex("POST /api/ack-frame") < 0 && epd.refreshes == 0 && !hasDisplayedFrame && !frameReady && lastFrameId == "" && g_outstanding == 0 && blackBuf == nullptr && redBuf == nullptr && evIndex("VIOLATION") < 0;
  if (!ok) g_fail.push_back(std::string("échec fermé violé : ") + why);
  g_checks++; return ok;
}

int main() {
  const PodRenderSpec spec = pod_render_spec(POD_R_EINK29);
  // ═══ S1 : chemin nominal, un seul envoi ═══════════════════════════════════════════════════════════════════
  {
    resetWorld(); const auto f = mkFrame(0, 1); Res r = fetch(f);
    CHECK(r.ret, "S1 succès");
    CHECK(g_ackCalls == 1 && evCount("POST /api/ack-frame") == 1, "S1 un seul ACK");
    const int dtor = evIndex("tls_dtor"), first = evIndex("epd_first_command"), init = evIndex("epd_init"), ack = evIndex("POST /api/ack-frame"), refresh = evIndex("epd_refresh"), disp = evIndex("epd_display");
#if POD_RENDER_V1
    CHECK(dtor >= 0 && init > dtor && first > dtor, "S1 TLS FERMÉ (client détruit) AVANT toute opération du panneau");
    CHECK(ack > refresh && refresh > first, "S1 ACK APRÈS le rafraîchissement du panneau");
#else
    CHECK(dtor >= 0 && init > dtor && disp > init, "S1 (OFF) TLS FERMÉ AVANT toute opération du panneau");
    CHECK(ack > disp, "S1 (OFF) ACK APRÈS Display()");
    (void)first; (void)refresh;
#endif
    CHECK(evIndex("VIOLATION") < 0, "S1 aucune opération du panneau pendant TLS");
    CHECK(hasDisplayedFrame && lastFrameId == "frame-1" && frameReady, "S1 état mis à jour après succès");
    CHECK(g_outstanding == 9472 && blackBuf && redBuf, "S1 les deux plans (9 472 o) sont conservés après succès (libérés au prochain pull) — comportement existant");
    CHECK(g_liveClients == 0, "S1 aucun client TLS vivant");
    CHECK(epd.panel[0x24].size() == 4736 && epd.panel[0x26].size() == 4736, "S1 deux plans de 4 736 o remis au pilote");
#if POD_RENDER_V1
    CHECK(frameHex(f) == field(Serial.log, "frameHash="), "S1 frameHash recalculé indépendamment (octets reçus)");
    CHECK(renderHexOfPanel(epd) == field(Serial.log, "renderHash="), "S1 renderHash recalculé sur les octets REMIS au pilote (plan rouge ré-inversé)");
    CHECK(g_producerMaxCap <= 32 && g_producerCalls >= 296, "S1 producteur appelé par morceaux de 32 o au plus (≥ 296 appels)");
    CHECK(g_yields >= g_producerCalls, "S1 yield() à chaque morceau (le chien de garde logiciel est nourri)");
    CHECK(evIndex("tls_dtor") < evIndex("epd_init"), "S1 (v1) TLS fermé avant l'initialisation du panneau");
#else
    CHECK(evIndex("epd_display") > dtor, "S1 (OFF) Display() après la fermeture TLS");
    CHECK(epd.panel[0x24].size() == 4736, "S1 (OFF) plan noir remis");
#endif
  }
  // ═══ S2 : fragmentation (tailles irrégulières, 1 octet, 7, 1448…) ══════════════════════════════════════════
  {
    const std::vector<std::vector<size_t>> pats = { {1}, {7}, {239, 240, 241}, {1448}, {4736}, {4735, 1}, {1, 4735}, {100, 333, 5000}, {2, 3, 5, 7, 11, 13, 17, 19, 23, 4096} };
    int ok = 0, n = 0;
    for (size_t pi = 0; pi < pats.size(); pi++) for (int blocking = 0; blocking < 2; blocking++) {
      resetWorld(); const auto f = mkFrame(0, 7 + (int)pi); g_scn.chunks = pats[pi]; g_scn.chunkEveryMs = pats[pi][0] <= 2 ? 1 : 5; g_scn.blockingRead = blocking;
      Res r = fetch(f); n++;
      bool good = r.ret && g_ackCalls == 1 && g_outstanding == 9472;
#if POD_RENDER_V1
      good = good && frameHex(f) == field(Serial.log, "frameHash=");
#else
      good = good && std::equal(f.begin(), f.begin() + 4736, blackBuf) && std::equal(f.begin() + 4736, f.end(), redBuf);
#endif
      if (good) ok++; else g_fail.push_back("S2 fragmentation " + std::to_string(pi) + (blocking ? " bloquant" : ""));
    }
    g_checks++; if (ok != n) g_fail.push_back("S2 fragmentation : " + std::to_string(ok) + "/" + std::to_string(n));
    // 300 découpages pseudo-aléatoires
    int bad = 0; uint32_t x = 99;
    for (int i = 0; i < 300; i++) {
      resetWorld(); const auto f = mkFrame(i % 6, i); g_scn.chunks.clear(); for (int k = 0; k < 40; k++) { x = x * 1103515245u + 12345u; g_scn.chunks.push_back(1 + (x >> 16) % 1500); } g_scn.chunkEveryMs = 1 + i % 4; g_scn.blockingRead = i & 1;
      Res r = fetch(f);
      if (!(r.ret && g_ackCalls == 1)) bad++;
    }
    CHECK(bad == 0, "S2 300 découpages aléatoires : réussite et un ACK chacun");
  }
  // ═══ S3 : corps tronqué (plan noir entier, rouge partiel) et erreur après le plan noir ═══════════════════════
  for (int variant = 0; variant < 3; variant++) {
    resetWorld(); auto f = mkFrame(0, 3);
    if (variant == 0) f.resize(4736 + 1000);          // rouge partiel
    if (variant == 1) f.resize(4736);                 // le serveur coupe juste après le plan noir
    if (variant == 2) f.resize(4000);                 // noir partiel
    g_scn.contentLength = 9472;                       // annoncé complet
    Res r = fetch(f);
    CHECK(!r.ret, "S3 retourne false");
    noAckNoRender("S3 tronqué");
    CHECK(evIndex("tls_dtor") >= 0 && g_liveClients == 0, "S3 TLS fermé aussi sur l'échec");
    CHECK(millis() - 1000 >= 14000, "S3 attente bornée (≈ 15 s virtuelles par plan), pas de boucle infinie");
  }
  // ═══ S4 : corps trop long / surplus ═════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); auto f = mkFrame(0, 4); f.insert(f.end(), 8, 0xAB); g_scn.contentLength = 9480;   // Content-Length 9480
    Res r = fetch(f);
#if POD_RENDER_V1 && POD_CANARY
    CHECK(!r.ret, "S4a CANARI : Content-Length 9480 refusé"); noAckNoRender("S4a");
    CHECK(Serial.log.find("REFUS : corps de taille inattendue") != std::string::npos, "S4a message de refus");
#else
    CHECK(r.ret && g_ackCalls == 1, "S4a (hors canari) les octets en trop sont vidés par http.end() : comportement existant, conservé");
#endif
    resetWorld(); auto g = mkFrame(0, 5); g.insert(g.end(), 8, 0xCD); g_scn.contentLength = 9472; g_scn.chunks = { 9480 };   // 8 octets en trop DÉJÀ arrivés
    r = fetch(g);
#if POD_RENDER_V1 && POD_CANARY
    CHECK(!r.ret, "S4b CANARI : surplus disponible refusé"); noAckNoRender("S4b");
#else
    CHECK(r.ret && g_ackCalls == 1, "S4b (hors canari) surplus ignoré : comportement existant");
#endif
    resetWorld(); auto h = mkFrame(0, 6); g_scn.contentLength = -1; r = fetch(h);
    CHECK(r.ret && g_ackCalls == 1, "S4c Content-Length inconnu (-1) : accepté si 9 472 octets exacts arrivent");
  }
  // ═══ S5 : allocation impossible (premier, second plan) ════════════════════════════════════════════════════════
  for (int at = 1; at <= 2; at++) {
    resetWorld(); g_failMallocAt = at; Res r = fetch(mkFrame(0, 8));
    CHECK(!r.ret, "S5 retourne false"); noAckNoRender("S5 malloc");
    CHECK(evIndex("tls_ctor") < 0 && g_httpGetCalls == 0, "S5 aucun TLS ouvert quand les plans ne sont pas alloués");
  }
  // ═══ S6 : codes HTTP et begin() ═════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); g_scn.code = 404; Res r = fetch(mkFrame(0, 9)); CHECK(r.ret, "S6 404 : pas de frame, true"); noAckNoRender("S6 404");
    resetWorld(); g_scn.code = 500; r = fetch(mkFrame(0, 9)); CHECK(!r.ret, "S6 500 : false"); noAckNoRender("S6 500");
    resetWorld(); g_scn.beginFails = true; r = fetch(mkFrame(0, 9)); CHECK(!r.ret, "S6 begin() : false"); noAckNoRender("S6 begin");
  }
  // ═══ S7 : panneau (ON/CANARI) : Init en échec, producteur interrompu ═══════════════════════════════════════════
#if POD_RENDER_V1
  {
    resetWorld(); Epd::g_epdInit = -1; Res r = fetch(mkFrame(0, 10));
    CHECK(!r.ret, "S7a Init() en échec : false"); noAckNoRender("S7a");
    CHECK(epd.cmdCount == 0, "S7a aucune donnée envoyée au panneau");
    CHECK(Serial.log.find("panneau non initialisé") != std::string::npos, "S7a message");
    for (unsigned at : { 1u, 2u, 100u, 148u, 296u }) {
      resetWorld(); g_failProduceAt = at; r = fetch(mkFrame(0, 11));
      CHECK(!r.ret, "S7b producteur interrompu : false"); noAckNoRender("S7b producteur");
      CHECK(evIndex("epd_refresh") < 0, "S7b rafraîchissement NON lancé après interruption (RAM du panneau partielle, pas d'affichage)");
    }
    // renderer/hash impossibles : plans absents (white-box) -> 0, aucune commande
    resetWorld(); blackBuf = nullptr; redBuf = nullptr;
    CHECK(podRenderAndShow() == 0, "S7c plans absents : 0 (frameHash impossible)"); CHECK(epd.cmdCount == 0 && g_ackCalls == 0, "S7c rien envoyé");
  }
#endif
  // ═══ S8 : image défavorable (uniforme / presque uniforme / rouge prioritaire) ══════════════════════════════════
  for (int kind = 1; kind <= 5; kind++) {
    resetWorld(); const auto f = mkFrame(kind, 20 + kind); Res r = fetch(f);
    CHECK(r.ret && g_ackCalls == 1, "S8 image spéciale : succès et ACK");
#if POD_RENDER_V1
    CHECK(g_producerMaxCap <= 32 && g_producerCalls == 296, "S8 296 appels du producteur de ≤ 32 o, quelle que soit l'image");
    CHECK(g_yields >= 296, "S8 yield() à chaque appel");
    CHECK(renderHexOfPanel(epd) == field(Serial.log, "renderHash="), "S8 renderHash cohérent");
    if (kind == 5) {   // noir ET rouge partout : le rouge l'emporte dans la zone d'image (plan noir clair, plan rouge allumé)
      int redOn = 0, blackOn = 0; for (size_t i = 0; i < 4736; i++) { if (epd.panel[0x26][i] != 0x00) redOn++; if (epd.panel[0x24][i] != 0xFF) blackOn++; }
      CHECK(redOn > 3000, "S8 rouge prioritaire : le plan rouge est (quasi) plein dans la zone d'image");
      (void)blackOn;
    }
    if (kind == 1) { int ink = 0; for (size_t i = 0; i < 4736; i++) if (epd.panel[0x24][i] != 0xFF) ink++; CHECK(ink > 0, "S8 image blanche : le cartel (noir) est tout de même gravé par le noyau"); }
#endif
  }
  // ═══ S9 : second affichage (page blanche d'abord, allocation de 2 × 4 736 o) ═══════════════════════════════════
  {
    resetWorld(); hasDisplayedFrame = true; lastRefreshMs = millis(); Res r = fetch(mkFrame(0, 30));
    CHECK(r.ret && g_ackCalls == 1, "S9 affichage suivant : succès");
    CHECK(epd.refreshes >= 2, "S9 page blanche puis image");
    CHECK(evIndex("epd_display") > evIndex("tls_dtor"), "S9 page blanche après la fermeture TLS");
    resetWorld(); hasDisplayedFrame = true; lastRefreshMs = millis(); g_failMallocAt = 3;   // la 3e allocation = tmpBlack de clearDisplayWhite
    r = fetch(mkFrame(0, 31));
    CHECK(r.ret && g_ackCalls == 1, "S9 clearDisplayWhite sans mémoire : ignoré, le rendu continue");
  }
  // ═══ S10 : erreur d'ACK réseau n'est pas un succès annoncé de plus (état déjà posé, comportement existant) ═══════
  {
    resetWorld(); g_ackResult = false; Res r = fetch(mkFrame(0, 40));
    CHECK(g_ackCalls == 1 && evCount("POST /api/ack-frame") == 1, "S10 ACK refusé : UN SEUL essai réseau, pas de boucle");
#if POD_RENDER_V1 && POD_CANARY
    // FIX1 : en canari le résultat de l'ACK décide du succès
    CHECK(!r.ret, "S10 CANARI : ACK refusé => retour false (le serveur reproposera la frame)");
    CHECK(lastFrameId == "" && !frameReady, "S10 CANARI : frame NON marquée acquittée (lastFrameId, frameReady inchangés)");
    CHECK(hasDisplayedFrame && epd.refreshes >= 1, "S10 CANARI : l'écran a pu être affiché (dit clairement)");
    CHECK(Serial.log.find("ECHEC ACK") != std::string::npos && Serial.log.find("ACK recu") == std::string::npos && Serial.log.find("acquittee") != std::string::npos, "S10 CANARI : échec journalisé, jamais « ACK reçu »");
    CHECK(g_pcRtc.phase != PCP_DONE && g_pcRtc.phase == PCP_ACK, "S10 CANARI : aucune phase TERMINE (la dernière phase est ACK)");
    CHECK(g_outstanding == 0 && blackBuf == nullptr && redBuf == nullptr, "S10 CANARI : plans libérés");
    { int rep = 0; size_t q = 0; while ((q = Serial.log.find("flux pilote :", q)) != std::string::npos) { rep++; q++; } CHECK(rep == 1, "S10 CANARI : rapport du flux émis UNE fois (après le rendu), pas le rapport de succès final"); }
#else
    CHECK(r.ret && lastFrameId == "frame-1", "S10 (production) ACK refusé : comportement existant conservé (résultat ignoré)");
#endif
  }
  // ═══ S11 : cycles répétés — aucune fuite ═════════════════════════════════════════════════════════════════════
  {
    resetWorld(); size_t maxOut = 0; for (int i = 0; i < 20; i++) {
      free(blackBuf); blackBuf = nullptr; free(redBuf); redBuf = nullptr;   // doPull libère au début de chaque cycle
      g_ev.clear(); g_scn = Scn(); lastFrameId = ""; Res r = fetch(mkFrame(0, 50 + i)); CHECK(r.ret, "S11 cycle"); if (g_outstanding > maxOut) maxOut = g_outstanding;
      if (i % 5 == 4) { free(blackBuf); blackBuf = nullptr; free(redBuf); redBuf = nullptr; g_failMallocAt = g_mallocCount + 2; Res q = fetch(mkFrame(0, 99)); CHECK(!q.ret && g_outstanding == 0, "S11 échec intercalé : tout libéré"); g_failMallocAt = 0; }
    }
    CHECK(maxOut == 9472, "S11 occupation constante sur 20 cycles (9 472 o)");
  }
#if POD_RENDER_V1 && POD_CANARY
  // ═══ C1 : pré-vol TLS ════════════════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); g_heapTotal = 30000; Res r = fetch(mkFrame(0, 60));
    CHECK(!r.ret, "C1 tas insuffisant : refus"); noAckNoRender("C1"); CHECK(evIndex("tls_ctor") < 0 && g_httpGetCalls == 0, "C1 aucun client TLS construit"); CHECK(Serial.log.find("REFUS pre-vol TLS") != std::string::npos, "C1 message");
    resetWorld(); g_fragBytes = 25000; g_heapTotal = 45000; r = fetch(mkFrame(0, 61));
    CHECK(!r.ret, "C1b bloc contigu insuffisant : refus"); noAckNoRender("C1b");
    resetWorld(); g_heapTotal = 38000; r = fetch(mkFrame(0, 62)); CHECK(r.ret, "C1c tas nominal : accepté");
  }
  // ═══ A : ACK en canari ═══════════════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); Res r = fetch(mkFrame(0, 70));
    CHECK(r.ret && g_ackCalls == 1 && lastFrameId == "frame-1" && frameReady && g_pcRtc.phase == PCP_DONE, "A1 ACK 200 : succès, frame acquittée, phase TERMINE");
    CHECK(Serial.log.find("ACK recu (HTTP 200)") != std::string::npos && Serial.log.find("ECHEC ACK") == std::string::npos, "A1 journal");
    CHECK(evCount("tls_ctor") == 2 && evCount("POST /api/ack-frame") == 1, "A1 deux TLS (téléchargement, ACK), un seul ACK");
    // mémoire insuffisante AVANT l'ACK : le téléchargement passe (28,5 Ko), la fermeture TLS laisse 12 Ko « perdus » => 16,5 Ko au moment de l'ACK
    resetWorld(); WiFiClientSecure::g_leakOnClose = 12000; r = fetch(mkFrame(0, 71));
    CHECK(!r.ret, "A3 mémoire insuffisante avant l'ACK : false");
    CHECK(g_ackCalls == 0 && evIndex("POST /api/ack-frame") < 0, "A3 AUCUN ACK envoyé");
    CHECK(evCount("tls_ctor") == 1 && g_httpPostCalls == 0, "A3 aucun second TLS ouvert (le pré-vol évite l'abort de la pile de poussée)");
    CHECK(lastFrameId == "" && !frameReady && g_pcRtc.phase != PCP_DONE, "A3 frame non acquittée, aucun faux TERMINE");
    CHECK(hasDisplayedFrame && epd.refreshes >= 1, "A3 l'écran a pu être affiché : dit");
    CHECK(Serial.log.find("REFUS pre-vol TLS") != std::string::npos && Serial.log.find("N'EST PAS acquittee") != std::string::npos && Serial.log.find("ACK recu") == std::string::npos, "A3 diagnostic explicite");
    CHECK(g_outstanding == 0 && blackBuf == nullptr && redBuf == nullptr, "A3 plans libérés");
    // seuil du plus grand bloc contigu avant l'ACK
    resetWorld(); g_fragBytes = 2000; WiFiClientSecure::g_leakOnClose = 0; g_heapTotal = 38000;
    r = fetch(mkFrame(0, 72)); CHECK(r.ret, "A4 nominal toujours accepté");
    // ACK refusé : un seul essai, pas de nouvel essai immédiat
    resetWorld(); g_ackResult = false; r = fetch(mkFrame(0, 73));
    CHECK(!r.ret && g_ackCalls == 1 && evCount("tls_ctor") == 2, "A2 ACK refusé : false, un seul essai réseau");
    // nouvel essai différé : un second doFetchFrame (prochain pull) avec ACK accepté réussit et acquitte
    g_ackResult = true; g_ev.clear(); lastFrameId = ""; r = fetch(mkFrame(0, 73));
    CHECK(r.ret && lastFrameId == "frame-1" && frameReady, "A2 le nouvel essai (prochain pull) réussit une fois l'ACK accepté");
  }
  // ═══ C2 : tas non restitué ═══════════════════════════════════════════════════════════════════════════════════
  {
    resetWorld(); WiFiClientSecure::g_leakOnClose = 3000; Res r = fetch(mkFrame(0, 63));
    CHECK(Serial.log.find("ALERTE tas non restitue") != std::string::npos, "C2 fuite de 3 000 o signalée");
    resetWorld(); r = fetch(mkFrame(0, 64)); CHECK(Serial.log.find("tas restitue apres la fermeture TLS") != std::string::npos && Serial.log.find("ALERTE tas") == std::string::npos, "C2 pas d'alerte sans fuite");
  }
  // ═══ C3 : trace RTC, étapes, statistiques ═══════════════════════════════════════════════════════════════════
  {
    resetWorld(); Res r = fetch(mkFrame(0, 65));
    CHECK(g_pcRtc.phase == PCP_DONE && g_rtc[0] == PCR_MAGIC && g_rtc[2] == PCP_DONE, "C3 la dernière phase RTC est TERMINE");
    for (const char* tag : { "frame: debut", "planes allouees", "TLS ouvert", "corps lu", "TLS FERME", "frameHash calcule", "panneau initialise", "flux remis au pilote", "renderHash", "rendu OK, pre-vol TLS avant l'ACK", "ACK recu (HTTP 200)" })
      CHECK(Serial.log.find(tag) != std::string::npos, std::string("C3 étape journalisée : ") + tag);
    CHECK(Serial.log.find("flux pilote : 296 appels du producteur") != std::string::npos, "C3 rapport du flux (296 appels)");
    CHECK(g_pcMinStack == 3000, "C3 pile cont minimale relevée");
    // échec : la phase RTC reste celle de l'échec
    resetWorld(); Epd::g_epdInit = -1; r = fetch(mkFrame(0, 66));
    CHECK(g_pcRtc.phase == PCP_FRAMEHASH && Serial.log.find("ECHEC rendu/affichage : AUCUN ACK") != std::string::npos, "C3 phase RTC = FRAMEHASH après l'échec d'initialisation du panneau, message d'échec");
  }
  // ═══ C4 : démarrage, cause de reset, arrêt après deux resets anormaux ═══════════════════════════════════════
  {
    resetWorld(); g_rst.reason = 0; canaryBoot();
    CHECK(Serial.log.find("BUILD LOT8B2C-ESP8266-EINK29-CANARY-1") != std::string::npos && Serial.log.find("ALERTE : redemarrage ANORMAL") == std::string::npos, "C4 démarrage normal : empreinte, pas d'alerte");
    CHECK(Serial.log.find("RAM statique=") != std::string::npos, "C4 RAM statique affichée");
    resetWorld(); g_rst.reason = 3; canaryBoot();   // chien de garde logiciel
    CHECK(Serial.log.find("ALERTE : redemarrage ANORMAL") != std::string::npos && g_pcRtc.abn == 1, "C4 reset ANORMAL détecté (1er)");
    std::vector<uint32_t> keep(g_rtc, g_rtc + 4);
    // second démarrage anormal : la RTC a conservé la phase et le compteur
    uint32_t savedRtc[4]; std::memcpy(savedRtc, g_rtc, sizeof savedRtc);
    Serial.log.clear(); g_rst.reason = 2; std::memcpy(g_rtc, savedRtc, sizeof savedRtc); g_haltOnDelayLoop = true; g_pcRtc = { 0, 0, 0, 0 };
    bool halted = false; try { canaryBoot(); } catch (HostHalt&) { halted = true; }
    CHECK(halted && Serial.log.find("ARRET : deux redemarrages anormaux consecutifs") != std::string::npos, "C4 deuxième reset anormal consécutif : ARRÊT sans réseau");
    CHECK(g_httpGetCalls == 0 && g_httpPostCalls == 0, "C4 aucune requête");
    // reset normal efface le compteur
    resetWorld(); g_rst.reason = 0; g_rtc[0] = PCR_MAGIC; g_rtc[3] = 1; canaryBoot(); CHECK(g_pcRtc.abn == 0, "C4 un reset normal remet le compteur à zéro");
  }
#endif
  // ═══ P : intervalle de pull (FIX2) — le VRAI doPull, réponses /api/pull simulées ═══════════════════════════
#ifdef HARNESS_VOTE
  {
    auto pullWith = [](const char* json, int code, const char* lastId) {
      resetWorld(); lastFrameId = lastId; pendingCandidateId = ""; frameReady = false; nextPullIntervalMs = 12345UL;
      g_scn = Scn(); g_scn.code = code; g_scn.body.assign(json, json + std::strlen(json));
      return doPull();
    };
    const unsigned long NOM = PULL_INTERVAL;
    // P1/P2 : frame identique, sans candidat => retryAfter du serveur
    CHECK(pullWith("{\"frameSource\":\"personal\",\"frameId\":\"f1\",\"retryAfter\":900,\"chain\":{\"blockHash\":\"h1\",\"blockIndex\":3}}", 200, "f1") && nextPullIntervalMs == 900000UL, "P1 frame identique + retryAfter 900 => prochain pull 900 s");
    CHECK(g_httpGetCalls == 1 && frameReady && Serial.log.find("Frame déjà affichée") != std::string::npos && evIndex("http_begin https://proof-of-draw.vercel.app/api/pull-frame") < 0, "P1 UN seul GET (/api/pull), aucun téléchargement, frame marquée prête");
    CHECK(pullWith("{\"frameSource\":\"personal\",\"frameId\":\"f1\",\"retryAfter\":300}", 200, "f1") && nextPullIntervalMs == 300000UL, "P2 frame identique + retryAfter 300 => 300 s");
    CHECK(pullWith("{\"frameSource\":\"consensus\",\"frameId\":\"f1\",\"retryAfter\":300}", 200, "f1") && nextPullIntervalMs == 300000UL, "P2b frame de consensus identique => 300 s");
    // P3 : frame NOUVELLE => rythme nominal ET téléchargement
    CHECK(pullWith("{\"frameSource\":\"personal\",\"frameId\":\"f2\",\"retryAfter\":300}", 200, "f1") && nextPullIntervalMs == NOM, "P3 frame nouvelle => rythme nominal (retryAfter ignoré)");
    CHECK(Serial.log.find("Nouvelle frame frameId=f2") != std::string::npos && g_httpGetCalls >= 2, "P3 frame nouvelle : récupérée immédiatement (second GET vers /api/pull-frame)");
    CHECK(pullWith("{\"frameSource\":\"personal\",\"frameId\":\"f2\",\"retryAfter\":300}", 200, "") && nextPullIntervalMs == NOM && Serial.log.find("Nouvelle frame") != std::string::npos, "P3b premier démarrage (lastFrameId vide) : nominal + fetch");
    // P4 : candidat annoncé => comportement existant (rythme nominal), même si la frame est identique
    CHECK(pullWith("{\"frameSource\":\"personal\",\"frameId\":\"f1\",\"retryAfter\":900,\"pendingValidation\":{\"candidateId\":\"cand-1\"}}", 200, "f1") && nextPullIntervalMs == NOM && pendingCandidateId == "cand-1", "P4 candidat présent + frame identique => rythme nominal, candidat retenu");
    CHECK(pullWith("{\"frameSource\":\"none\",\"retryAfter\":900,\"pendingValidation\":{\"candidateId\":\"cand-2\"}}", 200, "f1") && nextPullIntervalMs == NOM, "P4b candidat présent sans frame => rythme nominal (existant)");
    // P5 : frame absente => retryAfter
    CHECK(pullWith("{\"frameSource\":\"none\",\"retryAfter\":300}", 200, "f1") && nextPullIntervalMs == 300000UL && Serial.log.find("Aucune frame") != std::string::npos, "P5 frame absente + retryAfter 300 => 300 s");
    CHECK(pullWith("{\"frameSource\":\"none\",\"retryAfter\":900}", 200, "") && nextPullIntervalMs == 900000UL, "P5b frame absente + retryAfter 900 => 900 s");
    CHECK(pullWith("{\"frameSource\":\"none\"}", 200, "") && nextPullIntervalMs == 60000UL, "P5c retryAfter absent => 60 s (défaut)");
    // P6 : frameSource présente mais frameId vide => comportement existant (nominal)
    CHECK(pullWith("{\"frameSource\":\"personal\",\"retryAfter\":900}", 200, "f1") && nextPullIntervalMs == NOM, "P6 frameSource sans frameId => nominal (inchangé)");
    // P7 : 429 inchangé
    {
      const bool ret = pullWith("{\"retryAfter\":30}", 429, "f1");
      CHECK(ret && nextPullIntervalMs == 12345UL, "P7 429 : nextPullIntervalMs non touché");
      CHECK(lastPullMs == millis() - (PULL_INTERVAL - 30000UL) && Serial.log.find("429 rate limit, retryAfter=30") != std::string::npos, "P7 429 : lastPullMs avancé comme avant");
      CHECK(pullWith("{\"retryAfter\":900}", 429, "f1") && lastPullMs == millis() && nextPullIntervalMs == 12345UL, "P7b 429 retryAfter 900 plafonné à PULL_INTERVAL (inchangé)");
    }
    // P8 : erreur HTTP / réseau inchangé
    CHECK(!pullWith("{}", 500, "f1") && nextPullIntervalMs == 12345UL, "P8 HTTP 500 : false, intervalle non touché");
    CHECK(!pullWith("{", 200, "f1") && nextPullIntervalMs == 12345UL, "P8b JSON invalide : false, intervalle non touché");
    { resetWorld(); g_scn = Scn(); g_scn.beginFails = true; nextPullIntervalMs = 12345UL; CHECK(!doPull() && nextPullIntervalMs == 12345UL, "P8c begin() échoue : false, intervalle non touché"); }
    // P9 : aucune requête de plus qu'avant (un GET par pull, aucun POST)
    CHECK(pullWith("{\"frameSource\":\"personal\",\"frameId\":\"f1\",\"retryAfter\":900}", 200, "f1") && g_httpGetCalls == 1 && g_httpPostCalls == 0, "P9 frame identique : un GET, zéro POST");
  }
#endif
  // ═══ V : vote (doValidate / doObsConfirm) ══════════════════════════════════════════════════════════════════════
#ifdef HARNESS_VOTE
  {
    resetWorld(); pendingCandidateId = "cand-0123456789";
    const bool ret = doValidate();
#if POD_RENDER_V1 && POD_CANARY
    CHECK(ret, "V1 canari : doValidate retourne true");
    CHECK(g_httpGetCalls == 0 && g_httpPostCalls == 0 && g_signCalls == 0 && g_validateV2Calls == 0 && g_registerCalls == 0, "V1 canari : AUCUN appel réseau, signature, vote v2 ni re-register");
    CHECK(pendingCandidateId == "", "V1 canari : candidat oublié localement");
    CHECK(Serial.log.find("AUCUN vote en build canari") != std::string::npos, "V1 canari : message explicite");
    { int lines = 0; size_t p = 0; while ((p = Serial.log.find('\n', p)) != std::string::npos) { lines++; p++; } CHECK(lines == 1, "V1 canari : UNE seule ligne"); }
    CHECK(g_outstanding == 0 && g_allocs.empty() && evIndex("malloc") < 0, "V1 canari : aucune allocation");
    CHECK(evIndex("POST /api/validation-result") < 0, "V1 canari : pas de /api/validation-result");
    // candidat vide : silencieux
    resetWorld(); CHECK(doValidate() && Serial.log.empty() && g_httpGetCalls == 0, "V1 canari : rien à faire sans candidat");
    // observation
    resetWorld(); pendingObsHashes = "[\"a\"]"; pendingObsTarget = "t"; CHECK(doObsConfirm(), "V2 canari : doObsConfirm retourne true"); CHECK(g_httpPostCalls == 0 && pendingObsHashes == "" && Serial.log.find("IGNOREE en build canari") != std::string::npos, "V2 canari : aucune requête /api/obs-confirm");
#else
    (void)ret;
    CHECK(g_httpGetCalls == 1 && evIndex("GET /api/validate-candidate?deviceId=dev_TEST0001") >= 0, "V1 production : doValidate interroge /api/validate-candidate (chemin de vote inchangé)");
    CHECK(Serial.log.find("CANARY") == std::string::npos, "V1 production : aucun message de canari");
    resetWorld(); pendingObsHashes = "[\"a\"]"; pendingObsTarget = "t"; doObsConfirm(); CHECK(g_httpPostCalls == 1 && g_lastPostPath == "/api/obs-confirm", "V2 production : /api/obs-confirm envoyé (inchangé)");
#endif
  }
#endif
  if (!g_fail.empty()) { for (auto& f : g_fail) std::printf("FAIL %s\n", f.c_str()); std::printf("log série :\n%s\n", Serial.log.substr(0, 1500).c_str()); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
