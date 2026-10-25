// consensus-pod/host/civil_harness.cpp — harnais hôte de esp8266/_shared/pod_civil.h : lit des secondes sur l'entrée standard et écrit « JJ/MM HH:MM » (code RÉEL du firmware).
#include <cstdio>
#include <cstdlib>
#include "pod_civil.h"

int main() {
  char line[64], out[16];
  while (std::fgets(line, sizeof line, stdin)) {
    const unsigned long long v = std::strtoull(line, nullptr, 10);
    if (podcivil::formatShort((uint32_t)v, out)) std::printf("%s\n", out); else std::printf("-\n");
  }
  return 0;
}
