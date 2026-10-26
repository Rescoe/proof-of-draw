// ota5_r4b_probe — LOT OTA-5 (R4-B, prototype de laboratoire, UNO R4 WiFi) : manifeste SIGNÉ -> binaire BRUT -> staging NON APPROUVÉ (SPIFFS du module, blocs de 200 o) -> SHA-256 -> relecture -> ticket.   ⚠ NE PAS DÉPLOYER.
// ⚠ COMPILÉ SEULEMENT : jamais flashé, jamais exécuté sur une carte. AUCUNE PROGRAMMATION : ce croquis n'appelle ni OTAUpdate.download(), ni ota.update(), ni ota.begin(), ni aucune fonction de OTAUpdate (testé : tests/otaR4Core.test.ts).
// Le binaire téléchargé est placé dans une zone de staging non approuvée ; il ne devient flashable qu'après validation de la signature du manifeste, du hash complet et de la relecture. Le « ticket » est émis, jamais consommé ici.
// Commandes (115200, fin de ligne « Nouvelle ligne ») : ? aide | i info | w Wi-Fi | s <hôte>[:port] serveur | p <hex64> clé publique r4-a de TEST | m manifeste (GET /manifest.txt + vérification) | d binaire (GET /firmware.bin -> staging -> hash -> relecture) | q séquence anti-rejeu (lecture) | x supprimer le staging.
// Piles (R4 : pile principale = 1 024 o) : TLS + écriture +FS sur une pile réseau agrandie (OTA5_NET_STACK = 3 072 o, à MESURER) ; relecture du staging et hachage sur podWifiRun (1 536 o) ; Ed25519 sur PodEd ; journal sur la pile de journal.
// Aucun appel au module Wi-Fi hors d'une pile dédiée. OTA5_TLS = 1 (défaut) : PodBoundedSSL (port 443) ; 0 : WiFiClient en clair (serveur de laboratoire ota-lab/r4-ota5/tools/serve.mjs, HTTP).
#include <Arduino.h>
#include <stdarg.h>
#include <malloc.h>
#include <WiFiS3.h>
#include <WiFiFileSystem.h>
#include <EEPROM.h>
#include <SHA256.h>
#include "podNetStack.h"
#include "podEdStack.h"
#include "podOtaR4.h"
#include "secrets.h"
#ifndef OTA5_TLS
#define OTA5_TLS 1
#endif
#if OTA5_TLS
#include "pod_ssl_bounded.h"
typedef PodBoundedSSL OtaConn;
#else
typedef WiFiClient OtaConn;
#endif
#ifndef OTA5_NET_STACK
#define OTA5_NET_STACK 3072u         // TLS (1 172 o mesurés) + écriture +FS (module) dans la même transaction ; marge à MESURER (objectif 256 o, plancher 128 o)
#endif
#define OTA5_PATH "/update.bin"
#define OTA5_VERSION "ota5-r4b-lab-1"
#define OTA5_FAMILY "uno-r4-wifi-tft28"
#define OTA5_CHANNEL "canary"
#define OTA5_COMPILED_SEQ 5u         // séquence « compilée » du firmware qui tourne (le canari OTA-3 est en seq 5 dans les vecteurs)

extern "C" char* sbrk(int incr);
extern char __StackLimit, __HeapLimit;
using namespace podotar4;

static char g_host[48] = ""; static uint16_t g_port = OTA5_TLS ? 443 : 8081;
static bool g_stop = false; static int g_mountOk = -1;
static uint16_t g_worstUsed = 0, g_worstMargin = 0xFFFF;
static uint8_t g_pubA[32]; static bool g_pubSet = false;
static uint8_t g_manifestRaw[MAX_MANIFEST + 1]; static uint16_t g_manifestLen = 0; static uint8_t g_work[WORK_BYTES]; static Manifest g_man; static bool g_manOk = false;
static uint8_t g_rx[256]; static char g_hdr[96]; static uint8_t g_blk[FLASH_BLOCK];
static SHA256 g_sha; static Session g_sess; static WiFiFileSystem g_fs;
static char g_line[96]; static uint8_t g_len = 0;

// ── journal sur pile dédiée (identique à la sonde OTA-3) ──
struct LogJob { const char* fmt; va_list* ap; };
static void logEmit(void* p) { static char b[256]; LogJob* j = static_cast<LogJob*>(p); vsnprintf(b, sizeof(b), j->fmt, *j->ap); Serial.println(b); }
static void logf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
static void logf(const char* fmt, ...) {
  va_list ap; va_start(ap, fmt); LogJob j = { fmt, &ap };
  if (podNetOnMainStack()) { PodNetInfo li; PodNet::runSized(logEmit, &j, POD_LOG_STACK_TOTAL, &li); if (li.err == POD_NET_GUARD) { for (;;) { __asm volatile("nop"); } } }
  else logEmit(&j);
  va_end(ap);
}
static unsigned long heapFree() { struct mallinfo mi = mallinfo(); return (unsigned long)mi.fordblks + (unsigned long)((char*)&__HeapLimit - (char*)sbrk(0)); }
static void say(const char* s) { logf("[OTA5] %s", s); }
static void __attribute__((noinline)) rep(const char* tag, const PodNetInfo& ni, bool ran) {
  if (ni.used > g_worstUsed) g_worstUsed = ni.used;
  if (ran && ni.margin < g_worstMargin) g_worstMargin = ni.margin;
  logf("[OTA5] pile %s : %s, utilisé %u o, marge %u o, erreur %u%s", tag, ran ? "exécuté" : "NON exécuté/rejeté", (unsigned)ni.used, (unsigned)ni.margin, (unsigned)ni.err, ni.low ? "  SOUS L'OBJECTIF 256" : "");
  if (ni.err == POD_NET_GUARD) { g_stop = true; say("STOP : garde écrasée (débordement réel)"); }
}

// ── Wi-Fi : chaque appel au module sur la pile dédiée ──
static void __attribute__((noinline)) wifiBeginCall() { PodNetInfo ni; auto f = [&]() { WiFi.begin(SECRET_WIFI_SSID, SECRET_WIFI_PASSWORD); }; const bool ran = podWifiRun(f, &ni); rep("WiFi.begin", ni, ran); }
static uint8_t __attribute__((noinline)) wifiStatusCall() { uint8_t st = 0xFE; PodNetInfo ni; auto f = [&]() { st = (uint8_t)WiFi.status(); }; const bool ran = podWifiRun(f, &ni); if (!ran) rep("WiFi.status", ni, ran); return ran ? st : (uint8_t)0xFE; }
static uint32_t __attribute__((noinline)) wifiIp() { uint32_t v = 0; PodNetInfo ni; auto f = [&]() { IPAddress ip = WiFi.localIP(); v = (uint32_t)ip; }; const bool ran = podWifiRun(f, &ni); if (!ran) rep("WiFi.localIP", ni, ran); return ran ? v : 0; }
static void cmdWifi() {
  say("Wi-Fi : connexion (secrets.h)…"); wifiBeginCall();
  for (int i = 0; i < 40 && !g_stop; i++) { delay(500); if (wifiStatusCall() == WL_CONNECTED && wifiIp() != 0) break; }
  logf("[OTA5] Wi-Fi %s", wifiStatusCall() == WL_CONNECTED ? "CONNECTÉ" : "NON connecté");
}

// ── adaptateurs du noyau : SHA-256 (Crypto), staging dans le module (+FS), vérificateur Ed25519 (PodEd), data flash en LECTURE ──
static void shaBegin(void* c) { static_cast<SHA256*>(c)->reset(); }
static void shaUpdate(void* c, const uint8_t* d, size_t n) { static_cast<SHA256*>(c)->update(d, n); }
static void shaEnd(void* c, uint8_t out[32]) { static_cast<SHA256*>(c)->finalize(out, 32); }
// Appelés DEPUIS une pile dédiée (feed : pile réseau pendant la lecture TLS ; readback : podWifiRun) — jamais depuis la pile principale, jamais imbriqués dans un autre appel au module.
static bool stWrite(void*, uint32_t off, const uint8_t* d, size_t n) { return g_fs.writefile(OTA5_PATH, (const char*)d, n, off == 0 ? WIFI_FILE_WRITE : WIFI_FILE_APPEND) == n; }
static bool stRead(void*, uint32_t off, uint8_t* d, size_t n) {
  std::string res; modem.avoid_trim_results(); modem.read_using_size();
  if (!modem.write(DO_NOT_CHECK_CMD, res, "%s%d,%d,%s,%lu,%d\r\n", CMD_WRITE(_FILESYSTEM), 0, WIFI_FILE_READ, OTA5_PATH, (unsigned long)off, (int)n)) return false;
  if (res.size() != n) return false;                       // exactement les octets demandés, sinon échec fermé
  memcpy(d, res.data(), n); return true;
}
static void stRemove(void*) { g_fs.writefile(OTA5_PATH, "", 0, WIFI_FILE_DELETE); }
static bool edVerify(void*, const uint8_t pub[32], const uint8_t* msg, size_t n, const uint8_t sig[64]) { PodEdInfo i; return PodEd::verify(sig, pub, msg, n, &i) && i.err == POD_ED_OK; }
static bool flRead(void*, uint8_t blk, uint8_t* out) { for (uint16_t i = 0; i < FLASH_BLOCK; i++) out[i] = (uint8_t)EEPROM.read((int)blk * FLASH_BLOCK + i); return true; }
static bool flWrite(void*, uint8_t, const uint8_t*) { return false; }   // LOT SANS PROGRAMMATION : l'écriture de la séquence n'est PAS câblée (à décider au lot matériel : un seul effacement de bloc, pas EEPROM.update octet par octet)

static void __attribute__((noinline)) mountFs() {
  PodNetInfo ni; bool ok = false; auto f = [&]() { std::string res; ok = modem.write(std::string(PROMPT(_MOUNTFS)), res, "%s%d\r\n", CMD_WRITE(_MOUNTFS), 0); };
  const bool ran = podWifiRun(f, &ni); rep("mount SPIFFS", ni, ran); g_mountOk = (ran && ok) ? 1 : 0; logf("[OTA5] montage SPIFFS (sans formatage) : %s", g_mountOk ? "OK" : "ÉCHEC");
}

// ── GET borné : tout se passe dans UNE transaction sur la pile réseau agrandie ; Content-Length OBLIGATOIRE ; Transfer-Encoding refusé ──
struct GetJob { const char* path; bool (*onLen)(int64_t); bool (*onData)(const uint8_t*, size_t); int status; int64_t clen; uint32_t got; bool ok; };
static bool readLine(OtaConn& c, char* out, size_t cap) {
  size_t n = 0; uint32_t t0 = millis();
  while (millis() - t0 < 15000) {
    if (!c.connected() && !c.available()) return false;
    if (!c.available()) { delay(5); continue; }
    int b = c.read(); if (b < 0) continue; if (b == '\r') continue; if (b == '\n') { out[n] = 0; return true; }
    if (n + 1 < cap) out[n++] = (char)b; else return false;     // ligne trop longue : refus
  }
  return false;
}
static bool startsWithNoCase(const char* s, const char* p) { while (*p) { char a = *s++, b = *p++; if (a >= 'A' && a <= 'Z') a += 32; if (a != b) return false; } return true; }
static void getFn(void* p) {
  GetJob* j = static_cast<GetJob*>(p); j->status = -1; j->clen = -1; j->got = 0; j->ok = false;
  OtaConn c;
  if (!c.connect(g_host, g_port)) { j->status = -2; return; }
  c.print("GET "); c.print(j->path); c.print(" HTTP/1.0\r\nHost: "); c.print(g_host); c.print("\r\nConnection: close\r\n\r\n");
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
  if (!j->onLen(j->clen)) { c.stop(); return; }                // Content-Length absent ou différent de la taille signée : REFUSÉ avant le premier octet
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
static bool __attribute__((noinline)) httpGet(GetJob& j) { PodNetInfo ni; const bool ran = PodNet::runSized(getFn, &j, OTA5_NET_STACK, &ni); rep("GET (TLS + +FS)", ni, ran); return ran && ni.err == POD_NET_OK; }

// ── manifeste ──
static bool manLen(int64_t n) { return n > 0 && n <= (int64_t)MAX_MANIFEST; }
static bool manData(const uint8_t* d, size_t n) { if (g_manifestLen + n > MAX_MANIFEST) return false; memcpy(g_manifestRaw + g_manifestLen, d, n); g_manifestLen = (uint16_t)(g_manifestLen + n); return true; }
static void cmdManifest() {
  g_manOk = false; g_manifestLen = 0; memset(&g_sess, 0, sizeof g_sess);
  if (!g_host[0] || wifiStatusCall() != WL_CONNECTED) { say("serveur ou Wi-Fi manquant (s, w)"); return; }
  if (!g_pubSet) { say("clé publique de test absente : p <hex64>"); return; }
  GetJob j = { "/manifest.txt", manLen, manData, 0, 0, 0, false };
  if (!httpGet(j) || !j.ok) { logf("[OTA5] manifeste : téléchargement refusé (statut %d, Content-Length %ld, reçu %lu)", j.status, (long)j.clen, (unsigned long)j.got); return; }
  // Vérification : ANALYSE puis Ed25519 (PodEd sur sa pile). « now » = 0 : la carte n'a pas d'horloge fiable -> toute activation différée est refusée (échec fermé).
  const SeqState sq = seqLoad({flRead, flWrite, nullptr}, OTA5_COMPILED_SEQ, g_blk);
  if (!sq.ok) { say("séquence anti-rejeu : deux blocs invalides -> OTA REFUSÉE (récupération par câble)"); return; }
  const Keys keys = {{g_pubA, nullptr}}; const Device dev = {OTA5_FAMILY, sq.seq, OTA5_CHANNEL, 0};
  const Verifier ver = {edVerify, nullptr};
  const Why w = evaluate(g_manifestRaw, g_manifestLen, keys, dev, ver, g_work, g_man);
  logf("[OTA5] manifeste : %s (seq installée %lu)", whyName(w), (unsigned long)sq.seq);
  if (w != W_OK) return;
  g_manOk = true; logf("[OTA5] ACCEPTÉ : firmware %s seq %lu taille %lu canal %s clé %s", g_man.firmware, (unsigned long)g_man.seq, (unsigned long)g_man.size, g_man.channel, g_man.keyid);
}

// ── binaire brut ──
static bool binLen(int64_t n) { return podotar4::begin(g_sess, g_man, n); }
static bool binData(const uint8_t* d, size_t n) { return podotar4::feed(g_sess, d, n); }
static void __attribute__((noinline)) readbackCall() {
  PodNetInfo ni; bool ok = false; auto f = [&]() { ok = podotar4::readback(g_sess); };
  const bool ran = podWifiRun(f, &ni); rep("relecture du staging", ni, ran);
  if (!ran) { podotar4::fail(g_sess, E_STAGE_READ); say("relecture non exécutée -> staging supprimé par fail() (si la pile le permet)"); }
  logf("[OTA5] relecture : %s (erreur %u)", ok ? "OK" : "REFUSÉE", (unsigned)g_sess.err);
}
static void cmdDownload() {
  if (!g_manOk) { say("aucun manifeste accepté : m d'abord"); return; }
  if (g_mountOk != 1) { mountFs(); if (g_mountOk != 1) return; }
  podotar4::init(g_sess, Sha{shaBegin, shaUpdate, shaEnd, &g_sha}, Stage{stWrite, stRead, stRemove, nullptr});
  GetJob j = { "/firmware.bin", binLen, binData, 0, 0, 0, false };
  logf("[OTA5] tas libre avant : %lu", heapFree());
  const bool net = httpGet(j);
  logf("[OTA5] binaire : statut %d, Content-Length %ld, reçu %lu, session état %u erreur %u", j.status, (long)j.clen, (unsigned long)j.got, (unsigned)g_sess.st, (unsigned)g_sess.err);
  if (!net || !j.ok || g_sess.st != S_DOWNLOADING) { if (g_sess.st != S_FAILED) podotar4::fail(g_sess, E_STATE); say("téléchargement refusé : staging supprimé"); return; }
  if (!podotar4::finish(g_sess)) { say("taille ou SHA-256 du téléchargement différent du manifeste : staging supprimé"); return; }
  say("téléchargement conforme : staging NON APPROUVÉ jusqu'à la relecture");
  readbackCall();
  if (g_sess.st == S_READY) say("TICKET PRÊT (non consommé : aucune programmation dans ce croquis)"); else say("PAS de ticket");
  logf("[OTA5] tas libre après : %lu", heapFree());
}
static void cmdSeq() { const SeqState s = seqLoad({flRead, flWrite, nullptr}, OTA5_COMPILED_SEQ, g_blk); logf("[OTA5] séquence : ok=%d effective=%lu génération=%lu (lecture seule)", s.ok ? 1 : 0, (unsigned long)s.seq, (unsigned long)s.gen); }
static void cmdInfo() {
  logf("[OTA5] ===== SONDE OTA-5 R4-B (laboratoire) | %s | compilée %s %s | TLS=%d | NE PAS DÉPLOYER | AUCUNE PROGRAMMATION =====", OTA5_VERSION, __DATE__, __TIME__, (int)OTA5_TLS);
  logf("[OTA5] tas libre %lu | pire pile dédiée : utilisé %u o, marge minimale %u", heapFree(), (unsigned)g_worstUsed, (unsigned)(g_worstMargin == 0xFFFF ? 0 : g_worstMargin));
}
static bool hexTo32(const char* s, uint8_t* out) { return strlen(s) == 64 && hexN((const uint8_t*)s, 64, out); }
static void handle(char* s) {
  while (*s == ' ') s++;
  if (!*s) return;
  if (g_stop) { say("ARRÊT (garde écrasée) : aucune commande ne sera exécutée"); return; }
  switch (s[0]) {
    case '?': say("? aide | i info | w Wi-Fi | s <hôte>[:port] | p <hex64> clé r4-a de TEST | m manifeste | d binaire | q séquence | x supprimer le staging"); break;
    case 'i': cmdInfo(); break;
    case 'w': cmdWifi(); break;
    case 's': { char* p = s + 1; while (*p == ' ') p++; char* c = strchr(p, ':'); if (c) { *c = 0; g_port = (uint16_t)atoi(c + 1); } strncpy(g_host, p, sizeof g_host - 1); g_host[sizeof g_host - 1] = 0; logf("[OTA5] serveur : %s:%u", g_host, (unsigned)g_port); break; }
    case 'p': { char* p = s + 1; while (*p == ' ') p++; g_pubSet = hexTo32(p, g_pubA); logf("[OTA5] clé r4-a de test : %s", g_pubSet ? "enregistrée" : "REFUSÉE (64 hex minuscules attendus)"); break; }
    case 'm': cmdManifest(); break;
    case 'd': cmdDownload(); break;
    case 'q': cmdSeq(); break;
    case 'x': { if (g_mountOk != 1) mountFs(); PodNetInfo ni; auto f = [&]() { stRemove(nullptr); }; const bool ran = podWifiRun(f, &ni); rep("suppression du staging", ni, ran); memset(&g_sess, 0, sizeof g_sess); break; }
    default: say("commande inconnue (?)");
  }
}
void setup() {
  Serial.begin(115200); while (!Serial && millis() < 4000) {}
  Serial.println();
  logf("[OTA5] ===== SONDE OTA-5 R4-B | %s | NE PAS DÉPLOYER | aucune commande automatique, aucune programmation ===== compilée %s %s", OTA5_VERSION, __DATE__, __TIME__);
}
void loop() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { g_line[g_len] = 0; g_len = 0; handle(g_line); }
    else if (g_len < sizeof g_line - 1) g_line[g_len++] = c;
  }
}
