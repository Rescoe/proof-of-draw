// hist_harness.cpp — vérifie pod_hist.h (historique des mesures de la station R4) sur l'hôte : date civile, nom de fichier mensuel, enregistrement de 10 octets, statistiques, durées courtes.
// Lit des epochs en arguments et écrit « epoch année mois nom » ; puis des lignes SLOPE / AGE ; « RT ok » si toutes les vérifications internes passent.
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
  const uint8_t expect[HIST_REC] = {0x00, 0xE2, 0xFF, 0x68, 0x85, 0xFF, 0x33, 0x03, 0x53, 0x81};   // 1761600000 = 0x68FFE200 ; -123 = 0xFF85 ; 819 = 0x0333 ; 33107 = 0x8153
  if (std::memcmp(o, expect, HIST_REC) != 0) ok = false;

  // statistiques : rampe de 10 unites par colonne -> pente 10 000 milliemes ; colonnes vides ignorees ; moins de 4 points -> refus
  HistSeries ramp; std::memset(&ramp, 0, sizeof(ramp));
  for (int i = 0; i < HIST_BUCKETS; i++) { ramp.s[i] = i * 10 * 3; ramp.n[i] = 3; }
  int64_t sl = 0;
  bool okS = histSlope(ramp, 0, HIST_BUCKETS, &sl);
  if (!okS || sl != 10000) ok = false;
  std::printf("SLOPE %lld\n", (long long)sl);
  HistSeries sparse; std::memset(&sparse, 0, sizeof(sparse));
  for (int i = 0; i < HIST_BUCKETS; i += 4) { sparse.s[i] = 500 + i; sparse.n[i] = 1; }
  okS = histSlope(sparse, 0, HIST_BUCKETS, &sl);
  if (!okS || sl != 1000) ok = false;                          // valeur = 500 + colonne : pente 1 par colonne
  if (histSlope(sparse, 0, 10, &sl)) ok = false;               // 3 colonnes garnies seulement : refuse
  int32_t mean = 0;
  if (!histMean(ramp, 0, 10, &mean) || mean != 45) ok = false; // moyenne de 0, 10, ..., 90
  if (histMean(sparse, 1, 4, &mean)) ok = false;               // aucune valeur dans [1, 4)
  int32_t lo = 0, hi = 0;
  if (histMinMax(ramp, &lo, &hi) != HIST_BUCKETS || lo != 0 || hi != 950) ok = false;
  char a[20];
  const uint32_t ages[] = {0, 59, 60, 2699, 3599, 3600, 7800, 172799, 172800, 86400UL * 30};
  for (uint32_t s : ages) { histFmtAge(a, s); std::printf("AGE %lu %s\n", (unsigned long)s, a); }
  std::printf(ok ? "RT ok\n" : "RT ECHEC\n");
  return ok ? 0 : 1;
}
