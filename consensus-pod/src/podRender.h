// podRender.h — RASTERISEUR DE RÉFÉRENCE C++ du rendu final (fit + cartel) et hashes `frameHash` / `renderHash`. Lot 8A — BROUILLON INTERNE, NON PUBLIÉ.
//
// Port à l'identique de lib/renderLayout.ts (`layoutVersion = 1`), vérifié OCTET PAR OCTET contre les vecteurs d'or générés par la référence TypeScript
// (consensus-pod/test-vectors/render-vectors.txt ; consensus-pod/host/render_harness.cpp). Aucun flottant, aucune allocation, pas de String ni de STL : tous les tampons sont fournis par l'appelant.
// ⚠ VERSION HÔTE : elle travaille sur une GRILLE LOGIQUE complète (un uint16_t par pixel : 75 Ko pour l'e-ink 2,9″). C'est la définition de l'ALGORITHME, pas encore la stratégie mémoire des
// microcontrôleurs (compositeur ligne par ligne du TFT 1,8″, fit sans double tampon : lot 8B). AUCUN firmware ne l'utilise. Jamais essayé sur un écran.
#pragma once
#include "consensusPoD.h"

#define POD_RENDER_LAYOUT_VERSION 1

enum PodRenderScreen { POD_R_EINK29 = 0, POD_R_EINK27, POD_R_TFT18, POD_R_OLED96, POD_R_TFT28 };
enum PodRenderMode { POD_R_OVERLAY = 0, POD_R_FIT, POD_R_HIDDEN };

struct PodRenderSpec {
  const char* name; uint16_t w, h; uint8_t planes; bool eink; bool cartel; uint16_t top1, bot0;   // top1 : ligne du séparateur haut ; bot0 : ligne du séparateur bas
};
static inline PodRenderSpec pod_render_spec(PodRenderScreen s) {
  switch (s) {
    case POD_R_EINK29: { PodRenderSpec p = { "eink29bwr", 296, 128, 2, true, true, 13, 114 }; return p; }
    case POD_R_EINK27: { PodRenderSpec p = { "eink27bw", 264, 176, 1, true, true, 13, 162 }; return p; }
    case POD_R_TFT18:  { PodRenderSpec p = { "tft18", 128, 160, 1, false, true, 14, 146 }; return p; }
    case POD_R_OLED96: { PodRenderSpec p = { "oled096", 128, 64, 1, false, false, 0, 0 }; return p; }
    default:           { PodRenderSpec p = { "tft28", 240, 320, 1, false, false, 0, 0 }; return p; }
  }
}
/** Octets d'UN plan (tel qu'envoyé au pilote). */
static inline uint32_t pod_render_plane_bytes(const PodRenderSpec& s) {
  if (s.eink) return (uint32_t)s.w * s.h / 8;
  if (!s.cartel && s.w == 128) return 1024;   // OLED : page-major, 1 bit par pixel
  return (uint32_t)s.w * s.h * 2;             // TFT : RGB565
}
static inline uint32_t pod_render_safe0(const PodRenderSpec& s) { return (uint32_t)s.top1 + 1; }
static inline uint32_t pod_render_safe_h(const PodRenderSpec& s) { return (uint32_t)s.bot0 - 1 - (s.top1 + 1) + 1; }

// e-ink : 0 blanc, 1 noir, 2 rouge ; TFT : RGB565
#define POD_R_WHITE 0
#define POD_R_BLACK 1
#define POD_R_RED   2
#define POD_T_DARK  0x10C4
#define POD_T_GOLD  0xFEA0
#define POD_T_GREY  0x7BEF
#define POD_T_WHITE 0xFFFF

// ─── Pilote ⇄ grille logique (conventions de lib/canvasToScreen.ts) ────────────────────────────────────────────────────────────────────────────────────────────────────
static inline void pod_render_decode(const PodRenderSpec& s, const uint8_t* const* planes, uint16_t* g) {
  if (s.eink) {
    const int bpr = s.h / 8;
    for (int y = 0; y < s.h; y++) for (int x = 0; x < s.w; x++) {
      const int bufCol = s.h - 1 - y, idx = x * bpr + (bufCol >> 3), bit = 7 - (bufCol & 7);
      const bool black = !((planes[0][idx] >> bit) & 1), red = s.planes > 1 && !((planes[1][idx] >> bit) & 1);
      g[y * s.w + x] = red ? POD_R_RED : black ? POD_R_BLACK : POD_R_WHITE;
    }
  } else {
    for (uint32_t i = 0; i < (uint32_t)s.w * s.h; i++) g[i] = (uint16_t)(planes[0][2 * i] | (planes[0][2 * i + 1] << 8));
  }
}
/** Remplit les plans (déjà alloués : plane_bytes octets chacun). */
static inline void pod_render_encode(const PodRenderSpec& s, const uint16_t* g, uint8_t* const* planes) {
  if (s.eink) {
    const int bpr = s.h / 8, n = bpr * s.w;
    for (int p = 0; p < s.planes; p++) memset(planes[p], 0xFF, (size_t)n);
    for (int y = 0; y < s.h; y++) for (int x = 0; x < s.w; x++) {
      const uint16_t v = g[y * s.w + x]; if (v == POD_R_WHITE) continue;
      const int bufCol = s.h - 1 - y, idx = x * bpr + (bufCol >> 3); const uint8_t mask = (uint8_t)(~(1 << (7 - (bufCol & 7))));
      if (v == POD_R_RED) { if (s.planes > 1) planes[1][idx] &= mask; } else planes[0][idx] &= mask;
    }
  } else {
    for (uint32_t i = 0; i < (uint32_t)s.w * s.h; i++) { planes[0][2 * i] = (uint8_t)(g[i] & 0xFF); planes[0][2 * i + 1] = (uint8_t)(g[i] >> 8); }
  }
}

// ─── Police 5×7 (table de la R4 : bit 0 = ligne du haut) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
static const uint8_t POD_FONT_5X7[42][5] = {
  {0x3E,0x51,0x49,0x45,0x3E},{0x00,0x42,0x7F,0x40,0x00},{0x42,0x61,0x51,0x49,0x46},
  {0x21,0x41,0x45,0x4B,0x31},{0x18,0x14,0x12,0x7F,0x10},{0x27,0x45,0x45,0x45,0x39},
  {0x3C,0x4A,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},{0x36,0x49,0x49,0x49,0x36},
  {0x06,0x49,0x49,0x29,0x1E},{0x7C,0x12,0x11,0x12,0x7C},{0x7F,0x49,0x49,0x49,0x36},
  {0x3E,0x41,0x41,0x41,0x22},{0x7F,0x41,0x41,0x22,0x1C},{0x7F,0x49,0x49,0x49,0x41},
  {0x7F,0x09,0x09,0x09,0x01},{0x3E,0x41,0x49,0x49,0x7A},{0x7F,0x08,0x08,0x08,0x7F},
  {0x00,0x41,0x7F,0x41,0x00},{0x20,0x40,0x41,0x3F,0x01},{0x7F,0x08,0x14,0x22,0x41},
  {0x7F,0x40,0x40,0x40,0x40},{0x7F,0x02,0x0C,0x02,0x7F},{0x7F,0x04,0x08,0x10,0x7F},
  {0x3E,0x41,0x41,0x41,0x3E},{0x7F,0x09,0x09,0x09,0x06},{0x3E,0x41,0x51,0x21,0x5E},
  {0x7F,0x09,0x19,0x29,0x46},{0x46,0x49,0x49,0x49,0x31},{0x01,0x01,0x7F,0x01,0x01},
  {0x3F,0x40,0x40,0x40,0x3F},{0x1F,0x20,0x40,0x20,0x1F},{0x3F,0x40,0x38,0x40,0x3F},
  {0x63,0x14,0x08,0x14,0x63},{0x07,0x08,0x70,0x08,0x07},{0x61,0x51,0x49,0x45,0x43},
  {0x00,0x36,0x36,0x00,0x00},{0x00,0x60,0x60,0x00,0x00},{0x08,0x08,0x08,0x08,0x08},
  {0x02,0x01,0x02,0x04,0x02},{0x00,0x00,0x00,0x00,0x00},{0x14,0x7F,0x14,0x7F,0x14},
};
static inline int pod_render_glyph(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
  switch (c) { case ':': return 36; case '.': return 37; case '-': return 38; case '/': return 39; case '#': return 41; default: break; }
  return 40;
}
#define POD_R_ADVANCE 6

/**
 * UTF-8 → ASCII MAJUSCULES, plafonné à `cap-1` caractères (la suite serait de toute façon tronquée : voir pod_render_*_line). Algorithme FIGÉ de la R4 : ASCII imprimable conservé, contrôles → espace,
 * « Ã+0x80..0xBF » → table Latin-1, autre caractère multi-octets → UN « ? » (octets de continuation sautés), continuation isolée → ignorée. Retourne le nombre de caractères écrits.
 */
static inline size_t pod_render_fold(const uint8_t* s, size_t n, char* out, size_t cap) {
  static const char L1[] = "AAAAAAACEEEEIIIIDNOOOOO*OUUUUYTsaaaaaaaceeeeiiiidnooooo/ouuuuyty";
  size_t o = 0;
  for (size_t i = 0; i < n && o + 1 < cap; i++) {
    const uint8_t c = s[i]; char ch = 0;
    if (c < 0x80) ch = (c >= 32 && c < 127) ? (char)c : ' ';
    else if (c == 0xC3 && i + 1 < n) { const uint8_t d = s[++i]; ch = (d >= 0x80 && d < 0xC0) ? L1[d - 0x80] : '?'; }
    else if (c >= 0xC0) { ch = '?'; while (i + 1 < n && (s[i + 1] & 0xC0) == 0x80) i++; }
    else continue;
    if (ch >= 'a' && ch <= 'z') ch = (char)(ch - 32);
    out[o++] = ch;
  }
  out[o] = 0;
  return o;
}

struct PodRenderMeta { const uint8_t *ts; size_t tsLen; int32_t blockIndex; const uint8_t *artist; size_t artistLen; const uint8_t *title; size_t titleLen; };
#define POD_R_LINE_MAX 64
#define POD_R_FALLBACK "PROOF-OF-DRAW"

/** Ligne du haut e-ink : date (ou repli) puis « #N », tronquée à ⌊(W−4)/6⌋ caractères. `out` : POD_R_LINE_MAX octets au moins. */
static inline size_t pod_render_top_line(const PodRenderSpec& s, const PodRenderMeta& m, char* out) {
  const size_t max = (size_t)((s.w - 4) / POD_R_ADVANCE);
  size_t n = 0;
  if (m.tsLen > 0) n = pod_render_fold(m.ts, m.tsLen, out, max + 1); else { for (; POD_R_FALLBACK[n]; n++) out[n] = POD_R_FALLBACK[n]; out[n] = 0; if (n > max) { n = max; out[n] = 0; } }
  if (m.blockIndex >= 0) { char num[24]; const int k = pod_utoa((uint64_t)m.blockIndex, num); const char suffix[3] = { ' ', '#', 0 }; for (int i = 0; suffix[i] && n < max; i++) out[n++] = suffix[i]; for (int i = 0; i < k && n < max; i++) out[n++] = num[i]; out[n] = 0; }
  return n;
}
/** Ligne du bas : « ARTISTE - TITRE », ou l'un des deux, ou le repli ; tronquée à `max` caractères. `out` : max+1 octets au moins. Aucun tampon temporaire (8B-1) : l'artiste est replié dans `out`, le titre à la suite. */
static inline size_t pod_render_bottom_line(const PodRenderMeta& m, size_t max, char* out) {
  if (max > POD_R_LINE_MAX - 1) max = POD_R_LINE_MAX - 1;
  size_t n = pod_render_fold(m.artist, m.artistLen, out, max + 1);
  char probe[2]; const bool hasTitle = pod_render_fold(m.title, m.titleLen, probe, sizeof(probe)) > 0;   // le titre se replie-t-il en au moins un caractère ?
  if (n > 0 && hasTitle) {
    static const char SEP[] = " - ";
    for (int i = 0; SEP[i] && n < max; i++) out[n++] = SEP[i];
    if (n < max) n += pod_render_fold(m.title, m.titleLen, out + n, max - n + 1);
  } else if (n == 0 && hasTitle) {
    n = pod_render_fold(m.title, m.titleLen, out, max + 1);
  } else if (n == 0) {
    for (; POD_R_FALLBACK[n] && n < max; n++) out[n] = POD_R_FALLBACK[n];
  }
  out[n] = 0;
  return n;
}

static inline void pod_render_fill_rows(uint16_t* g, int w, int y0, int y1, uint16_t color) { for (int y = y0; y <= y1; y++) for (int x = 0; x < w; x++) g[y * w + x] = color; }
static inline void pod_render_text(uint16_t* g, int w, int h, int x, int y, const char* text, uint16_t color) {
  for (int i = 0; text[i]; i++) {
    const uint8_t* glyph = POD_FONT_5X7[pod_render_glyph(text[i])];
    for (int col = 0; col < 5; col++) for (int row = 0; row < 7; row++) {
      if (!((glyph[col] >> row) & 1)) continue;
      const int px = x + i * POD_R_ADVANCE + col, py = y + row;
      if (px >= 0 && px < w && py >= 0 && py < h) g[py * w + px] = color;
    }
  }
}
static inline int pod_render_strlen(const char* s) { int n = 0; while (s[n]) n++; return n; }

/** Grave le cartel PAR-DESSUS la grille. */
static inline void pod_render_burn(const PodRenderSpec& s, const PodRenderMeta& m, uint16_t* g) {
  if (!s.cartel) return;
  char top[POD_R_LINE_MAX], bot[POD_R_LINE_MAX];
  if (s.eink) {
    pod_render_fill_rows(g, s.w, 0, s.top1 - 1, POD_R_WHITE); pod_render_fill_rows(g, s.w, s.top1, s.top1, POD_R_BLACK);
    pod_render_top_line(s, m, top); pod_render_bottom_line(m, (size_t)((s.w - 4) / POD_R_ADVANCE), bot);
    int tx = (s.w - pod_render_strlen(top) * POD_R_ADVANCE) / 2; if (tx < 0) tx = 0;
    pod_render_text(g, s.w, s.h, tx, 3, top, POD_R_BLACK);
    pod_render_fill_rows(g, s.w, s.bot0, s.bot0, POD_R_BLACK); pod_render_fill_rows(g, s.w, s.bot0 + 1, s.h - 1, POD_R_WHITE);
    int bx = (s.w - pod_render_strlen(bot) * POD_R_ADVANCE) / 2; if (bx < 0) bx = 0;
    pod_render_text(g, s.w, s.h, bx, s.bot0 + 3, bot, POD_R_BLACK);
  } else {
    pod_render_fill_rows(g, s.w, 0, s.top1 - 1, POD_T_DARK); pod_render_fill_rows(g, s.w, s.top1, s.top1, POD_T_GOLD);
    pod_render_text(g, s.w, s.h, 3, 4, "RESCOE", POD_T_GOLD);
    if (m.blockIndex >= 0) { char num[24]; const int k = pod_utoa((uint64_t)m.blockIndex, num); char lab[26]; lab[0] = '#'; for (int i = 0; i < k; i++) lab[1 + i] = num[i]; lab[1 + k] = 0; int bx = s.w - 3 - (1 + k) * POD_R_ADVANCE; if (bx < 50) bx = 50; pod_render_text(g, s.w, s.h, bx, 4, lab, POD_T_GREY); }
    pod_render_fill_rows(g, s.w, s.bot0, s.bot0, POD_T_GOLD); pod_render_fill_rows(g, s.w, s.bot0 + 1, s.h - 1, POD_T_DARK);
    pod_render_bottom_line(m, (size_t)((s.w - 6) / POD_R_ADVANCE), bot);
    pod_render_text(g, s.w, s.h, 3, s.bot0 + 4, bot, POD_T_WHITE);
  }
}

/** FIT : image entière ramenée entre les bandes (ratio conservé, centrée, plus proche voisin, ENTIER). `out` (distinct de `in`) reçoit le résultat. */
static inline void pod_render_fit(const PodRenderSpec& s, const uint16_t* in, uint16_t* out) {
  const uint16_t white = s.eink ? POD_R_WHITE : POD_T_WHITE;
  for (uint32_t i = 0; i < (uint32_t)s.w * s.h; i++) out[i] = white;
  const int hs = (int)pod_render_safe_h(s), y0 = (int)pod_render_safe0(s);
  const int nw = (int)(((uint32_t)s.w * hs) / s.h), x0 = (s.w - nw) / 2;
  for (int y = 0; y < hs; y++) {
    const int sy = (int)(((uint32_t)(2 * y + 1) * s.h) / (uint32_t)(2 * hs));
    for (int x = 0; x < nw; x++) { const int sx = (int)(((uint32_t)(2 * x + 1) * s.w) / (uint32_t)(2 * nw)); out[(y0 + y) * s.w + x0 + x] = in[sy * s.w + sx]; }
  }
}

/** Grille finale (`out` distinct de `in`). `hidden` ou écran sans cartel : copie ; `overlay` : cartel par-dessus ; `fit` : ajustement puis cartel. */
static inline void pod_render_grid(const PodRenderSpec& s, PodRenderMode mode, const PodRenderMeta& m, const uint16_t* in, uint16_t* out) {
  const uint32_t n = (uint32_t)s.w * s.h;
  if (!s.cartel || mode == POD_R_HIDDEN) { for (uint32_t i = 0; i < n; i++) out[i] = in[i]; return; }
  if (mode == POD_R_FIT) pod_render_fit(s, in, out); else for (uint32_t i = 0; i < n; i++) out[i] = in[i];
  pod_render_burn(s, m, out);
}

// ─── Hashes (domaines gelés) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
static inline const char* pod_render_mode_name(PodRenderMode m) { return m == POD_R_OVERLAY ? "overlay" : m == POD_R_FIT ? "fit" : "hidden"; }

/** frameHash = SHA-256("pod-frame-v1|écran|WxH|plans|" ‖ plans). */
template <class Sha> static inline void pod_render_frame_hash(const PodRenderSpec& s, const uint8_t* const* planes, char out[65]) {
  char pre[96]; PodOut o(pre, sizeof(pre)); o.str("pod-frame-v1|"); o.str(s.name); o.ch('|'); o.u64(s.w); o.ch('x'); o.u64(s.h); o.ch('|'); o.u64(s.planes); o.ch('|');
  Sha h; h.begin(); h.update(pre, o.pos); const uint32_t n = pod_render_plane_bytes(s); for (int p = 0; p < s.planes; p++) h.update(planes[p], n);
  uint8_t d[32]; h.finish(d); pod_hex(d, 32, out);
}
/** renderHash = SHA-256("pod-render-v1|écran|WxH|plans|layoutVersion|mode|" ‖ plans finaux). */
template <class Sha> static inline void pod_render_render_hash(const PodRenderSpec& s, PodRenderMode mode, const uint8_t* const* planes, char out[65]) {
  char pre[112]; PodOut o(pre, sizeof(pre)); o.str("pod-render-v1|"); o.str(s.name); o.ch('|'); o.u64(s.w); o.ch('x'); o.u64(s.h); o.ch('|'); o.u64(s.planes); o.ch('|');
  o.u64(POD_RENDER_LAYOUT_VERSION); o.ch('|'); o.str(pod_render_mode_name(mode)); o.ch('|');
  Sha h; h.begin(); h.update(pre, o.pos); const uint32_t n = pod_render_plane_bytes(s); for (int p = 0; p < s.planes; p++) h.update(planes[p], n);
  uint8_t d[32]; h.finish(d); pod_hex(d, 32, out);
}

/**
 * Rendu complet à partir des plans REÇUS (miroir de `renderFrame`) : frameHash du buffer reçu, plans finaux (`outPlanes`, alloués par l'appelant), renderHash du buffer final.
 * `gin` / `gout` : deux grilles logiques (w·h uint16_t chacune) — inutilisées pour un écran sans cartel ou en mode « hidden » (les plans sont alors copiés tels quels).
 */
template <class Sha> static inline void pod_render_frame(const PodRenderSpec& s, PodRenderMode mode, const PodRenderMeta& m, const uint8_t* const* planes,
                                                          uint16_t* gin, uint16_t* gout, uint8_t* const* outPlanes, char frameHash[65], char renderHash[65]) {
  pod_render_frame_hash<Sha>(s, planes, frameHash);
  if (s.cartel && mode != POD_R_HIDDEN) {
    pod_render_decode(s, planes, gin); pod_render_grid(s, mode, m, gin, gout); pod_render_encode(s, gout, outPlanes);
  } else {
    const uint32_t n = pod_render_plane_bytes(s); for (int p = 0; p < s.planes; p++) memcpy(outPlanes[p], planes[p], n);
  }
  const uint8_t* fin[2] = { outPlanes[0], s.planes > 1 ? outPlanes[1] : outPlanes[0] };
  pod_render_render_hash<Sha>(s, mode, fin, renderHash);
}

// ─── Motifs de test déterministes (identiques à lib/renderLayout.ts) ────────────────────────────────────────────────────────────────────────────────────────────────────
static inline uint32_t pod_render_hash32(uint32_t seed, uint32_t x, uint32_t y) {
  uint32_t h = seed + x * 73856093u + y * 19349663u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return h;
}
enum PodRenderPattern { POD_P_WHITE = 0, POD_P_FULL, POD_P_BORDER, POD_P_LIMITS, POD_P_CHECKER, POD_P_STRIPES, POD_P_NOISE, POD_P_BWR };
static inline void pod_render_pattern(const PodRenderSpec& s, PodRenderPattern p, uint32_t seed, uint16_t* g) {
  static const uint16_t PAL[8] = { 0x0000, 0xFFFF, 0xF800, 0x07E0, 0x001F, 0xFFE0, 0xF81F, 0x07FF };
  const bool bwr = s.planes == 2 && s.eink;
  const uint16_t white = s.eink ? POD_R_WHITE : POD_T_WHITE, black = s.eink ? POD_R_BLACK : 0x0000, accent = s.eink ? (bwr ? POD_R_RED : POD_R_BLACK) : 0xF800;
  const int sy0 = (int)pod_render_safe0(s), sy1 = (int)s.bot0 - 1;
  for (int y = 0; y < s.h; y++) for (int x = 0; x < s.w; x++) {
    uint16_t v = white;
    switch (p) {
      case POD_P_WHITE: break;
      case POD_P_FULL: v = black; break;
      case POD_P_BORDER: v = (x == 0 || y == 0 || x == s.w - 1 || y == s.h - 1) ? black : white; break;
      case POD_P_LIMITS: v = (y == sy0 - 1 || y == sy0 || y == sy1 || y == sy1 + 1) ? black : (x == 0 || x == s.w - 1 || x == (s.w >> 1)) ? accent : white; break;
      case POD_P_CHECKER: v = ((x + y) & 1) ? black : white; break;
      case POD_P_STRIPES: v = (y % 3 == 0) ? black : (y % 7 == 3) ? accent : white; break;
      case POD_P_NOISE: { const uint32_t r = pod_render_hash32(seed, (uint32_t)x, (uint32_t)y); v = s.eink ? (uint16_t)(bwr ? r % 3 : r % 2) : PAL[r & 7]; break; }
      case POD_P_BWR: { const uint32_t r = pod_render_hash32(seed, (uint32_t)x, (uint32_t)y) % 11; v = r < 3 ? black : r < 5 ? (s.eink ? accent : 0xF800) : white; break; }
    }
    g[y * s.w + x] = v;
  }
}
