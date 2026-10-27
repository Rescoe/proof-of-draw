// oled_stream_harness.cpp — vérifie pod_oled_stream.h (lecture EN FLUX d'un clip PBC1 sur l'OLED auxiliaire du BWR) sur l'hôte, avec un faux OLED (tampon page-major de 1 024 octets).
//   oled_stream_harness validate <clip.hex>                 → « VALID <code> » (code = podbench::Err de validateStream, 0 = OK)
//   oled_stream_harness play <clip.hex> <images> <stepMs> <reopen>
//        joue AU MOINS <images> images : horloge simulée avançant de <stepMs> par appel de tick(), source REOUVERTE (nouvel objet, position oubliée) à chaque appel si <reopen> = 1 ;
//        écrit « SHOWN i crc32 » pour chaque image affichée (empreinte du tampon de l'OLED), « MAXREAD n » (plus gros read), « RAM bytes » (RAM de lecture déclarée) et « END code ».
//   oled_stream_harness fail <clip.hex> <afterBytes>        → la source échoue après <afterBytes> octets lus : doit rendre T_IO, jamais boucler ni écrire hors du tampon.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <fstream>
#include <iterator>
#include "pod_oled_stream.h"

struct MemSrc {
  const std::vector<uint8_t>* d; size_t pos; size_t budget; size_t* maxRead; size_t consumed;
  MemSrc(const std::vector<uint8_t>* dd, size_t p, size_t b, size_t* m) : d(dd), pos(p), budget(b), maxRead(m), consumed(0) {}
  bool seek(uint32_t o) { if (o > d->size()) return false; pos = o; return true; }
  bool read(uint8_t* p, size_t n) {
    if (n > *maxRead) *maxRead = n;
    if (pos + n > d->size()) return false;
    if (consumed + n > budget) return false;
    memcpy(p, d->data() + pos, n); pos += n; consumed += n; return true;
  }
};

static std::vector<uint8_t> loadHex(const char* path) {
  std::ifstream f(path); std::string s((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  std::vector<uint8_t> out;
  for (size_t i = 0; i + 1 < s.size(); i += 2) out.push_back((uint8_t)strtoul(s.substr(i, 2).c_str(), nullptr, 16));
  return out;
}
static uint32_t crc(const uint8_t* p, size_t n) { return podbench::crcEnd(podbench::crcUpdate(podbench::crcBegin(), p, n)); }

int main(int argc, char** argv) {
  if (argc < 3) return 2;
  const std::string cmd = argv[1];
  const std::vector<uint8_t> clip = loadHex(argv[2]);
  size_t maxRead = 0, vMax = 0;
  uint8_t cur[podbench::FRAME_BYTES], vbuf[PODBENCH_STREAM_BUF];
  podbench::StreamInfo info; memset(&info, 0, sizeof info);
  MemSrc vs(&clip, 0, (size_t)-1, &vMax);
  const podbench::Err e = podbench::validateStream(vs, clip.size(), info, cur, vbuf);
  if (cmd == "validate") { std::printf("VALID %d\n", (int)e); return 0; }
  if (e != podbench::OK) { std::printf("REFUSED %d\n", (int)e); return 1; }

  if (cmd == "oob") {                                         // 1re transition corrompue APRÈS validation : un run sort de l'image → T_IO, sentinelles intactes
    std::vector<uint8_t> bad = clip;
    const size_t run0 = info.offTrans + 3;                    // 1er run de la 1re transition : offset (2 o), longueur (1 o)
    const int len = bad[run0 + 2];
    const int off = 1025 - len;                               // off + len = 1 025 > 1 024
    bad[run0] = (uint8_t)(off & 0xFF); bad[run0 + 1] = (uint8_t)(off >> 8);
    uint8_t area[1024 + 64]; memset(area, 0xA5, sizeof area); memset(area + 1024, 0xCC, 64);   // 64 sentinelles juste après le tampon de l'OLED
    uint8_t b2[PODOLED_BUF]; podoled::Player p2; p2.reset(info);
    MemSrc s2(&bad, 0, (size_t)-1, &maxRead);
    uint32_t t2 = 1000; podoled::Tick t = podoled::T_WAIT;
    for (int g = 0; g < 10 && t != podoled::T_IO; g++) { t = p2.tick(s2, area, b2, []() {}, t2); t2 += 1000; }
    bool canary = true; for (int i = 0; i < 64; i++) canary = canary && area[1024 + i] == 0xCC;
    std::printf("OOB tick=%d canary=%d\n", (int)t, canary ? 1 : 0);
    return (t == podoled::T_IO && canary) ? 0 : 1;
  }
  uint8_t ssd[1024]; memset(ssd, 0xA5, sizeof ssd);          // contenu initial quelconque : l'image 0 doit TOUT réécrire
  uint8_t buf[PODOLED_BUF];
  podoled::Player pl; pl.reset(info);
  uint32_t now = 1000;
  if (cmd == "fail") {
    const size_t after = (size_t)strtoull(argv[3], nullptr, 10);
    MemSrc s(&clip, 0, after, &maxRead);
    int guard = 0;
    podoled::Tick t = podoled::T_WAIT;
    while (guard++ < 100000) { t = pl.tick(s, ssd, buf, []() {}, now); if (t == podoled::T_IO || t == podoled::T_DONE) break; now += 20; }
    std::printf("FAIL tick=%d guard=%d\n", (int)t, guard);
    return t == podoled::T_IO ? 0 : 1;
  }
  const int want = atoi(argv[3]); const uint32_t stepMs = (uint32_t)atoi(argv[4]); const bool reopen = atoi(argv[5]) == 1;
  int shown = 0; int guard = 0; podoled::Tick last = podoled::T_WAIT;
  MemSrc s(&clip, 0, (size_t)-1, &maxRead);
  while (shown < want && guard++ < 10000000) {
    if (reopen) { s = MemSrc(&clip, 0, (size_t)-1, &maxRead); }
    last = pl.tick(s, ssd, buf, [&]() { std::printf("SHOWN %d %08x %u\n", shown, crc(ssd, sizeof ssd), (unsigned)now); shown++; }, now);
    if (last == podoled::T_IO) { std::printf("END io\n"); return 1; }
    if (last == podoled::T_DONE && pl.done) break;
    now += stepMs;
  }
  std::printf("MAXREAD %zu\nRAM %zu\nEND %d\n", maxRead, (size_t)(sizeof buf + sizeof pl), (int)last);
  return 0;
}
