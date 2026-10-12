// host/tft28_pull_work_harness.cpp — LOT8B2D : exécute, sur l'hôte, le CODE RÉEL du décodage de la réponse /api/pull du firmware UNO R4 + TFT 2,8″ (pullSetId, pullSetText, pullParseWork, pullParseOnWorkStack, pullWorkFailed,
// doPullApply, doPullStage), extrait mot pour mot de arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino par tests/tft28Host.test.ts (fichier « pull_extract.inc »), contre ArduinoJson RÉEL, la classe String simulée
// (consensus-pod/host/shim/Arduino.h) et la logique réelle de podNetStack.h (POD_NET_HOST_TEST : garde écrasée, malloc impossible, imbrication).
//   tft28_pull_work_harness  →  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// HARNESS_CANARY=1 : les crochets du CANARI (candidat oublié, banc d'essai ignoré) tels que définis par le sketch ; sinon ceux de la PRODUCTION.
// Prouve : réponses minimale / complète / 429 / tronquée / trop imbriquée / hors bornes ; cartel appliqué SEULEMENT pour une nouvelle image ; TOUT OU RIEN (aucun état, EEPROM, banc d'essai ni animation avant un retour valide) ;
// échecs de la pile de travail (NOMEM, NESTED, GUARD, MARGIN) ; panne d'allocation à chaque point ; candidat oublié et banc d'essai ignoré en canari. Ne prouve PAS la profondeur réelle sur la carte.
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
#define BENCH_POLL_MS 3000UL

static std::string g_log;
struct Halt { int code; };
static void logf(const char* fmt, ...) { char b[512]; va_list ap; va_start(ap, fmt); std::vsnprintf(b, sizeof(b), fmt, ap); va_end(ap); g_log += b; g_log += "\n"; }
[[noreturn]] static void logfSafeStop() { throw Halt{ 1 }; }
static unsigned long millis() { return 100000UL; }
static String asciiFold(const String& s) { return s; }
#include "hooks.inc"                      // POD_CANARY_JSON / POD_CANARY_NO_BENCH / POD_CANARY_CANDIDATE : définitions de PRODUCTION ou de CANARI, extraites du sketch

// état global simulé du firmware (valeurs initiales reconnaissables)
String pendingWorkTitle, pendingArtistName, pendingObsHashes, pendingObsTarget, currentBlockHash, pendingCandidateId, pendingAnimHash, lastFrameId;
size_t pendingAnimBytes = 0;
int currentBlockIndex = 3;
bool benchMode = false;
unsigned long lastPullMs = 7, nextPullIntervalMs = 5, benchModeSince = 0, lastBenchPollMs = 0;
static int g_nSaveOwned = 0, g_nSaveBlock = 0, g_seq = 0, g_seqOwned = 0, g_seqBlock = 0;
static String g_savedOwned, g_savedBlock;
static void saveOwnedBlockHash(const String& h) { g_nSaveOwned++; g_savedOwned = h; g_seqOwned = ++g_seq; }
static void saveBlockHashToEEPROM(const String& h) { g_nSaveBlock++; g_savedBlock = h; g_seqBlock = ++g_seq; }

#include "pull_extract.inc"

static int g_checks = 0;
static std::vector<std::string> g_fail;
#define CHECK(cond, msg) do { g_checks++; if (!(cond)) g_fail.push_back(std::string(msg) + " [" #cond "]"); } while (0)

static void resetState() {
  pendingWorkTitle = "T0"; pendingArtistName = "A0"; pendingObsHashes = "O0"; pendingObsTarget = "OT0"; currentBlockHash = "oldhash"; pendingCandidateId = "C0"; pendingAnimHash = "AH0"; lastFrameId = "old-frame";
  pendingAnimBytes = 77; currentBlockIndex = 3; benchMode = false; lastPullMs = 7; nextPullIntervalMs = 5; benchModeSince = 11; lastBenchPollMs = 13;
  g_nSaveOwned = g_nSaveBlock = g_seq = g_seqOwned = g_seqBlock = 0; g_savedOwned = ""; g_savedBlock = ""; g_log.clear();
  g_strFailArmed = false; g_strFailAt = 0; g_strAllocN = 0;
  podNetTestHook = nullptr; podNetTestFailAlloc = 0; podNetTestNested = 0;
}
static bool untouched() {
  return pendingWorkTitle == "T0" && pendingArtistName == "A0" && pendingObsHashes == "O0" && pendingObsTarget == "OT0" && currentBlockHash == "oldhash" && pendingCandidateId == "C0" && pendingAnimHash == "AH0" && pendingAnimBytes == 77
      && currentBlockIndex == 3 && !benchMode && lastPullMs == 7 && nextPullIntervalMs == 5 && benchModeSince == 11 && lastBenchPollMs == 13 && g_nSaveOwned == 0 && g_nSaveBlock == 0 && lastFrameId == "old-frame";
}
struct Out { int rc; String frameId, frameSource; };
static Out run(const std::string& body, int code) { String resp(body.c_str()); Out o; o.rc = doPullStage(resp, code, o.frameId, o.frameSource); return o; }
static std::string hex64(char c) { return std::string(64, c); }

static const char* B_BODY_FMT = "{\"frameId\":\"fr-1234\",\"frameSource\":\"consensus\",\"retryAfter\":300,\"benchMode\":true,\"chain\":{\"blockHash\":\"%s\",\"blockIndex\":96},\"pendingValidation\":{\"candidateId\":\"cand-1\"},"
  "\"cartelMeta\":{\"workTitle\":\"Chat - pain\",\"drawArtistName\":\"Roubzi\",\"blockIndex\":95},\"anim\":{\"hash\":\"%s\",\"bytes\":4321},"
  "\"pendingObservation\":{\"blockHashes\":[\"h1\",\"h2\",\"h3\"],\"targetBlockHash\":\"%s\"},\"ownedBlock\":\"%s\"}";
static std::string bodyB() { char b[1400]; std::snprintf(b, sizeof(b), B_BODY_FMT, hex64('a').c_str(), hex64('d').c_str(), hex64('b').c_str(), hex64('c').c_str()); return b; }
static void expectB(const Out& o, const std::string& t) {
  CHECK(o.rc == 1, t + " : rc");
  CHECK(o.frameId == "fr-1234" && o.frameSource == "consensus", t + " : frame");
  CHECK(pendingWorkTitle == "Chat - pain" && pendingArtistName == "Roubzi" && currentBlockIndex == 95, t + " : cartel appliqué (nouvelle image) et indice du bloc du cartel");
  CHECK(pendingAnimHash == hex64('d').c_str() && pendingAnimBytes == 4321, t + " : pointeur d'animation");
  CHECK(pendingObsHashes == "[\"h1\",\"h2\",\"h3\"]" && pendingObsTarget == hex64('b').c_str(), t + " : observation");
  CHECK(g_nSaveOwned == 1 && g_savedOwned == hex64('c').c_str(), t + " : ownedBlock enregistré");
  CHECK(g_nSaveBlock == 1 && g_savedBlock == hex64('a').c_str() && currentBlockHash == hex64('a').c_str(), t + " : bloc enregistré");
  CHECK(nextPullIntervalMs == PULL_INTERVAL, t + " : prochain pull (frame présente)");
  CHECK(g_seqOwned < g_seqBlock && g_seqOwned > 0, t + " : ordre ownedBlock puis bloc (comme avant)");
#ifdef HARNESS_CANARY
  CHECK(pendingCandidateId == "C0" && g_log.find("AUCUN vote en build canari") != std::string::npos, t + " : CANARI : candidat OUBLIÉ localement, une ligne de journal");
  CHECK(!benchMode && benchModeSince == 11 && lastBenchPollMs == 13 && g_log.find("banc d'essai annonce par le serveur : IGNORE") != std::string::npos, t + " : CANARI : banc d'essai ignoré");
#else
  CHECK(pendingCandidateId == "cand-1", t + " : candidat retenu (production)");
  CHECK(benchMode && benchModeSince == 100000UL && lastBenchPollMs == 0, t + " : mode banc d'essai activé (production)");
#endif
}

int main() {
  // ── A. réponse minimale
  resetState();
  { Out o = run("{}", 200);
    CHECK(o.rc == 1 && o.frameId.length() == 0 && o.frameSource == "none", "A : minimale, aucune frame");
    CHECK(nextPullIntervalMs == 60000UL, "A : retryAfter par défaut 60 s");
    CHECK(pendingWorkTitle == "T0" && g_nSaveOwned == 0 && g_nSaveBlock == 0 && currentBlockHash == "oldhash" && pendingAnimHash == "", "A : seul le pointeur d'animation est remis à zéro (comme avant)"); }
  resetState();
  { Out o = run("{\"retryAfter\":300}", 200); CHECK(o.rc == 1 && nextPullIntervalMs == 300000UL, "A : retryAfter 300 s, ni frame ni candidat"); }
  resetState();
  { Out o = run("{\"retryAfter\":-5}", 200); CHECK(o.rc == 1 && nextPullIntervalMs == 60000UL, "A : retryAfter <= 0 ramené à 60 s"); }
  // ── B. réponse complète
  resetState();
  { Out o = run(bodyB(), 200); expectB(o, "B"); CHECK(g_log.find("[PULL] cartel: Chat - pain / Roubzi (bloc 95)") != std::string::npos, "B : journal du cartel"); CHECK(g_log.find("nouveau bloc #96") != std::string::npos, "B : journal du bloc"); }
  // le cartel appartient à l'IMAGE : pas de nouvelle image (même frameId, ou aucune frame) => cartel non appliqué, comme avant
  resetState(); lastFrameId = "fr-1234";
  { Out o = run(bodyB(), 200); CHECK(o.rc == 1 && pendingWorkTitle == "T0" && pendingArtistName == "A0" && currentBlockIndex == 3, "B : frame DÉJÀ affichée => cartel non appliqué"); CHECK(g_log.find("cartel:") == std::string::npos, "B : pas de ligne de cartel"); }
  resetState();
  { Out o = run("{\"frameSource\":\"none\",\"cartelMeta\":{\"workTitle\":\"Autre\",\"blockIndex\":9}}", 200); CHECK(o.rc == 1 && pendingWorkTitle == "T0" && currentBlockIndex == 3, "B : aucune frame => cartel non appliqué"); }
  resetState();
  { Out o = run("{\"frameSource\":\"personal\",\"frame\":{\"frameId\":\"in-frame\"},\"cartelMeta\":{\"workTitle\":\"Perso\",\"blockIndex\":-1}}", 200);
    CHECK(o.rc == 1 && o.frameId == "in-frame" && o.frameSource == "personal", "B : frameId lu dans frame{}"); CHECK(pendingWorkTitle == "Perso" && currentBlockIndex == 3, "B : blockIndex < 0 => l'indice courant est conservé (comme avant)"); }
  // ── C. 429
  resetState();
  { Out o = run("{\"retryAfter\":17}", 429); CHECK(o.rc == 2, "C : 429 => 2"); CHECK(lastPullMs == 100000UL - (60000UL - 17000UL), "C : lastPullMs avancé de retryAfter"); CHECK(g_nSaveOwned == 0 && g_nSaveBlock == 0 && pendingWorkTitle == "T0" && nextPullIntervalMs == 5, "C : rien d'autre ne change"); }
  resetState();
  { Out o = run("<html>pas du json</html>", 429); CHECK(o.rc == 2 && g_log.find("retryAfter=60s") != std::string::npos, "C : 429 illisible => 60 s (comme avant)"); }
  resetState();
  { Out o = run("{\"retryAfter\":900}", 429); CHECK(o.rc == 2 && lastPullMs == 100000UL, "C : retryAfter 900 plafonné à PULL_INTERVAL"); }
  // ── D. JSON tronqué / trop imbriqué : échec fermé sans AUCUN effet
  resetState();
  { Out o = run("{\"chain\":{\"blockHash\":\"abc", 200); CHECK(o.rc == 0 && untouched(), "D : tronqué => rejeté sans effet"); CHECK(g_log.find("[PULL] JSON: IncompleteInput") != std::string::npos, "D : cause journalisée"); }
  for (int n = 1; n <= 10; n++) {
    resetState();
    std::string d; for (int i = 0; i < n; i++) d += "{\"a\":"; d += "1"; for (int i = 0; i < n; i++) d += "}";
    Out o = run(d, 200);
    if (n <= (int)POD_WORK_JSON_NESTING) CHECK(o.rc == 1, "imbrication " + std::to_string(n) + " <= limite : acceptée");
    else { CHECK(o.rc == 0 && untouched(), "imbrication " + std::to_string(n) + " > limite : refusée sans effet"); CHECK(g_log.find("TooDeep") != std::string::npos, "imbrication " + std::to_string(n) + " : TooDeep"); }
  }
  // ── E. bornes (contrat écrit) : rejeté, JAMAIS appliqué partiellement
  resetState();
  { char b[1024]; std::snprintf(b, sizeof(b), "{\"cartelMeta\":{\"workTitle\":\"Titre\"},\"anim\":{\"hash\":\"%s\",\"bytes\":10},\"ownedBlock\":\"%s\"}", hex64('a').c_str(), std::string(65, 'd').c_str());
    Out o = run(b, 200); CHECK(o.rc == 0 && untouched(), "E : ownedBlock de 65 car. => rejeté, cartel, animation non appliqués"); CHECK(g_log.find("champ hors bornes") != std::string::npos, "E : cause journalisée"); }
  resetState();
  { Out o = run("{\"anim\":{\"hash\":\"" + std::string(65, 'a') + "\",\"bytes\":10}}", 200); CHECK(o.rc == 0 && untouched(), "E : hash d'animation de 65 car. => rejeté"); }
  resetState();
  { Out o = run("{\"anim\":{\"hash\":\"" + hex64('a') + "\",\"bytes\":-3}}", 200); CHECK(o.rc == 1 && pendingAnimBytes == 0 && pendingAnimHash == hex64('a').c_str(), "E : taille d'animation négative ramenée à 0 (le firmware la refusera à la lecture)"); }
  resetState();
  { Out o = run("{\"chain\":{\"blockHash\":\"" + std::string(65, 'a') + "\"}}", 200); CHECK(o.rc == 0 && untouched(), "E : blockHash de 65 car. => rejeté"); }
  resetState();
  { Out o = run("{\"frameSource\":\"" + std::string(17, 'x') + "\"}", 200); CHECK(o.rc == 0 && untouched(), "E : frameSource de 17 car. => rejeté"); }
  resetState();
  { Out o = run("{\"frameId\":\"" + std::string(65, 'f') + "\"}", 200); CHECK(o.rc == 0 && untouched(), "E : frameId de 65 car. => rejeté"); }
  resetState();
  { std::string a = "["; for (int i = 0; i < 8; i++) { if (i) a += ","; a += "\"" + hex64((char)('a' + i)) + "\""; } a += "]";
    Out o = run("{\"pendingObservation\":{\"blockHashes\":" + a + ",\"targetBlockHash\":\"" + hex64('t') + "\"}}", 200); CHECK(o.rc == 1 && pendingObsHashes.length() == 8 * 66 + 7 + 2, "E : 8 empreintes acceptées"); }
  resetState();
  { std::string a = "["; for (int i = 0; i < 9; i++) { if (i) a += ","; a += "\"" + hex64((char)('a' + i)) + "\""; } a += "]";
    Out o = run("{\"cartelMeta\":{\"workTitle\":\"Titre\"},\"pendingObservation\":{\"blockHashes\":" + a + "}}", 200); CHECK(o.rc == 0 && untouched(), "E : 9 empreintes => rejeté"); }
  resetState();
  { std::string t, ar; for (int i = 0; i < 200; i++) t += "\xC3\xA9"; for (int i = 0; i < 100; i++) ar += "\xC3\xA9";
    Out o = run("{\"frameId\":\"f9\",\"frameSource\":\"personal\",\"cartelMeta\":{\"workTitle\":\"" + t + "\",\"drawArtistName\":\"" + ar + "\",\"blockIndex\":1}}", 200);
    CHECK(o.rc == 1 && pendingWorkTitle.length() == 254 && pendingArtistName.length() == 126, "E : troncature UTF-8 documentée (254 / 126 o)"); }
  // ── F. échecs de la pile de travail : aucun effet, journal honnête ; GUARD = arrêt sûr AVANT tout journal
  resetState(); podNetTestFailAlloc = 1;
  { Out o = run(bodyB(), 200); CHECK(o.rc == 0 && untouched(), "F : NOMEM => rien d'appliqué"); CHECK(g_log.find("NON exécutée") != std::string::npos, "F : NOMEM dit « NON exécutée »"); }
  resetState(); podNetTestNested = 1;
  { Out o = run(bodyB(), 200); CHECK(o.rc == 0 && untouched(), "F : NESTED => rien d'appliqué"); }
  resetState(); podNetTestHook = [](uint8_t*, size_t, uint8_t* guard) { guard[0] = 0; };
  { bool halted = false; try { run(bodyB(), 200); } catch (const Halt&) { halted = true; }
    CHECK(halted, "F : GUARD => arrêt sûr"); CHECK(g_log.empty(), "F : GUARD => AUCUN journal avant l'arrêt"); CHECK(untouched(), "F : GUARD => rien d'appliqué"); }
  resetState(); podNetTestHook = [](uint8_t* low, size_t, uint8_t*) { low[0] = 0; };
  { Out o = run(bodyB(), 200); CHECK(o.rc == 0 && untouched(), "F : MARGIN => rien n'est appliqué"); CHECK(g_log.find("EXÉCUTÉE") != std::string::npos, "F : MARGIN dit « EXÉCUTÉE mais rejetée »"); }
  // ── G. panne d'allocation à CHAQUE point du décodage : résultat complet et exact, ou aucun effet
  int completes = 0, rejected = 0;
  for (int n = 1; n <= 80; n++) {
    resetState(); g_strFailArmed = true; g_strFailAt = n; g_strAllocN = 0;
    podNetTestHook = [](uint8_t*, size_t, uint8_t*) { g_strFailArmed = false; };
    Out o = run(bodyB(), 200);
    if (o.rc == 1) { completes++; expectB(o, "G(n=" + std::to_string(n) + ")"); }
    else { rejected++; CHECK(o.rc == 0 && untouched(), "G(n=" + std::to_string(n) + ") : échec => aucun effet"); }
  }
  CHECK(rejected >= 10, "G : au moins dix points d'allocation testés");
  CHECK(completes >= 1, "G : au-delà du dernier point, le décodage réussit");
  resetState(); podNetTestHook = nullptr;

  if (!g_fail.empty()) { for (const std::string& f : g_fail) std::printf("ECART : %s\n", f.c_str()); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
