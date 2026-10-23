// Harnais PC : vote_reuse_harness <kind> <chunk> <f1.hex> <f2.hex> …  →  une ligne « e t r s » par fichier, avec UN SEUL PodFeeder STATIQUE réutilisé (comme POD_VOTE_STATIC_WORK sur le TFT 1,8″).
// Prouve qu'un feeder statique ne garde aucun état d'un vote au suivant. Utilisé par tests/voteBlankParity.test.ts.
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <fstream>
#include <string>
#include "../pod_metrics.h"

static PodFeeder feeder;   // statique, comme dans podFetchAndCheck avec POD_VOTE_STATIC_WORK
int main(int argc, char** argv) {
  if (argc < 4) return 2;
  int kind = atoi(argv[1]); size_t chunk = (size_t)atoi(argv[2]); if (chunk == 0) chunk = 1;
  for (int a = 3; a < argc; a++) {
    std::ifstream f(argv[a]); std::string hex((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    std::vector<uint8_t> raw; for (size_t i = 0; i + 1 < hex.size(); i += 2) raw.push_back((uint8_t)strtoul(hex.substr(i, 2).c_str(), 0, 16));
    static uint8_t scratch[4736];
    if (!feeder.begin((PodScreenKind)kind, scratch, sizeof(scratch))) { printf("ERR begin\n"); return 1; }
    for (size_t i = 0; i < raw.size(); i += chunk) feeder.feed(&raw[i], (i + chunk <= raw.size()) ? chunk : raw.size() - i);
    PodMetricsOut m; if (!feeder.finish(&m)) { printf("ERR finish\n"); return 1; }
    printf("%u %u %u %u\n", m.e, m.t, m.r, m.s);
  }
  return 0;
}
