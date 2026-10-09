// host/ed_stack_harness.cpp — LOT8B2B2-CANARY-R4-STACK-FIX1 : logique de consensus-pod/src/adapters/podEdStack.h (pile dédiée pour Ed25519 sur UNO R4) exécutée sur l'hôte avec la VRAIE bibliothèque Crypto 0.4.0.
//   ed_stack_harness <vecteurs.txt>  →  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// Vecteurs (produits par tests/edStack.test.ts : RFC 8032 + signatures de Node/OpenSSL, indépendantes de Crypto) : « vec <seedHex> <pubHex> <msgHex|-> <sigHex> ».
// Ce que l'hôte PEUT prouver : octets identiques à la référence (dérivation, signature, vérification), rejet de signatures/messages/clés falsifiés, aucune dérive du tas, effacement avant free(), échec FERMÉ (garde écrasée,
// marge insuffisante, malloc impossible : sortie à zéro, jamais « valide »). Ce qu'il NE peut PAS prouver : la bascule réelle de pile Thumb et la profondeur réelle sur Cortex-M4 (voir micro-canari).
#define POD_ED_HOST_TEST 1
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "../src/adapters/podEdStack.h"
#include "RNG.h"

// RNG.cpp dépend d'Arduino ; Ed25519::generatePrivateKey (jamais appelée ici ni dans les firmwares) est la seule à l'utiliser
RNGClass::RNGClass() {}
RNGClass::~RNGClass() {}
void RNGClass::rand(uint8_t*, size_t) { std::abort(); }
RNGClass RNG;

static int g_pass = 0, g_fail = 0;
static void expect(const std::string& name, bool ok) { if (ok) g_pass++; else { g_fail++; std::printf("ÉCART : %s\n", name.c_str()); } }
static std::vector<uint8_t> unhex(const std::string& s) {
  std::vector<uint8_t> o; if (s == "-") return o;
  for (size_t i = 0; i + 1 < s.size(); i += 2) o.push_back((uint8_t)std::strtoul(s.substr(i, 2).c_str(), nullptr, 16));
  return o;
}
static bool allZero(const uint8_t* p, size_t n) { for (size_t i = 0; i < n; i++) if (p[i]) return false; return true; }

// ── crochets de test ──
static size_t g_wipeChecked = 0; static bool g_wipeAllZero = true;
static void afterWipe(const uint8_t* blk, size_t total) { g_wipeChecked++; for (size_t i = 0; i < total; i++) if (blk[i]) g_wipeAllZero = false; }
static void noop(uint8_t*, size_t, uint8_t*) {}
static size_t g_touchAt = 0;                                   // simule une pile utilisée jusqu'à cet indice (depuis le bas) : octet != 0xA5
static void touch(uint8_t* low, size_t, uint8_t*) { low[g_touchAt] = 0x00; }
static void smashGuard(uint8_t*, size_t, uint8_t* guard) { guard[10] = 0x00; }
static void smashGuardLastByte(uint8_t*, size_t, uint8_t* guard) { guard[POD_ED_GUARD_BYTES - 1] = 0x7F; }

int main(int argc, char** argv) {
  if (argc < 2) { std::printf("usage : ed_stack_harness <vecteurs.txt> | --sign <seedHex> <msgHex|->\n"); return 2; }
  if (std::strcmp(argv[1], "--sign") == 0 && argc >= 4) {   // mode « signature d'un vrai message de vote » : sortie lue par tests/edStack.test.ts puis vérifiée par lib/ed25519.ts (la référence du serveur)
    const auto seed = unhex(argv[2]), msg = unhex(argv[3]);
    uint8_t pub[32], sig[64];
    if (seed.size() != 32 || !PodEd::derivePublicKey(pub, seed.data()) || !PodEd::sign(sig, seed.data(), pub, msg.data(), msg.size())) { std::printf("ERREUR\n"); return 1; }
    static const char* H = "0123456789abcdef"; std::string a, b;
    for (int i = 0; i < 32; i++) { a += H[pub[i] >> 4]; a += H[pub[i] & 15]; }
    for (int i = 0; i < 64; i++) { b += H[sig[i] >> 4]; b += H[sig[i] & 15]; }
    std::printf("pub=%s sig=%s\n", a.c_str(), b.c_str());
    return 0;
  }
  FILE* f = std::fopen(argv[1], "r"); if (!f) { std::printf("vecteurs illisibles\n"); return 2; }
  podEdTestAfterWipe = afterWipe;
  char line[8192]; int nvec = 0;
  std::vector<uint8_t> seed, pub, msg, sig;   // premier vecteur : sert aux cas d'échec
  while (std::fgets(line, sizeof(line), f)) {
    char a[200], b[200], c[4096], d[300];
    if (std::sscanf(line, "vec %199s %199s %4095s %299s", a, b, c, d) != 4) continue;
    const auto vseed = unhex(a), vpub = unhex(b), vmsg = unhex(c), vsig = unhex(d);
    if (nvec == 0) { seed = vseed; pub = vpub; msg = vmsg; sig = vsig; }
    const std::string tag = "vec#" + std::to_string(nvec) + "(len=" + std::to_string(vmsg.size()) + ")";
    nvec++;
    PodEdInfo info; std::memset(&info, 0xEE, sizeof(info));
    uint8_t p2[32]; std::memset(p2, 0x55, 32);
    expect(tag + " dérivation réussit", PodEd::derivePublicKey(p2, vseed.data(), &info));
    expect(tag + " clé publique == référence", std::memcmp(p2, vpub.data(), 32) == 0);
    expect(tag + " info OK et marge pleine (hôte : aucune pile dédiée utilisée)", info.err == POD_ED_OK && info.used == 0 && info.margin == POD_ED_STACK_TOTAL - POD_ED_GUARD_BYTES);
    uint8_t s2[64]; std::memset(s2, 0x55, 64);
    expect(tag + " signature réussit", PodEd::sign(s2, vseed.data(), vpub.data(), vmsg.data(), vmsg.size(), &info));
    expect(tag + " signature == référence (octet par octet)", std::memcmp(s2, vsig.data(), 64) == 0);
    expect(tag + " vérification de la signature de référence", PodEd::verify(vsig.data(), vpub.data(), vmsg.data(), vmsg.size(), &info) && info.err == POD_ED_OK);
    // la bibliothèque seule (sans le wrapper) donne le même résultat : le wrapper ne change pas les octets
    uint8_t s3[64]; Ed25519::sign(s3, vseed.data(), vpub.data(), vmsg.data(), vmsg.size());
    expect(tag + " wrapper == bibliothèque directe", std::memcmp(s3, s2, 64) == 0);
    // falsifications : verify doit rendre false SANS erreur technique
    {   // bit 511 (poids fort de S) : la bibliothèque Crypto 0.4.0 l'IGNORE (S non canonique acceptée) — comportement de la bibliothèque, constaté et documenté ; le wrapper doit rendre EXACTEMENT le même résultat qu'elle
      uint8_t bad[64]; std::memcpy(bad, vsig.data(), 64); bad[63] ^= 0x80;
      expect(tag + " bit 511 : wrapper == bibliothèque directe", PodEd::verify(bad, vpub.data(), vmsg.data(), vmsg.size()) == Ed25519::verify(bad, vpub.data(), vmsg.data(), vmsg.size()));
    }
    for (int bit : {0, 7, 100, 255, 300, 503}) {
      uint8_t bad[64]; std::memcpy(bad, vsig.data(), 64); bad[bit / 8] ^= (uint8_t)(1u << (bit % 8));
      expect(tag + " signature falsifiée bit " + std::to_string(bit) + " rejetée", !PodEd::verify(bad, vpub.data(), vmsg.data(), vmsg.size(), &info) && info.err == POD_ED_OK);
    }
    if (!vmsg.empty()) {
      std::vector<uint8_t> m2 = vmsg; m2[m2.size() / 2] ^= 1;
      expect(tag + " message falsifié rejeté", !PodEd::verify(vsig.data(), vpub.data(), m2.data(), m2.size(), &info) && info.err == POD_ED_OK);
    } else {
      const uint8_t one = 1; expect(tag + " message vide remplacé rejeté", !PodEd::verify(vsig.data(), vpub.data(), &one, 1, &info) && info.err == POD_ED_OK);
    }
    { uint8_t pk[32]; std::memcpy(pk, vpub.data(), 32); pk[5] ^= 0x10;
      expect(tag + " clé publique falsifiée rejetée", !PodEd::verify(vsig.data(), pk, vmsg.data(), vmsg.size(), &info)); }
  }
  std::fclose(f);
  expect("au moins 12 vecteurs lus", nvec >= 12);
  if (nvec == 0) { std::printf("aucun vecteur\n"); return 1; }

  // ── effacement avant free() : après CHAQUE opération toute la zone est à zéro ──
  g_wipeChecked = 0; g_wipeAllZero = true;
  { uint8_t s[64]; PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size()); PodEd::verify(sig.data(), pub.data(), msg.data(), msg.size()); uint8_t p[32]; PodEd::derivePublicKey(p, seed.data()); }
  expect("effacement : 3 opérations → 3 zones effacées", g_wipeChecked == 3);
  expect("effacement : zone entièrement à zéro avant free()", g_wipeAllZero);

  // ── 4 cycles consécutifs : aucune dérive du tas (la même zone est réutilisée), mêmes résultats ──
  { void* before = std::malloc(POD_ED_STACK_TOTAL); std::free(before);
    uint8_t first[64] = {0}; bool same = true, okAll = true;
    for (int i = 0; i < 4; i++) {
      uint8_t s[64]; PodEdInfo inf; okAll = okAll && PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size(), &inf) && inf.err == POD_ED_OK && PodEd::verify(s, pub.data(), msg.data(), msg.size());
      if (i == 0) std::memcpy(first, s, 64); else same = same && std::memcmp(first, s, 64) == 0;
    }
    void* after = std::malloc(POD_ED_STACK_TOTAL); std::free(after);
    expect("4 cycles sign+verify réussis", okAll); expect("4 cycles : signatures identiques", same);
    expect("4 cycles : aucune dérive du tas (même bloc réutilisé)", before == after); }

  // ── profondeur mesurée (pile « utilisée » jusqu'à l'indice g_touchAt depuis le bas) ──
  podEdTestHook = touch;
  { PodEdInfo inf; uint8_t s[64];
    g_touchAt = 700;   // marge 700 o
    bool ok = PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size(), &inf);
    expect("marge 700 o : opération saine", ok && inf.err == POD_ED_OK && inf.margin == 700 && inf.used == POD_ED_STACK_TOTAL - POD_ED_GUARD_BYTES - 700);
    g_touchAt = POD_ED_MARGIN_MIN;   // juste à la limite : acceptée (untouched == 128)
    ok = PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size(), &inf);
    expect("marge 128 o (seuil) : acceptée", ok && inf.err == POD_ED_OK && inf.margin == POD_ED_MARGIN_MIN);
    g_touchAt = POD_ED_MARGIN_MIN - 1;
    std::memset(s, 0x55, 64);
    ok = PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size(), &inf);
    expect("marge 127 o : REFUSÉE (MARGIN), signature remise à zéro", !ok && inf.err == POD_ED_MARGIN && allZero(s, 64));
    g_touchAt = 0;
    ok = PodEd::verify(sig.data(), pub.data(), msg.data(), msg.size(), &inf);
    expect("pile dédiée entièrement consommée : verify() ne dit JAMAIS « valide »", !ok && inf.err == POD_ED_MARGIN);
    uint8_t p[32]; std::memset(p, 0x55, 32);
    ok = PodEd::derivePublicKey(p, seed.data(), &inf);
    expect("pile dédiée entièrement consommée : derive() refuse et met la clé à zéro", !ok && inf.err == POD_ED_MARGIN && allZero(p, 32)); }

  // ── garde basse écrasée ──
  podEdTestHook = smashGuard;
  { PodEdInfo inf; uint8_t s[64]; std::memset(s, 0x55, 64);
    bool ok = PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size(), &inf);
    expect("garde écrasée : sign() refuse (GUARD), sortie à zéro", !ok && inf.err == POD_ED_GUARD && allZero(s, 64));
    expect("garde écrasée : verify() d'une signature VALIDE refuse (GUARD)", !PodEd::verify(sig.data(), pub.data(), msg.data(), msg.size(), &inf) && inf.err == POD_ED_GUARD); }
  podEdTestHook = smashGuardLastByte;
  { PodEdInfo inf; uint8_t s[64];
    expect("garde écrasée sur son DERNIER octet : refusée aussi", !PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size(), &inf) && inf.err == POD_ED_GUARD); }
  podEdTestHook = noop;
  { PodEdInfo inf; uint8_t s[64];
    expect("garde intacte : acceptée", PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size(), &inf) && inf.err == POD_ED_OK); }
  podEdTestHook = nullptr;

  // ── malloc impossible ──
  podEdTestFailAlloc = 1;
  { PodEdInfo inf; uint8_t s[64]; std::memset(s, 0x55, 64); uint8_t p[32]; std::memset(p, 0x55, 32);
    expect("malloc impossible : sign() refuse (NOMEM), sortie à zéro", !PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size(), &inf) && inf.err == POD_ED_NOMEM && allZero(s, 64));
    expect("malloc impossible : verify() ne dit pas « valide »", !PodEd::verify(sig.data(), pub.data(), msg.data(), msg.size(), &inf) && inf.err == POD_ED_NOMEM);
    expect("malloc impossible : derive() refuse, clé à zéro", !PodEd::derivePublicKey(p, seed.data(), &inf) && inf.err == POD_ED_NOMEM && allZero(p, 32)); }
  podEdTestFailAlloc = 0;
  // NETSTACK-FIX1 : jamais imbriqué dans la pile réseau (ni dans lui-même) — refusé AVANT toute allocation, sortie à zéro, jamais « valide »
  podEdTestNested = 1;
  { PodEdInfo inf; uint8_t s[64]; std::memset(s, 0x55, 64); uint8_t p[32]; std::memset(p, 0x55, 32);
    expect("imbrication : sign() refuse (NESTED), sortie à zéro", !PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size(), &inf) && inf.err == POD_ED_NESTED && allZero(s, 64));
    expect("imbrication : verify() ne dit pas « valide »", !PodEd::verify(sig.data(), pub.data(), msg.data(), msg.size(), &inf) && inf.err == POD_ED_NESTED);
    expect("imbrication : derive() refuse, clé à zéro", !PodEd::derivePublicKey(p, seed.data(), &inf) && inf.err == POD_ED_NESTED && allZero(p, 32)); }
  podEdTestNested = 0;
  // l'appelant n'est pas obligé de fournir un PodEdInfo
  { uint8_t s[64]; expect("info facultatif", PodEd::sign(s, seed.data(), pub.data(), msg.data(), msg.size()) && PodEd::verify(s, pub.data(), msg.data(), msg.size())); }

  if (g_fail) std::printf("FAIL %d écarts / %d vérifications\n", g_fail, g_pass + g_fail); else std::printf("PASS %d\n", g_pass);
  return g_fail ? 1 : 0;
}
