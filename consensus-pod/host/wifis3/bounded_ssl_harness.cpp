// consensus-pod/host/wifis3/bounded_ssl_harness.cpp — PULLFRAME-BOUNDED-SSL-FIX1 : preuves sur l'HÔTE avec le VRAI code du cœur Renesas (WiFiSSLClient.cpp, WiFiClient.cpp, Modem.cpp,
// versions 1.5.3 et 1.6.0, compilés sans modification) contre un module AT simulé (shim/Arduino.h) et le VRAI pod_ssl_bounded.h + pod_http.h du firmware.
//   A. ANCIEN chemin (WiFiSSLClient seul) : la commande AT émise demande 1 023 octets ; sous une contrainte de bloc contigu (1 888 o, mesure AUDIT5) l'allocation de 1 921 o échoue ⇒ HeapAbort (= abort()).
//   B. NOUVEAU chemin (PodBoundedSSL) : TOUTES les commandes _SSLCLIENTRECEIVE vues sur l'UART (octets du vrai Modem::write) demandent <= 240 ; aucun HeapAbort sous un bloc de 300 o ;
//      octets identiques et dans l'ordre pour des réponses de toutes tailles, arrivées fragmentées, lectures partielles ; troncature, octet en trop, délai, erreur de transport, module défectueux.
//   C. Frame complète 9 472 o relue comme doFetchFrame (deux readBody de 4 736 o) : comparaison octet par octet.
// Sortie : une ligne « OK|FAIL nom » par contrôle ; code de sortie = nombre d'échecs.
#include <cstdarg>
#include <vector>
#include <algorithm>
#include "Arduino.h"
#include "WiFiSSLClient.h"
#include "pod_http.h"
#include "pod_ssl_bounded.h"

// ─── allocateur du harnais ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
struct Hdr { size_t size; size_t counted; };
void* operator new(size_t n) {
  const bool armed = g_heapArmed;
  if (armed) {
    if (n > g_blockLimit || g_live + n > g_liveLimit) throw HeapAbort{n, g_live};
    g_live += n; if (g_live > g_peakLive) g_peakLive = g_live; if (n > g_peakBlock) g_peakBlock = n; g_allocCount++;
  }
  Hdr* h = (Hdr*)malloc(n + sizeof(Hdr) + 16);
  if (!h) throw std::bad_alloc();
  h->size = n; h->counted = armed ? 1 : 0;
  return h + 1;
}
void operator delete(void* p) noexcept {
  if (!p) return;
  Hdr* h = (Hdr*)p - 1;
  if (h->counted) g_live -= h->size;
  free(h);
}
void operator delete(void* p, size_t) noexcept { operator delete(p); }
void* operator new[](size_t n) { return operator new(n); }
void operator delete[](void* p) noexcept { operator delete(p); }
void operator delete[](void* p, size_t) noexcept { operator delete(p); }

static int g_fails = 0, g_checks = 0;
static void check(bool ok, const char* fmt, ...) {
  char buf[400]; va_list va; va_start(va, fmt); vsnprintf(buf, sizeof buf, fmt, va); va_end(va);
  g_checks++; if (!ok) g_fails++;
  printf("%s %s\n", ok ? "OK  " : "FAIL", buf);
}

// ─── réponses HTTP synthétiques ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
static std::vector<uint8_t> makeBody(size_t n, uint32_t seed) { std::vector<uint8_t> v(n); uint32_t x = seed * 2654435761u + 12345u; for (auto& b : v) { x = x * 1664525u + 1013904223u; b = (uint8_t)(x >> 24); } return v; }
static std::vector<uint8_t> makeResponse(const std::vector<uint8_t>& body, long contentLength, size_t extra = 0) {
  char h[160]; int hl = snprintf(h, sizeof h, "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: %ld\r\nConnection: close\r\n\r\n", contentLength);
  std::vector<uint8_t> r(h, h + hl); r.insert(r.end(), body.begin(), body.end());
  for (size_t i = 0; i < extra; i++) r.push_back((uint8_t)(0xA0 + i));
  return r;
}
static void moduleLoad(const std::vector<uint8_t>& r, size_t initial, size_t perCmd) {
  g_mod.reset(); g_mod.stream = r.data(); g_mod.total = r.size(); g_mod.initialArrived = initial; g_mod.perCmd = perCmd; g_clockMs = 0;
}

// ─── A. ancien chemin ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
static void oldPath(size_t respBytes, bool expectAbort, const char* label) {
  auto body = makeBody(respBytes, 1);
  moduleLoad(body, body.size(), 0);
  WiFiSSLClient c;
  c.connect("example.test", 443);
  g_mod.nRecv = 0; g_mod.maxRecvSize = 0;
  heapReset(1888, 2976); g_heapArmed = true;
  bool aborted = false; size_t reqAlloc = 0; int got = 0;
  uint8_t buf[2048];
  try { got = c.read(buf, sizeof buf); } catch (const HeapAbort& e) { aborted = true; reqAlloc = e.request; }
  g_heapArmed = false;
  check(g_mod.maxRecvSize == 1023, "A %s : l'AT émise par le VRAI cœur demande %zu octets (attendu 1023)", label, g_mod.maxRecvSize);
  if (expectAbort) check(aborted && reqAlloc == 1921, "A %s : HeapAbort (abort() sur la carte) à l'allocation de %zu o > bloc contigu 1888 o", label, reqAlloc);
  else check(!aborted && got == (int)std::min<size_t>(respBytes, 1023) && memcmp(buf, body.data(), got) == 0, "A %s : pas d'abort, %d octets exacts (pic bloc %zu o)", label, got, g_peakBlock);
}

// ─── B/C. nouveau chemin ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
struct Result { bool aborted; int headerCode; size_t got; bool equal; bool complete; uint8_t fault; };
/** Relit comme doFetchFrame : readHeaders puis readBody de bodyLen en deux moitiés (ou une). */
static Result newPath(const std::vector<uint8_t>& body, long contentLength, size_t extra, size_t initial, size_t perCmd, size_t bodyLen, size_t blockLimit = 300, size_t liveLimit = 330, uint32_t timeoutMs = 3000) {
  auto resp = makeResponse(body, contentLength, extra);
  moduleLoad(resp, initial, perCmd);
  PodBoundedSSL c;
  c.connect("example.test", 443);
  g_mod.nRecv = 0; g_mod.maxRecvSize = 0;
  Result r{false, 0, 0, false, false, 0};
  std::vector<uint8_t> out(bodyLen ? bodyLen : 1);
  heapReset(blockLimit, liveLimit); g_heapArmed = true;
  try {
    podhttp::Reader<PodBoundedSSL> rd(c, timeoutMs);
    r.headerCode = rd.readHeaders();
    if (r.headerCode == 200) {
      const size_t half = bodyLen / 2;
      size_t a = rd.readBody(out.data(), half);
      size_t b = (a == half) ? rd.readBody(out.data() + half, bodyLen - half) : 0;
      r.got = a + b;
      r.complete = (a == half && b == bodyLen - half);
    }
  } catch (const HeapAbort&) { r.aborted = true; }
  g_heapArmed = false;
  r.fault = c.fault();
  r.equal = r.got <= body.size() && memcmp(out.data(), body.data(), r.got) == 0;
  return r;
}
static bool allAtBounded() {
  for (size_t i = 0; i < g_mod.nRecv && i < FakeModule::kLog; i++) if (g_mod.recvSizes[i] < 1 || g_mod.recvSizes[i] > (int)PodBoundedSSL::kRxCap) return false;
  return g_mod.nRecv <= FakeModule::kLog;
}

int main() {
  // A
  oldPath(400, false, "reponse 400 o (control)");
  oldPath(960, false, "reponse 960 o (control)");
  oldPath(1023, true, "reponse 1023 o");
  oldPath(4000, true, "reponse 4000 o (FIFO vide : demande 1023)");

  // B1 : tailles de réponse × motifs d'arrivée
  const size_t sizes[] = {0, 1, 2, 15, 16, 239, 240, 241, 255, 480, 481, 511, 960, 1023, 1024, 1025, 4096, 4736, 9472};   // 4096 = fichier du test de débit du capteur
  struct Pat { size_t initial, perCmd; const char* n; } pats[] = {{1u << 30, 0, "tout arrive"}, {0, 1, "1 octet/commande"}, {0, 7, "7 o/commande"}, {0, 239, "239 o/commande"}, {0, 500, "500 o/commande"}, {100, 333, "100 puis 333/cmd"}};
  int combos = 0, bad = 0, maxCmd = 0; size_t worstBlock = 0;
  for (size_t n : sizes) for (auto& p : pats) {
    if (p.perCmd == 1 && n > 1100) continue;                         // 1 o/commande : trop de tours pour 9 472 o (couvert par 7 o/cmd)
    auto body = makeBody(n, (uint32_t)(n * 31 + p.perCmd));
    Result r = newPath(body, (long)n, 0, p.initial, p.perCmd, n, 300, 330, 3000);
    const bool ok = !r.aborted && r.headerCode == 200 && r.got == n && r.equal && r.fault == 0 && allAtBounded() && g_mod.maxRecvSize <= PodBoundedSSL::kRxCap;
    combos++; if (!ok) { bad++; printf("FAIL combo n=%zu motif=%s aborted=%d code=%d got=%zu equal=%d maxAT=%zu\n", n, p.n, r.aborted, r.headerCode, r.got, r.equal, g_mod.maxRecvSize); g_fails++; }
    if (g_mod.maxRecvSize > (size_t)maxCmd) maxCmd = (int)g_mod.maxRecvSize;
    if (g_peakBlock > worstBlock) worstBlock = g_peakBlock;
  }
  g_checks++; printf("%s B1 : %d combinaisons (taille x motif d'arrivee) : octets exacts et dans l'ordre, aucun abort sous bloc 300 o et total vivant 330 o ; AT _SSLCLIENTRECEIVE max demandee = %d (<= 240) ; pic de bloc alloue = %zu o\n", bad ? "FAIL" : "OK  ", combos, maxCmd, worstBlock);

  // B2 : réponse de 1023 o disponible d'un coup (le cas qui aborte sur l'ancien chemin) sous le MÊME tas que A (1888 / 2976)
  { auto body = makeBody(4000, 77); Result r = newPath(body, 4000, 0, 1u << 30, 0, 4000, 1888, 2976);
    check(!r.aborted && r.got == 4000 && r.equal, "B2 : reponse 4000 o d'un coup, tas AUDIT5 (1888/2976) : pas d'abort, 4000 o exacts, pic bloc %zu o, pic vivant %zu o", g_peakBlock, g_peakLive); }

  // B3 : troncature (le serveur ferme à 5 000 o sur 9 472 annoncés)
  { auto body = makeBody(9472, 5); std::vector<uint8_t> cut(body.begin(), body.begin() + 5000);
    Result r = newPath(cut, 9472, 0, 1u << 30, 0, 9472);
    check(!r.aborted && r.headerCode == 200 && !r.complete && r.got == 5000 && r.equal, "B3 : corps tronque (5000 sur 9472) : %zu o recus, INCOMPLET (donc ni affichage ni ACK), octets recus exacts", r.got); }

  // B4 : octet en trop (9 480 envoyés pour Content-Length 9 472)
  { auto body = makeBody(9472, 6); Result r = newPath(body, 9472, 8, 1u << 30, 0, 9472);
    check(!r.aborted && r.complete && r.got == 9472 && r.equal, "B4 : 8 octets en trop apres le corps : exactement 9472 o lus, identiques, surplus non lu"); }

  // B5 : délai (rien n'arrive)
  { auto body = makeBody(9472, 7); auto resp = makeResponse(body, 9472); moduleLoad(resp, 0, 0); PodBoundedSSL c; c.connect("example.test", 443);
    heapReset(300, 330); g_heapArmed = true; bool ab = false; int code = 0; try { podhttp::Reader<PodBoundedSSL> rd(c, 2000); code = rd.readHeaders(); } catch (const HeapAbort&) { ab = true; } g_heapArmed = false;
    check(!ab && code == -1, "B5 : aucun octet recu : delai de 2 s (horloge virtuelle) -> readHeaders = -1, pas de blocage ni d'abort"); }

  // B6 : erreur de transport intermittente (module muet une commande RECEIVE sur 3 : délai du modem, rien consommé) : aucune corruption, aucun défaut collant
  { auto body = makeBody(3000, 8); auto resp = makeResponse(body, 3000); moduleLoad(resp, 1u << 30, 0); g_mod.errorEveryN = 3; PodBoundedSSL c; c.connect("example.test", 443);
    std::vector<uint8_t> out(3000); heapReset(300, 330); g_heapArmed = true; size_t got = 0; bool ab = false; bool eq = false;
    try { podhttp::Reader<PodBoundedSSL> rd(c, 60000); int code = rd.readHeaders(); if (code == 200) got = rd.readBody(out.data(), 3000); } catch (const HeapAbort&) { ab = true; } g_heapArmed = false;
    eq = got == 3000 && memcmp(out.data(), body.data(), 3000) == 0;
    check(!ab && eq && c.fault() == 0 && g_mod.nRecv > 12, "B6 : module muet (delai du modem) une commande sur 3 : 3000 o exacts apres reessais (%zu commandes), aucun defaut collant", g_mod.nRecv); }

  // B7 : module défectueux (renvoie plus que demandé) -> défaut collant, échec fermé
  { auto body = makeBody(2000, 9); auto resp = makeResponse(body, 2000); moduleLoad(resp, 1u << 30, 0); g_mod.overlongExtra = 40; PodBoundedSSL c; c.connect("example.test", 443);
    heapReset(600, 1200); g_heapArmed = true; int r1 = 0, r2 = 0; uint8_t b[64]; try { r1 = c.read(b, 64); r2 = c.read(b, 64); } catch (const HeapAbort&) {} g_heapArmed = false;
    check(c.fault() == PodBoundedSSL::FAULT_OVERLONG && r1 == -1 && r2 == -1 && c.connected() == 0, "B7 : module qui renvoie 280 o pour 240 demandes : defaut collant OVERLONG, read = -1, connected = 0 (echec ferme)"); }

  // B8 : réponse coupée par le module (annonce n, envoie n-1, pas de OK) : délai du cœur, rien de stocké, pas de corruption silencieuse
  { auto body = makeBody(500, 10); auto resp = makeResponse(body, 500); moduleLoad(resp, 1u << 30, 0); g_mod.dropTail = true; PodBoundedSSL c; c.connect("example.test", 443);
    heapReset(600, 1200); g_heapArmed = true; int r = 99; uint8_t b[64]; try { r = c.read(b, 64); } catch (const HeapAbort&) { r = -99; } g_heapArmed = false;
    check(r == 0 && c.fault() == 0, "B8 : reponse AT coupee : read = 0 (rien de stocke), les octets partiels ne sont JAMAIS livres ; Content-Length exact les revele ensuite"); }

  // B9 : lectures de tailles quelconques, comparaison directe (1, 7, 241, 1000, 5000…)
  { auto body = makeBody(6000, 11); moduleLoad(body, 1u << 30, 0); PodBoundedSSL c; c.connect("example.test", 443);
    std::vector<uint8_t> got; got.reserve(8000); heapReset(300, 330); g_heapArmed = true; const size_t szs[] = {1, 7, 241, 1000, 5000, 13, 240, 239, 2}; size_t k = 0; bool ab = false; int guard = 0;
    try { while (got.size() < body.size() && guard++ < 100000) { uint8_t t[5000]; size_t want = szs[k++ % 9]; int r = c.read(t, want); if (r > 0) got.insert(got.end(), t, t + r); } } catch (const HeapAbort&) { ab = true; } g_heapArmed = false;
    check(!ab && got == body && g_mod.maxRecvSize <= 240, "B9 : lectures de tailles melangees (1,7,241,1000,5000…) : 6000 o identiques dans l'ordre, AT max = %zu", g_mod.maxRecvSize); }

  // B10 : fuzz déterministe
  { uint32_t x = 20261011u; int bad2 = 0, runs = 300;
    for (int i = 0; i < runs; i++) {
      x = x * 1664525u + 1013904223u; size_t n = (x >> 8) % 10000; x = x * 1664525u + 1013904223u; size_t init = (x >> 8) % 3000; x = x * 1664525u + 1013904223u; size_t per = 1 + (x >> 8) % 700;
      auto body = makeBody(n, (uint32_t)i); Result r = newPath(body, (long)n, 0, init, per, n, 300, 330, 5000);
      if (r.aborted || r.got != n || !r.equal || r.fault || !allAtBounded()) { bad2++; printf("FAIL fuzz i=%d n=%zu init=%zu per=%zu\n", i, n, init, per); }
    }
    g_checks++; if (bad2) g_fails++; printf("%s B10 : %d scenarios aleatoires (taille 0-9999, arrivee progressive) : %d echec(s)\n", bad2 ? "FAIL" : "OK  ", runs, bad2); }

  // C : frame complète 9 472 o comme doFetchFrame (noir 4 736 + rouge 4 736), arrivée par rafales de 700 o, tas AUDIT5
  { auto body = makeBody(9472, 4242); Result r = newPath(body, 9472, 0, 200, 700, 9472, 1888, 2976);
    check(!r.aborted && r.complete && r.got == 9472 && r.equal && r.fault == 0, "C : frame 9472 o (noir+rouge) : identique octet par octet, %zu commandes AT, max demande %zu, pic bloc %zu o, pic vivant %zu o", g_mod.nRecv, g_mod.maxRecvSize, g_peakBlock, g_peakLive); }

  printf("%s : %d controles, %d echec(s)\n", g_fails ? "ECHEC" : "SUCCES", g_checks, g_fails);
  return g_fails ? 1 : 0;
}
