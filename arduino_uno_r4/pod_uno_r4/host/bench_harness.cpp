// bench_harness.cpp — banc d'essai PC de pod_bench.h (PAS du firmware : compilé seulement par tests/podBenchR4.test.ts).
//
//   bench_harness parse <clip.hex>            → "OK frames loops fg bg" | "ERR NOM"
//   bench_harness play  <clip.hex> [max]      → TFT 2.8" : écran 240×320 RGB565 LE (fond = couleur « éteint ») après CHAQUE image affichée, sur stdout ;
//                                               sur stderr : « shown=N windows=N overflow=N underfill=N pixels=N begins=N »
//   bench_harness play1 <clip.hex> [max]      → TFT 1.8" : même chose avec l'écran 128×160 et GeoOne<48> (zone 128×64 à y = 48)
//   bench_harness playbmp <clip.hex> [max]    → OLED : les 1024 octets de l'image présentée après CHAQUE image affichée ; stderr « shown=N presents=N »
//   bench_harness validate_batch <lignes.txt> → un clip hexa par ligne ; une réponse par ligne : "OK" | "ERR NOM"
// Faux ILI9341 / ST7735 : fenêtre d'adresse + curseur qui avance en lignes, pixels reçus en RGB565 BIG-endian (comme Adafruit_SPITFT::writePixels(…, true)).

#include "../pod_bench.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <string>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

struct FakeTft {
  const int SCR_W, SCR_H;
  std::vector<uint16_t> screen;
  int wx = 0, wy = 0, ww = 0, wh = 0, cx = 0, cy = 0;
  bool open = false;
  long windows = 0, overflow = 0, underfill = 0, pixels = 0, begins = 0;

  FakeTft(int w, int h) : SCR_W(w), SCR_H(h), screen((size_t)w * h, 0) {}
  void closeWindow() { if (open && !(cx == 0 && cy == wh)) underfill++; open = false; }
  void startWrite() { begins++; }                 // transactions SPI ouvertes (une par image affichée attendue)
  void endWrite() { closeWindow(); }
  void setAddrWindow(int x, int y, int w, int h) {
    closeWindow();
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > SCR_W || y + h > SCR_H) overflow++;
    wx = x; wy = y; ww = w; wh = h; cx = 0; cy = 0; open = true; windows++;
  }
  void writePixels(uint16_t* colors, uint32_t len, bool, bool bigEndian) {
    const uint8_t* b = (const uint8_t*)colors;
    for (uint32_t i = 0; i < len; i++) {
      const uint16_t v = bigEndian ? (uint16_t)((b[2 * i] << 8) | b[2 * i + 1]) : (uint16_t)((b[2 * i + 1] << 8) | b[2 * i]);
      if (cy >= wh) { overflow++; continue; }
      const int x = wx + cx, y = wy + cy;
      if (x >= 0 && x < SCR_W && y >= 0 && y < SCR_H) screen[(size_t)y * SCR_W + x] = v; else overflow++;
      pixels++;
      if (++cx == ww) { cx = 0; cy++; }
    }
  }
  void fill(uint16_t c) { for (auto& p : screen) p = c; }
  void dump() const {
    std::vector<uint8_t> out(screen.size() * 2);
    for (size_t i = 0; i < screen.size(); i++) { out[2 * i] = (uint8_t)(screen[i] & 0xFF); out[2 * i + 1] = (uint8_t)(screen[i] >> 8); }
    fwrite(out.data(), 1, out.size(), stdout);
    fflush(stdout);
  }
};

/** Faux OLED : mémorise la dernière image présentée, la copie sur stdout à chaque present(). */
struct FakeOled {
  long presents = 0;
  void present(const uint8_t* frame) { presents++; fwrite(frame, 1, podbench::FRAME_BYTES, stdout); fflush(stdout); }
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
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  if (argc < 3) return 2;
  const std::string cmd = argv[1];
  FILE* f = fopen(argv[2], "rb");
  if (!f) return 2;
  using namespace podbench;
  std::vector<uint8_t> scratch(FRAME_BYTES);

  if (cmd == "validate_batch") {
    for (;;) {
      bool eof; std::vector<uint8_t> clip = hexLine(f, &eof);
      if (eof && clip.empty()) break;
      Clip c; const Err e = parse(clip.data(), clip.size(), c, scratch.data());
      if (e == OK) printf("OK\n"); else printf("ERR %s\n", errName(e));
      if (eof) break;
    }
    return 0;
  }

  bool eof; std::vector<uint8_t> clip = hexLine(f, &eof);
  Clip c;
  const Err e = parse(clip.data(), clip.size(), c, scratch.data());
  if (cmd == "parse") {
    if (e == OK) printf("OK %d %d %d %d\n", c.frames, c.loops, c.fg, c.bg); else printf("ERR %s\n", errName(e));
    return 0;
  }
  const uint32_t maxShown = argc > 3 ? (uint32_t)atoi(argv[3]) : 0xFFFFFFFFu;   // clip en boucle (loops = 0) : on s'arrête après max images
  if (cmd == "play" || cmd == "play1") {
    if (e != OK) { fprintf(stderr, "clip refusé: %s\n", errName(e)); return 3; }
    const bool one = cmd == "play1";
    FakeTft tft(one ? 128 : 240, one ? 160 : 320); tft.fill(c.bg);
    static uint16_t rowBuf[240];
    uint32_t shown = 0;
    auto hook = [&](uint32_t, uint16_t) { tft.dump(); shown++; return shown < maxShown; };
    if (one) play<GeoOne<48> >(c, scratch.data(), tft, rowBuf, hook);
    else play(c, scratch.data(), tft, rowBuf, hook);
    fprintf(stderr, "shown=%u windows=%ld overflow=%ld underfill=%ld pixels=%ld begins=%ld\n", shown, tft.windows, tft.overflow, tft.underfill, tft.pixels, tft.begins);
    return 0;
  }
  if (cmd == "playbmp") {
    if (e != OK) { fprintf(stderr, "clip refusé: %s\n", errName(e)); return 3; }
    FakeOled oled;
    uint32_t shown = 0;
    playBitmap(c, scratch.data(), oled, [&](uint32_t, uint16_t) { shown++; return shown < maxShown; });
    fprintf(stderr, "shown=%u presents=%ld\n", shown, oled.presents);
    return 0;
  }
  return 2;
}
