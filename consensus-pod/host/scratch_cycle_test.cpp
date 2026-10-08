// host/scratch_cycle_test.cpp — garde du CYCLE DE VIE de la zone partagée g_podScratch des trois firmwares UNO R4 e-ink (lot 8B-2B-1-FIX1).
//   scratch_cycle_test  →  « PASS <n> » (code 0) ou la liste des écarts (code 1). Compilé par tests/renderFirmware.test.ts (g++ -std=c++11 -Wall -Wextra -Werror).
// Reproduit la STRUCTURE du firmware avec un SHA-256 qui ressemble à celui de la bibliothèque Crypto de la R4 (destructeur NON trivial, alignement 8 octets) : `alignas(PodScratch)`, construction par new PLACÉ,
// exécution, destruction explicite, puis réutilisation de la zone par autre chose (un « QR » : octets quelconques). Vérifie : alignement, ctor == dtor (aucune fuite de durée de vie), résultats identiques
// à chaque tour malgré une zone remplie de débris, et que l'oubli de la destruction SERAIT détecté. Ce n'est pas le code du firmware (qui ne se compile que sous Arduino) : c'est son schéma, exécuté.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <new>
#include <string>
#include "../src/podRenderStream.h"
#include "../src/adapters/crypto_posix.h"

// SHA-256 « façon Crypto/R4 » : alignement 8, destructeur non trivial qui efface l'état (comme SHA256::~SHA256() → clean())
struct CryptoLikeSha {
  alignas(8) PodSha256Host h;
  static int ctors, dtors;
  CryptoLikeSha() { ctors++; }
  ~CryptoLikeSha() { dtors++; std::memset(static_cast<void*>(&h), 0, sizeof(h)); }
  CryptoLikeSha(const CryptoLikeSha&); CryptoLikeSha& operator=(const CryptoLikeSha&);   // non copiable : jamais copié dans le firmware
  void begin() { h.begin(); }
  void update(const void* d, size_t n) { h.update(d, n); }
  void finish(uint8_t out[32]) { h.finish(out); }
};
int CryptoLikeSha::ctors = 0, CryptoLikeSha::dtors = 0;

// EXACTEMENT la structure du firmware
struct PodScratch { PodEinkRenderer<CryptoLikeSha> r; char hex[65]; };
static_assert(sizeof(PodScratch) <= 600, "PodScratch doit tenir dans g_podScratch (la zone de qrData)");
static_assert(alignof(PodScratch) >= alignof(CryptoLikeSha) && alignof(CryptoLikeSha) >= 8, "le type exige un alignement d'au moins 8 octets : alignas(4) ne suffirait pas");
alignas(PodScratch) static uint8_t g_podScratch[600];

static int g_pass = 0, g_fail = 0;
static void expect(int round, const char* what, bool ok) { if (ok) g_pass++; else { g_fail++; std::printf("ÉCART tour %d : %s\n", round, what); } }

static uint8_t g_planes[2][4736];

// miroir de podRenderRun() (une seule sortie ici : suffisant pour le schéma) + podRenderAndShow()
static std::string run(PodScratch* S, std::string* frameHex, uint32_t* produced) {
  const PodRenderSpec spec = pod_render_spec(POD_R_EINK29);
  const uint8_t a[] = { 'A', 'b' }; const PodRenderMeta meta = { a, 2, 7, a, 2, a, 2 };
  if (!S->r.frameHash(spec, g_planes[0], g_planes[1], 4736, S->hex)) return "frameHash";
  *frameHex = S->hex;
  if (!S->r.begin(spec, POD_R_FIT, meta, g_planes[0], g_planes[1], 4736)) return "begin";
  uint8_t chunk[32]; uint32_t n; *produced = 0;
  while ((n = S->r.read(chunk, sizeof(chunk)))) *produced += n;
  if (!S->r.finish(S->hex)) return "finish";
  return S->hex;
}

int main() {
  for (int p = 0; p < 2; p++) for (uint32_t i = 0; i < 4736; i++) g_planes[p][i] = (uint8_t)(pod_render_hash32(5, i, (uint32_t)p) >> 8);
  expect(0, "la zone est alignée sur alignof(PodScratch)", reinterpret_cast<uintptr_t>(g_podScratch) % alignof(PodScratch) == 0);
  expect(0, "alignof(PodScratch) >= 8", alignof(PodScratch) >= 8);

  std::string first, firstFrame;
  for (int round = 1; round <= 4; round++) {
    // la zone vient de servir au QR d'appairage : débris quelconques (dont des 0xFF/0x00/0xA5 qui ressemblent à des états valides)
    for (size_t i = 0; i < sizeof(g_podScratch); i++) g_podScratch[i] = (uint8_t)(round == 1 ? 0xA5 : round == 2 ? 0xFF : round == 3 ? 0x00 : (pod_render_hash32(9, (uint32_t)i, 3) >> 8));
    const int c0 = CryptoLikeSha::ctors, d0 = CryptoLikeSha::dtors;
    PodScratch* S = new (g_podScratch) PodScratch();                    // = podRenderAndShow()
    expect(round, "l'objet est construit à l'adresse de la zone", reinterpret_cast<uint8_t*>(S) == g_podScratch);
    expect(round, "un contexte SHA est construit", CryptoLikeSha::ctors == c0 + 1);
    std::string frameHex; uint32_t produced = 0;
    const std::string out = run(S, &frameHex, &produced);               // = podRenderRun()
    expect(round, "rendu complet (9 472 octets)", produced == 9472 && out.size() == 64);
    if (round == 1) { first = out; firstFrame = frameHex; } else { expect(round, "renderHash identique malgré les débris", out == first); expect(round, "frameHash identique malgré les débris", frameHex == firstFrame); }
    expect(round, "l'objet est encore vivant avant la destruction", CryptoLikeSha::dtors == d0);
    S->~PodScratch();                                                   // destruction EXPLICITE
    expect(round, "ctor == dtor après le tour : durée de vie terminée", CryptoLikeSha::ctors == c0 + 1 && CryptoLikeSha::dtors == d0 + 1);
  }
  expect(5, "bilan : autant de destructions que de constructions", CryptoLikeSha::ctors == CryptoLikeSha::dtors && CryptoLikeSha::ctors == 4);

  // le garde-fou détecte un oubli : une construction sans destruction déséquilibre le compte
  { const int c0 = CryptoLikeSha::ctors, d0 = CryptoLikeSha::dtors; PodScratch* S = new (g_podScratch) PodScratch(); (void)S;
    expect(6, "oubli de destruction détecté (ctor != dtor)", CryptoLikeSha::ctors - c0 != CryptoLikeSha::dtors - d0);
    S->~PodScratch(); expect(6, "…puis rattrapé", CryptoLikeSha::ctors - c0 == CryptoLikeSha::dtors - d0); }

  // le QR peut écrire dans la zone après la destruction (qrData est une référence sur le même tableau) sans toucher aucun objet vivant
  { uint8_t (&qrData)[600] = g_podScratch; std::memset(qrData, 0x5A, sizeof(qrData)); expect(7, "la zone est réutilisable comme tableau d'octets de 600", qrData[0] == 0x5A && qrData[599] == 0x5A && sizeof(qrData) == 600); }

  if (g_fail) { std::printf("ÉCHEC : %d écart(s), %d vérifications réussies\n", g_fail, g_pass); return 1; }
  std::printf("PASS %d (tours=4 alignof=%u sizeof=%u)\n", g_pass, (unsigned)alignof(PodScratch), (unsigned)sizeof(PodScratch));
  return 0;
}
