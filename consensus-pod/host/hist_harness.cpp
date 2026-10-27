// hist_harness.cpp — vérifie pod_hist.h (historique des mesures de la station R4) sur l'hôte : date civile, nom de fichier mensuel, enregistrement de 10 octets.
// Lit des epochs en arguments et écrit « epoch année mois nom ». Sortie « RT ok » si l'aller-retour d'un enregistrement est exact.
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include "pod_hist.h"

int main(int argc, char** argv) {
  for (int i = 1; i < argc; i++) {
    const unsigned long long e = std::strtoull(argv[i], nullptr, 10);
    int y = 0, m = 0; histYm((uint32_t)e, y, m);
    char p[20]; histMonthPath(p, y, m);
    std::printf("%llu %d %d %s\n", e, y, m, p);
  }
  const HistRec in[] = { {1761600000u, -123, 819, 33107}, {4294967295u, -32768, 0xFFFF, 0}, {0u, 32767, 0, 65535} };
  bool ok = sizeof(HistRec) >= 10;
  for (const HistRec& r : in) {
    uint8_t o[HIST_REC]; histPut(o, r);
    const HistRec b = histGet(o);
    if (b.t != r.t || b.t10 != r.t10 || b.h10 != r.h10 || b.voc != r.voc) ok = false;
  }
  uint8_t o[HIST_REC]; histPut(o, in[0]);
  const uint8_t expect[HIST_REC] = {0x00, 0xE2, 0xFF, 0x68, 0x85, 0xFF, 0x33, 0x03, 0x53, 0x81};   // 1761600000 = 0x68FFE200 ; −123 = 0xFF85 ; 819 = 0x0333 ; 33107 = 0x8153
  if (std::memcmp(o, expect, HIST_REC) != 0) ok = false;
  std::printf(ok ? "RT ok\n" : "RT ECHEC\n");
  return ok ? 0 : 1;
}
