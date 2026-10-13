// consensus-pod/host/tft28_vote_harness.cpp — LOT8B2E V1 (audit du vote du R4 + TFT 2,8″) : exécute sur l'HÔTE la chaîne de vote du firmware COMPLET (arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino, PRODUCTION : le vote existe)
//   pendingCandidate -> GET /api/validate-candidate -> décodage -> GET /api/candidate-frame (153 600 o, SHA-256 + métriques réels) -> verdict -> signature Ed25519 RÉELLE -> POST /api/validation-result -> réponse -> ré-inscription différée,
// contre les bibliothèques simulées de consensus-pod/host/tft28/ (réseau scripté, TFT, carte SD, piles dédiées PodNet / PodEd réelles en mode hôte) et la VRAIE bibliothèque Crypto (SHA-256, Ed25519).
// AUCUN changement de firmware : ce harnais OBSERVE le comportement ACTUEL. Il imprime des FAITS (« FACT clé=valeur », « POST <json> », « LOG <ligne> ») ; les verdicts sont rendus par tests/tft28VoteHarness.test.ts, qui recalcule
// de façon INDÉPENDANTE le contenu, son SHA-256 (Node), ses métriques (lib/podMetrics.ts), le message signé (lib/podVote.ts) et vérifie la signature (lib/ed25519.ts).
//   tft28_vote_harness <scénario> <graine> <hashAnnoncéHex> [octetsAnnoncés]
// Le sketch est inclus tel quel (sketch_body.inc). Compilation : -DPOD_HOST_REAL_CRYPTO=1, -I<Crypto/src> AVANT -I<tft28 mock> (voir le test).
#define POD_NET_HOST_TEST 1
#define POD_ED_HOST_TEST 1
#include "tft28_mock.h"
static void harnessProbe(int n);
#define POD_NET_PROBE(I, n) harnessProbe(n)
extern "C" { char g_fakeRam[8192]; char g_fakeStack[1024 + 64]; }
asm(".globl __HeapLimit\n.set __HeapLimit, g_fakeRam+4096\n.globl __StackLimit\n.set __StackLimit, g_fakeStack\n.globl __StackTop\n.set __StackTop, g_fakeStack+1024\n");
extern "C" char* harness_sbrk(int) { return g_fakeRam + 1000; }
#define sbrk harness_sbrk
static inline volatile uint8_t* harnessFrame() { return (volatile uint8_t*)g_fakeStack + 700; }
#define __builtin_frame_address(x) harnessFrame()
template <class T> static inline T max(T a, T b) { return a > b ? a : b; }
#define setup tft28_setup
#define loop tft28_loop
#include "sketch_body.inc"
#undef setup
#undef loop
#undef __builtin_frame_address
#include "RNG.h"
RNGClass::RNGClass() {}
RNGClass::~RNGClass() {}
void RNGClass::rand(uint8_t*, size_t) { std::abort(); }
RNGClass RNG;

static int g_failNext = 0; static std::string g_failWhenLog;      // g_failWhenLog : la PREMIÈRE allocation de pile dédiée après l'apparition de ce texte dans le journal échoue
static std::string g_guardWhenLog; static unsigned g_guardStackBytes = 0; static int g_guardFired = 0;   // GUARD simulée : à la fin de la première pile de cette taille APRÈS l'apparition du texte
static void smashGuardHook(uint8_t*, size_t stackBytes, uint8_t* guard) {
  if (!g_guardWhenLog.empty() && !g_guardFired && stackBytes == g_guardStackBytes && Serial.log.find(g_guardWhenLog) != std::string::npos) { guard[10] = 0x00; g_guardFired = 1; }
}
static void harnessProbe(int n) {
  if (n == 1 && !g_failWhenLog.empty() && Serial.log.find(g_failWhenLog) != std::string::npos) { podNetTestFailAlloc = 1; g_failWhenLog.clear(); }
  else if (n == 1) { podNetTestFailAlloc = (g_failNext > 0) ? 1 : 0; if (g_failNext > 0) g_failNext--; }
  else if (n == 2) podNetTestNested++; else if (n == 3) podNetTestNested--;
}

// ─── réponses scriptées ──────────────────────────────────────────────────────────────────────────────────────────────
static std::string http(int code, const std::string& body, long cl = -2) {
  std::string h = "HTTP/1.1 " + std::to_string(code) + " X\r\n"; const long len = cl == -2 ? (long)body.size() : cl;
  if (len >= 0) h += "Content-Length: " + std::to_string(len) + "\r\n";
  return h + "Connection: close\r\n\r\n" + body;
}
static const size_t RAW = 153600;
// Motif : damier de blocs de 16 px, bruité par une grille de points ; « actif » = pixel non blanc (convention de lib/podMetrics.ts pour tft28). Reproduit à l'identique par le test TypeScript.
static uint16_t pix(int x, int y, int seed) { const int a = (((x >> 4) + (y >> 4) + seed) & 1) ^ (((x * 3 + y * 5 + seed) % 11) == 0 ? 1 : 0); return a ? (uint16_t)(0x07E0 ^ (seed & 0xFF)) : (uint16_t)0xFFFF; }
// Contenu brut tft28 (RGB565 petit-boutiste) : graine >= 0 -> motif déterministe (reproduit par le test TypeScript) ; graine -1 -> image uniforme noire (verdict « blank »).
static std::string content(int seed) {
  std::string s; s.reserve(RAW);
  for (int y = 0; y < 320; y++) for (int x = 0; x < 240; x++) { const uint16_t v = seed < 0 ? 0 : pix(x, y, seed); s.push_back((char)(v & 0xFF)); s.push_back((char)(v >> 8)); }
  return s;
}
struct VK {
  std::string candId = "11111111-2222-3333-4444-555555555555";
  std::string validateJson;                    // réponse de /api/validate-candidate avant le vote
  NetScript cand;                              // réponse de /api/candidate-frame
  int voteCode = 200; std::string voteBody = "{\"ok\":true,\"blockMined\":false,\"voteCount\":1,\"needed\":1}";
  bool voted = false;                          // le « serveur » a enregistré un vote 200 : validate-candidate répond alreadyVoted
  bool forgetful = false;                      // scénario « double-forgetful » : le serveur simulé NE SE SOUVIENT PAS du vote (met à nu l'absence de verrou LOCAL dans le firmware)
};
static VK V;
static std::string v2Json(const std::string& screen, int bytes, const std::string& hash) {
  return "{\"candidate\":{\"candidateId\":\"" + V.candId + "\",\"score_server\":0.5,\"poolScreen\":\"" + screen + "\",\"expiresIn\":600,\"v2\":{\"screen\":\"" + screen + "\",\"bytes\":" + std::to_string(bytes) + ",\"hash\":\"" + hash + "\"}}}";
}
static std::string v1Json() { return "{\"candidate\":{\"candidateId\":\"" + V.candId + "\",\"score_server\":0.5,\"poolScreen\":\"tft28\",\"expiresIn\":600}}"; }
static NetScript route(const NetRequest& r) {
  NetScript s;
  if (r.path.rfind("/api/validate-candidate", 0) == 0) { s.response = http(200, V.voted ? std::string("{\"candidate\":null,\"alreadyVoted\":true}") : V.validateJson); return s; }
  if (r.path.rfind("/api/candidate-frame", 0) == 0) return V.cand;
  if (r.path.rfind("/api/validation-result", 0) == 0) { if (V.voteCode == 200 && !V.forgetful) V.voted = true; s.response = http(V.voteCode, V.voteBody); return s; }
  if (r.path.rfind("/api/register", 0) == 0) { s.response = http(200, "{\"deviceId\":\"dev_TEST0001\",\"pairCode\":\"ABCD2345\",\"paired\":true}"); return s; }
  if (r.path.rfind("/api/pull?", 0) == 0) { s.response = http(200, "{\"frameSource\":\"none\",\"retryAfter\":300}"); return s; }
  s.response = http(404, "{}"); return s;     // pull-frame, ack-frame, obs-confirm... : ne doivent JAMAIS être appelés par un vote
}

// ─── monde ───────────────────────────────────────────────────────────────────────────────────────────────────────────
static uint8_t g_seed[32]; static bool g_keysOk = true;
static void world() {
  g_us = 1000000; g_requests.clear(); g_route = route; g_idleHook = nullptr; V = VK();
  g_sd = SdState(); g_tft = TftState(); Serial.log.clear(); g_strFailArmed = false; g_strAllocN = 0;
  podNetTestHook = nullptr; podNetTestFailAlloc = 0; podNetTestNested = 0; g_failNext = 0; g_failWhenLog.clear(); g_guardWhenLog.clear(); g_guardFired = 0;
  podEdTestHook = nullptr; podEdTestFailAlloc = 0; podEdTestNested = 0;
  std::memset(g_fakeStack, 0, sizeof g_fakeStack);
  deviceId = "dev_TEST0001"; pairCode = "ABCD2345"; registered = true; paired = true; lastFrameId = "frame-avant-vote"; lastFrameWasConsensus = false; pendingCandidateId = "";
  currentBlockIndex = 7; sdOk = true; sdFrameValid = false; cartelVisible = false; touchOk = false; animOn = false; animPaused = false; benchMode = false; pendingObsHashes = ""; pendingObsTarget = "";
  nextPullIntervalMs = PULL_INTERVAL; lastPullMs = 0; lastValidateMs = 0;
  g_sd.dirs.push_back("/pod");
  for (int i = 0; i < 32; i++) privateKey[i] = (uint8_t)(g_seed[i]);
  PodEd::derivePublicKey(publicKey, privateKey);
  if (!g_keysOk) { std::memset(privateKey, 0, 32); std::memset(publicKey, 0, 32); }   // génération des clés annulée : clés nulles, jamais chargées
  keysLoaded = g_keysOk;
}
static std::string hex(const uint8_t* p, size_t n) { static const char* H = "0123456789abcdef"; std::string s; for (size_t i = 0; i < n; i++) { s.push_back(H[p[i] >> 4]); s.push_back(H[p[i] & 15]); } return s; }
static int countReq(const char* path) { int n = 0; for (auto& r : g_requests) if (r.path.rfind(path, 0) == 0) n++; return n; }
static void report(const char* sc, bool ret, long fillsBefore, long busBefore, long writesBefore, const std::string& frameBefore) {
  std::printf("FACT scenario=%s\n", sc);
  std::printf("FACT ret=%d\n", ret ? 1 : 0);
  std::printf("FACT pending=%s\n", pendingCandidateId.length() ? pendingCandidateId.c_str() : "-");
  std::printf("FACT registered=%d\n", registered ? 1 : 0);
  std::printf("FACT validates=%d\n", countReq("/api/validate-candidate"));
  std::printf("FACT reads=%d\n", countReq("/api/candidate-frame"));
  std::printf("FACT posts=%d\n", countReq("/api/validation-result"));
  std::printf("FACT registers=%d\n", countReq("/api/register"));
  std::printf("FACT acks=%d\n", countReq("/api/ack-frame"));
  std::printf("FACT pullframes=%d\n", countReq("/api/pull-frame"));
  std::printf("FACT obs=%d\n", countReq("/api/obs-confirm"));
  std::printf("FACT bus_delta=%ld\n", g_tft.busBytes - busBefore);
  std::printf("FACT fills_delta=%ld\n", g_tft.fills - fillsBefore);
  std::printf("FACT sd_writes_delta=%ld\n", g_sd.writes - writesBefore);
  std::printf("FACT frame_unchanged=%d\n", frameBefore == lastFrameId.c_str() ? 1 : 0);
  std::printf("FACT guard_fired=%d\n", g_guardFired);
  std::printf("FACT deviceId=%s\n", deviceId.c_str());
  std::printf("FACT candidateId=%s\n", V.candId.c_str());
  std::printf("FACT pubkey=%s\n", hex(publicKey, 32).c_str());
  for (auto& r : g_requests) if (r.path.rfind("/api/validation-result", 0) == 0) std::printf("POST %s\n", r.body.c_str());
  size_t pos = 0; const std::string& L = Serial.log;
  while (pos < L.size()) { size_t e = L.find('\n', pos); if (e == std::string::npos) e = L.size(); const std::string line = L.substr(pos, e - pos); if (line.find("[VALIDATE") != std::string::npos || line.find("[HTTP") != std::string::npos || line.find("[SD]") != std::string::npos) std::printf("LOG %s\n", line.c_str()); pos = e + 1; }
}

int main(int argc, char** argv) {
  if (argc < 4) { std::printf("usage : tft28_vote_harness <scenario> <graine> <hashHex> [octetsAnnoncés]\n"); return 2; }
  const std::string sc = argv[1]; const int seed = std::atoi(argv[2]); const std::string hash = argv[3];
  const int announced = argc > 4 ? std::atoi(argv[4]) : (int)RAW;
  for (int i = 0; i < 32; i++) g_seed[i] = (uint8_t)(i * 7 + 3);
  g_keysOk = sc != "keys-not-loaded";
  world();
  std::string body = content(seed);
  const std::string resp = http(200, body); const size_t hdr = resp.size() - body.size();
  V.cand.response = resp;
  V.validateJson = sc == "v1-announced" ? v1Json() : sc == "unknown-screen" ? v2Json("weird", announced, hash) : v2Json("tft28", announced, hash);
  if (sc == "truncated") V.cand.closeAfter = hdr + 100000;
  if (sc == "stalled") V.cand.stallAfter = hdr + 100000;
  if (sc == "longer") { body += std::string(1000, 'x'); V.cand.response = http(200, body); }
  if (sc == "altered") { std::string b2 = body; b2[1000] = (char)(b2[1000] ^ 0x01); V.cand.response = http(200, b2); }
  if (sc == "fault-after-last") V.cand.faultAfter = hdr + RAW;
  if (sc == "fault-midway") V.cand.faultAfter = hdr + 50000;
  if (sc == "sig-403") { V.voteCode = 403; V.voteBody = "{\"error\":\"Signature invalide\"}"; }
  if (sc == "hash-422") { V.voteCode = 422; V.voteBody = "{\"error\":\"hash ou metriques differents\"}"; }
  if (sc == "mined") { V.voteBody = "{\"ok\":true,\"blockMined\":true,\"blockIndex\":96}"; }
  if (sc == "double-forgetful") V.forgetful = true;
  if (sc == "sign-fail") podEdTestFailAlloc = 1;
  if (sc == "post-not-executed") g_failWhenLog = "[VALIDATE2] signature en";
  if (sc == "post-executed-rejected") { g_guardWhenLog = "[VALIDATE2] signature en"; g_guardStackBytes = (unsigned)(POD_NET_STACK_TOTAL - POD_NET_GUARD_BYTES); podNetTestHook = smashGuardHook; }
  if (sc == "guard-on-read") { g_guardWhenLog = "[HTTP GET] /api/candidate-frame"; g_guardStackBytes = (unsigned)(POD_NET_STACK_TOTAL - POD_NET_GUARD_BYTES); podNetTestHook = smashGuardHook; }
  pendingCandidateId = V.candId.c_str();
  const long fills0 = g_tft.fills, bus0 = g_tft.busBytes, writes0 = g_sd.writes, opens0 = g_sd.opens; const size_t files0 = g_sd.files.size(); const std::string frame0 = lastFrameId.c_str();
  std::printf("FACT announced_hash=%s\n", hash.c_str());
  bool ret = doValidate();
  if (sc == "double" || sc == "double-forgetful") { pendingCandidateId = V.candId.c_str(); ret = doValidate() || ret; }   // le pull annonce de nouveau le MÊME candidat : le serveur répond « déjà voté » (sauf « forgetful »)
  // invariant S14 mesuré AVANT le tour de loop() (la ré-inscription peint un écran d'état)
  std::printf("FACT vote_bus_delta=%ld\n", g_tft.busBytes - bus0);
  std::printf("FACT vote_fills_delta=%ld\n", g_tft.fills - fills0);
  std::printf("FACT vote_sd_writes_delta=%ld\n", g_sd.writes - writes0);
  std::printf("FACT vote_sd_opens_delta=%ld\n", g_sd.opens - opens0);
  std::printf("FACT vote_sd_files_delta=%ld\n", (long)g_sd.files.size() - (long)files0);
  std::printf("FACT vote_acks=%d\n", countReq("/api/ack-frame"));
  std::printf("FACT vote_pullframes=%d\n", countReq("/api/pull-frame"));
  std::printf("FACT vote_obs=%d\n", countReq("/api/obs-confirm"));
  std::printf("FACT vote_frame_unchanged=%d\n", frame0 == lastFrameId.c_str() ? 1 : 0);
  if (sc == "sig-403") {
    std::printf("FACT registers_before_loop=%d\n", countReq("/api/register"));
    tft28_loop();                                                    // un tour de loop() : la ré-inscription est faite ICI, pas dans doValidate
  }
  report(sc.c_str(), ret, fills0, bus0, writes0, frame0);
  return 0;
}
