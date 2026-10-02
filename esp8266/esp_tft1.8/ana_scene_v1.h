// ana_scene_v1.h — lecteur `ana-scene-v1` pour firmware (OLED / TFT). C++11 portable : AUCUNE dépendance Arduino.
//
// Reproduit À L'OCTET le moteur de référence TypeScript (lib/scene/engine.ts, docs/SCENE_V1_MOTEUR.md). Même fichier compilé :
//   • sur le PC par tests/sceneV1Firmware.test.ts (comparé aux golden vectors, validation différentielle contre le parseur TS) ;
//   • sur l'ESP8266 (xtensa-lx106-elf-g++) via esp_tft1.8.ino.
// Règles : arithmétique ENTIÈRE, aucune allocation dynamique, aucun flottant, aucune E/S. Le paquet reste en place (les entités
// sont relues à chaque rendu depuis le buffer ; seuls des offsets sont mémorisés). Un paquet qui ne passe pas parse() n'est jamais joué.
//
// Si ce fichier change : régénérer/relancer tests/sceneV1Firmware.test.ts ET recopier le fichier dans chaque firmware qui l'embarque
// (le test vérifie que les copies sont identiques).

#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace anascene {

static const int    MAX_ENTITIES = 24;
static const int    MAX_POINTS   = 16;
static const int    MAX_TICKS    = 50;
static const int    MAX_OPS      = 256;
static const int    MAX_PALETTE  = 8;
static const size_t MAX_PACKAGE  = 4096;
static const size_t HEADER_BYTES = 32;

static const uint8_t PROFILE_OLED = 1;   // 128×64
static const uint8_t PROFILE_TFT  = 2;   // 128×160

enum Prim   : uint8_t { P_POINT = 1, P_LINE = 2, P_RECT = 3, P_CIRCLE = 4, P_POLYLINE = 5 };
enum Motion : uint8_t { M_STATIC = 0, M_LINEAR = 1, M_OSC_X = 2, M_OSC_Y = 3, M_ORBIT = 4 };

// Table sinus Q15 normative (256 entrées) — copie littérale de lib/scene/spec.ts, hash e6ba60bf…72ba3 vérifié par les tests.
static const int16_t SIN_Q15[256] = {
  0, 804, 1608, 2410, 3212, 4011, 4808, 5602, 6393, 7179, 7962, 8739, 9512, 10278, 11039, 11793,
  12539, 13279, 14010, 14732, 15446, 16151, 16846, 17530, 18204, 18868, 19519, 20159, 20787, 21403, 22005, 22594,
  23170, 23731, 24279, 24811, 25329, 25832, 26319, 26790, 27245, 27683, 28105, 28510, 28898, 29268, 29621, 29956,
  30273, 30571, 30852, 31113, 31356, 31580, 31785, 31971, 32137, 32285, 32412, 32521, 32609, 32678, 32728, 32757,
  32767, 32757, 32728, 32678, 32609, 32521, 32412, 32285, 32137, 31971, 31785, 31580, 31356, 31113, 30852, 30571,
  30273, 29956, 29621, 29268, 28898, 28510, 28105, 27683, 27245, 26790, 26319, 25832, 25329, 24811, 24279, 23731,
  23170, 22594, 22005, 21403, 20787, 20159, 19519, 18868, 18204, 17530, 16846, 16151, 15446, 14732, 14010, 13279,
  12539, 11793, 11039, 10278, 9512, 8739, 7962, 7179, 6393, 5602, 4808, 4011, 3212, 2410, 1608, 804,
  0, -804, -1608, -2410, -3212, -4011, -4808, -5602, -6393, -7179, -7962, -8739, -9512, -10278, -11039, -11793,
  -12539, -13279, -14010, -14732, -15446, -16151, -16846, -17530, -18204, -18868, -19519, -20159, -20787, -21403, -22005, -22594,
  -23170, -23731, -24279, -24811, -25329, -25832, -26319, -26790, -27245, -27683, -28105, -28510, -28898, -29268, -29621, -29956,
  -30273, -30571, -30852, -31113, -31356, -31580, -31785, -31971, -32137, -32285, -32412, -32521, -32609, -32678, -32728, -32757,
  -32767, -32757, -32728, -32678, -32609, -32521, -32412, -32285, -32137, -31971, -31785, -31580, -31356, -31113, -30852, -30571,
  -30273, -29956, -29621, -29268, -28898, -28510, -28105, -27683, -27245, -26790, -26319, -25832, -25329, -24811, -24279, -23731,
  -23170, -22594, -22005, -21403, -20787, -20159, -19519, -18868, -18204, -17530, -16846, -16151, -15446, -14732, -14010, -13279,
  -12539, -11793, -11039, -10278, -9512, -8739, -7962, -7179, -6393, -5602, -4808, -4011, -3212, -2410, -1608, -804,
};

enum Err : uint8_t {
  OK = 0, ERR_SHORT, ERR_LONG, ERR_MAGIC, ERR_FORMAT, ERR_RENDERER, ERR_PROFILE, ERR_RESERVED, ERR_DIMS, ERR_LENGTH, ERR_CRC,
  ERR_HEADER, ERR_TRUNCATED, ERR_PRIMITIVE, ERR_MOTION, ERR_ENTITY, ERR_BOUNDS, ERR_OPS, ERR_TRAILING,
};

inline const char* errName(Err e) {
  static const char* const n[] = {
    "OK", "SHORT", "LONG", "MAGIC", "FORMAT", "RENDERER", "PROFILE", "RESERVED", "DIMS", "LENGTH", "CRC",
    "HEADER", "TRUNCATED", "PRIMITIVE", "MOTION", "ENTITY", "BOUNDS", "OPS", "TRAILING",
  };
  return (unsigned)e < sizeof(n) / sizeof(n[0]) ? n[e] : "?";
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

inline uint32_t crc32(const uint8_t* p, size_t n) {
  uint32_t c = 0xFFFFFFFFu;
  for (size_t i = 0; i < n; i++) {
    c ^= p[i];
    for (int k = 0; k < 8; k++) c = (c & 1u) ? (c >> 1) ^ 0xEDB88320u : (c >> 1);
  }
  return ~c;
}

inline uint16_t rd16(const uint8_t* p) { return (uint16_t)(p[0] | (p[1] << 8)); }
inline uint32_t rd32(const uint8_t* p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
inline int iabs(int v) { return v < 0 ? -v : v; }
template <class T> inline void growMin(T& m, T v) { if (v < m) m = v; }
template <class T> inline void growMax(T& m, T v) { if (v > m) m = v; }
inline int32_t mod(int32_t a, int32_t n) { int32_t r = a % n; return r < 0 ? r + n : r; }

/** Coordonnée normalisée 0..65535 → pixel : floor(c × (extent − 1) / 65535) (c ≥ 0). */
inline int toPixel(int32_t c, int extent) { return (int)((c * (extent - 1)) / 65535); }

// ─── Entités (relues depuis le paquet) ───────────────────────────────────────

struct Ent {
  uint8_t  id, prim, color, mtype;
  uint16_t a, b, c, d;       // point: x,y · line: x1,y1,x2,y2 · rect: x0,y0,x1,y1 · circle: cx,cy,r
  uint8_t  size;             // point.size · line.width · polyline.width
  uint8_t  flag;             // fill (rect, circle) · closed (polyline)
  uint8_t  npts;             // polyline
  uint16_t ptsOff;           // polyline : offset des points dans le paquet
  int16_t  dx, dy;           // linear
  uint16_t m0, m1;           // oscillate: amplitude (m0) · orbit: radiusX (m0), radiusY (m1)
  uint8_t  period, phase;
};

/** Décode une entité à `pos` ; retourne la position suivante, ou 0 si tronquée / inconnue (borne `end` exclusive). */
inline size_t decodeEnt(const uint8_t* p, size_t pos, size_t end, Ent& e, Err* err = nullptr) {
  Err dummy; if (!err) err = &dummy;
  memset(&e, 0, sizeof(e));
  if (pos + 4 > end) { *err = ERR_TRUNCATED; return 0; }
  e.id = p[pos]; e.prim = p[pos + 1]; e.color = p[pos + 2]; e.mtype = p[pos + 3];
  pos += 4;
  if (e.prim < P_POINT || e.prim > P_POLYLINE) { *err = ERR_PRIMITIVE; return 0; }
  if (e.mtype > M_ORBIT) { *err = ERR_MOTION; return 0; }

  size_t g = 0;
  switch (e.prim) {
    case P_POINT:  g = 5; break;
    case P_LINE:   g = 9; break;
    case P_RECT:   g = 9; break;
    case P_CIRCLE: g = 7; break;
    default:       g = 3; break;   // polyline : en-tête, puis 4·n octets
  }
  if (pos + g > end) { *err = ERR_TRUNCATED; return 0; }
  switch (e.prim) {
    case P_POINT:  e.a = rd16(p + pos); e.b = rd16(p + pos + 2); e.size = p[pos + 4]; break;
    case P_LINE:   e.a = rd16(p + pos); e.b = rd16(p + pos + 2); e.c = rd16(p + pos + 4); e.d = rd16(p + pos + 6); e.size = p[pos + 8]; break;
    case P_RECT:   e.a = rd16(p + pos); e.b = rd16(p + pos + 2); e.c = rd16(p + pos + 4); e.d = rd16(p + pos + 6); e.flag = p[pos + 8]; break;
    case P_CIRCLE: e.a = rd16(p + pos); e.b = rd16(p + pos + 2); e.c = rd16(p + pos + 4); e.flag = p[pos + 6]; break;
    default:
      e.npts = p[pos]; e.flag = p[pos + 1]; e.size = p[pos + 2];
      if (pos + 3 + (size_t)e.npts * 4 > end) { *err = ERR_TRUNCATED; return 0; }
      e.ptsOff = (uint16_t)(pos + 3);
      g = 3 + (size_t)e.npts * 4;
      break;
  }
  pos += g;
  if ((e.prim == P_RECT || e.prim == P_CIRCLE || e.prim == P_POLYLINE) && e.flag > 1) { *err = ERR_ENTITY; return 0; }   // booléen strict

  size_t m = 0;
  switch (e.mtype) {
    case M_STATIC: m = 0; break;
    case M_LINEAR: m = 4; break;
    case M_ORBIT:  m = 6; break;
    default:       m = 4; break;   // oscillate-x / oscillate-y
  }
  if (pos + m > end) { *err = ERR_TRUNCATED; return 0; }
  switch (e.mtype) {
    case M_LINEAR: e.dx = (int16_t)rd16(p + pos); e.dy = (int16_t)rd16(p + pos + 2); break;
    case M_OSC_X:
    case M_OSC_Y:  e.m0 = rd16(p + pos); e.period = p[pos + 2]; e.phase = p[pos + 3]; break;
    case M_ORBIT:  e.m0 = rd16(p + pos); e.m1 = rd16(p + pos + 2); e.period = p[pos + 4]; e.phase = p[pos + 5]; break;
    default: break;
  }
  *err = OK;
  return pos + m;
}

// ─── Scène : parse + validation complète ─────────────────────────────────────

struct Scene {
  const uint8_t* pkg;
  uint16_t len;
  uint8_t  profile;
  uint16_t width, height;
  uint32_t seed;
  uint8_t  tickRate, durationTicks, loopCount, backgroundIndex, paletteCount, entityCount;
  uint16_t palette[MAX_PALETTE];
  uint16_t entPos[MAX_ENTITIES];
};

struct Bounds { int32_t minX, minY, maxX, maxY; };

inline Bounds entityBounds(const Ent& e, const uint8_t* pkg) {
  Bounds b;
  switch (e.prim) {
    case P_POINT:  b = { e.a, e.b, e.a, e.b }; break;
    case P_LINE:   b = { e.a < e.c ? e.a : e.c, e.b < e.d ? e.b : e.d, e.a > e.c ? e.a : e.c, e.b > e.d ? e.b : e.d }; break;
    case P_RECT:   b = { e.a, e.b, e.c, e.d }; break;
    case P_CIRCLE: b = { (int32_t)e.a - e.c, (int32_t)e.b - e.c, (int32_t)e.a + e.c, (int32_t)e.b + e.c }; break;
    default: {
      b = { 65535, 65535, 0, 0 };
      for (int i = 0; i < e.npts; i++) {
        int32_t x = rd16(pkg + e.ptsOff + 4 * i), y = rd16(pkg + e.ptsOff + 4 * i + 2);
        growMin(b.minX, x); growMin(b.minY, y); growMax(b.maxX, x); growMax(b.maxY, y);
      }
    }
  }
  return b;
}

inline int opCost(const Ent& e) {
  switch (e.prim) { case P_POINT: return 1; case P_LINE: return 1; case P_RECT: return 4; case P_CIRCLE: return 8; default: return e.npts + (e.flag ? 1 : 0); }
}

/** Valide UNE entité selon toutes les règles du contrat (mêmes bornes que lib/scene/validate.ts). */
inline Err validateEnt(const Ent& e, const Scene& s, const uint8_t* pkg) {
  if (e.id >= MAX_ENTITIES || e.color >= s.paletteCount) return ERR_ENTITY;
  switch (e.prim) {
    case P_POINT: if (e.size < 1 || e.size > 4) return ERR_ENTITY; break;
    case P_LINE:  if (e.size < 1 || e.size > 4) return ERR_ENTITY; break;
    case P_RECT:  if (e.a > e.c || e.b > e.d) return ERR_ENTITY; break;
    case P_CIRCLE:
      if (e.c < 1 || e.c > 32767) return ERR_ENTITY;
      if (e.a < e.c || e.b < e.c || (int32_t)e.a + e.c > 65535 || (int32_t)e.b + e.c > 65535) return ERR_ENTITY;
      break;
    default:
      if (e.npts < 2 || e.npts > MAX_POINTS || e.size < 1 || e.size > 4) return ERR_ENTITY;
  }
  switch (e.mtype) {
    case M_STATIC: case M_LINEAR: break;
    case M_OSC_X: case M_OSC_Y:
      if (e.m0 > 32767) return ERR_MOTION; /* fallthrough */
    case M_ORBIT:
      if (e.mtype == M_ORBIT && (e.m0 > 32767 || e.m1 > 32767)) return ERR_MOTION;
      if (e.period < 2 || e.period > s.durationTicks || e.phase >= e.period) return ERR_MOTION;
      break;
  }
  // Débordement du canevas normalisé (validateMotionBounds)
  const Bounds b = entityBounds(e, pkg);
  if (e.mtype == M_OSC_X && !(b.minX >= e.m0 && b.maxX + e.m0 <= 65535)) return ERR_BOUNDS;
  if (e.mtype == M_OSC_Y && !(b.minY >= e.m0 && b.maxY + e.m0 <= 65535)) return ERR_BOUNDS;
  if (e.mtype == M_ORBIT && !(b.minX >= e.m0 && b.maxX + e.m0 <= 65535 && b.minY >= e.m1 && b.maxY + e.m1 <= 65535)) return ERR_BOUNDS;
  return OK;
}

/**
 * Valide ET indexe un paquet ANAS. Refus ATOMIQUE : tout écart (taille, magic, versions, profil, dimensions, longueur, CRC32,
 * bornes, ids, budget d'opérations…) → code d'erreur, `out` inutilisable. `profileWanted` = profil de CET écran (refuse un paquet
 * compilé pour un autre).
 */
inline Err parse(const uint8_t* p, size_t len, uint8_t profileWanted, Scene& out) {
  memset(&out, 0, sizeof(out));
  if (len < HEADER_BYTES + 4) return ERR_SHORT;
  if (len > MAX_PACKAGE) return ERR_LONG;
  if (p[0] != 'A' || p[1] != 'N' || p[2] != 'A' || p[3] != 'S') return ERR_MAGIC;
  if (p[4] != 1) return ERR_FORMAT;
  if (p[5] != 1) return ERR_RENDERER;
  if (p[6] != PROFILE_OLED && p[6] != PROFILE_TFT) return ERR_PROFILE;
  if (p[6] != profileWanted) return ERR_PROFILE;
  if (p[7] != 0) return ERR_RESERVED;
  const uint16_t w = rd16(p + 8), h = rd16(p + 10);
  if (p[6] == PROFILE_OLED ? !(w == 128 && h == 64) : !(w == 128 && h == 160)) return ERR_DIMS;
  const uint16_t bodyLength = rd16(p + 22);
  if (HEADER_BYTES + (size_t)bodyLength + 4 != len) return ERR_LENGTH;
  const size_t crcPos = len - 4;
  if (crc32(p, crcPos) != rd32(p + crcPos)) return ERR_CRC;

  Scene s; memset(&s, 0, sizeof(s));
  s.pkg = p; s.len = (uint16_t)len; s.profile = p[6]; s.width = w; s.height = h; s.seed = rd32(p + 12);
  s.tickRate = p[16]; s.durationTicks = p[17]; s.loopCount = p[18]; s.backgroundIndex = p[19];
  s.paletteCount = p[20]; s.entityCount = p[21];
  if (s.seed == 0 || s.tickRate < 1 || s.tickRate > 5 || s.durationTicks < 1 || s.durationTicks > MAX_TICKS ||
      s.loopCount < 1 || s.loopCount > 3 || s.paletteCount < 1 || s.paletteCount > MAX_PALETTE ||
      s.backgroundIndex >= s.paletteCount || s.entityCount < 1 || s.entityCount > MAX_ENTITIES) return ERR_HEADER;

  const size_t bodyEnd = HEADER_BYTES + bodyLength;
  size_t pos = HEADER_BYTES;
  if (pos + (size_t)s.paletteCount * 2 > bodyEnd) return ERR_TRUNCATED;
  for (int i = 0; i < s.paletteCount; i++, pos += 2) s.palette[i] = rd16(p + pos);

  uint32_t idMask = 0;
  int ops = 0;
  for (int i = 0; i < s.entityCount; i++) {
    Ent e; Err de = OK;
    s.entPos[i] = (uint16_t)pos;
    const size_t next = decodeEnt(p, pos, bodyEnd, e, &de);
    if (next == 0) return de;
    const Err ve = validateEnt(e, s, p);
    if (ve != OK) return ve;
    if (idMask & (1u << e.id)) return ERR_ENTITY;   // id dupliqué
    idMask |= (1u << e.id);
    ops += opCost(e);
    pos = next;
  }
  if (ops > MAX_OPS) return ERR_OPS;
  if (pos != bodyEnd) return ERR_TRAILING;
  out = s;
  return OK;
}

// ─── Tampon image 4 bits / pixel (10 240 octets pour 128×160) ────────────────

struct Fb {
  uint8_t* d; int w, h, stride;
  static size_t bytesFor(int W, int H) { return (size_t)((W + 1) / 2) * (size_t)H; }
  void init(uint8_t* buf, int W, int H) { d = buf; w = W; h = H; stride = (W + 1) / 2; }
  void fill(uint8_t c) { memset(d, (uint8_t)((c << 4) | c), bytesFor(w, h)); }
  inline uint8_t get(int x, int y) const { const uint8_t b = d[y * stride + (x >> 1)]; return (x & 1) ? (uint8_t)(b & 0x0F) : (uint8_t)(b >> 4); }
  inline void set(int x, int y, uint8_t c) {
    uint8_t& b = d[y * stride + (x >> 1)];
    b = (x & 1) ? (uint8_t)((b & 0xF0) | c) : (uint8_t)((b & 0x0F) | (c << 4));
  }
};

/** Pixel : `wrap` (mouvement linear) = tore ; sinon rognage aux bords. */
struct Plotter {
  Fb* fb; bool wrap; uint8_t color;
  inline void operator()(int x, int y) const {
    if (wrap) { fb->set((int)mod(x, fb->w), (int)mod(y, fb->h), color); }
    else if ((unsigned)x < (unsigned)fb->w && (unsigned)y < (unsigned)fb->h) { fb->set(x, y, color); }
  }
};

inline void stamp(const Plotter& pl, int x, int y, int size) {
  const int off = size >> 1;
  for (int j = 0; j < size; j++) for (int i = 0; i < size; i++) pl(x - off + i, y - off + j);
}

template <class F>
inline void bresenham(int x0, int y0, int x1, int y1, F&& visit) {
  const int dx = iabs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const int dy = -iabs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  int err = dx + dy;
  for (;;) {
    visit(x0, y0);
    if (x0 == x1 && y0 == y1) return;
    const int e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

inline void midpointCircle(const Plotter& pl, int cx, int cy, int r, bool fill) {
  int x = r, y = 0, d = 1 - r;
  while (x >= y) {
    if (fill) {
      for (int i = cx - x; i <= cx + x; i++) { pl(i, cy + y); }
      for (int i = cx - x; i <= cx + x; i++) { pl(i, cy - y); }
      for (int i = cx - y; i <= cx + y; i++) { pl(i, cy + x); }
      for (int i = cx - y; i <= cx + y; i++) { pl(i, cy - x); }
    } else {
      pl(cx + x, cy + y); pl(cx - x, cy + y); pl(cx + x, cy - y); pl(cx - x, cy - y);
      pl(cx + y, cy + x); pl(cx - y, cy + x); pl(cx + y, cy - x); pl(cx - y, cy - x);
    }
    y++;
    if (d < 0) d += 2 * y + 1;
    else { x--; d += 2 * (y - x) + 1; }
  }
}

// ─── Mouvements ──────────────────────────────────────────────────────────────

struct Off { int32_t x, y; };

inline Off motionOffset(const Ent& e, int tick) {
  if (e.mtype == M_STATIC) return { 0, 0 };
  if (e.mtype == M_LINEAR) return { (int32_t)e.dx * tick, (int32_t)e.dy * tick };
  const int idx = ((((tick + e.phase) % e.period) * 256) / e.period) & 255;
  const int32_t sn = SIN_Q15[idx];
  if (e.mtype == M_ORBIT) { const int32_t cs = SIN_Q15[(idx + 64) & 255]; return { ((int32_t)e.m0 * cs) / 32767, ((int32_t)e.m1 * sn) / 32767 }; }
  const int32_t v = ((int32_t)e.m0 * sn) / 32767;   // division entière : troncature vers zéro, comme Math.trunc
  return e.mtype == M_OSC_X ? Off{ v, 0 } : Off{ 0, v };
}

/** Décalage effectif : `linear` ramené dans 0..65535 (tore normalisé), les autres inchangés. */
inline Off effectiveOffset(const Ent& e, int tick) {
  Off o = motionOffset(e, tick);
  if (e.mtype == M_LINEAR) { o.x = mod(o.x, 65536); o.y = mod(o.y, 65536); }
  return o;
}

// ─── Rendu d'un tick ─────────────────────────────────────────────────────────

inline void drawEntity(const Scene& s, const Ent& e, int tick, Fb& fb) {
  const bool wrap = e.mtype == M_LINEAR;
  const Off o = effectiveOffset(e, tick);
  const int W = fb.w, H = fb.h;
  const Plotter pl = { &fb, wrap, e.color };
  auto px = [&](int32_t x) { return toPixel(x + o.x, W); };
  auto py = [&](int32_t y) { return toPixel(y + o.y, H); };

  switch (e.prim) {
    case P_POINT: stamp(pl, px(e.a), py(e.b), e.size); break;
    case P_LINE: {
      const int sz = e.size;
      bresenham(px(e.a), py(e.b), px(e.c), py(e.d), [&](int x, int y) { stamp(pl, x, y, sz); });
      break;
    }
    case P_RECT: {
      const int x0 = px(e.a), x1 = px(e.c), y0 = py(e.b), y1 = py(e.d);
      if (e.flag) { for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) pl(x, y); }
      else {
        for (int x = x0; x <= x1; x++) { pl(x, y0); pl(x, y1); }
        for (int y = y0; y <= y1; y++) { pl(x0, y); pl(x1, y); }
      }
      break;
    }
    case P_CIRCLE: {
      const int mn = W < H ? W : H;
      const int r = (int)(((int32_t)e.c * (mn - 1)) / 65535);
      midpointCircle(pl, px(e.a), py(e.b), r, e.flag != 0);
      break;
    }
    default: {
      int xs[MAX_POINTS], ys[MAX_POINTS];
      for (int i = 0; i < e.npts; i++) { xs[i] = px(rd16(s.pkg + e.ptsOff + 4 * i)); ys[i] = py(rd16(s.pkg + e.ptsOff + 4 * i + 2)); }
      const int sz = e.size;
      for (int i = 0; i + 1 < e.npts; i++) bresenham(xs[i], ys[i], xs[i + 1], ys[i + 1], [&](int x, int y) { stamp(pl, x, y, sz); });
      if (e.flag) bresenham(xs[e.npts - 1], ys[e.npts - 1], xs[0], ys[0], [&](int x, int y) { stamp(pl, x, y, sz); });
    }
  }
}

/** Rend le tick `tick` (0..durationTicks−1) dans `fb` (indices de palette). `fb` doit avoir les dimensions de la scène. */
inline void renderTick(const Scene& s, Fb& fb, int tick) {
  fb.fill(s.backgroundIndex);
  for (int i = 0; i < s.entityCount; i++) {
    Ent e;
    if (decodeEnt(s.pkg, s.entPos[i], s.len - 4, e) == 0) return;   // jamais atteint après parse()
    drawEntity(s, e, tick, fb);
  }
}

// ─── Rectangles sales ────────────────────────────────────────────────────────

struct Rect { int x, y, w, h; bool valid; };

inline bool entityBox(const Scene& s, const Ent& e, int tick, int W, int H, int& x0, int& y0, int& x1, int& y1) {
  const bool wrap = e.mtype == M_LINEAR;
  const Off o = effectiveOffset(e, tick);
  auto px = [&](int32_t x) { return toPixel(x + o.x, W); };
  auto py = [&](int32_t y) { return toPixel(y + o.y, H); };
  auto lo = [](int sz) { return sz >> 1; };
  auto hi = [](int sz) { return sz - 1 - (sz >> 1); };
  switch (e.prim) {
    case P_POINT: x0 = px(e.a) - lo(e.size); x1 = px(e.a) + hi(e.size); y0 = py(e.b) - lo(e.size); y1 = py(e.b) + hi(e.size); break;
    case P_LINE: {
      const int ax = px(e.a), bx = px(e.c), ay = py(e.b), by = py(e.d);
      x0 = (ax < bx ? ax : bx) - lo(e.size); x1 = (ax > bx ? ax : bx) + hi(e.size);
      y0 = (ay < by ? ay : by) - lo(e.size); y1 = (ay > by ? ay : by) + hi(e.size);
      break;
    }
    case P_RECT: x0 = px(e.a); x1 = px(e.c); y0 = py(e.b); y1 = py(e.d); break;
    case P_CIRCLE: {
      const int mn = W < H ? W : H;
      const int r = (int)(((int32_t)e.c * (mn - 1)) / 65535);
      x0 = px(e.a) - r; x1 = px(e.a) + r; y0 = py(e.b) - r; y1 = py(e.b) + r;
      break;
    }
    default: {
      int mnx = 1 << 30, mny = 1 << 30, mxx = -(1 << 30), mxy = -(1 << 30);
      for (int i = 0; i < e.npts; i++) {
        const int x = px(rd16(s.pkg + e.ptsOff + 4 * i)), y = py(rd16(s.pkg + e.ptsOff + 4 * i + 2));
        growMin(mnx, x); growMax(mxx, x); growMin(mny, y); growMax(mxy, y);
      }
      x0 = mnx - lo(e.size); x1 = mxx + hi(e.size); y0 = mny - lo(e.size); y1 = mxy + hi(e.size);
    }
  }
  if (wrap) {
    if (x0 < 0 || x1 > W - 1) { x0 = 0; x1 = W - 1; }
    if (y0 < 0 || y1 > H - 1) { y0 = 0; y1 = H - 1; }
  } else {
    growMax(x0, 0); growMax(y0, 0); growMin(x1, W - 1); growMin(y1, H - 1);
  }
  return x0 <= x1 && y0 <= y1;
}

inline int prevTickOf(const Scene& s, int tick) { return (tick - 1 + s.durationTicks) % s.durationTicks; }

/** Zone conservative à retransmettre entre deux ticks (identique à dirtyRectBetween du moteur TypeScript). `valid=false` : rien ne change. */
inline Rect dirtyRectBetween(const Scene& s, int prevTick, int tick) {
  const int W = s.width, H = s.height;
  int ux0 = 1 << 30, uy0 = 1 << 30, ux1 = -(1 << 30), uy1 = -(1 << 30);
  for (int i = 0; i < s.entityCount; i++) {
    Ent e;
    if (decodeEnt(s.pkg, s.entPos[i], s.len - 4, e) == 0) continue;
    if (e.mtype == M_STATIC) continue;
    const Off a = effectiveOffset(e, prevTick), b = effectiveOffset(e, tick);
    if (a.x == b.x && a.y == b.y) continue;
    const int ticks[2] = { prevTick, tick };
    for (int k = 0; k < 2; k++) {
      int x0, y0, x1, y1;
      if (!entityBox(s, e, ticks[k], W, H, x0, y0, x1, y1)) continue;
      growMin(ux0, x0); growMin(uy0, y0); growMax(ux1, x1); growMax(uy1, y1);
    }
  }
  if (ux0 > ux1) return { 0, 0, 0, 0, false };
  return { ux0, uy0, ux1 - ux0 + 1, uy1 - uy0 + 1, true };
}

// ─── Sorties ─────────────────────────────────────────────────────────────────

/**
 * Pousse un rectangle vers l'écran, ligne par ligne, en RGB565 BIG-ENDIAN (octet de poids fort d'abord : ce qu'attend le ST7735
 * quand writePixels(..., bigEndian=true) ne swappe rien). `rowWords` : tampon ALIGNÉ 16 bits d'au moins r.w mots.
 * sink(rowWords, nbPixels, y) envoie la ligne (ex. tft.writePixels((uint16_t*)rowWords, n, true, true)).
 */
template <class Sink>
inline void presentRect(const Fb& fb, const Scene& s, const Rect& r, uint16_t* rowWords, Sink&& sink) {
  uint8_t* b = (uint8_t*)rowWords;
  for (int y = r.y; y < r.y + r.h; y++) {
    for (int i = 0; i < r.w; i++) {
      const uint16_t c = s.palette[fb.get(r.x + i, y)];
      b[2 * i] = (uint8_t)(c >> 8);
      b[2 * i + 1] = (uint8_t)(c & 0xFF);
    }
    sink(rowWords, r.w, y);
  }
}

/** Frame complète en RGB565 little-endian (format du serveur / des golden vectors). `out` : width×height×2 octets. */
inline void toRgb565LE(const Fb& fb, const Scene& s, uint8_t* out) {
  for (int y = 0; y < fb.h; y++) for (int x = 0; x < fb.w; x++) {
    const uint16_t c = s.palette[fb.get(x, y)];
    const size_t o = ((size_t)y * fb.w + x) * 2;
    out[o] = (uint8_t)(c & 0xFF); out[o + 1] = (uint8_t)(c >> 8);
  }
}

/** Frame OLED page-major 1 bit/pixel (allumé = couleur ≠ fond). `out` : width×height/8 octets, mis à zéro ici. */
inline void toOledBuffer(const Fb& fb, const Scene& s, uint8_t* out) {
  memset(out, 0, (size_t)fb.w * fb.h / 8);
  const uint16_t bg = s.palette[s.backgroundIndex];
  for (int y = 0; y < fb.h; y++) for (int x = 0; x < fb.w; x++)
    if (s.palette[fb.get(x, y)] != bg) out[(y >> 3) * fb.w + x] |= (uint8_t)(1 << (y & 7));
}

/** Cadence réelle : min(tickRate de la scène, maxFps de l'écran). Aucun tick n'est sauté (voir docs/SCENE_V1_MOTEUR.md §4). */
inline int effectiveFps(const Scene& s, int maxFps) { return s.tickRate < maxFps ? s.tickRate : maxFps; }

}  // namespace anascene
