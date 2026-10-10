// host/ffl_harness.cpp — LOT8B2B2-PULLFRAME-PHASE-AUDIT3 : exécute, sur l'HÔTE, le CODE RÉEL du journal de phases en flash de données (podFfBoot / podFfNote / podFfAppend, macros POD_FF_*)
// extrait mot pour mot du sketch arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino par tests/pullFramePhases.test.ts (fichier « ffl_extract.inc »), contre une FLASH SIMULÉE de 8 Ko (8 blocs de 1 Ko) :
//   programmation = ET binaire (un bit à 0 ne revient à 1 que par l'effacement du bloc), effacement par bloc de 1 Ko, adresses logiques comme DataFlashBlockDevice (le bloc 0 porte les clés : sentinelle),
//   injection de panne (effacement refusé, N-ième programmation refusée), compteurs d'effacements et de programmations, détection de toute écriture hors du bloc 7.
// Ce que l'hôte PROUVE : l'encodage, la lecture protégée contre les valeurs aléatoires et les écritures interrompues, l'usure (un effacement par démarrage au plus), l'étanchéité du bloc 7, les pannes, la plénitude du journal.
// Ce qu'il NE PROUVE PAS : le comportement du pilote de flash réel (R_FLASH_LP), les durées, la pile, l'USB.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdarg>
#include <cstdint>
#include <string>

typedef uint64_t bd_addr_t;
typedef uint64_t bd_size_t;
static uint8_t g_flash[8192];
static int g_programs = 0, g_erases = 0, g_failEraseAt = 0, g_failProgramAt = 0, g_outsideWrites = 0, g_nonBlankWrites = 0;
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

static std::string g_log;
static void logf(const char* fmt, ...) { char b[1024]; va_list ap; va_start(ap, fmt); std::vsnprintf(b, sizeof(b), fmt, ap); va_end(ap); g_log += b; g_log += "\n"; }
struct SerialShim { int avail = 256; std::string out; int availableForWrite() { return avail; } size_t write(uint8_t c) { out += (char)c; return 1; } } Serial;

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
  g_programs = g_erases = g_failEraseAt = g_failProgramAt = g_outsideWrites = g_nonBlankWrites = 0;
  g_podFfPos = 0; g_podFfPhase = 0; g_log.clear(); Serial.out.clear(); Serial.avail = 256; setMarker(true);
}
static bool block0Intact() { for (int i = 0; i < 1024; i++) if (g_flash[i] != (uint8_t)(0xA5 ^ i)) return false; for (int i = 1024; i < 0x1C00; i++) if (g_flash[i] != 0xFF) return false; return true; }
static void run(int maxPhase) {                                              // un téléchargement de frame : marques 1 … maxPhase
  POD_FF_START("x");
  for (int n = 2; n <= maxPhase; n++) { if (n == 15) { POD_FF_MARK(15, "x"); POD_FF_STOP(); } else POD_FF_MARK(n, "x"); }
  if (maxPhase < 15) g_podFfPhase = 0;
}
static uint8_t at(int off) { return g_flash[0x1C00 + off]; }

int main() {
  // S1 : bloc vierge -> aucun journal valide, armement, relecture
  reset(); podFfBoot();
  CHECK(has("AUCUN journal valide"), "S1 premier lancement");
  CHECK(has("FFLOG arme : gen=1") && has("ecriture + relecture OK"), "S1 armement et relecture");
  CHECK(at(0) == 'F' && at(1) == 'F' && at(2) == 'L' && at(3) == '3' && at(4) == 1 && at(5) == 0xFE, "S1 en-tete");
  CHECK(at(8) == 0x0F && at(9) == 0xFF, "S1 marqueur d'armement 0 = 0x0F");
  CHECK(g_erases == 1 && g_podFfPos == 9 && Serial.out == "Z", "S1 un effacement, position 9, jeton de controle Z");
  CHECK(has("jeton serie de controle Z ecrit"), "S1 jeton rapporte");
  CHECK(g_outsideWrites == 0 && block0Intact(), "S1 etancheite du bloc 7");

  // S2 : téléchargement complet (15 phases) puis redémarrage
  run(15);
  CHECK(g_podFfPos == 24, "S2 15 entrees apres l'armement");
  for (int n = 1; n <= 15; n++) CHECK(at(8 + n) == (uint8_t)((n << 4) | (~n & 0x0F)), "S2 entree n = n<<4 | ~n");
  CHECK(Serial.out == "ZDEFGHIJKLMN", "S2 jetons serie d'un octet pour les seules phases 4 a 14");
  g_log.clear(); podFfBoot();
  CHECK(has("gen=1 ; 16 entrees ; DERNIERE PHASE 15 (retour de podNetRun)") && has(": 0123456789abcdef"), "S2 rapport complet");
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
  // S5b : en-tête valide mais entrées aléatoires / octets invalides : lecture bornée, pas de plantage
  for (unsigned seed = 1; seed <= 40; seed++) {
    reset(); podFfBoot(); unsigned s = seed * 2246822519u; int n = 0; for (int i = 9; i < 1024 && n < 700; i++, n++) { s = s * 1664525u + 1013904223u; uint8_t v = (uint8_t)(s >> 24); if (v == 0xFF) v = 0xFE; g_flash[0x1C00 + i] = v; }
    g_log.clear(); podFfBoot();
    CHECK(has("FFLOG demarrage precedent") && has("FFLOG arme"), "S5b entrees aleatoires");
    CHECK(g_outsideWrites == 0, "S5b etancheite");
  }
  // S6 : écriture interrompue (octet invalide) au milieu du journal
  reset(); podFfBoot(); run(2); { g_flash[0x1C00 + 10] &= 0x2C; } g_log.clear(); podFfBoot();     // entree 3 (phase 2 = 0x2D) remplacee par 0x2C ou 0x3E... octet invalide
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
  CHECK(has("DERNIERE PHASE 4") && has("0123!") == false && has("01234!"), "S9 glyphe ! dans la sequence");

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

  if (g_failed != 0) { std::printf("FAIL %d/%d\n", g_failed, g_checks); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
