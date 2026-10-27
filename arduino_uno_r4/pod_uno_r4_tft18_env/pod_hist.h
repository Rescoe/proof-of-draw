// pod_hist.h — historique des mesures de la station R4 (28/10/2026) : fonctions PURES (aucune dépendance Arduino), testées sur l'hôte par tests/stationHistory.test.ts.
// Les types sont dans un en-tête parce que le générateur de prototypes de l'IDE Arduino place les prototypes AVANT les struct définies dans le .ino.
// Enregistrement de 10 octets, petit-boutiste : { uint32 t (epoch s), int16 température ×10 (−32768 = absente), uint16 humidité ×10 (0xFFFF = absente), uint16 INDICE COV Sensirion 1..500 (0 = absent) }.
// Fichiers « v » (format 2 : le champ COV est l'indice Sensirion, plus les ticks bruts des premiers essais du 28/10/2026 matin, rangés dans les fichiers « d » / h.bin, ignorés).
#ifndef POD_HIST_H
#define POD_HIST_H
#include <stdint.h>

#define HIST_REC           10
#define HIST_INTERVAL_MS   300000UL                 // 5 min
#define HIST_BUCKETS       96                       // largeur du tracé en pixels
#define HIST_KEEP_MONTHS   14
#define HIST_FILE_HOURLY   "/pod18/vh.bin"
struct HistRec { uint32_t t; int16_t t10; uint16_t h10; uint16_t voc; };
/** UNE série binée sur HIST_BUCKETS colonnes : somme et nombre de valeurs de chaque colonne. */
struct HistSeries { int32_t s[HIST_BUCKETS]; uint16_t n[HIST_BUCKETS]; };
/** Trois séries (température, humidité, COV) pour la page de synthèse. */
struct HistPlot { HistSeries t, h, v; };

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
  out[0] = '/'; out[1] = 'p'; out[2] = 'o'; out[3] = 'd'; out[4] = '1'; out[5] = '8'; out[6] = '/'; out[7] = 'v';
  out[8] = (char)('0' + (y / 10) % 10); out[9] = (char)('0' + y % 10); out[10] = (char)('0' + m / 10); out[11] = (char)('0' + m % 10);
  out[12] = '.'; out[13] = 'b'; out[14] = 'i'; out[15] = 'n'; out[16] = 0;
}

// ─── Statistiques sur une série binée (entiers seulement) ───────────────────────────────────────────────────────────────────────────────────────
/** Moyenne (arrondie vers zéro) des colonnes [a, b) qui portent des valeurs ; false si aucune. */
static bool histMean(const HistSeries& p, int a, int b, int32_t* mean) {
  int64_t sum = 0; int64_t cnt = 0;
  for (int i = a < 0 ? 0 : a; i < b && i < HIST_BUCKETS; i++) if (p.n[i]) { sum += p.s[i] / p.n[i]; cnt++; }
  if (!cnt) return false;
  *mean = (int32_t)(sum / cnt);
  return true;
}
/** Minimum et maximum des moyennes de colonnes ; nombre de colonnes garnies en retour. */
static int histMinMax(const HistSeries& p, int32_t* lo, int32_t* hi) {
  int have = 0; int32_t mn = 0x7FFFFFFF, mx = -0x7FFFFFFF;
  for (int i = 0; i < HIST_BUCKETS; i++) if (p.n[i]) { const int32_t v = p.s[i] / p.n[i]; if (v < mn) mn = v; if (v > mx) mx = v; have++; }
  *lo = mn; *hi = mx;
  return have;
}
/**
 * Pente par moindres carrés des colonnes [a, b) (au moins 4 colonnes garnies), en CENTIÈMES d'unité par colonne ×… renvoyée en millièmes d'unité PAR COLONNE : slopeMilli.
 * Pour l'exprimer par heure : slopeMilli * 3600 / binSec / 1000.
 */
static bool histSlope(const HistSeries& p, int a, int b, int64_t* slopeMilli) {
  int64_t n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;   // y en unités ×1000 pour garder la précision
  for (int i = a < 0 ? 0 : a; i < b && i < HIST_BUCKETS; i++) {
    if (!p.n[i]) continue;
    const int64_t y = (int64_t)p.s[i] * 1000 / p.n[i], x = i;
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  if (n < 4) return false;
  const int64_t den = n * sxx - sx * sx;
  if (den == 0) return false;
  *slopeMilli = (n * sxy - sx * sy) / den;
  return true;
}
static int histPutU(char* o, uint32_t v) {   // décimal sans zéro initial ; retourne le nombre de caractères écrits
  char t[10]; int k = 0, n = 0;
  do { t[k++] = (char)('0' + v % 10); v /= 10; } while (v);
  while (k) o[n++] = t[--k];
  return n;
}
/** « 35 min », « 2h10 », « 3 j » : durée courte pour l'étiquette d'un tracé (sec ≥ 0). */
static void histFmtAge(char* o, uint32_t sec) {
  int n = 0;
  if (sec < 3600UL) { n += histPutU(o + n, sec / 60UL < 1 ? 1 : sec / 60UL); o[n++] = ' '; o[n++] = 'm'; o[n++] = 'i'; o[n++] = 'n'; }
  else if (sec < 48UL * 3600UL) { n += histPutU(o + n, sec / 3600UL); const uint32_t m = (sec % 3600UL) / 60UL; o[n++] = 'h'; o[n++] = (char)('0' + m / 10); o[n++] = (char)('0' + m % 10); }
  else { n += histPutU(o + n, sec / 86400UL); o[n++] = ' '; o[n++] = 'j'; }
  o[n] = 0;
}

#endif  // POD_HIST_H
