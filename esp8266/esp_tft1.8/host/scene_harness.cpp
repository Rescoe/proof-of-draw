// scene_harness.cpp — banc d'essai PC du lecteur firmware ana_scene_v1.h (PAS du firmware : compilé seulement par les tests).
// Appelle exactement les mêmes fonctions que l'ESP8266 ; tests/sceneV1Firmware.test.ts compare sa sortie au moteur TypeScript.
//
//   scene_harness validate <fichier.hex> <oled|tft>          → "OK w h tickRate duration loops entities" | "ERR NOM"
//   scene_harness frame    <fichier.hex> <oled|tft> <tick>   → octets bruts : TFT = RGB565 LE (w·h·2), OLED = page-major (w·h/8)
//   scene_harness dirty    <fichier.hex> <tft> <prev> <tick> → "x y w h" | "none"
//   scene_harness sequence <fichier.hex> <tft> <loops> <rects.txt>
//        Simule la lecture : tick 0 plein écran, puis seulement les rectangles sales ; écrit sur stdout l'« écran » (RGB565 LE)
//        après CHAQUE tick, et dans rects.txt une ligne par tick ("x y w h" | "none" | "full").
//   scene_harness crc <fichier.hex>                          → crc32 du fichier décodé (hex 8)
//   scene_harness validate_batch <lignes.txt> -              → un paquet hexa par ligne ; une réponse par ligne : "OK" | "ERR NOM"
//        Le profil attendu est lu dans l'octet 6 de chaque paquet (1 = oled, sinon tft) : on compare les RÈGLES, pas le profil.

#include "../ana_scene_v1.h"
#include <stdio.h>
#include <stdlib.h>
#include <vector>
#include <string>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

using namespace anascene;

static std::vector<uint8_t> readHex(const char* path) {
  std::vector<uint8_t> out;
  FILE* f = fopen(path, "rb");
  if (!f) { fprintf(stderr, "ouverture impossible: %s\n", path); exit(2); }
  int hi = -1, c;
  while ((c = fgetc(f)) != EOF) {
    int v = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : -1;
    if (v < 0) continue;
    if (hi < 0) hi = v; else { out.push_back((uint8_t)((hi << 4) | v)); hi = -1; }
  }
  fclose(f);
  return out;
}

static void writeBin(const uint8_t* p, size_t n) {
  fwrite(p, 1, n, stdout);
  fflush(stdout);
}

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  if (argc < 3) { fprintf(stderr, "usage: voir l'en-tête du fichier\n"); return 2; }
  const std::string cmd = argv[1];

  if (cmd == "validate_batch") {
    FILE* f = fopen(argv[2], "rb");
    if (!f) return 2;
    std::vector<uint8_t> cur;
    int hi = -1, c;
    auto flush = [&]() {
      Scene s;
      const uint8_t prof = (cur.size() > 6 && cur[6] == PROFILE_OLED) ? PROFILE_OLED : PROFILE_TFT;
      const Err e = parse(cur.data(), cur.size(), prof, s);
      if (e == OK) printf("OK\n"); else printf("ERR %s\n", errName(e));
      cur.clear(); hi = -1;
    };
    while ((c = fgetc(f)) != EOF) {
      if (c == '\n') { flush(); continue; }
      int v = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : -1;
      if (v < 0) continue;
      if (hi < 0) hi = v; else { cur.push_back((uint8_t)((hi << 4) | v)); hi = -1; }
    }
    fclose(f);
    return 0;
  }

  std::vector<uint8_t> pkg = readHex(argv[2]);

  if (cmd == "crc") { printf("%08x\n", (unsigned)crc32(pkg.data(), pkg.size())); return 0; }

  if (argc < 4) { fprintf(stderr, "profil manquant\n"); return 2; }
  const uint8_t profile = std::string(argv[3]) == "oled" ? PROFILE_OLED : PROFILE_TFT;
  Scene s;
  const Err e = parse(pkg.data(), pkg.size(), profile, s);

  if (cmd == "validate") {
    if (e != OK) { printf("ERR %s\n", errName(e)); return 0; }
    printf("OK %d %d %d %d %d %d\n", s.width, s.height, s.tickRate, s.durationTicks, s.loopCount, s.entityCount);
    return 0;
  }
  if (e != OK) { fprintf(stderr, "paquet refusé: %s\n", errName(e)); return 3; }

  std::vector<uint8_t> buf(Fb::bytesFor(s.width, s.height));
  Fb fb; fb.init(buf.data(), s.width, s.height);

  if (cmd == "frame") {
    const int tick = atoi(argv[4]);
    renderTick(s, fb, tick);
    if (profile == PROFILE_OLED) {
      std::vector<uint8_t> out((size_t)s.width * s.height / 8);
      toOledBuffer(fb, s, out.data());
      writeBin(out.data(), out.size());
    } else {
      std::vector<uint8_t> out((size_t)s.width * s.height * 2);
      toRgb565LE(fb, s, out.data());
      writeBin(out.data(), out.size());
    }
    return 0;
  }

  if (cmd == "dirty") {
    const Rect r = dirtyRectBetween(s, atoi(argv[4]), atoi(argv[5]));
    if (r.valid) printf("%d %d %d %d\n", r.x, r.y, r.w, r.h); else printf("none\n");
    return 0;
  }

  if (cmd == "sequence") {
    const int loops = atoi(argv[4]);
    FILE* rf = fopen(argv[5], "wb");
    if (!rf) return 2;
    std::vector<uint8_t> screen((size_t)s.width * s.height * 2, 0);   // ce que contient le TFT (RGB565 LE)
    std::vector<uint16_t> rowWords(s.width);
    // Le « bus » : reçoit des lignes big-endian et les range dans l'écran, comme le contrôleur ST7735
    int curX = 0;
    auto sink = [&](const uint16_t* row, int n, int y) {
      const uint8_t* b = (const uint8_t*)row;
      for (int i = 0; i < n; i++) {
        const size_t o = ((size_t)y * s.width + (curX + i)) * 2;
        screen[o] = b[2 * i + 1]; screen[o + 1] = b[2 * i];
      }
    };
    const int total = s.durationTicks * loops;
    for (int step = 0; step < total; step++) {
      const int tick = step % s.durationTicks;
      renderTick(s, fb, tick);                       // le firmware re-rend toujours la frame entière…
      Rect r;
      if (step == 0) { r = { 0, 0, s.width, s.height, true }; fprintf(rf, "full\n"); }
      else {
        r = dirtyRectBetween(s, prevTickOf(s, tick), tick);   // …mais ne pousse que la zone sale
        if (r.valid) fprintf(rf, "%d %d %d %d\n", r.x, r.y, r.w, r.h); else fprintf(rf, "none\n");
      }
      if (r.valid) { curX = r.x; presentRect(fb, s, r, rowWords.data(), sink); }
      writeBin(screen.data(), screen.size());
    }
    fclose(rf);
    return 0;
  }

  fprintf(stderr, "commande inconnue\n");
  return 2;
}
