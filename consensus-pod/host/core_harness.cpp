// host/core_harness.cpp — vérifie le NOYAU C++ (consensusPoD.h) contre les vecteurs produits par la référence TypeScript.
//   core_harness <vectors.txt>  →  « PASS <n> » (code 0) ou la liste des écarts (code 1). Compilé par tests/consensusPodCore.test.ts (g++ -std=c++11 -Wall -Wextra -Werror).
// Chaque ligne du fichier est une vérification ; une ligne inconnue est une ERREUR (jamais ignorée en silence).
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "../src/consensusPoD.h"
#include "../src/adapters/crypto_posix.h"

typedef PodSha256Host Sha;
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
static std::string repeat(const char* s, int n) { std::string r; for (int i = 0; i < n; i++) r += s; return r; }

int main(int argc, char** argv) {
  if (argc < 2) { std::printf("usage : core_harness <vectors.txt>\n"); return 2; }
  FILE* f = std::fopen(argv[1], "r");
  if (!f) { std::printf("fichier introuvable : %s\n", argv[1]); return 2; }

  // l'adaptateur PC doit d'abord être juste sur les deux vecteurs FIPS 180-4
  { uint8_t o[32]; Sha s; s.begin(); s.finish(o); check(0, "sha256", "SHA-256(\"\")", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", hexs(o, 32));
    s.begin(); s.update("abc", 3); s.finish(o); check(0, "sha256", "SHA-256(\"abc\")", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hexs(o, 32)); }

  char line[4096]; int ln = 0;
  while (std::fgets(line, sizeof(line), f)) {
    ln++;
    size_t L = std::strlen(line); while (L && (line[L - 1] == '\n' || line[L - 1] == '\r')) line[--L] = 0;
    if (!L || line[0] == '#') continue;
    std::vector<std::string> t; { char* p = line; while (*p) { char* q = p; while (*q && *q != ' ') q++; t.push_back(std::string(p, q - p)); p = *q ? q + 1 : q; } }
    const std::string& c = t[0];

    if (c == "sha256hex" && t.size() == 3) {
      std::vector<uint8_t> in = unhex(t[1]); uint8_t o[32]; Sha s; s.begin();
      for (size_t i = 0; i < in.size(); i += 7) s.update(in.data() + i, (in.size() - i) < 7 ? in.size() - i : 7);   // mise à jour en morceaux irréguliers
      s.finish(o); check(ln, "sha256hex", "SHA-256 de n octets", t[2], hexs(o, 32));
    } else if (c == "rule" && t.size() == 6) {
      PodRule r = pod_evaluate_rules(t[1] == "1", t[2] == "1", (uint32_t)std::strtoul(t[3].c_str(), 0, 10), (uint32_t)std::strtoul(t[4].c_str(), 0, 10));
      check(ln, "rule", "règle N2", t[5], pod_rule_name(r));
    } else if (c == "nonce" && t.size() == 5) {
      uint8_t n[32]; pod_salt_nonce<Sha>(t[1].c_str(), t[2].c_str(), t[3].c_str(), n); check(ln, "nonce", "nonce du hash salé", t[4], hexs(n, 32));
    } else if (c == "salted" && t.size() == 4) {
      std::vector<uint8_t> nonce = unhex(t[1]), raw = unhex(t[2]); PodSalted<Sha> s; s.begin(nonce.data());
      for (size_t i = 0; i < raw.size(); i += 5) s.update(raw.data() + i, (raw.size() - i) < 5 ? raw.size() - i : 5);
      char h[65]; s.finish(h); check(ln, "salted", "hash salé en flux", t[3], h);
    } else if (c == "message" && t.size() == 15) {
      PodRule rule = POD_RULE_OK; for (int r = 0; r <= POD_RULE_RULES; r++) if (t[12] == pod_rule_name((PodRule)r)) rule = (PodRule)r;
      PodVoteV3 v = { t[1].c_str(), t[2].c_str(), t[3].c_str(), (uint32_t)std::atol(t[4].c_str()), (uint32_t)std::atol(t[5].c_str()), t[6].c_str(), t[7].c_str(),
                      (uint32_t)std::strtoul(t[8].c_str(), 0, 10), (uint32_t)std::strtoul(t[9].c_str(), 0, 10), (uint32_t)std::strtoul(t[10].c_str(), 0, 10), rule, t[13].c_str() };
      char m[512]; int n = pod_vote_message_v3(m, sizeof(m), v); check(ln, "message", "message de vote v3", t[14], n < 0 ? "(tampon trop petit)" : m);
      check(ln, "message", "verdict cohérent avec le motif", t[11], rule == POD_RULE_OK ? "accept" : "reject");
      char tiny[10]; check(ln, "message", "tampon trop petit détecté", "-1", std::to_string(pod_vote_message_v3(tiny, sizeof(tiny), v)));
    } else if (c == "leaf" && t.size() == 5) {
      uint8_t o[32]; pod_vote_leaf<Sha>(t[1].c_str(), t[2].c_str(), t[3].c_str(), o); check(ln, "leaf", "feuille de reçu", t[4], hexs(o, 32));
    } else if (c == "merkle" && t.size() == 3) {
      int n = std::atoi(t[1].c_str()); static uint8_t nodes[POD_MAX_SET][32];
      for (int i = 0; i < n; i++) { std::string m = "m" + std::to_string(i); pod_vote_leaf<Sha>(m.c_str(), repeat("ab", 64).c_str(), repeat("cd", 32).c_str(), nodes[i]); }
      uint8_t root[32]; bool ok = pod_merkle_root<Sha>(nodes, n, root); check(ln, "merkle", "racine de Merkle", t[2], ok ? hexs(root, 32) : "(refusé)");
    } else if (c == "cseed" && t.size() == 4) {
      char s[65]; pod_committee_seed<Sha>(t[1].c_str(), t[2].c_str(), s); check(ln, "cseed", "graine du comité", t[3], s);
    } else if (c == "crank" && t.size() == 4) {
      char r[65]; pod_committee_rank<Sha>(t[1].c_str(), t[2].c_str(), r); check(ln, "crank", "rang d'un profil", t[3], r);
    } else if (c == "decide" && t.size() == 8) {
      int K = std::atoi(t[1].c_str()), T = std::atoi(t[2].c_str()), W = std::atoi(t[3].c_str());
      check(ln, "decide", "seuil ⌈2K/3⌉", t[2], std::to_string(pod_threshold(K)));
      std::vector<uint8_t> v; for (char ch : t[4]) v.push_back((uint8_t)(ch - '0'));
      PodDecision d = pod_decide_seats(K, T, v.data(), W);
      check(ln, "decide", "état", t[5], std::to_string(d.state)); check(ln, "decide", "approbations", t[6], std::to_string(d.accepts)); check(ln, "decide", "refus", t[7], std::to_string(d.rejects));
    } else if (c == "miner" && t.size() == 8) {
      int n = std::atoi(t[4].c_str()); std::vector<std::string> names; std::vector<uint32_t> blocks;
      { std::string s = t[5]; size_t p = 0; while (p <= s.size()) { size_t q = s.find(',', p); if (q == std::string::npos) q = s.size(); std::string e = s.substr(p, q - p); size_t k = e.rfind(':'); names.push_back(e.substr(0, k)); blocks.push_back((uint32_t)std::strtoul(e.c_str() + k + 1, 0, 10)); p = q + 1; } }
      std::vector<PodMinerCand> cands; for (size_t i = 0; i < names.size(); i++) { PodMinerCand m = { names[i].c_str(), blocks[i] }; cands.push_back(m); }
      check(ln, "miner", "nombre de candidats", std::to_string(n), std::to_string(cands.size()));
      int w = pod_miner_draw<Sha>(t[1].c_str(), t[2].c_str(), t[3].c_str(), cands.data(), (int)cands.size());
      check(ln, "miner", "profil tiré", t[6], w < 0 ? "(aucun)" : names[w]);
      char cs[65], ms[65]; pod_committee_seed<Sha>(t[1].c_str(), t[2].c_str(), cs); pod_miner_seed<Sha>(cs, t[3].c_str(), ms); check(ln, "miner", "graine du mineur", t[7], ms);
    } else if (c == "croot" && t.size() == 7) {
      std::vector<std::string> ranked; if (t[5] != "-") { std::string s = t[5]; size_t p = 0; while (p <= s.size()) { size_t q = s.find(',', p); if (q == std::string::npos) q = s.size(); ranked.push_back(s.substr(p, q - p)); p = q + 1; } }
      std::vector<const char*> rp; for (size_t i = 0; i < ranked.size(); i++) rp.push_back(ranked[i].c_str());
      char r[65]; pod_committee_root<Sha>(t[1].c_str(), (uint32_t)std::strtoul(t[2].c_str(), 0, 10), (uint32_t)std::strtoul(t[3].c_str(), 0, 10), (uint32_t)std::strtoul(t[4].c_str(), 0, 10), rp.data(), (int)rp.size(), r);
      check(ln, "croot", "engagement du comité", t[6], r);
    } else if (c == "mroot" && t.size() == 5) {
      std::vector<std::string> names; std::vector<uint32_t> blocks;
      if (t[3] != "-") { std::string s = t[3]; size_t p = 0; while (p <= s.size()) { size_t q = s.find(',', p); if (q == std::string::npos) q = s.size(); std::string e = s.substr(p, q - p); size_t k = e.rfind(':'); names.push_back(e.substr(0, k)); blocks.push_back((uint32_t)std::strtoul(e.c_str() + k + 1, 0, 10)); p = q + 1; } }
      std::vector<PodMinerCand> cands; for (size_t i = 0; i < names.size(); i++) { PodMinerCand m = { names[i].c_str(), blocks[i] }; cands.push_back(m); }
      char r[65]; pod_miner_root<Sha>(t[1] == "-" ? 0 : t[1].c_str(), cands.data(), (int)cands.size(), r);
      check(ln, "mroot", "engagement du tirage du mineur", t[4], r);
    } else if (c == "metricsbad" && t.size() == 3) {
      // largeur invalide : AUCUN débordement du tampon de ligne, finish() refuse (audit GPT)
      struct Guard { PodMetrics m; uint8_t canary[64]; };
      static Guard g; memset(g.canary, 0xAA, sizeof(g.canary));
      g.m.begin((uint16_t)std::atoi(t[1].c_str()), 4);
      for (int i = 0; i < std::atoi(t[2].c_str()); i++) g.m.push(i & 1);
      bool intact = true; for (size_t i = 0; i < sizeof(g.canary); i++) if (g.canary[i] != 0xAA) intact = false;
      PodMetricsOut o; check(ln, "metricsbad", "tampon voisin intact", "1", intact ? "1" : "0"); check(ln, "metricsbad", "finish refuse", "0", g.m.finish(&o) ? "1" : "0");
    } else if (c == "block" && t.size() == 18) {
      std::vector<std::string> vals; if (t[7] != "-") { std::string s = t[7]; size_t p = 0; while (p <= s.size()) { size_t q = s.find(',', p); if (q == std::string::npos) q = s.size(); vals.push_back(s.substr(p, q - p)); p = q + 1; } }
      std::vector<const char*> vp; for (size_t i = 0; i < vals.size(); i++) vp.push_back(vals[i].c_str());
      PodBlockV2 b = { t[1].c_str(), t[2].c_str(), t[3].c_str(), t[4].c_str(), t[5].c_str(), t[6].c_str(), vp.data(), (int)vp.size(), (uint32_t)std::strtoul(t[8].c_str(), 0, 10),
                       (uint64_t)std::strtoull(t[9].c_str(), 0, 10), t[10] == "-" ? 0 : t[10].c_str(), t[11].c_str(), t[12].c_str(), (uint32_t)std::strtoul(t[13].c_str(), 0, 10), t[14].c_str(), t[15].c_str() };
      static char scratch[1536]; char hh[65]; int n = pod_block_hash_v2<Sha>(b, scratch, sizeof(scratch), hh);
      check(ln, "block", "texte canonique du bloc v2", t[16], n < 0 ? "(tampon trop petit)" : scratch); check(ln, "block", "hash du bloc v2", t[17], n < 0 ? "-" : hh);
    } else { g_fail++; std::printf("ÉCART ligne %d : commande inconnue ou mal formée (« %s », %zu jetons)\n", ln, c.c_str(), t.size()); }
  }
  std::fclose(f);
  if (g_fail) { std::printf("ÉCHEC : %d écart(s), %d vérification(s) conforme(s)\n", g_fail, g_pass); return 1; }
  std::printf("PASS %d\n", g_pass);
  return 0;
}
