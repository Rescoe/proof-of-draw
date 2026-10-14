// bench_stream_harness.cpp — banc d'essai PC de pod_bench_stream.h (PAS du firmware : compilé seulement par tests/animStream.test.ts). LOT8B2E ANIM-STREAM-FIX1.
//
//   bench_stream_harness validate_batch <lignes.txt>   → un clip hexa par ligne ; une réponse par ligne : "<parse> <flux>" (« OK » ou nom d'erreur), parse() = lecteur en RAM de référence
//   bench_stream_harness play  <clip.hex> [max]         → lecture EN FLUX sur un faux TFT 240×320 : écran après CHAQUE image sur stdout ; stderr « shown=N windows=N overflow=N underfill=N pixels=N begins=N readsInTxn=N maxPos=N »
//   bench_stream_harness trace <clip.hex> [max]         → lecteur en RAM (podbench::play) ET lecteur en flux : mêmes fenêtres, mêmes pixels, mêmes délais d'images ; « SAME <n> » ou « DIFF … »
//   bench_stream_harness fault <clip.hex> <k>           → la source échoue à la k-ième lecture : « VALIDATE <nom> » ou « PLAY <fin> » (jamais de plantage ; aucune lecture hors des bornes)
// readsInTxn : nombre de lectures de la SOURCE faites pendant qu'une transaction TFT est ouverte (le bus SPI est partagé avec la carte) : DOIT valoir 0.

#include "../pod_bench_stream.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <string>

static long g_txnOpen = 0, g_readsInTxn = 0;

struct MemSource {
  const std::vector<uint8_t>& v; size_t pos = 0; long reads = 0, failAt = -1; size_t maxPos = 0;
  explicit MemSource(const std::vector<uint8_t>& d) : v(d) {}
  bool read(uint8_t* d, size_t n) {
    reads++;
    if (g_txnOpen > 0) g_readsInTxn++;
    if (failAt >= 0 && reads >= failAt) return false;
    if (pos + n > v.size()) return false;
    memcpy(d, v.data() + pos, n); pos += n; if (pos > maxPos) maxPos = pos; return true;
  }
  bool seek(uint32_t p) { if (p > v.size()) return false; pos = p; return true; }
};

struct FakeTft {
  std::vector<uint16_t> screen;
  int wx = 0, wy = 0, ww = 0, wh = 0, cx = 0, cy = 0;
  bool open = false;
  long windows = 0, overflow = 0, underfill = 0, pixels = 0, begins = 0, depth = 0;
  uint64_t hash = 1469598103934665603ULL;               // empreinte de la suite (fenêtre, pixels)
  FakeTft() : screen(240 * 320, 0) {}
  void mix(uint64_t x) { hash ^= x; hash *= 1099511628211ULL; }
  void closeWindow() { if (open && !(cx == 0 && cy == wh)) underfill++; open = false; }
  void startWrite() { begins++; depth++; g_txnOpen++; }
  void endWrite() { closeWindow(); depth--; g_txnOpen--; }
  void setAddrWindow(int x, int y, int w, int h) {
    closeWindow();
    if (depth <= 0 || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 240 || y + h > 320) overflow++;
    wx = x; wy = y; ww = w; wh = h; cx = 0; cy = 0; open = true; windows++;
    mix((uint64_t)x << 48 | (uint64_t)y << 32 | (uint64_t)w << 16 | (uint64_t)h);
  }
  void writePixels(uint16_t* colors, uint32_t len, bool, bool bigEndian) {
    const uint8_t* b = (const uint8_t*)colors;
    if (depth <= 0) overflow++;
    for (uint32_t i = 0; i < len; i++) {
      const uint16_t v = bigEndian ? (uint16_t)((b[2 * i] << 8) | b[2 * i + 1]) : (uint16_t)((b[2 * i + 1] << 8) | b[2 * i]);
      mix(v);
      if (cy >= wh) { overflow++; continue; }
      const int x = wx + cx, y = wy + cy;
      if (x >= 0 && x < 240 && y >= 0 && y < 320) screen[(size_t)y * 240 + x] = v; else overflow++;
      pixels++;
      if (++cx == ww) { cx = 0; cy++; }
    }
  }
  void fill(uint16_t c) { for (auto& p : screen) p = c; }
  void dump() const {
    std::vector<uint8_t> out(screen.size() * 2);
    for (size_t i = 0; i < screen.size(); i++) { out[2 * i] = (uint8_t)(screen[i] & 0xFF); out[2 * i + 1] = (uint8_t)(screen[i] >> 8); }
    fwrite(out.data(), 1, out.size(), stdout); fflush(stdout);
  }
};

static std::vector<uint8_t> hexLine(FILE* f, bool* eof) {
  std::vector<uint8_t> out; int hi = -1, c; *eof = false;
  while ((c = fgetc(f)) != EOF) {
    if (c == '\n') return out;
    int v = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : -1;
    if (v < 0) continue;
    if (hi < 0) hi = v; else { out.push_back((uint8_t)((hi << 4) | v)); hi = -1; }
  }
  *eof = true;
  return out;
}

int main(int argc, char** argv) {
  if (argc < 3) return 2;
  const std::string cmd = argv[1];
  FILE* f = fopen(argv[2], "rb");
  if (!f) return 2;
  using namespace podbench;
  std::vector<uint8_t> cur(FRAME_BYTES), buf(PODBENCH_STREAM_BUF), scratch(FRAME_BYTES);

  if (cmd == "validate_batch") {
    for (;;) {
      bool eof; std::vector<uint8_t> clip = hexLine(f, &eof);
      if (eof && clip.empty()) break;
      Clip c; const Err e = parse(clip.data(), clip.size(), c, scratch.data());
      MemSource src(clip); StreamInfo si;
      const Err s = validateStream(src, clip.size(), si, cur.data(), buf.data());
      printf("%s %s\n", e == OK ? "OK" : errName(e), s == OK ? "OK" : errNameStream(s));
      if (eof) break;
    }
    return 0;
  }

  bool eof; std::vector<uint8_t> clip = hexLine(f, &eof);
  const uint32_t maxShown = argc > 3 ? (uint32_t)atoi(argv[3]) : 0xFFFFFFFFu;
  static uint16_t rowBuf[240];
  MemSource src(clip); StreamInfo si;
  const Err s = validateStream(src, clip.size(), si, cur.data(), buf.data());

  if (cmd == "play") {
    if (s != OK) { fprintf(stderr, "clip refusé: %s\n", errNameStream(s)); return 3; }
    FakeTft tft; tft.fill(si.bg);
    uint32_t shown = 0;
    g_readsInTxn = 0;
    playStream(src, si, cur.data(), buf.data(), tft, rowBuf, [&](uint32_t, uint16_t) { tft.dump(); shown++; return shown < maxShown; });
    fprintf(stderr, "shown=%u windows=%ld overflow=%ld underfill=%ld pixels=%ld begins=%ld readsInTxn=%ld maxPos=%zu\n", shown, tft.windows, tft.overflow, tft.underfill, tft.pixels, tft.begins, g_readsInTxn, src.maxPos);
    return 0;
  }
  if (cmd == "trace") {
    Clip c; const Err e = parse(clip.data(), clip.size(), c, scratch.data());
    if (e != OK || s != OK) { printf("REFUSED %s %s\n", e == OK ? "OK" : errName(e), s == OK ? "OK" : errNameStream(s)); return 0; }
    FakeTft a, b; a.fill(c.bg); b.fill(si.bg);
    std::vector<uint32_t> da, db;
    std::vector<uint8_t> cur2(FRAME_BYTES);
    uint32_t na = 0, nb = 0;
    play(c, cur.data(), a, rowBuf, [&](uint32_t i, uint16_t d) { da.push_back(i * 1000u + d); na++; return na < maxShown; });
    g_readsInTxn = 0;
    playStream(src, si, cur2.data(), buf.data(), b, rowBuf, [&](uint32_t i, uint16_t d) { db.push_back(i * 1000u + d); nb++; return nb < maxShown; });
    const bool same = da == db && a.hash == b.hash && a.screen == b.screen && a.pixels == b.pixels && a.windows == b.windows && b.overflow == 0 && b.underfill == 0 && g_readsInTxn == 0;
    if (same) printf("SAME %u windows=%ld pixels=%ld begins_ref=%ld begins_stream=%ld\n", na, a.windows, a.pixels, a.begins, b.begins);
    else printf("DIFF hooks=%d/%d hash=%d screen=%d pixels=%ld/%ld windows=%ld/%ld overflow=%ld underfill=%ld readsInTxn=%ld\n", (int)(da == db), (int)da.size() , (int)(a.hash == b.hash), (int)(a.screen == b.screen), a.pixels, b.pixels, a.windows, b.windows, b.overflow, b.underfill, g_readsInTxn);
    return 0;
  }
  if (cmd == "fault") {                                 // fault <clip> <k> v|p : la source échoue à la k-ième lecture de la validation (v) ou de la lecture (p)
    const long k = argc > 3 ? atol(argv[3]) : 1;
    const bool inValidate = argc > 4 && argv[4][0] == 'v';
    MemSource vs(clip); vs.failAt = inValidate ? k : -1; StreamInfo fi;
    const Err ve = validateStream(vs, clip.size(), fi, cur.data(), buf.data());
    if (inValidate) { printf("VALIDATE %s\n", errNameStream(ve)); return 0; }
    if (ve != OK) { printf("VALIDATE %s\n", errNameStream(ve)); return 0; }
    MemSource ps(clip); ps.failAt = k; FakeTft tft; tft.fill(fi.bg);
    g_readsInTxn = 0; uint32_t shown = 0;
    const PlayEnd pe = playStream(ps, fi, cur.data(), buf.data(), tft, rowBuf, [&](uint32_t, uint16_t) { shown++; return shown < 40u; });
    printf("PLAY %d overflow=%ld readsInTxn=%ld\n", (int)pe, tft.overflow, g_readsInTxn);
    return 0;
  }
  return 2;
}
