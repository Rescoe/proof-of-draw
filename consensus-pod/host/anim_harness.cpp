// host/anim_harness.cpp — vérifie le noyau C++ « pod-anim-v3 » (podAnimV3.h) contre les vecteurs produits par la référence TypeScript (lib/animV3.ts).
//   anim_harness <anim-vectors.txt>  →  « PASS <n> » (code 0) ou la liste des écarts (code 1). Compilé par tests/animV3Core.test.ts (g++ -std=c++11 -Wall -Wextra -Werror).
// Chaque ligne est une vérification ; une ligne inconnue est une ERREUR. Les clips sont lus par MORCEAUX DE TAILLES IRRÉGULIÈRES (1, 2, 3, 5, 8, 13… octets) : l'automate ne doit rien
// supposer sur la découpe du flux (en réel : readFull() en boucle sur TLS).
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>
#include "../src/podAnimV3.h"
#include "../src/adapters/crypto_posix.h"

typedef PodSha256Host Sha;
// mémoire de l'automate de flux (image 1 024 o + métriques 240 o + 7 hachages + contextes SHA-256) : borne vérifiée à la compilation
static_assert(sizeof(PodAnimStream<Sha>) <= 2304, "PodAnimStream trop gros pour un ESP8266 / une R4");
static int g_pass = 0, g_fail = 0;

static void fail(int line, const char* cmd, const char* what, const std::string& want, const std::string& got) {
  g_fail++;
  std::printf("ÉCART ligne %d [%s] %s\n  attendu : %s\n  obtenu  : %s\n", line, cmd, what, want.c_str(), got.c_str());
}
static void check(int line, const char* cmd, const char* what, const std::string& want, const std::string& got) { if (want == got) g_pass++; else fail(line, cmd, what, want, got); }
static std::vector<uint8_t> unhex(const std::string& h) {
  std::vector<uint8_t> out;
  if (h == "-") return out;
  for (size_t i = 0; i + 1 < h.size(); i += 2) { unsigned v = 0; std::sscanf(h.c_str() + i, "%2x", &v); out.push_back((uint8_t)v); }
  return out;
}
static std::string hexs(const uint8_t* d, size_t n) { std::string s(2 * n + 1, '\0'); pod_hex(d, n, &s[0]); s.resize(2 * n); return s; }
static std::string u(uint32_t v) { return std::to_string(v); }

int main(int argc, char** argv) {
  if (argc < 2) { std::printf("usage : anim_harness <anim-vectors.txt>\n"); return 2; }
  std::ifstream f(argv[1]);
  if (!f) { std::printf("fichier introuvable : %s\n", argv[1]); return 2; }
  static const size_t CH[] = { 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 1024 };
  static PodAnimStream<Sha> stream;   // un seul objet : ~1,7 Ko

  std::string line; int ln = 0;
  while (std::getline(f, line)) {
    ln++;
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    if (line.empty() || line[0] == '#') continue;
    std::vector<std::string> t; { size_t p = 0; while (p <= line.size()) { size_t q = line.find(' ', p); if (q == std::string::npos) q = line.size(); t.push_back(line.substr(p, q - p)); p = q + 1; } }
    const std::string& c = t[0];

    if (c == "aclip" && t.size() == 13) {
      std::vector<uint8_t> clip = unhex(t[1]);
      stream.begin();
      size_t pos = 0, k = (size_t)ln % (sizeof(CH) / sizeof(CH[0]));
      while (pos < clip.size()) { size_t n = CH[k++ % (sizeof(CH) / sizeof(CH[0]))]; if (n > clip.size() - pos) n = clip.size() - pos; stream.update(clip.data() + pos, n); pos += n; }
      PodAnimResult r; bool ok = stream.finish(&r);
      check(ln, "aclip", "règle calculée seule", t[2], pod_anim_rule_name(r.rule));
      check(ln, "aclip", "octets lus", u((uint32_t)clip.size()), u(r.bytes));
      check(ln, "aclip", "hash du clip (octets lus)", t[4], r.clipHash);
      check(ln, "aclip", "format conforme", t[2] == "format" ? "0" : "1", ok ? "1" : "0");
      if (t[2] != "format") {
        check(ln, "aclip", "nombre d'images", t[3], u(r.frames));
        check(ln, "aclip", "framesRoot", t[5], r.framesRoot);
        check(ln, "aclip", "animRoot", t[6], r.animRoot);
        check(ln, "aclip", "E", t[7], u(r.E)); check(ln, "aclip", "T", t[8], u(r.T)); check(ln, "aclip", "R", t[9], u(r.R)); check(ln, "aclip", "S", t[10], u(r.S));
        check(ln, "aclip", "indice d'affiche", t[11], u(r.posterIndex)); check(ln, "aclip", "images toutes identiques", t[12], r.allIdentical ? "1" : "0");
      }
    } else if (c == "aleaf" && t.size() == 7) {
      std::vector<uint8_t> fh = unhex(t[1]); uint8_t o[32];
      pod_anim_leaf<Sha>(fh.data(), (uint32_t)std::strtoul(t[2].c_str(), 0, 10), (uint32_t)std::strtoul(t[3].c_str(), 0, 10), (uint32_t)std::strtoul(t[4].c_str(), 0, 10), (uint8_t)std::atoi(t[5].c_str()), o);
      check(ln, "aleaf", "feuille d'image", t[6], hexs(o, 32));
    } else if (c == "amerkle" && t.size() == 3) {
      int n = std::atoi(t[1].c_str()); PodMerkleStack<Sha> m; m.begin(); bool all = true;
      for (int i = 0; i < n; i++) { std::string s = "anim-leaf-" + std::to_string(i); uint8_t leaf[32]; Sha h; h.begin(); h.update(s.data(), s.size()); h.finish(leaf); all = all && m.push(leaf); }
      uint8_t root[32]; m.root(root);
      check(ln, "amerkle", "feuilles acceptées", "1", all ? "1" : "0"); check(ln, "amerkle", "racine de Merkle en flux", t[2], hexs(root, 32));
    } else if (c == "aroot" && t.size() == 8) {
      char r[65]; pod_anim_root<Sha>(t[1].c_str(), t[2].c_str(), (uint32_t)std::strtoul(t[3].c_str(), 0, 10), (uint32_t)std::strtoul(t[4].c_str(), 0, 10), (uint32_t)std::strtoul(t[5].c_str(), 0, 10), (uint32_t)std::strtoul(t[6].c_str(), 0, 10), r);
      check(ln, "aroot", "animRoot", t[7], r);
    } else if (c == "arule" && t.size() == 7) {
      PodAnimRule r = pod_anim_evaluate_rules(t[1] == "1", t[2] == "1", t[3] == "1", (uint32_t)std::strtoul(t[4].c_str(), 0, 10), (uint32_t)std::strtoul(t[5].c_str(), 0, 10));
      check(ln, "arule", "règle A1", t[6], pod_anim_rule_name(r));
    } else if (c == "avote" && t.size() == 17) {
      PodAnimRule rule = POD_ANIM_OK; for (int r = 0; r <= POD_ANIM_RULES; r++) if (t[14] == pod_anim_rule_name((PodAnimRule)r)) rule = (PodAnimRule)r;
      PodAnimVote v = { t[1].c_str(), t[2].c_str(), t[3].c_str(), (uint32_t)std::atol(t[4].c_str()), (uint32_t)std::atol(t[5].c_str()), t[6].c_str(), t[7].c_str(), t[8].c_str(),
                        (uint32_t)std::strtoul(t[9].c_str(), 0, 10), (uint32_t)std::strtoul(t[10].c_str(), 0, 10), (uint32_t)std::strtoul(t[11].c_str(), 0, 10), (uint32_t)std::strtoul(t[12].c_str(), 0, 10), (uint32_t)std::strtoul(t[13].c_str(), 0, 10), rule, t[15].c_str() };
      char m[640]; int n = pod_anim_vote_message(m, sizeof(m), v); check(ln, "avote", "message de vote d'animation", t[16], n < 0 ? "(tampon trop petit)" : m);
      char tiny[12]; check(ln, "avote", "tampon trop petit détecté", "-1", std::to_string(pod_anim_vote_message(tiny, sizeof(tiny), v)));
    } else if (c == "avotebad" && t.size() == 16) {
      // messages NON canoniques (un même rejet n'a qu'UNE représentation) : le constructeur refuse (−1)
      PodAnimRule rule = POD_ANIM_OK; for (int r = 0; r <= POD_ANIM_RULES; r++) if (t[14] == pod_anim_rule_name((PodAnimRule)r)) rule = (PodAnimRule)r;
      PodAnimVote v = { t[1].c_str(), t[2].c_str(), t[3].c_str(), (uint32_t)std::strtoul(t[4].c_str(), 0, 10), (uint32_t)std::strtoul(t[5].c_str(), 0, 10), t[6].c_str(), t[7].c_str(), t[8].c_str(),
                        (uint32_t)std::strtoul(t[9].c_str(), 0, 10), (uint32_t)std::strtoul(t[10].c_str(), 0, 10), (uint32_t)std::strtoul(t[11].c_str(), 0, 10), (uint32_t)std::strtoul(t[12].c_str(), 0, 10), (uint32_t)std::strtoul(t[13].c_str(), 0, 10), rule, t[15].c_str() };
      char m[640]; check(ln, "avotebad", "message non canonique refusé", "-1", std::to_string(pod_anim_vote_message(m, sizeof(m), v))); check(ln, "avotebad", "validité", "0", pod_anim_vote_valid(v) ? "1" : "0");
    } else if (c == "ablock" && t.size() == 19) {
      // jetons : 1 rulesVersion, 2 parent, 3 image, 4 actions, 5 contenu, 6 appareil, 7 écran, 8 validateurs, 9 score, 10 minedAt, 11 animRoot, 12 votesRoot, 13 mode, 14 K, 15 committeeRoot, 16 minerRoot, 17 texte, 18 hash
      std::vector<std::string> vv; if (t[8] != "-") { std::string s = t[8]; size_t p = 0; while (p <= s.size()) { size_t q = s.find(',', p); if (q == std::string::npos) q = s.size(); vv.push_back(s.substr(p, q - p)); p = q + 1; } }
      std::vector<const char*> vq; for (size_t i = 0; i < vv.size(); i++) vq.push_back(vv[i].c_str());
      PodBlockV2 nb = { t[2].c_str(), t[3].c_str(), t[4].c_str(), t[5].c_str(), t[6].c_str(), t[7].c_str(), vq.data(), (int)vq.size(), (uint32_t)std::strtoul(t[9].c_str(), 0, 10),
                        (uint64_t)std::strtoull(t[10].c_str(), 0, 10), t[11] == "-" ? 0 : t[11].c_str(), t[12].c_str(), t[13].c_str(), (uint32_t)std::strtoul(t[14].c_str(), 0, 10), t[15].c_str(), t[16].c_str(),
                        (uint32_t)std::strtoul(t[1].c_str(), 0, 10) };
      static char scratch[1536]; char hh[65]; int n = pod_block_hash_v2<Sha>(nb, scratch, sizeof(scratch), hh);
      check(ln, "ablock", "texte canonique du bloc (rulesVersion variable)", t[17], n < 0 ? "(refusé)" : scratch); check(ln, "ablock", "hash du bloc", t[18], n < 0 ? "-" : hh);
    } else if (c == "ablockbad" && t.size() == 2) {
      const char* none[1] = { 0 };
      PodBlockV2 b = { "p", "i", "a", "c", "d", "s", none, 0, 0, 0, 0, "v", "quorum", 1, "r", "m", (uint32_t)std::strtoul(t[1].c_str(), 0, 10) };
      static char scratch[1536]; check(ln, "ablockbad", "rulesVersion inconnue refusée", "-1", std::to_string(pod_block_canonical_v2(scratch, sizeof(scratch), b)));
    } else { g_fail++; std::printf("ÉCART ligne %d : commande inconnue ou mal formée (« %s », %zu jetons)\n", ln, c.c_str(), t.size()); }
  }
  if (g_fail) { std::printf("ÉCHEC : %d écart(s), %d vérification(s) conforme(s)\n", g_fail, g_pass); return 1; }
  std::printf("PASS %d\n", g_pass);
  return 0;
}
