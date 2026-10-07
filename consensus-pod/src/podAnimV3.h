// podAnimV3.h — « pod-anim-v3 » : validation CALCULÉE d'une animation (clip PBC1), EN FLUX, portable (ESP8266, UNO R4, ESP32, PC/Raspberry Pi). Lot 6B-1 — BROUILLON INTERNE, NON PUBLIÉ.
//
// Ce que c'est : l'automate qui lit les octets d'un clip PBC1 (lib/bench/clip.ts) UN MORCEAU À LA FOIS, sans jamais garder le clip entier, et en tire exactement ce que la référence
// TypeScript (lib/animV3.ts, docs/SPEC_PODANIM_V3.md) calcule : SHA-256 du clip, pour chaque image (SHA-256 des 1 024 octets, métriques entières pod-metrics-2 sur la grille 128×64,
// feuille de Merkle), framesRoot, animRoot, agrégats E/T/R/S et règles A1 (format → [hash, décidé par l'appelant] → static → noise → ok).
// MÉMOIRE : l'objet PodAnimStream contient UNE image (1 024 o) + l'accumulateur de métriques (une ligne de 240 o) + ≤ 7 hachages de Merkle (224 o) + un contexte SHA-256 pour le clip.
// Le noyau n'alloue rien : c'est l'APPELANT qui possède l'objet (pile, `static` ou tas alloué APRÈS la fermeture du TLS — règle 8 de CLAUDE.md). Pas de String, pas de STL, pas d'E/S.
// Le SHA-256 est fourni par l'appelant (paramètre de modèle, comme consensusPoD.h). ⚠ AUCUN firmware du dépôt n'utilise ce fichier : « compilé », jamais « testé sur carte ».
#pragma once
#include "consensusPoD.h"

#define POD_ANIM_RULES_VERSION   2
#define POD_ANIM_MIN_FRAMES      2
#define POD_ANIM_MAX_FRAMES      64
#define POD_ANIM_MAX_CLIP        9216
#define POD_ANIM_FRAME_BYTES     1024
#define POD_ANIM_W               128
#define POD_ANIM_H               64
#define POD_ANIM_MAX_PLAY_UNITS  12000      // 120 s en unités de 10 ms (un tour, loops = 0)
#define POD_ANIM_MERKLE_DEPTH    7          // ≥ log2(64) + 1 entrées en attente

// ─── Règles A1 (jeu rulesVersion 2) ───────────────────────────────────────────────────────────────────────────────────────────────────────
enum PodAnimRule { POD_ANIM_OK = 0, POD_ANIM_FORMAT, POD_ANIM_HASH, POD_ANIM_STATIC, POD_ANIM_NOISE, POD_ANIM_RULES };

static inline const char* pod_anim_rule_name(PodAnimRule r) {
  switch (r) {
    case POD_ANIM_OK: return "ok";         case POD_ANIM_FORMAT: return "format"; case POD_ANIM_HASH: return "hash";
    case POD_ANIM_STATIC: return "static"; case POD_ANIM_NOISE: return "noise";   default: return "rules";
  }
}

/** Ordre figé : format → hash → static → noise → ok. Identique à evaluateAnimRules() de lib/animV3.ts. PAS de règle « uniform » pour une animation. */
static inline PodAnimRule pod_anim_evaluate_rules(bool formatOk, bool hashOk, bool allIdentical, uint32_t E, uint32_t T) {
  if (!formatOk) return POD_ANIM_FORMAT;
  if (!hashOk) return POD_ANIM_HASH;
  if (allIdentical) return POD_ANIM_STATIC;
  if (E > POD_NOISE_E && T > POD_NOISE_T) return POD_ANIM_NOISE;
  return POD_ANIM_OK;
}

// ─── Engagements ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** feuille d'image = SHA-256( 0x02 ‖ empreinte (32 o) ‖ u32 e ‖ u32 t ‖ u32 r ‖ u8 délai ) — 46 octets. */
template <class Sha> static inline void pod_anim_leaf(const uint8_t frameHash[32], uint32_t e, uint32_t t, uint32_t r, uint8_t delayUnits, uint8_t out[32]) {
  uint8_t b[46]; b[0] = 0x02; memcpy(b + 1, frameHash, 32);
  const uint32_t v[3] = { e, t, r };
  for (int i = 0; i < 3; i++) { b[33 + 4 * i] = (uint8_t)(v[i] >> 24); b[34 + 4 * i] = (uint8_t)(v[i] >> 16); b[35 + 4 * i] = (uint8_t)(v[i] >> 8); b[36 + 4 * i] = (uint8_t)v[i]; }
  b[45] = delayUnits;
  Sha s; s.begin(); s.update(b, sizeof(b)); s.finish(out);
}

/**
 * Racine de Merkle des images EN FLUX (≤ 7 hachages en attente) : mêmes nœuds que pod_merkle_root (SHA-256(0x01 ‖ gauche ‖ droite), nœud impair PROMU, jamais dupliqué) ; les feuilles sont
 * utilisées TELLES QUELLES. Fusion immédiate de deux entrées de même niveau, puis combinaison de droite à gauche en fin de flux : même arbre que la référence pour TOUT N (vecteurs 2..64).
 */
template <class Sha> struct PodMerkleStack {
  uint8_t h[POD_ANIM_MERKLE_DEPTH][32]; uint8_t lv[POD_ANIM_MERKLE_DEPTH]; uint8_t n; uint32_t count;
  void begin() { n = 0; count = 0; }
  static void node(const uint8_t* l, const uint8_t* r, uint8_t out[32]) { Sha s; s.begin(); const uint8_t one = 1; s.update(&one, 1); s.update(l, 32); s.update(r, 32); s.finish(out); }
  bool push(const uint8_t leaf[32]) {
    if (count >= POD_ANIM_MAX_FRAMES || n >= POD_ANIM_MERKLE_DEPTH) return false;
    memcpy(h[n], leaf, 32); lv[n] = 0; n++; count++;
    while (n >= 2 && lv[n - 1] == lv[n - 2]) { uint8_t t[32]; node(h[n - 2], h[n - 1], t); memcpy(h[n - 2], t, 32); lv[n - 2]++; n--; }
    return true;
  }
  /** vide : SHA-256("pod-merkle-v3-empty") ; sinon racine. Ne modifie pas la pile. */
  void root(uint8_t out[32]) const {
    if (n == 0) { Sha s; s.begin(); s.update("pod-merkle-v3-empty", 19); s.finish(out); return; }
    uint8_t cur[32]; memcpy(cur, h[n - 1], 32);
    for (int i = (int)n - 2; i >= 0; i--) { uint8_t t[32]; node(h[i], cur, t); memcpy(cur, t, 32); }
    memcpy(out, cur, 32);
  }
};

/** animRoot = SHA-256( "pod-anim-v3|pbc1|" clipHash "|" framesRoot "|" N "|" loops "|" fg "|" bg ) — hex minuscule (65 octets). */
template <class Sha> static inline void pod_anim_root(const char* clipHashHex, const char* framesRootHex, uint32_t frames, uint32_t loops, uint32_t fg, uint32_t bg, char out[65]) {
  Sha s; s.begin(); uint8_t o[32]; char num[24];
  const char* pre = "pod-anim-v3|pbc1|"; s.update(pre, strlen(pre));
  s.update(clipHashHex, strlen(clipHashHex)); s.update("|", 1); s.update(framesRootHex, strlen(framesRootHex)); s.update("|", 1);
  s.update(num, (size_t)pod_utoa(frames, num)); s.update("|", 1); s.update(num, (size_t)pod_utoa(loops, num)); s.update("|", 1);
  s.update(num, (size_t)pod_utoa(fg, num)); s.update("|", 1); s.update(num, (size_t)pod_utoa(bg, num));
  s.finish(o); pod_hex(o, 32, out);
}

// ─── Automate de lecture du clip PBC1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
struct PodAnimResult {
  PodAnimRule rule;            // POD_ANIM_FORMAT | POD_ANIM_STATIC | POD_ANIM_NOISE | POD_ANIM_OK (POD_ANIM_HASH est décidé par l'appelant : annonce du serveur ≠ valeurs calculées)
  bool formatOk;
  bool allIdentical;
  uint32_t bytes;              // octets effectivement lus
  uint32_t frames, loops, fg, bg;
  uint32_t E, T, R, S;         // agrégats entiers (moyennes arrondies à l'inférieur)
  uint32_t posterIndex;        // premier indice maximisant s_i
  char clipHash[65];           // SHA-256 des octets LUS (même si le format est refusé : un rejet `format` signe le hash de ce qui a été lu)
  char framesRoot[65];         // vides si le format est refusé
  char animRoot[65];
};

template <class Sha> class PodAnimStream {
 public:
  void begin() {
    clip_.begin(); st_ = S_HEADER; pos_ = 0; hp_ = 0; crc_ = 0xFFFFFFFFUL; failed_ = false; frames_ = 0; sumE_ = sumT_ = sumR_ = sumS_ = 0; sumUnits_ = 0; bestS_ = 0; poster_ = 0; same_ = true;
    merkle_.begin(); n_ = 0; bodyBytes_ = 0; bodyPos_ = 0; transIdx_ = 0; loops_ = fg_ = bg_ = 0; crcPos_ = 0; finished_ = false;
  }

  /** Alimente le flux (morceaux de taille quelconque). Le hash du clip couvre TOUS les octets, même après un échec de format. */
  void update(const uint8_t* d, size_t len) {
    clip_.update(d, len);
    for (size_t i = 0; i < len; i++) step(d[i]);
  }

  /** À appeler une seule fois, à la fin du flux. Remplit `out` dans tous les cas ; retourne out->formatOk. */
  bool finish(PodAnimResult* out) {
    memset(out, 0, sizeof(*out));
    uint8_t ch[32]; clip_.finish(ch); pod_hex(ch, 32, out->clipHash);
    out->bytes = pos_; out->rule = POD_ANIM_FORMAT; out->formatOk = false;
    if (finished_ || failed_ || st_ != S_DONE || frames_ != n_ || sumUnits_ > POD_ANIM_MAX_PLAY_UNITS) return false;
    finished_ = true;
    uint8_t fr[32]; merkle_.root(fr); pod_hex(fr, 32, out->framesRoot);
    out->formatOk = true; out->frames = n_; out->loops = loops_; out->fg = fg_; out->bg = bg_;
    out->E = sumE_ / n_; out->T = sumT_ / n_; out->R = sumR_ / n_; out->S = sumS_ / n_; out->posterIndex = poster_; out->allIdentical = same_;
    pod_anim_root<Sha>(out->clipHash, out->framesRoot, n_, loops_, fg_, bg_, out->animRoot);
    out->rule = pod_anim_evaluate_rules(true, true, same_, out->E, out->T);
    return true;
  }

 private:
  enum St { S_HEADER, S_DELAY0, S_FRAME0, S_TDELAY, S_NRUNS0, S_NRUNS1, S_ROFF0, S_ROFF1, S_RLEN, S_RDATA, S_CRC, S_DONE, S_FAIL };

  Sha clip_;
  PodMerkleStack<Sha> merkle_;
  PodMetrics metrics_;
  uint8_t frame_[POD_ANIM_FRAME_BYTES];
  uint8_t fh0_[32];
  uint8_t hdr_[20];
  uint8_t crcBytes_[4];
  St st_ = S_HEADER;
  bool failed_ = false, same_ = true, finished_ = false;
  uint32_t pos_ = 0, crc_ = 0xFFFFFFFFUL;
  uint32_t n_ = 0, bodyBytes_ = 0, bodyPos_ = 0, transIdx_ = 0, loops_ = 0, fg_ = 0, bg_ = 0;
  uint32_t frames_ = 0, sumE_ = 0, sumT_ = 0, sumR_ = 0, sumS_ = 0, sumUnits_ = 0, bestS_ = 0, poster_ = 0;
  uint16_t hp_ = 0, framePos_ = 0, nruns_ = 0, runsLeft_ = 0, runOff_ = 0, runLen_ = 0, runPos_ = 0, crcPos_ = 0;
  uint8_t delay0_ = 0, delay_ = 0;

  void fail() { failed_ = true; st_ = S_FAIL; }
  void crcStep(uint8_t b) { crc_ ^= b; for (int k = 0; k < 8; k++) crc_ = (crc_ & 1) ? (0xEDB88320UL ^ (crc_ >> 1)) : (crc_ >> 1); }

  /** Fin d'une image : empreinte, métriques, feuille, agrégats. */
  void frameDone(uint32_t idx, uint8_t delayUnits) {
    uint8_t fh[32]; { Sha s; s.begin(); s.update(frame_, POD_ANIM_FRAME_BYTES); s.finish(fh); }
    metrics_.begin(POD_ANIM_W, POD_ANIM_H);
    for (uint16_t y = 0; y < POD_ANIM_H; y++) for (uint16_t x = 0; x < POD_ANIM_W; x++) metrics_.push((uint8_t)((frame_[y * 16 + (x >> 3)] >> (7 - (x & 7))) & 1));
    PodMetricsOut m; if (!metrics_.finish(&m)) { fail(); return; }
    uint8_t leaf[32]; pod_anim_leaf<Sha>(fh, m.e, m.t, m.r, delayUnits, leaf);
    if (!merkle_.push(leaf)) { fail(); return; }
    sumE_ += m.e; sumT_ += m.t; sumR_ += m.r; sumS_ += m.s;
    if (idx == 0) { memcpy(fh0_, fh, 32); bestS_ = m.s; poster_ = 0; } else { if (memcmp(fh, fh0_, 32) != 0) same_ = false; if (m.s > bestS_) { bestS_ = m.s; poster_ = idx; } }
    frames_++;
  }

  void transitionDone() {
    if (transIdx_ < n_) {
      frameDone(transIdx_, delay_); if (failed_) return;
      sumUnits_ += delay_;
    } else {   // retour à l'image 0 : même image, même délai
      uint8_t fh[32]; { Sha s; s.begin(); s.update(frame_, POD_ANIM_FRAME_BYTES); s.finish(fh); }
      if (memcmp(fh, fh0_, 32) != 0 || delay_ != delay0_) { fail(); return; }
    }
    transIdx_++;
    if (transIdx_ > n_) { if (bodyPos_ != bodyBytes_) { fail(); return; } crcPos_ = 0; st_ = S_CRC; }
    else st_ = S_TDELAY;
  }

  void step(uint8_t b) {
    pos_++;
    if (st_ == S_FAIL) return;
    if (pos_ > POD_ANIM_MAX_CLIP) { fail(); return; }
    if (st_ == S_DONE) { fail(); return; }   // octets après la CRC
    if (st_ == S_HEADER) {
      hdr_[hp_++] = b; crcStep(b);
      if (hp_ == 20) {
        const bool magic = hdr_[0] == 'P' && hdr_[1] == 'B' && hdr_[2] == 'C' && hdr_[3] == '1';
        n_ = (uint32_t)hdr_[8] | ((uint32_t)hdr_[9] << 8); loops_ = hdr_[10];
        fg_ = (uint32_t)hdr_[12] | ((uint32_t)hdr_[13] << 8); bg_ = (uint32_t)hdr_[14] | ((uint32_t)hdr_[15] << 8);
        const uint32_t trans = (uint32_t)hdr_[16] | ((uint32_t)hdr_[17] << 8); bodyBytes_ = (uint32_t)hdr_[18] | ((uint32_t)hdr_[19] << 8);
        if (!magic || hdr_[4] != 1 || hdr_[5] != POD_ANIM_W || hdr_[6] != POD_ANIM_H || hdr_[7] != 0 || hdr_[11] != 0) { fail(); return; }
        if (n_ < POD_ANIM_MIN_FRAMES || n_ > POD_ANIM_MAX_FRAMES || loops_ != 0 || fg_ == bg_ || trans != n_) { fail(); return; }
        if (20UL + bodyBytes_ + 4UL > POD_ANIM_MAX_CLIP) { fail(); return; }
        st_ = S_DELAY0;
      }
      return;
    }
    if (st_ == S_CRC) {
      crcBytes_[crcPos_++] = b;
      if (crcPos_ == 4) {
        const uint32_t want = (uint32_t)crcBytes_[0] | ((uint32_t)crcBytes_[1] << 8) | ((uint32_t)crcBytes_[2] << 16) | ((uint32_t)crcBytes_[3] << 24);
        if (want != (crc_ ^ 0xFFFFFFFFUL)) { fail(); return; }
        st_ = S_DONE;
      }
      return;
    }
    // octets du corps : jamais au-delà de la taille annoncée
    if (bodyPos_ >= bodyBytes_) { fail(); return; }
    bodyPos_++; crcStep(b);
    switch (st_) {
      case S_DELAY0: delay0_ = b; if (b < 2) { fail(); return; } sumUnits_ += b; framePos_ = 0; st_ = S_FRAME0; break;
      case S_FRAME0:
        frame_[framePos_++] = b;
        if (framePos_ == POD_ANIM_FRAME_BYTES) { frameDone(0, delay0_); if (failed_) return; transIdx_ = 1; st_ = S_TDELAY; }
        break;
      case S_TDELAY: delay_ = b; if (b < 2) { fail(); return; } st_ = S_NRUNS0; break;
      case S_NRUNS0: nruns_ = b; st_ = S_NRUNS1; break;
      case S_NRUNS1: nruns_ = (uint16_t)(nruns_ | ((uint16_t)b << 8)); runsLeft_ = nruns_; if (runsLeft_ == 0) transitionDone(); else st_ = S_ROFF0; break;
      case S_ROFF0: runOff_ = b; st_ = S_ROFF1; break;
      case S_ROFF1: runOff_ = (uint16_t)(runOff_ | ((uint16_t)b << 8)); st_ = S_RLEN; break;
      case S_RLEN: runLen_ = b; if (runLen_ < 1 || (uint32_t)runOff_ + runLen_ > POD_ANIM_FRAME_BYTES) { fail(); return; } runPos_ = 0; st_ = S_RDATA; break;
      case S_RDATA:
        frame_[runOff_ + runPos_] = b; runPos_++;
        if (runPos_ == runLen_) { runsLeft_--; if (runsLeft_ == 0) transitionDone(); else st_ = S_ROFF0; }
        break;
      default: fail(); break;
    }
  }
};

// ─── Message de vote d'animation (domaine propre « pod-vote-v3-anim ») ────────────────────────────────────────────────────────────────────────
struct PodAnimVote {
  const char *deviceId, *candidateId, *parentHash;
  uint32_t metricsVersion, rulesVersion;
  const char *clipHash, *animRoot, *saltedHash;
  uint32_t frames;               // 2..64 ; 0 SEULEMENT pour un rejet `format` dont N est inconnu
  uint32_t E, T, R, S;
  PodAnimRule rule;              // POD_ANIM_OK ⇔ accept
  const char* vclass;            // "C0" | "C1" | "C2"
};

/** pod-vote-v3-anim|deviceId|candidateId|parentHash|mv|rv|clipHash|animRoot|saltedHash|frames|E|T|R|S|verdict|ruleCode|vclass — longueur, ou −1 (tampon ≥ 512 octets conseillé). */
static inline int pod_anim_vote_message(char* out, size_t cap, const PodAnimVote& v) {
  PodOut o(out, cap);
  o.str("pod-vote-v3-anim|"); o.str(v.deviceId); o.ch('|'); o.str(v.candidateId); o.ch('|'); o.str(v.parentHash); o.ch('|');
  o.u64(v.metricsVersion); o.ch('|'); o.u64(v.rulesVersion); o.ch('|'); o.str(v.clipHash); o.ch('|'); o.str(v.animRoot); o.ch('|'); o.str(v.saltedHash); o.ch('|');
  o.u64(v.frames); o.ch('|'); o.u64(v.E); o.ch('|'); o.u64(v.T); o.ch('|'); o.u64(v.R); o.ch('|'); o.u64(v.S); o.ch('|');
  o.str(v.rule == POD_ANIM_OK ? "accept" : "reject"); o.ch('|'); o.str(pod_anim_rule_name(v.rule)); o.ch('|'); o.str(v.vclass);
  return o.ok ? (int)o.pos : -1;
}
