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
#define HIST_NONE (-0x7FFFFFFF - 1)                  // colonne sans valeur dans une courbe lissée (avant le premier point ou après le dernier)
/**
 * Courbe CONTINUE et LISSÉE à partir d'une série binée : les colonnes vides situées ENTRE deux points connus sont rejointes par une droite (la courbe ne devient plus un semis de points),
 * puis un lissage 1-2-3-2-1 (renormalisé aux bords) adoucit le bruit. Avant le premier point et après le dernier : HIST_NONE (rien n'est inventé). Retourne le nombre de colonnes garnies d'origine.
 * Les extrêmes affichés restent ceux des VRAIES moyennes (histMinMax) : le lissage ne change que le tracé.
 */
static int histSmoothCurve(const HistSeries& p, int32_t out[HIST_BUCKETS]) {
  int32_t raw[HIST_BUCKETS]; int have = 0, first = -1, last = -1;
  for (int i = 0; i < HIST_BUCKETS; i++) { if (p.n[i]) { raw[i] = p.s[i] / p.n[i]; have++; if (first < 0) first = i; last = i; } else raw[i] = HIST_NONE; }
  for (int i = 0; i < HIST_BUCKETS; i++) out[i] = HIST_NONE;
  if (have == 0) return 0;
  int prev = first;
  for (int i = first + 1; i <= last; i++) {
    if (raw[i] == HIST_NONE) continue;
    for (int k = prev + 1; k < i; k++) raw[k] = raw[prev] + (int32_t)((int64_t)(raw[i] - raw[prev]) * (k - prev) / (i - prev));
    prev = i;
  }
  static const int w[5] = {1, 2, 3, 2, 1};
  for (int i = first; i <= last; i++) {
    int64_t sum = 0; int wt = 0;
    for (int d = -2; d <= 2; d++) { const int j = i + d; if (j < first || j > last) continue; sum += (int64_t)raw[j] * w[d + 2]; wt += w[d + 2]; }
    out[i] = (int32_t)(sum / wt);
  }
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

// ─── Échelle de temps des courbes (29/10/2026) : traits verticaux et repères, en HEURE LOCALE ────────────────────────────────────────────────────
// La carte n'a que l'heure UTC du module Wi-Fi (NTP). Heure locale = UTC + HIST_TZ_STD_SEC, +1 h entre le dernier dimanche de mars et le dernier dimanche d'octobre à 01:00 UTC (règle européenne).
// Défaut : France (UTC+1, heure d'été comprise). Autre fuseau : -DHIST_TZ_STD_SEC=… (secondes) ; -DHIST_TZ_EU_DST=0 pour couper l'heure d'été. Fonctions pures, testées sur l'hôte.
#ifndef HIST_TZ_STD_SEC
#define HIST_TZ_STD_SEC 3600
#endif
#ifndef HIST_TZ_EU_DST
#define HIST_TZ_EU_DST 1
#endif
/** Jours depuis 1970-01-01 d'une date civile (H. Hinnant, m 1..12). */
static int32_t histDays(int y, int m, int d) {
  y -= m <= 2 ? 1 : 0;
  const int32_t era = (y >= 0 ? y : y - 399) / 400;
  const uint32_t yoe = (uint32_t)(y - era * 400);
  const uint32_t doy = (153u * (uint32_t)(m > 2 ? m - 3 : m + 9) + 2u) / 5u + (uint32_t)d - 1u;
  const uint32_t doe = yoe * 365u + yoe / 4u - yoe / 100u + doy;
  return era * 146097 + (int32_t)doe - 719468;
}
/** Date civile d'un nombre de jours depuis 1970 (jour du mois en d). */
static void histCivil(int32_t days, int& y, int& m, int& d) {
  const int32_t z = days + 719468;
  const int32_t era = (z >= 0 ? z : z - 146096) / 146097;
  const uint32_t doe = (uint32_t)(z - era * 146097);
  const uint32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const uint32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const uint32_t mp = (5 * doy + 2) / 153;
  d = (int)(doy - (153 * mp + 2) / 5 + 1);
  m = (int)(mp < 10 ? mp + 3 : mp - 9);
  y = (int)yoe + (int)(era * 400) + (m <= 2 ? 1 : 0);
}
/** Jour de la semaine d'un nombre de jours depuis 1970 : 0 = dimanche … 6 = samedi. */
static int histWeekday(int32_t days) { return (int)(((days % 7) + 7 + 4) % 7); }
/** Écart local - UTC, en secondes, à l'instant UTC t (multiple de 3600). */
static int32_t histLocalOffset(uint32_t t) {
#if HIST_TZ_EU_DST
  int y, m, d; histCivil((int32_t)(t / 86400UL), y, m, d);
  const int32_t m31 = histDays(y, 3, 31), o31 = histDays(y, 10, 31);
  const uint32_t start = (uint32_t)(m31 - histWeekday(m31)) * 86400UL + 3600UL;     // dernier dimanche de mars, 01:00 UTC
  const uint32_t end = (uint32_t)(o31 - histWeekday(o31)) * 86400UL + 3600UL;       // dernier dimanche d'octobre, 01:00 UTC
  if (t >= start && t < end) return HIST_TZ_STD_SEC + 3600;
#endif
  return HIST_TZ_STD_SEC;
}
/** Un repère de l'axe du temps : colonne (0 .. HIST_BUCKETS-1, la MÊME formule que le classement des relevés), importance, nombre à écrire dessous (-1 = aucun). */
struct HistTick { uint8_t col; uint8_t level; int8_t num; };      // level 0 = trait fin, 1 = trait moyen, 2 = trait fort (00 h et 12 h ; lundi ; 1er du mois)
typedef void (*HistTickFn)(void* ctx, const HistTick& tk);
/** Plage tracée par une courbe (t0 = premier instant UTC, span = largeur en secondes) et présence des nombres sous l'axe ; HistTickCtx : contexte du rappel de tracé (types ici : le générateur de prototypes de l'IDE les place avant le .ino). */
struct HistAxis { uint32_t t0, span; bool labels; };
struct HistTickCtx { int x0, y0, ph; bool labels; };
static uint8_t histTickCol(uint32_t u, uint32_t t0, uint32_t span) { const uint32_t c = (uint32_t)(((uint64_t)(u - t0) * HIST_BUCKETS) / span); return (uint8_t)(c >= HIST_BUCKETS ? HIST_BUCKETS - 1 : c); }
/**
 * Repères de l'axe du temps sur [t0, t0 + span) (UTC), appelés dans l'ordre chronologique, SANS tableau (une pile de 2 560 o sert déjà au tracé) :
 *  • plage ≤ 48 h  : un trait PAR HEURE ; fort à 00 h et 12 h, moyen à 06 h et 18 h ; nombre (l'heure) tous les 1, 2, 3, 6 ou 12 h selon la place (≥ 20 px entre deux nombres) ;
 *  • plage ≤ 10 j  : un trait par minuit (fort le lundi) ; nombre = jour du mois, à chaque jour si la place le permet, sinon aux seuls lundis ;
 *  • au-delà       : un trait par lundi (fin) si la plage ≤ 100 j, un trait fort au 1er de chaque mois, nombre = mois (tous les 1, 2, 3, 6 ou 12 mois selon la place).
 * Retourne le nombre de repères émis. span = 0 : aucun.
 */
static int histTicks(uint32_t t0, uint32_t span, HistTickFn fn, void* ctx) {
  if (span == 0) return 0;
  int n = 0; HistTick tk;
  if (span <= 48UL * 3600UL) {
    const uint32_t pxH10 = (uint32_t)(((uint64_t)HIST_BUCKETS * 3600ULL * 10ULL) / span);       // pixels par heure ×10
    static const uint8_t steps[5] = {1, 2, 3, 6, 12};
    uint8_t step = 12; for (int i = 0; i < 5; i++) if (pxH10 * steps[i] >= 200) { step = steps[i]; break; }
    for (uint32_t u = ((t0 + 3599UL) / 3600UL) * 3600UL; u < t0 + span; u += 3600UL) {
      const int h = (int)(((u + (uint32_t)histLocalOffset(u)) / 3600UL) % 24UL);
      tk.col = histTickCol(u, t0, span);
      tk.level = (h % 12 == 0) ? 2 : ((h % 6 == 0) ? 1 : 0);
      tk.num = (h % step == 0) ? (int8_t)h : (int8_t)-1;
      fn(ctx, tk); n++;
    }
    return n;
  }
  const bool daily = span <= 10UL * 86400UL;
  const uint32_t pxD10 = (uint32_t)(((uint64_t)HIST_BUCKETS * 86400ULL * 10ULL) / span);       // pixels par jour ×10
  const uint32_t pxM10 = (uint32_t)(((uint64_t)HIST_BUCKETS * 2592000ULL * 10ULL) / span);     // pixels par mois (30 j) ×10
  static const uint8_t msteps[5] = {1, 2, 3, 6, 12};
  uint8_t mstep = 12; for (int i = 0; i < 5; i++) if (pxM10 * msteps[i] >= 200) { mstep = msteps[i]; break; }
  int32_t d0 = (int32_t)((t0 + (uint32_t)HIST_TZ_STD_SEC) / 86400UL);
  for (int32_t day = d0 - 1; ; day++) {
    const uint32_t u = (uint32_t)day * 86400UL - (uint32_t)histLocalOffset((uint32_t)day * 86400UL - 3600UL);    // minuit local de ce jour (en UTC)
    if (u < t0) continue;
    if (u >= t0 + span) break;
    int y, m, dm; histCivil(day, y, m, dm);
    const int wd = histWeekday(day);
    tk.col = histTickCol(u, t0, span);
    if (daily) {
      tk.level = wd == 1 ? 2 : 1;
      tk.num = (pxD10 >= 200 || wd == 1) ? (int8_t)dm : (int8_t)-1;
    } else if (dm == 1) {
      tk.level = 2;
      tk.num = ((m - 1) % mstep == 0) ? (int8_t)m : (int8_t)-1;
    } else if (wd == 1 && span <= 100UL * 86400UL) {
      tk.level = 0; tk.num = -1;
    } else continue;
    fn(ctx, tk); n++;
  }
  return n;
}

#endif  // POD_HIST_H
