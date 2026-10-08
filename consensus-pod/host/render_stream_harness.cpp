// host/render_stream_harness.cpp — vérifie le NOYAU DE RENDU EN FLUX (podRenderStream.h, lot 8B-1) contre les vecteurs d'or de la référence TypeScript ET contre la référence C++ à grille (podRender.h) :
//   render_stream_harness <render-vectors.txt>  →  « PASS <n> » (code 0) ou la liste des écarts (code 1). Compilé par tests/renderStream.test.ts (g++ -std=c++11 -Wall -Wextra -Werror).
// Pour CHAQUE ligne rvec : frameHash et renderHash identiques au vecteur, et octets transmis au pilote identiques, octet pour octet, à ceux de la référence à grille — sous deux découpages différents
// (lecture e-ink par morceaux de 1, 2, 3, 5, 8… octets, puis 22 / 16 / 4096 ; entrée hachée par morceaux irréguliers). Puis : paramètres invalides, entrées tronquées, ordre d'appels incorrect.
// Aucun firmware, aucune carte : c'est la preuve d'équivalence de l'algorithme à mémoire bornée.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>
#include "../src/podRenderStream.h"
#include "../src/adapters/crypto_posix.h"

typedef PodSha256Host Sha;
// tailles de l'état des noyaux (hôte, pointeurs 64 bits : borne HAUTE des cartes à pointeurs 32 bits) — aucun tampon image dedans
static_assert(sizeof(PodEinkRenderer<Sha>) <= 400, "PodEinkRenderer trop gros");
static_assert(sizeof(PodTftRenderer<Sha>) <= 560, "PodTftRenderer trop gros");
static_assert(sizeof(PodFrameHasher<Sha>) <= 192, "PodFrameHasher trop gros");
static_assert(sizeof(PodPassHasher<Sha>) <= 304, "PodPassHasher trop gros");

static int g_pass = 0, g_fail = 0, g_rvec = 0, g_stream = 0, g_raw = 0, g_collisions = 0;
static void check(int line, const char* what, const std::string& want, const std::string& got) {
  if (want == got) { g_pass++; return; }
  g_fail++;
  std::printf("ÉCART ligne %d %s\n  attendu : %s\n  obtenu  : %s\n", line, what, want.c_str(), got.c_str());
}
static void expect(int line, const char* what, bool ok) { if (ok) g_pass++; else { g_fail++; std::printf("ÉCART ligne %d %s\n", line, what); } }
static std::vector<uint8_t> unhex(const std::string& h) {
  std::vector<uint8_t> out;
  if (h == "-") return out;
  for (size_t i = 0; i + 1 < h.size(); i += 2) { unsigned v = 0; std::sscanf(h.c_str() + i, "%2x", &v); out.push_back((uint8_t)v); }
  return out;
}
static bool screen_of(const std::string& n, PodRenderScreen& out) {
  static const char* NAMES[] = { "eink29bwr", "eink27bw", "tft18", "oled096", "tft28" };
  for (int i = 0; i < 5; i++) if (n == NAMES[i]) { out = (PodRenderScreen)i; return true; }
  return false;
}
static bool mode_of(const std::string& n, PodRenderMode& out) {
  if (n == "overlay") out = POD_R_OVERLAY; else if (n == "fit") out = POD_R_FIT; else if (n == "hidden") out = POD_R_HIDDEN; else return false;
  return true;
}
static bool pattern_of(const std::string& n, PodRenderPattern& out) {
  static const char* NAMES[] = { "white", "full", "border", "limits", "checker", "stripes", "noise", "bwr" };
  for (int i = 0; i < 8; i++) if (n == NAMES[i]) { out = (PodRenderPattern)i; return true; }
  return false;
}

// tampons de l'HÔTE (référence à grille + entrées) — le noyau en flux n'en utilise aucun
static uint16_t g_in[240 * 320], g_out[240 * 320], g_pat[240 * 320];
static uint8_t g_planes[2][240 * 320 * 2], g_final[2][240 * 320 * 2];

static const uint32_t SCHED_A[] = { 1, 2, 3, 5, 8, 13, 21, 34, 55 };
static const uint32_t SCHED_B[] = { 22, 16, 4096, 7 };

/** Entrée hachée par morceaux irréguliers. */
template <class H> static bool feed_chunked(H& h, const uint8_t* d, uint32_t n, const uint32_t* sched, int ns) {
  uint32_t off = 0; int i = 0;
  while (off < n) { uint32_t c = sched[i++ % ns]; if (c > n - off) c = n - off; if (!h.update(d + off, c)) return false; off += c; }
  return true;
}

/** Une exécution complète e-ink ; `hex` reçoit les deux hashes. Retourne les octets du pilote dans `outBytes`. */
static bool run_eink(const PodRenderSpec& s, PodRenderMode mode, const PodRenderMeta& m, const uint32_t* sched, int ns, std::vector<uint8_t>& outBytes, std::string& frameHex, std::string& renderHex) {
  const uint32_t n = pod_render_plane_bytes(s);
  PodFrameHasher<Sha> fh; char fx[65], rx[65];
  if (!fh.begin(s)) return false;
  for (int p = 0; p < s.planes; p++) if (!feed_chunked(fh, g_planes[p], n, sched, ns)) return false;
  if (!fh.finish(fx)) return false;
  PodEinkRenderer<Sha> r;
  if (!r.begin(s, mode, m, g_planes[0], s.planes > 1 ? g_planes[1] : 0, n)) return false;
  outBytes.clear(); uint8_t buf[8192]; int i = 0;
  for (;;) {
    uint32_t cap = sched[i++ % ns]; if (cap > sizeof(buf)) cap = sizeof(buf);
    const uint32_t got = r.read(buf, cap);
    if (!got) break;
    outBytes.insert(outBytes.end(), buf, buf + got);
  }
  if (!r.finish(rx)) return false;
  frameHex = fx; renderHex = rx; return true;
}

/** Une exécution complète TFT 1,8″, protocole ligne par ligne. */
static bool run_tft(const PodRenderSpec& s, PodRenderMode mode, const PodRenderMeta& m, std::vector<uint8_t>& outBytes, std::string& frameHex, std::string& renderHex, int* maxSourceLag) {
  PodTftRenderer<Sha> r; char fx[65], rx[65];
  if (!r.begin(s, mode, m)) return false;
  const uint32_t rb = (uint32_t)s.w * 2; uint8_t src[POD_R_MAX_ROW_BYTES], out[POD_R_MAX_ROW_BYTES]; int srcNext = 0; outBytes.clear();
  while (!r.allRowsEmitted()) {
    while (r.needsSource()) { memcpy(src, g_planes[0] + (uint32_t)srcNext * rb, rb); srcNext++; if (!r.consumeSource(src)) return false; }
    if (!r.emitRow(src, out)) return false;
    outBytes.insert(outBytes.end(), out, out + rb);
    if (maxSourceLag && srcNext - (int)r.outY > *maxSourceLag) *maxSourceLag = srcNext - (int)r.outY;
  }
  while (r.sourceRemaining()) { memcpy(src, g_planes[0] + (uint32_t)srcNext * rb, rb); srcNext++; if (!r.consumeSource(src)) return false; }
  if (!r.finish(fx, rx)) return false;
  frameHex = fx; renderHex = rx; return true;
}

static void invalid_and_truncated(int ln) {
  const PodRenderSpec e29 = pod_render_spec(POD_R_EINK29), e27 = pod_render_spec(POD_R_EINK27), t18 = pod_render_spec(POD_R_TFT18), oled = pod_render_spec(POD_R_OLED96), t28 = pod_render_spec(POD_R_TFT28);
  static uint8_t pl[2][4736]; memset(pl, 0xFF, sizeof(pl));
  const uint8_t ab[] = { 'a', 'b' };
  PodRenderMeta ok = { ab, 2, 5, ab, 2, ab, 2 }, noTs = { 0, 0, -1, 0, 0, 0, 0 }, badTs = { 0, 2, 1, 0, 0, 0, 0 }, badTitle = { 0, 0, 1, 0, 0, 0, 3 };
  uint8_t out[64]; char hx[65], hy[65];

  // ── e-ink : paramètres invalides ──
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink : lecture avant begin = 0", r.read(out, 16) == 0); expect(ln, "e-ink : finish avant begin = faux", !r.finish(hx)); }
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink : plan noir nul", !r.begin(e29, POD_R_FIT, ok, 0, pl[1], 4736)); expect(ln, "e-ink : état FAILED, lecture = 0", r.read(out, 16) == 0); }
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink BWR : plan rouge nul", !r.begin(e29, POD_R_FIT, ok, pl[0], 0, 4736)); }
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink BW : plan rouge ignoré", r.begin(e27, POD_R_FIT, ok, pl[0], 0, pod_render_plane_bytes(e27))); }
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink : plan trop court", !r.begin(e29, POD_R_FIT, ok, pl[0], pl[1], 4735)); }
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink : plan trop long", !r.begin(e29, POD_R_FIT, ok, pl[0], pl[1], 4737)); }
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink : plan vide", !r.begin(e29, POD_R_FIT, ok, pl[0], pl[1], 0)); }
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink : mode inconnu", !r.begin(e29, (PodRenderMode)7, ok, pl[0], pl[1], 4736)); expect(ln, "e-ink : mode négatif", !r.begin(e29, (PodRenderMode)-1, ok, pl[0], pl[1], 4736)); }
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink : écran TFT refusé", !r.begin(t18, POD_R_FIT, ok, pl[0], pl[1], 40960)); expect(ln, "e-ink : OLED refusé", !r.begin(oled, POD_R_FIT, ok, pl[0], pl[1], 1024)); }
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink : date annoncée sans pointeur", !r.begin(e29, POD_R_FIT, badTs, pl[0], pl[1], 4736)); expect(ln, "e-ink : titre annoncé sans pointeur", !r.begin(e29, POD_R_FIT, badTitle, pl[0], pl[1], 4736)); }
  { PodEinkRenderer<Sha> r; expect(ln, "e-ink : meta vide acceptée", r.begin(e29, POD_R_OVERLAY, noTs, pl[0], pl[1], 4736)); }
  // ── e-ink : ordre d'appels ──
  { PodEinkRenderer<Sha> r; r.begin(e29, POD_R_FIT, ok, pl[0], pl[1], 4736); expect(ln, "e-ink : finish avant la fin = faux", !r.finish(hx)); expect(ln, "e-ink : puis FAILED (plus de lecture)", r.read(out, 16) == 0); }
  // read() : cap == 0 = no-op sans effet sur l'état ; out nul avec cap > 0 = erreur de l'appelant (FAILED) ; lecture après la fin = 0 sans altérer le résultat
  { char base[65], mixed[65]; uint8_t big[4096]; uint32_t tot = 0, g;
    PodEinkRenderer<Sha> p; p.begin(e29, POD_R_FIT, ok, pl[0], pl[1], 4736); while ((g = p.read(big, sizeof(big)))) tot += g; p.finish(base);
    PodEinkRenderer<Sha> r; r.begin(e29, POD_R_FIT, ok, pl[0], pl[1], 4736); tot = 0;
    expect(ln, "e-ink : cap == 0 = no-op (sortie valide ou nulle), 0 octet", r.read(out, 0) == 0 && r.read(0, 0) == 0 && r.produced() == 0);
    expect(ln, "e-ink : cap == 0 ne change pas l'état (la lecture normale suit)", r.read(out, 16) == 16 && r.produced() == 16);
    expect(ln, "e-ink : cap == 0 en cours de route = no-op", r.read(0, 0) == 0 && r.produced() == 16);
    tot = 16; while ((g = r.read(big, sizeof(big)))) tot += g;
    expect(ln, "e-ink : total produit = 2 × 4736 et terminé", tot == 9472 && r.done());
    expect(ln, "e-ink : lecture après la fin = 0 (sortie valide)", r.read(out, 16) == 0 && r.done());
    expect(ln, "e-ink : lecture après la fin avec sortie nulle = 0, SANS erreur", r.read(0, 16) == 0 && r.done());
    expect(ln, "e-ink : cap == 0 après la fin = 0, état inchangé", r.read(out, 0) == 0 && r.done());
    expect(ln, "e-ink : finish reste possible après ces appels", r.finish(mixed)); expect(ln, "e-ink : hash identique à une lecture sans incident", std::string(base) == std::string(mixed));
    expect(ln, "e-ink : second finish = faux", !r.finish(hy)); }
  { PodEinkRenderer<Sha> r; r.begin(e29, POD_R_FIT, ok, pl[0], pl[1], 4736); expect(ln, "e-ink : sortie nulle avec cap > 0 = 0", r.read(0, 16) == 0);
    expect(ln, "e-ink : … et ÉTAT FAILED (plus rien ne sort)", !r.done() && r.read(out, 16) == 0 && r.produced() == 0); expect(ln, "e-ink : … finish refusé", !r.finish(hx)); }
  { PodEinkRenderer<Sha> r; r.begin(e29, POD_R_FIT, ok, pl[0], pl[1], 4736); r.read(out, 16); expect(ln, "e-ink : sortie nulle en cours de route = FAILED", r.read(0, 16) == 0 && r.read(out, 16) == 0 && !r.finish(hx)); }
  // ── frameHash par le renderer : paramètres invalides, refus en cours de rendu ──
  { PodEinkRenderer<Sha> r; expect(ln, "renderer.frameHash : plan nul refusé", !r.frameHash(e29, 0, pl[1], 4736, hx) && !r.frameHash(e29, pl[0], 0, 4736, hx));
    expect(ln, "renderer.frameHash : taille fausse refusée", !r.frameHash(e29, pl[0], pl[1], 4735, hx) && !r.frameHash(e29, pl[0], pl[1], 4737, hx));
    expect(ln, "renderer.frameHash : écran TFT / OLED refusé", !r.frameHash(t18, pl[0], pl[1], 40960, hx) && !r.frameHash(oled, pl[0], pl[1], 1024, hx));
    expect(ln, "renderer.frameHash : BW sans plan rouge accepté", r.frameHash(e27, pl[0], 0, pod_render_plane_bytes(e27), hx)); }
  { PodEinkRenderer<Sha> r; r.begin(e29, POD_R_FIT, ok, pl[0], pl[1], 4736); expect(ln, "renderer.frameHash : refusé en cours de rendu", !r.frameHash(e29, pl[0], pl[1], 4736, hx) && r.read(out, 16) == 16); }
  // ── frameHash : entrées tronquées / excédentaires ──
  { PodFrameHasher<Sha> f; f.begin(e29); f.update(pl[0], 4736); expect(ln, "frame : image tronquée (un plan sur deux) = faux", !f.finish(hx)); }
  { PodFrameHasher<Sha> f; f.begin(e29); f.update(pl[0], 4736); f.update(pl[1], 4735); expect(ln, "frame : un octet manquant = faux", !f.finish(hx)); }
  { PodFrameHasher<Sha> f; f.begin(e29); f.update(pl[0], 4736); f.update(pl[1], 4736); expect(ln, "frame : image complète = vrai", f.finish(hx)); expect(ln, "frame : second finish = faux", !f.finish(hy)); }
  { PodFrameHasher<Sha> f; f.begin(e29); f.update(pl[0], 4736); f.update(pl[1], 4736); expect(ln, "frame : octet de trop refusé", !f.update(pl[0], 1) && !f.finish(hx)); }
  { PodFrameHasher<Sha> f; f.begin(e27); expect(ln, "frame : donnée nulle refusée", !f.update(0, 4) && !f.finish(hx)); }
  { PodFrameHasher<Sha> f; expect(ln, "frame : update avant begin = faux", !f.update(pl[0], 1)); }
  // ── PodPassHasher ──
  { PodPassHasher<Sha> p; expect(ln, "pass : écran à cartel en overlay refusé", !p.begin(e29, POD_R_OVERLAY)); expect(ln, "pass : écran à cartel en fit refusé", !p.begin(t18, POD_R_FIT)); }
  { PodPassHasher<Sha> p; expect(ln, "pass : écran à cartel en hidden accepté", p.begin(t18, POD_R_HIDDEN)); }
  { PodPassHasher<Sha> p; expect(ln, "pass : OLED tous modes", p.begin(oled, POD_R_FIT) && p.begin(oled, POD_R_OVERLAY) && p.begin(oled, POD_R_HIDDEN)); expect(ln, "pass : mode inconnu", !p.begin(oled, (PodRenderMode)9)); }
  { PodPassHasher<Sha> p; p.begin(oled, POD_R_FIT); p.update(pl[0], 1023); expect(ln, "pass : OLED tronqué (1023 o) = faux", !p.finish(hx, hy)); }
  { PodPassHasher<Sha> p; p.begin(oled, POD_R_FIT); p.update(pl[0], 1024); expect(ln, "pass : OLED complet", p.finish(hx, hy)); }
  { PodPassHasher<Sha> p; p.begin(t28, POD_R_OVERLAY); expect(ln, "pass : TFT 2,8″ taille = 153 600", p.total == 153600u); }
  // ── TFT 1,8″ : paramètres et protocole ──
  { PodTftRenderer<Sha> r; expect(ln, "tft : e-ink refusé", !r.begin(e29, POD_R_FIT, ok)); expect(ln, "tft : OLED refusé", !r.begin(oled, POD_R_FIT, ok)); expect(ln, "tft : TFT 2,8″ (sans cartel) refusé", !r.begin(t28, POD_R_FIT, ok)); expect(ln, "tft : mode inconnu", !r.begin(t18, (PodRenderMode)3, ok)); expect(ln, "tft : meta incohérente", !r.begin(t18, POD_R_FIT, badTs)); }
  { PodTftRenderer<Sha> r; expect(ln, "tft : émission avant begin = faux", !r.emitRow(pl[0], out)); }
  { PodTftRenderer<Sha> r; r.begin(t18, POD_R_FIT, ok); expect(ln, "tft : ligne de bandeau sans source", r.sourceRowNeeded() == -1 && !r.needsSource());
    expect(ln, "tft : sortie nulle refusée", !r.emitRow(0, 0)); }
  { PodTftRenderer<Sha> r; r.begin(t18, POD_R_HIDDEN, ok); expect(ln, "tft hidden : ligne source 0 requise", r.sourceRowNeeded() == 0 && r.needsSource()); uint8_t o2[256]; expect(ln, "tft hidden : émission sans avoir lu la source = faux (FAILED)", !r.emitRow(pl[0], o2)); }
  { PodTftRenderer<Sha> r; r.begin(t18, POD_R_HIDDEN, ok); uint8_t o2[256]; r.consumeSource(pl[0]); expect(ln, "tft hidden : source nulle refusée", !r.emitRow(0, o2)); }
  { PodTftRenderer<Sha> r; r.begin(t18, POD_R_OVERLAY, ok); uint8_t o2[256]; expect(ln, "tft : bandeau haut émis sans source", r.emitRow(0, o2) && r.outY == 1); }
  { PodTftRenderer<Sha> r; r.begin(t18, POD_R_HIDDEN, ok); uint8_t o2[256]; r.consumeSource(pl[0]); r.consumeSource(pl[0]); expect(ln, "tft hidden : source lue en avance (2 lignes pour 1) = faux", !r.emitRow(pl[0], o2)); }
  { PodTftRenderer<Sha> r; r.begin(t18, POD_R_HIDDEN, ok); uint8_t o2[256]; for (int y = 0; y < 100; y++) { r.consumeSource(pl[0]); r.emitRow(pl[0], o2); }
    char a[65], b[65]; expect(ln, "tft : entrée tronquée à 100 lignes = finish faux", !r.finish(a, b)); }
  { PodTftRenderer<Sha> r; r.begin(t18, POD_R_HIDDEN, ok); uint8_t o2[256]; for (int y = 0; y < 160; y++) { r.consumeSource(pl[0]); r.emitRow(pl[0], o2); }
    expect(ln, "tft : tout émis", r.allRowsEmitted() && !r.sourceRemaining()); expect(ln, "tft : ligne en trop refusée", !r.consumeSource(pl[0])); }
  { PodTftRenderer<Sha> r; r.begin(t18, POD_R_OVERLAY, ok); uint8_t o2[256]; for (int y = 0; y < 160; y++) { while (r.needsSource()) r.consumeSource(pl[0]); r.emitRow(pl[0], o2); }
    char a[65], b[65]; expect(ln, "tft overlay : lignes 146..159 non consommées = finish faux (frameHash incomplet)", r.sourceRemaining() && !r.finish(a, b)); }
  { PodTftRenderer<Sha> r; r.begin(t18, POD_R_FIT, ok); uint8_t o2[256]; for (int y = 0; y < 160; y++) { while (r.needsSource()) r.consumeSource(pl[0]); r.emitRow(pl[0], o2); }
    char a[65], b[65]; expect(ln, "tft fit : la dernière ligne source (159) est précisément la dernière requise : rien à drainer, finish vrai", !r.sourceRemaining() && r.finish(a, b)); }
}

// ─── Plans BRUTS pseudo-aléatoires (lot 8B1-FIX1) : le noyau doit se comporter comme la référence sur N'IMPORTE QUELS octets, pas seulement sur des images produites par l'encodeur ──────────────────────────────
// e-ink : octets arbitraires dans chaque plan (donc des pixels « noir ET rouge » : le rouge l'emporte) ; TFT : mots RGB565 arbitraires. Trois densités, trois modes, trois découpages (dont des morceaux qui
// traversent la frontière entre le plan noir et le plan rouge). Comparaison : (1) octets du pilote et deux hashes avec la référence à GRILLE ; (2) un ORACLE indépendant (formules du contrat, sans podRender.h)
// vérifie pixel par pixel la zone sûre — priorité du rouge, fit, hidden.
static uint8_t raw_byte(int density, uint32_t seed, uint32_t i, uint32_t plane) {
  const uint8_t a = (uint8_t)(pod_render_hash32(seed, i, plane * 3 + 1) >> 8), b = (uint8_t)(pod_render_hash32(seed, i, plane * 3 + 2) >> 8), c = (uint8_t)(pod_render_hash32(seed, i, plane * 3 + 3) >> 8);
  return density == 1 ? (uint8_t)(a | b | c) : density == 2 ? (uint8_t)(a & b & c) : a;   // 0 uniforme · 1 surtout blanc (bits à 1) · 2 surtout coloré (bits à 0)
}
static bool in_bit_cleared(const PodRenderSpec& s, int plane, int x, int y) {   // bit 0 d'un plan D'ENTRÉE (g_planes) = pixel allumé dans ce plan
  const int bpr = s.h / 8, bufCol = s.h - 1 - y, idx = x * bpr + (bufCol >> 3), bit = 7 - (bufCol & 7);
  return !((g_planes[plane][idx] >> bit) & 1);
}
static int logical_in(const PodRenderSpec& s, int sx, int sy) {   // 0 blanc, 1 noir, 2 rouge — lu DIRECTEMENT dans les plans d'entrée
  return (s.planes > 1 && in_bit_cleared(s, 1, sx, sy)) ? 2 : in_bit_cleared(s, 0, sx, sy) ? 1 : 0;
}
static bool out_bit_cleared(const PodRenderSpec& s, const std::vector<uint8_t>& got, int plane, int x, int y) {
  const int bpr = s.h / 8, bufCol = s.h - 1 - y, idx = x * bpr + (bufCol >> 3), bit = 7 - (bufCol & 7);
  return !((got[(size_t)plane * pod_render_plane_bytes(s) + (size_t)idx] >> bit) & 1);
}
/** Oracle e-ink : chaque pixel de la zone sûre (toute l'image en hidden) se déduit des plans d'entrée par les formules du contrat. Retourne le nombre de pixels contrôlés (0 = échec). */
static long oracle_eink(int ln, const std::string& tag, const PodRenderSpec& s, PodRenderMode mode, const std::vector<uint8_t>& got) {
  const int safe0 = s.top1 + 1, safeH = s.bot0 - 1 - s.top1;
  const int nw = (int)(((uint32_t)s.w * (uint32_t)safeH) / s.h), x0 = (s.w - nw) / 2;
  long checked = 0;
  for (int y = (mode == POD_R_HIDDEN ? 0 : safe0); y < (mode == POD_R_HIDDEN ? s.h : s.bot0); y++) for (int x = 0; x < s.w; x++) {
    bool wantBlk, wantRed;
    if (mode == POD_R_HIDDEN) {   // copie conforme des BITS : un pixel noir+rouge garde ses deux bits
      wantBlk = in_bit_cleared(s, 0, x, y); wantRed = s.planes > 1 && in_bit_cleared(s, 1, x, y);
    } else {
      int want;
      if (mode == POD_R_FIT) {
        if (x < x0 || x >= x0 + nw) want = 0;
        else want = logical_in(s, (int)(((uint32_t)(2 * (x - x0) + 1) * (uint32_t)s.w) / (uint32_t)(2 * nw)), (int)(((uint32_t)(2 * (y - safe0) + 1) * (uint32_t)s.h) / (uint32_t)(2 * safeH)));
      } else want = logical_in(s, x, y);
      wantBlk = want == 1; wantRed = want == 2;   // le rouge l'emporte : un pixel noir+rouge efface le plan rouge et LAISSE le plan noir à 1
    }
    const bool blkCleared = out_bit_cleared(s, got, 0, x, y), redCleared = s.planes > 1 && out_bit_cleared(s, got, 1, x, y);
    if (blkCleared != wantBlk || redCleared != wantRed) { g_fail++; std::printf("ÉCART ligne %d oracle e-ink %s pixel (%d,%d) : attendu noir=%d rouge=%d, obtenu noir=%d rouge=%d\n", ln, tag.c_str(), x, y, wantBlk, wantRed, blkCleared, redCleared); return 0; }
    checked++;
  }
  g_pass++; return checked;
}
static void raw_differential() {
  static const char* NAMES[] = { "overlay", "fit", "hidden" };
  const uint8_t lea[] = { 'L', 0xC3, 0xA9, 'a' }, chat[] = { 'L', 'e', ' ', 'C', 'h', 'a', 't', ' ', 'N', 'o', 'i', 'r' }, ts[] = { '0', '7', '/', '1', '0', ' ', '2', '0', ':', '3', '7' };
  uint8_t longTitle[60]; for (int i = 0; i < 60; i++) longTitle[i] = (uint8_t)('A' + i % 26);
  const PodRenderMeta metas[3] = { { ts, sizeof(ts), 42, lea, sizeof(lea), chat, sizeof(chat) }, { 0, 0, -1, 0, 0, 0, 0 }, { ts, sizeof(ts), 123456789, longTitle, 60, longTitle, 60 } };
  const uint32_t seeds[] = { 1, 7, 99, 12345, 0xDEADBEEFu, 424242 };
  int run = 0; long oraclePixels = 0;
  for (int si = 0; si < 6; si++) for (int d = 0; d < 3; d++) for (int sc = 0; sc < 3; sc++) for (int mi = 0; mi < 3; mi++) {
    const PodRenderScreen screen = sc == 0 ? POD_R_EINK29 : sc == 1 ? POD_R_EINK27 : POD_R_TFT18;
    const PodRenderSpec s = pod_render_spec(screen); const PodRenderMode mode = (PodRenderMode)mi; const PodRenderMeta& m = metas[(si + d + mi) % 3];
    if (sc == 2 && d != 0 && si >= 2) continue;   // TFT : graines 0-1 sous les 3 densités (mots à bits biaisés), les autres en uniforme seulement
    const uint32_t n = pod_render_plane_bytes(s);
    for (int p = 0; p < s.planes; p++) for (uint32_t i = 0; i < n; i++) g_planes[p][i] = raw_byte(d, seeds[si], i, (uint32_t)p);
    int collisions = 0;
    if (s.eink && s.planes > 1) for (uint32_t i = 0; i < n; i++) collisions += ((~g_planes[0][i] & ~g_planes[1][i] & 0xFF) != 0) ? 1 : 0;
    g_collisions += collisions;
    const std::string tag = std::string(s.name) + " " + NAMES[mi] + " graine=" + std::to_string(seeds[si]) + " densité=" + std::to_string(d);
    const uint8_t* in[2] = { g_planes[0], g_planes[1] }; uint8_t* fin[2] = { g_final[0], g_final[1] }; char fh[65], rh[65];
    pod_render_frame<Sha>(s, mode, m, in, g_in, g_out, fin, fh, rh);
    std::vector<uint8_t> want; for (int p = 0; p < s.planes; p++) want.insert(want.end(), g_final[p], g_final[p] + n);
    std::string fx, rx; std::vector<uint8_t> got;
    if (s.eink) {
      const uint32_t schedC[4] = { n - 3, 7, n + 1, 1 };   // le 2e appel traverse la frontière entre le plan noir et le plan rouge
      for (int k = 0; k < 3; k++) {
        const bool okRun = k == 0 ? run_eink(s, mode, m, SCHED_A, 9, got, fx, rx) : k == 1 ? run_eink(s, mode, m, SCHED_B, 4, got, fx, rx) : run_eink(s, mode, m, schedC, 4, got, fx, rx);
        expect(run, ("raw e-ink exécution : " + tag).c_str(), okRun);
        if (!okRun) continue;
        check(run, ("raw e-ink frameHash : " + tag).c_str(), fh, fx);
        check(run, ("raw e-ink renderHash : " + tag).c_str(), rh, rx);
        expect(run, ("raw e-ink octets identiques à la référence à grille : " + tag).c_str(), got == want);
        if (k == 0) {   // frameHash calculé avec le contexte du renderer (économie d'un contexte sur R4) puis rendu complet avec le MÊME objet : mêmes hashes, mêmes octets
          PodEinkRenderer<Sha> r2; char h2[65], h3[65]; std::vector<uint8_t> got2; uint8_t b2[64];
          const bool okF = r2.frameHash(s, g_planes[0], s.planes > 1 ? g_planes[1] : 0, n, h2) && r2.begin(s, mode, m, g_planes[0], s.planes > 1 ? g_planes[1] : 0, n);
          expect(run, ("raw e-ink frameHash par le renderer : " + tag).c_str(), okF);
          if (okF) { check(run, ("raw e-ink frameHash par le renderer == PodFrameHasher : " + tag).c_str(), fx, h2); uint32_t g2; while ((g2 = r2.read(b2, sizeof(b2)))) got2.insert(got2.end(), b2, b2 + g2);
            expect(run, ("raw e-ink objet réutilisé : octets identiques : " + tag).c_str(), got2 == want && r2.finish(h3)); check(run, ("raw e-ink objet réutilisé : renderHash : " + tag).c_str(), rx, h3); }
        }
        if (k == 0) { const long c = oracle_eink(run, tag, s, mode, got); expect(run, ("raw e-ink oracle indépendant : " + tag).c_str(), c > 0); oraclePixels += c; }
        g_raw++;
      }
    } else {   // tft18 : mots RGB565 arbitraires
      int lag = 0;
      const bool okRun = run_tft(s, mode, m, got, fx, rx, &lag);
      expect(run, ("raw tft exécution : " + tag).c_str(), okRun);
      if (okRun) {
        check(run, ("raw tft frameHash : " + tag).c_str(), fh, fx);
        check(run, ("raw tft renderHash : " + tag).c_str(), rh, rx);
        expect(run, ("raw tft octets identiques à la référence à grille : " + tag).c_str(), got == want);
        const int safe0 = s.top1 + 1, safeH = s.bot0 - 1 - s.top1, nw = (int)(((uint32_t)s.w * (uint32_t)safeH) / s.h), x0 = (s.w - nw) / 2; bool ok = true;
        for (int y = (mode == POD_R_HIDDEN ? 0 : safe0); ok && y < (mode == POD_R_HIDDEN ? s.h : s.bot0); y++) for (int x = 0; ok && x < s.w; x++) {
          uint16_t w16;
          if (mode == POD_R_FIT) {
            if (x < x0 || x >= x0 + nw) w16 = 0xFFFF;
            else {
              const int sx = (int)(((uint32_t)(2 * (x - x0) + 1) * (uint32_t)s.w) / (uint32_t)(2 * nw)), sy = (int)(((uint32_t)(2 * (y - safe0) + 1) * (uint32_t)s.h) / (uint32_t)(2 * safeH));
              w16 = (uint16_t)(g_planes[0][(sy * s.w + sx) * 2] | (g_planes[0][(sy * s.w + sx) * 2 + 1] << 8));
            }
          } else w16 = (uint16_t)(g_planes[0][(y * s.w + x) * 2] | (g_planes[0][(y * s.w + x) * 2 + 1] << 8));
          const uint16_t o16 = (uint16_t)(got[(size_t)(y * s.w + x) * 2] | (got[(size_t)(y * s.w + x) * 2 + 1] << 8));
          if (o16 != w16) { ok = false; g_fail++; std::printf("ÉCART oracle tft %s pixel (%d,%d) : attendu %04x obtenu %04x\n", tag.c_str(), x, y, w16, o16); }
        }
        expect(run, ("raw tft oracle indépendant : " + tag).c_str(), ok);
        g_raw++;
      }
    }
    if (!s.cartel || mode == POD_R_HIDDEN) {   // sans traitement, sur des octets bruts
      PodPassHasher<Sha> ph; char a[65], b[65];
      const bool okPass = ph.begin(s, mode) && feed_chunked(ph, g_planes[0], n, SCHED_A, 9) && (s.planes < 2 || feed_chunked(ph, g_planes[1], n, SCHED_B, 4)) && ph.finish(a, b);
      expect(run, ("raw pass exécution : " + tag).c_str(), okPass);
      if (okPass) { check(run, ("raw pass frameHash : " + tag).c_str(), fh, a); check(run, ("raw pass renderHash : " + tag).c_str(), rh, b); g_raw++; }
    }
    run++;
  }
  // TFT : cas dégénérés (tout à 0x00, tout à 0xFF, alternance 0x55/0xAA) dans les trois modes
  for (int pat = 0; pat < 3; pat++) for (int mi = 0; mi < 3; mi++) {
    const PodRenderSpec s = pod_render_spec(POD_R_TFT18); const PodRenderMode mode = (PodRenderMode)mi; const uint32_t n = pod_render_plane_bytes(s);
    for (uint32_t i = 0; i < n; i++) g_planes[0][i] = pat == 0 ? 0x00 : pat == 1 ? 0xFF : (uint8_t)((i & 1) ? 0xAA : 0x55);
    const uint8_t* in[2] = { g_planes[0], g_planes[0] }; uint8_t* fin[2] = { g_final[0], g_final[1] }; char fh[65], rh[65];
    pod_render_frame<Sha>(s, mode, metas[0], in, g_in, g_out, fin, fh, rh);
    std::vector<uint8_t> got; std::string fx, rx; int lag = 0;
    const bool okRun = run_tft(s, mode, metas[0], got, fx, rx, &lag);
    expect(run, "raw tft dégénéré : exécution", okRun);
    if (okRun) {
      check(run, "raw tft dégénéré frameHash", fh, fx); check(run, "raw tft dégénéré renderHash", rh, rx);
      expect(run, "raw tft dégénéré octets", got == std::vector<uint8_t>(g_final[0], g_final[0] + n)); g_raw++;
    }
    run++;
  }
  expect(run, "raw : des pixels noir+rouge simultanés ont bien été testés", g_collisions > 0);
  expect(run, "raw : l'oracle a contrôlé des centaines de milliers de pixels", oraclePixels > 100000);
}

// ─── Émulation du contrat des pilotes e-ink (lot 8B-2A) : Epd::DisplayStream (ESP8266) et Epd29b::displayStream (R4) ───────────────────────────────────────────────────────────────────────────
// Ce n'est PAS le code des pilotes (qui ne se compile que sous Arduino) : c'est leur algorithme, recopié, exécuté contre le vrai renderer avec INJECTION DE PANNES. Il vérifie que (1) aucun appel ne franchit la frontière
// entre les plans, (2) le plan noir est remis tel quel et le plan rouge INVERSÉ, (3) un arrêt de production avant la fin n'atteint jamais le rafraîchissement, (4) les octets remis sont exactement ceux hachés.
struct DriverEmu { std::vector<uint8_t> wire; bool refreshed; int commands; };
struct FaultyProducer { PodEinkRenderer<Sha>* r; uint32_t stopAfter; uint32_t given; };
static uint32_t faulty_produce(void* ctx, uint8_t* out, uint32_t cap) {
  FaultyProducer* f = static_cast<FaultyProducer*>(ctx);
  if (f->given >= f->stopAfter) return 0;                       // la production s'arrête (erreur ou fin prématurée)
  uint32_t c = cap; if (f->given + c > f->stopAfter) c = f->stopAfter - f->given;
  const uint32_t n = f->r->read(out, c); f->given += n; return n;
}
static bool emu_display_stream(DriverEmu& d, uint32_t (*produce)(void*, uint8_t*, uint32_t), void* ctx, uint32_t plane, bool* boundaryCrossed) {
  uint8_t chunk[32]; uint32_t sent = 0; d.wire.clear(); d.refreshed = false; d.commands = 1;   // commande 0x24
  *boundaryCrossed = false;
  while (sent < 2 * plane) {
    const uint32_t toBoundary = (sent < plane ? plane : 2 * plane) - sent, cap = toBoundary < sizeof(chunk) ? toBoundary : (uint32_t)sizeof(chunk);
    const uint32_t n = produce(ctx, chunk, cap);
    if (n == 0 || n > cap) return false;
    if (sent < plane && sent + n > plane) *boundaryCrossed = true;
    for (uint32_t i = 0; i < n; i++) d.wire.push_back(sent < plane ? chunk[i] : (uint8_t)~chunk[i]);
    sent += n;
    if (sent == plane) d.commands++;                            // commande 0x26
  }
  d.refreshed = true; return true;
}
static void driver_contract() {
  const PodRenderSpec s = pod_render_spec(POD_R_EINK29); const uint32_t n = pod_render_plane_bytes(s);
  const uint8_t ab[] = { 'a', 'b' }; PodRenderMeta m = { ab, 2, 5, ab, 2, ab, 2 };
  for (int seed = 0; seed < 3; seed++) {
    for (uint32_t p = 0; p < 2; p++) for (uint32_t i = 0; i < n; i++) g_planes[p][i] = raw_byte(seed, 77 + (uint32_t)seed, i, p);
    const uint8_t* in[2] = { g_planes[0], g_planes[1] }; uint8_t* fin[2] = { g_final[0], g_final[1] }; char fh[65], rh[65];
    pod_render_frame<Sha>(s, POD_R_FIT, m, in, g_in, g_out, fin, fh, rh);
    // 1. chemin nominal : octets remis = plan noir tel quel + plan rouge inversé de la RÉFÉRENCE ; le hash du renderer = le hash des octets avant inversion
    { PodEinkRenderer<Sha> r; r.begin(s, POD_R_FIT, m, g_planes[0], g_planes[1], n); FaultyProducer f = { &r, 2 * n, 0 }; DriverEmu d; bool crossed = true; char rx[65];
      expect(seed, "pilote émulé : remise complète", emu_display_stream(d, faulty_produce, &f, n, &crossed) && d.refreshed && r.finish(rx));
      expect(seed, "pilote émulé : aucun appel ne franchit la frontière entre les plans", !crossed);
      expect(seed, "pilote émulé : 2 commandes (0x24 puis 0x26)", d.commands == 2);
      bool same = d.wire.size() == 2 * n; for (uint32_t i = 0; same && i < n; i++) same = d.wire[i] == g_final[0][i] && d.wire[n + i] == (uint8_t)~g_final[1][i];
      expect(seed, "pilote émulé : plan noir tel quel, plan rouge inversé == référence à grille", same);
      check(seed, "pilote émulé : renderHash == référence", rh, rx); }
    // 2. pannes : arrêt de la production à divers points, dont les frontières — jamais de rafraîchissement, le renderHash refuse
    const uint32_t stops[] = { 0, 1, 31, 32, 33, n - 1, n, n + 1, 2 * n - 33, 2 * n - 1 };
    for (uint32_t st : stops) {
      PodEinkRenderer<Sha> r; r.begin(s, POD_R_FIT, m, g_planes[0], g_planes[1], n); FaultyProducer f = { &r, st, 0 }; DriverEmu d; bool crossed = false; char rx[65];
      const bool ok = emu_display_stream(d, faulty_produce, &f, n, &crossed);
      expect(seed, "pilote émulé : production interrompue => échec, JAMAIS de rafraîchissement", !ok && !d.refreshed);
      expect(seed, "pilote émulé : production interrompue => renderHash refusé (rendu non calculé en entier)", !r.finish(rx));
      expect(seed, "pilote émulé : seuls les octets déjà produits ont été remis", d.wire.size() <= st);
    }
    // 3. production qui rend plus que demandé (bug de l'appelant) => échec
    { struct Over { static uint32_t produce(void*, uint8_t*, uint32_t cap) { return cap + 1; } }; DriverEmu d; bool crossed = false;
      expect(seed, "pilote émulé : n > cap refusé", !emu_display_stream(d, Over::produce, 0, n, &crossed) && !d.refreshed); }
  }
}

int main(int argc, char** argv) {
  if (argc < 2) { std::printf("usage : render_stream_harness <render-vectors.txt>\n"); return 2; }
  std::ifstream f(argv[1]);
  if (!f) { std::printf("fichier introuvable : %s\n", argv[1]); return 2; }
  invalid_and_truncated(0);
  raw_differential();
  driver_contract();
  std::string line; int ln = 0, maxLag = 0;
  while (std::getline(f, line)) {
    ln++;
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    if (line.empty() || line[0] == '#') continue;
    std::vector<std::string> t; { size_t p = 0; while (p <= line.size()) { size_t q = line.find(' ', p); if (q == std::string::npos) q = line.size(); t.push_back(line.substr(p, q - p)); p = q + 1; } }
    const std::string& c = t[0];
    if (c == "rfont" || c == "rtext") continue;   // couverts par render_harness (même texte, même police)
    if (c != "rvec" || t.size() != 11) { g_fail++; std::printf("ÉCART ligne %d : commande inconnue ou mal formée « %s »\n", ln, c.c_str()); continue; }

    PodRenderScreen sc; PodRenderMode mode; PodRenderPattern pat = POD_P_WHITE; const bool bytes = t[2] == "bytes";
    if (!screen_of(t[1], sc) || !mode_of(t[4], mode) || (!bytes && !pattern_of(t[2], pat))) { g_fail++; std::printf("ÉCART ligne %d [rvec] écran / motif / mode inconnu\n", ln); continue; }
    const PodRenderSpec s = pod_render_spec(sc); const uint32_t seed = (uint32_t)std::strtoul(t[3].c_str(), nullptr, 10), n = pod_render_plane_bytes(s);
    if (bytes) { for (uint32_t i = 0; i < n; i++) g_planes[0][i] = (uint8_t)(pod_render_hash32(seed, i, 0) & 0xFF); }
    else { pod_render_pattern(s, pat, seed, g_pat); uint8_t* pp[2] = { g_planes[0], g_planes[1] }; pod_render_encode(s, g_pat, pp); }
    const std::vector<uint8_t> ts = unhex(t[6]), ar = unhex(t[7]), ti = unhex(t[8]);
    PodRenderMeta m = { ts.data(), ts.size(), (int32_t)std::strtol(t[5].c_str(), nullptr, 10), ar.data(), ar.size(), ti.data(), ti.size() };
    // référence à grille : octets attendus du pilote
    const uint8_t* in[2] = { g_planes[0], g_planes[1] }; uint8_t* fin[2] = { g_final[0], g_final[1] }; char fh[65], rh[65];
    pod_render_frame<Sha>(s, mode, m, in, g_in, g_out, fin, fh, rh);
    std::vector<uint8_t> want; for (int p = 0; p < s.planes; p++) want.insert(want.end(), g_final[p], g_final[p] + n);
    const std::string tag = t[1] + " " + t[2] + " " + t[3] + " " + t[4];
    check(ln, ("(contrôle) la référence à grille retrouve le vecteur : " + tag).c_str(), t[10], rh);

    std::string fx, rx; std::vector<uint8_t> got;
    if (s.cartel && s.eink) {
      for (int k = 0; k < 2; k++) {
        const bool okRun = k == 0 ? run_eink(s, mode, m, SCHED_A, 9, got, fx, rx) : run_eink(s, mode, m, SCHED_B, 4, got, fx, rx);
        expect(ln, ("e-ink : exécution complète : " + tag).c_str(), okRun);
        if (!okRun) continue;
        check(ln, ("e-ink frameHash : " + tag).c_str(), t[9], fx);
        check(ln, ("e-ink renderHash : " + tag).c_str(), t[10], rx);
        expect(ln, ("e-ink octets du pilote identiques à la référence à grille : " + tag).c_str(), got == want);
        g_stream++;
      }
    } else if (s.cartel) {   // tft18
      int lag = 0;
      const bool okRun = run_tft(s, mode, m, got, fx, rx, &lag);
      expect(ln, ("tft : exécution complète : " + tag).c_str(), okRun);
      if (okRun) {
        check(ln, ("tft frameHash : " + tag).c_str(), t[9], fx);
        check(ln, ("tft renderHash : " + tag).c_str(), t[10], rx);
        expect(ln, ("tft octets du pilote identiques à la référence à grille : " + tag).c_str(), got == want);
        if (lag > maxLag) maxLag = lag;
        g_stream++;
      }
    }
    if (!s.cartel || mode == POD_R_HIDDEN) {   // sans traitement : mêmes octets pour les deux hashes
      PodPassHasher<Sha> ph; char a[65], b[65];
      const bool okPass = ph.begin(s, mode) && feed_chunked(ph, g_planes[0], n, SCHED_A, 9) && (s.planes < 2 || feed_chunked(ph, g_planes[1], n, SCHED_B, 4)) && ph.finish(a, b);
      expect(ln, ("pass : exécution complète : " + tag).c_str(), okPass);
      if (okPass) { check(ln, ("pass frameHash : " + tag).c_str(), t[9], a); check(ln, ("pass renderHash : " + tag).c_str(), t[10], b); g_stream++; }
    }
    g_rvec++;
  }
  if (g_fail) { std::printf("ÉCHEC : %d écart(s), %d vérifications réussies\n", g_fail, g_pass); return 1; }
  if (g_rvec == 0 || g_stream == 0 || g_raw == 0) { std::printf("ÉCHEC : fichier de vecteurs vide (rvec=%d flux=%d raw=%d)\n", g_rvec, g_stream, g_raw); return 1; }
  std::printf("PASS %d (rvec=%d flux=%d raw=%d retardSourceMax=%d lignes)\n", g_pass, g_rvec, g_stream, g_raw, maxLag);
  return 0;
}
