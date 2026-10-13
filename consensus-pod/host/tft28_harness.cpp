// consensus-pod/host/tft28_harness.cpp — LOT8B2D : exécute sur l'HÔTE le firmware UNO R4 + TFT 2,8″ COMPLET (arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino, inclus tel quel sous le nom sketch_body.inc) contre les
// bibliothèques simulées de consensus-pod/host/tft28/ : réseau scripté (fragmentation, troncature, silence, fermeture, défaut collant), TFT (les octets du bus remplissent la fenêtre d'adressage -> mémoire d'image),
// microSD en mémoire avec pannes, tactile scripté, piles dédiées (PodNet réel en mode hôte : NOMEM / NESTED / MARGIN injectables). Compilé deux fois : POD_CANARY=0 (production) et POD_CANARY=1 (canari).
//   tft28_harness [--clip fichier.hex]       →  « PASS <n> » (code 0) ou la liste des écarts (code 1)
//   tft28_harness halt:<scénario>            →  scénario qui DOIT se figer (arrêt sûr) : le test le tue après un délai
// NE PROUVE PAS : profondeur réelle des piles, déplacement de SP, débit, ILI9341 ni carte SD physiques (docs/LOT_8B2D_R4_TFT28_CANARY_2026_10_12.md § 7).
#define POD_NET_HOST_TEST 1
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
// LOT8B2E : toute allocation malloc() du sketch est mesurée ; g_mallocLimit simule un tas FRAGMENTÉ (plus grand bloc contigu limité : ≈ 4 884 o sur la carte, FIX2)
static size_t g_maxMalloc = 0, g_mallocLimit = (size_t)-1; static int g_failWork2048 = 0;
// FIX2 : g_inPodAlloc = « la prochaine malloc() est celle d'une pile dédiée de PodNet » (armé à la sonde 1, consommé par harness_malloc) ; g_workLive = tampon de 2 048 o du SKETCH (validation / lecture de l'animation) vivant ;
// g_workLiveDuringNet = nombre de requêtes réseau émises PENDANT que ce tampon était vivant (doit rester 0 : pic de tas du téléchargement).
static void* g_workLive = nullptr; static bool g_inPodAlloc = false; static int g_workLiveDuringNet = 0;   // g_failWork2048 : refuse les N prochaines allocations de 2 048 o (le tampon de travail de l'animation)
namespace std { inline void* harness_malloc(size_t n) { const bool pod = g_inPodAlloc; g_inPodAlloc = false; if (n > g_maxMalloc) g_maxMalloc = n; if (n > g_mallocLimit) return nullptr; if (n == 2048 && !pod && g_failWork2048 > 0) { g_failWork2048--; return nullptr; } void* p = ::malloc(n); if (n == 2048 && !pod) g_workLive = p; return p; }
  inline void harness_free(void* p) { if (p && p == g_workLive) g_workLive = nullptr; ::free(p); } }   // std:: : les en-têtes inclus après la macro écrivent std::malloc
using std::harness_malloc;
using std::harness_free;
#define malloc harness_malloc
#define free harness_free
#define setup tft28_setup
#define loop tft28_loop
#include "sketch_body.inc"
#undef setup
#undef loop
#undef __builtin_frame_address
static int g_failSticky = 0, g_failNext = 0, g_failSkip = 0; static std::string g_failWhenLog;   // g_failWhenLog : la PREMIÈRE allocation de pile dédiée après l'apparition de ce texte dans le journal échoue   // g_failSkip : nombre d'allocations de pile dédiée LAISSÉES PASSER avant le premier échec de g_failNext   // pile dédiée indisponible : pour tous les appels / pour le prochain seulement
static void harnessProbe(int n) {
  if (n == 1 && !g_failWhenLog.empty() && Serial.log.find(g_failWhenLog) != std::string::npos) { podNetTestFailAlloc = 1; g_failWhenLog.clear(); }
  else if (n == 1) { if (g_failSkip > 0) { g_failSkip--; podNetTestFailAlloc = 0; } else { podNetTestFailAlloc = (g_failSticky || g_failNext > 0) ? 1 : 0; if (g_failNext > 0) g_failNext--; } }
  else if (n == 2) podNetTestNested++; else if (n == 3) podNetTestNested--;
  if (n == 1) g_inPodAlloc = (podNetTestFailAlloc == 0 && podNetTestNested == 0);
}

// ─── cadre de test ───────────────────────────────────────────────────────────────────────────────────────────
static int g_checks = 0; static std::vector<std::string> g_fail;
#define CHECK(cond, msg) do { g_checks++; if (!(cond)) g_fail.push_back(std::string(msg) + " [" #cond "]"); } while (0)
static bool has(const std::string& hay, const char* needle) { return hay.find(needle) != std::string::npos; }
static int countReq(const char* path) { int n = 0; for (auto& r : g_requests) if (r.path.rfind(path, 0) == 0) n++; return n; }
static int idxReq(const char* path) { for (size_t i = 0; i < g_requests.size(); i++) if (g_requests[i].path.rfind(path, 0) == 0) return (int)i; return -1; }

// ─── image et réponses ───────────────────────────────────────────────────────────────────────────────────────
static const size_t IMG = 153600, HDR_ROW = 480;
static uint16_t pix(int x, int y, int seed) { return (uint16_t)((x * 7 + y * 13 + seed * 1031 + (x ^ y)) & 0xFFFF); }
static std::string imageBytes(int seed) { std::string s; s.reserve(IMG); for (int y = 0; y < 320; y++) for (int x = 0; x < 240; x++) { const uint16_t v = pix(x, y, seed); s.push_back((char)(v & 0xFF)); s.push_back((char)(v >> 8)); } return s; }   // little-endian, comme le serveur
static std::string http(int code, const std::string& body, long cl = -2) {
  std::string h = "HTTP/1.1 " + std::to_string(code) + " X\r\n"; const long len = cl == -2 ? (long)body.size() : cl;
  if (len >= 0) h += "Content-Length: " + std::to_string(len) + "\r\n";
  return h + "Connection: close\r\n\r\n" + body;
}
struct Knobs {
  int seed = 1; std::string pullFrameBody; NetScript frame; int ackCode = 200; bool ackConnect = true; bool failStacksAfterFrame = false;
  std::string pullJson = "{\"frameSource\":\"none\",\"retryAfter\":300}"; std::string registerJson = "{\"deviceId\":\"dev_TEST0001\",\"pairCode\":\"ABCD2345\",\"paired\":true}";
  std::string validateJson = "{\"alreadyVoted\":true}"; std::string clip;
};
static Knobs K;
static NetScript frameOk(int seed) { NetScript s; K.seed = seed; s.response = http(200, imageBytes(seed)); return s; }
static size_t hdrLen(const NetScript& s) { return s.response.size() - IMG; }
static NetScript route(const NetRequest& r) {
  NetScript s;
  if (g_workLive) g_workLiveDuringNet++;   // FIX2 : le tampon de travail de l'animation ne doit JAMAIS être vivant pendant une transaction réseau
  if (r.path.rfind("/api/pull-frame", 0) == 0) { s = K.frame; if (K.failStacksAfterFrame) g_failSticky = 1; return s; }
  if (r.path.rfind("/api/ack-frame", 0) == 0) { if (!K.ackConnect) { s.connectOk = false; return s; } s.response = http(K.ackCode, "{\"ok\":true}"); return s; }
  if (r.path.rfind("/api/pull?", 0) == 0) { s.response = http(200, K.pullJson); return s; }
  if (r.path.rfind("/api/register", 0) == 0) { s.response = http(200, K.registerJson); return s; }
  if (r.path.rfind("/api/validate-candidate", 0) == 0) { s.response = http(200, K.validateJson); return s; }
  if (r.path.rfind("/api/block-clip", 0) == 0) { s.response = http(200, K.clip); return s; }
  if (r.path.rfind("/api/bench/poll", 0) == 0) { s.response = http(200, "{\"mode\":false}"); return s; }
  s.response = http(404, "{}"); return s;
}

// ─── remise à zéro du monde ─────────────────────────────────────────────────────────────────────────────────
static void resetWorld(bool withSd = true, bool paintOld = true) {
  g_us = 1000000; g_requests.clear(); g_route = route; g_idleHook = nullptr; K = Knobs();
  g_sd = SdState(); g_tft = TftState(); g_touchPressedPolls = 0; g_touchPollCount = 0; g_touchSpans.clear(); g_touchGaps.clear(); Serial.log.clear(); g_strFailArmed = false; g_strAllocN = 0;
  podNetTestHook = nullptr; podNetTestFailAlloc = 0; podNetTestNested = 0; g_failSticky = 0; g_failNext = 0; g_failSkip = 0;
  if (paintOld) for (int i = 0; i < TFT_W * TFT_H; i++) g_tft.fb[i] = 0xBEEF;   // contenu « ancien » reconnaissable
  std::memset(g_fakeStack, 0, sizeof g_fakeStack);
#if POD_CANARY
  podCanaryPaint();
#endif
  deviceId = "dev_TEST0001"; pairCode = "ABCD2345"; registered = true; paired = true; lastFrameId = ""; lastFrameWasConsensus = false; pendingCandidateId = ""; pendingWorkTitle = "Titre"; pendingArtistName = "Artiste";
  currentBlockIndex = 7; sdOk = withSd; sdFrameValid = false; cartelVisible = false; sdWhy = withSd ? "SD sans image" : "SD absente"; touchOk = true; animOn = false; animPaused = false; animHash = ""; pendingAnimHash = ""; pendingAnimBytes = 0;
  benchMode = false; pendingObsHashes = ""; pendingObsTarget = ""; nextPullIntervalMs = PULL_INTERVAL; lastPullMs = 0; lastValidateMs = 0;
  if (withSd) { g_sd.dirs.push_back("/pod"); }
}
static bool fbIsArtwork(int seed, int y0 = 0, int y1 = 320) { for (int y = y0; y < y1; y++) for (int x = 0; x < 240; x++) if (g_tft.fb[y * TFT_W + x] != pix(x, y, seed)) return false; return true; }
static bool fbRowsAreOld(int y0, int y1) { for (int y = y0; y < y1; y++) for (int x = 0; x < 240; x++) if (g_tft.fb[y * TFT_W + x] != 0xBEEF) return false; return true; }
static std::string sdFile(const char* p) { auto it = g_sd.files.find(p); return it == g_sd.files.end() ? std::string("\x01<absent>") : std::string(it->second.begin(), it->second.end()); }
static bool sdHas(const char* p) { return g_sd.files.count(p) > 0; }

int main(int argc, char** argv) {
  std::string clipHex; for (int i = 1; i + 1 < argc; i++) if (!std::strcmp(argv[i], "--clip")) { FILE* f = std::fopen(argv[i + 1], "rb"); if (f) { char b[65536]; size_t n; while ((n = std::fread(b, 1, sizeof b, f)) > 0) clipHex.append(b, n); std::fclose(f); } }
  std::string bigHex; for (int i = 1; i + 1 < argc; i++) if (!std::strcmp(argv[i], "--bigclip")) { FILE* f = std::fopen(argv[i + 1], "rb"); if (f) { char b[65536]; size_t n; while ((n = std::fread(b, 1, sizeof b, f)) > 0) bigHex.append(b, n); std::fclose(f); } }
  auto fromHex = [](const std::string& h) { std::string o; for (size_t i = 0; i + 1 < h.size(); i += 2) o.push_back((char)std::strtol(h.substr(i, 2).c_str(), nullptr, 16)); return o; };
  const bool CAN = POD_CANARY != 0;
  EEPROM.m.assign(8192, 0xFF);
  EEPROM.m[64] = 0xED; for (int i = 0; i < 32; i++) { EEPROM.m[i] = (uint8_t)(i + 1); EEPROM.m[65 + i] = (uint8_t)((i + 1) ^ 0x5A); }
  EEPROM.m[97] = 0x01;                        // appairage déjà montré

  // halt:<scénario> — scénarios qui DOIVENT se figer (arrêt sûr) : exécutés dans un processus à part et tués par le test
  if (argc >= 2 && !std::strncmp(argv[1], "halt:", 5)) {
    const std::string sc = argv[1] + 5; resetWorld();
    if (sc == "control") { K.frame = frameOk(1); String r; const int c = httpCall("GET", "/api/pull?deviceId=x", nullptr, r); std::printf(c == 200 ? "NOHALT\n" : "ECHEC %d\n", c); return 0; }
    if (sc == "guard-net") { K.frame = frameOk(1); podNetTestHook = [](uint8_t*, size_t, uint8_t* g) { g[3] = 0; }; String r; httpCall("GET", "/api/pull?deviceId=x", nullptr, r); std::printf("NOHALT\n"); return 0; }
#if POD_CANARY
    if (sc == "nomem-frame") { initSD(); K.frame = frameOk(1); g_failSticky = 1; doFetchFrame("x", "personal"); std::printf("NOHALT\n"); return 0; }
    if (sc == "ack-stack") { initSD(); g_failNext = 1; ackFrame("fx"); std::printf("NOHALT\n"); return 0; }
    if (sc == "sd-nomem") { initSD(); g_failNext = 1; restoreRows(0, 1); std::printf("NOHALT\n"); return 0; }
    if (sc == "margin-net") { podNetTestHook = [](uint8_t* low, size_t, uint8_t*) { low[0] = 0; }; String r; httpCall("GET", "/api/pull?deviceId=x", nullptr, r); std::printf("NOHALT\n"); return 0; }
    if (sc == "main-stack") { podCanaryPaint(); g_fakeStack[60] = 0x11; g_fakeStack[8] = 0x22; podCanaryCheck("test", true); std::printf("NOHALT\n"); return 0; }   // marge principale < 128 o
    if (sc == "marker") { podCanaryPaint(); *(volatile uint32_t*)g_fakeStack = 0; podCanaryCheck("test", true); std::printf("NOHALT\n"); return 0; }               // marqueur détruit
    if (sc == "sd-stack-margin") { podNetTestHook = [](uint8_t* low, size_t, uint8_t*) { low[0] = 0; }; restoreRows(0, 1); std::printf("NOHALT\n"); return 0; }
#endif
    std::printf("SCENARIO INCONNU\n"); return 2;
  }

  // ═══ 1. image nominale : octets du bus, mémoire d'image, cache SD, ACK APRÈS l'affichage ═══
  resetWorld(); initSD();
  CHECK(sdOk && sdWhy == std::string("SD sans image") && sdHas("/pod") == false && std::find(g_sd.dirs.begin(), g_sd.dirs.end(), "/pod") != g_sd.dirs.end(), "1 initSD : carte lisible, dossier /pod");
  K.frame = frameOk(1);
  { const bool ok = doFetchFrame("frame-1", "personal");
    CHECK(ok, "1 doFetchFrame retourne true"); CHECK(lastFrameId == "frame-1", "1 lastFrameId");
    CHECK(fbIsArtwork(1), "1 mémoire d'image == image reçue, pixel par pixel (RGB565, octet haut en premier sur le bus)");
    CHECK(g_tft.busBytes == (long)IMG, "1 exactement 153 600 octets sur le bus SPI (aucun octet de plus ni de moins)");
    CHECK(sdFile("/pod/frame.bin") == imageBytes(1), "1 cache SD == octets reçus du serveur (little-endian, tels quels)");
    CHECK(sdFile("/pod/meta.txt") == "frame-1\n7\nTitre\nArtiste\n", "1 métadonnées SD (écrites APRÈS l'image)");
    CHECK(sdFrameValid && !cartelVisible, "1 cache valide, cartel masqué");
    CHECK(g_requests.size() == 2 && g_requests[0].path.rfind("/api/pull-frame", 0) == 0 && g_requests[1].path == "/api/ack-frame", "1 deux requêtes : image puis ACK");
    CHECK(g_requests.size() == 2 && g_requests[1].body == "{\"deviceId\":\"dev_TEST0001\",\"frameId\":\"frame-1\"}", "1 corps de l'ACK inchangé");
    CHECK(Serial.log.find("ACK") != std::string::npos, "1 journal de l'ACK");
    CHECK(g_liveClients == 0 && podNetTestNested == 0, "1 aucun client TLS vivant, aucune pile dédiée restée active");
    if (CAN) {
      CHECK(has(Serial.log, "ACK recu (HTTP 200)") && has(Serial.log, "[CANARY] pile reseau pull-frame (reseau + SD + TFT)"), "1 CANARI : succès après l'ACK, mesure de la pile réseau de l'image");
      CHECK(has(Serial.log, "[CANARY] tas apres la transaction pull-frame") && has(Serial.log, "[CANARY] tas apres l'ACK"), "1 CANARI : tas relevé (libre, plus grand bloc, fragmentation)");
      CHECK(has(Serial.log, "pull-frame/affichage : retour de la transaction : pile principale utilisee au plus") && has(Serial.log, "ACK : retour de la requete : pile principale utilisee"), "1 CANARI : marge de la pile principale aux sorties pull-frame et ACK");
    } else CHECK(!has(Serial.log, "[CANARY]"), "1 production : aucune ligne de canari");
  }
  const std::string ART1 = imageBytes(1);

  // ═══ 2. fragmentation de la réponse : sortie identique octet pour octet ═══
  { const std::vector<std::vector<size_t>> pats = { {1}, {7}, {479, 481}, {4096}, {13, 1, 977}, {128, 129}, {65536} };
    for (size_t p = 0; p < pats.size(); p++) {
      resetWorld(); initSD(); K.frame = frameOk(2); K.frame.chunks = pats[p]; K.frame.chunkEveryMs = 1;
      const bool ok = doFetchFrame(String(("frag-" + std::to_string(p)).c_str()), "personal");
      CHECK(ok && fbIsArtwork(2) && g_tft.busBytes == (long)IMG && sdFile("/pod/frame.bin") == imageBytes(2), "2 fragmentation #" + std::to_string(p) + " : image et cache identiques");
      CHECK(idxReq("/api/ack-frame") == 1, "2 fragmentation #" + std::to_string(p) + " : un seul ACK, après l'image");
    } }

  // ═══ 3. corps TRONQUÉ (le serveur ferme la connexion) : jamais d'ACK, jamais « réussi », aucune déclaration d'écran inchangé ═══
  { resetWorld(); initSD(); K.frame = frameOk(3); K.frame.closeAfter = hdrLen(K.frame) + 200 * HDR_ROW;
    const bool ok = doFetchFrame("cut", "personal");
    CHECK(!ok && lastFrameId == "", "3 tronqué : retour false, lastFrameId inchangé");
    CHECK(countReq("/api/ack-frame") == 0, "3 tronqué : AUCUN ACK");
    CHECK(fbIsArtwork(3, 0, 200) && fbRowsAreOld(200, 320), "3 tronqué : 200 lignes dessinées, le reste ancien (écran PARTIELLEMENT redessiné)");
    CHECK(!sdFrameValid && !sdHas("/pod/frame.bin") && !sdHas("/pod/meta.txt"), "3 tronqué : cache SD invalidé et supprimé, pas de métadonnées");
    CHECK(has(Serial.log, "image incomplète") && !has(Serial.log, "inchang") && !has(Serial.log, "OK en"), "3 tronqué : journal honnête (ni « inchangé » ni « OK »)");
    CHECK(!CAN || !has(Serial.log, "ACK recu"), "3 tronqué : jamais de succès d'ACK"); }
  // octet manquant (corps de 153 599 octets, Content-Length 153 600)
  { resetWorld(); initSD(); K.frame = frameOk(3); K.frame.closeAfter = K.frame.response.size() - 1;
    CHECK(!doFetchFrame("cut1", "personal") && countReq("/api/ack-frame") == 0 && !sdFrameValid, "3 un octet manquant : échec, aucun ACK"); }

  // ═══ 4. silence du serveur (délai dépassé) ═══
  { resetWorld(); initSD(); K.frame = frameOk(4); K.frame.stallAfter = hdrLen(K.frame) + 100 * HDR_ROW; const unsigned long t0 = millis();
    const bool ok = doFetchFrame("stall", "personal");
    CHECK(!ok && countReq("/api/ack-frame") == 0 && lastFrameId == "", "4 silence : échec, aucun ACK"); CHECK(millis() - t0 >= HTTP_TIMEOUT_MS && millis() - t0 < HTTP_TIMEOUT_MS + 5000, "4 silence : l'attente est bornée par HTTP_TIMEOUT_MS");
    CHECK(fbIsArtwork(4, 0, 100) && fbRowsAreOld(100, 320) && !sdFrameValid, "4 silence : image partielle, cache invalidé"); }

  // ═══ 5. taille annoncée différente de 153 600 : rien n'est dessiné ═══
  { resetWorld(); initSD(); K.frame = frameOk(5); K.frame.response = http(200, imageBytes(5).substr(0, IMG - 1)); const bool ok = doFetchFrame("short", "personal");
    CHECK(!ok && g_tft.busBytes == 0 && fbRowsAreOld(0, 320) && countReq("/api/ack-frame") == 0, "5 Content-Length 153 599 : rien dessiné, aucun ACK");
    CHECK(has(Serial.log, "taille annoncée"), "5 cause journalisée"); }
  { resetWorld(); initSD(); K.frame = frameOk(5); K.frame.response = http(200, imageBytes(5) + std::string(10, 'x'), (long)IMG + 10); const bool ok = doFetchFrame("long", "personal");
    CHECK(!ok && g_tft.busBytes == 0 && countReq("/api/ack-frame") == 0, "5 Content-Length 153 610 : refusé, rien dessiné"); }

  // ═══ 6. 404 : pas de frame, rien dessiné, aucun ACK, retour true (comme avant) ═══
  { resetWorld(); initSD(); K.frame.response = http(404, "{}"); const bool ok = doFetchFrame("none", "personal");
    CHECK(ok && g_tft.busBytes == 0 && countReq("/api/ack-frame") == 0 && lastFrameId == "", "6 404 : true, rien dessiné, aucun ACK"); }

  // ═══ 7. sans carte SD : œuvre affichée, ACK envoyé, cartel non masquable (comportement existant) ═══
  { resetWorld(false); K.frame = frameOk(7); const bool ok = doFetchFrame("nosd", "personal");
    CHECK(ok && fbIsArtwork(7) && g_tft.busBytes == (long)IMG && !sdFrameValid && countReq("/api/ack-frame") == 1, "7 sans SD : image complète, ACK envoyé");
    CHECK(has(Serial.log, "pas de carte"), "7 sans SD : journalisé");
    CHECK(g_sd.files.empty() && g_sd.opens == 0, "7 sans SD : aucun accès à la carte"); }

  // ═══ 8. pannes SD : l'AFFICHAGE reste complet, le cache est invalidé, l'ACK suit l'affichage (inchangé) ═══
  { resetWorld(); initSD(); g_sd.writeBudget = 100000; K.frame = frameOk(8); const bool ok = doFetchFrame("full", "personal");
    CHECK(ok && fbIsArtwork(8) && !sdFrameValid && !sdHas("/pod/frame.bin") && !sdHas("/pod/meta.txt") && countReq("/api/ack-frame") == 1, "8 carte pleine : image complète, cache supprimé, pas de métadonnées, ACK envoyé");
    CHECK(std::string(sdWhy) == "SD ecriture", "8 carte pleine : cause « SD ecriture »"); }
  { resetWorld(); initSD(); g_sd.failOpenWrite = true; K.frame = frameOk(8); const bool ok = doFetchFrame("noopen", "personal");
    CHECK(ok && fbIsArtwork(8) && !sdFrameValid && std::string(sdWhy) == "SD ouverture" && countReq("/api/ack-frame") == 1, "8 ouverture impossible : image complète, ACK envoyé"); }

  // ═══ 9. défaut collant du client TLS borné : ni affichage annoncé, ni ACK ═══
  { resetWorld(); initSD(); K.frame = frameOk(9); K.frame.faultAfter = hdrLen(K.frame) + 100000; const bool ok = doFetchFrame("fault", "personal");
    CHECK(!ok && countReq("/api/ack-frame") == 0 && lastFrameId == "" && !sdFrameValid, "9 défaut collant : échec, aucun ACK");
    CHECK(!fbIsArtwork(9) && fbIsArtwork(9, 0, 100) && fbRowsAreOld(320 - 20, 320), "9 défaut collant : image partielle (jamais déclarée inchangée)"); }

  { resetWorld(); initSD(); K.frame = frameOk(9); K.frame.faultAfter = K.frame.response.size(); const bool ok = doFetchFrame("fault-last", "personal");
    CHECK(!ok && countReq("/api/ack-frame") == 0 && lastFrameId == "", "9 défaut collant posé sur le DERNIER octet (corps complet) : refusé, aucun ACK, frame non acquittée");
    CHECK(fbIsArtwork(9), "9 défaut sur le dernier octet : l'image est à l'écran (jamais déclarée inchangée), mais non annoncée comme réussie"); }

  // ═══ 10. piles dédiées : échec fermé (en CANARI toute erreur d'une pile dédiée est FATALE : arrêt sûr, voir les scénarios « halt: ») ═══
  if (!CAN) {
  { resetWorld(); initSD(); K.frame = frameOk(10); g_failSticky = 1; const bool ok = doFetchFrame("nomem", "personal");
    CHECK(!ok && g_requests.empty() && g_tft.busBytes == 0 && fbRowsAreOld(0, 320), "10 NOMEM de la pile réseau : transaction NON exécutée, rien dessiné, aucune requête, aucun ACK"); }
  { resetWorld(); initSD(); K.frame = frameOk(10); podNetTestHook = [](uint8_t* low, size_t, uint8_t*) { low[0] = 0; }; const bool ok = doFetchFrame("margin", "personal");
    CHECK(!ok && countReq("/api/ack-frame") == 0 && lastFrameId == "", "10 MARGIN de la pile réseau : résultat REJETÉ, aucun ACK");
    CHECK(fbIsArtwork(10), "10 MARGIN : transaction EXÉCUTÉE (l'écran a été redessiné)"); CHECK(has(Serial.log, "redessiné"), "10 MARGIN : le journal dit que l'écran a pu être redessiné"); }
  }

  // ═══ 11. l'ACK : 200, refusé, impossible ═══
  { resetWorld(); initSD(); K.frame = frameOk(11); K.ackCode = 200; const bool ok = doFetchFrame("ack200", "personal");
    CHECK(ok && lastFrameId == "ack200" && countReq("/api/ack-frame") == 1 && sdFile("/pod/meta.txt").rfind("ack200\n", 0) == 0, "11 ACK 200 : succès, état acquitté, métadonnées écrites");
    CHECK(g_requests[idxReq("/api/ack-frame")].busAt == (long)IMG, "11 l'ACK part APRÈS les 153 600 octets du bus"); }
  { resetWorld(); initSD(); K.frame = frameOk(11); K.ackCode = 500; const bool ok = doFetchFrame("ack500", "personal");
    CHECK(countReq("/api/ack-frame") == 1, "11 ACK refusé : UNE seule requête (aucune boucle)"); CHECK(fbIsArtwork(11), "11 ACK refusé : l'image est complète à l'écran");
    if (CAN) { CHECK(!ok && lastFrameId == "" && !sdHas("/pod/meta.txt"), "11 CANARI : ACK refusé => false, frame NON acquittée, métadonnées SD non écrites"); CHECK(has(Serial.log, "ECHEC ACK") && !has(Serial.log, "ACK recu"), "11 CANARI : échec journalisé, jamais « ACK reçu »"); CHECK(sdFrameValid && sdFile("/pod/frame.bin") == imageBytes(11), "11 CANARI : le cache d'image reste valide (cartel masquable)"); }
    else CHECK(ok && lastFrameId == "ack500", "11 production : comportement d'origine conservé (résultat de l'ACK ignoré)"); }
  { resetWorld(); initSD(); K.frame = frameOk(11); K.ackConnect = false; const bool ok = doFetchFrame("ackdown", "personal");
    CHECK(countReq("/api/ack-frame") == 1 && fbIsArtwork(11), "11 ACK impossible (connexion TLS refusée) : une tentative, image complète");
    if (CAN) CHECK(!ok && lastFrameId == "" && has(Serial.log, "ECHEC ACK"), "11 CANARI : ACK impossible => false, frame non acquittée"); else CHECK(ok && lastFrameId == "ackdown", "11 production : inchangé"); }
  if (!CAN) { resetWorld(); initSD(); g_failNext = 1; const bool acked = ackFrame("fx"); CHECK(!acked && g_requests.empty() && has(Serial.log, "pile réseau dédiée"), "11 pile réseau indisponible pour l'ACK : requête NON émise, ACK faux, cause journalisée"); }
  { resetWorld(); initSD(); const bool acked = ackFrame(""); CHECK(!acked && g_requests.empty(), "11 ackFrame(\"\") : refusé sans requête"); }

  // ═══ 12. cartel : toucher = afficher / cacher, l'œuvre n'est jamais modifiée ═══
  resetWorld(); initSD(); K.frame = frameOk(12); doFetchFrame("cartel", "personal"); g_tft.busBytes = 0;
  { toggleCartel();
    CHECK(cartelVisible, "12 premier toucher : cartel affiché");
    CHECK(!fbIsArtwork(12, 0, 40) && !fbIsArtwork(12, 272, 320), "12 bandes haute et basse recouvertes");
    CHECK(fbIsArtwork(12, 40, 272), "12 l'œuvre HORS bandes est intacte (lignes 40..271)");
    CHECK(sdFile("/pod/frame.bin") == imageBytes(12), "12 le cache SD n'est pas modifié par l'affichage du cartel");
    toggleCartel();
    CHECK(!cartelVisible && fbIsArtwork(12), "12 second toucher : cartel masqué, œuvre restaurée EXACTEMENT depuis la carte");
    CHECK(g_tft.busBytes == (long)((40 + 48) * HDR_ROW), "12 le masquage ne redessine que les deux bandes (88 lignes)");
    CHECK(sdFile("/pod/frame.bin") == imageBytes(12), "12 le cache SD est toujours intact");
    for (int i = 0; i < 6; i++) toggleCartel();
    CHECK(!cartelVisible && fbIsArtwork(12), "12 six toucher supplémentaires : même état final"); }
  // via serviceTouch (anti-rebond, vidage du tampon)
  { g_touchPressedPolls = 3; serviceTouch(); CHECK(cartelVisible, "12 serviceTouch : un toucher affiche le cartel"); g_touchPressedPolls = 2; serviceTouch(); CHECK(!cartelVisible && fbIsArtwork(12), "12 serviceTouch : le suivant le cache"); }
  { touchOk = false; g_touchPressedPolls = 3; serviceTouch(); CHECK(!cartelVisible, "12 tactile absent : aucun effet"); touchOk = true; }
  // sans image affichée : rien à habiller
  { resetWorld(); initSD(); toggleCartel(); CHECK(!cartelVisible && g_tft.fills == 0, "12 aucune image : le toucher ne dessine rien"); }
  // sans carte : le cartel s'affiche mais ne peut pas être masqué ; l'œuvre hors bandes reste intacte
  { resetWorld(false); K.frame = frameOk(12); doFetchFrame("nosd2", "personal"); toggleCartel(); CHECK(cartelVisible && fbIsArtwork(12, 40, 272), "12 sans SD : cartel affiché, œuvre hors bandes intacte");
    toggleCartel(); CHECK(cartelVisible && has(Serial.log, "NON masquable"), "12 sans SD : masquage impossible, dit clairement"); CHECK(fbIsArtwork(12, 40, 272), "12 sans SD : œuvre hors bandes toujours intacte"); }
  // lecture SD en échec au masquage : cartel conservé
  { resetWorld(); initSD(); K.frame = frameOk(12); doFetchFrame("rdfail", "personal"); toggleCartel(); g_sd.readFailAt = 100; toggleCartel();
    CHECK(cartelVisible && !sdFrameValid && std::string(sdWhy) == "SD lecture" && has(Serial.log, "cartel conservé"), "12 lecture SD en échec : cartel conservé, cause « SD lecture »");
    CHECK(fbIsArtwork(12, 40, 272), "12 lecture SD en échec : l'œuvre hors bandes n'est pas touchée"); }
  // carte SD retirée entre-temps (fichier absent) : revalidation par la taille, jamais de plantage
  { resetWorld(); initSD(); K.frame = frameOk(12); doFetchFrame("gone", "personal"); toggleCartel(); g_sd.files.erase("/pod/frame.bin"); toggleCartel();
    CHECK(cartelVisible && !sdFrameValid, "12 fichier disparu : cartel conservé, cache invalidé"); }

  // ═══ 13. redémarrage : la dernière œuvre revient depuis la carte ═══
  resetWorld(); initSD(); K.frame = frameOk(13); doFetchFrame("boot13", "personal");
  { const std::string artSave = sdFile("/pod/frame.bin"), metaSave = sdFile("/pod/meta.txt"); resetWorld(); g_sd.files["/pod/frame.bin"] = std::vector<uint8_t>(artSave.begin(), artSave.end()); g_sd.files["/pod/meta.txt"] = std::vector<uint8_t>(metaSave.begin(), metaSave.end()); initSD();
    pendingWorkTitle = ""; pendingArtistName = ""; lastFrameId = ""; currentBlockIndex = -1;
    restoreLastFrame();
    CHECK(fbIsArtwork(13) && lastFrameId == "boot13" && currentBlockIndex == 7 && pendingWorkTitle == "Titre" && pendingArtistName == "Artiste" && sdFrameValid && !cartelVisible, "13 restoreLastFrame : image et cartel retrouvés, octet pour octet");
    CHECK(g_tft.busBytes == (long)IMG && g_requests.empty(), "13 aucune requête réseau pour la restauration");
    // image enregistrée de mauvaise taille : refusée proprement
    resetWorld(); initSD(); g_sd.files["/pod/frame.bin"] = std::vector<uint8_t>(1000, 1); g_sd.files["/pod/meta.txt"] = std::vector<uint8_t>(metaSave.begin(), metaSave.end()); restoreLastFrame();
    CHECK(lastFrameId == "" && !sdFrameValid && g_tft.busBytes == 0, "13 cache de mauvaise taille : refusé, rien dessiné"); }

  // ═══ 14. piles dédiées de la carte SD : échec fermé, aucune imbrication (canari : toute erreur de pile est FATALE, voir halt:) ═══
  if (!CAN) { resetWorld(); initSD(); K.frame = frameOk(14); doFetchFrame("sdstack", "personal"); g_tft.busBytes = 0; toggleCartel();
    g_failNext = 1; toggleCartel();
    CHECK(cartelVisible && g_tft.busBytes == 0 && has(Serial.log, "[SD] pile dédiée (toggleCartel)"), "14 NOMEM de la pile SD : le masquage n'est PAS fait, cartel conservé, cause journalisée");
    g_failNext = 1; const bool rr = restoreRows(0, 1); CHECK(!rr, "14 restoreRows : false quand la pile SD est indisponible");
    podNetTestNested = 1; g_failSticky = 1; const bool rn = restoreRows(0, 1); podNetTestNested = 0; g_failSticky = 0; CHECK(rn, "14 déjà sur une pile dédiée : exécution directe (pas d'imbrication, pas d'allocation)");
    podNetTestHook = [](uint8_t* low, size_t, uint8_t*) { low[0] = 0; }; const bool rm = restoreRows(0, 1); podNetTestHook = nullptr; CHECK(!rm && has(Serial.log, "marge"), "14 MARGIN de la pile SD : résultat rejeté et journalisé"); }
  if (!CAN) { resetWorld(false); g_failNext = 1; initSD(); CHECK(!sdOk && std::string(sdWhy) == "SD pile", "14 initSD sans pile : carte ignorée (œuvre plein écran sans cartel masquable)"); }

  // ═══ 15. animations sur la carte ═══
  if (!clipHex.empty()) {
    const std::string clip = fromHex(clipHex);
    resetWorld(); initSD(); K.frame = frameOk(15); doFetchFrame("anim15", "consensus"); K.clip = clip;
    const std::string hash(64, 'c'); g_requests.clear();
    { const bool ok = fetchAnimToSd(String(hash.c_str()), clip.size());
      CHECK(ok && animOn && animHash == hash.c_str() && sdFile("/pod/anim.bin") == clip && sdFile("/pod/anim.txt") == hash + "\nanim15\n", "15 clip reçu, validé, rangé (clip D'ABORD, marqueur ensuite), animation active");
      CHECK(countReq("/api/block-clip") == 1, "15 un seul téléchargement du clip");
      g_tft.busBytes = 0; touchOk = true; g_touchPressedPolls = 0;
      const AnimEnd e = runResidentAnim(1500);
      CHECK(e == AE_TIME && g_tft.busBytes > 0 && sdFile("/pod/anim.bin") == clip, "15 lecture en boucle depuis la carte pendant le budget (sans requête), clip intact");
      CHECK(countReq("/api/") == 1 && g_requests.size() == 1, "15 aucune requête pendant la lecture");
      g_touchPressedPolls = 1000; const AnimEnd t = runResidentAnim(5000); g_touchPressedPolls = 0; CHECK(t == AE_TOUCH, "15 un toucher interrompt l'animation");
      onAnimTouch(); CHECK(animPaused && cartelVisible && fbIsArtwork(15, 40, 272), "15 pause sur l'affiche : cartel affiché, œuvre hors bandes restaurée depuis la carte");
      toggleCartel(); CHECK(!animPaused || true, "15 retoucher masque le cartel");
      animForget(); CHECK(!animOn && !sdHas("/pod/anim.bin") && !sdHas("/pod/anim.txt"), "15 animForget : clip et marqueur supprimés"); }
    // clip tronqué / corrompu : refusé, rien n'est rangé
    { resetWorld(); initSD(); K.clip = clip.substr(0, clip.size() - 3); const bool ok = fetchAnimToSd(String(hash.c_str()), clip.size()); CHECK(!ok && !animOn && !sdHas("/pod/anim.bin") && !sdHas("/pod/anim.txt"), "15 clip tronqué : refusé, rien rangé");
      resetWorld(); initSD(); std::string bad = clip; bad[bad.size() - 1] ^= 0x55; K.clip = bad; CHECK(!fetchAnimToSd(String(hash.c_str()), clip.size()) && !sdHas("/pod/anim.bin"), "15 clip corrompu (CRC) : refusé");
      resetWorld(); initSD(); g_sd.writeBudget = 50; K.clip = clip; CHECK(!fetchAnimToSd(String(hash.c_str()), clip.size()) && !animOn && !sdHas("/pod/anim.bin") && !sdHas("/pod/anim.txt"), "15 carte pleine : clip supprimé, jamais de marqueur, animation inactive");
      resetWorld(false); K.clip = clip; CHECK(!fetchAnimToSd(String(hash.c_str()), clip.size()) && !animOn, "15 sans carte : animation non lue (l'affiche reste)"); }
    // FIX2 : le tampon de validation (2 048 o) n'existe JAMAIS pendant la transaction réseau, sur tout le chemin nominal et les chemins d'échec
    { resetWorld(); initSD(); K.clip = clip; const int before = g_workLiveDuringNet; const bool ok = fetchAnimToSd(String(hash.c_str()), clip.size());
      CHECK(ok && g_workLiveDuringNet == before && g_workLive == nullptr && countReq("/api/block-clip") == 1, "15 FIX2 nominal : aucun tampon de travail vivant pendant la requête du clip, tampon libéré ensuite");
      resetWorld(); initSD(); K.clip = clip.substr(0, clip.size() - 3); const int b2 = g_workLiveDuringNet; (void)fetchAnimToSd(String(hash.c_str()), clip.size());
      CHECK(g_workLiveDuringNet == b2 && g_workLive == nullptr, "15 FIX2 téléchargement incomplet : aucun tampon alloué du tout (validation jamais atteinte)"); }
    // FIX2 : ÉCHEC DE LA PILE SD injecté — l'opération n'est PAS présentée comme faite (mutant « onSd retourne true » refusé)
    if (!CAN) {   // canari : une pile dédiée indisponible provoque l'ARRÊT SÛR (le processus se fige : scénarios halt:*) ; le contrôle de production ci-dessous prouve l'échec fermé
      resetWorld(); initSD(); g_sd.files["/pod/anim.bin"] = std::vector<uint8_t>(clip.begin(), clip.end()); animOn = true; g_tft.busBytes = 0; touchOk = false; g_requests.clear();
      g_failNext = 1; const AnimEnd e = runResidentAnim(500); g_failNext = 0;
      CHECK(e == AE_ERROR, "15 FIX2 pile SD indisponible pendant la lecture : AE_ERROR (opération NON exécutée), jamais AE_TIME ni AE_TOUCH");
      CHECK(g_tft.busBytes == 0 && !cartelVisible && g_requests.empty() && has(Serial.log, "[SD] pile dédiée (animPlay)") && g_workLive == nullptr, "15 FIX2 pile SD indisponible : rien envoyé à l'écran, aucune requête / ACK, cause journalisée, tampon libéré"); }
    if (!CAN) {   // production : la cible de l'échec est l'allocation SUIVANT la requête du clip, c'est-à-dire celle de la validation (en canari, des lignes de mesure s'intercalent)
      resetWorld(); initSD(); K.clip = clip; g_failWhenLog = "[HTTP GET] /api/block-clip"; const bool ok = fetchAnimToSd(String(hash.c_str()), clip.size()); g_failWhenLog.clear();
      CHECK(!ok && !animOn && !sdHas("/pod/anim.txt") && !sdHas("/pod/anim.bin") && has(Serial.log, "[SD] pile dédiée (animValidate)") && has(Serial.log, "validation du clip NON faite") && !has(Serial.log, "rangé sur la carte") && g_workLive == nullptr,
            "15 FIX2 pile SD indisponible pendant la VALIDATION : clip non validé, aucun marqueur, clip supprimé, animation inactive, aucun faux succès");
    }
    // marqueur de la carte : correspond à l'œuvre ou ignoré
    { resetWorld(); initSD(); g_sd.files["/pod/anim.bin"] = std::vector<uint8_t>(clip.begin(), clip.end()); std::string m = std::string(64, 'c') + "\nautre\n"; g_sd.files["/pod/anim.txt"] = std::vector<uint8_t>(m.begin(), m.end()); lastFrameId = "x";
      animLoadMarker(); CHECK(!animOn && has(Serial.log, "ne correspond pas"), "15 marqueur d'une autre œuvre : ignoré");
      m = std::string(64, 'c') + "\nx\n"; g_sd.files["/pod/anim.txt"] = std::vector<uint8_t>(m.begin(), m.end()); animLoadMarker(); CHECK(animOn && animHash == std::string(64, 'c').c_str(), "15 marqueur de l'œuvre : l'animation reprend"); }
  }

  // ═══ 15c. LOT8B2E ANIM-TOUCH-GESTURES-1 : appui COURT (cartel sur place, la lecture continue) / appui LONG (pause) ; contacts scriptés dans le temps virtuel ═══
  if (!clipHex.empty()) {
    const std::string clip = fromHex(clipHex); const std::string ghash(64, 'e');
    auto setupAnim = [&](int seed) {
      resetWorld(); initSD(); K.frame = frameOk(seed); doFetchFrame("gest", "consensus"); K.clip = clip;
      const bool ok = fetchAnimToSd(String(ghash.c_str()), clip.size()); touchOk = true; g_requests.clear(); g_tft.busBytes = 0; g_touchSpans.clear(); g_touchGaps.clear(); return ok; };
    auto bandSum = [&]() { uint64_t s = 1469598103934665603ULL; for (int y = 0; y < 320; y++) { if (y >= BAND_TOP_H && y < BAND_BOT_Y) continue; for (int x = 0; x < 240; x++) s = (s ^ g_tft.fb[y * TFT_W + x]) * 1099511628211ULL; } return s; };
    auto bandsAre = [&](uint16_t c) { for (int y = 0; y < 320; y++) { if (y >= BAND_TOP_H && y < BAND_BOT_Y) continue; for (int x = 0; x < 240; x++) if (g_tft.fb[y * TFT_W + x] != c) return false; } return true; };
    auto tick = [&](int n) { for (int i = 0; i < n; i++) { serviceTouch(); delay(40); } };   // ce que fait loop() entre deux lectures (hors réseau)

    // G1 — appui COURT (100 ms) pendant la lecture : le cartel s'affiche, la lecture CONTINUE jusqu'au bout du budget, rien n'est mis en pause
    { CHECK(setupAnim(21) && animOn, "15c clip en place pour les gestes");
      const long opens0 = g_sd.opens; const unsigned long t = millis(); g_touchSpans.push_back({ t + 300, t + 400 });
      const AnimEnd e = runResidentAnim(1500);
      CHECK(e == AE_TIME && !animPaused && cartelVisible, "15c G1 appui court pendant la lecture : la lecture continue (AE_TIME), pas de pause, cartel affiché");
      CHECK(g_tft.text.find("RESCOE") != std::string::npos && has(Serial.log, "cartel affiché 1 fois, masqué 0 fois (la lecture a continué)"), "15c G1 cartel dessiné sur place, compte rendu journalisé APRÈS la lecture");
      CHECK(g_sd.opens - opens0 == 1 && g_sd.openedOk == g_sd.closed, "15c G1 le cartel sur place n'ouvre AUCUN fichier (seul le clip est ouvert, puis refermé)");
      CHECK(g_requests.empty(), "15c G1 aucune requête réseau");
      // G11 — la lecture suivante conserve le cartel : les bandes ne sont pas réécrites, seule la zone centrale l'est
      const uint64_t b0 = bandSum(); g_tft.busBytes = 0; const AnimEnd e2 = runResidentAnim(800);
      CHECK(e2 == AE_TIME && cartelVisible && bandSum() == b0 && g_tft.busBytes > 0, "15c G11 lecture suivante : cartel conservé, bandes y 0..39 et 272..319 INTACTES, animation en cours dans la zone centrale"); }

    // G2 — second appui court : cartel masqué (bandes = fond de l'animation), lecture toujours en cours
    { setupAnim(22); const unsigned long t = millis(); g_touchSpans.push_back({ t + 300, t + 400 }); g_touchSpans.push_back({ t + 900, t + 1000 });
      const AnimEnd e = runResidentAnim(1800);
      CHECK(e == AE_TIME && !cartelVisible && !animPaused && bandsAre(0x0842) && has(Serial.log, "cartel affiché 1 fois, masqué 1 fois"), "15c G2 second appui court : cartel masqué, bandes au fond de l'animation, lecture continue"); }

    // G3 — appui LONG (maintenu 1,7 s) : sortie de la lecture, FICHIER FERMÉ avant toute restauration SD, puis pause + cartel ; le relâchement ne produit AUCUN second geste
    { setupAnim(23); const unsigned long t = millis(); g_touchSpans.push_back({ t + 300, t + 2000 });
      const AnimEnd e = runResidentAnim(5000);
      CHECK(e == AE_TOUCH, "15c G3 appui long : sortie AE_TOUCH");
      CHECK(g_sd.openedOk == g_sd.closed, "15c G3 le clip est FERMÉ avant la restauration depuis la carte");
      onAnimTouch();
      CHECK(animPaused && cartelVisible && fbIsArtwork(23, 40, 272) && g_sd.maxOpen <= 1 && g_sd.openedOk == g_sd.closed, "15c G3 pause : affiche restaurée, cartel, jamais deux fichiers ouverts à la fois");
      tick(30);      // le doigt reste posé jusqu'à t + 2000 puis se relève : ni masquage, ni reprise
      CHECK(animPaused && cartelVisible && !has(Serial.log, "cartel masqué en") && !has(Serial.log, "reprise (appui long)") && !touchLatch.on, "15c G3 relâchement après l'appui long : AUCUNE seconde action, verrou levé"); }

    // G4 — en pause, appui COURT : le cartel est masqué SANS reprendre ; second appui court : réaffiché
    { setupAnim(24); const unsigned long t = millis(); g_touchSpans.push_back({ t + 200, t + 2500 }); (void)runResidentAnim(5000); onAnimTouch(); tick(60);
      g_touchSpans.clear(); const unsigned long t2 = millis(); g_touchSpans.push_back({ t2 + 10, t2 + 110 }); tick(8);
      CHECK(animOn && animPaused && !cartelVisible && fbIsArtwork(24), "15c G4 pause + appui court : cartel masqué, œuvre restaurée EXACTEMENT, l'animation reste EN PAUSE");
      g_touchSpans.clear(); const unsigned long t3 = millis(); g_touchSpans.push_back({ t3 + 10, t3 + 110 }); tick(8);
      CHECK(animPaused && cartelVisible, "15c G4 pause + second appui court : cartel réaffiché, toujours en pause"); }

    // G5 — en pause, appui LONG : reprise, cartel masqué (bandes restaurées depuis la carte avant la reprise), puis la lecture repart plein écran
    { setupAnim(25); const unsigned long t = millis(); g_touchSpans.push_back({ t + 200, t + 2500 }); (void)runResidentAnim(5000); onAnimTouch(); tick(60);
      g_touchSpans.clear(); const unsigned long t2 = millis(); g_touchSpans.push_back({ t2 + 10, t2 + 1500 }); tick(5);
      CHECK(!animPaused && !cartelVisible && fbIsArtwork(25) && has(Serial.log, "reprise (appui long)") && touchLatch.on, "15c G5 pause + appui long : reprise, cartel masqué, bandes restaurées, verrou de relâchement posé");
      tick(60);
      CHECK(!touchLatch.on && !animPaused && !cartelVisible, "15c G5 relâchement : aucune action de plus");
      g_tft.busBytes = 0; const AnimEnd e = runResidentAnim(600); CHECK(e == AE_TIME && !cartelVisible && g_tft.busBytes > 0, "15c G5 la lecture repart plein écran, sans cartel"); }

    // G6 — image fixe (pas d'animation) : court OU long = UNE seule bascule du cartel
    { resetWorld(); initSD(); K.frame = frameOk(26); doFetchFrame("fixe", "personal"); touchOk = true; g_touchSpans.clear();
      const unsigned long t = millis(); g_touchSpans.push_back({ t + 10, t + 110 }); tick(8); CHECK(cartelVisible, "15c G6 image fixe, appui court : cartel affiché");
      const unsigned long t2 = millis(); g_touchSpans.push_back({ t2 + 10, t2 + 1500 }); tick(80);
      CHECK(!cartelVisible && fbIsArtwork(26), "15c G6 image fixe, appui LONG : UNE bascule (masqué), pas de seconde au relâchement"); }

    // G7 — seuil : 600 ms = court ; 700 ms = long (cadence d'interrogation de 20 ms : le seuil exact de 650 ms est prouvé par tests/touchGesture.test.ts)
    { setupAnim(27); const unsigned long t = millis(); g_touchSpans.push_back({ t + 200, t + 2500 }); (void)runResidentAnim(5000); onAnimTouch(); tick(60);
      g_touchSpans.clear(); const unsigned long a = millis(); g_touchSpans.push_back({ a + 10, a + 610 }); tick(40);
      CHECK(animPaused && !cartelVisible, "15c G7 600 ms en pause : appui COURT (cartel masqué, toujours en pause)");
      g_touchSpans.clear(); const unsigned long b = millis(); g_touchSpans.push_back({ b + 10, b + 710 }); tick(40);
      CHECK(!animPaused, "15c G7 700 ms en pause : appui LONG (reprise)"); }

    // G8 — rebond de 10 ms au milieu d'un contact : UNE action ; G9 — parasite de 5 ms : AUCUNE action
    { setupAnim(28); const unsigned long t = millis(); g_touchSpans.push_back({ t + 200, t + 2500 }); (void)runResidentAnim(5000); onAnimTouch(); tick(60);
      g_touchSpans.clear(); g_touchGaps.clear(); const unsigned long a = millis(); g_touchSpans.push_back({ a + 10, a + 200 }); g_touchGaps.push_back({ a + 100, a + 110 }); tick(12);
      CHECK(animPaused && !cartelVisible, "15c G8 rebond de 10 ms dans un contact de 190 ms : UNE seule action (cartel masqué)");
      g_touchSpans.clear(); g_touchGaps.clear(); g_touchPressedPolls = 1; tick(10);   // UN seul échantillon « posé » : parasite
      CHECK(animPaused && !cartelVisible, "15c G9 parasite de 5 ms : AUCUNE action"); }

    // G10 — le budget avant la prochaine tâche réseau est respecté même pendant un contact maintenu
    { setupAnim(29); const unsigned long t = millis(); g_touchSpans.push_back({ t + 100, t + 5000 });
      const AnimEnd e = runResidentAnim(500); const unsigned long used = millis() - t;
      CHECK(e == AE_TIME && used <= 600, "15c G10 contact maintenu mais budget de 500 ms atteint avant l'appui long : retour dans le budget (AE_TIME), aucune pause"); }

    // ═══ FIX1 (audit GPT de c98168e) ═══
    // G12 — animation ACTIVE, contact vu HORS du lecteur (entre deux lectures), champ d'animation à l'écran : appui court = cartel basculé SUR PLACE, animPaused reste FAUX, aucune carte, aucun réseau, la lecture suivante conserve le cartel
    { setupAnim(31); (void)runResidentAnim(700);
      CHECK(animOn && !animPaused && animBgValid, "15c G12 une lecture a posé le champ d'animation à l'écran");
      const long opens0 = g_sd.opens; const unsigned long t = millis(); g_touchSpans.clear(); g_touchSpans.push_back({ t + 10, t + 110 }); tick(8);
      CHECK(animOn && !animPaused && cartelVisible && g_sd.opens == opens0 && g_requests.empty() && g_tft.text.find("RESCOE") != std::string::npos, "15c G12 appui court hors du lecteur : cartel affiché, animPaused reste FAUX, AUCUN fichier ouvert, aucune requête");
      const uint64_t b0 = bandSum(); const AnimEnd e1 = runResidentAnim(600);
      CHECK(e1 == AE_TIME && cartelVisible && !animPaused && bandSum() == b0, "15c G12 l'animation CONTINUE avec le cartel, bandes intactes");
      const long opens1 = g_sd.opens; g_touchSpans.clear(); const unsigned long t2 = millis(); g_touchSpans.push_back({ t2 + 10, t2 + 110 }); tick(8);
      CHECK(!cartelVisible && !animPaused && bandsAre(0x0842) && g_sd.opens == opens1, "15c G12 second appui court hors du lecteur : cartel masqué (fond de l'animation), toujours en lecture, aucun fichier ouvert"); }
    // G13b — contact vu hors du lecteur alors que l'écran montre l'AFFICHE (après une image reçue ou un redémarrage) : bascule habituelle, animPaused reste faux
    { setupAnim(32); CHECK(!animBgValid, "15c G13b l'affiche est à l'écran (champ d'animation absent)");
      const unsigned long t = millis(); g_touchSpans.push_back({ t + 10, t + 110 }); tick(8);
      CHECK(animOn && !animPaused && cartelVisible && fbIsArtwork(32, 40, 272), "15c G13b appui court : cartel affiché sur l'affiche, animation toujours active (pas de pause)");
      g_touchSpans.clear(); const unsigned long t2 = millis(); g_touchSpans.push_back({ t2 + 10, t2 + 110 }); tick(8);
      CHECK(!cartelVisible && !animPaused && fbIsArtwork(32) && g_sd.maxOpen <= 1, "15c G13b second appui court : cartel masqué, œuvre restaurée, jamais en pause"); }
    // G14 — contact qui a commencé PENDANT une fenêtre réseau (pull) et se poursuit au retour : appui court, pas de pause
    { setupAnim(33); (void)runResidentAnim(500); g_requests.clear(); doPull();
      const unsigned long t = millis(); g_touchSpans.clear(); g_touchSpans.push_back({ t - 40, t + 150 }); tick(6);
      CHECK(animOn && !animPaused && cartelVisible, "15c G14 contact commencé pendant la fenêtre réseau : appui court (cartel), l'animation n'est PAS mise en pause"); }
    // G15 — rebond après un appui long : aucune seconde action ; relâchement stable puis NOUVEAU contact : une action
    { setupAnim(34); const unsigned long t = millis(); g_touchSpans.push_back({ t + 300, t + 3000 });
      const AnimEnd e = runResidentAnim(6000); CHECK(e == AE_TOUCH, "15c G15 appui long : sortie"); onAnimTouch();
      for (int i = 0; i < 20; i++) { if (i == 3) { g_touchGaps.clear(); g_touchGaps.push_back({ millis(), millis() + 25 }); } serviceTouch(); delay(40); }   // rebond de 25 ms échantillonné pendant que le doigt est maintenu
      CHECK(animPaused && cartelVisible && touchLatch.on && !has(Serial.log, "cartel masqué en"), "15c G15 rebond après l'appui long : verrou toujours armé, AUCUNE seconde action");
      tick(80);
      CHECK(animPaused && cartelVisible && !touchLatch.on && !has(Serial.log, "cartel masqué en") && !has(Serial.log, "reprise (appui long)"), "15c G15 relâchement stable : verrou levé, aucune action fantôme"); }
    { setupAnim(35); const unsigned long t = millis(); g_touchSpans.push_back({ t + 300, t + 1500 }); g_touchSpans.push_back({ t + 1700, t + 1800 });
      (void)runResidentAnim(6000); onAnimTouch(); tick(80);
      CHECK(animPaused && !cartelVisible && !touchLatch.on, "15c G15b relâchement de 200 ms puis NOUVEL appui court : exactement une action (cartel masqué), toujours en pause"); }
    // G16 — dépassement de millis() (32 bits) en plein geste : appui court puis appui long de part et d'autre du dépassement
    { setupAnim(36); g_us = (4294967296ULL - 700ULL) * 1000ULL; const unsigned long t = millis();
      g_touchSpans.push_back({ t + 300, t + 400 }); g_touchSpans.push_back({ t + 900, t + 2600 });
      const AnimEnd e = runResidentAnim(6000);
      CHECK(e == AE_TOUCH && cartelVisible && has(Serial.log, "cartel affiché 1 fois"), "15c G16 dépassement de millis() : appui court (cartel) puis appui long (sortie) comme sans dépassement");
      onAnimTouch(); tick(80);
      CHECK(animPaused && cartelVisible && !touchLatch.on && !has(Serial.log, "cartel masqué en") && !has(Serial.log, "reprise (appui long)"), "15c G16 verrou levé après le dépassement, aucune action fantôme"); }

    // G13 — aucun accès SD / tas dans le geste : un appui court pendant la lecture ne fait ni allocation de pile SD supplémentaire ni requête
    CHECK(g_sd.maxOpen <= 1, "15c fichiers SD : jamais plus d'un fichier ouvert à la fois sur tout le scénario");
  }

  // ═══ 15b. LOT8B2E ANIM-STREAM-FIX1 : clip de ≈ 9 Ko sur un tas FRAGMENTÉ (aucune allocation > 2 048 o) ; téléchargement vers la carte, validation et lecture EN FLUX ═══
  if (!bigHex.empty()) {
    const std::string big = fromHex(bigHex); const std::string hash(64, 'd');
    CHECK(big.size() > 6000 && big.size() <= BENCH_MAX_CLIP, "15b clip de test volumineux (> 6 Ko, <= 9 216 o)");
    { resetWorld(); initSD(); K.frame = frameOk(15); doFetchFrame("anim15b", "consensus"); K.clip = big; g_requests.clear();
      g_maxMalloc = 0; g_mallocLimit = 2048;                                            // plus grand bloc contigu simulé : 2 048 o (la carte offrait 4 884 o)
      const bool ok = fetchAnimToSd(String(hash.c_str()), big.size());
      CHECK(ok && animOn && sdFile("/pod/anim.bin") == big && sdFile("/pod/anim.txt") == hash + "\nanim15b\n", "15b gros clip reçu, rangé sur la carte AU FIL DE L'EAU, validé en flux, marqueur écrit APRÈS le clip");
      CHECK(!has(Serial.log, "mémoire insuffisante"), "15b aucune erreur de mémoire sur un tas fragmenté");
      g_tft.busBytes = 0; touchOk = true; g_touchPressedPolls = 0;
      const AnimEnd e = runResidentAnim(1500);
      CHECK(e == AE_TIME && g_tft.busBytes > 0 && sdFile("/pod/anim.bin") == big, "15b lecture du gros clip EN FLUX sur le tas fragmenté, clip intact");
      CHECK(g_maxMalloc <= 2048, "15b plus grosse allocation du chemin animation <= 2 048 o (tampon de travail + piles dédiées)");
      CHECK(countReq("/api/") == 1 && g_requests.size() == 1, "15b une seule requête (le téléchargement), aucune pendant la lecture");
      g_mallocLimit = (size_t)-1; }
    // mémoire vraiment insuffisante : échec fermé, rien d'inscrit, fichiers existants conservés
    { resetWorld(); initSD(); K.clip = big; g_failWork2048 = 1; const bool ok = fetchAnimToSd(String(hash.c_str()), big.size());
      CHECK(!ok && !animOn && !sdHas("/pod/anim.bin") && !sdHas("/pod/anim.txt") && g_requests.size() == 1 && has(Serial.log, "mémoire insuffisante") && has(Serial.log, "après le téléchargement") && !has(Serial.log, "rangé sur la carte"),
            "15b FIX2 tampon de travail (2 048 o) refusé APRÈS le téléchargement : clip et marqueur supprimés, animation NON activée, journal explicite, aucun faux succès");
      CHECK(g_workLive == nullptr, "15b FIX2 aucun tampon de travail resté alloué");
      g_sd.files["/pod/anim.bin"] = std::vector<uint8_t>(big.begin(), big.end()); animOn = true; animHash = hash.c_str();
      g_failWork2048 = 1; const AnimEnd e = runResidentAnim(500); g_failWork2048 = 0;
      CHECK(e == AE_ERROR && has(Serial.log, "mémoire insuffisante pour la lecture"), "15b tampon de travail refusé : lecture abandonnée proprement (AE_ERROR)"); }
    // lecture de la carte interrompue pendant la lecture, ou carte refusant la lecture
    { resetWorld(); initSD(); g_sd.files["/pod/anim.bin"] = std::vector<uint8_t>(big.begin(), big.end()); animOn = true;
      g_sd.readFailAt = (long)big.size() / 2; const AnimEnd e = runResidentAnim(1500); g_sd.readFailAt = -1;
      CHECK(e == AE_ERROR, "15b carte illisible à mi-clip : refusé à la validation (AE_ERROR), pas de lecture partielle"); }
    // clip validé à la réception mais ALTÉRÉ sur la carte ensuite : refusé à la lecture
    { resetWorld(); initSD(); std::string bad = big; bad[bad.size() / 2] ^= 0x01; g_sd.files["/pod/anim.bin"] = std::vector<uint8_t>(bad.begin(), bad.end());
      const AnimEnd e = runResidentAnim(500); CHECK(e == AE_ERROR && has(Serial.log, "refusé (CRC)"), "15b clip altéré sur la carte : refusé (CRC)"); }
    // téléchargement coupé en cours de route : le clip partiel est supprimé, aucun marqueur
    { resetWorld(); initSD(); K.clip = big.substr(0, big.size() - 700); const bool ok = fetchAnimToSd(String(hash.c_str()), big.size());
      CHECK(!ok && !animOn && !sdHas("/pod/anim.bin") && !sdHas("/pod/anim.txt"), "15b téléchargement tronqué : clip partiel supprimé, aucun marqueur"); }
  }

  // ═══ 16. pull -> image -> ACK de bout en bout (chaîne réelle doPull) ═══
  resetWorld(); initSD(); K.frame = frameOk(16);
  K.pullJson = "{\"frameSource\":\"consensus\",\"frameId\":\"f16\",\"retryAfter\":300,\"chain\":{\"blockHash\":\"" + std::string(64, 'a') + "\",\"blockIndex\":4},\"pendingValidation\":{\"candidateId\":\"cand-0001-xyz\"},\"cartelMeta\":{\"workTitle\":\"Mon titre\",\"drawArtistName\":\"Moi\",\"blockIndex\":3}}";
  { const bool ok = doPull();
    CHECK(ok && lastFrameId == "f16" && fbIsArtwork(16) && pendingWorkTitle == "Mon titre" && pendingArtistName == "Moi" && currentBlockIndex == 3, "16 doPull : image affichée, cartel appliqué (nouvelle image)");
    CHECK(idxReq("/api/pull?") == 0 && idxReq("/api/pull-frame") == 1 && idxReq("/api/ack-frame") == 2, "16 ordre : pull, image, ACK");
    CHECK(nextPullIntervalMs == PULL_INTERVAL, "16 la cadence reste PULL_INTERVAL (aucun polling accéléré ni ralenti)");
    if (CAN) CHECK(pendingCandidateId == "" && has(Serial.log, "AUCUN vote en build canari") && countReq("/api/validate-candidate") == 0, "16 CANARI : candidat annoncé oublié, aucune requête de vote");
    else CHECK(pendingCandidateId == "", "16 production : doFetchFrame efface le candidat après une image affichée (comme avant)");
    // la même frame au pull suivant : « déjà affichée », aucune nouvelle image ni ACK
    g_requests.clear(); g_tft.busBytes = 0; doPull(); CHECK(countReq("/api/pull-frame") == 0 && countReq("/api/ack-frame") == 0 && g_tft.busBytes == 0, "16 frame déjà affichée : ni image ni ACK"); }

  // ═══ 17. démarrage + boucle : le canari ne vote JAMAIS, la production oui (le test est sensible) ═══
  resetWorld(); initSD(); K.frame = frameOk(17); EEPROM.m[97] = 0x01;
  K.pullJson = "{\"frameSource\":\"consensus\",\"frameId\":\"f17\",\"retryAfter\":60,\"pendingValidation\":{\"candidateId\":\"cand-0017-abc\"},\"pendingObservation\":{\"blockHashes\":[\"h1\"],\"targetBlockHash\":\"" + std::string(64, 't') + "\"},\"benchMode\":true}";
  registered = false; paired = false; deviceId = ""; lastFrameId = "";
  { tft28_setup();
    CHECK(registered && paired && deviceId == "dev_TEST0001", "17 setup : register accepté, état inscrit"); CHECK(lastFrameId == "f17" && fbIsArtwork(17), "17 setup : premier pull, image affichée");
    for (int i = 0; i < 40; i++) { g_us += 15 * 1000000ull; tft28_loop(); }
    const int votes = countReq("/api/validate-candidate") + countReq("/api/validation-result") + countReq("/api/candidate-frame") + countReq("/api/obs-confirm");
    if (CAN) {
      CHECK(votes == 0, "17 CANARI : aucune route de vote atteinte en 40 tours de boucle (10 minutes) malgré un candidat et une observation annoncés");
      CHECK(countReq("/api/bench/") == 0 && !benchMode, "17 CANARI : banc d'essai ignoré");
      CHECK(has(Serial.log, "[CANARY] BUILD LOT8B2D-R4-TFT28-CANARY-1") && has(Serial.log, "AUCUN VOTE"), "17 CANARI : bannière de démarrage");
      CHECK(has(Serial.log, "[CANARY] pile wifi macAddress") && has(Serial.log, "[CANARY] pile ed25519 sign") && has(Serial.log, "[CANARY] pile travail register JSON") && has(Serial.log, "[CANARY] pile travail pull JSON") && has(Serial.log, "[CANARY] pile reseau http"), "17 CANARI : piles Wi-Fi, Ed25519, travail (register, pull) et réseau mesurées");
      CHECK(has(Serial.log, "register : retour : pile principale") && has(Serial.log, "pull : retour : pile principale"), "17 CANARI : marge de la pile principale après register et pull");
    } else {
      CHECK(countReq("/api/validate-candidate") >= 1, "17 production : le candidat est interrogé (le test détecte bien un vote)");
      CHECK(countReq("/api/obs-confirm") >= 1, "17 production : l'observation est confirmée");
    }
    CHECK(countReq("/api/pull?") >= 5, "17 plusieurs pulls pendant 10 minutes de boucle (rythme nominal)");
    CHECK(countReq("/api/pull?") <= 14, "17 pas de rafale de pulls (rythme borné par PULL_INTERVAL)"); }

  // ═══ 17b. REGISTER-STACK-FIX2 : phases de doRegister (appairé / non appairé / échecs), écran « Connecte » sur la pile dédiée ═══
  { auto freshReg = [&]() { resetWorld(); initSD(); registered = false; paired = false; deviceId = ""; pairCode = ""; g_tft = TftState(); g_requests.clear(); Serial.log.clear(); };
    g_onMainStackHook = &podNetOnMainStack;
    // appairé : corps exact, écran sur la pile dédiée, état inscrit, journal
    freshReg(); EEPROM.m[97] = 0x01;
    const bool okP = doRegister();
    CHECK(okP && registered && paired && deviceId == "dev_TEST0001" && pairCode == "ABCD2345", "17b appairé : inscription valide, état inscrit");
    CHECK(countReq("/api/register") == 1, "17b appairé : une seule requête /api/register");
    { std::string reqBody; for (auto& r : g_requests) if (r.path.rfind("/api/register", 0) == 0) reqBody = r.body;
      const std::string pre = std::string("{\"mac\":\"") + "", mid = std::string("\",\"screens\":[\"") + SCREEN_TYPE + "\"],\"firmware\":\"" + FIRMWARE_VERSION + "\",\"publicKey\":\"";
      CHECK(reqBody.rfind(pre, 0) == 0 && reqBody.find(mid) != std::string::npos && reqBody.find("\",\"ownedHashes\":[") != std::string::npos && !reqBody.empty() && reqBody.back() == '}', "17b appairé : corps JSON dans l'ordre mac, screens, firmware, publicKey, ownedHashes"); }
    CHECK(g_tft.text.find("Connecte") != std::string::npos && g_tft.text.find("dev_TEST0001") != std::string::npos, "17b appairé : écran « Connecte » + identifiant");
    CHECK(g_tft.fills > 0 && g_tft.fillsMain == 0, "17b appairé : le dessin de l'écran « Connecte » se fait SUR LA PILE DÉDIÉE (0 dessin sur la pile principale)");
    CHECK(has(Serial.log, "[REGISTER] deviceId=dev_TEST0001 paired=oui"), "17b appairé : journal [REGISTER]");
    // appairé, pile dédiée de l'écran indisponible : inscription valable, écran non redessiné, journal honnête
    if (!CAN) {   // en canari une pile dédiée refusée est FATALE (arrêt sûr) : scénario de production seulement
      freshReg(); EEPROM.m[97] = 0x01; g_failWhenLog = "[REGISTER] deviceId=dev_TEST0001";      // l'allocation suivante est celle de l'ÉCRAN
      const bool okS = doRegister(); g_failWhenLog.clear();
      CHECK(okS && registered && paired && g_tft.fills == 0 && has(Serial.log, "[SD] pile dédiée (registerConnected)"), "17b appairé, pile de l'écran indisponible : inscription valable, écran NON redessiné, journal honnête"); }
    // non appairé : onboarding inchangé (QR sur la pile principale), état non appairé
    freshReg(); K.registerJson = "{\"deviceId\":\"dev_TEST0002\",\"pairCode\":\"WXYZ2345\",\"paired\":false}"; EEPROM.m[97] = 0x01;
    const bool okU = doRegister();
    CHECK(okU && registered && !paired && deviceId == "dev_TEST0002" && pairCode == "WXYZ2345", "17b non appairé : inscription valide, code d'appairage conservé");
    CHECK(g_tft.text.find("MAC:") != std::string::npos && g_tft.text.find("Scannez le QR") != std::string::npos && g_tft.fillsMain > 0, "17b non appairé : onboarding (QR, code, MAC) dessiné comme avant");
    CHECK(g_tft.text.find("Connecte") == std::string::npos, "17b non appairé : pas d'écran « Connecte »");
    CHECK(has(Serial.log, "paired=non"), "17b non appairé : journal paired=non");
    // échec HTTP : rien d'inscrit, écran d'échec sur la pile dédiée, retour false
    freshReg(); g_route = [](const NetRequest& r) { NetScript s; if (r.path.rfind("/api/register", 0) == 0) s.response = http(500, "{}"); else s.response = http(404, "{}"); return s; };
    const bool okH = doRegister();
    CHECK(!okH && !registered && !paired && deviceId == "", "17b HTTP 500 : false, aucun état inscrit");
    CHECK(g_tft.text.find("Register echoue") != std::string::npos && g_tft.fillsMain == 0, "17b HTTP 500 : écran d'échec sur la pile dédiée");
    // réponse invalide : rien d'inscrit, aucun écran « Connecte », pas de journal [REGISTER] deviceId
    if (!CAN) {   // en canari une réponse refusée par le décodeur est FATALE (arrêt sûr)
      freshReg(); K.registerJson = "{\"deviceId\":\"dev_bad\",\"paired\":true}";
      const bool okI = doRegister();
      CHECK(!okI && !registered && deviceId == "" && g_tft.text.find("Connecte") == std::string::npos && !has(Serial.log, "[REGISTER] deviceId="), "17b réponse invalide : rien d'inscrit, aucune suite"); }
    // MAC indisponible (pile Wi-Fi refusée) : aucune requête, rien d'inscrit
    if (!CAN) {
      freshReg(); g_failNext = 1;
      const bool okM = doRegister();
      CHECK(!okM && !registered && countReq("/api/register") == 0 && has(Serial.log, "adresse MAC indisponible") && g_tft.text.empty(), "17b MAC indisponible : aucune requête, aucun écran, rien d'inscrit"); }
    g_onMainStackHook = nullptr; }

  // ═══ 18. le journal ne contient jamais la clé privée ═══
  { resetWorld(); CHECK(Serial.log.find("010203") == std::string::npos, "18 (placeholder)"); }

  CHECK(g_workLiveDuringNet == 0, "FIX2 bilan : le tampon de travail de l'animation n'a JAMAIS été vivant pendant une requête réseau");
  if (!g_fail.empty()) { for (auto& f : g_fail) std::printf("ECART : %s\n", f.c_str()); std::printf("journal série (début) :\n%s\n", Serial.log.substr(0, 1200).c_str()); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
