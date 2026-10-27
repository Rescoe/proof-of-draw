// pod_hist.h — historique des mesures de la station R4 (28/10/2026) : fonctions PURES (aucune dépendance Arduino), testées sur l'hôte par tests/stationHistory.test.ts.
// Les types sont dans un en-tête parce que le générateur de prototypes de l'IDE Arduino place les prototypes AVANT les struct définies dans le .ino.
// Enregistrement de 10 octets, petit-boutiste : { uint32 t (epoch s), int16 température ×10 (−32768 = absente), uint16 humidité ×10 (0xFFFF = absente), uint16 ticks SGP40 (0 = absent) }.
#ifndef POD_HIST_H
#define POD_HIST_H
#include <stdint.h>

#define HIST_REC           10
#define HIST_INTERVAL_MS   300000UL                 // 5 min
#define HIST_BUCKETS       96                       // largeur du tracé en pixels
#define HIST_KEEP_MONTHS   14
#define HIST_FILE_HOURLY   "/pod18/h.bin"
struct HistRec { uint32_t t; int16_t t10; uint16_t h10; uint16_t voc; };

struct HistPlot { int32_t sT[HIST_BUCKETS], sH[HIST_BUCKETS], sV[HIST_BUCKETS]; uint16_t nT[HIST_BUCKETS], nH[HIST_BUCKETS], nV[HIST_BUCKETS]; };

static void histPut(uint8_t* o, const HistRec& r) { o[0] = r.t; o[1] = r.t >> 8; o[2] = r.t >> 16; o[3] = r.t >> 24; o[4] = (uint16_t)r.t10; o[5] = (uint16_t)r.t10 >> 8; o[6] = r.h10; o[7] = r.h10 >> 8; o[8] = r.voc; o[9] = r.voc >> 8; }
static HistRec histGet(const uint8_t* o) { HistRec r; r.t = (uint32_t)o[0] | ((uint32_t)o[1] << 8) | ((uint32_t)o[2] << 16) | ((uint32_t)o[3] << 24); r.t10 = (int16_t)(o[4] | (o[5] << 8)); r.h10 = (uint16_t)(o[6] | (o[7] << 8)); r.voc = (uint16_t)(o[8] | (o[9] << 8)); return r; }
/** Année et mois (1..12) civils UTC d'une date epoch (algorithme de H. Hinnant). */
static void histYm(uint32_t t, int& y, int& m) {
  const int32_t z = (int32_t)(t / 86400UL) + 719468;
  const int32_t era = z / 146097;
  const uint32_t doe = (uint32_t)(z - era * 146097);
  const uint32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const uint32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const uint32_t mp = (5 * doy + 2) / 153;
  m = (int)(mp < 10 ? mp + 3 : mp - 9);
  y = (int)(yoe) + (int)(era * 400) + (m <= 2 ? 1 : 0);
}
static void histMonthPath(char* out, int y, int m) {
  out[0] = '/'; out[1] = 'p'; out[2] = 'o'; out[3] = 'd'; out[4] = '1'; out[5] = '8'; out[6] = '/'; out[7] = 'd';
  out[8] = (char)('0' + (y / 10) % 10); out[9] = (char)('0' + y % 10); out[10] = (char)('0' + m / 10); out[11] = (char)('0' + m % 10);
  out[12] = '.'; out[13] = 'b'; out[14] = 'i'; out[15] = 'n'; out[16] = 0;
}

#endif  // POD_HIST_H
