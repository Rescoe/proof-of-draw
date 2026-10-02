// scale_harness.cpp — banc d'essai PC de l'affichage UNO R4 (pod_scale.h + ana_scene_v1.h) : PAS du firmware.
//
// Simule un ILI9341 : fenêtre d'adresse (setAddrWindow), curseur qui avance en lignes dans la fenêtre, pixels reçus en RGB565
// BIG-endian — exactement ce que fait Adafruit_ILI9341::writePixels(..., bigEndian=true) sur le firmware.
//
//   scale_harness scene <paquet.hex> <boucles>   → écran 240×320 (RGB565 LE) après CHAQUE tick, lu comme playScene() du firmware
//   scale_harness frame <image.bin>              → écran après l'affichage d'une image fixe 128×160 RGB565 LE (comme streamFrame)
// Sur stderr : « windows=N overflow=N underfill=N » (un débordement ou un remplissage incomplet de fenêtre = bug d'agrandissement).

#include "../pod_scale.h"
#include "../ana_scene_v1.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <string>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

static const int SCR_W = 240, SCR_H = 320, ART_X = 24, ART_Y = 40, SRC_W = 128, SRC_H = 160;

struct FakeTft {
  std::vector<uint16_t> screen = std::vector<uint16_t>((size_t)SCR_W * SCR_H, 0);
  int wx = 0, wy = 0, ww = 0, wh = 0, cx = 0, cy = 0;
  bool open = false;
  long windows = 0, overflow = 0, underfill = 0;

  void closeWindow() { if (open && !(cx == 0 && cy == wh)) underfill++; open = false; }
  void startWrite() {}
  void endWrite() { closeWindow(); }
  void setAddrWindow(int x, int y, int w, int h) {
    closeWindow();
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > SCR_W || y + h > SCR_H) { overflow++; }
    wx = x; wy = y; ww = w; wh = h; cx = 0; cy = 0; open = true; windows++;
  }
  void writePixels(uint16_t* colors, uint32_t len, bool /*block*/, bool bigEndian) {
    const uint8_t* b = (const uint8_t*)colors;
    for (uint32_t i = 0; i < len; i++) {
      const uint16_t v = bigEndian ? (uint16_t)((b[2 * i] << 8) | b[2 * i + 1]) : (uint16_t)((b[2 * i + 1] << 8) | b[2 * i]);
      if (cy >= wh) { overflow++; continue; }
      const int x = wx + cx, y = wy + cy;
      if (x >= 0 && x < SCR_W && y >= 0 && y < SCR_H) screen[(size_t)y * SCR_W + x] = v; else overflow++;
      if (++cx == ww) { cx = 0; cy++; }
    }
  }
  void dump() const {
    std::vector<uint8_t> out(screen.size() * 2);
    for (size_t i = 0; i < screen.size(); i++) { out[2 * i] = (uint8_t)(screen[i] & 0xFF); out[2 * i + 1] = (uint8_t)(screen[i] >> 8); }
    fwrite(out.data(), 1, out.size(), stdout);
    fflush(stdout);
  }
};

static std::vector<uint8_t> readHex(const char* path) {
  std::vector<uint8_t> out;
  FILE* f = fopen(path, "rb");
  if (!f) { fprintf(stderr, "ouverture impossible\n"); exit(2); }
  int hi = -1, c;
  while ((c = fgetc(f)) != EOF) {
    int v = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : -1;
    if (v < 0) continue;
    if (hi < 0) hi = v; else { out.push_back((uint8_t)((hi << 4) | v)); hi = -1; }
  }
  fclose(f);
  return out;
}

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  if (argc < 3) return 2;
  const std::string cmd = argv[1];
  FakeTft tft;
  static uint16_t srcRow[SRC_W], dstRow[192];

  if (cmd == "frame") {
    FILE* f = fopen(argv[2], "rb");
    if (!f) return 2;
    std::vector<uint8_t> img((size_t)SRC_W * SRC_H * 2);
    if (fread(img.data(), 1, img.size(), f) != img.size()) return 2;
    fclose(f);
    // Identique à streamFrame() : conversion LE -> BE sur place, puis une ligne agrandie répétée 1 ou 2 fois
    podscale::openWindow(tft, ART_X, ART_Y, 0, 0, SRC_W, SRC_H);
    uint8_t* be = (uint8_t*)srcRow;
    for (int y = 0; y < SRC_H; y++) {
      memcpy(be, img.data() + (size_t)y * SRC_W * 2, SRC_W * 2);
      for (int i = 0; i < SRC_W * 2; i += 2) { const uint8_t t = be[i]; be[i] = be[i + 1]; be[i + 1] = t; }
      podscale::pushRow(tft, be, 0, SRC_W, y, dstRow);
    }
    tft.endWrite();
    tft.dump();
    fprintf(stderr, "windows=%ld overflow=%ld underfill=%ld\n", tft.windows, tft.overflow, tft.underfill);
    return 0;
  }

  if (cmd == "scene") {
    using namespace anascene;
    std::vector<uint8_t> pkg = readHex(argv[2]);
    const int loops = argc > 3 ? atoi(argv[3]) : 1;
    Scene s;
    if (parse(pkg.data(), pkg.size(), PROFILE_TFT, s) != OK) { fprintf(stderr, "paquet refusé\n"); return 3; }
    std::vector<uint8_t> mem(Fb::bytesFor(SRC_W, SRC_H));
    Fb fb; fb.init(mem.data(), SRC_W, SRC_H);
    const int total = s.durationTicks * loops;
    for (int step = 0; step < total; step++) {       // = playScene() du firmware, sans l'horloge
      const int tick = step % s.durationTicks;
      renderTick(s, fb, tick);
      Rect r;
      if (step == 0) r = { 0, 0, SRC_W, SRC_H, true };
      else           r = dirtyRectBetween(s, prevTickOf(s, tick), tick);
      if (r.valid) {
        podscale::openWindow(tft, ART_X, ART_Y, r.x, r.y, r.w, r.h);
        presentRect(fb, s, r, srcRow, [&](const uint16_t* row, int n, int y) { podscale::pushRow(tft, (const uint8_t*)row, r.x, n, y, dstRow); });
        tft.endWrite();
      }
      tft.dump();
    }
    fprintf(stderr, "windows=%ld overflow=%ld underfill=%ld\n", tft.windows, tft.overflow, tft.underfill);
    return 0;
  }
  return 2;
}
