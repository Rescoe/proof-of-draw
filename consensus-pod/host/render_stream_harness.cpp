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

static int g_pass = 0, g_fail = 0, g_rvec = 0, g_stream = 0;
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
  outBytes.clear(); uint8_t buf[4096]; int i = 0;
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
  { PodEinkRenderer<Sha> r; r.begin(e29, POD_R_FIT, ok, pl[0], pl[1], 4736); expect(ln, "e-ink : sortie nulle = 0", r.read(0, 16) == 0 && r.read(out, 0) == 0);
    uint8_t big[4096]; uint32_t tot = 0, g; while ((g = r.read(big, sizeof(big)))) tot += g;
    expect(ln, "e-ink : total produit = 2 × 4736", tot == 9472 && r.done()); expect(ln, "e-ink : lecture après la fin = 0", r.read(out, 16) == 0);
    expect(ln, "e-ink : finish ok", r.finish(hx)); expect(ln, "e-ink : second finish = faux", !r.finish(hy)); }
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

int main(int argc, char** argv) {
  if (argc < 2) { std::printf("usage : render_stream_harness <render-vectors.txt>\n"); return 2; }
  std::ifstream f(argv[1]);
  if (!f) { std::printf("fichier introuvable : %s\n", argv[1]); return 2; }
  invalid_and_truncated(0);
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
  if (g_rvec == 0 || g_stream == 0) { std::printf("ÉCHEC : fichier de vecteurs vide (rvec=%d flux=%d)\n", g_rvec, g_stream); return 1; }
  std::printf("PASS %d (rvec=%d flux=%d retardSourceMax=%d lignes)\n", g_pass, g_rvec, g_stream, maxLag);
  return 0;
}
