// podOtaR4.h — OTA R4-B (ADR OTA-5, 17/10/2026) : noyau PUR (aucune dépendance Arduino, aucune allocation) du chemin « manifeste signé -> binaire brut -> staging NON APPROUVÉ -> hash -> relecture -> ticket ».
// ⚠ LABORATOIRE : testé sur l'HÔTE seulement (consensus-pod/host/ota_r4_harness.cpp, vecteurs produits par lib/otaManifestR4.ts). Aucun firmware de production ne l'inclut ; jamais exécuté sur une carte. AUCUNE programmation ici :
// le noyau ne contient aucun appel au module (ni OTAUpdate.download, ni update()) ; il décide seulement, et ne remet à l'appelant qu'un ticket CONSOMMABLE UNE FOIS.
// Dépendances INJECTÉES (l'appelant choisit la pile) : Ed25519 (sur la R4 : PodEd), SHA-256 incrémental, écriture/relecture/suppression du fichier de staging par blocs <= 200 o, bloc de la data flash.
// Discipline de pile (R4, pile principale = 1 024 o) : ce noyau n'utilise que de petits cadres (<= 256 o hors tampons de l'appelant) mais il est appelé DEPUIS les piles dédiées : analyse du manifeste et vérification de signature
// sur la pile de travail/PodEd, feed() depuis la lambda podNetRun (les écritures +FS exigent une pile réseau agrandie, à MESURER), relecture/hash sur podWifiRun, jamais imbriqués.
// Formulation obligatoire : le binaire téléchargé est placé dans une zone de staging NON APPROUVÉE ; il ne devient flashable qu'après validation de la signature du manifeste, du hash complet et de la relecture.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace podotar4 {

static const uint32_t MAX_SIZE = 0x3C000u;        // flash applicative : 0x40000 - 0x4000
static const uint32_t MAX_MANIFEST = 512u;
static const uint32_t MAX_SEQ = 2147483647u;
static const uint32_t BLOCK = 200u;               // taille d'un bloc +FS (démontrée sur carte ; 255 NON démontré)
static const uint32_t WORK_BYTES = 536u;          // domaine (23) + corps (<= 512)
static const uint32_t APP_BASE = 0x4000u, SRAM_LO = 0x20000000u, SRAM_HI = 0x20008000u;
static const char DOMAIN[] = "POD-OTA-R4-MANIFEST-V1\n";   // 23 octets (sans le NUL)
static const uint32_t DOMAIN_LEN = 23u;

enum Why : uint8_t { W_OK = 0, W_PARSE, W_SIGNATURE, W_FAMILY, W_CHANNEL, W_NOT_NEWER, W_NOT_ACTIVE, W_VOTE_INCOMPAT };

struct Manifest {
  char family[20]; char firmware[32]; char channel[12]; char keyid[5];
  uint32_t seq, size; uint64_t notbefore; uint8_t sha[32]; uint8_t sig[64]; uint16_t bodyLen;
};

struct Verifier { bool (*verify)(void* ctx, const uint8_t pub[32], const uint8_t* msg, size_t n, const uint8_t sig[64]); void* ctx; };
struct Keys { const uint8_t* pub[2]; };           // [0] = r4-a, [1] = r4-b ; nullptr = clé absente
struct Device { const char* family; uint32_t installedSeq; const char* channel; uint64_t now; };

static inline bool eq(const char* a, const char* b) { return strcmp(a, b) == 0; }
static inline int hexv(char c) { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return c - 'a' + 10; return -1; }   // minuscules SEULEMENT
static inline bool hexN(const uint8_t* s, size_t nChars, uint8_t* out) {
  if (nChars % 2) return false;
  for (size_t i = 0; i < nChars; i += 2) { int h = hexv((char)s[i]), l = hexv((char)s[i + 1]); if (h < 0 || l < 0) return false; out[i / 2] = (uint8_t)((h << 4) | l); }
  return true;
}
/** UINT canonique : « 0 » ou 1 à 10 chiffres sans zéro initial. */
static inline bool uintOk(const uint8_t* s, size_t n, uint64_t& v) {
  if (n == 0 || n > 10) return false;
  if (s[0] == '0' && n > 1) return false;
  uint64_t x = 0; for (size_t i = 0; i < n; i++) { if (s[i] < '0' || s[i] > '9') return false; x = x * 10 + (uint64_t)(s[i] - '0'); }
  v = x; return true;
}
static inline bool digitsRun(const uint8_t* s, size_t n, size_t& i, int minN, int maxN, uint32_t& v) {
  int c = 0; uint32_t x = 0; while (i < n && s[i] >= '0' && s[i] <= '9' && c < maxN + 1) { x = x * 10 + (uint32_t)(s[i] - '0'); i++; c++; }
  if (c < minN || c > maxN) return false;
  v = x; return true;
}
/** `^([a-z0-9]{1,16})-(\d{1,3})\.(\d{1,3})(\.\d{1,3})?$` ; remplit prefix (<= 16) ; major/minor. */
static inline bool firmwareOk(const uint8_t* s, size_t n, char* prefix, uint32_t& major, uint32_t& minor) {
  size_t i = 0; while (i < n && ((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9'))) i++;
  if (i < 1 || i > 16 || i >= n || s[i] != '-') return false;
  memcpy(prefix, s, i); prefix[i] = 0; i++;
  if (!digitsRun(s, n, i, 1, 3, major)) return false;
  if (i >= n || s[i] != '.') return false;
  i++;
  if (!digitsRun(s, n, i, 1, 3, minor)) return false;
  if (i < n) { if (s[i] != '.') return false; i++; uint32_t patch; if (!digitsRun(s, n, i, 1, 3, patch)) return false; }
  return i == n;
}
/** Même table que lib/voteCapability.ts VOTE_V2_FIRMWARE (test de dérive côté TypeScript). */
static inline bool voteCapable(const char* prefix, uint32_t major, uint32_t minor) {
  static const struct { const char* p; uint8_t maj, min; } T[] = {
    {"r4tft28", 2, 5}, {"r4eink29", 1, 1}, {"r4eink27", 1, 1}, {"r4multiscreen", 1, 1}, {"r4tft18", 1, 1},
    {"multiscreen", 2, 5}, {"multibwr", 2, 1}, {"eink27bw", 2, 1}, {"eink29bwr", 2, 3}, {"tft18", 2, 4}};
  for (size_t i = 0; i < sizeof(T) / sizeof(T[0]); i++) if (eq(prefix, T[i].p)) return major > T[i].maj || (major == T[i].maj && minor >= T[i].min);
  return false;
}

/** Familles R4 (miroir de R4_FAMILIES) : écran TFT 2,8″, écran TFT 1,8″ avec capteurs, station capteur seule (sans vote). */
static inline bool familyOk(const uint8_t* s, size_t n) {
  return (n == 17 && (memcmp(s, "uno-r4-wifi-tft28", 17) == 0 || memcmp(s, "uno-r4-wifi-tft18", 17) == 0)) || (n == 18 && memcmp(s, "uno-r4-wifi-sensor", 18) == 0);
}
/** Cette famille vote-t-elle ? (la station capteur est exemptée du contrôle « firmware capable de voter »). */
static inline bool familyVotes(const char* family) { return strcmp(family, "uno-r4-wifi-sensor") != 0; }

/** Analyse STRICTE (miroir de parseR4Manifest). Ne lit jamais hors de [raw, raw+n). */
static inline bool parse(const uint8_t* raw, size_t n, Manifest& m) {
  memset(&m, 0, sizeof m);
  if (n == 0 || n > MAX_MANIFEST) return false;
  for (size_t i = 0; i < n; i++) if (!(raw[i] == 0x0a || (raw[i] >= 0x20 && raw[i] <= 0x7e))) return false;
  if (raw[n - 1] != '\n') return false;
  size_t lines = 0; for (size_t i = 0; i < n; i++) if (raw[i] == '\n') lines++;
  if (lines != 10) return false;
  static const char* const KEY[9] = {"schema", "family", "firmware", "seq", "channel", "size", "sha256", "notbefore", "keyid"};
  const uint8_t* val[9]; size_t vlen[9]; size_t pos = 0;
  for (int k = 0; k < 9; k++) {
    size_t e = pos; while (raw[e] != '\n') e++;
    size_t kl = strlen(KEY[k]);
    if (e - pos < kl + 1 || memcmp(raw + pos, KEY[k], kl) != 0 || raw[pos + kl] != '=') return false;
    val[k] = raw + pos + kl + 1; vlen[k] = e - pos - kl - 1; pos = e + 1;
  }
  size_t e = pos; while (raw[e] != '\n') e++;
  if (e - pos < 4 || memcmp(raw + pos, "sig=", 4) != 0) return false;
  const uint8_t* sg = raw + pos + 4; size_t sl = e - pos - 4;
  static const char SCHEMA[] = "pod-ota-manifest-r4-v1";
  if (vlen[0] != sizeof(SCHEMA) - 1 || memcmp(val[0], SCHEMA, vlen[0]) != 0) return false;
  if (!familyOk(val[1], vlen[1])) return false;
  memcpy(m.family, val[1], vlen[1]);
  char pre[17]; uint32_t maj, mnr; if (vlen[2] >= sizeof m.firmware || !firmwareOk(val[2], vlen[2], pre, maj, mnr)) return false;
  memcpy(m.firmware, val[2], vlen[2]);
  uint64_t seq, size, nb; if (!uintOk(val[3], vlen[3], seq) || !uintOk(val[5], vlen[5], size) || !uintOk(val[7], vlen[7], nb)) return false;
  if (seq < 1 || seq > MAX_SEQ) return false;
  if (size < 1 || size > MAX_SIZE) return false;
  m.seq = (uint32_t)seq; m.size = (uint32_t)size; m.notbefore = nb;
  auto is = [&](int k, const char* s) { return vlen[k] == strlen(s) && memcmp(val[k], s, vlen[k]) == 0; };
  if (is(4, "development")) strcpy(m.channel, "development"); else if (is(4, "canary")) strcpy(m.channel, "canary"); else if (is(4, "stable")) strcpy(m.channel, "stable"); else return false;
  if (vlen[6] != 64 || !hexN(val[6], 64, m.sha)) return false;
  if (is(8, "r4-a")) strcpy(m.keyid, "r4-a"); else if (is(8, "r4-b")) strcpy(m.keyid, "r4-b"); else return false;
  if (sl != 128 || !hexN(sg, 128, m.sig)) return false;
  m.bodyLen = (uint16_t)(n - (4 + 128 + 1));
  return true;
}

static inline bool allZero(const uint8_t* p, size_t n) { for (size_t i = 0; i < n; i++) if (p[i]) return false; return true; }

/** Contrat complet, ordre des refus identique à evaluateR4Manifest. `work` >= WORK_BYTES (tampon de l'appelant : domaine + corps). */
static inline Why evaluate(const uint8_t* raw, size_t n, const Keys& keys, const Device& d, const Verifier& v, uint8_t* work, Manifest& m) {
  if (!parse(raw, n, m)) return W_PARSE;
  const uint8_t* pub = keys.pub[eq(m.keyid, "r4-b") ? 1 : 0];
  if (!pub || allZero(pub, 32)) return W_SIGNATURE;        // clé absente ou NULLE : refus (défense en profondeur)
  memcpy(work, DOMAIN, DOMAIN_LEN); memcpy(work + DOMAIN_LEN, raw, m.bodyLen);
  bool good = v.verify(v.ctx, pub, work, DOMAIN_LEN + m.bodyLen, m.sig);
  memset(work, 0, WORK_BYTES);
  if (!good) return W_SIGNATURE;
  if (!eq(m.family, d.family)) return W_FAMILY;
  if (eq(m.channel, "development") || !eq(m.channel, d.channel)) return W_CHANNEL;
  { char pre[17]; uint32_t a, b; if (!firmwareOk((const uint8_t*)m.firmware, strlen(m.firmware), pre, a, b) || (familyVotes(m.family) && !voteCapable(pre, a, b))) return W_VOTE_INCOMPAT; }
  if (m.seq <= d.installedSeq) return W_NOT_NEWER;
  if (m.notbefore > d.now) return W_NOT_ACTIVE;
  return W_OK;
}
static inline const char* whyName(Why w) {
  switch (w) { case W_OK: return "ok"; case W_PARSE: return "parse"; case W_SIGNATURE: return "signature"; case W_FAMILY: return "family"; case W_CHANNEL: return "channel";
    case W_NOT_NEWER: return "not-newer"; case W_NOT_ACTIVE: return "not-active"; case W_VOTE_INCOMPAT: return "vote-incompatible"; }
  return "?";
}

// ── téléchargement borné, staging non approuvé, relecture, ticket ─────────────────────────────────────────
struct Sha { void (*begin)(void*); void (*update)(void*, const uint8_t*, size_t); void (*end)(void*, uint8_t out[32]); void* ctx; };
struct Stage { bool (*write)(void*, uint32_t off, const uint8_t*, size_t); bool (*read)(void*, uint32_t off, uint8_t*, size_t); void (*remove)(void*); void* ctx; };

enum State : uint8_t { S_IDLE = 0, S_MANIFEST_OK, S_DOWNLOADING, S_STAGED_UNTRUSTED, S_READY, S_CONSUMED, S_FAILED };
enum Err : uint8_t { E_NONE = 0, E_STATE, E_LENGTH, E_EXCESS, E_SHORT, E_HASH, E_STAGE_WRITE, E_STAGE_READ, E_READBACK_SIZE, E_READBACK_HASH, E_VECTOR, E_ARG };

static inline uint32_t le32(const uint8_t* p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
/** Vecteurs Cortex-M plausibles (identique au ticket OTA-3) : SP dans la SRAM, reset impair, DANS l'image chargée à 0x4000. */
static inline bool vectorsOk(const uint8_t head[8], uint32_t size) {
  if (size < 8) return false;
  uint32_t sp = le32(head), rst = le32(head + 4);
  if (sp < SRAM_LO || sp > SRAM_HI) return false;
  return (rst & 1u) && rst >= APP_BASE && rst < APP_BASE + size;
}

struct Session {
  Manifest m; State st; Err err; uint32_t received; uint8_t head[8]; bool ticket;
  Sha sha; Stage stage; bool stageTouched;
};

static inline void fail(Session& s, Err e) {
  if (s.stageTouched) { s.stage.remove(s.stage.ctx); s.stageTouched = false; }   // un staging refusé n'est jamais laissé
  s.ticket = false; s.st = S_FAILED; s.err = e;
}
static inline void init(Session& s, const Sha& sha, const Stage& stage) { memset(&s, 0, sizeof s); s.sha = sha; s.stage = stage; s.st = S_IDLE; }

/** Après evaluate()==W_OK. contentLength < 0 = inconnu (chunked, absent) : REFUSÉ. Doit être égal à la taille SIGNÉE. Supprime tout staging antérieur. */
static inline bool begin(Session& s, const Manifest& m, int64_t contentLength) {
  if (s.st != S_IDLE) { fail(s, E_STATE); return false; }
  if (contentLength < 0 || (uint64_t)contentLength != (uint64_t)m.size) { s.st = S_FAILED; s.err = E_LENGTH; return false; }
  s.m = m; s.stage.remove(s.stage.ctx); s.stageTouched = true; s.sha.begin(s.sha.ctx); s.received = 0; s.st = S_DOWNLOADING; return true;
}
/** Reçoit n octets du réseau : au plus BLOCK octets par écriture de staging ; refus au premier octet en trop. Le SHA-256 est calculé AU FIL de la réception ; rien n'est « vérifié » avant finish() + readback(). */
static inline bool feed(Session& s, const uint8_t* data, size_t n) {
  if (s.st != S_DOWNLOADING) { fail(s, E_STATE); return false; }
  if ((uint64_t)s.received + n > s.m.size) { fail(s, E_EXCESS); return false; }
  size_t off = 0;
  while (off < n) {
    size_t c = n - off > BLOCK ? BLOCK : n - off;
    if (!s.stage.write(s.stage.ctx, s.received, data + off, c)) { fail(s, E_STAGE_WRITE); return false; }
    s.sha.update(s.sha.ctx, data + off, c);
    if (s.received < 8) { for (size_t i = 0; i < c && s.received + i < 8; i++) s.head[s.received + i] = data[off + i]; }
    s.received += (uint32_t)c; off += c;
  }
  return true;
}
/** Fin de la réponse : taille exacte puis SHA-256 complet comparé à celui du manifeste signé. Différent -> staging SUPPRIMÉ. */
static inline bool finish(Session& s) {
  if (s.st != S_DOWNLOADING) { fail(s, E_STATE); return false; }
  if (s.received != s.m.size) { fail(s, E_SHORT); return false; }
  uint8_t h[32]; s.sha.end(s.sha.ctx, h);
  if (memcmp(h, s.m.sha, 32) != 0) { fail(s, E_HASH); return false; }
  s.st = S_STAGED_UNTRUSTED; return true;
}
/** Relecture complète du staging depuis le module, 2e SHA-256 (sur les octets RELUS, pas sur ceux reçus), taille et vecteurs ; le ticket n'est émis qu'ici. */
static inline bool readback(Session& s) {
  if (s.st != S_STAGED_UNTRUSTED) { fail(s, E_STATE); return false; }
  uint8_t buf[BLOCK]; uint8_t first[8]; uint32_t off = 0;
  s.sha.begin(s.sha.ctx);
  while (off < s.m.size) {
    uint32_t c = s.m.size - off > BLOCK ? BLOCK : s.m.size - off;
    if (!s.stage.read(s.stage.ctx, off, buf, c)) { fail(s, E_STAGE_READ); return false; }
    if (off < 8) { for (uint32_t i = 0; i < c && off + i < 8; i++) first[off + i] = buf[i]; }
    s.sha.update(s.sha.ctx, buf, c); off += c;
  }
  uint8_t h[32]; s.sha.end(s.sha.ctx, h);
  if (off != s.m.size) { fail(s, E_READBACK_SIZE); return false; }
  if (memcmp(h, s.m.sha, 32) != 0) { fail(s, E_READBACK_HASH); return false; }
  if (!vectorsOk(first, s.m.size)) { fail(s, E_VECTOR); return false; }
  s.ticket = true; s.st = S_READY; return true;
}
/** Consomme le ticket AVANT tout appel de programmation : un seul passage, aucun retry. */
static inline bool consume(Session& s) {
  if (s.st != S_READY || !s.ticket) return false;
  s.ticket = false; s.st = S_CONSUMED; return true;
}
/** SEUL point d'entrée vers la programmation : `program` n'est appelée que si un ticket valide a été consommé. */
static inline bool programWithTicket(Session& s, bool (*program)(void*), void* ctx) {
  if (!consume(s)) return false;
  return program(ctx);
}

// ── séquence anti-rejeu en data flash : deux blocs distincts (2 et 3), jamais le bloc 0 ─────────────────────
static const uint8_t SEQ_BLOCK_A = 2, SEQ_BLOCK_B = 3; static const uint32_t FLASH_BLOCK = 1024u;
struct Flash { bool (*readBlock)(void*, uint8_t blk, uint8_t* out1024); bool (*writeBlock)(void*, uint8_t blk, const uint8_t* in1024); void* ctx; };
struct SeqState { bool ok; uint32_t seq; uint32_t gen; int8_t newest; };   // ok=false : OTA REFUSÉE (deux blocs non vierges et invalides)

static inline uint32_t crc32(const uint8_t* p, size_t n) {
  uint32_t c = 0xFFFFFFFFu; for (size_t i = 0; i < n; i++) { c ^= p[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u))); } return ~c;
}
static inline void putLe32(uint8_t* p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24); }
static inline void makeRecord(uint8_t* b, uint32_t seq, uint32_t gen) {
  memset(b, 0xFF, FLASH_BLOCK); memcpy(b, "OTS1", 4); b[4] = 1; b[5] = 0xA5; b[6] = 0; b[7] = 0; putLe32(b + 8, seq); putLe32(b + 12, gen); putLe32(b + 16, crc32(b, 16));
}
enum RecKind : uint8_t { R_VIRGIN, R_VALID, R_INVALID };
static inline RecKind classify(const uint8_t* b, uint32_t& seq, uint32_t& gen) {
  bool virgin = true; for (int i = 0; i < 20; i++) if (b[i] != 0xFF) { virgin = false; break; }
  if (virgin) return R_VIRGIN;
  if (memcmp(b, "OTS1", 4) != 0 || b[4] != 1 || b[5] != 0xA5 || b[6] != 0 || b[7] != 0) return R_INVALID;
  if (le32(b + 16) != crc32(b, 16)) return R_INVALID;
  seq = le32(b + 8); gen = le32(b + 12);
  if (seq < 1 || seq > MAX_SEQ) return R_INVALID;
  return R_VALID;
}
/** buf1024 : tampon de l'appelant (1 Ko : tas ou pile dédiée, jamais la pile principale). Séquence effective = max(séquence compilée, enregistrements valides). */
static inline SeqState seqLoad(const Flash& f, uint32_t compiledSeq, uint8_t* buf1024) {
  SeqState r; r.ok = true; r.seq = compiledSeq; r.gen = 0; r.newest = -1;
  RecKind k[2]; uint32_t sq[2] = {0, 0}, gn[2] = {0, 0};
  for (int i = 0; i < 2; i++) { uint8_t blk = i == 0 ? SEQ_BLOCK_A : SEQ_BLOCK_B; k[i] = f.readBlock(f.ctx, blk, buf1024) ? classify(buf1024, sq[i], gn[i]) : R_INVALID; }
  if (k[0] == R_INVALID && k[1] == R_INVALID) { r.ok = false; return r; }
  for (int i = 0; i < 2; i++) if (k[i] == R_VALID) { if (sq[i] > r.seq) r.seq = sq[i]; if (r.newest < 0 || gn[i] > r.gen) { r.gen = gn[i]; r.newest = (int8_t)i; } }
  return r;
}
/** Consomme une séquence : strictement supérieure à l'effective ; écrit dans le bloc de la génération la plus ancienne ; relit ; la séquence n'est consommée que si la relecture est valide. */
static inline bool seqCommit(const Flash& f, uint32_t compiledSeq, uint32_t newSeq, uint8_t* buf1024) {
  SeqState s = seqLoad(f, compiledSeq, buf1024);
  if (!s.ok || newSeq <= s.seq || newSeq > MAX_SEQ) return false;
  uint8_t target = s.newest == 0 ? SEQ_BLOCK_B : SEQ_BLOCK_A;          // l'AUTRE bloc que le plus récent valide (aucun valide : A)
  makeRecord(buf1024, newSeq, s.gen + 1);
  if (!f.writeBlock(f.ctx, target, buf1024)) return false;
  uint32_t q, g; memset(buf1024, 0, FLASH_BLOCK);
  if (!f.readBlock(f.ctx, target, buf1024) || classify(buf1024, q, g) != R_VALID || q != newSeq || g != s.gen + 1) return false;
  return true;
}

}  // namespace podotar4
