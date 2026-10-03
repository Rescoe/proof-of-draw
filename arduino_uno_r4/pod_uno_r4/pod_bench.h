// pod_bench.h — lecteur de « clips » du banc d'essai d'animation (UNO R4 WiFi + TFT 2.8" ILI9341, 240×320).
//
// Format PBC1 : voir lib/bench/clip.ts (même contrat, vérifié octet pour octet par tests/podBenchR4.test.ts).
// Principe : une animation 1 bit au format OLED (128×64) est envoyée sous forme de DIFFÉRENCES entre images. L'écran garde l'image N-1 dans
// sa propre mémoire ; la R4 ne tient qu'une copie 1 Ko de l'image courante, applique chaque différence et ne repeint QUE les octets modifiés.
// Agrandissement ×1,875 (= 15/8) : un octet source (8 pixels) occupe EXACTEMENT 15 pixels de large, sans trou ni chevauchement ; un pixel
// source fait 1 ou 2 pixels (motif 2,2,2,2,2,2,2,1) et une ligne source 1 ou 2 lignes. La zone 240×120 est centrée verticalement (y = 100).
//
// Aucune dépendance Arduino : compilé avec g++ et rejoué contre le décodeur TypeScript (host/bench_harness.cpp).

#ifndef POD_BENCH_H
#define POD_BENCH_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace podbench {

static const int W = 128, H = 64, ROW_BYTES = 16, FRAME_BYTES = 1024, HEADER_BYTES = 20;
static const int MAX_FRAMES = 64, MAX_LOOPS = 100;
static const int REG_Y = 100;           // haut de la zone 240×120 sur l'écran 240×320

enum Err : uint8_t { OK = 0, ERR_SHORT, ERR_MAGIC, ERR_VERSION, ERR_GEOM, ERR_COUNTS, ERR_SIZE, ERR_CRC, ERR_BODY };
inline const char* errName(Err e) {
  switch (e) {
    case OK: return "OK"; case ERR_SHORT: return "SHORT"; case ERR_MAGIC: return "MAGIC"; case ERR_VERSION: return "VERSION";
    case ERR_GEOM: return "GEOM"; case ERR_COUNTS: return "COUNTS"; case ERR_SIZE: return "SIZE"; case ERR_CRC: return "CRC"; default: return "BODY";
  }
}

inline uint32_t crc32(const uint8_t* p, size_t n) {
  uint32_t c = 0xFFFFFFFFu;
  for (size_t i = 0; i < n; i++) { c ^= p[i]; for (int k = 0; k < 8; k++) c = (c & 1) ? (c >> 1) ^ 0xEDB88320u : (c >> 1); }
  return ~c;
}
inline uint16_t rd16(const uint8_t* p) { return (uint16_t)(p[0] | (p[1] << 8)); }
inline uint32_t rd32(const uint8_t* p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

struct Clip {
  uint16_t frames, transitions;
  uint8_t  loops, delay0;            // delay0 : × 10 ms
  uint16_t fg, bg;                   // RGB565 des pixels allumés / éteints
  const uint8_t* frame0;             // 1024 octets
  const uint8_t* trans;              // première transition
  const uint8_t* end;                // fin du corps
};

/** Parcourt UNE transition (déjà validée) : applique ses runs à `cur` si non nul, retourne la suite ; nullptr si invalide. */
inline const uint8_t* walkTransition(const uint8_t* p, const uint8_t* end, uint8_t* cur, uint8_t* delay) {
  if (end - p < 3) return nullptr;
  const uint8_t d = p[0];
  if (d < 2) return nullptr;
  const uint16_t runs = rd16(p + 1);
  p += 3;
  for (uint16_t r = 0; r < runs; r++) {
    if (end - p < 3) return nullptr;
    const uint16_t off = rd16(p); const uint8_t len = p[2];
    p += 3;
    if (len < 1 || (int)off + len > FRAME_BYTES || end - p < (ptrdiff_t)len) return nullptr;
    if (cur) memcpy(cur + off, p, len);
    p += len;
  }
  if (delay) *delay = d;
  return p;
}

/**
 * Valide ENTIÈREMENT le clip (en-tête, CRC, structure, retour à l'image 0) et remplit `c`. `scratch` : 1024 octets de travail
 * (le tampon « image courante » du lecteur convient : il est réécrit au début de la lecture).
 */
inline Err parse(const uint8_t* p, size_t n, Clip& c, uint8_t* scratch) {
  if (n < (size_t)HEADER_BYTES + 4) return ERR_SHORT;
  if (memcmp(p, "PBC1", 4) != 0) return ERR_MAGIC;
  if (p[4] != 1) return ERR_VERSION;
  if (p[5] != W || p[6] != H || p[7] != 0 || p[11] != 0) return ERR_GEOM;
  const uint16_t frames = rd16(p + 8), trans = rd16(p + 16), body = rd16(p + 18);
  const uint8_t loops = p[10];
  if (frames < 1 || frames > MAX_FRAMES || loops > MAX_LOOPS) return ERR_COUNTS;      // loops = 0 : en boucle jusqu'à ce que le hook s'arrête
  if (trans != (frames > 1 ? frames : 0)) return ERR_COUNTS;
  if ((size_t)HEADER_BYTES + body + 4 != n) return ERR_SIZE;
  if (rd32(p + HEADER_BYTES + body) != crc32(p, (size_t)HEADER_BYTES + body)) return ERR_CRC;

  const uint8_t* q = p + HEADER_BYTES;
  const uint8_t* end = q + body;
  if (end - q < 1 + FRAME_BYTES) return ERR_BODY;
  const uint8_t d0 = q[0];
  if (d0 < 2) return ERR_BODY;
  c.frames = frames; c.transitions = trans; c.loops = loops; c.delay0 = d0;
  c.fg = rd16(p + 12); c.bg = rd16(p + 14);
  c.frame0 = q + 1; c.trans = q + 1 + FRAME_BYTES; c.end = end;

  memcpy(scratch, c.frame0, FRAME_BYTES);
  const uint8_t* t = c.trans;
  for (uint16_t i = 1; i <= trans; i++) {
    uint8_t d = 0;
    t = walkTransition(t, end, scratch, &d);
    if (!t) return ERR_BODY;
    if (i == trans && (d != d0 || memcmp(scratch, c.frame0, FRAME_BYTES) != 0)) return ERR_BODY;   // la dernière transition ramène à l'image 0
  }
  if (t != end) return ERR_BODY;
  return OK;
}

// ─── Agrandissement ×15/8 et peinture ──────────────────────────────────────
inline int ux(int sx) { return (sx * 15) / 8; }   // colonne destination du pixel source sx (début)
inline int uy(int sy) { return (sy * 15) / 8; }

/**
 * Peint `len` octets consécutifs (8 px chacun) de la ligne source y, à partir de l'octet b0 : fenêtre de 15·len × (1 ou 2) pixels. rowBuf ≥ 240 pixels.
 * L'appelant a ouvert UNE transaction (startWrite) pour toute la transition : une transaction par segment coûtait cher sur la R4.
 */
template <class Tft>
inline void paintSegment(Tft& tft, const uint8_t* cur, int y, int b0, int len, uint16_t fg, uint16_t bg, uint16_t* rowBuf) {
  uint8_t* d = (uint8_t*)rowBuf;
  const uint8_t fh = (uint8_t)(fg >> 8), fl = (uint8_t)(fg & 0xFF), bh = (uint8_t)(bg >> 8), bl = (uint8_t)(bg & 0xFF);
  int o = 0;
  for (int b = b0; b < b0 + len; b++) {
    const uint8_t v = cur[y * ROW_BYTES + b];
    for (int bit = 0; bit < 8; bit++) {
      const int sx = b * 8 + bit, cnt = ux(sx + 1) - ux(sx);
      const bool on = (v >> (7 - bit)) & 1;
      for (int k = 0; k < cnt; k++) { d[o++] = on ? fh : bh; d[o++] = on ? fl : bl; }
    }
  }
  const int h = uy(y + 1) - uy(y), wpx = 15 * len;
  tft.setAddrWindow(ux(b0 * 8), REG_Y + uy(y), wpx, h);
  for (int k = 0; k < h; k++) tft.writePixels(rowBuf, wpx, true, true);   // bigEndian = true : octets déjà dans l'ordre du bus
}

template <class Tft>
inline void paintFull(Tft& tft, const uint8_t* cur, uint16_t fg, uint16_t bg, uint16_t* rowBuf) {
  tft.startWrite();
  for (int y = 0; y < H; y++) paintSegment(tft, cur, y, 0, ROW_BYTES, fg, bg, rowBuf);
  tft.endWrite();
}

/** Applique une transition à `cur` ET repeint les seuls octets modifiés ; retourne la suite. (Le clip a été validé par parse().) */
template <class Tft>
inline const uint8_t* applyTransition(Tft& tft, const uint8_t* p, uint8_t* cur, uint16_t fg, uint16_t bg, uint16_t* rowBuf, uint8_t* delay) {
  *delay = p[0];
  const uint16_t runs = rd16(p + 1);
  p += 3;
  tft.startWrite();                              // UNE transaction SPI pour toute la transition
  for (uint16_t r = 0; r < runs; r++) {
    int off = rd16(p), len = p[2];
    p += 3;
    memcpy(cur + off, p, len);
    p += len;
    while (len > 0) {                           // un run peut franchir une fin de ligne : on le coupe par ligne source
      const int y = off / ROW_BYTES, b0 = off % ROW_BYTES;
      const int seg = (ROW_BYTES - b0) < len ? (ROW_BYTES - b0) : len;
      paintSegment(tft, cur, y, b0, seg, fg, bg, rowBuf);
      off += seg; len -= seg;
    }
  }
  tft.endWrite();
  return p;
}

/**
 * Joue le clip : image 0 entière, puis les transitions ; à chaque boucle suivante : retour à l'image 0 puis les transitions.
 * hook(indexImageAffichée, délai ms) est appelé APRÈS chaque image peinte ; il attend le délai et retourne false pour interrompre.
 * `cur` : 1024 octets de travail. Retourne false si le hook a interrompu la lecture.
 */
template <class Tft, class Hook>
inline bool play(const Clip& c, uint8_t* cur, Tft& tft, uint16_t* rowBuf, Hook&& hook) {
  memcpy(cur, c.frame0, FRAME_BYTES);
  paintFull(tft, cur, c.fg, c.bg, rowBuf);
  uint32_t shown = 0;
  if (!hook(shown++, (uint16_t)c.delay0 * 10)) return false;
  if (c.frames == 1) {                          // image fixe : on la garde le temps de `loops` délais (loops = 0 : jusqu'à l'arrêt du hook)
    for (int l = 1; c.loops == 0 || l < c.loops; l++) if (!hook(shown++, (uint16_t)c.delay0 * 10)) return false;
    return true;
  }
  const uint8_t* wrap = nullptr;
  for (int l = 0; c.loops == 0 || l < c.loops; l++) {
    uint8_t d = 0;
    if (l > 0) {                                // retour à l'image 0 (dernière transition du clip)
      applyTransition(tft, wrap, cur, c.fg, c.bg, rowBuf, &d);
      if (!hook(shown++, (uint16_t)d * 10)) return false;
    }
    const uint8_t* t = c.trans;
    for (int i = 1; i < c.frames; i++) {
      t = applyTransition(tft, t, cur, c.fg, c.bg, rowBuf, &d);
      if (!hook(shown++, (uint16_t)d * 10)) return false;
    }
    wrap = t;
  }
  return true;
}

}  // namespace podbench

#endif  // POD_BENCH_H
