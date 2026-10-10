// host/ffl_harness.cpp — LOT8B2B2-PULLFRAME-PHASE-AUDIT3 puis AUDIT4 : exécute, sur l'HÔTE, le CODE RÉEL du journal de phases en flash de données et de l'instrumentation du client TLS (podFfBoot / podFfNote / podFfAppend / podFfEv / FfSSL / podFfLedSet,
// macros POD_FF_*) extrait mot pour mot du sketch arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino par tests/pullFramePhases.test.ts (fichier « ffl_extract.inc »), contre :
//   - une FLASH SIMULÉE de 8 Ko (8 blocs de 1 Ko) : programmation = ET binaire, effacement par bloc, adresses logiques comme DataFlashBlockDevice (le bloc 0 porte les clés : sentinelle), pannes injectées, détection de toute écriture hors du bloc 7 ;
//   - un FAUX CLIENT TLS (WiFiSSLClient) dont le N-ième read / connected peut ne JAMAIS revenir (exception « Stall ») ;
//   - une FAUSSE matrice de LED (registres PFS / PCNTR1 simulés) : les LED allumées sont relues comme le ferait l'œil ;
//   - un faux millis() (avance automatique réglable, ou explicite).
// Ce que l'hôte PROUVE : l'encodage, la lecture protégée, l'usure, l'étanchéité du bloc 7, les pannes, la plénitude du journal, le plafond d'événements, l'échantillonnage des appels, l'état des LED quand un appel ne rend pas la main.
// Ce qu'il NE PROUVE PAS : le comportement du pilote de flash réel (R_FLASH_LP), des broches de la matrice (le brochage simulé est arbitraire), les durées, la pile, l'USB.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdarg>
#include <cstdint>
#include <string>
#include <vector>

typedef uint64_t bd_addr_t;
typedef uint64_t bd_size_t;
struct Stall {};
static uint8_t g_flash[8192];
static int g_programs = 0, g_erases = 0, g_failEraseAt = 0, g_failProgramAt = 0, g_outsideWrites = 0, g_nonBlankWrites = 0;
static int g_stallOnByte = -1;                     // programmation de cet octet : ne revient jamais
class DataFlashBlockDevice {
 public:
  static DataFlashBlockDevice& getInstance() { static DataFlashBlockDevice d; return d; }
  int read(void* buffer, bd_addr_t add, bd_size_t size) {
    if (add + size > sizeof(g_flash)) return -1;
    std::memcpy(buffer, g_flash + add, (size_t)size);
    return 0;
  }
  int program(const void* buffer, bd_addr_t addr, bd_size_t size) {
    g_programs++;
    if (addr < 0x1C00 || addr + size > 0x2000) g_outsideWrites++;
    if (addr + size > sizeof(g_flash)) return -1;
    if (g_failProgramAt != 0 && g_programs == g_failProgramAt) return 7;
    const uint8_t* b = (const uint8_t*)buffer;
    if (g_stallOnByte >= 0 && size == 1 && b[0] == (uint8_t)g_stallOnByte) throw Stall{};
    for (bd_size_t i = 0; i < size; i++) { if (g_flash[addr + i] != 0xFF && g_flash[addr + i] != b[i]) g_nonBlankWrites++; g_flash[addr + i] &= b[i]; }
    return 0;
  }
  int erase(bd_addr_t add, bd_size_t size) {
    g_erases++;
    if (add < 0x1C00 || add + size > 0x2000 || (add % 1024) != 0 || size != 1024) g_outsideWrites++;
    if (g_failEraseAt != 0 && g_erases == g_failEraseAt) return 5;
    if (add + size > sizeof(g_flash)) return -1;
    std::memset(g_flash + add, 0xFF, (size_t)size);
    return 0;
  }
};

// ── matrice de LED simulée (11 broches : 6 sur le port 0, 5 sur le port 2, comme les masques du cœur ; le brochage est arbitraire) ─────────────────────────────────
typedef uint32_t bsp_io_port_pin_t;
static const uint32_t IOPORT_CFG_PORT_DIRECTION_OUTPUT = 1u, IOPORT_CFG_PORT_OUTPUT_HIGH = 2u, IOPORT_CFG_PORT_OUTPUT_LOW = 0u;
struct PinState { bool out = false, high = false; };
static PinState g_pins[8][256];
struct PinCfg { bsp_io_port_pin_t pin; };
static PinCfg g_pin_cfg[64];
struct PfsReg { int port, pin; PfsReg& operator=(uint32_t v) { g_pins[port][pin].out = (v & IOPORT_CFG_PORT_DIRECTION_OUTPUT) != 0; g_pins[port][pin].high = (v & IOPORT_CFG_PORT_OUTPUT_HIGH) != 0; return *this; } };
struct PfsPin { PfsReg PmnPFS; };
struct PfsPort { PfsPin PIN[256]; };
struct PfsAll { PfsPort PORT[8]; };
static PfsAll g_pfs;
struct Pcntr { int port; Pcntr& operator&=(uint32_t v) { for (int i = 0; i < 32; i++) if (((v >> i) & 1u) == 0) g_pins[port][i].out = false; return *this; } };
struct PortT { Pcntr PCNTR1; };
static PortT g_port0, g_port2;
#define R_PFS (&g_pfs)
#define R_PORT0 (&g_port0)
#define R_PORT2 (&g_port2)
static void initPins() {
  for (int p = 0; p < 8; p++) for (int i = 0; i < 256; i++) { g_pfs.PORT[p].PIN[i].PmnPFS.port = p; g_pfs.PORT[p].PIN[i].PmnPFS.pin = i; }
  g_port0.PCNTR1.port = 0; g_port2.PCNTR1.port = 2;
  const int p0[6] = { 3, 4, 11, 12, 13, 15 }, p2[5] = { 4, 5, 6, 12, 13 };
  for (int i = 0; i < 6; i++) g_pin_cfg[28 + i].pin = (0u << 8) | (uint32_t)p0[i];
  for (int i = 0; i < 5; i++) g_pin_cfg[28 + 6 + i].pin = (2u << 8) | (uint32_t)p2[i];
}
/** LED allumées, lues comme l'œil : anode (broche 7) en sortie HAUTE et cathode en sortie BASSE. Bit i = LED i du sketch (F, R, C, A, H). */
static uint8_t ledMask() {
  const uint8_t cath[5] = { 3, 4, 8, 0, 6 };
  uint8_t m = 0;
  const uint32_t a = g_pin_cfg[28 + 7].pin;
  const PinState& pa = g_pins[a >> 8][a & 0xFF];
  if (!(pa.out && pa.high)) return 0;
  for (int i = 0; i < 5; i++) { const uint32_t c = g_pin_cfg[28 + cath[i]].pin; const PinState& pc = g_pins[c >> 8][c & 0xFF]; if (pc.out && !pc.high) m |= (uint8_t)(1u << i); }
  return m;
}

// ── faux client TLS ──────────────────────────────────────────────────────────────────────────────────────────────────────
static int g_rdCalls = 0, g_cnCalls = 0, g_stallReadAt = 0, g_stallConnAt = 0, g_dataAfter = 30, g_baseReads = 0, g_baseConns = 0;
class WiFiSSLClient {
 public:
  virtual ~WiFiSSLClient() {}
  virtual int read() { return -1; }
  virtual int read(uint8_t* b, size_t n) { g_baseReads++; g_rdCalls++; if (g_stallReadAt != 0 && g_rdCalls == g_stallReadAt) throw Stall{}; if (g_rdCalls <= g_dataAfter) return 0; std::memset(b, 'x', n); return (int)n; }
  virtual uint8_t connected() { g_baseConns++; g_cnCalls++; if (g_stallConnAt != 0 && g_cnCalls == g_stallConnAt) throw Stall{}; return 1; }
};

static std::string g_log;
static void logf(const char* fmt, ...) { char b[512]; va_list ap; va_start(ap, fmt); std::vsnprintf(b, sizeof(b), fmt, ap); va_end(ap); if (std::strlen(b) > 255) b[255] = 0; g_log += b; g_log += "\n"; }
struct SerialShim { int avail = 256; std::string out; int availableForWrite() { return avail; } size_t write(uint8_t c) { out += (char)c; return 1; } } Serial;

static unsigned long g_now = 0, g_auto = 1;
static std::vector<uint8_t> g_ledSeen;
static unsigned long millis() { const unsigned long r = g_now; g_now += g_auto; const uint8_t m = ledMask(); if (g_ledSeen.empty() || g_ledSeen.back() != m) g_ledSeen.push_back(m); return r; }

alignas(4) static char g_stackLimitObj[16];
#define __StackLimit g_stackLimitObj[0]
static volatile uint32_t g_podPaintLen = 0x1A1;
static void setMarker(bool ok) { uint32_t m = ok ? 0x434E5259UL : 0xDEADBEEFUL, l = 0x1A1; std::memcpy(g_stackLimitObj, &m, 4); std::memcpy(g_stackLimitObj + 4, &l, 4); }

#include "ffl_extract.inc"

static int g_checks = 0, g_failed = 0;
#define CHECK(c, msg) do { g_checks++; if (!(c)) { g_failed++; std::printf("ECHEC %s : %s (ligne %d)\n", #c, msg, __LINE__); std::printf("--- journal ---\n%s--- serie : %s\n", g_log.c_str(), Serial.out.c_str()); } } while (0)
static bool has(const char* s) { return g_log.find(s) != std::string::npos; }
static void reset() {
  std::memset(g_flash, 0xFF, sizeof(g_flash));
  for (int i = 0; i < 1024; i++) g_flash[i] = (uint8_t)(0xA5 ^ i);          // bloc 0 : sentinelle (les clés)
  g_programs = g_erases = g_failEraseAt = g_failProgramAt = g_outsideWrites = g_nonBlankWrites = 0; g_stallOnByte = -1;
  g_rdCalls = g_cnCalls = g_stallReadAt = g_stallConnAt = g_baseReads = g_baseConns = 0; g_dataAfter = 30;
  g_podFfPos = 0; g_podFfPhase = 0; g_podFfT0 = 0; g_podFfNR = 0; g_podFfNC = 0; g_podFfNE = 0; g_podFfTk = 0; g_podFfLed = 0;
  g_log.clear(); Serial.out.clear(); Serial.avail = 256; setMarker(true);
  initPins(); for (int p = 0; p < 8; p++) for (int i = 0; i < 256; i++) g_pins[p][i] = PinState();
  g_now = 1000; g_auto = 1; g_ledSeen.clear();
}
static bool block0Intact() { for (int i = 0; i < 1024; i++) if (g_flash[i] != (uint8_t)(0xA5 ^ i)) return false; for (int i = 1024; i < 0x1C00; i++) if (g_flash[i] != 0xFF) return false; return true; }
static void run(int maxPhase) {                                              // un téléchargement de frame : marques 1 … maxPhase
  POD_FF_START("x");
  for (int n = 2; n <= maxPhase; n++) { if (n == 15) { POD_FF_MARK(15, "x"); POD_FF_STOP(); } else POD_FF_MARK(n, "x"); }
  if (maxPhase < 15) g_podFfPhase = 0;
}
static uint8_t at(int off) { return g_flash[0x1C00 + off]; }
/** Relit le journal comme le ferait un humain, SANS le code du sketch : phases en chiffres hexadécimaux, événements « <lettre><temps> » séparés par des espaces. */
static std::string dump() {
  std::string s; const char* L = "RDZCKXT";
  for (int off = 8; off < 1024; off++) {
    const uint8_t b = at(off);
    if (b == 0xFF) break;
    const uint8_t hi = b >> 4, lo = b & 0xF;
    if ((hi ^ lo) == 0xF) { s += "0123456789abcdef"[hi]; }
    else if (b == 0xBD) s += '!';
    else if ((hi ^ lo) == 0xA && hi < 7) { s += ' '; s += L[hi]; off++; if (off < 1024 && at(off) != 0xFF) s += std::to_string((int)at(off)); }
    else s += '?';
  }
  return s;
}
/** Boucle de lecture des en-têtes telle que le fait podhttp::Reader::fill : read, connected, attente de 2 ms. */
static void headerLoop(FfSSL& c, int iters, unsigned long stepMs) {
  uint8_t buf[64];
  for (int i = 0; i < iters; i++) { c.read(buf, sizeof(buf)); c.connected(); g_now += stepMs; }
}
/** Les n derniers éléments du journal relu par dump(), au format du rapport du sketch (phases collées, événements précédés d'une espace). */
static std::string tailTokens(const std::string& d, size_t n) {
  std::vector<std::string> tk;
  for (size_t i = 0; i < d.size();) {
    if (d[i] == ' ') { size_t j = i + 1; std::string e(1, ' '); e += d[j]; j++; while (j < d.size() && d[j] >= '0' && d[j] <= '9') { e += d[j]; j++; } tk.push_back(e); i = j; }
    else { tk.push_back(std::string(1, d[i])); i++; }
  }
  std::string out; for (size_t i = tk.size() > n ? tk.size() - n : 0; i < tk.size(); i++) out += tk[i];
  return out;
}
static std::string seqLine() { const size_t a = g_log.find("FFLOG sequence ("); if (a == std::string::npos) return ""; const size_t b = g_log.find(" : ", a); const size_t e = g_log.find('\n', b); return g_log.substr(b + 3, e - b - 3); }
static void phasesTo9() { run(9); g_podFfPhase = 9; }                         // run(9) laisse g_podFfPhase = 0 : on rétablit l'état « entre la marque 9 et la marque 10 »

int main() {
  // S1 : bloc vierge -> aucun journal valide, armement, relecture
  reset(); podFfBoot();
  CHECK(has("AUCUN journal valide"), "S1 premier lancement");
  CHECK(has("FFLOG arme : gen=1") && has("ecriture + relecture OK"), "S1 armement et relecture");
  CHECK(at(0) == 'F' && at(1) == 'F' && at(2) == 'L' && at(3) == '3' && at(4) == 1 && at(5) == 0xFE, "S1 en-tete");
  CHECK(at(8) == 0x0F && at(9) == 0xFF, "S1 marqueur d'armement 0 = 0x0F");
  CHECK(g_erases == 1 && g_podFfPos == 9 && Serial.out == "Z", "S1 un effacement, position 9, jeton de controle Z");
  CHECK(has("jeton serie Z ecrit"), "S1 jeton rapporte");
  CHECK(g_outsideWrites == 0 && block0Intact(), "S1 etancheite du bloc 7");
  CHECK(g_ledSeen.size() >= 5 && g_ledSeen[g_ledSeen.size() - 5] == 1 && g_ledSeen[g_ledSeen.size() - 4] == 2 && g_ledSeen[g_ledSeen.size() - 3] == 4 && g_ledSeen[g_ledSeen.size() - 2] == 8 && g_ledSeen[g_ledSeen.size() - 1] == 16, "S1 test sequentiel des cinq LED : F, R, C, A, H");
  CHECK(ledMask() == 0 && has("FFLED test"), "S1 LED eteintes apres le test");

  // S2 : téléchargement complet (15 phases) puis redémarrage
  run(15);
  CHECK(g_podFfPos == 24, "S2 15 entrees apres l'armement");
  for (int n = 1; n <= 15; n++) CHECK(at(8 + n) == (uint8_t)((n << 4) | (~n & 0x0F)), "S2 entree n = n<<4 | ~n");
  CHECK(Serial.out == "ZDEFGHIJKLMN", "S2 jetons serie d'un octet pour les seules phases 4 a 14");
  CHECK(ledMask() == 0, "S2 LED eteintes apres la marque 15");
  g_log.clear(); podFfBoot();
  CHECK(has("gen=1 ; 16 elements ; DERNIERE PHASE 15 (retour de podNetRun)") && has("(16 derniers elements) : 0123456789abcdef"), "S2 rapport complet");
  CHECK(has("FFLOG arme : gen=2") && g_erases == 2 && at(4) == 2 && at(5) == 0xFD, "S2 generation 2, un effacement");

  // S3 : blocage a la phase 6
  reset(); podFfBoot(); run(6); g_log.clear(); podFfBoot();
  CHECK(has("DERNIERE PHASE 6 (avant client.connect)") && has(": 0123456"), "S3 derniere phase 6");

  // S4 : démarrages sans aucune phase : aucun effacement supplémentaire, aucun marqueur en double
  reset(); podFfBoot(); podFfBoot(); podFfBoot();
  CHECK(g_erases == 1 && g_podFfPos == 9 && at(9) == 0xFF, "S4 usure : un seul effacement");
  CHECK(has("AUCUNE phase atteinte"), "S4 rapport sans phase");

  // S5 : bloc rempli de valeurs aléatoires (jamais utilisé par ce canari)
  for (unsigned seed = 1; seed <= 40; seed++) {
    reset(); unsigned s = seed * 2654435761u; for (int i = 0; i < 1024; i++) { s = s * 1664525u + 1013904223u; g_flash[0x1C00 + i] = (uint8_t)(s >> 24); }
    podFfBoot();
    CHECK(has("AUCUN journal valide") && has("FFLOG arme"), "S5 aleatoire : jamais pris pour un journal");
    CHECK(g_outsideWrites == 0 && block0Intact(), "S5 etancheite");
  }
  // S5b : en-tête valide mais entrées aléatoires / octets invalides / faux événements : lecture bornée, pas de plantage, ligne <= 255
  for (unsigned seed = 1; seed <= 60; seed++) {
    reset(); podFfBoot(); unsigned s = seed * 2246822519u; int n = 0; for (int i = 9; i < 1024 && n < 700; i++, n++) { s = s * 1664525u + 1013904223u; uint8_t v = (uint8_t)(s >> 24); if (v == 0xFF) v = 0xFE; if (seed % 3 == 0 && (s & 8)) v = (uint8_t)(((s >> 9) % 7) << 4 | ((((s >> 9) % 7) ^ 0xA) & 0xF)); g_flash[0x1C00 + i] = v; }
    g_log.clear(); podFfBoot();
    CHECK(has("FFLOG demarrage precedent") && has("FFLOG arme"), "S5b entrees aleatoires");
    CHECK(g_outsideWrites == 0, "S5b etancheite");
  }
  // S6 : écriture interrompue (octet invalide) au milieu du journal
  reset(); podFfBoot(); run(2); { g_flash[0x1C00 + 10] &= 0x2C; } g_log.clear(); podFfBoot();     // entree 3 (phase 2 = 0x2D) remplacee par 0x2C : octet invalide
  CHECK(has("DERNIERE PHASE 1") || has("DERNIERE PHASE 2"), "S6 derniere phase valide retenue");
  CHECK(has(": 01?"), "S6 octet invalide signale par ? a sa place dans la sequence");

  // S7 : pannes de flash
  reset(); g_failEraseAt = 1; podFfBoot();
  CHECK(has("FFLOG DESACTIVE") && g_podFfPos == 0x400, "S7 effacement refuse -> journal desactive");
  { const int p = g_programs; run(15); CHECK(g_programs == p, "S7 aucune programmation une fois desactive"); }
  reset(); podFfBoot(); g_failProgramAt = g_programs + 5; run(15);
  CHECK(g_podFfPos == 0x400, "S7b programmation refusee -> journal desactive");
  { const int p = g_programs; run(15); CHECK(g_programs == p, "S7b plus aucune ecriture"); }

  // S8 : tampon USB plein : pas de jeton, mais le journal en flash est complet
  reset(); podFfBoot(); Serial.out.clear(); Serial.avail = 0; run(15);
  CHECK(Serial.out.empty() && g_podFfPos == 24, "S8 jetons perdus, flash intacte");

  // S9 : marqueur de pile détruit : octet 0xBD après la phase
  reset(); podFfBoot(); POD_FF_START("x"); POD_FF_MARK(2, "x"); POD_FF_MARK(3, "x"); setMarker(false); POD_FF_MARK(4, "x");
  CHECK(at(8 + 4) == 0x4B && at(8 + 5) == 0xBD, "S9 phase 4 puis marqueur detruit");
  g_podFfPhase = 0; g_log.clear(); podFfBoot();
  CHECK(has("DERNIERE PHASE 4") && has("01234!"), "S9 glyphe ! dans la sequence");

  // S10 : journal plein : jamais d'écriture au-delà du bloc
  reset(); podFfBoot(); for (int i = 0; i < 200; i++) run(15);
  CHECK(g_podFfPos <= 0x400 && g_outsideWrites == 0 && block0Intact(), "S10 journal plein, aucune ecriture hors du bloc 7");
  g_log.clear(); podFfBoot();
  CHECK(has("FFLOG demarrage precedent : gen=1") && has("DERNIERE PHASE"), "S10 relecture du journal plein");

  // S11 : marques avant l'armement : aucune écriture
  reset(); run(15);
  CHECK(g_programs == 0 && g_erases == 0, "S11 journal non arme : silence");

  // S12 : usure sur 20 démarrages avec phases / sans phases
  reset(); for (int i = 0; i < 20; i++) { podFfBoot(); run(15); }
  CHECK(g_erases == 20 && at(4) == 20, "S12 un effacement par demarrage avec journal");
  reset(); for (int i = 0; i < 20; i++) podFfBoot();
  CHECK(g_erases == 1, "S12b aucun effacement si le journal precedent est vide");
  CHECK(g_outsideWrites == 0 && g_nonBlankWrites == 0, "S12 jamais d'ecriture sur un octet non vierge");

  // S13 : en-tête dont le complément est faux (écriture interrompue de la génération) : pas un journal valide
  reset(); podFfBoot(); run(5); g_flash[0x1C00 + 5] = 0xF0; g_log.clear(); podFfBoot();
  CHECK(has("AUCUN journal valide"), "S13 en-tete a complement faux refuse");
  // S14 : en-tête valide mais magique différent : refusé
  reset(); podFfBoot(); run(5); g_flash[0x1C00 + 3] = '2'; g_log.clear(); podFfBoot();
  CHECK(has("AUCUN journal valide"), "S14 magique faux refuse");

  // ── AUDIT4 : événements du client TLS espion et LED ─────────────────────────────────────────────────────────────────────
  // E1 : lecture normale des en-têtes (41 tours, 2 ms) : appels 1, 2, 3, 4, 8, 16, 32 de read ET de connected, entrée + sortie, temps croissant, aucune seconde écoulée
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; FfSSL c; headerLoop(c, 41, 2); POD_FF_MARK(10, "x");
    const std::string d = dump();
    CHECK(g_rdCalls == 41 && g_cnCalls == 41, "E1 le faux client est appele a chaque tour");
    CHECK(d.find("0123456789 R") != std::string::npos, "E1 les evenements suivent la marque 9");
    int ev = 0; for (size_t i = 0; i < d.size(); i++) if (d[i] >= 'A' && d[i] <= 'Z') ev++;
    CHECK(ev == 28, "E1 7 appels echantillonnes x 2 (entree, sortie) x 2 (read, connected)");
    CHECK(d.find(" R0 Z0") != std::string::npos || d.find(" R0 D0") != std::string::npos, "E1 entree puis sortie du premier read, temps 0");
    CHECK(d.find(" T") == std::string::npos, "E1 aucune seconde ecoulee : aucun evenement T");
    CHECK(d.rfind("a") != std::string::npos && d.find("a") > d.find("R") && ledMask() == (1u << 3 | 1u << 4), "E1 phase 10 apres les evenements, LED A + H allumees");
    run(15); CHECK(ledMask() == 0, "E1 LED eteintes a la fin");
    CHECK(g_outsideWrites == 0 && g_nonBlankWrites == 0, "E1 etancheite"); }
  // E2 : plafond d'événements : 60 s de boucle (30 000 tours de 2 ms) : au plus 80 événements, 30 ticks, journal borné
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; FfSSL c; headerLoop(c, 30000, 2); POD_FF_MARK(10, "x");
    CHECK(g_podFfNE == 64, "E2 le plafond de 64 evenements est ATTEINT et tenu");
    CHECK(g_podFfPos <= 0x400 && g_outsideWrites == 0, "E2 journal borne");
    const std::string d = dump(); CHECK(d.find(" T1") != std::string::npos && d.find(" T20") != std::string::npos && d.find(" T29") == std::string::npos, "E2 ticks des premieres secondes ; le plafond coupe le journal");
    CHECK(g_baseReads == 30000 && g_baseConns == 30000, "E2 AUCUN appel du vrai client n'est perdu ou ajoute"); }
  // E3 : read #4 (echantillonne) ne rend jamais la main : LED A + R, derniere entree = R sans sortie
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; g_stallReadAt = 4; FfSSL c; bool stalled = false; try { headerLoop(c, 50, 2); } catch (const Stall&) { stalled = true; }
    CHECK(stalled && ledMask() == (1u << 3 | 1u << 1), "E3 blocage dans read : LED A + R");
    const std::string d = dump(); CHECK(d.size() >= 3 && d.substr(d.size() - 2, 1) == "R" , "E3 la derniere entree est l'entree de read (sans sortie)"); }
  // E4 : read #6 (non echantillonne) : LED A + R, derniere entree = sortie du connected #4 ou anterieure
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; g_stallReadAt = 6; FfSSL c; bool stalled = false; try { headerLoop(c, 50, 2); } catch (const Stall&) { stalled = true; }
    CHECK(stalled && ledMask() == (1u << 3 | 1u << 1), "E4 blocage dans un read non echantillonne : LED A + R");
    const std::string d = dump(); CHECK(d.find("R") != std::string::npos && d.back() != 'R', "E4 le journal ne contient pas d'entree orpheline"); }
  // E5 : connected #2 : LED A + C
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; g_stallConnAt = 2; FfSSL c; bool stalled = false; try { headerLoop(c, 50, 2); } catch (const Stall&) { stalled = true; }
    CHECK(stalled && ledMask() == (1u << 3 | 1u << 2), "E5 blocage dans connected : LED A + C"); }
  // E6 : l'ECRITURE FLASH de la phase 10 ne revient pas : LED A + H + F (allumees AVANT l'ecriture)
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; FfSSL c; headerLoop(c, 5, 2); g_stallOnByte = podFfEntry(10); bool stalled = false; try { POD_FF_MARK(10, "x"); } catch (const Stall&) { stalled = true; }
    CHECK(stalled && ledMask() == (1u << 3 | 1u << 4 | 1u << 0), "E6 blocage dans l'ecriture flash de la phase 10 : LED A + H + F"); }
  // E7 : bloqué hors des appels du client (boucle, delay) : A seule
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; FfSSL c; headerLoop(c, 5, 2);
    CHECK(ledMask() == (1u << 3), "E7 hors des appels et hors flash : LED A seule"); }
  // E8 : hors de la fenetre 9 -> 10 : le client espion n'ecrit rien ; avant la marque 9 et apres la marque 10
  { reset(); podFfBoot(); run(8); g_podFfPhase = 8; { FfSSL c; const int p = g_programs; headerLoop(c, 20, 2); CHECK(g_programs == p, "E8 phase 8 : aucune ecriture"); }
    g_podFfPhase = 10; { FfSSL c; const int p = g_programs; headerLoop(c, 20, 2); CHECK(g_programs == p, "E8 phase 10 : aucune ecriture"); }
    g_podFfPhase = 0; { FfSSL c; const int p = g_programs; headerLoop(c, 20, 2); CHECK(g_programs == p && ledMask() == (1u << 3), "E8 traçage arrete : aucune ecriture"); } }
  // E9 : temps FIGE (millis ne bouge pas) : pas de tick, temps 0, pas de blocage du code
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; FfSSL c; headerLoop(c, 500, 0); POD_FF_MARK(10, "x");
    const std::string d = dump(); CHECK(d.find(" T") == std::string::npos && g_podFfTk == 0, "E9 horloge figee : aucun tick"); }
  // E10 : rapport au demarrage suivant d'un journal avec evenements : lisible, une ligne <= 255, legende presente
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; FfSSL c; headerLoop(c, 41, 2); POD_FF_MARK(10, "x"); run(15); g_auto = 1; const std::string dmp10 = dump(); g_log.clear(); podFfBoot();
    CHECK(has("FFLOG sequence (16 derniers elements) :") && has("FFLOG legende"), "E10 sequence et legende rapportees");
    { const std::string exp = tailTokens(dmp10, 16); CHECK(!exp.empty() && seqLine() == exp, "E10 la sequence rapportee par le sketch est EXACTEMENT le journal relu independamment (evenements + temps)"); }
    size_t mx = 0, from = 0; while (from < g_log.size()) { size_t e = g_log.find('\n', from); if (e == std::string::npos) e = g_log.size(); if (e - from > mx) mx = e - from; from = e + 1; }
    CHECK(mx <= 255, "E10 aucune ligne ne depasse la limite de 255 caracteres de logf"); }

  // E11 : serveur lent (500 ms par tour, 40 tours = 20 s) : le temps des appels echantillonnes depasse 2 s -> plafonne a 254 (jamais 0xFF = vierge, jamais un repli) ; ticks croissants
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; FfSSL c; headerLoop(c, 40, 500); POD_FF_MARK(10, "x");
    const std::string d = dump();
    CHECK(d.find("254") != std::string::npos, "E11 temps plafonne a 254 (appels apres 2 s)");
    CHECK(d.find("?") == std::string::npos && d.find(" T1") != std::string::npos && d.find(" T10") != std::string::npos, "E11 aucun octet invalide, ticks des secondes"); }

  // E12 : blocage dans read #4 (appel echantillonne), puis redemarrage : le rapport montre l'ENTREE de read sans sortie, derniere phase 9
  { reset(); podFfBoot(); phasesTo9(); g_auto = 0; g_stallReadAt = 4; FfSSL c; try { headerLoop(c, 50, 2); } catch (const Stall&) { }
    g_auto = 1; const std::string dmp12 = dump(); g_log.clear(); podFfBoot();
    CHECK(has("DERNIERE PHASE 9 (apres client.print)"), "E12 derniere phase 9");
    const std::string s = seqLine(); const std::string exp = tailTokens(dmp12, 16);
    CHECK(s == exp && s.size() >= 3 && s.find(" R") != std::string::npos, "E12 la sequence rapportee contient l'entree de read");
    CHECK(s.substr(s.rfind(' ') + 1, 1) == "R", "E12 le DERNIER element est l'entree de read (aucune sortie)"); }

  if (g_failed != 0) { std::printf("FAIL %d/%d\n", g_failed, g_checks); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
