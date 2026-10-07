// host/render_harness.cpp — vérifie le port C++ du rasteriseur (podRender.h) contre les vecteurs d'or produits par la référence TypeScript (lib/renderLayout.ts).
//   render_harness <render-vectors.txt>  →  « PASS <n> » (code 0) ou la liste des écarts (code 1). Compilé par tests/renderCore.test.ts (g++ -std=c++11 -Wall -Wextra -Werror).
// Commandes : rfont (table de police), rtext (repli des accents), rvec (écran, motif, graine, mode, cartel → frameHash + renderHash). Une ligne inconnue est une ERREUR.
// Ce harnais n'intègre AUCUN .ino : il définit l'algorithme que les firmwares devront reproduire (lot 8B).
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>
#include "../src/podRender.h"
#include "../src/adapters/crypto_posix.h"

typedef PodSha256Host Sha;
static int g_pass = 0, g_fail = 0, g_rvec = 0, g_rtext = 0;

static void check(int line, const char* cmd, const char* what, const std::string& want, const std::string& got) {
  if (want == got) { g_pass++; return; }
  g_fail++;
  std::printf("ÉCART ligne %d [%s] %s\n  attendu : %s\n  obtenu  : %s\n", line, cmd, what, want.c_str(), got.c_str());
}
static std::vector<uint8_t> unhex(const std::string& h) {
  std::vector<uint8_t> out;
  if (h == "-") return out;
  for (size_t i = 0; i + 1 < h.size(); i += 2) { unsigned v = 0; std::sscanf(h.c_str() + i, "%2x", &v); out.push_back((uint8_t)v); }
  return out;
}
static std::string hexs(const uint8_t* d, size_t n) { std::string s(2 * n + 1, '\0'); pod_hex(d, n, &s[0]); s.resize(2 * n); return s; }
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

// tampons de travail de l'hôte (grilles logiques : 240×320 uint16_t au plus)
static uint16_t g_in[240 * 320], g_out[240 * 320], g_pat[240 * 320];
static uint8_t g_planes[2][240 * 320 * 2], g_final[2][240 * 320 * 2];

int main(int argc, char** argv) {
  if (argc < 2) { std::printf("usage : render_harness <render-vectors.txt>\n"); return 2; }
  std::ifstream f(argv[1]);
  if (!f) { std::printf("fichier introuvable : %s\n", argv[1]); return 2; }
  std::string line; int ln = 0;
  while (std::getline(f, line)) {
    ln++;
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    if (line.empty() || line[0] == '#') continue;
    std::vector<std::string> t; { size_t p = 0; while (p <= line.size()) { size_t q = line.find(' ', p); if (q == std::string::npos) q = line.size(); t.push_back(line.substr(p, q - p)); p = q + 1; } }
    const std::string& c = t[0];

    if (c == "rfont" && t.size() == 2) {
      check(ln, "rfont", "table 5×7", t[1], hexs(&POD_FONT_5X7[0][0], sizeof(POD_FONT_5X7)));
    } else if (c == "rtext" && t.size() == 3) {
      const std::vector<uint8_t> in = unhex(t[1]); char out[1024];
      const size_t n = pod_render_fold(in.empty() ? (const uint8_t*)"" : in.data(), in.size(), out, sizeof(out));
      check(ln, "rtext", "repli ASCII majuscules", t[2], hexs((const uint8_t*)out, n)); g_rtext++;
    } else if (c == "rvec" && t.size() == 11) {
      PodRenderScreen sc; PodRenderMode mode; PodRenderPattern pat = POD_P_WHITE; const bool bytes = t[2] == "bytes";
      if (!screen_of(t[1], sc) || !mode_of(t[4], mode) || (!bytes && !pattern_of(t[2], pat))) { g_fail++; std::printf("ÉCART ligne %d [rvec] écran / motif / mode inconnu\n", ln); continue; }
      const PodRenderSpec s = pod_render_spec(sc); const uint32_t seed = (uint32_t)std::strtoul(t[3].c_str(), nullptr, 10), n = pod_render_plane_bytes(s);
      if (bytes) { for (uint32_t i = 0; i < n; i++) g_planes[0][i] = (uint8_t)(pod_render_hash32(seed, i, 0) & 0xFF); }
      else { pod_render_pattern(s, pat, seed, g_pat); uint8_t* pp[2] = { g_planes[0], g_planes[1] }; pod_render_encode(s, g_pat, pp); }
      const std::vector<uint8_t> ts = unhex(t[6]), ar = unhex(t[7]), ti = unhex(t[8]);
      PodRenderMeta m = { ts.data(), ts.size(), (int32_t)std::strtol(t[5].c_str(), nullptr, 10), ar.data(), ar.size(), ti.data(), ti.size() };
      const uint8_t* in[2] = { g_planes[0], g_planes[1] }; uint8_t* fin[2] = { g_final[0], g_final[1] };
      char fh[65], rh[65];
      pod_render_frame<Sha>(s, mode, m, in, g_in, g_out, fin, fh, rh);
      const std::string tag = t[1] + " " + t[2] + " " + t[3] + " " + t[4];
      check(ln, "rvec", ("frameHash " + tag).c_str(), t[9], fh);
      check(ln, "rvec", ("renderHash " + tag).c_str(), t[10], rh);
      g_rvec++;
    } else { g_fail++; std::printf("ÉCART ligne %d : commande inconnue ou mal formée « %s » (%zu champs)\n", ln, c.c_str(), t.size()); }
  }
  if (g_fail) { std::printf("ÉCHEC : %d écart(s), %d vérifications réussies\n", g_fail, g_pass); return 1; }
  if (g_rvec == 0 || g_rtext == 0) { std::printf("ÉCHEC : fichier de vecteurs vide (rvec=%d rtext=%d)\n", g_rvec, g_rtext); return 1; }
  std::printf("PASS %d (rvec=%d rtext=%d)\n", g_pass, g_rvec, g_rtext);
  return 0;
}
