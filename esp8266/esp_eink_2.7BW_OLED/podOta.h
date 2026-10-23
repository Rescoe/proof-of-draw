// podOta.h — OTA-4A (15/10/2026) : briques LOCALES et PURES (aucune dépendance Arduino, C++11) du socle de mise à jour signée de l'ESP8266.
// Contenu : plausibilité de l'annonce, trailer signé, garde de flux (région signée), enregistrement d'état en EEPROM (anti-downgrade, tentatives, confirmation de démarrage).
// Spécification et décisions : docs/ADR_OTA_4A_CONTRAT_DE_SECURITE_2026_10_15.md. Miroir TypeScript : lib/otaTrailer.ts (vecteurs différentiels : consensus-pod/test-vectors/ota-vectors.txt).
// AUCUNE cryptographie ici : la signature RSA-2048 est contrôlée par l'adaptateur ESP8266 (esp8266/_shared/pod_ota_esp.h) ; ce module décide de ce qui est ACCEPTABLE autour d'elle.
// Aucun effet : rien n'est branché aux routes ni au vote tant que POD_OTA reste à 0.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace podota {

enum : size_t { TRAILER_LEN = 64, SIG_LEN = 256, FAMILY_MAX = 24, VERSION_MAX = 24, URL_MAX = 96 };
static const uint32_t MAX_REGION = 1000000u;      // région signée (image ‖ trailer), sous la limite de l'éditeur de liens (1 044 464 o)
static const char TRAILER_MAGIC[9] = "PODOTA01";

// ── Alphabet des identifiants (famille, version) : [A-Za-z0-9._+-] ─────────────────────────────────────────────────────────────────────────────────
inline bool idChar(char c) { return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '.' || c == '_' || c == '+' || c == '-'; }
inline bool idOk(const char* s, size_t max) { size_t n = 0; while (s[n] != 0 && n <= max) { if (!idChar(s[n])) return false; n++; } return n >= 1 && n <= max; }

// ── Version qui sait voter en v2 : miroir de lib/voteCapability.ts (liste VOTE_V2_FIRMWARE ; test de parité avec le TypeScript) ──────────────────────
struct VoteMin { const char* prefix; uint8_t major, minor; };
static const VoteMin VOTE_V2[] = {
  {"r4tft28", 2, 5}, {"r4eink29", 1, 1}, {"r4eink27", 1, 1}, {"r4multiscreen", 1, 1}, {"r4tft18", 1, 1},
  {"multiscreen", 2, 5}, {"eink27bw", 2, 1}, {"eink29bwr", 2, 3}, {"tft18", 2, 4},
};
inline char lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }
/** ^([a-z0-9]+)-(\d+)\.(\d+)(?:\.\d+)?$ (insensible à la casse), puis version >= minimum du préfixe. */
inline bool voteV2Capable(const char* v) {
  char prefix[32]; size_t i = 0;
  while (v[i] != 0 && i < sizeof(prefix) - 1) { char c = lower(v[i]); if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) break; prefix[i] = c; i++; }
  if (i == 0 || v[i] != '-') return false;
  prefix[i] = 0;
  size_t p = i + 1; uint32_t major = 0, minor = 0; size_t d = 0;
  while (v[p] >= '0' && v[p] <= '9') { if (major > 100000u) return false; major = major * 10 + (uint32_t)(v[p] - '0'); p++; d++; }
  if (d == 0 || v[p] != '.') return false;
  p++; d = 0;
  while (v[p] >= '0' && v[p] <= '9') { if (minor > 100000u) return false; minor = minor * 10 + (uint32_t)(v[p] - '0'); p++; d++; }
  if (d == 0) return false;
  if (v[p] == '.') { p++; d = 0; while (v[p] >= '0' && v[p] <= '9') { p++; d++; } if (d == 0) return false; }
  if (v[p] != 0) return false;
  for (size_t k = 0; k < sizeof(VOTE_V2) / sizeof(VOTE_V2[0]); k++)
    if (strcmp(prefix, VOTE_V2[k].prefix) == 0) return major > VOTE_V2[k].major || (major == VOTE_V2[k].major && minor >= VOTE_V2[k].minor);
  return false;
}

// ── Trailer signé : "PODOTA01" ‖ otaSeq u32 LE ‖ imageLen u32 LE ‖ family[24] ‖ version[24] (remplissage strictement NUL) ──────────────────────────
struct Trailer { uint32_t otaSeq; uint32_t imageLen; char family[FAMILY_MAX + 1]; char version[VERSION_MAX + 1]; };
enum TrailerErr : uint8_t { T_OK = 0, T_MAGIC, T_SEQ, T_IMAGE_LEN, T_FAMILY, T_VERSION };
inline uint32_t rd32(const uint8_t* p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
inline void wr32(uint8_t* p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24); }
inline bool cfield(const uint8_t* b, size_t max, char* out) {       // texte NUL-terminé, remplissage NUL, alphabet identifiants
  size_t n = 0; while (n < max && b[n] != 0) { out[n] = (char)b[n]; n++; }
  for (size_t i = n; i < max; i++) if (b[i] != 0) return false;
  out[n] = 0; return idOk(out, max);
}
inline TrailerErr parseTrailer(const uint8_t b[TRAILER_LEN], Trailer* t) {
  if (memcmp(b, TRAILER_MAGIC, 8) != 0) return T_MAGIC;
  t->otaSeq = rd32(b + 8); t->imageLen = rd32(b + 12);
  if (t->otaSeq < 1) return T_SEQ;
  if (t->imageLen < 1 || t->imageLen > MAX_REGION) return T_IMAGE_LEN;
  if (!cfield(b + 16, FAMILY_MAX, t->family)) return T_FAMILY;
  if (!cfield(b + 40, VERSION_MAX, t->version)) return T_VERSION;
  return T_OK;
}

// ── Contrôle de la région signée, FLUX : le hachage voit chaque octet ; on compte et on garde les 64 derniers ─────────────────────────────────────────
enum Verdict : uint8_t { V_OK = 0, V_SIZE, V_TRAILER_MAGIC, V_TRAILER_LENGTH, V_TRAILER_FAMILY, V_TRAILER_SEQ, V_TRAILER_IMAGE_LEN, V_TRAILER_VERSION, V_DOWNGRADE, V_OFFER_SEQ, V_NOT_VOTE_CAPABLE };
inline const char* verdictName(Verdict v) {
  static const char* const n[] = {"OK", "size", "trailer-magic", "trailer-length", "trailer-family", "trailer-seq", "trailer-image-len", "trailer-version", "downgrade", "offer-seq", "not-vote-capable"};
  return n[v];
}
struct Expect { const char* family; uint32_t offerSeq; uint32_t offerSize; uint32_t installedSeq; };
class TrailerGuard {
 public:
  void begin() { total_ = 0; memset(tail_, 0, sizeof(tail_)); }
  void update(const uint8_t* d, size_t n) {
    if (n == 0) return;
    total_ += (uint32_t)n;
    if (n >= TRAILER_LEN) { memcpy(tail_, d + (n - TRAILER_LEN), TRAILER_LEN); return; }
    memmove(tail_, tail_ + n, TRAILER_LEN - n);
    memcpy(tail_ + (TRAILER_LEN - n), d, n);
  }
  uint32_t total() const { return total_; }
  /** À appeler APRÈS une signature valide. Ordre = lib/otaTrailer.ts checkRegionTrailer. */
  Verdict finish(const Expect& e) const {
    if (total_ != e.offerSize) return V_SIZE;
    if (total_ < TRAILER_LEN + 1) return V_TRAILER_LENGTH;
    Trailer t;
    switch (parseTrailer(tail_, &t)) {
      case T_OK: break; case T_MAGIC: return V_TRAILER_MAGIC; case T_SEQ: return V_TRAILER_SEQ; case T_IMAGE_LEN: return V_TRAILER_IMAGE_LEN;
      case T_FAMILY: return V_TRAILER_FAMILY; default: return V_TRAILER_VERSION;
    }
    if (strcmp(t.family, e.family) != 0) return V_TRAILER_FAMILY;
    if (t.otaSeq != e.offerSeq) return V_OFFER_SEQ;
    if (t.imageLen != total_ - TRAILER_LEN) return V_TRAILER_IMAGE_LEN;
    if (t.otaSeq <= e.installedSeq) return V_DOWNGRADE;
    if (!voteV2Capable(t.version)) return V_NOT_VOTE_CAPABLE;
    return V_OK;
  }
 private:
  uint32_t total_ = 0;
  uint8_t tail_[TRAILER_LEN];
};

// ── Annonce (consultative, NON authentifiée) : plausibilité avant tout téléchargement. Ordre = lib/otaTrailer.ts checkOffer ───────────────────────
struct Offer { char family[FAMILY_MAX + 1]; char version[VERSION_MAX + 1]; uint32_t otaSeq, minOtaSeq, size; uint8_t keySlot; char urlPath[URL_MAX + 1]; };
enum OfferVerdict : uint8_t { O_OK = 0, O_FIELD, O_FAMILY, O_KEY_SLOT, O_URL, O_SIZE, O_NOT_VOTE_CAPABLE, O_NOT_NEWER };
inline const char* offerName(OfferVerdict v) {
  static const char* const n[] = {"OK", "field", "family", "key-slot", "url", "size", "not-vote-capable", "not-newer"};
  return n[v];
}
inline bool urlPathOk(const char* u) {      // /^\/firmware\/[A-Za-z0-9._\/-]{1,80}$/ et pas de ".."
  static const char pre[] = "/firmware/"; const size_t pl = sizeof(pre) - 1;
  if (strncmp(u, pre, pl) != 0) return false;
  size_t n = 0; for (const char* p = u + pl; *p; p++, n++) { char c = *p; if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '.' || c == '_' || c == '/' || c == '-')) return false; }
  if (n < 1 || n > 80) return false;
  for (size_t i = 0; u[i] && u[i + 1]; i++) if (u[i] == '.' && u[i + 1] == '.') return false;
  return true;
}
struct OfferContext { const char* family; uint32_t installedSeq; uint32_t maxStage; };
inline OfferVerdict checkOffer(const Offer& o, const OfferContext& c) {
  if (!idOk(o.family, FAMILY_MAX) || !idOk(o.version, VERSION_MAX) || o.otaSeq < 1 || o.minOtaSeq > o.otaSeq) return O_FIELD;
  if (strcmp(o.family, c.family) != 0) return O_FAMILY;
  if (o.keySlot > 1) return O_KEY_SLOT;
  if (!urlPathOk(o.urlPath)) return O_URL;
  if (o.size <= TRAILER_LEN || o.size > MAX_REGION || (uint64_t)o.size + SIG_LEN + 4 > (uint64_t)c.maxStage) return O_SIZE;
  if (!voteV2Capable(o.version)) return O_NOT_VOTE_CAPABLE;
  if (o.otaSeq <= c.installedSeq) return O_NOT_NEWER;
  return O_OK;
}

// ── Enregistrement d'état OTA : 28 octets en EEPROM (zone réservée 420..447). Écritures : début de tentative et confirmation de santé SEULEMENT ──────
//   0..1 "OT" · 2 version de mise en page (1) · 3 état · 4..7 installedSeq · 8..11 attemptSeq · 12 tentatives pour attemptSeq · 13 démarrages non confirmés · 14 dernier résultat · 15..23 réservés (0) · 24..27 CRC-32
enum : size_t { RECORD_LEN = 28 };
enum State : uint8_t { S_IDLE = 0, S_ATTEMPTING = 1, S_BLOCKED = 2 };
enum Result : uint8_t { R_NONE = 0, R_OK = 1, R_NOT_APPLIED = 2, R_UNHEALTHY = 3, R_LOST = 4 };
enum : uint8_t { MAX_ATTEMPTS = 2, MAX_UNCONFIRMED_BOOTS = 3 };
struct Record { uint8_t state; uint32_t installedSeq, attemptSeq; uint8_t attempts, unconfirmed, lastResult; bool fresh; };

inline uint32_t crc32(const uint8_t* d, size_t n) {
  uint32_t c = 0xFFFFFFFFu;
  for (size_t i = 0; i < n; i++) { c ^= d[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (uint32_t)(-(int32_t)(c & 1))); }
  return ~c;
}
inline void recEncode(const Record& r, uint8_t b[RECORD_LEN]) {
  memset(b, 0, RECORD_LEN);
  b[0] = 'O'; b[1] = 'T'; b[2] = 1; b[3] = r.state;
  wr32(b + 4, r.installedSeq); wr32(b + 8, r.attemptSeq);
  b[12] = r.attempts; b[13] = r.unconfirmed; b[14] = r.lastResult;
  wr32(b + 24, crc32(b, 24));
}
/** Octets EEPROM -> enregistrement. Invalide (effacé 0xFF, corrompu, autre version, état inconnu) => enregistrement NEUF (fresh = true). */
inline Record recDecode(const uint8_t b[RECORD_LEN], uint32_t compiledSeq) {
  Record r; r.state = S_IDLE; r.installedSeq = compiledSeq; r.attemptSeq = 0; r.attempts = 0; r.unconfirmed = 0; r.lastResult = R_NONE; r.fresh = true;
  if (b[0] != 'O' || b[1] != 'T' || b[2] != 1) return r;
  if (rd32(b + 24) != crc32(b, 24)) return r;
  if (b[3] > S_BLOCKED) return r;
  for (int i = 15; i < 24; i++) if (b[i] != 0) return r;
  r.state = b[3]; r.installedSeq = rd32(b + 4); r.attemptSeq = rd32(b + 8); r.attempts = b[12]; r.unconfirmed = b[13]; r.lastResult = b[14]; r.fresh = false;
  return r;
}
inline bool recEqual(const Record& a, const Record& b) {
  return a.state == b.state && a.installedSeq == b.installedSeq && a.attemptSeq == b.attemptSeq && a.attempts == b.attempts && a.unconfirmed == b.unconfirmed && a.lastResult == b.lastResult;
}
/**
 * À chaque démarrage, AVANT toute annonce. `compiledSeq` = séquence compilée dans l'image qui tourne (vérité : l'image est signée, ou posée par câble).
 *  - enregistrement neuf ou corrompu : installedSeq := compiledSeq ;
 *  - l'image qui tourne PRIME sur l'enregistrement (flash par câble d'un autre build) : installedSeq := compiledSeq, tentative ou blocage clos ;
 *  - tentative en cours : image == cible => démarrage compté (la confirmation de santé viendra plus tard) ; plus de MAX_UNCONFIRMED_BOOTS => BLOQUÉ ; image != cible => non appliquée.
 * Retour : true si l'enregistrement doit être réécrit en EEPROM (changement ou enregistrement neuf).
 */
inline bool recOnBoot(Record* r, uint32_t compiledSeq) {
  const Record before = *r;
  const bool wasFresh = r->fresh;
  if (r->state == S_ATTEMPTING || r->state == S_BLOCKED) {
    if (compiledSeq == r->attemptSeq) {
      if (r->state == S_ATTEMPTING) {
        if (r->unconfirmed < 255) r->unconfirmed++;
        if (r->unconfirmed > MAX_UNCONFIRMED_BOOTS) { r->state = S_BLOCKED; r->lastResult = R_UNHEALTHY; }
      }
    } else {
      r->state = S_IDLE; r->lastResult = (compiledSeq < r->attemptSeq) ? R_NOT_APPLIED : R_LOST; r->unconfirmed = 0;
    }
  }
  if (r->state == S_IDLE && r->installedSeq != compiledSeq) r->installedSeq = compiledSeq;
  r->fresh = false;
  return wasFresh || !recEqual(before, *r);
}
/** Démarrage SAIN constaté (register et pull réussis) : l'image qui tourne devient la référence. Retour : true si à réécrire. */
inline bool recConfirmHealthy(Record* r, uint32_t compiledSeq) {
  if (r->state == S_ATTEMPTING && compiledSeq == r->attemptSeq) {
    r->installedSeq = compiledSeq; r->state = S_IDLE; r->attempts = 0; r->unconfirmed = 0; r->lastResult = R_OK; return true;
  }
  return false;
}
/** Une annonce de séquence `seq` peut-elle être tentée ? (hors plausibilité de l'annonce elle-même) */
inline bool recAllows(const Record& r, uint32_t seq) {
  if (r.state == S_BLOCKED || r.state == S_ATTEMPTING) return false;
  if (seq <= r.installedSeq) return false;
  if (seq == r.attemptSeq && r.attempts >= MAX_ATTEMPTS) return false;
  return true;
}
/** Début de tentative : à écrire en EEPROM AVANT le téléchargement. Retour : false si refusée (aucune modification). */
inline bool recBeginAttempt(Record* r, uint32_t seq) {
  if (!recAllows(*r, seq)) return false;
  if (seq != r->attemptSeq) { r->attemptSeq = seq; r->attempts = 0; }
  r->state = S_ATTEMPTING; if (r->attempts < 255) r->attempts++; r->unconfirmed = 0; r->fresh = false;
  return true;
}
/** Tentative terminée SANS redémarrage (signature refusée, réseau, mémoire) : retour à IDLE, la tentative reste comptée. */
inline void recEndAttemptNoReboot(Record* r, uint8_t result) { if (r->state == S_ATTEMPTING) { r->state = S_IDLE; r->lastResult = result; } }

// ── ANNONCE de /api/pull + billet de téléchargement (20/10/2026, POD_OTA_CLIENT) ──────────────────────────────────────────────────────────────────────
// Miroir de lib/otaDistribution.ts (OtaAnnouncement, otaFetchMessage, parseFetchQuery). L'annonce n'est PAS authentifiée : elle ne donne que ce qu'il faut pour DEMANDER l'image
// (un défi HMAC, valable 30 min, que seul l'appareil peut signer) ; l'authenticité de l'image vient de la signature RSA de la région, vérifiée par l'Updater.
// Le chemin de l'image n'est JAMAIS lu dans l'annonce : il est calculé ici (/firmware/<rel>/image.bin) — le serveur de pull ne peut pas diriger l'appareil ailleurs.
enum : size_t { REL_MAX = 64, DEVICE_ID_LEN = 12, HEX_CHAL = 64, SIG_HEX = 128, FETCH_MSG_MAX = 192, QUERY_MAX = 280 };
static const uint32_t TICKET_TTL_SEC = 1800;      // durée du défi côté serveur (OTA_TICKET_TTL_SEC)
static const uint32_t TICKET_SKEW_SEC = 120;      // tolérance d'horloge
struct Announcement { char rel[REL_MAX + 1]; char ver[VERSION_MAX + 1]; uint32_t seq, minSeq, size, exp; uint8_t slot; char chal[HEX_CHAL + 1]; };

inline bool isHexLower(const char* s, size_t n) { for (size_t i = 0; i < n; i++) { char c = s[i]; if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false; } return s[n] == 0; }
/** ^dev_[A-Z0-9]{8}$ */
inline bool deviceIdOk(const char* d) {
  if (strlen(d) != DEVICE_ID_LEN || strncmp(d, "dev_", 4) != 0) return false;
  for (size_t i = 4; i < DEVICE_ID_LEN; i++) { char c = d[i]; if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z'))) return false; }
  return true;
}
/** Identifiant de release : [A-Za-z0-9._+-]{1,64}, ni « .. » (jamais de « / » : il fabrique un chemin). */
inline bool releaseIdOk(const char* r) {
  if (!idOk(r, REL_MAX)) return false;
  for (size_t i = 0; r[i] && r[i + 1]; i++) if (r[i] == '.' && r[i + 1] == '.') return false;
  return true;
}
/** Valide les champs de l'annonce (jamais de confiance accordée à la forme) : release, version votante, défi hexadécimal minuscule de 64 caractères, créneau 0/1, séquences cohérentes. */
inline bool announcementOk(const Announcement& a) {
  return releaseIdOk(a.rel) && idOk(a.ver, VERSION_MAX) && a.seq >= 1 && a.minSeq <= a.seq && a.slot <= 1 && a.size > TRAILER_LEN && a.size <= MAX_REGION && a.exp > 0 && isHexLower(a.chal, HEX_CHAL);
}
/** Annonce -> Offer (contrôles de plausibilité communs, podota::checkOffer, faits ensuite par l'adaptateur). Le chemin est CALCULÉ. */
inline bool offerFromAnnouncement(const Announcement& a, const char* family, Offer* o) {
  if (!announcementOk(a) || strlen(family) > FAMILY_MAX) return false;
  memset(o, 0, sizeof(*o));
  strcpy(o->family, family); strcpy(o->version, a.ver);
  o->otaSeq = a.seq; o->minOtaSeq = a.minSeq; o->size = a.size; o->keySlot = a.slot;
  static const char pre[] = "/firmware/", post[] = "/image.bin";
  const size_t need = (sizeof(pre) - 1) + strlen(a.rel) + (sizeof(post) - 1);
  if (need > URL_MAX) return false;
  strcpy(o->urlPath, pre); strcat(o->urlPath, a.rel); strcat(o->urlPath, post);
  return true;
}
/** Le défi est-il encore utilisable à l'instant `now` (secondes Unix, horloge DÉJÀ validée) ? Refuse un billet expiré ou annoncé plus loin que sa durée de vie (+ tolérance). */
inline bool ticketFresh(uint32_t exp, uint32_t now) { return exp > now && (exp - now) <= TICKET_TTL_SEC + TICKET_SKEW_SEC; }

/**
 * Pile continue (ESP8266) : place libre COURANTE = sp - fond de pile >= besoin. Échec fermé si la mesure est incohérente (sp au-dessous du fond).
 * ⚠ ESP.getFreeContStack() NE convient PAS : c'est un FILIGRANE HAUT (mots 0xA5 jamais écrasés depuis le boot = profondeur maximale déjà atteinte), pas la place libre ici et maintenant.
 * Le 21/10/2026 il a affiché 880 o (< 2048) à chaque annonce alors qu'il restait ≈ 3,1 Ko à l'appel : l'OTA aurait été refusée pour toujours (docs/ANALYSE_PILE_OTA_ESP8266_2026_10_21.md).
 */
inline bool contStackEnough(uint32_t sp, uint32_t bottom, uint32_t need) { return sp > bottom && (sp - bottom) >= need; }
// ── Anti-épuisement par ANNONCE FORGÉE (20/10/2026) ───────────────────────────────────────────────────────────────────────────────────────────────────
// /api/pull n'est pas authentifié : qui peut modifier sa réponse peut fabriquer une annonce plausible. Trois règles, toutes pures et testées (consensus-pod/host/ota_attempt_harness.cpp) :
//  1. la TENTATIVE n'est inscrite en EEPROM qu'au premier signe AUTHENTIQUE (réponse HTTP 200 du serveur, valide en TLS authentifié, juste avant l'écriture de l'image) : une annonce forgée dont le défi est
//     refusé (403/410/429/503), une erreur TLS, une coupure avant la réponse ⇒ AUCUNE écriture EEPROM, AUCUN compteur touché ;
//  2. un échec de TRANSPORT après ce premier signe (connexion perdue, délai de lecture, mémoire) REMBOURSE la tentative (aucune image n'a été activée, aucun redémarrage n'a eu lieu) ;
//     un échec de CONTENU (signature, trailer, taille, en-tête) reste compté : c'est lui que MAX_ATTEMPTS borne ;
//  3. TOUT échec déclenche une PAUSE en RAM (2, 4, 8, 16, 32 min) puis un ARRÊT jusqu'au redémarrage après MAX_PRE_FAILURES échecs : coût borné (NTP + TLS) sans aucune usure d'EEPROM ;
//     un redémarrage réinitialise la pause (il ne coûte rien à un attaquant réseau, mais il ne rend jamais le blocage PERSISTANT).
// La pause est mémorisée par (début, durée) et jugée en TEMPS ÉCOULÉ non signé : exact tant que backoffTick() est appelée au moins une fois par 49 jours (le loop() l'appelle en continu) ;
// une date d'échéance comparée avec signe se tromperait après 24,8 jours de fonctionnement (défaut trouvé par les tests, corrigé le 20/10/2026).
struct Backoff { uint32_t startMs, durMs; uint8_t failures; bool halted, paused; };
enum : uint32_t { BACKOFF_BASE_MS = 120000u, BACKOFF_CAP_MS = 3600000u };
enum : uint8_t { MAX_PRE_FAILURES = 6 };
inline void backoffInit(Backoff* b) { b->startMs = 0; b->durMs = 0; b->failures = 0; b->halted = false; b->paused = false; }
/** À appeler en continu (même sans annonce) : lève la pause arrivée à échéance, avant que l'horloge ne puisse la faire paraître de nouveau en cours. */
inline void backoffTick(Backoff* b, uint32_t nowMs) { if (b->paused && (uint32_t)(nowMs - b->startMs) >= b->durMs) b->paused = false; }
/** Le moment est-il venu d'essayer ? Arrêtée jusqu'au redémarrage = jamais. */
inline bool backoffAllows(const Backoff& b, uint32_t nowMs) { return !b.halted && !(b.paused && (uint32_t)(nowMs - b.startMs) < b.durMs); }
/** Un essai a échoué : pause 120 s << (échecs précédents), plafonnée à 1 h ; arrêt définitif (jusqu'au redémarrage) au MAX_PRE_FAILURES-ième. */
inline void backoffFailed(Backoff* b, uint32_t nowMs) {
  uint32_t d = BACKOFF_BASE_MS; for (uint8_t i = 0; i < b->failures && d < BACKOFF_CAP_MS; i++) d <<= 1;
  if (d > BACKOFF_CAP_MS) d = BACKOFF_CAP_MS;
  if (b->failures < 255) b->failures++;
  if (b->failures >= MAX_PRE_FAILURES) b->halted = true;
  b->startMs = nowMs; b->durMs = d; b->paused = true;
}
enum FailClass : uint8_t { FC_TRANSPORT = 0, FC_CONTENT = 1 };
/**
 * Classe un code d'échec de l'Updater / du client HTTP (valeurs du cœur ESP8266 3.1.2, copiées ici pour rester pures) :
 *  TRANSPORT : HTTPC_ERROR_* (-1…-11), UPDATE_ERROR_READ 3, SPACE 4, STREAM 6 (délai de lecture), NO_DATA 13, OOM 14 ;
 *  CONTENU   : tout le reste (SIGN 12, MD5 7, SIZE 5, MAGIC_BYTE 10, FLASH_CONFIG 8/9, BOOTSTRAP 11, WRITE 1, ERASE 2, HTTP_UE_* ≤ -100, code inconnu) — par prudence un code inconnu COMPTE.
 */
inline FailClass classifyFailure(int code) {
  if (code >= -11 && code <= -1) return FC_TRANSPORT;
  if (code == 3 || code == 4 || code == 6 || code == 13 || code == 14) return FC_TRANSPORT;
  return FC_CONTENT;
}
/** Rembourse la tentative en cours (échec de transport, aucun redémarrage) : retour à IDLE, un compteur de moins. */
inline void recRefundAttempt(Record* r) { if (r->state == S_ATTEMPTING) { if (r->attempts > 0) r->attempts--; r->state = S_IDLE; r->lastResult = R_NONE; } }
/**
 * Applique l'issue d'un téléchargement ÉCHOUÉ (sans redémarrage). `began` = la tentative a été inscrite (premier signe authentique). Retourne true si l'enregistrement doit être écrit en EEPROM.
 * Toujours : pause. Pas de tentative inscrite ⇒ rien à écrire.
 */
inline bool afterFailedDownload(Record* r, Backoff* b, bool began, int code, uint32_t nowMs) {
  backoffFailed(b, nowMs);
  if (!began) return false;
  if (classifyFailure(code) == FC_TRANSPORT) { recRefundAttempt(r); return true; }
  recEndAttemptNoReboot(r, R_NONE); return true;
}

/** Message signé par l'appareil : « pod-ota-fetch-v1|deviceId|release|exp|défi » (UTF-8, sans NUL final). Retourne la longueur, 0 si trop long/invalide. */
inline size_t fetchMessage(char* out, size_t cap, const char* deviceId, const Announcement& a) {
  if (!deviceIdOk(deviceId) || !announcementOk(a)) return 0;
  static const char dom[] = "pod-ota-fetch-v1";
  char exp[12]; { uint32_t v = a.exp; char t[12]; int n = 0; do { t[n++] = (char)('0' + v % 10); v /= 10; } while (v); for (int i = 0; i < n; i++) exp[i] = t[n - 1 - i]; exp[n] = 0; }
  const size_t len = (sizeof(dom) - 1) + 1 + strlen(deviceId) + 1 + strlen(a.rel) + 1 + strlen(exp) + 1 + HEX_CHAL;
  if (len > cap || len > FETCH_MSG_MAX) return 0;
  size_t p = 0;
  auto put = [&](const char* s) { size_t n = strlen(s); memcpy(out + p, s, n); p += n; };
  put(dom); out[p++] = '|'; put(deviceId); out[p++] = '|'; put(a.rel); out[p++] = '|'; put(exp); out[p++] = '|'; put(a.chal);
  return p;
}
/** Requête STRICTE « ?d=…&e=…&c=…&g=… » (signature en hexadécimal minuscule, 64 octets). Retourne la longueur, 0 si invalide. */
inline size_t fetchQuery(char* out, size_t cap, const char* deviceId, const Announcement& a, const uint8_t sig[64]) {
  if (!deviceIdOk(deviceId) || !announcementOk(a)) return 0;
  char exp[12]; { uint32_t v = a.exp; char t[12]; int n = 0; do { t[n++] = (char)('0' + v % 10); v /= 10; } while (v); for (int i = 0; i < n; i++) exp[i] = t[n - 1 - i]; exp[n] = 0; }
  const size_t len = 3 + DEVICE_ID_LEN + 3 + strlen(exp) + 3 + HEX_CHAL + 3 + SIG_HEX + 1;   // ?d= … &e= … &c= … &g= … + NUL
  if (len > cap || len > QUERY_MAX) return 0;
  size_t p = 0;
  auto put = [&](const char* s) { size_t n = strlen(s); memcpy(out + p, s, n); p += n; };
  put("?d="); put(deviceId); put("&e="); put(exp); put("&c="); put(a.chal); put("&g=");
  static const char hx[] = "0123456789abcdef";
  for (int i = 0; i < 64; i++) { out[p++] = hx[sig[i] >> 4]; out[p++] = hx[sig[i] & 15]; }
  out[p] = 0;
  return p;
}

}  // namespace podota
