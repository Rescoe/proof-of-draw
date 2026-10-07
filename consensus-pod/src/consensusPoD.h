// consensusPoD.h — NOYAU DE CONSENSUS Proof-of-Draw, portable (ESP8266, UNO R4, ESP32, PC/Raspberry Pi). BROUILLON INTERNE « 0.0.x » — NON PUBLIÉ.
//
// Ce que c'est : les calculs du protocole PoD v3 (docs/SPEC_PROTOCOLE_V3.md) SANS écran, SANS Wi-Fi, SANS Redis, SANS `String`, SANS allocation dynamique, SANS E/S :
//   • métriques entières « pod-metrics-2 » en flux (pod_metrics.h : copie byte-identique de esp8266/_shared/pod_metrics.h, déjà validée sur matériel) ;
//   • règles objectives N2 (rulesVersion 1) ;
//   • hash salé par appareil, message de vote v3 ;
//   • reçus : feuille et racine de Merkle ;
//   • comité : graine, rang, seuil, règle des sièges ; mineur déterministe ;
//   • hachage canonique du bloc v2.
// Le SHA-256 est FOURNI par l'appelant (paramètre de modèle `Sha`, 3 méthodes : begin() / update(const void*, size_t) / finish(uint8_t out[32])) : adaptateurs dans adapters/
// (BearSSL pour ESP8266, bibliothèque Crypto pour UNO R4, implémentation portable pour le PC). La signature Ed25519 reste dans le sketch (bibliothèque Crypto), ce noyau ne signe rien.
// Le TypeScript (lib/podProtocolV3.ts) est la RÉFÉRENCE ; test/vectors générés par scripts/gen-consensus-pod-vectors.ts, vérifiés bit à bit par host/core_harness.cpp (tests/consensusPodCore.test.ts).
// ⚠ AUCUN firmware du dépôt n'utilise encore ce fichier (le firmware v3 arrive avec le grand reflash) : « compilé », jamais « testé sur carte ».
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "pod_metrics.h"

#define POD_CORE_VERSION     "0.0.1"
#define POD_VOTE_VERSION     3
#define POD_RULES_VERSION    1
#define POD_BLOCK_VERSION    2
#define POD_NOISE_E          980000UL
#define POD_NOISE_T          900000UL
#define POD_COMMITTEE_MAX    7
#define POD_MAX_SET          16     // taille maximale des listes triées (2K = 14 au plus)

// ─── Règles N2 (rulesVersion 1) ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
enum PodRule { POD_RULE_OK = 0, POD_RULE_HASH, POD_RULE_METRICS, POD_RULE_UNIFORM, POD_RULE_NOISE, POD_RULE_FORMAT, POD_RULE_RULES };

static inline const char* pod_rule_name(PodRule r) {
  switch (r) {
    case POD_RULE_OK: return "ok";           case POD_RULE_HASH: return "hash";     case POD_RULE_METRICS: return "metrics";
    case POD_RULE_UNIFORM: return "uniform"; case POD_RULE_NOISE: return "noise";   case POD_RULE_FORMAT: return "format";
    default: return "rules";
  }
}

/** Ordre figé : format → hash → uniform → noise → ok. Identique à evaluateRules() de lib/podProtocolV3.ts. */
static inline PodRule pod_evaluate_rules(bool formatOk, bool hashOk, uint32_t e, uint32_t t) {
  if (!formatOk) return POD_RULE_FORMAT;
  if (!hashOk) return POD_RULE_HASH;
  if (e == 0 && t == 0) return POD_RULE_UNIFORM;
  if (e > POD_NOISE_E && t > POD_NOISE_T) return POD_RULE_NOISE;
  return POD_RULE_OK;
}

// ─── Petits utilitaires (pas de snprintf : newlib-nano ne gère pas %llu) ──────────────────────────────────────────────────────────────────────
/** Écrit 2n caractères hexadécimaux MINUSCULES + NUL (out : 2n+1 octets). */
static inline void pod_hex(const uint8_t* in, size_t n, char* out) {
  static const char H[] = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) { out[2 * i] = H[in[i] >> 4]; out[2 * i + 1] = H[in[i] & 15]; }
  out[2 * n] = 0;
}

/** Écrit un buffer par morceaux : `pos` avance, `ok` passe à false au premier dépassement (le résultat est alors inutilisable). */
struct PodOut {
  char* buf; size_t cap; size_t pos; bool ok;
  PodOut(char* b, size_t c) : buf(b), cap(c), pos(0), ok(c > 0) { if (c) b[0] = 0; }
  void str(const char* s) { size_t n = strlen(s); if (!ok || pos + n + 1 > cap) { ok = false; return; } memcpy(buf + pos, s, n); pos += n; buf[pos] = 0; }
  void ch(char c) { char t[2] = { c, 0 }; str(t); }
  void u64(uint64_t v) { char t[24]; int i = 23; t[i] = 0; if (v == 0) t[--i] = '0'; while (v) { t[--i] = (char)('0' + (v % 10)); v /= 10; } str(t + i); }
};

// ─── Hash salé par appareil (preuve de lecture) ──────────────────────────────────────────────────────────────────────────────────────────────
/** nonce = SHA-256("pod-nonce-v3|" candidateId "|" parentHash "|" deviceId) — 32 octets. */
template <class Sha> static inline void pod_salt_nonce(const char* candidateId, const char* parentHash, const char* deviceId, uint8_t out[32]) {
  Sha s; s.begin();
  s.update("pod-nonce-v3|", 13); s.update(candidateId, strlen(candidateId)); s.update("|", 1); s.update(parentHash, strlen(parentHash)); s.update("|", 1); s.update(deviceId, strlen(deviceId));
  s.finish(out);
}

/** saltedHash = SHA-256(nonce ‖ contenu) calculé EN FLUX, dans la même lecture que les métriques et le SHA-256 du contenu. */
template <class Sha> struct PodSalted {
  Sha sha;
  void begin(const uint8_t nonce[32]) { sha.begin(); sha.update(nonce, 32); }
  void update(const uint8_t* d, size_t n) { sha.update(d, n); }
  void finish(char hex[65]) { uint8_t o[32]; sha.finish(o); pod_hex(o, 32, hex); }
};

// ─── Message de vote v3 (signé en Ed25519 par le sketch) ──────────────────────────────────────────────────────────────────────────────────────
struct PodVoteV3 {
  const char *deviceId, *candidateId, *parentHash;
  uint32_t metricsVersion, rulesVersion;
  const char *rawHash, *saltedHash;
  uint32_t e, t, r;
  PodRule rule;            // POD_RULE_OK ⇔ accept
  const char* vclass;      // "C0" | "C1" | "C2"
};

/** pod-vote-v3|deviceId|candidateId|parentHash|mv|rv|rawHash|saltedHash|e|t|r|verdict|ruleCode|vclass — retourne la longueur, ou −1 si le tampon est trop petit (≥ 400 octets conseillés). */
static inline int pod_vote_message_v3(char* out, size_t cap, const PodVoteV3& v) {
  PodOut o(out, cap);
  o.str("pod-vote-v3|"); o.str(v.deviceId); o.ch('|'); o.str(v.candidateId); o.ch('|'); o.str(v.parentHash); o.ch('|');
  o.u64(v.metricsVersion); o.ch('|'); o.u64(v.rulesVersion); o.ch('|'); o.str(v.rawHash); o.ch('|'); o.str(v.saltedHash); o.ch('|');
  o.u64(v.e); o.ch('|'); o.u64(v.t); o.ch('|'); o.u64(v.r); o.ch('|');
  o.str(v.rule == POD_RULE_OK ? "accept" : "reject"); o.ch('|'); o.str(pod_rule_name(v.rule)); o.ch('|'); o.str(v.vclass);
  return o.ok ? (int)o.pos : -1;
}

// ─── Reçus : feuille et racine de Merkle ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** feuille = SHA-256( 0x00 ‖ message "|" signatureHex "|" clePubliqueHex ). */
template <class Sha> static inline void pod_vote_leaf(const char* message, const char* sigHex, const char* pubHex, uint8_t out[32]) {
  Sha s; s.begin(); const uint8_t z = 0; s.update(&z, 1);
  s.update(message, strlen(message)); s.update("|", 1); s.update(sigHex, strlen(sigHex)); s.update("|", 1); s.update(pubHex, strlen(pubHex));
  s.finish(out);
}

/** Racine de Merkle (nœud = SHA-256(0x01 ‖ gauche ‖ droite) ; nœud impair PROMU, jamais dupliqué ; vide = SHA-256("pod-merkle-v3-empty")). DÉTRUIT `nodes` (n ≤ POD_MAX_SET). */
template <class Sha> static inline bool pod_merkle_root(uint8_t (*nodes)[32], int n, uint8_t out[32]) {
  if (n < 0 || n > POD_MAX_SET) return false;
  if (n == 0) { Sha s; s.begin(); s.update("pod-merkle-v3-empty", 19); s.finish(out); return true; }
  while (n > 1) {
    int m = 0;
    for (int i = 0; i < n; i += 2) {
      if (i + 1 < n) {
        uint8_t tmp[32]; Sha s; s.begin(); const uint8_t one = 1; s.update(&one, 1); s.update(nodes[i], 32); s.update(nodes[i + 1], 32); s.finish(tmp);
        memcpy(nodes[m++], tmp, 32);
      } else { if (m != i) memcpy(nodes[m], nodes[i], 32); m++; }
    }
    n = m;
  }
  memcpy(out, nodes[0], 32);
  return true;
}

// ─── Comité : graine, rang, seuil, règle des sièges ──────────────────────────────────────────────────────────────────────────────────────────
/** graine = SHA-256("pod-committee-seed-v3|" parentHash "|" contentHash) — hex minuscule (65 octets). Ne dépend NI du candidatId NI d'un horodatage. */
template <class Sha> static inline void pod_committee_seed(const char* parentHash, const char* contentHash, char seedHex[65]) {
  Sha s; s.begin(); uint8_t o[32];
  s.update("pod-committee-seed-v3|", 22); s.update(parentHash, strlen(parentHash)); s.update("|", 1); s.update(contentHash, strlen(contentHash));
  s.finish(o); pod_hex(o, 32, seedHex);
}
/** rang = SHA-256("pod-committee-v3|" graine "|" profileId) — le tri croissant des rangs (puis profileId) donne l'ordre du comité. */
template <class Sha> static inline void pod_committee_rank(const char* seedHex, const char* profileId, char rankHex[65]) {
  Sha s; s.begin(); uint8_t o[32];
  s.update("pod-committee-v3|", 17); s.update(seedHex, strlen(seedHex)); s.update("|", 1); s.update(profileId, strlen(profileId));
  s.finish(o); pod_hex(o, 32, rankHex);
}

static inline int pod_threshold(int K) { return (2 * K + 2) / 3; }   // ⌈2K/3⌉

struct PodDecision { int state; int accepts; int rejects; int needed; int rejectLimit; };   // state : 0 en attente, 1 accepté, 2 refusé

/**
 * RÈGLE DES SIÈGES : `verdictByRank[r]` ∈ {0 : n'a pas voté, 1 : approuve, 2 : refuse} pour chaque rang de la fenêtre (windowN = K en vague 1, min(2K, n) en vague 2) ; seuls les K PREMIERS
 * RANGS qui ont voté comptent. accepter ⇔ approbations ≥ seuil ET refus ≤ K−seuil ; refuser ⇔ refus ≥ K−seuil+1.
 */
static inline PodDecision pod_decide_seats(int K, int thresholdN, const uint8_t* verdictByRank, int windowN) {
  PodDecision d = { 0, 0, 0, thresholdN, K - thresholdN };
  int voters = 0;
  for (int r = 0; r < windowN && voters < K; r++) {
    if (verdictByRank[r] == 1) { d.accepts++; voters++; } else if (verdictByRank[r] == 2) { d.rejects++; voters++; }
  }
  if (d.accepts >= d.needed && d.rejects <= d.rejectLimit) d.state = 1;
  else if (d.rejects >= d.rejectLimit + 1) d.state = 2;
  return d;
}

// ─── Mineur déterministe ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
struct PodMinerCand { const char* profileId; uint32_t minedBlocks; };

/** Poids = max(1, ⌊10⁶/(blocsMinés+1)⌋), calculé en 64 bits : à partir de 10⁶ blocs le poids valait 0 (somme nulle ⇒ division par zéro), et blocsMinés+1 débordait sur 32 bits (audit GPT). */
static inline uint64_t pod_miner_weight(uint32_t minedBlocks) {
  uint64_t w = 1000000ULL / ((uint64_t)minedBlocks + 1ULL);
  return w ? w : 1;
}

/** graine du mineur = SHA-256("pod-miner-v3|" graineDuComité "|" votesRoot). */
template <class Sha> static inline void pod_miner_seed(const char* committeeSeedHex, const char* votesRootHex, char out[65]) {
  Sha s; s.begin(); uint8_t o[32];
  s.update("pod-miner-v3|", 13); s.update(committeeSeedHex, strlen(committeeSeedHex)); s.update("|", 1); s.update(votesRootHex, strlen(votesRootHex));
  s.finish(o); pod_hex(o, 32, out);
}

/**
 * Tirage pondéré par ⌊10⁶/(blocsMinés+1)⌋ parmi les approbateurs, triés par profileId : u = (8 premiers octets de la graine, grand-boutiste) mod Σ poids.
 * Retourne l'INDICE (dans `c`) du profil tiré, ou −1 (liste vide ou plus de POD_MAX_SET candidats).
 */
template <class Sha> static inline int pod_miner_draw(const char* parentHash, const char* contentHash, const char* votesRootHex, const PodMinerCand* c, int n) {
  if (n <= 0 || n > POD_MAX_SET) return -1;
  int idx[POD_MAX_SET];
  for (int i = 0; i < n; i++) { int j = i; while (j > 0 && strcmp(c[idx[j - 1]].profileId, c[i].profileId) > 0) { idx[j] = idx[j - 1]; j--; } idx[j] = i; }
  uint64_t total = 0;
  for (int i = 0; i < n; i++) total += pod_miner_weight(c[i].minedBlocks);   // ≥ 1 par candidat : total ≥ 1, jamais de division par zéro
  char cs[65], ms[65]; pod_committee_seed<Sha>(parentHash, contentHash, cs); pod_miner_seed<Sha>(cs, votesRootHex, ms);
  uint64_t u = 0;
  for (int i = 0; i < 16; i++) { char ch = ms[i]; u = (u << 4) | (uint64_t)(ch <= '9' ? ch - '0' : ch - 'a' + 10); }
  u %= total;
  for (int k = 0; k < n; k++) { uint64_t w = pod_miner_weight(c[idx[k]].minedBlocks); if (u < w) return idx[k]; u -= w; }
  return idx[n - 1];
}

// ─── Engagements du comité et du mineur dans le hash du bloc (audit GPT) ──────────────────────────────────────────────────────────────────────
static inline int pod_utoa(uint64_t v, char* out) { char t[24]; int i = 23; t[i] = 0; if (v == 0) t[--i] = '0'; while (v) { t[--i] = (char)('0' + (v % 10)); v /= 10; } int n = 0; while (t[i]) out[n++] = t[i++]; out[n] = 0; return n; }

/** committeeRoot = SHA-256("pod-committee-set-v3|" mode "|" K "|" seuil "|" vague "|" rangs séparés par « , »). Quorum historique : mode "quorum", K = électorat, seuil 0, vague 0, aucun rang. */
template <class Sha> static inline void pod_committee_root(const char* mode, uint32_t K, uint32_t thresholdN, uint32_t wave, const char* const* ranked, int n, char out[65]) {
  Sha s; s.begin(); char num[24]; uint8_t o[32];
  s.update("pod-committee-set-v3|", 21); s.update(mode, strlen(mode)); s.update("|", 1);
  s.update(num, (size_t)pod_utoa(K, num)); s.update("|", 1); s.update(num, (size_t)pod_utoa(thresholdN, num)); s.update("|", 1); s.update(num, (size_t)pod_utoa(wave, num)); s.update("|", 1);
  for (int i = 0; i < n; i++) { if (i) s.update(",", 1); s.update(ranked[i], strlen(ranked[i])); }
  s.finish(o); pod_hex(o, 32, out);
}

/** minerRoot = SHA-256("pod-miner-set-v3|" profil tiré "|" « profil:blocs » triés par profil, séparés par « , »). `winner` nul : SHA-256("pod-miner-set-v3|none"). */
template <class Sha> static inline void pod_miner_root(const char* winner, const PodMinerCand* c, int n, char out[65]) {
  Sha s; s.begin(); uint8_t o[32];
  if (!winner) { s.update("pod-miner-set-v3|none", 21); s.finish(o); pod_hex(o, 32, out); return; }
  int idx[POD_MAX_SET]; if (n < 0) n = 0; if (n > POD_MAX_SET) n = POD_MAX_SET;
  for (int i = 0; i < n; i++) { int j = i; while (j > 0 && strcmp(c[idx[j - 1]].profileId, c[i].profileId) > 0) { idx[j] = idx[j - 1]; j--; } idx[j] = i; }
  s.update("pod-miner-set-v3|", 17); s.update(winner, strlen(winner)); s.update("|", 1);
  char num[24];
  for (int k = 0; k < n; k++) { if (k) s.update(",", 1); s.update(c[idx[k]].profileId, strlen(c[idx[k]].profileId)); s.update(":", 1); s.update(num, (size_t)pod_utoa(c[idx[k]].minedBlocks, num)); }
  s.finish(o); pod_hex(o, 32, out);
}

// ─── Hachage canonique du bloc v2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
struct PodBlockV2 {
  const char *parentHash, *imageHash, *actionsHash, *contentHash, *deviceId, *poolScreen;
  const char* const* validators; int nValidators;   // identifiants de profils (quelconque ordre : triés ici)
  uint32_t scorePpm; uint64_t minedAt;
  const char* animRoot;                              // nullable
  const char *votesRoot, *committeeMode; uint32_t committeeK;
  const char *committeeRoot, *minerRoot;             // engagements (voir pod_committee_root / pod_miner_root)
  uint32_t rulesVersion;                             // jeu de règles du bloc : 1 = image fixe (N2), 2 = animation (A1). Toute autre valeur est REFUSÉE (−1).
};

/** Texte canonique EXACT de blockCanonicalV2() (JSON.stringify, ordre des clés figé, score en ppm entier). Retourne la longueur ou −1 (tampon ≥ 1 024 octets conseillé). */
static inline int pod_block_canonical_v2(char* out, size_t cap, const PodBlockV2& b) {
  if (b.nValidators < 0 || b.nValidators > POD_MAX_SET) return -1;
  if (b.rulesVersion != 1 && b.rulesVersion != 2) return -1;   // aucun jeu de règles inconnu ne peut être engagé dans un hash
  const char* sorted[POD_MAX_SET];
  for (int i = 0; i < b.nValidators; i++) { int j = i; while (j > 0 && strcmp(sorted[j - 1], b.validators[i]) > 0) { sorted[j] = sorted[j - 1]; j--; } sorted[j] = b.validators[i]; }
  PodOut o(out, cap);
  o.str("{\"blockVersion\":"); o.u64(POD_BLOCK_VERSION); o.str(",\"metricsVersion\":"); o.u64(POD_METRICS_VERSION); o.str(",\"rulesVersion\":"); o.u64(b.rulesVersion);
  o.str(",\"parentHash\":\""); o.str(b.parentHash); o.str("\",\"imageHash\":\""); o.str(b.imageHash); o.str("\",\"actionsHash\":\""); o.str(b.actionsHash);
  o.str("\",\"contentHash\":\""); o.str(b.contentHash); o.str("\",\"deviceId\":\""); o.str(b.deviceId); o.str("\",\"poolScreen\":\""); o.str(b.poolScreen);
  o.str("\",\"validatorProfileIds\":[");
  for (int i = 0; i < b.nValidators; i++) { if (i) o.ch(','); o.ch('"'); o.str(sorted[i]); o.ch('"'); }
  o.str("],\"scorePpm\":"); o.u64(b.scorePpm); o.str(",\"minedAt\":"); o.u64(b.minedAt);
  if (b.animRoot && b.animRoot[0]) { o.str(",\"animRoot\":\""); o.str(b.animRoot); o.ch('"'); }
  o.str(",\"votesRoot\":\""); o.str(b.votesRoot); o.str("\",\"committeeMode\":\""); o.str(b.committeeMode); o.str("\",\"committeeK\":"); o.u64(b.committeeK);
  o.str(",\"committeeRoot\":\""); o.str(b.committeeRoot); o.str("\",\"minerRoot\":\""); o.str(b.minerRoot); o.str("\"}");
  return o.ok ? (int)o.pos : -1;
}

template <class Sha> static inline int pod_block_hash_v2(const PodBlockV2& b, char* scratch, size_t cap, char hashHex[65]) {
  int n = pod_block_canonical_v2(scratch, cap, b);
  if (n < 0) return -1;
  Sha s; s.begin(); uint8_t o[32]; s.update(scratch, (size_t)n); s.finish(o); pod_hex(o, 32, hashHex);
  return n;
}
