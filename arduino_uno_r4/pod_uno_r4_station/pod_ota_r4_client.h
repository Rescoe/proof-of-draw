// pod_ota_r4_client.h — CLIENT OTA R4-B pour UNO R4 WiFi (ADR OTA-5, 26/10/2026) : manifeste SIGNÉ (Ed25519) -> binaire BRUT -> staging NON APPROUVÉ (SPIFFS du module) -> SHA-256 -> relecture -> ticket
// -> ota.update(chemin) (le module reprogramme le RA4M1 par BOSSA) -> au démarrage suivant, séquence anti-rejeu écrite en data flash (blocs 2 et 3).
// ⚠ COMPILÉ + validé en laboratoire sur UNE carte (S1/S2 du 26/10/2026 : staging, 40 cas négatifs). Option POD_OTA_R4 = 0 par défaut : à 0, aucun octet de ce fichier n'est compilé.
// Dépend du croquis hôte : logf(), PodNet/podWifiRun (podNetStack.h), PodEd (podEdStack.h), podotar4 (podOtaR4.h), et les macros OTAR4_* définies AVANT l'inclusion.
//
// Piles (pile principale du cœur R4 = 1 024 o) : TLS + écriture +FS dans UNE transaction sur la pile réseau agrandie (OTAR4_NET_STACK, 3 072 o ; marge 2 212 o mesurée sur carte) ; relecture du staging et appels
// au module sur podWifiRun ; Ed25519 sur PodEd. Aucun appel au module Wi-Fi hors d'une pile dédiée. Jamais imbriqué.
// Règles de sécurité : le transport n'est pas une preuve (TLS sans vérification de certificat) — la preuve est la signature du manifeste + le SHA-256 du binaire complet ; clés de TEST du dépôt = zéros (REFUSÉES) ;
// ota.update(chemin) n'est appelé qu'APRÈS consommation du ticket, port USB fermé, et jamais si le port série d'un hôte est ouvert (la programmation échoue 3/3 dans ce cas : OTA-3).
#pragma once
#include <Arduino.h>
#include <WiFiS3.h>
#include <WiFiFileSystem.h>
#include <OTAUpdate.h>
#include <EEPROM.h>
#include <SHA256.h>
#include "podEdStack.h"
#include "podOtaR4.h"

#ifndef OTAR4_FAMILY
#error "OTAR4_FAMILY non défini (uno-r4-wifi-tft28 | uno-r4-wifi-tft18 | uno-r4-wifi-sensor)"
#endif
#ifndef OTAR4_CHANNEL
#define OTAR4_CHANNEL "canary"            // un appareil de la flotte compile "stable" ; les bancs "canary"
#endif
#ifndef OTAR4_TLS
#define OTAR4_TLS 1                       // 0 = HTTP clair vers un serveur de laboratoire sur le réseau local (jamais en production)
#endif
#ifndef OTAR4_NET_STACK
#define OTAR4_NET_STACK 3072u
#endif
#ifndef OTAR4_PATH
#define OTAR4_PATH "/update.bin"
#endif
#ifndef OTAR4_CHECK_FIRST_MS
#define OTAR4_CHECK_FIRST_MS 90000UL      // première vérification 90 s après le démarrage (Wi-Fi + enregistrement faits)
#endif
#ifndef OTAR4_CHECK_EVERY_MS
#define OTAR4_CHECK_EVERY_MS 21600000UL   // puis toutes les 6 h : 1 requête TLS vers un fichier statique du CDN, 0 commande Redis
#endif
#ifndef OTAR4_RETRY_MS
#define OTAR4_RETRY_MS 1800000UL          // après un échec réseau ou de staging : 30 min
#endif
#if OTAR4_TLS
typedef PodBoundedSSL OtaR4Conn;
#else
typedef WiFiClient OtaR4Conn;
#endif

extern "C" char* sbrk(int incr);
extern char __HeapLimit;

namespace otar4 {
using namespace podotar4;

enum Result : uint8_t { R_IDLE = 0, R_NO_UPDATE, R_REFUSED, R_NET_FAIL, R_STAGE_FAIL, R_DEFERRED_HOST, R_PROGRAMMING, R_ERROR };
static const char* resultName(Result r) {
  switch (r) { case R_IDLE: return "idle"; case R_NO_UPDATE: return "aucune mise à jour"; case R_REFUSED: return "manifeste refusé"; case R_NET_FAIL: return "réseau";
    case R_STAGE_FAIL: return "staging"; case R_DEFERRED_HOST: return "différée (port série ouvert)"; case R_PROGRAMMING: return "programmation lancée"; default: return "erreur"; }
}

static uint8_t g_pub[2][32];          // r4-a, r4-b (clés publiques de PUBLICATION, compilées)
static bool g_pubSet[2] = {false, false};
static uint8_t g_manifestRaw[MAX_MANIFEST + 1]; static uint16_t g_manifestLen = 0;
static uint8_t g_work[WORK_BYTES];
static Manifest g_man;
static uint8_t g_rx[256]; static char g_hdr[96];
static uint8_t g_blk[FLASH_BLOCK];
static SHA256 g_sha; static Session g_sess; static WiFiFileSystem g_fs;
static bool g_mounted = false;
static const char* g_host = ""; static uint16_t g_port = 443; static const char* g_base = "";
static uint8_t g_lastWhy = 0;
static OTAUpdate g_ota;

// ── adaptateurs ─────────────────────────────────────────────────────────────────────────────────
static void shaBegin(void* c) { static_cast<SHA256*>(c)->reset(); }
static void shaUpdate(void* c, const uint8_t* d, size_t n) { static_cast<SHA256*>(c)->update(d, n); }
static void shaEnd(void* c, uint8_t out[32]) { static_cast<SHA256*>(c)->finalize(out, 32); }
static bool stWrite(void*, uint32_t off, const uint8_t* d, size_t n) { return g_fs.writefile(OTAR4_PATH, (const char*)d, n, off == 0 ? WIFI_FILE_WRITE : WIFI_FILE_APPEND) == n; }
static bool stRead(void*, uint32_t off, uint8_t* d, size_t n) {
  std::string res; modem.avoid_trim_results(); modem.read_using_size();
  if (!modem.write(DO_NOT_CHECK_CMD, res, "%s%d,%d,%s,%lu,%d\r\n", CMD_WRITE(_FILESYSTEM), 0, WIFI_FILE_READ, OTAR4_PATH, (unsigned long)off, (int)n)) return false;
  if (res.size() != n) return false;
  memcpy(d, res.data(), n); return true;
}
static void stRemove(void*) { g_fs.writefile(OTAR4_PATH, "", 0, WIFI_FILE_DELETE); }
static bool edVerify(void*, const uint8_t pub[32], const uint8_t* msg, size_t n, const uint8_t sig[64]) { PodEdInfo i; return PodEd::verify(sig, pub, msg, n, &i) && i.err == POD_ED_OK; }

// Data flash : blocs 2 (0x800) et 3 (0xC00) de 1 Ko ; jamais le bloc 0 (clés, hash de bloc) ni 5-6 (verrou de vote du TFT 2,8″) ni 7 (journal de canari).
// ÉCRITURE = UN effacement du bloc visé + UN programme de 24 octets (enregistrement de 20 o) : jamais EEPROM.update octet par octet (1 Ko de tas et un effacement par appel).
// Le cœur 1.6.0 : read/erase/program ouvrent et referment eux-mêmes le périphérique SEULEMENT s'il est fermé ; ouvert (EEPROM, instrument), read renvoie une erreur parasite et erase ne fait RIEN. On le ferme donc d'abord (sans effet s'il est déjà fermé).
static DataFlashBlockDevice& df() { DataFlashBlockDevice& d = DataFlashBlockDevice::getInstance(); d.deinit(); return d; }
static bool flRead(void*, uint8_t blk, uint8_t* out) { return df().read(out, (bd_addr_t)blk * FLASH_BLOCK, FLASH_BLOCK) == 0; }
static bool flWrite(void*, uint8_t blk, const uint8_t* in) {
  DataFlashBlockDevice& d = df(); const bd_addr_t a = (bd_addr_t)blk * FLASH_BLOCK;
  if (blk != SEQ_BLOCK_A && blk != SEQ_BLOCK_B) return false;                          // garde : seuls les blocs 2 et 3
  if (d.erase(a, FLASH_BLOCK) != 0) return false;
  return d.program(in, a, 24) == 0;
}
static Flash flash() { return Flash{flRead, flWrite, nullptr}; }

/** Séquence effective (max(compilée, enregistrements)). OTA refusée (ok=false) si les deux blocs sont non vierges ET invalides. */
static SeqState seqState() { return seqLoad(flash(), (uint32_t)OTAR4_COMPILED_SEQ, g_blk); }

/** Diagnostic de banc : 32 premiers octets des blocs 0 à 7 de la data flash (les blocs 2 et 3 doivent être vierges, 0xFF, ou porter un enregistrement OTS1 valide). */
static void dumpBlocks() {
  for (uint8_t b = 0; b < 8; b++) { if (!flRead(nullptr, b, g_blk)) { logf("[OTA] bloc %u : lecture impossible", (unsigned)b); continue; } char h[100]; for (uint8_t i = 0; i < 24; i++) snprintf(h + 2 * i, 3, "%02x", g_blk[i]); uint32_t sq = 0, gn = 0; const RecKind k = classify(g_blk, sq, gn); logf("[OTA] bloc %u : %s | %s seq=%lu", (unsigned)b, h, k == R_VIRGIN ? "vierge" : (k == R_VALID ? "valide" : "INVALIDE"), (unsigned long)sq); }
}

/** À appeler quand la NOUVELLE image a démarré et fonctionne (Wi-Fi + enregistrement) : inscrit la séquence compilée si elle dépasse celle des enregistrements. Idempotent. */
static void confirmBoot() {
  const SeqState r = seqLoad(flash(), 0, g_blk);                              // enregistrements SEULS (compiledSeq = 0)
  if (!r.ok) { logf("[OTA] séquence : deux blocs invalides -> OTA REFUSÉE (récupération par câble)"); return; }
  if ((uint32_t)OTAR4_COMPILED_SEQ <= r.seq) return;                          // déjà couverte (ou image plus ANCIENNE flashée par câble : ne jamais baisser)
  const bool ok = seqCommit(flash(), 0, (uint32_t)OTAR4_COMPILED_SEQ, g_blk);
  logf("[OTA] séquence %lu inscrite en data flash : %s", (unsigned long)OTAR4_COMPILED_SEQ, ok ? "OK" : "ÉCHEC (non fatal)");
}

// ── GET borné : tout dans UNE transaction sur la pile réseau agrandie ; Content-Length OBLIGATOIRE ; Transfer-Encoding refusé ──
struct GetJob { const char* path; bool (*onLen)(int64_t); bool (*onData)(const uint8_t*, size_t); int status; int64_t clen; uint32_t got; bool ok; };
static bool readLine(OtaR4Conn& c, char* out, size_t cap) {
  size_t n = 0; uint32_t t0 = millis();
  while (millis() - t0 < 15000) {
    if (!c.connected() && !c.available()) return false;
    if (!c.available()) { delay(5); continue; }
    int b = c.read(); if (b < 0) continue; if (b == '\r') continue; if (b == '\n') { out[n] = 0; return true; }
    if (n + 1 < cap) out[n++] = (char)b; else return false;
  }
  return false;
}
static bool startsWithNoCase(const char* s, const char* p) { while (*p) { char a = *s++, b = *p++; if (a >= 'A' && a <= 'Z') a += 32; if (a != b) return false; } return true; }
static void getFn(void* p) {
  GetJob* j = static_cast<GetJob*>(p); j->status = -1; j->clen = -1; j->got = 0; j->ok = false;
  OtaR4Conn c;
  if (!c.connect(g_host, g_port)) { j->status = -2; return; }
  c.print("GET "); c.print(g_base); c.print(j->path); c.print(" HTTP/1.0\r\nHost: "); c.print(g_host); c.print("\r\nUser-Agent: pod-r4-ota\r\nConnection: close\r\n\r\n");
  if (!readLine(c, g_hdr, sizeof g_hdr)) { j->status = -3; c.stop(); return; }
  if (strncmp(g_hdr, "HTTP/1.", 7) != 0 || g_hdr[8] != ' ') { j->status = -3; c.stop(); return; }
  j->status = atoi(g_hdr + 9);
  bool chunked = false;
  for (;;) {
    if (!readLine(c, g_hdr, sizeof g_hdr)) { j->status = -3; c.stop(); return; }
    if (!g_hdr[0]) break;
    if (startsWithNoCase(g_hdr, "content-length:")) { const char* v = g_hdr + 15; while (*v == ' ') v++; int64_t n = 0; bool d = false; while (*v >= '0' && *v <= '9') { n = n * 10 + (*v - '0'); d = true; v++; if (n > 0x7FFFFFF) break; } j->clen = d ? n : -1; }
    else if (startsWithNoCase(g_hdr, "transfer-encoding:")) chunked = true;
  }
  if (j->status != 200 || chunked) { c.stop(); if (chunked) j->status = -4; return; }
  if (!j->onLen(j->clen)) { c.stop(); return; }
  uint32_t t0 = millis();
  while ((int64_t)j->got < j->clen && millis() - t0 < 30000) {
    if (!c.connected() && !c.available()) break;
    int n = c.available() ? c.read(g_rx, sizeof g_rx) : 0;
    if (n <= 0) { delay(5); continue; }
    t0 = millis();
    if (!j->onData(g_rx, (size_t)n)) { c.stop(); return; }
    j->got += (uint32_t)n;
  }
  c.stop(); j->ok = (int64_t)j->got == j->clen;
}
static bool __attribute__((noinline)) httpGet(GetJob& j, PodNetInfo& ni) { return PodNet::runSized(getFn, &j, OTAR4_NET_STACK, &ni) && ni.err == POD_NET_OK; }

static bool manLen(int64_t n) { return n > 0 && n <= (int64_t)MAX_MANIFEST; }
static bool manData(const uint8_t* d, size_t n) { if (g_manifestLen + n > MAX_MANIFEST) return false; memcpy(g_manifestRaw + g_manifestLen, d, n); g_manifestLen = (uint16_t)(g_manifestLen + n); return true; }
static bool binLen(int64_t n) { return podotar4::begin(g_sess, g_man, n); }
static bool binData(const uint8_t* d, size_t n) { return podotar4::feed(g_sess, d, n); }

static bool __attribute__((noinline)) mountFs() {
  PodNetInfo ni; bool ok = false; auto f = [&]() { std::string res; ok = modem.write(std::string(PROMPT(_MOUNTFS)), res, "%s%d\r\n", CMD_WRITE(_MOUNTFS), 0); };
  const bool ran = podWifiRun(f, &ni);
  g_mounted = ran && ok; return g_mounted;
}
static bool __attribute__((noinline)) readbackOnWifiStack() {
  PodNetInfo ni; bool ok = false; auto f = [&]() { ok = podotar4::readback(g_sess); };
  const bool ran = podWifiRun(f, &ni);
  if (!ran) { podotar4::fail(g_sess, E_STAGE_READ); return false; }
  return ok;
}
static bool __attribute__((noinline)) removeStaging() { PodNetInfo ni; auto f = [&]() { if (!g_mounted) { std::string res; modem.write(std::string(PROMPT(_MOUNTFS)), res, "%s%d\r\n", CMD_WRITE(_MOUNTFS), 0); g_mounted = true; } stRemove(nullptr); }; return podWifiRun(f, &ni); }

/** Appel du module : reprogrammation du RA4M1 depuis le fichier de staging. NE REVIENT PAS si elle a lieu (la carte redémarre sur la nouvelle image). */
static int __attribute__((noinline)) programCall() { int r = -99; PodNetInfo ni; auto f = [&]() { r = g_ota.update(OTAR4_PATH); }; const bool ran = podWifiRun(f, &ni); return ran ? r : -98; }

#ifndef OTAR4_PRE_UPDATE_MS
#define OTAR4_PRE_UPDATE_MS 0
#endif
#ifndef OTAR4_ALLOW_HOST
#define OTAR4_ALLOW_HOST 0                // 1 = BANC SEULEMENT : programmer même si un hôte USB a le port ouvert (le banc ferme le port à la ligne « ota.update »)
#endif
static bool hostConnected() { return OTAR4_ALLOW_HOST ? false : (bool)Serial; }          // USB CDC ouvert par un hôte (DTR) : BOSSA échoue dans ce cas (OTA-3)

static void setServer(const char* host, uint16_t port, const char* base) { g_host = host; g_port = port; g_base = base; }

static void loadKeys() {
#ifdef OTAR4_PUB_A_HEX
  static const char* const ha = OTAR4_PUB_A_HEX;
  g_pubSet[0] = (strlen(ha) == 64) && hexN((const uint8_t*)ha, 64, g_pub[0]);
#endif
#ifdef OTAR4_PUB_B_HEX
  static const char* const hb = OTAR4_PUB_B_HEX;
  g_pubSet[1] = (strlen(hb) == 64) && hexN((const uint8_t*)hb, 64, g_pub[1]);
#endif
}

/** Une passe complète. true dans `staged` si un ticket a été émis. N'appelle la programmation que si `allowProgram`. */
static Result checkOnce(bool allowProgram, bool dryRun = false) {
  loadKeys();
  if (!g_pubSet[0] && !g_pubSet[1]) { logf("[OTA] aucune clé publique de publication compilée : OTA INACTIVE (échec fermé)"); return R_REFUSED; }
  if (wifiStatus() != WL_CONNECTED) return R_NET_FAIL;
  g_manifestLen = 0; memset(&g_sess, 0, sizeof g_sess);
  PodNetInfo ni;
  GetJob j = { "/manifest.txt", manLen, manData, 0, 0, 0, false };
  if (!httpGet(j, ni) || !j.ok) {
    if (j.status == 404) { logf("[OTA] aucun manifeste publié (404) : rien à faire"); return R_NO_UPDATE; }
    logf("[OTA] manifeste : téléchargement impossible (statut %d, Content-Length %ld, reçu %lu, pile %u)", j.status, (long)j.clen, (unsigned long)j.got, (unsigned)ni.err); return R_NET_FAIL;
  }
  const SeqState sq = seqState();
  if (!sq.ok) { logf("[OTA] séquence anti-rejeu : deux blocs invalides -> OTA REFUSÉE (récupération par câble)"); return R_REFUSED; }
  const Keys keys = {{g_pubSet[0] ? g_pub[0] : nullptr, g_pubSet[1] ? g_pub[1] : nullptr}};
  const Device dev = {OTAR4_FAMILY, sq.seq, OTAR4_CHANNEL, 0};           // now = 0 : la carte n'a pas d'horloge fiable -> toute activation différée est refusée (échec fermé)
  const Verifier ver = {edVerify, nullptr};
  const Why w = evaluate(g_manifestRaw, g_manifestLen, keys, dev, ver, g_work, g_man);
  g_lastWhy = (uint8_t)w;
  if (w == W_NOT_NEWER) { logf("[OTA] à jour (séquence installée %lu)", (unsigned long)sq.seq); return R_NO_UPDATE; }
  if (w != W_OK) { logf("[OTA] manifeste REFUSÉ : %s", whyName(w)); return R_REFUSED; }
  logf("[OTA] mise à jour disponible : %s seq %lu (%lu o, canal %s, clé %s) ; installée %lu", g_man.firmware, (unsigned long)g_man.seq, (unsigned long)g_man.size, g_man.channel, g_man.keyid, (unsigned long)sq.seq);
  if (dryRun) return R_NO_UPDATE;
  if (!g_mounted && !mountFs()) { logf("[OTA] montage du système de fichiers du module impossible"); return R_STAGE_FAIL; }
  podotar4::init(g_sess, Sha{shaBegin, shaUpdate, shaEnd, &g_sha}, Stage{stWrite, stRead, stRemove, nullptr});
  GetJob b = { "/firmware.bin", binLen, binData, 0, 0, 0, false };
  const uint32_t t0 = millis();
  const bool net = httpGet(b, ni);
  logf("[OTA] binaire : statut %d, Content-Length %ld, reçu %lu en %lu ms (pile %u/%u o, marge %u)", b.status, (long)b.clen, (unsigned long)b.got, (unsigned long)(millis() - t0), (unsigned)ni.used, (unsigned)OTAR4_NET_STACK, (unsigned)ni.margin);
  if (!net || !b.ok || g_sess.st != S_DOWNLOADING) { if (g_sess.st != S_FAILED) podotar4::fail(g_sess, E_STATE); removeStaging(); logf("[OTA] téléchargement refusé : staging supprimé"); return R_NET_FAIL; }
  if (!podotar4::finish(g_sess)) { removeStaging(); logf("[OTA] taille ou SHA-256 du téléchargement différent du manifeste signé : staging supprimé"); return R_STAGE_FAIL; }
  if (!readbackOnWifiStack()) { removeStaging(); logf("[OTA] relecture du staging refusée (erreur %u) : staging supprimé", (unsigned)g_sess.err); return R_STAGE_FAIL; }
  logf("[OTA] TICKET PRÊT : image %s seq %lu relue et conforme", g_man.firmware, (unsigned long)g_man.seq);
  if (!allowProgram) return R_NO_UPDATE;
  if (hostConnected()) { logf("[OTA] programmation DIFFÉRÉE : un hôte USB a le port série ouvert (BOSSA échoue dans ce cas). Fermer le moniteur série ou débrancher le PC."); return R_DEFERRED_HOST; }
  if (!podotar4::consume(g_sess)) { removeStaging(); return R_ERROR; }
  logf("[OTA] ota.update(%s) : le module reprogramme le RA4M1 (≈ 50 s) ; la carte redémarrera sur %s", OTAR4_PATH, g_man.firmware); Serial.flush();
#if OTAR4_PRE_UPDATE_MS > 0
  delay(OTAR4_PRE_UPDATE_MS);                                  // BANC : laisse à l'hôte le temps de FERMER le port série avant que le module ne prenne la main
#endif
  const int r = programCall();
  logf("[OTA] ota.update est REVENU (inattendu si la reprogrammation a eu lieu) = %d", r);   // atteint seulement en cas d'échec
  removeStaging();
  return R_ERROR;
}

}  // namespace otar4
