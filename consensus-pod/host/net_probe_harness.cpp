// host/net_probe_harness.cpp — LOT8B2B2-NETSTACK-FIX3 : sondes de phase de PodNet (POD_NET_PROBE) — ordre des phases et mémorisation de la PREMIÈRE phase fautive dans PodNetInfo::pad[0].
//   net_probe_harness  →  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// Le marqueur de pile est simulé par un mot g_marker ; le « destructeur » le détruit quand la phase g_destroyAt est atteinte. La sonde (comme celle du sketch) ne fait QUE lire ce mot et écrire pad[0] si vide.
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

static const uint32_t MAGIC = 0x434E5259UL;
static volatile uint32_t g_marker = MAGIC;
static int g_destroyAt = 0;
static std::vector<int> g_seen;
static bool g_freed = false, g_wiped = false;
static int g_freedAtProbe[10], g_wipedAtProbe[10];
static void afterWipeHook(const uint8_t*, size_t) { g_wiped = true; }
#define free(p) (g_freed = true, std::free(p))   // observe le moment du free() (après <cstdlib> : la déclaration standard n'est pas touchée)
static inline void probe(uint8_t* slot, uint8_t phase) {
  g_seen.push_back(phase);
  if (phase < 10) { g_freedAtProbe[phase] = g_freed; g_wipedAtProbe[phase] = g_wiped; }
  if (phase == g_destroyAt) g_marker = 0x0001D805UL;           // « le code de cette phase a écrit sur le marqueur »
  if (*slot == 0 && g_marker != MAGIC) *slot = phase;           // même logique que le sketch : lecture d'un mot, première phase seulement
}
#define POD_NET_PROBE(I, n) probe((I)->pad, (n))
#define POD_NET_HOST_TEST 1
#include "../src/adapters/podNetStack.h"
#undef free

static int g_pass = 0, g_fail = 0;
static void expect(const std::string& name, bool ok) { if (ok) g_pass++; else { g_fail++; std::printf("ÉCART : %s\n", name.c_str()); } }
static void fnNop(void*) {}

int main() {
  for (int k = 0; k <= 8; k++) {
    g_marker = MAGIC; g_destroyAt = k; g_seen.clear(); g_freed = false; g_wiped = false; podNetTestAfterWipe = afterWipeHook;
    PodNetInfo ni; auto tx = [&]() { fnNop(nullptr); };
    const bool ok = podNetRun(tx, &ni);
    expect("phase " + std::to_string(k) + " : la sonde 6 voit la zone effacée et NON libérée, la sonde 7 voit la zone libérée", g_wipedAtProbe[6] == 1 && g_freedAtProbe[6] == 0 && g_freedAtProbe[7] == 1 && g_freedAtProbe[5] == 0 && g_wipedAtProbe[5] == 0);
    const std::vector<int> expectSeq = { 1, 2, 3, 4, 5, 6, 7, 8 };
    expect("phase " + std::to_string(k) + " : les 8 phases sont visitées dans l'ordre", g_seen == expectSeq);
    expect("phase " + std::to_string(k) + " : la transaction réussit (les sondes ne changent pas le résultat)", ok && ni.err == POD_NET_OK);
    expect("phase " + std::to_string(k) + " : première phase fautive mémorisée = " + std::to_string(k), ni.pad[0] == k);
  }
  // marqueur déjà détruit AVANT l'appel (cause antérieure à PodNet) : la phase 1 (entrée) le désigne
  g_marker = 0; g_destroyAt = 0; { PodNetInfo ni; auto tx = [&]() {}; podNetRun(tx, &ni); expect("marqueur détruit avant l'entrée : phase 1", ni.pad[0] == 1); }
  // première phase seulement : une destruction en phase 3 n'est pas écrasée par les phases suivantes
  g_marker = MAGIC; g_destroyAt = 3; { PodNetInfo ni; auto tx = [&]() {}; podNetRun(tx, &ni); expect("phase 3 conservée malgré les phases 4 à 8", ni.pad[0] == 3); }
  // échec avant exécution (NOMEM) : seule la phase 1 est visitée
  g_marker = MAGIC; g_destroyAt = 0; g_seen.clear(); podNetTestFailAlloc = 1; { PodNetInfo ni; auto tx = [&]() {}; const bool ok = podNetRun(tx, &ni); podNetTestFailAlloc = 0;
    expect("NOMEM : fn non exécutée, phases 1 puis 8 seulement", !ok && g_seen == std::vector<int>({ 1, 8 })); }
  // la sonde est neutre : sans destruction, pad[0] reste 0
  g_marker = MAGIC; g_destroyAt = 0; { PodNetInfo ni; auto tx = [&]() {}; podNetRun(tx, &ni); expect("aucune destruction : pad[0] == 0", ni.pad[0] == 0); }
  if (g_fail) std::printf("FAIL %d écarts / %d vérifications\n", g_fail, g_pass + g_fail); else std::printf("PASS %d\n", g_pass);
  return g_fail ? 1 : 0;
}
