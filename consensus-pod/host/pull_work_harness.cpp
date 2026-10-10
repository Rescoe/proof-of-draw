// host/pull_work_harness.cpp — DOPULL-JSON-STACK-FIX1 : exécute, sur l'hôte, le CODE RÉEL du décodage de la réponse /api/pull (pullSetId, pullSetText, pullParseWork, pullParseOnWorkStack, pullWorkFailed, doPullApply, doPullStage),
// extrait mot pour mot du sketch UNO R4 e-ink 2,9″ par tests/dopullJsonStack.test.ts (fichier « pull_extract.inc », blocs de canari retirés), contre ArduinoJson RÉEL, une classe String simulée
// (consensus-pod/host/shim/Arduino.h, avec injection de pannes d'allocation) et la logique réelle de podNetStack.h (POD_NET_HOST_TEST : pile profonde simulée, garde écrasée, malloc impossible, imbrication).
//   pull_work_harness  →  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// Ce que l'hôte PROUVE : (1) réponses minimale, complète, 429 (valide, illisible), JSON tronqué, JSON trop imbriqué, champs hors bornes, observation à 8 et 9 empreintes, ownedBlock, troncature UTF-8 du cartel ;
// (2) TOUT OU RIEN : aucun état global, aucune écriture en mémoire non volatile avant un retour valide, et un échec (JSON, bornes, tas, NOMEM / NESTED / GUARD / MARGIN de la pile de travail) ne laisse AUCUN effet ;
// (3) pour chaque point d'allocation du décodage, une panne donne soit un résultat COMPLET et exact, soit aucun effet ; (4) GUARD = arrêt sûr AVANT tout journal ; (5) l'ordre des effets de bord (cartel, observation,
// ownedBlock, puis bloc) est celui du firmware d'avant. Ce qu'il NE PROUVE PAS : le déplacement réel de SP ni la profondeur réelle de la pile sur la carte (canari sans frame).
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

static void resetState() {
  pendingWorkTitle = "T0"; pendingArtistName = "A0"; pendingDisplayTs = "D0"; pendingObsHashes = "O0"; pendingObsTarget = "OT0"; currentBlockHash = "oldhash"; pendingCandidateId = "C0";
  currentBlockIndex = 3; lastPullMs = 7; nextPullIntervalMs = 5;
  g_nSaveOwned = g_nSaveBlock = g_seq = g_seqOwned = g_seqBlock = 0; g_savedOwned = ""; g_savedBlock = ""; g_log.clear();
  g_strFailArmed = false; g_strFailAt = 0; g_strAllocN = 0;
  podNetTestHook = nullptr; podNetTestFailAlloc = 0; podNetTestNested = 0;
}
static bool untouched() {
  return pendingWorkTitle == "T0" && pendingArtistName == "A0" && pendingDisplayTs == "D0" && pendingObsHashes == "O0" && pendingObsTarget == "OT0" && currentBlockHash == "oldhash" && pendingCandidateId == "C0"
      && currentBlockIndex == 3 && lastPullMs == 7 && nextPullIntervalMs == 5 && g_nSaveOwned == 0 && g_nSaveBlock == 0;
}
struct Out { int rc; String frameId, frameSource; };
static Out run(const std::string& body, int code) { String resp(body.c_str()); Out o; o.rc = doPullStage(resp, code, o.frameId, o.frameSource); return o; }
static std::string hex64(char c) { return std::string(64, c); }

static const char* B_BODY_FMT = "{\"frameId\":\"fr-1234\",\"frameSource\":\"consensus\",\"retryAfter\":300,\"chain\":{\"blockHash\":\"%s\",\"blockIndex\":96},\"pendingValidation\":{\"candidateId\":\"cand-1\"},"
  "\"cartelMeta\":{\"workTitle\":\"Chat - pain\",\"drawArtistName\":\"Roubzi\",\"displayTs\":\"10/10/2026 09:15 (Paris)\",\"blockIndex\":95},"
  "\"pendingObservation\":{\"blockHashes\":[\"h1\",\"h2\",\"h3\"],\"targetBlockHash\":\"%s\"},\"ownedBlock\":\"%s\"}";
static std::string bodyB() { char b[1024]; std::snprintf(b, sizeof(b), B_BODY_FMT, hex64('a').c_str(), hex64('b').c_str(), hex64('c').c_str()); return b; }
static void expectB(const Out& o, const std::string& t) {
  CHECK(o.rc == 1, t + " : rc");
  CHECK(o.frameId == "fr-1234" && o.frameSource == "consensus", t + " : frame");
  CHECK(pendingWorkTitle == "Chat - pain" && pendingArtistName == "Roubzi" && pendingDisplayTs == "10/10/2026 09:15 (Paris)", t + " : cartel");
  CHECK(pendingObsHashes == "[\"h1\",\"h2\",\"h3\"]" && pendingObsTarget == hex64('b').c_str(), t + " : observation");
  CHECK(g_nSaveOwned == 1 && g_savedOwned == hex64('c').c_str(), t + " : ownedBlock enregistré");
  CHECK(g_nSaveBlock == 1 && g_savedBlock == hex64('a').c_str() && currentBlockHash == hex64('a').c_str(), t + " : bloc enregistré");
  CHECK(currentBlockIndex == 96, t + " : indice du bloc (le bloc suit le cartel)");
  CHECK(pendingCandidateId == "cand-1", t + " : candidat");
  CHECK(nextPullIntervalMs == PULL_INTERVAL, t + " : prochain pull (frame présente)");
  CHECK(g_seqOwned < g_seqBlock && g_seqOwned > 0, t + " : ordre ownedBlock puis bloc (comme avant)");
}

int main() {
  // ── A. réponse minimale
  resetState();
  { Out o = run("{}", 200);
    CHECK(o.rc == 1 && o.frameId.length() == 0 && o.frameSource == "none", "A : minimale, aucune frame");
    CHECK(nextPullIntervalMs == 60000UL, "A : retryAfter par défaut 60 s");
    CHECK(pendingWorkTitle == "T0" && g_nSaveOwned == 0 && g_nSaveBlock == 0 && currentBlockHash == "oldhash", "A : rien d'autre ne change"); }
  resetState();
  { Out o = run("{\"retryAfter\":300}", 200); CHECK(o.rc == 1 && nextPullIntervalMs == 300000UL, "A : retryAfter 300 s, ni frame ni candidat"); }
  resetState();
  { Out o = run("{\"retryAfter\":-5}", 200); CHECK(o.rc == 1 && nextPullIntervalMs == 60000UL, "A : retryAfter <= 0 ramené à 60 s"); }
  // ── B. réponse complète (cartel, candidat, observation, ownedBlock, bloc)
  resetState();
  { Out o = run(bodyB(), 200); expectB(o, "B"); CHECK(g_log.find("[PULL] cartel: Chat - pain / Roubzi (bloc 95)") != std::string::npos, "B : journal du cartel"); CHECK(g_log.find("nouveau bloc #96") != std::string::npos, "B : journal du bloc"); }
  // frame repliée dans frame{} quand frameId racine absent
  resetState();
  { Out o = run("{\"frameSource\":\"personal\",\"frame\":{\"frameId\":\"in-frame\"}}", 200); CHECK(o.rc == 1 && o.frameId == "in-frame" && o.frameSource == "personal", "B : frameId lu dans frame{}"); }
  // ── C. 429
  resetState();
  { Out o = run("{\"retryAfter\":17}", 429); CHECK(o.rc == 2, "C : 429 => 2"); CHECK(lastPullMs == 100000UL - (60000UL - 17000UL), "C : lastPullMs avancé de retryAfter"); CHECK(g_nSaveOwned == 0 && g_nSaveBlock == 0 && pendingWorkTitle == "T0", "C : rien d'autre"); CHECK(g_log.find("[PULL] 429 retryAfter=17s") != std::string::npos, "C : journal"); }
  resetState();
  { Out o = run("<html>pas du json</html>", 429); CHECK(o.rc == 2 && g_log.find("retryAfter=60s") != std::string::npos, "C : 429 illisible => 60 s (comme avant)"); }
  resetState();
  { Out o = run("{\"retryAfter\":0}", 429); CHECK(o.rc == 2 && g_log.find("retryAfter=1s") != std::string::npos, "C : retryAfter 0 => 1 s"); }
  // ── D. JSON tronqué / trop imbriqué : échec fermé sans AUCUN effet
  resetState();
  { Out o = run("{\"chain\":{\"blockHash\":\"abc", 200); CHECK(o.rc == 0 && untouched(), "D : tronqué => rejeté sans effet"); CHECK(g_log.find("[PULL] JSON: IncompleteInput") != std::string::npos, "D : cause journalisée"); }
  resetState();
  { std::string deep; for (int i = 0; i < 12; i++) deep += "{\"a\":"; deep += "1"; for (int i = 0; i < 12; i++) deep += "}";
    Out o = run(deep, 200); CHECK(o.rc == 0 && untouched(), "D : imbrication 12 => rejeté sans effet"); CHECK(g_log.find("TooDeep") != std::string::npos, "D : TooDeep journalisé"); }
  resetState();
  { Out o = run("{\"chain\":{\"blockHash\":\"x\"}} garbage", 200); CHECK(o.rc == 1 || untouched(), "D : fin de document avec bruit : accepté comme avant ou rejeté sans effet"); }
  // ── E. bornes (contrat écrit) : rejeté, JAMAIS appliqué partiellement (le cartel, lu AVANT le champ fautif, ne doit pas apparaître)
  resetState();
  { char b[1024]; std::snprintf(b, sizeof(b), "{\"cartelMeta\":{\"workTitle\":\"Titre\"},\"ownedBlock\":\"%s\"}", std::string(65, 'd').c_str());
    Out o = run(b, 200); CHECK(o.rc == 0 && untouched(), "E : ownedBlock de 65 car. => rejeté, cartel non appliqué"); CHECK(g_log.find("champ hors bornes") != std::string::npos, "E : cause journalisée"); }
  resetState();
  { Out o = run("{\"chain\":{\"blockHash\":\"" + std::string(65, 'a') + "\"}}", 200); CHECK(o.rc == 0 && untouched(), "E : blockHash de 65 car. => rejeté"); }
  resetState();
  { Out o = run("{\"chain\":{\"blockHash\":\"" + std::string(64, 'a') + "\"}}", 200); CHECK(o.rc == 1 && currentBlockHash == std::string(64, 'a').c_str(), "E : blockHash de 64 car. accepté (borne incluse)"); }
  resetState();
  { Out o = run("{\"frameSource\":\"" + std::string(17, 'x') + "\"}", 200); CHECK(o.rc == 0 && untouched(), "E : frameSource de 17 car. => rejeté"); }
  resetState();
  { Out o = run("{\"frameId\":\"" + std::string(65, 'f') + "\"}", 200); CHECK(o.rc == 0 && untouched(), "E : frameId de 65 car. => rejeté"); }
  resetState();
  { Out o = run("{\"pendingValidation\":{\"candidateId\":\"" + std::string(65, 'c') + "\"}}", 200); CHECK(o.rc == 0 && untouched(), "E : candidateId de 65 car. => rejeté"); }
  // observation : 8 empreintes acceptées, 9 refusées, élément trop long refusé
  resetState();
  { std::string a = "["; for (int i = 0; i < 8; i++) { if (i) a += ","; a += "\"" + hex64((char)('a' + i)) + "\""; } a += "]";
    Out o = run("{\"pendingObservation\":{\"blockHashes\":" + a + ",\"targetBlockHash\":\"" + hex64('t') + "\"}}", 200);
    CHECK(o.rc == 1 && pendingObsHashes.length() == 8 * 66 + 7 + 2 && pendingObsTarget == hex64('t').c_str(), "E : 8 empreintes de 64 car. acceptées (observation maximale)"); }
  resetState();
  { std::string a = "["; for (int i = 0; i < 9; i++) { if (i) a += ","; a += "\"" + hex64((char)('a' + i)) + "\""; } a += "]";
    Out o = run("{\"cartelMeta\":{\"workTitle\":\"Titre\"},\"pendingObservation\":{\"blockHashes\":" + a + "}}", 200); CHECK(o.rc == 0 && untouched(), "E : 9 empreintes => rejeté, cartel non appliqué"); }
  resetState();
  { Out o = run("{\"pendingObservation\":{\"blockHashes\":[\"" + std::string(65, 'a') + "\"]}}", 200); CHECK(o.rc == 0 && untouched(), "E : empreinte de 65 car. => rejeté"); }
  resetState();
  { Out o = run("{\"pendingObservation\":{\"blockHashes\":[]},\"cartelMeta\":{}}", 200); CHECK(o.rc == 1 && pendingObsHashes == "O0", "E : observation vide : état d'observation inchangé (comme avant)"); }
  // cartel : troncature UTF-8 documentée (255 / 127 / 63 o), jamais au milieu d'un caractère
  resetState();
  { std::string t, ar, ts; for (int i = 0; i < 200; i++) t += "\xC3\xA9"; for (int i = 0; i < 100; i++) ar += "\xC3\xA9"; for (int i = 0; i < 50; i++) ts += "\xC3\xA9";
    Out o = run("{\"cartelMeta\":{\"workTitle\":\"" + t + "\",\"drawArtistName\":\"" + ar + "\",\"displayTs\":\"" + ts + "\",\"blockIndex\":1}}", 200);
    CHECK(o.rc == 1, "E : textes longs du cartel : accepté (tronqué)");
    CHECK(pendingWorkTitle.length() == 254 && pendingArtistName.length() == 126 && pendingDisplayTs.length() == 62, "E : troncature à la frontière UTF-8 (254 / 126 / 62 o)");
    const char* p = pendingWorkTitle.c_str(); bool ok = true; for (unsigned i = 0; i + 1 < pendingWorkTitle.length(); i += 2) if ((uint8_t)p[i] != 0xC3 || (uint8_t)p[i + 1] != 0xA9) ok = false;
    CHECK(ok, "E : aucun caractère coupé en deux"); }
  resetState();
  { std::string t(255, 'x'); Out o = run("{\"cartelMeta\":{\"workTitle\":\"" + t + "\"}}", 200); CHECK(o.rc == 1 && pendingWorkTitle.length() == 255, "E : titre ASCII de 255 o conservé en entier"); }
  // corps surdimensionné : httpCall refuse déjà tout corps > 3 071 o (g_body[3072]) ; le plus grand corps admis passe sans effet de bord inattendu
  resetState();
  { Out o = run("{\"x\":\"" + std::string(3000, 'z') + "\"}", 200); CHECK(o.rc == 1 && o.frameId.length() == 0 && pendingWorkTitle == "T0" && g_nSaveOwned == 0 && g_nSaveBlock == 0, "E : corps de 3 Ko aux champs inconnus : accepté et ignoré"); }
  resetState();
  { Out o = run("{\"cartelMeta\":{\"workTitle\":\"" + std::string(2800, 'y') + "\"}}", 200); CHECK(o.rc == 1 && pendingWorkTitle.length() == 255, "E : titre de 2 800 o : tronqué à 255 o (contrat écrit), jamais refusé en silence"); }
  // ── F. échecs de la pile de travail : aucun effet, journal honnête ; GUARD = arrêt sûr AVANT tout journal
  resetState(); podNetTestFailAlloc = 1;
  { Out o = run(bodyB(), 200); CHECK(o.rc == 0 && untouched(), "F : NOMEM => rien d'appliqué"); CHECK(g_log.find("ECHOUEE") != std::string::npos && g_log.find("NON exécutée") != std::string::npos, "F : NOMEM dit « NON exécutée »"); }
  resetState(); podNetTestNested = 1;
  { Out o = run(bodyB(), 200); CHECK(o.rc == 0 && untouched(), "F : NESTED => rien d'appliqué"); CHECK(g_log.find("NON exécutée") != std::string::npos, "F : NESTED dit « NON exécutée »"); }
  resetState(); podNetTestHook = [](uint8_t*, size_t, uint8_t* guard) { guard[0] = 0; };
  { bool halted = false; try { run(bodyB(), 200); } catch (const Halt&) { halted = true; }
    CHECK(halted, "F : GUARD => arrêt sûr"); CHECK(g_log.empty(), "F : GUARD => AUCUN journal avant l'arrêt (le tas voisin peut être corrompu)"); CHECK(untouched(), "F : GUARD => rien d'appliqué"); }
  resetState(); podNetTestHook = [](uint8_t* low, size_t, uint8_t*) { low[0] = 0; };
  { Out o = run(bodyB(), 200); CHECK(o.rc == 0 && untouched(), "F : MARGIN => la réponse a été décodée mais RIEN n'est appliqué"); CHECK(g_log.find("EXÉCUTÉE") != std::string::npos, "F : MARGIN dit « EXÉCUTÉE mais rejetée »"); }
  resetState(); podNetTestHook = [](uint8_t* low, size_t n, uint8_t*) { low[n - 100] = 0; };   // 100 o utilisés seulement : marge énorme => accepté
  { Out o = run(bodyB(), 200); expectB(o, "F2"); }
  // ── G. panne d'allocation à CHAQUE point du décodage : résultat complet et exact, ou aucun effet
  int completes = 0, rejected = 0;
  for (int n = 1; n <= 80; n++) {
    resetState(); g_strFailArmed = true; g_strFailAt = n; g_strAllocN = 0;
    podNetTestHook = [](uint8_t*, size_t, uint8_t*) { g_strFailArmed = false; };   // la panne n'existe que PENDANT le décodage (avant le retour sur la pile principale)
    Out o = run(bodyB(), 200);
    if (o.rc == 1) { completes++; expectB(o, "G(n=" + std::to_string(n) + ")"); }
    else { rejected++; CHECK(o.rc == 0 && untouched(), "G(n=" + std::to_string(n) + ") : échec => aucun effet"); CHECK(g_log.find("réponse rejetée") != std::string::npos, "G : cause journalisée"); }
  }
  std::fprintf(stderr, "points d'allocation du decodage rejetes : %d ; reponses completes : %d\n", rejected, completes);
  CHECK(rejected >= 10, "G : au moins dix points d'allocation du décodage testés");
  CHECK(completes >= 1, "G : au-delà du dernier point, le décodage réussit");
  resetState(); podNetTestHook = nullptr;

  if (!g_fail.empty()) { for (const std::string& f : g_fail) std::printf("ECART : %s\n", f.c_str()); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
