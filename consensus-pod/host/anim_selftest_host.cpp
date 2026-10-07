// host/anim_selftest_host.cpp — exécute sur le PC EXACTEMENT l'auto-test des exemples AnimSelfTestEsp8266 / AnimSelfTestUnoR4 (même fichier : src/podAnimSelfTest.h, même noyau, mêmes clips et
// valeurs attendues générés par la référence TypeScript), avec l'adaptateur SHA-256 portable du PC.
//   anim_selftest_host            →  code 0 et « [ANIMTEST] RESULTAT PASS 36/36 » si tout est conforme ; sinon code 1
//   anim_selftest_host --bench    →  ajoute des temps HÔTE (PC) : ⚠ PAS une mesure de carte
#include <chrono>
#include <cstdio>
#include <cstring>
#include "../src/podAnimSelfTest.h"
#include "../src/adapters/crypto_posix.h"

typedef PodSha256Host Sha;
static PodAnimTestWork<Sha> W;   // objet unique, hors pile (comme sur l'UNO R4)

static void sink(const char* line) { std::puts(line); }
static uint32_t clockUs() { return (uint32_t)std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }

int main(int argc, char** argv) {
  const bool bench = argc > 1 && std::strcmp(argv[1], "--bench") == 0;
  static char line[160];
  pod_anim_selftest_sizes<Sha>(sink, line, sizeof(line));
  const int pass = pod_anim_selftest_run<Sha>(&W, sink, bench ? clockUs : 0);
  return pass == POD_ANIMTEST_COUNT * 4 ? 0 : 1;
}
