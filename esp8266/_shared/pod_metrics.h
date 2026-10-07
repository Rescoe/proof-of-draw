// pod_metrics.h — « pod-metrics-2 » : métriques de complexité visuelle EN FLUX, en calcul ENTIER (aucun float, aucun log à l'exécution).
// Miroir exact de lib/podMetrics.ts (serveur) : mêmes entrées ⇒ mêmes sorties au ppm près (test différentiel : tests/podMetrics.test.ts, g++).
//
// MÉMOIRE : aucun tampon d'image. Compteurs + une ligne (≤ 240 octets). Seuls l'OLED (page-major : 1 024 o) et l'e-ink 2,9″ (noir lu en entier
// avant le rouge : 4 736 o) demandent un tampon « scratch » fourni par l'appelant (statique, ou alloué APRÈS la fermeture de TLS comme les tampons pixel).
// UTILISATION (firmware) : begin(kind, scratch, len) ; feed(chunk) pour chaque morceau lu sur le flux HTTP (octets BRUTS du contenu, dans l'ordre
// de GET /api/candidate-frame) ; finish(&m). Le SHA-256 du même flux se calcule en parallèle (br_sha256_update) — voir la phase P3 du chantier.
// Spécification : docs/CHANTIER_VALIDATION_REELLE.md § 5.2. Ne pas modifier sans incrémenter METRICS_VERSION côté serveur.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "pod_metrics_table.h"

#ifdef ARDUINO
  #define POD_TABLE(q) pgm_read_dword(&POD_ENTROPY_TABLE[(q)])
#else
  #define POD_TABLE(q) (POD_ENTROPY_TABLE[(q)])
#endif

#define POD_METRICS_VERSION 2
#define POD_MAX_W 240

struct PodMetricsOut { uint32_t e, t, r, s; };   // ppm

static inline uint32_t pod_isqrt64(uint64_t v) {
  uint64_t res = 0, bit = (uint64_t)1 << 62;
  while (bit > v) bit >>= 2;
  while (bit) {
    if (v >= res + bit) { v -= res + bit; res = (res >> 1) + bit; } else { res >>= 1; }
    bit >>= 2;
  }
  return (uint32_t)res;
}

static inline uint64_t pod_div_round(uint64_t a, uint64_t b) { return (a + b / 2) / b; }

class PodMetrics {
 public:
  void begin(uint16_t w, uint16_t h) {
    // Dimensions invalides (0, ou largeur > POD_MAX_W = taille du tampon de ligne) : AUCUNE écriture ne sera faite (push() sans effet), finish() renvoie false.
    bad_ = (w == 0 || h == 0 || w > POD_MAX_W);
    w_ = bad_ ? 0 : w; h_ = bad_ ? 0 : h; x_ = 0; y_ = 0; last_ = 0; ones_ = 0; runs_ = 1; trans_ = 0; count_ = 0;
    memset(row_, 0, sizeof(row_));
  }
  void push(uint8_t a) {
    if (bad_ || w_ == 0 || x_ >= w_) return;   // garde mémoire : x_ < w_ <= POD_MAX_W = taille de row_
    uint8_t v = a ? 1 : 0;
    ones_ += v;
    if (count_ > 0 && v != last_) runs_++;
    if (x_ > 0 && v != last_) trans_++;
    if (y_ > 0 && v != row_[x_]) trans_++;
    row_[x_] = v;
    last_ = v;
    count_++;
    if (++x_ == w_) { x_ = 0; y_++; }
  }
  bool finish(PodMetricsOut* out) const {
    uint64_t n = (uint64_t)w_ * h_;
    if (bad_ || w_ == 0 || h_ == 0 || w_ > POD_MAX_W || count_ != n) return false;
    uint64_t total = (uint64_t)(w_ - 1) * h_ + (uint64_t)w_ * (h_ - 1);
    uint32_t q = (uint32_t)pod_div_round(1024ULL * ones_, n);
    uint32_t e = POD_TABLE(q);
    uint32_t t = total ? (uint32_t)pod_div_round(1000000ULL * trans_, total) : 0;
    uint32_t r = pod_isqrt64(pod_div_round(1000000000000ULL * runs_, n));
    uint64_t s = (4ULL * e + 4ULL * t + 2ULL * r) / 10;
    if (s > 1000000ULL) s = 1000000ULL;
    out->e = e; out->t = t; out->r = r; out->s = (uint32_t)s;
    return true;
  }
 private:
  uint16_t w_ = 0, h_ = 0, x_ = 0, y_ = 0;
  bool bad_ = false;
  uint8_t last_ = 0;
  uint8_t row_[POD_MAX_W];
  uint32_t ones_ = 0, runs_ = 1, trans_ = 0;
  uint64_t count_ = 0;
};

// ─── Lecture par type d'écran (géométrie et conventions FIGÉES, identiques à lib/podMetrics.ts) ────────────────────────────────────────────────

enum PodScreenKind { POD_OLED096 = 0, POD_EINK27BW = 1, POD_EINK29BWR = 2, POD_TFT18 = 3, POD_TFT28 = 4 };

class PodFeeder {
 public:
  // scratch : OLED ≥ 1 024 o ; EINK29BWR ≥ 4 736 o ; inutile (NULL) pour EINK27BW, TFT18, TFT28. Retourne false si le tampon est insuffisant.
  bool begin(PodScreenKind k, uint8_t* scratch, size_t scratchLen) {
    kind_ = k; scratch_ = scratch; pos_ = 0; have_ = false; lo_ = 0;
    switch (k) {
      case POD_OLED096:   w_ = 128; h_ = 64;  raw_ = 1024;   need_ = 1024; break;
      case POD_EINK27BW:  w_ = 176; h_ = 264; raw_ = 5808;   need_ = 0;    break;
      case POD_EINK29BWR: w_ = 128; h_ = 296; raw_ = 9472;   need_ = 4736; break;
      case POD_TFT18:     w_ = 128; h_ = 160; raw_ = 40960;  need_ = 0;    break;
      case POD_TFT28:     w_ = 240; h_ = 320; raw_ = 153600; need_ = 0;    break;
      default: return false;
    }
    if (need_ && (!scratch || scratchLen < need_)) return false;
    m_.begin(w_, h_);
    return true;
  }
  size_t rawBytes() const { return raw_; }
  size_t received() const { return pos_; }

  void feed(const uint8_t* d, size_t n) {
    for (size_t i = 0; i < n && pos_ < raw_; i++, pos_++) {
      uint8_t b = d[i];
      switch (kind_) {
        case POD_EINK27BW:
          for (int s = 7; s >= 0; s--) m_.push(((b >> s) & 1) == 0);
          break;
        case POD_TFT18:
        case POD_TFT28:
          if (!have_) { lo_ = b; have_ = true; }
          else { m_.push((uint16_t)(lo_ | ((uint16_t)b << 8)) != 0xFFFF); have_ = false; }
          break;
        case POD_OLED096:
          scratch_[pos_] = b;   // page-major : on attend le tampon complet (1 024 o)
          break;
        case POD_EINK29BWR:
          if (pos_ < 4736) scratch_[pos_] = b;                       // canal noir d'abord…
          else {                                                       // …puis le rouge, combiné au noir de même rang
            uint8_t black = scratch_[pos_ - 4736];
            for (int s = 7; s >= 0; s--) m_.push(((black >> s) & 1) == 0 || ((b >> s) & 1) == 0);
          }
          break;
      }
    }
  }

  bool finish(PodMetricsOut* out) {
    if (pos_ != raw_) return false;
    if (kind_ == POD_OLED096) {
      for (int y = 0; y < 64; y++)
        for (int x = 0; x < 128; x++) m_.push((scratch_[(y >> 3) * 128 + x] >> (y & 7)) & 1);
    }
    return m_.finish(out);
  }

 private:
  PodMetrics m_;
  PodScreenKind kind_ = POD_OLED096;
  uint8_t* scratch_ = 0;
  uint16_t w_ = 0, h_ = 0;
  size_t raw_ = 0, need_ = 0, pos_ = 0;
  bool have_ = false;
  uint8_t lo_ = 0;
};
