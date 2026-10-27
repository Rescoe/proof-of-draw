// tft_blank_harness.cpp — LOT 3 (28/10/2026) : le « blank » d'un candidat TFT. Compile le VRAI pod_metrics.h (celui des firmwares) et lit des contenus RGB565 bruts (fichiers hexadécimaux) :
//   tft_blank_harness <kind 3|4> <fichier.hex> ...   ->   une ligne par fichier : « e t r s uniforme » (uniforme = 1 si CHAQUE pixel RGB565 est identique, PodFeeder::isUniformTft()).
// Utilisé par tests/tftBlankVerdict.test.ts (différentiel contre lib/podMetrics.ts).
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <fstream>
#include <string>
#include <iterator>
#include "../src/pod_metrics.h"

int main(int argc, char** argv) {
  if (argc < 3) return 2;
  const int kind = std::atoi(argv[1]);
  for (int a = 2; a < argc; a++) {
    std::ifstream f(argv[a]);
    std::string hex((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    std::vector<uint8_t> raw;
    for (size_t i = 0; i + 1 < hex.size(); i += 2) raw.push_back((uint8_t)std::strtoul(hex.substr(i, 2).c_str(), nullptr, 16));
    PodFeeder feeder;
    if (!feeder.begin((PodScreenKind)kind, nullptr, 0)) { std::printf("ERR begin\n"); return 1; }
    for (size_t i = 0; i < raw.size(); i += 256) feeder.feed(&raw[i], (i + 256 <= raw.size()) ? 256 : raw.size() - i);
    PodMetricsOut m;
    const bool uniform = feeder.isUniformTft();
    if (!feeder.finish(&m)) { std::printf("ERR finish\n"); return 1; }
    std::printf("%u %u %u %u %d\n", m.e, m.t, m.r, m.s, uniform ? 1 : 0);
  }
  return 0;
}
