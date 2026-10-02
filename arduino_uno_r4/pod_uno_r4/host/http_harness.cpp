// http_harness.cpp — banc d'essai PC de pod_http.h (PAS du firmware : compilé seulement par tests/podHttpR4.test.ts).
//
//   http_harness <reponse.hex> <fragment> <stutter 0|1> <mode bin|str> <cap>
//
// Rejoue une réponse HTTP brute (hexa) à travers un faux client qui la rend par morceaux de `fragment` octets
// (0 = d'un bloc) et, si stutter=1, répond « rien » (0) un appel sur deux — comme un modem Wi-Fi qui n'a pas encore reçu la suite.
//   mode bin : lit le corps par blocs de 7 octets (readBody) ; mode str : readBodyString avec un tampon de `cap` octets.
// Sortie : "status=… len=… chunked=… complete=… got=… body=<hex>".

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <string>

static uint32_t g_now = 0;
uint32_t millis() { return g_now; }
void delay(uint32_t ms) { g_now += ms; }

#include "../pod_http.h"

struct FakeClient {
  std::vector<uint8_t> data;
  size_t pos = 0, frag = 0;
  bool stutter = false, flip = false;
  int read(uint8_t* buf, size_t n) {
    if (stutter) { flip = !flip; if (flip) return 0; }
    if (pos >= data.size()) return 0;
    size_t k = data.size() - pos;
    if (k > n) k = n;
    if (frag && k > frag) k = frag;
    memcpy(buf, data.data() + pos, k);
    pos += k;
    return (int)k;
  }
  uint8_t connected() { return pos < data.size() ? 1 : 0; }   // fermé une fois tout rendu
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
  if (argc < 6) { fprintf(stderr, "usage: voir l'en-tête\n"); return 2; }
  FakeClient fc;
  fc.data = readHex(argv[1]);
  fc.frag = (size_t)atoi(argv[2]);
  fc.stutter = atoi(argv[3]) != 0;
  const bool str = std::string(argv[4]) == "str";
  const size_t cap = (size_t)atoi(argv[5]);

  podhttp::Reader<FakeClient> rd(fc, 3000);
  const int status = rd.readHeaders();
  if (status < 0) { printf("status=-1\n"); return 0; }

  std::vector<uint8_t> body;
  bool ok = true;
  if (str) {
    std::vector<char> buf(cap);
    size_t len = 0;
    ok = rd.readBodyString(buf.data(), cap, &len);
    body.assign(buf.begin(), buf.begin() + len);
  } else {
    uint8_t tmp[7];
    for (;;) { const size_t r = rd.readBody(tmp, sizeof(tmp)); if (!r) break; body.insert(body.end(), tmp, tmp + r); }
    ok = rd.complete();
  }
  printf("status=%d len=%ld chunked=%d complete=%d got=%u body=", status, rd.contentLength(), rd.chunked() ? 1 : 0, ok ? 1 : 0, (unsigned)body.size());
  for (uint8_t b : body) printf("%02x", b);
  printf("\n");
  return 0;
}
