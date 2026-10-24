// pod_ota_esp.h — OTA-4A (15/10/2026) : adaptateur ESP8266 du socle de mise à jour signée. N'EST INCLUS QUE SI POD_OTA = 1 (le firmware est alors le socle ; à 0, ce fichier n'est pas lu).
// ⚠ COMPILÉ ET TESTÉ SUR L'HÔTE SEULEMENT. JAMAIS ESSAYÉ SUR UNE CARTE. Aucune route, aucune annonce dans /api/pull, aucun hébergement : tant qu'aucune annonce n'est posée (podOtaSetOffer), il ne se passe RIEN d'observable
// hormis la lecture/écriture de l'enregistrement d'état au démarrage. Décisions : docs/ADR_OTA_4A_CONTRAT_DE_SECURITE_2026_10_15.md.
//
// Dépendances fournies par le sketch AVANT l'inclusion : SERVER_URL, POD_OTA_FAMILY, POD_OTA_SEQ, EEPROM_OTA_OFF (zone réservée 420..447), EEPROM déjà démarrée (EEPROM.begin).
//
// Mémoire (ESP8266, BearSSL ≈ 27 Ko dont pile de poussée 6 200) :
//   • au repos : enregistrement 16 o + annonce ≈ 160 o de RAM statique ; AUCUN objet cryptographique tenu, AUCUNE pile à 2ᵉ étage tenue ;
//   • pendant une OTA seulement : clé publique analysée (≈ 0,5 Ko), hachage + garde (≈ 0,2 Ko), pile à 2ᵉ étage PRISE seulement pendant la vérification RSA, jeu de travail ESPhttpUpdate (≈ 7,7 Ko mesuré sur la sonde, HTTP).
//   • garde-fous : POD_OTA_MIN_HEAP / POD_OTA_MIN_BLOCK (valeurs PRUDENTES, à mesurer sur la carte : OTA-4B).
#pragma once
#include <Arduino.h>
#include <EEPROM.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ESP8266httpUpdate.h>
#include <BearSSLHelpers.h>
#include <StackThunk.h>
#include <Updater.h>
#include <bearssl/bearssl.h>
#include <new>
#include "podOta.h"
#if __has_include("pod_ota_keys.h")
  #include "pod_ota_keys.h"          // VRAIES clés publiques (hors ligne, ignoré par git)
#else
  #include "pod_ota_keys_test.h"     // clés de TEST sans moitié privée : aucune image ne peut être acceptée
#endif

// Base de l'URL de l'image : SERVER_URL (le serveur PoD) par défaut. Seul un CANARI de laboratoire la redéfinit (-DPOD_OTA_BASE_URL=\"http://<PC>:8080\"), pour servir l'image depuis le PC sans toucher au serveur de production.
#ifndef POD_OTA_BASE_URL
#define POD_OTA_BASE_URL SERVER_URL
#endif

#ifndef POD_OTA_MIN_HEAP
#define POD_OTA_MIN_HEAP  30000UL    // tas libre minimal pour DÉMARRER une OTA (seuil d'alerte du dépôt) — à mesurer sur la carte
#endif
#ifndef POD_OTA_MIN_BLOCK
#define POD_OTA_MIN_BLOCK 18000UL    // plus grand bloc libre minimal (TLS : tampon d'entrée/sortie contigu de ≈ 16,9 Ko) — à mesurer sur la carte
#endif

// CLIENT OTA INTERNET (20/10/2026) : 0 (défaut) = AUCUN changement (le texte compilé est celui d'avant). 1 = lit l'annonce de /api/pull, prouve la possession de la clé d'appareil (signature du défi), télécharge l'image
// signée en TLS AUTHENTIFIÉ (pod_ota_tls.h : racines épinglées + nom d'hôte + heure SNTP, jamais setInsecure). Exige POD_OTA = 1. Le sketch DOIT définir
//   bool podOtaSignFetch(const char* msg, size_t n, uint8_t sig[64]);   (signature avec la clé d'identité de l'appareil ; false = échec, rien n'est envoyé)
// ⚠ NON ESSAYÉ SUR UNE CARTE. Décisions : docs/ADR_TLS_AUTHENTIFIE_OTA_ESP8266_2026_10_20.md et docs/OTA_INTERNET_CANARI_RAPPORT_AUDIT_2026_10_20.md.
#ifndef POD_OTA_CLIENT
#define POD_OTA_CLIENT 0
#endif
#if POD_OTA_CLIENT
  #include "pod_ota_tls.h"
  #ifndef POD_OTA_MIN_CONT_STACK
  #define POD_OTA_MIN_CONT_STACK 2048UL   // pile du loop() libre exigée AVANT de signer le défi (le vote exige 512 o à son propre point ; la signature coûte ≈ 1,2 Ko) — à mesurer sur la carte
  #endif
  #ifndef POD_OTA_BLOCK_AFTER_ANCHORS
  // Plus grand bloc libre exigé APRÈS l'armement du client (ancres + WiFiClientSecure, donc pile de poussée BearSSL déjà prise) et AVANT la connexion : tampon d'entrée ≈ 17 Ko contigu + contexte TLS.
  // MESURÉ le 22/10/2026 sur la carte : bloc 21 232 => « Unhandled C++ exception: OOM » (panique) ; bloc 24 480 => TLS réussi (puis il ne reste que 5,7 Ko de tas). L'ancien seuil 17 408 laissait passer le cas fatal.
  #define POD_OTA_BLOCK_AFTER_ANCHORS 24000UL
  #endif
  // Trace du tas (étapes du vrai chemin) : une ligne par étape, littéral en flash (PSTR), aucun secret.
  #define OTA_MEM(msg) Serial.printf_P(PSTR("[OTA-MEM] " msg " : tas=%u bloc=%u frag=%u%%\n"), (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxFreeBlockSize(), (unsigned)ESP.getHeapFragmentation())
  #include <cont.h>                 // g_pcont : fond de la pile continue (mesure de la place libre COURANTE)
  // Pointeur de pile à l'instant de l'appel ; la place libre COURANTE = sp - fond. ESP.getFreeContStack() est un filigrane haut : voir podota::contStackEnough.
  static inline __attribute__((always_inline)) uint32_t contSpNow() { register uint32_t sp asm("a1"); return sp; }
  bool podOtaSignFetch(const char* msg, size_t n, uint8_t sig[64]);
  const char* podOtaDeviceId();         // « dev_XXXXXXXX » de l'appareil (celui de /api/register)
  #if !POD_OTA
    #error "POD_OTA_CLIENT exige POD_OTA = 1"
  #endif
  #ifdef POD_OTA_LAB_HTTP
    #error "POD_OTA_CLIENT et le transport de laboratoire en clair (POD_OTA_CANARY) sont incompatibles"
  #endif
#endif

namespace podotaesp {

static podota::Record g_rec;                 // enregistrement d'état (copie de l'EEPROM)
#if POD_OTA_CLIENT
static bool           g_began = false;       // la tentative a été inscrite (premier signe authentique) : sans elle, AUCUNE image n'est activée
#endif
static podota::Offer  g_offer;               // annonce courante (non authentifiée)
static bool           g_offerSet = false;

// ── EEPROM (zone réservée, 28 octets ; aucun autre octet n'est touché) ────────────────────────────────────────────────────────────────────────────
static void save() {
  uint8_t b[podota::RECORD_LEN]; podota::recEncode(g_rec, b);
  for (size_t i = 0; i < podota::RECORD_LEN; i++) EEPROM.write(EEPROM_OTA_OFF + i, b[i]);
  EEPROM.commit();
}
static const char* stateName(uint8_t s) { return s == podota::S_IDLE ? "IDLE" : s == podota::S_ATTEMPTING ? "ATTEMPTING" : "BLOCKED"; }

/** À appeler une fois au démarrage, APRÈS EEPROM.begin et AVANT toute annonce. */
static void boot() {
  uint8_t b[podota::RECORD_LEN]; for (size_t i = 0; i < podota::RECORD_LEN; i++) b[i] = EEPROM.read(EEPROM_OTA_OFF + i);
  g_rec = podota::recDecode(b, POD_OTA_SEQ);
  const bool wasFresh = g_rec.fresh;
  if (podota::recOnBoot(&g_rec, POD_OTA_SEQ)) save();
  Serial.printf_P(PSTR("[OTA] image seq=%u famille=%s | enregistrement %s : état=%s installée=%u cible=%u tentatives=%u non-confirmés=%u dernier=%u | clés %s\n"),
                  (unsigned)POD_OTA_SEQ, POD_OTA_FAMILY, wasFresh ? "NEUF" : "lu", stateName(g_rec.state), (unsigned)g_rec.installedSeq, (unsigned)g_rec.attemptSeq,
                  (unsigned)g_rec.attempts, (unsigned)g_rec.unconfirmed, (unsigned)g_rec.lastResult,
#ifdef POD_OTA_KEYS_ARE_TEST
                  "DE TEST (aucune image acceptable)"
#else
                  "de publication"
#endif
                  );
#if POD_OTA_CLIENT
  // Dépendances du canari rendues VISIBLES : version, séquence, serveur compilé (l'URL de téléchargement en dérive) et plancher d'horloge.
  Serial.printf_P(PSTR("[OTA] client Internet actif : firmware=%s séquence=%u serveur=%s plancher-horloge=%lu\n"), FIRMWARE_VERSION, (unsigned)POD_OTA_SEQ, POD_OTA_BASE_URL, (unsigned long)POD_OTA_TIME_FLOOR);
#endif
}

/** Démarrage SAIN constaté (register ET pull réussis) : l'image qui tourne devient la référence. */
static void confirmHealthy() {
  if (podota::recConfirmHealthy(&g_rec, POD_OTA_SEQ)) { save(); Serial.printf_P(PSTR("[OTA] démarrage sain confirmé : installée=%u\n"), (unsigned)g_rec.installedSeq); }
}

/** Pose l'annonce reçue (après un futur branchement à /api/pull). Retour : false et motif si elle est refusée. */
static inline bool setOffer(const podota::Offer& o, const char** why) {      // aucun appelant dans ce lot (pas d'annonce branchée) : inline pour ne pas avertir
  podota::OfferContext c = { POD_OTA_FAMILY, g_rec.installedSeq, (uint32_t)ESP.getFreeSketchSpace() };
  const podota::OfferVerdict v = podota::checkOffer(o, c);
  if (v != podota::O_OK) { if (why) *why = podota::offerName(v); return false; }
  if (!podota::recAllows(g_rec, o.otaSeq)) { if (why) *why = "etat"; return false; }
  g_offer = o; g_offerSet = true; if (why) *why = "OK"; return true;
}

#if POD_OTA_CLIENT
// ── Annonce de /api/pull (non authentifiée) : UNE seule copie, remplie champ par champ par le sketch (jamais tronquée en silence), puis validée ───────────────────────────────────────────────────────
static podota::Announcement g_ann;
static bool                 g_annSet = false;
static inline uint32_t installedSeq() { return g_rec.installedSeq; }
/** Plus d'annonce côté serveur (kill-switch, release retirée, appareil à jour) : on oublie billet ET offre (fermé). */
static inline void clearAnnouncement() { g_annSet = false; g_offerSet = false; memset(&g_ann, 0, sizeof(g_ann)); }
/** Le sketch appelle après avoir rempli g_ann. Retour : nullptr = offre posée ; sinon le motif du refus (rien n'est posé). */
static inline const char* acceptAnnouncement() {
  g_annSet = false;
  podota::Offer o;
  if (!podota::offerFromAnnouncement(g_ann, POD_OTA_FAMILY, &o)) return "annonce";
  const char* why = nullptr;
  if (!setOffer(o, &why)) return why;
  g_annSet = true; return nullptr;
}
#endif

// ── Vérification RSA-2048 PKCS#1 v1.5 / SHA-256 : MÊME primitive et MÊME logique que SigningVerifier du cœur (branche RSA), mais SANS les objets statiques de la bibliothèque ──
#ifdef POD_OTA_LAB_HOOKS            // LABORATOIRE seulement (sonde OTA-4B) : mesures PENDANT la vérification, sur la pile à 2ᵉ étage. Non défini dans le firmware PoD : aucun octet ajouté.
void podLabVerifyBegin();
void podLabVerifyEnd(bool ok);
#endif
extern "C" bool podOtaRsaVerify(const br_rsa_public_key* k, const unsigned char* oid, const void* hash, int hlen, const void* sig, uint32_t slen) {
  unsigned char vrf[64];
  if (hlen > 64) return false;
  br_rsa_pkcs1_vrfy v = br_rsa_pkcs1_vrfy_get_default();
#ifdef POD_OTA_LAB_HOOKS
  podLabVerifyBegin();
  const bool ok = v((const unsigned char*)sig, slen, oid, (size_t)hlen, k, vrf) && memcmp(vrf, hash, (size_t)hlen) == 0;
  podLabVerifyEnd(ok);
  return ok;
#else
  if (!v((const unsigned char*)sig, slen, oid, (size_t)hlen, k, vrf)) return false;
  return memcmp(vrf, hash, (size_t)hlen) == 0;
#endif
}
#if !CORE_MOCK
make_stack_thunk(podOtaRsaVerify);
extern "C" bool thunk_podOtaRsaVerify(const br_rsa_public_key* k, const unsigned char* oid, const void* hash, int hlen, const void* sig, uint32_t slen);
#endif

/** Hachage SHA-256 de la région signée + garde de trailer (compte les octets, retient les 64 derniers). */
class Hash final : public UpdaterHashClass {
 public:
  void begin() override { br_sha256_init(&cc_); memset(h_, 0, sizeof(h_)); guard.begin(); }
  void add(const void* d, uint32_t n) override { br_sha256_update(&cc_, d, n); guard.update((const uint8_t*)d, n); }
  void end() override { br_sha256_out(&cc_, h_); }
  int len() override { return 32; }
  const void* hash() override { return h_; }
  const unsigned char* oid() override { return BR_HASH_OID_SHA256; }
  podota::TrailerGuard guard;
 private:
  br_sha256_context cc_;
  unsigned char h_[32];
};

/** Vérificateur : signature d'abord, trailer ensuite ; la pile à 2ᵉ étage n'est prise que le temps de la vérification RSA. */
class Verifier final : public UpdaterVerifyClass {
 public:
  Verifier(BearSSL::PublicKey* k, Hash* h, const podota::Expect& e) : k_(k), h_(h), e_(e) {}
  uint32_t length() override { return podota::SIG_LEN; }
  bool verify(UpdaterHashClass* hh, const void* sig, uint32_t n) override {
    verdict = podota::V_OK; sigOk = false;
#if POD_OTA_CLIENT
    if (!g_began) { verdict = podota::V_DOWNGRADE; return false; }          // l'état OTA a refusé la tentative : on n'active RIEN
#endif
    if (!k_ || !k_->isRSA() || n != podota::SIG_LEN || hh->len() != 32) { sigOk = false; return false; }
    stack_thunk_add_ref();                       // pile à 2ᵉ étage SEULEMENT pendant la vérification
    sigOk = thunk_podOtaRsaVerify(k_->getRSA(), hh->oid(), hh->hash(), hh->len(), sig, n);
    stack_thunk_del_ref();
    if (!sigOk) return false;
    verdict = h_->guard.finish(e_);
    return verdict == podota::V_OK;
  }
  podota::Verdict verdict = podota::V_OK;
  bool sigOk = false;
 private:
  BearSSL::PublicKey* k_; Hash* h_; podota::Expect e_;
};

#if POD_OTA_CLIENT
// Mesure DU CANARI : plus petit tas / plus grand bloc libres vus PENDANT le téléchargement (rappel de progression de l'Updater, hors octets reçus) ; imprimé avant le redémarrage ou l'échec.
static uint32_t g_minHeap = 0xFFFFFFFFu, g_minBlock = 0xFFFFFFFFu;
// Anti-épuisement (voir podOta.h) : la tentative n'est inscrite en EEPROM qu'au premier signe AUTHENTIQUE (onStart de l'Updater : HTTP 200 du serveur, taille plausible, AVANT toute écriture de l'image) ; pause en RAM après tout échec.
static podota::Backoff g_backoff = { 0, 0, false };
static void onStart() {
#if POD_OTA_CLIENT
  OTA_MEM("reponse 200 du serveur (Updater demarre)");
#endif
  g_began = podota::recBeginAttempt(&g_rec, g_offer.otaSeq);
  if (g_began) { save(); Serial.printf_P(PSTR("[OTA] tentative seq=%u (n°%u) créneau=%c région=%u o — réponse du serveur reçue\n"), (unsigned)g_offer.otaSeq, (unsigned)g_rec.attempts, g_offer.keySlot ? 'B' : 'A', (unsigned)g_offer.size); }
  else Serial.println(F("[OTA] tentative refusée par l'état OTA — l'image ne sera pas activée"));
}
static void onProgress(int, int) { const uint32_t h = ESP.getFreeHeap(), b = ESP.getMaxFreeBlockSize(); if (h < g_minHeap) g_minHeap = h; if (b < g_minBlock) g_minBlock = b; }
/**
 * Fabrique la requête de téléchargement « ?d=…&e=…&c=…&g=… » AVANT d'ouvrir le moindre TLS. Échec fermé, sans tentative comptée :
 *  tas (marge des ancres) · pile du loop() · billet posé · heure SNTP >= plancher · défi encore frais · signature du défi par la clé d'appareil (le message est effacé ensuite).
 */
static bool prepareFetch(char* q, size_t cap, uint32_t freeHeap) {
  if (!g_annSet) { Serial.println(F("[OTA] pas de billet de téléchargement (annonce non posée) — reporté")); return false; }
  g_annSet = false;                                                          // billet à USAGE UNIQUE : le prochain /api/pull en fournit un neuf (défi frais)
  if (freeHeap < POD_OTA_MIN_HEAP + POD_OTA_TLS_EXTRA_HEAP) {
    Serial.printf_P(PSTR("[OTA] tas insuffisant pour le TLS authentifié (%u < %lu) — reporté\n"), (unsigned)freeHeap, (unsigned long)(POD_OTA_MIN_HEAP + POD_OTA_TLS_EXTRA_HEAP));
    return false;
  }
  const uint32_t sp = contSpNow(), bottom = (uint32_t)g_pcont->stack, cont = sp > bottom ? sp - bottom : 0, hwm = ESP.getFreeContStack();   // place libre COURANTE (décide) ; filigrane haut (journal seulement)
  if (!podota::contStackEnough(sp, bottom, POD_OTA_MIN_CONT_STACK)) { Serial.printf_P(PSTR("[OTA] pile courante insuffisante pour signer (%u < %lu ; filigrane %u) — reporté\n"), (unsigned)cont, (unsigned long)POD_OTA_MIN_CONT_STACK, (unsigned)hwm); return false; }
  Serial.printf_P(PSTR("[OTA] pile courante=%u o (besoin %lu ; filigrane haut %u)\n"), (unsigned)cont, (unsigned long)POD_OTA_MIN_CONT_STACK, (unsigned)hwm);
  const time_t now = podotatls::clockNow(POD_OTA_NTP_TIMEOUT_MS);
  if (!now) { Serial.println(F("[OTA] horloge SNTP indisponible ou antérieure au plancher — OTA REFUSÉE (échec fermé)")); return false; }
  if (!podota::ticketFresh(g_ann.exp, (uint32_t)now)) { Serial.printf_P(PSTR("[OTA] défi expiré ou trop lointain (exp=%lu heure=%lu) — OTA REFUSÉE\n"), (unsigned long)g_ann.exp, (unsigned long)now); return false; }
  char msg[podota::FETCH_MSG_MAX + 1]; uint8_t sig[64];
  const size_t n = podota::fetchMessage(msg, sizeof msg, podOtaDeviceId(), g_ann);
  bool ok = n > 0 && podOtaSignFetch(msg, n, sig);
  memset(msg, 0, sizeof msg);
  if (ok) ok = podota::fetchQuery(q, cap, podOtaDeviceId(), g_ann, sig) > 0;
  memset(sig, 0, sizeof sig);
  if (!ok) { Serial.println(F("[OTA] signature du défi impossible — OTA REFUSÉE (échec fermé)")); return false; }
  Serial.println(F("[OTA] billet de téléchargement signé (horloge SNTP valide, défi frais)"));
  return true;
}
#endif

enum Outcome : uint8_t { OUT_NONE = 0, OUT_REFUSED, OUT_FAILED, OUT_REBOOTING };

/**
 * Point d'appel SÛR (à appeler quand rien d'autre ne tient la mémoire : aucun TLS ouvert, aucun candidat de vote, aucune tâche d'observation en attente).
 * Sans annonce : retourne OUT_NONE immédiatement. Ne retourne PAS en cas de succès (redémarrage).
 */
static Outcome maybeRun() {
#if POD_OTA_CLIENT
  podota::backoffTick(&g_backoff, millis());                                // lève une pause arrivée à échéance (appelée à chaque passage du loop(), même sans annonce)
#endif
  if (!g_offerSet) return OUT_NONE;
  g_offerSet = false;                                                       // une annonce = au plus une tentative
#if POD_OTA_CLIENT
  if (!podota::backoffAllows(g_backoff, millis())) { Serial.printf_P(PSTR("[OTA] pause après %u échec(s)%s — aucun essai\n"), (unsigned)g_backoff.failures, g_backoff.halted ? " (arrêt jusqu'au redémarrage)" : ""); return OUT_REFUSED; }
  g_began = false;
#endif
  podota::OfferContext c = { POD_OTA_FAMILY, g_rec.installedSeq, (uint32_t)ESP.getFreeSketchSpace() };
  const podota::OfferVerdict ov = podota::checkOffer(g_offer, c);
  if (ov != podota::O_OK || !podota::recAllows(g_rec, g_offer.otaSeq)) { Serial.printf_P(PSTR("[OTA] annonce refusée : %s\n"), ov != podota::O_OK ? podota::offerName(ov) : "etat"); return OUT_REFUSED; }
  const uint32_t freeHeap = ESP.getFreeHeap(), maxBlock = ESP.getMaxFreeBlockSize();
  if (freeHeap < POD_OTA_MIN_HEAP || maxBlock < POD_OTA_MIN_BLOCK) {
    Serial.printf_P(PSTR("[OTA] mémoire insuffisante pour démarrer (tas=%u bloc=%u, minimum %lu/%lu) — reporté\n"), (unsigned)freeHeap, (unsigned)maxBlock, (unsigned long)POD_OTA_MIN_HEAP, (unsigned long)POD_OTA_MIN_BLOCK);
    return OUT_REFUSED;
  }
#if POD_OTA_CLIENT
  // Billet de téléchargement : heure SNTP, fraîcheur du défi, pile, signature du défi par la clé d'appareil. AUCUNE tentative n'est comptée si l'un de ces contrôles échoue (rien n'a été envoyé au serveur d'images).
  char fetchQ[podota::QUERY_MAX + 1];
  if (!prepareFetch(fetchQ, sizeof fetchQ, freeHeap)) return OUT_REFUSED;
#endif
#if POD_OTA_CLIENT
  // 1. (client) la tentative sera INSCRITE par onStart() au premier signe authentique, AVANT l'écriture de l'image : une annonce forgée n'écrit rien en EEPROM
#else
  // 1. la tentative est INSCRITE avant le téléchargement : une coupure pendant la copie laisse une trace
  if (!podota::recBeginAttempt(&g_rec, g_offer.otaSeq)) return OUT_REFUSED;
  save();
  Serial.printf_P(PSTR("[OTA] tentative seq=%u (n°%u) créneau=%c région=%u o | tas=%u bloc=%u\n"), (unsigned)g_offer.otaSeq, (unsigned)g_rec.attempts, g_offer.keySlot ? 'B' : 'A', (unsigned)g_offer.size, (unsigned)freeHeap, (unsigned)maxBlock);
#endif

  // 2. clé du créneau choisi : copie en RAM (la clé est en PROGMEM), analyse, copie libérée
  const char* pemP = g_offer.keySlot ? POD_OTA_KEY_B_PEM : POD_OTA_KEY_A_PEM;
  const size_t pemLen = strlen_P(pemP);
  char* pem = (char*)malloc(pemLen + 1);
  BearSSL::PublicKey* key = nullptr; Hash* hash = nullptr; Verifier* ver = nullptr;
  Outcome out = OUT_FAILED;
  if (pem) { memcpy_P(pem, pemP, pemLen + 1); key = new (std::nothrow) BearSSL::PublicKey(pem); free(pem); pem = nullptr; }
  if (key && key->isRSA()) { hash = new (std::nothrow) Hash(); }
  if (hash) {
    const podota::Expect e = { POD_OTA_FAMILY, g_offer.otaSeq, g_offer.size, g_rec.installedSeq };
    ver = new (std::nothrow) Verifier(key, hash, e);
  }
  if (!ver) {
    Serial.println(F("[OTA] vérificateur non installé (clé illisible ou mémoire) — OTA REFUSÉE (échec fermé)"));
  } else {
    Update.installSignature(hash, ver);
    ESPhttpUpdate.rebootOnUpdate(false);
    ESPhttpUpdate.setLedPin(-1);
#if POD_OTA_CLIENT
    g_minHeap = 0xFFFFFFFFu; g_minBlock = 0xFFFFFFFFu;
    ESPhttpUpdate.onProgress(onProgress);
    ESPhttpUpdate.onStart(onStart);
#endif
    t_httpUpdate_return r;
#if POD_OTA_CLIENT
    uint32_t blockArmed = 0;   // plus grand bloc libre APRÈS l'armement du client, relevé une seule fois (avant HTTPClient / URL)
#endif
    {   // TLS fermé à la sortie du bloc ; useHTTP10 comme tous les GET du firmware
#ifdef POD_OTA_LAB_HTTP              // LABORATOIRE seulement (sonde OTA-4B, serveur HTTP local) : même code de vérification, transport en clair. Non défini dans le firmware PoD.
      WiFiClient client;
#elif POD_OTA_CLIENT
      OTA_MEM("avant ancres");
      podotatls::Anchors anchors;                                   // vit plus longtemps que le client (détruit après lui) ; ≈ 4,6 Ko de tas mesurés (deux racines)
      OTA_MEM("apres ancres");
      WiFiClientSecure client;                                      // le constructeur prend la pile de poussée BearSSL (≈ 6,5 Ko contigus)
      podotatls::arm(client, anchors, time(nullptr));               // racines épinglées + heure : JAMAIS setInsecure
      blockArmed = ESP.getMaxFreeBlockSize();
      OTA_MEM("client arme");
#else
      WiFiClientSecure client; client.setInsecure();
#endif
      HTTPClient http; http.useHTTP10(true); http.setTimeout(20000);
#if POD_OTA_CLIENT
      const String url = String(POD_OTA_BASE_URL) + g_offer.urlPath + fetchQ;       // la requête (défi + signature) n'est JAMAIS journalisée
      OTA_MEM("avant GET (HTTPClient + URL construits)");
      if (!anchors.ok() || blockArmed < POD_OTA_BLOCK_AFTER_ANCHORS) {
        Serial.printf_P(PSTR("[OTA] ancres de confiance ou mémoire insuffisantes (ancres=%u bloc=%u, minimum %lu : tas trop fragmenté pour le TLS) — OTA REFUSÉE (échec fermé)\n"), (unsigned)anchors.list()->getCount(), (unsigned)blockArmed, (unsigned long)POD_OTA_BLOCK_AFTER_ANCHORS);
        r = HTTP_UPDATE_FAILED;
      } else
#else
      const String url = String(POD_OTA_BASE_URL) + g_offer.urlPath;
#endif
      if (http.begin(client, url)) r = ESPhttpUpdate.update(http, String(FIRMWARE_VERSION)); else r = HTTP_UPDATE_FAILED;
      http.end();
#if POD_OTA_CLIENT && !defined(POD_OTA_LAB_HTTP)
      if (r != HTTP_UPDATE_OK) Serial.printf_P(PSTR("[OTA] TLS: erreur BearSSL=%d (heure=%lu) | tas=%u bloc=%u\n"), client.getLastSSLError(), (unsigned long)time(nullptr), (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxFreeBlockSize());
#endif
    }
    Update.installSignature(nullptr, nullptr);                              // plus aucun pointeur vers des objets sur le point d'être détruits
#if POD_OTA_CLIENT
    Serial.printf_P(PSTR("[OTA] mesure : tas min=%u bloc min=%u pendant le téléchargement (début: tas=%u bloc=%u)\n"), (unsigned)g_minHeap, (unsigned)g_minBlock, (unsigned)freeHeap, (unsigned)maxBlock);
#endif
    if (r == HTTP_UPDATE_OK) {
      Serial.println(F("[OTA] image vérifiée et mise en attente — redémarrage"));
      Serial.flush(); delay(500); ESP.restart();
      out = OUT_REBOOTING;
    } else {
      Serial.printf_P(PSTR("[OTA] ÉCHEC code=%d : %s | signature=%s trailer=%s — firmware courant INTACT\n"), ESPhttpUpdate.getLastError(), ESPhttpUpdate.getLastErrorString().c_str(),
                      ver->sigOk ? "ok" : "refusée", podota::verdictName(ver->verdict));
    }
  }
  delete ver; delete hash; delete key;
#if POD_OTA_CLIENT
  if (out != OUT_REBOOTING) {
    const int code = ESPhttpUpdate.getLastError();
    const bool wasBegun = g_began;
    const uint8_t before = g_rec.attempts;
    if (podota::afterFailedDownload(&g_rec, &g_backoff, g_began, code, millis())) save();
    Serial.printf_P(PSTR("[OTA] échec %s (code=%d) : %s | pause après %u échec(s)%s\n"), wasBegun ? "après réponse du serveur" : "AVANT toute réponse authentique", code,
                    !wasBegun ? "aucune tentative comptée, aucune écriture EEPROM" : (g_rec.attempts < before ? "tentative REMBOURSÉE (transport)" : "tentative COMPTÉE (contenu)"),
                    (unsigned)g_backoff.failures, g_backoff.halted ? ", arrêt jusqu'au redémarrage" : "");
  }
#else
  if (out != OUT_REBOOTING) { podota::recEndAttemptNoReboot(&g_rec, podota::R_NONE); save(); }
#endif
  return out;
}

}  // namespace podotaesp
