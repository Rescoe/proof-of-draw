// host/ota_r4_harness.cpp — OTA R4-B (ADR OTA-5) : exécute le VRAI consensus-pod/src/podOtaR4.h sur l'hôte, avec la VRAIE bibliothèque Crypto 0.4.0 (Ed25519::verify, SHA256), contre les vecteurs de la référence TypeScript.
//   ota_r4_harness <ota-r4-vectors.txt>  ->  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// Prouve (HÔTE) : même verdict que lib/otaManifestR4.ts sur ~40 manifestes (dont chaque refus), flux de téléchargement borné (blocs <= 200 o, séquentiels), refus de Content-Length absent/différent, excès, troncature, SHA-256 faux
// (staging supprimé), relecture différente, vecteurs invalides, ticket à usage unique, programmation impossible sans ticket, séquence anti-rejeu sur deux blocs avec coupure à CHAQUE octet d'écriture (bloc 0 jamais touché).
// NE prouve PAS : le module Wi-Fi, SPIFFS, la pile Thumb, la data flash réelle, le comportement sur carte.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>
#include "../src/podOtaR4.h"
#include "Ed25519.h"
#include "SHA256.h"
#include "RNG.h"

RNGClass::RNGClass() {}
RNGClass::~RNGClass() {}
void RNGClass::rand(uint8_t*, size_t) { std::abort(); }
RNGClass RNG;

using namespace podotar4;
static int g_pass = 0, g_fail = 0;
static void expect(const std::string& name, bool ok) { if (ok) g_pass++; else { g_fail++; std::printf("ÉCART : %s\n", name.c_str()); } }
static std::vector<uint8_t> unhex(const std::string& s) {
  std::vector<uint8_t> o; if (s == "-") return o;
  for (size_t i = 0; i + 1 < s.size(); i += 2) o.push_back((uint8_t)std::strtoul(s.substr(i, 2).c_str(), nullptr, 16));
  return o;
}

// ── Ed25519 / SHA-256 injectés (Crypto 0.4.0) ──
static bool edVerify(void*, const uint8_t pub[32], const uint8_t* msg, size_t n, const uint8_t sig[64]) { return Ed25519::verify(sig, pub, msg, n); }
static const Verifier V = {edVerify, nullptr};
static void shaBegin(void* c) { ((SHA256*)c)->reset(); }
static void shaUpdate(void* c, const uint8_t* d, size_t n) { ((SHA256*)c)->update(d, n); }
static void shaEnd(void* c, uint8_t out[32]) { ((SHA256*)c)->finalize(out, 32); }

// ── staging simulé ──
struct StageSim {
  std::vector<uint8_t> data; bool exists = false; int removes = 0; int writes = 0; size_t maxWrite = 0; bool sequential = true;
  int failWriteAt = -1;                 // n° d'écriture qui échoue
  long corruptReadAt = -1;              // octet relu altéré (bit 0 inversé)
  bool shortRead = false;               // la relecture échoue au dernier bloc
};
static bool stWrite(void* c, uint32_t off, const uint8_t* d, size_t n) {
  StageSim* s = (StageSim*)c; if (s->failWriteAt >= 0 && s->writes == s->failWriteAt) { s->writes++; return false; }
  if (off != s->data.size()) s->sequential = false;
  if (n > s->maxWrite) s->maxWrite = n;
  s->exists = true; s->writes++; s->data.insert(s->data.end(), d, d + n); return true;
}
static bool stRead(void* c, uint32_t off, uint8_t* d, size_t n) {
  StageSim* s = (StageSim*)c; if (off + n > s->data.size()) return false;
  if (s->shortRead && off + n == s->data.size()) return false;
  std::memcpy(d, s->data.data() + off, n);
  if (s->corruptReadAt >= 0 && (size_t)s->corruptReadAt >= off && (size_t)s->corruptReadAt < off + n) d[s->corruptReadAt - off] ^= 1;
  return true;
}
static void stRemove(void* c) { StageSim* s = (StageSim*)c; s->data.clear(); s->exists = false; s->removes++; }

struct Rig { StageSim st; SHA256 sha; Session s; Rig() { Sha h = {shaBegin, shaUpdate, shaEnd, &sha}; Stage g = {stWrite, stRead, stRemove, &st}; init(s, h, g); } };

static Manifest makeManifest(const std::vector<uint8_t>& bin, uint8_t* shaOut) {
  Manifest m; std::memset(&m, 0, sizeof m); SHA256 h; h.reset(); h.update(bin.data(), bin.size()); h.finalize(shaOut, 32);
  m.size = (uint32_t)bin.size(); std::memcpy(m.sha, shaOut, 32); return m;
}
static std::vector<uint8_t> goodImage(size_t n = 1201) { std::vector<uint8_t> b(n); for (size_t i = 0; i < n; i++) b[i] = (uint8_t)(i * 31 + 7); b[0] = 0xF0; b[1] = 0x7F; b[2] = 0; b[3] = 0x20; b[4] = 0x01; b[5] = 0x41; b[6] = 0; b[7] = 0; return b; }

// feed en morceaux de taille `chunk` ; renvoie vrai si tout passe
static bool feedAll(Session& s, const std::vector<uint8_t>& bin, size_t chunk) {
  for (size_t off = 0; off < bin.size(); off += chunk) { size_t c = bin.size() - off < chunk ? bin.size() - off : chunk; if (!feed(s, bin.data() + off, c)) return false; }
  return true;
}

// ── vecteurs de la référence TypeScript ──
static void runVectors(const char* file) {
  std::ifstream in(file); if (!in) { std::printf("vecteurs illisibles\n"); std::exit(2); }
  std::string line; int n = 0;
  while (std::getline(in, line)) {
    char name[96], expectw[32], fam[64], chan[32], pa[80], pb[80]; unsigned long long inst, now; int pos = 0;
    if (std::sscanf(line.c_str(), "case %95s %31s %63s %llu %31s %llu %79s %79s %n", name, expectw, fam, &inst, chan, &now, pa, pb, &pos) < 8 || pos == 0) continue;
    std::string rest = line.substr(pos); size_t sp = rest.find(' ');
    const std::vector<uint8_t> man = unhex(rest.substr(0, sp)), bin = unhex(sp == std::string::npos ? "-" : rest.substr(sp + 1));
    const std::string tag = std::string("vec ") + name; n++;
    std::vector<uint8_t> ka = unhex(pa), kb = unhex(pb); Keys keys = {{ka.empty() ? nullptr : ka.data(), kb.empty() ? nullptr : kb.data()}};
    Device d = {fam, (uint32_t)inst, chan, now};
    uint8_t work[WORK_BYTES]; Manifest m; Why w = evaluate(man.data(), man.size(), keys, d, V, work, m);
    const std::string ex = expectw;
    if (ex != "size" && ex != "sha256" && ex != "ok") { expect(tag + " : refus attendu « " + ex + " », obtenu « " + whyName(w) + " »", ex == whyName(w)); continue; }
    expect(tag + " : evaluate accepte (« " + whyName(w) + " »)", w == W_OK);
    if (w != W_OK) continue;
    static const size_t CH[] = {1, 77, 200, 333, 4096};
    for (size_t ch : CH) {
      Rig r; const std::string t2 = tag + " (morceaux de " + std::to_string(ch) + ")";
      bool began = begin(r.s, m, (int64_t)bin.size());
      if (ex == "size") { expect(t2 + " : Content-Length honnête != taille signée -> refus E_LENGTH", !began && r.s.err == E_LENGTH && r.st.writes == 0); continue; }
      expect(t2 + " : begin", began);
      bool fed = began && feedAll(r.s, bin, ch); bool fin = fed && finish(r.s);
      if (ex == "sha256") { expect(t2 + " : SHA-256 faux -> E_HASH + staging supprimé", fed && !fin && r.s.err == E_HASH && !r.st.exists && r.st.removes >= 2 && r.s.st == S_FAILED && !r.s.ticket); continue; }
      expect(t2 + " : téléchargement complet", fed && fin);
      expect(t2 + " : staging écrit par blocs <= 200 o, séquentiels", r.st.maxWrite <= BLOCK && r.st.sequential && r.st.data == bin);
      expect(t2 + " : avant la relecture, AUCUN ticket", r.s.st == S_STAGED_UNTRUSTED && !r.s.ticket && !consume(r.s));
      expect(t2 + " : relecture", readback(r.s));
      expect(t2 + " : ticket émis une fois", r.s.ticket && r.s.st == S_READY);
      expect(t2 + " : consommation unique", consume(r.s) && !consume(r.s) && r.s.st == S_CONSUMED);
    }
  }
  std::printf("vecteurs : %d cas lus\n", n);
  expect("au moins 38 vecteurs lus", n >= 38);
}

// ── scénarios du flux (fautes injectées) ──
static std::vector<uint8_t> g_img;
static bool g_programmed = false; static int g_programCalls = 0;
static bool programFn(void*) { g_programmed = true; g_programCalls++; return true; }
static void flowTests() {
  g_img = goodImage(); uint8_t sh[32]; Manifest m = makeManifest(g_img, sh);
  { Rig r; expect("flux nominal", begin(r.s, m, 1201) && feedAll(r.s, g_img, 200) && finish(r.s) && readback(r.s) && r.s.ticket); }
  { Rig r; expect("Content-Length inconnu (-1) refusé", !begin(r.s, m, -1) && r.s.err == E_LENGTH && r.st.writes == 0); }
  { Rig r; expect("Content-Length trop petit refusé", !begin(r.s, m, 1200) && r.s.err == E_LENGTH); }
  { Rig r; expect("Content-Length trop grand refusé", !begin(r.s, m, 1202) && r.s.err == E_LENGTH); }
  { Rig r; expect("Content-Length 0 refusé", !begin(r.s, m, 0) && r.s.err == E_LENGTH); }
  { Rig r; begin(r.s, m, 1201); std::vector<uint8_t> big = g_img; big.push_back(0); bool ok = feedAll(r.s, big, 200); expect("octet en trop : refus E_EXCESS, staging supprimé", !ok && r.s.err == E_EXCESS && !r.st.exists && !r.s.ticket); }
  { Rig r; begin(r.s, m, 1201); std::vector<uint8_t> sh2(g_img.begin(), g_img.end() - 1); bool ok = feedAll(r.s, sh2, 200) && finish(r.s); expect("réponse tronquée : refus E_SHORT, staging supprimé", !ok && r.s.err == E_SHORT && !r.st.exists); }
  { Rig r; begin(r.s, m, 1201); r.st.failWriteAt = 3; bool ok = feedAll(r.s, g_img, 200); expect("écriture de staging en échec : E_STAGE_WRITE, staging supprimé", !ok && r.s.err == E_STAGE_WRITE && !r.st.exists); }
  { Rig r; begin(r.s, m, 1201); feedAll(r.s, g_img, 200); finish(r.s); r.st.corruptReadAt = 600; expect("relecture différente : E_READBACK_HASH, staging supprimé, pas de ticket", !readback(r.s) && r.s.err == E_READBACK_HASH && !r.st.exists && !r.s.ticket && !consume(r.s)); }
  { Rig r; begin(r.s, m, 1201); feedAll(r.s, g_img, 200); finish(r.s); r.st.shortRead = true; expect("relecture incomplète : E_STAGE_READ", !readback(r.s) && r.s.err == E_STAGE_READ && !r.s.ticket); }
  { Rig r; begin(r.s, m, 1201); feedAll(r.s, g_img, 200); finish(r.s); r.st.corruptReadAt = 0; expect("relecture altérée dans l'en-tête : refusée", !readback(r.s) && !r.s.ticket); }
  // vecteurs invalides : binaire dont le SHA est correct mais SP / reset invalides
  struct { const char* n; size_t idx; uint8_t val; } bad[] = {{"SP hors SRAM (sous)", 3, 0x10}, {"SP hors SRAM (au-dessus)", 3, 0x30}, {"reset sans bit Thumb", 4, 0x00}, {"reset hors image", 5, 0xF0}, {"reset sous 0x4000", 5, 0x20}};
  for (auto& b : bad) {
    std::vector<uint8_t> img = goodImage(); img[b.idx] = b.val; uint8_t s2[32]; Manifest m2 = makeManifest(img, s2); Rig r;
    begin(r.s, m2, (int64_t)img.size()); feedAll(r.s, img, 200); finish(r.s);
    expect(std::string("vecteurs invalides (") + b.n + ") : E_VECTOR, staging supprimé, pas de ticket", !readback(r.s) && r.s.err == E_VECTOR && !r.st.exists && !r.s.ticket);
  }
  { std::vector<uint8_t> img(4); uint8_t s2[32]; Manifest m2 = makeManifest(img, s2); Rig r; begin(r.s, m2, 4); feedAll(r.s, img, 4); finish(r.s); expect("image de 4 o (sans table de vecteurs) : refusée", !readback(r.s) && r.s.err == E_VECTOR); }
  // clé nulle ou absente : la garde est indépendante du vérificateur (ici PERMISSIF : il accepterait tout)
  { struct Y { static bool yes(void*, const uint8_t*, const uint8_t*, size_t, const uint8_t*) { return true; } };
    Verifier any = {Y::yes, nullptr}; uint8_t work[WORK_BYTES]; Manifest mm; Device dv = {"uno-r4-wifi-tft28", 5, "canary", 1800000000ull};
        std::string t = std::string("schema=pod-ota-manifest-r4-v1\nfamily=uno-r4-wifi-tft28\nfirmware=r4tft28-2.6\nseq=6\nchannel=canary\nsize=1201\nsha256=") + std::string(64, 'a') + "\nnotbefore=0\nkeyid=r4-a\nsig=" + std::string(128, 'b') + "\n";
    uint8_t zero[32] = {0}, one[32]; for (int i = 0; i < 32; i++) one[i] = 1;
    Keys kz = {{zero, one}}, kn = {{nullptr, one}}, ko = {{one, one}};
    expect("clé nulle refusée même avec un vérificateur permissif", evaluate((const uint8_t*)t.data(), t.size(), kz, dv, any, work, mm) == W_SIGNATURE);
    expect("clé absente refusée même avec un vérificateur permissif", evaluate((const uint8_t*)t.data(), t.size(), kn, dv, any, work, mm) == W_SIGNATURE);
    expect("contrôle : clé non nulle + vérificateur permissif -> accepté (la garde ne bloque pas tout)", evaluate((const uint8_t*)t.data(), t.size(), ko, dv, any, work, mm) == W_OK);
    std::memset(work, 0xEE, sizeof work); evaluate((const uint8_t*)t.data(), t.size(), ko, dv, any, work, mm);
    bool wiped = true; for (size_t i = 0; i < sizeof work; i++) if (work[i]) wiped = false;
    expect("le tampon de travail (domaine + corps) est effacé après la vérification", wiped); }
  // ordre des appels
  { Rig r; expect("feed avant begin refusé", !feed(r.s, g_img.data(), 10) && r.s.st == S_FAILED); }
  { Rig r; expect("finish avant begin refusé", !finish(r.s)); }
  { Rig r; expect("readback avant begin refusé", !readback(r.s)); }
  { Rig r; begin(r.s, m, 1201); feedAll(r.s, g_img, 200); expect("readback avant finish refusé", !readback(r.s) && !r.s.ticket); }
  { Rig r; begin(r.s, m, 1201); expect("deuxième begin refusé", !begin(r.s, m, 1201)); }
  { Rig r; begin(r.s, m, 1201); feedAll(r.s, g_img, 200); finish(r.s); expect("consume avant readback refusé", !consume(r.s)); }
  // programmation : jamais sans ticket, une seule fois
  { Rig r; g_programmed = false; g_programCalls = 0; expect("programmation sans rien : refusée, fonction non appelée", !programWithTicket(r.s, programFn, nullptr) && !g_programmed); }
  { Rig r; begin(r.s, m, 1201); feedAll(r.s, g_img, 200); finish(r.s); g_programmed = false; expect("programmation avec staging non relu : refusée", !programWithTicket(r.s, programFn, nullptr) && !g_programmed); }
  { Rig r; begin(r.s, m, 1201); feedAll(r.s, g_img, 200); finish(r.s); r.st.corruptReadAt = 700; readback(r.s); g_programmed = false; expect("programmation après relecture en échec : refusée", !programWithTicket(r.s, programFn, nullptr) && !g_programmed); }
  { Rig r; begin(r.s, m, 1201); feedAll(r.s, g_img, 200); finish(r.s); readback(r.s); g_programmed = false; g_programCalls = 0;
    bool a = programWithTicket(r.s, programFn, nullptr), b = programWithTicket(r.s, programFn, nullptr);
    expect("ticket : UNE programmation, la seconde (réutilisation) est refusée", a && !b && g_programCalls == 1); }
  { Rig r; begin(r.s, m, 1201); feedAll(r.s, g_img, 200); r.s.ticket = true; r.s.st = S_STAGED_UNTRUSTED; g_programmed = false; expect("ticket forgé sans l'état READY : refusé", !programWithTicket(r.s, programFn, nullptr) && !g_programmed); }
}

// ── data flash simulée : 8 blocs de 1 Ko, coupure à n'importe quel octet d'une écriture de bloc ──
struct FlashSim {
  uint8_t blk[8][1024]; long cutAt = -1;      // cutAt = nombre d'octets écrits avant coupure (-1 : pas de coupure) ; l'effacement a eu lieu
  int writes = 0; int writesTo[8] = {0}; bool failRead[8] = {false}; bool cutFill = false; bool silentCorrupt = false;
  FlashSim() { std::memset(blk, 0xFF, sizeof blk); }
};
static bool flRead(void* c, uint8_t b, uint8_t* out) { FlashSim* f = (FlashSim*)c; if (b > 7 || f->failRead[b]) return false; std::memcpy(out, f->blk[b], 1024); return true; }
static bool flWrite(void* c, uint8_t b, const uint8_t* in) {
  FlashSim* f = (FlashSim*)c; if (b > 7) return false; f->writes++; f->writesTo[b]++;
  if (f->cutAt >= 0) { std::memset(f->blk[b], 0xFF, 1024); std::memcpy(f->blk[b], in, (size_t)f->cutAt); if (f->cutFill) for (size_t i = (size_t)f->cutAt; i < 1024; i++) f->blk[b][i] = 0x5A; return false; }
  std::memcpy(f->blk[b], in, 1024); if (f->silentCorrupt) f->blk[b][9] ^= 1;
  return true;
}
static void seqTests() {
  uint8_t buf[1024];
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; SeqState s = seqLoad(fl, 5, buf); expect("flash vierge : séquence = compilée, ok", s.ok && s.seq == 5); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; expect("commit refusé si seq <= effective", !seqCommit(fl, 5, 5, buf) && !seqCommit(fl, 5, 4, buf) && f.writes == 0); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; expect("commit 6 puis 7 puis 8 (alternance A,B,A)", seqCommit(fl, 5, 6, buf) && f.writesTo[2] == 1 && seqCommit(fl, 5, 7, buf) && f.writesTo[3] == 1 && seqCommit(fl, 5, 8, buf) && f.writesTo[2] == 2);
    SeqState s = seqLoad(fl, 5, buf); expect("effective après 3 commits = 8, gen 3", s.ok && s.seq == 8 && s.gen == 3);
    expect("seq 7 rejouée refusée", !seqCommit(fl, 5, 7, buf)); expect("seq 8 identique refusée", !seqCommit(fl, 5, 8, buf));
    for (int b = 0; b < 8; b++) if (b != 2 && b != 3) expect("bloc " + std::to_string(b) + " jamais écrit", f.writesTo[b] == 0); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; expect("la séquence compilée plus haute l'emporte (effective = max)", seqCommit(fl, 5, 6, buf) && seqLoad(fl, 9, buf).seq == 9 && !seqCommit(fl, 9, 8, buf) && seqCommit(fl, 9, 10, buf)); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; seqCommit(fl, 5, 6, buf); f.blk[2][9] ^= 1; SeqState s = seqLoad(fl, 5, buf); expect("un seul enregistrement corrompu, l'autre vierge : ok mais seq retombe sur la compilée (jamais d'invention)", s.ok && s.seq == 5); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; seqCommit(fl, 5, 6, buf); seqCommit(fl, 5, 7, buf); f.blk[3][9] ^= 1; SeqState s = seqLoad(fl, 5, buf); expect("deux blocs : le plus récent corrompu -> l'ancien reste valide, seq = 6", s.ok && s.seq == 6); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; seqCommit(fl, 5, 6, buf); seqCommit(fl, 5, 7, buf); f.blk[2][9] ^= 1; f.blk[3][9] ^= 1; SeqState s = seqLoad(fl, 5, buf); expect("deux blocs non vierges et invalides : OTA REFUSÉE", !s.ok && !seqCommit(fl, 5, 99, buf)); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; seqCommit(fl, 5, 6, buf); f.failRead[3] = true; f.failRead[2] = true; expect("lecture impossible des deux blocs : refus (échec fermé)", !seqLoad(fl, 5, buf).ok); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; seqCommit(fl, 5, 6, buf); uint8_t keep[1024]; std::memcpy(keep, f.blk[2], 1024); f.blk[2][8] = 0; /* seq change sans CRC */ expect("CRC faux : enregistrement invalide", seqLoad(fl, 5, buf).seq == 5); std::memcpy(f.blk[2], keep, 1024); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; seqCommit(fl, 5, 6, buf); f.blk[3][0] = 'O'; makeRecord(f.blk[3], 0, 1); expect("enregistrement de seq 0 : invalide", seqLoad(fl, 5, buf).seq == 6); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; makeRecord(f.blk[2], 2147483648u, 1); makeRecord(f.blk[3], 7, 1); SeqState s = seqLoad(fl, 5, buf); expect("seq > 2^31-1 : enregistrement invalide", s.ok && s.seq == 7); }
  { // écriture qui MENT (renvoie vrai mais corrompt) : la relecture doit la refuser, la séquence n'est pas consommée
    FlashSim f; Flash fl = {flRead, flWrite, &f}; f.silentCorrupt = true; expect("écriture silencieusement corrompue : commit refusé (relecture)", !seqCommit(fl, 5, 6, buf)); f.silentCorrupt = false;
    expect("... et la séquence effective reste la compilée", seqLoad(fl, 5, buf).seq == 5); }
  for (int idx = 0; idx < 8; idx++) { // magic, version, nature, réservé : chacun altéré AVEC un CRC recalculé -> invalide
    FlashSim f; Flash fl = {flRead, flWrite, &f}; seqCommit(fl, 5, 6, buf); seqCommit(fl, 5, 7, buf);
    uint8_t* b = f.blk[3]; b[idx] ^= 0x01; putLe32(b + 16, crc32(b, 16));
    SeqState s = seqLoad(fl, 5, buf); expect("octet " + std::to_string(idx) + " de l'enregistrement altéré (CRC recalculé) : enregistrement invalide, l'ancien survit (seq 6)", s.ok && s.seq == 6); }
  { FlashSim f; Flash fl = {flRead, flWrite, &f}; std::memset(f.blk[2], 0xFF, 16); std::memset(f.blk[2] + 16, 0, 4); std::memset(f.blk[3], 0xFF, 16); std::memset(f.blk[3] + 16, 0, 4);
    expect("blocs dont seuls les 4 derniers octets du CRC diffèrent de « vierge » : NON vierges et invalides -> refus", !seqLoad(fl, 5, buf).ok); }
  // COUPURE à chaque octet de l'écriture, depuis plusieurs états de départ
  for (int start = 0; start < 3; start++) {
    int bad = 0, total = 0;
    for (long cut = 0; cut <= 1024; cut++) for (int fill = 0; fill < 2; fill++) {
      FlashSim f; Flash fl = {flRead, flWrite, &f}; uint32_t before = 5;
      if (start >= 1) seqCommit(fl, 5, 6, buf);
      if (start >= 2) seqCommit(fl, 5, 7, buf);
      before = seqLoad(fl, 5, buf).seq; uint8_t keep0[1024]; std::memcpy(keep0, f.blk[0], 1024);
      f.cutAt = cut; f.cutFill = fill != 0; bool r = seqCommit(fl, 5, before + 1, buf); total++;
      SeqState after = seqLoad(fl, 5, buf); f.cutAt = -1;
      if (r) { bad++; continue; }                                            // une coupure ne peut pas être un succès
      if (after.ok && after.seq < before) bad++;                             // la séquence ne baisse JAMAIS
      if (std::memcmp(keep0, f.blk[0], 1024) != 0) bad++;                    // le bloc 0 (clés) est intact
      if (f.writesTo[0] || f.writesTo[1] || f.writesTo[4] || f.writesTo[5] || f.writesTo[6] || f.writesTo[7]) bad++;
      if (!after.ok && start >= 1) bad++;                                    // l'autre enregistrement valide survit : jamais « refusé » à cause d'une seule coupure
      if (cut < 20 && after.ok && after.seq == before + 1) bad++;            // enregistrement incomplet (< 20 o) : jamais compté comme consommé (>= 20 o : record complet et valide, seq plus haute, sans danger)
      FlashSim g = f; g.cutAt = -1; Flash gl = {flRead, flWrite, &g};          // reprise : après la coupure, un commit propre réussit toujours
      if (after.ok && !seqCommit(gl, 5, after.seq + 1, buf)) bad++;
    }
    expect("coupure à chaque octet (départ " + std::to_string(start) + ", " + std::to_string(total) + " essais) : seq jamais en baisse, bloc 0 intact, reprise possible, jamais consommée", bad == 0);
  }
}

int main(int argc, char** argv) {
  if (argc < 2) { std::printf("usage : ota_r4_harness <ota-r4-vectors.txt>\n"); return 2; }
  runVectors(argv[1]); flowTests(); seqTests();
  // CRC-32 : vecteur standard « 123456789 » -> CBF43926
  expect("CRC-32 (123456789) = CBF43926", crc32((const uint8_t*)"123456789", 9) == 0xCBF43926u);
  if (g_fail) { std::printf("%d ÉCART(S), %d contrôles passés\n", g_fail, g_pass); return 1; }
  std::printf("PASS %d\n", g_pass); return 0;
}
