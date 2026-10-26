// ota3_r4_probe — LOT OTA-3 (UNO R4 WiFi) : sonde JETABLE, sans écran ni capteur, sans le moindre protocole PoD (ni register, ni pull, ni vote, ni clé de l'appareil).   ⚠ NE PAS DÉPLOYER.
// Rôle : établir, sur la carte, CE QUE FAIT et NE FAIT PAS `OTAUpdate` (le module ESP32-S3 télécharge, décode, vérifie un CRC, puis reprogramme le RA4M1 par SAM-BA). Questions : ota-lab/r4-ota3/README.md § 2.
// Sécurité de l'essai : AUCUNE commande ne démarre toute seule. `U` (reprogrammation du RA4M1) exige de retaper YES dans les 60 s. Le sketch n'appelle JAMAIS ota.begin() ni ota.update() SANS chemin de fichier
// (ces variantes visent la partition de l'ESP32 lui-même, pas le RA4M1) : un test du dépôt le vérifie. Tout appel au module passe par podWifiRun (pile dédiée de 1 536 o).
// PILE PRINCIPALE DU R4 = 1 024 o (OTA3-FIX1, 16/10/2026) : la première version affichait avec Serial.print et gardait 452 o (EEPROM), 96 o (URL + snprintf) et deux objets SHA-256 sur la pile → débordement, redémarrages
// spontanés (le serveur « sautait » : la variable g_host est remise à zéro à chaque redémarrage). Désormais : toute sortie passe par logf() sur la pile de journal dédiée, AUCUN tableau local > 32 o, tampons et objets en statique.
// Moniteur série 115200, fin de ligne « Nouvelle ligne ». Commande `?` pour l'aide. Les lignes de mesure commencent par [OTA3].
#include <Arduino.h>
#include <stdarg.h>
#include <malloc.h>
#include <WiFiS3.h>
#include <WiFiFileSystem.h>
#include <OTAUpdate.h>
#include <EEPROM.h>
#include <SHA256.h>
#include "podNetStack.h"
#include "ota3_ticket.h"
#include "secrets.h"

#ifndef OTA3_IS_B
#define OTA3_IS_B 0
#endif
#if OTA3_IS_B
#define OTA3_VERSION "B"
#else
#define OTA3_VERSION "A"
#endif
// OTA3_AUTO (OTA3-AUTO1, 16/10/2026) : mode « canari automatique », EXPLICITE et séparé du mode manuel (défaut 0). À 1 il ajoute SEULEMENT : des événements d'une ligne « @OTA3 {json} » lisibles par l'orchestrateur,
// l'identifiant unique de la puce, l'identifiant de run compilé (OTA3_RUN_ID) et la commande « h <taille> » (SHA-256 de la flash programme, lecture seule). Aucune garde n'est assouplie : U/YES et le ticket sont inchangés.
#ifndef OTA3_AUTO
#define OTA3_AUTO 0
#endif
#ifndef OTA3_RUN_ID
#define OTA3_RUN_ID 0u
#endif
#define OTA3_PATH "/update.bin"
#define OTA3_EEPROM_PROTECTED 452   // octets du bloc 0 du firmware de production (clés, état) : LUS seulement, jamais écrits

extern "C" char* sbrk(int incr);
extern char __StackLimit, __HeapLimit;

static OTAUpdate ota;
static char g_host[40] = "";
static uint16_t g_port = 8080;
static uint32_t g_armedAt = 0;          // U armé (millis) ; 0 = non armé
static uint16_t g_worstUsed = 0, g_worstMargin = 0xFFFF;
static bool g_stop = false;
static char g_url[96];                  // statique : jamais sur la pile principale
static char g_hex[65];
static SHA256 g_shaA, g_shaB;         // statiques : un objet SHA-256 pèse ≈ 130 o

// ── journal : la mise en forme (vsnprintf, ≈ 450 o) et l'écriture USB s'exécutent sur la pile de journal dédiée ──
struct LogJob { const char* fmt; va_list* ap; };
static void logEmit(void* p) {
  static char b[256];                   // statique : la pile du cœur R4 ne fait que 1 Ko
  LogJob* j = static_cast<LogJob*>(p);
  vsnprintf(b, sizeof(b), j->fmt, *j->ap);
  Serial.println(b);
}
static void logf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
static void logf(const char* fmt, ...) {
  va_list ap; va_start(ap, fmt);
  LogJob j = { fmt, &ap };
  if (podNetOnMainStack()) {
    PodNetInfo li;
    PodNet::runSized(logEmit, &j, POD_LOG_STACK_TOTAL, &li);
    if (li.err == POD_NET_GUARD) { for (;;) { __asm volatile("nop"); } }   // garde écrasée : arrêt sûr SILENCIEUX (aucune E/S)
  } else logEmit(&j);
  va_end(ap);
}

// ── pile principale : peinte au démarrage, relevée à la demande ──
static const uint8_t PAINT_MAIN = 0x5A;
static const uint32_t MAIN_SAFETY = 160;
static void paintMain() { volatile uint8_t* lo = (volatile uint8_t*)&__StackLimit; volatile uint8_t* hi = (volatile uint8_t*)__builtin_frame_address(0) - MAIN_SAFETY; for (volatile uint8_t* p = lo; p < hi; p++) *p = PAINT_MAIN; }
static uint32_t mainUntouched() { volatile uint8_t* p = (volatile uint8_t*)&__StackLimit; uint32_t n = 0; while (p + n < (volatile uint8_t*)__builtin_frame_address(0) - MAIN_SAFETY && p[n] == PAINT_MAIN) n++; return n; }
static unsigned long heapFree() { struct mallinfo mi = mallinfo(); return (unsigned long)mi.fordblks + (unsigned long)((char*)&__HeapLimit - (char*)sbrk(0)); }

static void say(const char* s) { logf("[OTA3] %s", s); }

// Événements machine (une ligne, < 250 caractères : le tampon du journal fait 256 o). Absents (aucun code) quand OTA3_AUTO = 0.
#if OTA3_AUTO
#define OTA3_EVT(...) logf("@OTA3 " __VA_ARGS__)
#else
#define OTA3_EVT(...) ((void)0)
#endif

// ── rapport d'un appel sur la pile dédiée ; GUARD = débordement réel : arrêt, pas de poursuite ──
static void __attribute__((noinline)) rep(const char* tag, const PodNetInfo& ni, bool ran) {
  if (ni.used > g_worstUsed) g_worstUsed = ni.used;
  if (ni.margin < g_worstMargin && ran) g_worstMargin = ni.margin;
  logf("[OTA3] pile %s : %s, utilisé %u o, marge %u o, erreur %u%s", tag, ran ? "exécuté" : "NON exécuté/rejeté", (unsigned)ni.used, (unsigned)ni.margin, (unsigned)ni.err, ni.low ? "  SOUS L'OBJECTIF 256" : "");
  if (ni.err == POD_NET_GUARD) { g_stop = true; say("STOP : garde écrasée (débordement réel) — débrancher, reflasher le firmware stable"); }
}

// CRC-32 incrémental : AUCUN tampon (la première version gardait 452 o sur la pile principale de 1 024 o)
static uint32_t eepromCrcRange(int from, int to) { uint32_t c = 0xFFFFFFFFu; for (int i = from; i < to; i++) { c ^= (uint8_t)EEPROM.read(i); for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u))); } return ~c; }
static uint32_t eepromCrc() { return eepromCrcRange(0, OTA3_EEPROM_PROTECTED); }
// OTA3-FIX5 : CRC de TOUTE la flash de données (8 Ko) par zones — le firmware TFT 2,8″ y garde aussi le verrou de vote (5120–7167) que le seul CRC 0–451 ne couvrait pas. LECTURE seulement.
static int eepromCrcs(uint32_t o[5]) {
  int n = (int)EEPROM.length(); if (n > 8192) n = 8192;
  o[0] = eepromCrcRange(0, 452); o[1] = eepromCrcRange(452, n < 5120 ? n : 5120); o[2] = n > 5120 ? eepromCrcRange(5120, n < 7168 ? n : 7168) : 0; o[3] = n > 7168 ? eepromCrcRange(7168, n) : 0; o[4] = eepromCrcRange(0, n);
  return n;
}
static void eepromReport(const char* tag) {
  uint32_t c[5]; const int n = eepromCrcs(c);
  logf("[OTA3] flash de données %s (%d o) : CRC[0-451]=%08lX CRC[452-5119]=%08lX CRC[5120-7167]=%08lX CRC[7168-fin]=%08lX CRC[tout]=%08lX", tag, n, (unsigned long)c[0], (unsigned long)c[1], (unsigned long)c[2], (unsigned long)c[3], (unsigned long)c[4]);
}
#if OTA3_AUTO
// Événements « boot » (au démarrage) et « hello » (commande m, ré-émission à la demande) : identité de la build (lettre + identifiant de run compilés), identifiant unique de la puce RA4M1 (R_FMI->UIDR, 128 bits), cause du reset, CRC de la flash de données.
static void evtId(const char* name, unsigned r0, unsigned r1, unsigned r2) {
  uint32_t c[5]; const int n = eepromCrcs(c);
  const bsp_unique_id_t* uid = R_BSP_UniqueIdGet();   // 128 bits, lecture seule (FSP)
  OTA3_EVT("{\"e\":\"%s\",\"build\":\"%s\",\"run\":\"%08lX\",\"uid\":\"%08lX%08lX%08lX%08lX\",\"rst\":\"%02X%04X%02X\",\"n\":%d,\"fcrc\":[\"%08lX\",\"%08lX\",\"%08lX\",\"%08lX\",\"%08lX\"]}", name, OTA3_VERSION, (unsigned long)OTA3_RUN_ID,
           (unsigned long)uid->unique_id_words[0], (unsigned long)uid->unique_id_words[1], (unsigned long)uid->unique_id_words[2], (unsigned long)uid->unique_id_words[3], r0, r1, r2, n, (unsigned long)c[0], (unsigned long)c[1], (unsigned long)c[2], (unsigned long)c[3], (unsigned long)c[4]);
}
#endif
static const char* hex32(const uint8_t* h) { static const char* D = "0123456789ABCDEF"; for (int i = 0; i < 32; i++) { g_hex[2 * i] = D[h[i] >> 4]; g_hex[2 * i + 1] = D[h[i] & 15]; } g_hex[64] = 0; return g_hex; }

// ── Wi-Fi : chaque appel au module sur la pile dédiée ──
static String __attribute__((noinline)) wifiFw() { String s; PodNetInfo ni; auto f = [&]() { s = String(WiFi.firmwareVersion()); }; const bool ran = podWifiRun(f, &ni); rep("WiFi.firmwareVersion", ni, ran); return ran ? s : String("?"); }
static void __attribute__((noinline)) wifiBeginCall() { PodNetInfo ni; auto f = [&]() { WiFi.begin(SECRET_WIFI_SSID, SECRET_WIFI_PASSWORD); }; const bool ran = podWifiRun(f, &ni); rep("WiFi.begin", ni, ran); }
static uint8_t __attribute__((noinline)) wifiStatusCall() { uint8_t st = 0xFE; PodNetInfo ni; auto f = [&]() { st = (uint8_t)WiFi.status(); }; const bool ran = podWifiRun(f, &ni); if (!ran) rep("WiFi.status", ni, ran); return ran ? st : (uint8_t)0xFE; }
static uint32_t __attribute__((noinline)) wifiIp() { uint32_t v = 0; PodNetInfo ni; auto f = [&]() { IPAddress ip = WiFi.localIP(); v = (uint32_t)ip; }; const bool ran = podWifiRun(f, &ni); if (!ran) rep("WiFi.localIP", ni, ran); return ran ? v : 0; }

static void cmdWifi() {
  say("Wi-Fi : connexion (secrets.h)…"); wifiBeginCall();
  for (int i = 0; i < 40 && !g_stop; i++) { delay(500); if (wifiStatusCall() == WL_CONNECTED && wifiIp() != 0) break; }   // OTA3-AUTO2 : « connecté » peut précéder le bail DHCP (adresse 0.0.0.0) : on attend une adresse non nulle
  const uint32_t ip = wifiIp(); const bool ok = wifiStatusCall() == WL_CONNECTED;
  logf("[OTA3] Wi-Fi %s — adresse de la CARTE = %u.%u.%u.%u  (ce n'est PAS l'adresse du serveur : « s » veut l'IPv4 du PC)", ok ? "CONNECTÉ" : "NON connecté", (unsigned)(ip & 255), (unsigned)((ip >> 8) & 255), (unsigned)((ip >> 16) & 255), (unsigned)(ip >> 24));
  OTA3_EVT("{\"e\":\"wifi\",\"ok\":%d,\"ip\":\"%u.%u.%u.%u\"}", ok ? 1 : 0, (unsigned)(ip & 255), (unsigned)((ip >> 8) & 255), (unsigned)((ip >> 16) & 255), (unsigned)(ip >> 24));
}

// ── appels OTAUpdate : un par enveloppe, résultat dans une variable de l'appelant ──
static int __attribute__((noinline)) otaBegin() { int r = -99; PodNetInfo ni; auto f = [&]() { r = ota.begin(OTA3_PATH); }; const bool ran = podWifiRun(f, &ni); rep("ota.begin(chemin)", ni, ran); return ran ? r : -98; }
static int __attribute__((noinline)) otaDownload(const char* url) { int r = -99; PodNetInfo ni; auto f = [&]() { r = ota.download(url, OTA3_PATH); }; const bool ran = podWifiRun(f, &ni); rep("ota.download", ni, ran); return ran ? r : -98; }
static int __attribute__((noinline)) otaVerify() { int r = -99; PodNetInfo ni; auto f = [&]() { r = ota.verify(); }; const bool ran = podWifiRun(f, &ni); rep("ota.verify", ni, ran); return ran ? r : -98; }
static int __attribute__((noinline)) otaUpdateCall() { int r = -99; PodNetInfo ni; auto f = [&]() { r = ota.update(OTA3_PATH); }; const bool ran = podWifiRun(f, &ni); rep("ota.update(chemin)", ni, ran); return ran ? r : -98; }

// OTA3-FIX3 : après un verify() NÉGATIF le module ne libère pas son contexte de téléchargement (Arduino_ESP32_OTA::verify() rend l'erreur AVANT clean()) ; le téléchargement suivant déclenche
// assert(_context == nullptr) dans startDownload : le module redémarre (et décroche la carte). Garde : refuser tout nouveau téléchargement tant que le module n'a pas été remis à zéro (USB débranchée 10 s).
static bool g_moduleDirty = false;
static bool g_verifyOk = false;             // dernier verify() du module = 0 (invalidé par chaque nouveau d)
static Ota3Expect g_exp = { false, 0, { 0 } };   // taille + SHA-256 attendus (commande e)
static void cmdStage(const char* name) {
  g_verifyOk = false;
  if (g_moduleDirty) { say("REFUSÉ : un verify() négatif a laissé le module dans un état qui plante le téléchargement suivant. Débrancher l'USB 10 s, rebrancher, retéléverser si besoin, puis w et s."); OTA3_EVT("{\"e\":\"err\",\"m\":\"dirty\"}"); return; }
  if (!g_host[0]) { say("serveur inconnu : taper « s <ip du PC> » d'abord"); OTA3_EVT("{\"e\":\"err\",\"m\":\"nohost\"}"); return; }
  if (wifiStatusCall() != WL_CONNECTED) { say("Wi-Fi non connecté : taper « w » d'abord"); OTA3_EVT("{\"e\":\"err\",\"m\":\"nowifi\"}"); return; }
  { char port[8]; utoa((unsigned)g_port, port, 10); strcpy(g_url, "http://"); strncat(g_url, g_host, 40); strcat(g_url, ":"); strcat(g_url, port); strcat(g_url, "/"); strncat(g_url, name, 30); strcat(g_url, ".ota"); }   // pas de snprintf sur la pile principale
  logf("[OTA3] URL %s", g_url);
  logf("[OTA3] tas libre avant : %lu", heapFree());
  const int b = otaBegin(); logf("[OTA3] ota.begin(" OTA3_PATH ") = %d", b);
  if (b != 0 || g_stop) { say("begin refusé : arrêt de l'étape"); OTA3_EVT("{\"e\":\"err\",\"m\":\"begin\",\"r\":%d}", b); return; }
  const uint32_t t0 = millis(); const int d = otaDownload(g_url); const uint32_t dt = millis() - t0;
  logf("[OTA3] ota.download = %d  (octets DÉCODÉS écrits si > 0 ; < 0 = code d'erreur du module : -6 = serveur injoignable, -7 = pas de Content-Length, -11 = mauvaise magie, -14 = HTTP != 200)  durée %lu ms", d, (unsigned long)dt);
  if (g_stop) return;
  if (d == -26) say("-26 = le MODULE n'a pas répondu (60 s) : il est probablement bloqué ; RESET ne le réinitialise PAS — débrancher l'USB 10 s avant de continuer");
  if (d <= 0) { say("pas de fichier à vérifier"); OTA3_EVT("{\"e\":\"stage\",\"case\":\"%s\",\"dl\":%d,\"vf\":999}", name, d); return; }
  const int v = otaVerify(); if (v != 0) g_moduleDirty = true; g_verifyOk = (v == 0); logf("[OTA3] ota.verify = %d  (0 = CRC32 de l'en-tête concordant ; -10 = CRC différent ; ce n'est PAS une signature)", v);
  logf("[OTA3] tas libre après : %lu", heapFree());
  OTA3_EVT("{\"e\":\"stage\",\"case\":\"%s\",\"dl\":%d,\"vf\":%d}", name, d, v);
}

// SPIFFS doit être MONTÉ pour les commandes +FS : le module appelle SPIFFS.end() à la fin d'un téléchargement (OTA3-FIX2 : sans montage, la relecture rendait 0 octet en 5 ms). Montage SANS formatage (argument 0) ;
// on n'appelle PAS WiFiFileSystem::mount() : il commence par modem.begin(), qui ré-initialise la liaison avec le module.
static int g_mountOk = -1;
static void __attribute__((noinline)) mountFs() {
  PodNetInfo ni; bool ok = false;
  auto f = [&]() { std::string res; ok = modem.write(std::string(PROMPT(_MOUNTFS)), res, "%s%d\r\n", CMD_WRITE(_MOUNTFS), 0); };
  const bool ran = podWifiRun(f, &ni); rep("mount SPIFFS", ni, ran); g_mountOk = (ran && ok) ? 1 : 0;
  logf("[OTA3] montage SPIFFS (sans formatage) : %s", g_mountOk ? "OK" : "ÉCHEC");
}

// ── lecture de /update.bin chez le module (même commande AT que WiFiFileSystem::readfile, mais le contenu est haché au lieu d'être imprimé) ──
static std::string g_chunk;
static bool __attribute__((noinline)) fsReadChunk(const char* name, uint32_t off, bool* got) {
  PodNetInfo ni; bool okcall = false; g_chunk.clear();
  auto f = [&]() {
    std::string res; modem.avoid_trim_results(); modem.read_using_size();
    okcall = modem.write(DO_NOT_CHECK_CMD, res, "%s%d,%d,%s,%lu,%d\r\n", CMD_WRITE(_FILESYSTEM), 0, WIFI_FILE_READ, name, (unsigned long)off, 1023);
    if (okcall) g_chunk.swap(res);
  };
  const bool ran = podWifiRun(f, &ni);
  if (ni.used > g_worstUsed) g_worstUsed = ni.used;
  if (ran && ni.margin < g_worstMargin) g_worstMargin = ni.margin;
  if (!ran || ni.err != POD_NET_OK) { rep("FS read", ni, ran); *got = false; return false; }
  *got = okcall; return true;
}
// Relit /update.bin en entier et rend taille, SHA-256 et 16 premiers octets. false = montage ou lecture impossible (aucune décision ne doit s'appuyer sur un résultat partiel).
// La lecture s'arrête dès que la taille dépasse la flash applicative (OTA3_APP_MAX) : un fichier plus grand ne peut pas être flashé, inutile de l'avaler.
static uint8_t g_head[16], g_sha[32];
static uint32_t g_total = 0;
static bool readStaged(uint32_t* chunksOut, uint32_t* msOut) {
  mountFs(); if (!g_mountOk) { say("montage SPIFFS impossible : relecture abandonnée"); return false; }
  g_shaA.reset(); g_total = 0; uint32_t chunks = 0; memset(g_head, 0, sizeof g_head); const uint32_t t0 = millis(); bool got = true;
  while (!g_stop && g_total <= OTA3_APP_MAX) {
    if (!fsReadChunk(OTA3_PATH, g_total, &got)) { say("lecture : appel rejeté (pile) — arrêt"); return false; }
    if (!got || g_chunk.empty()) break;
    if (g_total < sizeof g_head) { size_t n = g_chunk.size() < sizeof g_head - g_total ? g_chunk.size() : sizeof g_head - g_total; memcpy(g_head + g_total, g_chunk.data(), n); }
    g_shaA.update(g_chunk.data(), g_chunk.size()); g_total += (uint32_t)g_chunk.size(); chunks++;
  }
  g_shaA.finalize(g_sha, 32); *chunksOut = chunks; *msOut = millis() - t0;
  return !g_stop;
}
// Ticket de flash (OTA3-FIX5) : relecture + toutes les gardes de ota3Ticket(). Appelée par r, AVANT d'armer U et JUSTE AVANT l'appel du module (réduit la fenêtre entre vérification et programmation).
static bool verifyStaged(bool verbose) {
  uint32_t chunks = 0, ms = 0; if (!readStaged(&chunks, &ms)) { OTA3_EVT("{\"e\":\"err\",\"m\":\"readfail\"}"); return false; }
  if (verbose) {
    logf("[OTA3] relu %lu o en %lu lectures, %lu ms", (unsigned long)g_total, (unsigned long)chunks, (unsigned long)ms);
    logf("[OTA3] SHA-256 relu : %s", hex32(g_sha));
    logf("[OTA3] 16 premiers octets : %02X %02X %02X %02X %02X %02X %02X %02X %02X %02X %02X %02X %02X %02X %02X %02X", g_head[0], g_head[1], g_head[2], g_head[3], g_head[4], g_head[5], g_head[6], g_head[7], g_head[8], g_head[9], g_head[10], g_head[11], g_head[12], g_head[13], g_head[14], g_head[15]);
  }
  const Ota3Why w = ota3Ticket(g_exp, g_total, g_sha, g_head, g_verifyOk, g_moduleDirty);
  logf("[OTA3] %s", ota3WhyText(w));
  OTA3_EVT("{\"e\":\"ticket\",\"ok\":%d,\"why\":%d,\"size\":%lu,\"sha\":\"%s\"}", w == OTA3_OK ? 1 : 0, (int)w, (unsigned long)g_total, hex32(g_sha));
  return w == OTA3_OK;
}
static void cmdReadback() { (void)verifyStaged(true); }
static void cmdExpect(char* p) {
  while (*p == ' ') p++;
  static uint8_t sha[32]; int n = 0;
  for (; n < 64 && p[n]; n++) { const char c = p[n]; const int v = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : -1; if (v < 0) break; if (n & 1) sha[n / 2] |= (uint8_t)v; else sha[n / 2] = (uint8_t)(v << 4); }
  if (n != 64 || p[64] != ' ') { say("syntaxe : e <SHA-256 en 64 caractères hexadécimaux> <taille en octets>"); OTA3_EVT("{\"e\":\"err\",\"m\":\"e_syntax\"}"); return; }
  const unsigned long sz = strtoul(p + 65, nullptr, 10);
  if (sz == 0 || sz > OTA3_APP_MAX) { say("taille invalide (1 à 245760)"); OTA3_EVT("{\"e\":\"err\",\"m\":\"e_size\"}"); return; }
  memcpy(g_exp.sha, sha, 32); g_exp.size = (uint32_t)sz; g_exp.set = true;
  logf("[OTA3] attendu enregistré : %lu o, SHA-256 %s", sz, hex32(g_exp.sha));
  OTA3_EVT("{\"e\":\"expect\",\"size\":%lu,\"sha\":\"%s\"}", sz, hex32(g_exp.sha));
}

// ── aller-retour d'un fichier de 2 000 octets (écriture par morceaux de 200 o chez le module, relecture, SHA-256) ──
static uint8_t g_data[200];
static void cmdFsRoundtrip() {
  mountFs(); static WiFiFileSystem fs; const char* name = "/probe.bin"; uint32_t t0 = millis(); size_t sent = 0; g_shaA.reset();
  for (int k = 0; k < 10 && !g_stop; k++) {
    for (int i = 0; i < 200; i++) g_data[i] = (uint8_t)(k * 31 + i * 7 + 3);
    g_shaA.update(g_data, sizeof g_data);
    PodNetInfo ni; size_t w = 0; auto f = [&]() { w = fs.writefile(name, (const char*)g_data, sizeof g_data, k == 0 ? WIFI_FILE_WRITE : WIFI_FILE_APPEND); };
    const bool ran = podWifiRun(f, &ni); if (!ran || ni.err != POD_NET_OK) { rep("FS write", ni, ran); return; }
    if (ni.used > g_worstUsed) g_worstUsed = ni.used;
    if (ni.margin < g_worstMargin) g_worstMargin = ni.margin;
    sent += w; delay(30);
  }
  logf("[OTA3] écrit %u o en %lu ms", (unsigned)sent, (unsigned long)(millis() - t0));
  g_shaB.reset(); uint32_t total = 0; bool g = true;
  while (!g_stop && total < 4096) { if (!fsReadChunk(name, total, &g)) return; if (!g || g_chunk.empty()) break; g_shaB.update(g_chunk.data(), g_chunk.size()); total += (uint32_t)g_chunk.size(); }
  static uint8_t a[32], b[32]; g_shaA.finalize(a, 32); g_shaB.finalize(b, 32);
  logf("[OTA3] relu %lu o ; aller-retour %s", (unsigned long)total, (memcmp(a, b, 32) == 0 && total == sent) ? "IDENTIQUE" : "DIFFÉRENT");
}
static void cmdDeleteProbe() {
  mountFs(); static WiFiFileSystem fs; PodNetInfo ni; size_t w = 0; auto f = [&]() { w = fs.writefile("/probe.bin", "", 0, WIFI_FILE_DELETE); }; const bool ran = podWifiRun(f, &ni); (void)w; rep("FS delete", ni, ran);
}

static void cmdInfo() {
  logf("[OTA3] ===== SONDE OTA-3 R4 | build %s | compilée %s %s | en marche depuis %lu s =====", OTA3_VERSION, __DATE__, __TIME__, (unsigned long)(millis() / 1000));
  const String fw = wifiFw(); logf("[OTA3] module Wi-Fi : %s", fw.c_str());
  eepromReport("(lue seulement)");
  logf("[OTA3] tas libre %lu | pile principale : %lu o intacts depuis le bas", heapFree(), (unsigned long)mainUntouched());
  logf("[OTA3] pire pile dédiée : utilisé %u o, marge minimale %u", (unsigned)g_worstUsed, (unsigned)(g_worstMargin == 0xFFFF ? 0 : g_worstMargin));
  if (g_host[0]) logf("[OTA3] serveur : %s:%u", g_host, (unsigned)g_port); else say("serveur : (non défini : « s <ip du PC> »)");
}

// cause du dernier reset (registres RA4M1 RSTSR0/1/2), lue puis REMISE À ZÉRO : les drapeaux sont cumulatifs, sans cela une mise sous tension ancienne masquerait un reset récent
static unsigned g_rst0 = 0, g_rst1 = 0, g_rst2 = 0;   // dernière cause lue (pour l'événement boot)
static void resetCause() {
  const unsigned r0 = R_SYSTEM->RSTSR0, r1 = R_SYSTEM->RSTSR1, r2 = R_SYSTEM->RSTSR2; g_rst0 = r0; g_rst1 = r1; g_rst2 = r2;
  logf("[OTA3] cause du dernier reset : RSTSR0=%02X RSTSR1=%04X RSTSR2=%02X | %s%s%s%s%s%s%s%s(drapeaux remis à zéro après lecture)", r0, r1, r2,
       (r0 & 1) ? "mise sous tension " : "", (r0 & 0x0E) ? "TENSION BASSE(LVD) " : "", (r1 & 1) ? "chien de garde indépendant " : "", (r1 & 2) ? "chien de garde " : "",
       (r1 & 4) ? "reset logiciel " : "", (r1 & 0xF00) ? "erreur mémoire/bus " : "", (r1 & 0x8000) ? "erreur de protection " : "", (r0 == 0 && r1 == 0) ? "broche RESET ou déjà lu " : "");
  R_SYSTEM->RSTSR0 = 0; R_SYSTEM->RSTSR1 = 0; R_SYSTEM->RSTSR2 = 0;
}

static void help() {
  say("? aide | i info | c cause du dernier reset | e <SHA-256> <taille> valeurs attendues | w Wi-Fi | s <ip du PC>[:port] serveur | d <nom> étape: begin+download+verify de <nom>.ota (SANS reprogrammer) | r relire /update.bin et le hacher | f aller-retour d'un fichier de 2 Ko | x effacer /probe.bin");
  say("U = REPROGRAMMER le RA4M1 depuis /update.bin (demande YES dans les 60 s). Cas : good badcrc badpayload badmagic trunc lenlie sigbit to-a pad200 pad400 (+ slow/<nom>, chunked/<nom>)");
}

#if OTA3_AUTO
// h <taille> : SHA-256 de la flash PROGRAMME [0x4000, 0x4000 + taille), lecture seule. Refuse 0 et toute taille > OTA3_APP_MAX (0x3C000). Prouve que la flash contient bien l'image attendue (le pont ne vérifie rien après BOSSA).
static void cmdFlashHash(char* a) {
  while (*a == ' ') a++;
  char* end = nullptr; const unsigned long sz = strtoul(a, &end, 10);
  if (end == a || *end != 0 || sz == 0 || sz > OTA3_APP_MAX) { say("h : taille invalide (1 à 245760)"); OTA3_EVT("{\"e\":\"fhash\",\"err\":\"size\"}"); return; }
  g_shaB.reset(); const uint8_t* p = (const uint8_t*)OTA3_APP_BASE; uint32_t left = (uint32_t)sz;
  while (left) { const uint32_t n = left > 256 ? 256 : left; g_shaB.update(p, n); p += n; left -= n; }
  static uint8_t h[32]; g_shaB.finalize(h, 32);
  logf("[OTA3] SHA-256 de la flash programme [0x%lX, +%lu) : %s", (unsigned long)OTA3_APP_BASE, sz, hex32(h));
  OTA3_EVT("{\"e\":\"fhash\",\"size\":%lu,\"sha\":\"%s\"}", sz, hex32(h));
}
#endif
static void cmdUpdateArm() {
  if (!verifyStaged(true)) { say("U REFUSÉ : le fichier du module n'est pas celui qui est attendu (voir la ligne ci-dessus)"); OTA3_EVT("{\"e\":\"err\",\"m\":\"u_refused\"}"); return; }
  g_armedAt = millis(); OTA3_EVT("{\"e\":\"armed\"}"); say("U ARMÉ : retaper YES dans les 60 s pour REPROGRAMMER le RA4M1 depuis /update.bin. Toute autre saisie annule. NE PAS couper le courant ensuite avant « build » de la nouvelle image."); }
static void cmdUpdateGo() {
  g_armedAt = 0;
  say("YES reçu : DERNIÈRE relecture du fichier avant de laisser le module reprogrammer…");
  if (!verifyStaged(true)) { say("U ANNULÉ : le fichier a changé ou n'est plus valide"); OTA3_EVT("{\"e\":\"err\",\"m\":\"go_cancelled\"}"); return; }
  eepromReport("AVANT update (à retrouver IDENTIQUE après le redémarrage)");
  ota3Consume(g_exp, g_verifyOk);   // OTA3-AUTO1 : le ticket est CONSOMMÉ avant l'appel du module — retour, échec ou délai : aucun nouvel U sans nouveau d, nouveau e et nouvelle relecture
  OTA3_EVT("{\"e\":\"update_begin\"}");
  say("ota.update(/update.bin) : le module reprogramme le RA4M1 (SAM-BA) ; cette liaison série va se couper et la carte redémarrer."); Serial.flush();
  const uint32_t t0 = millis(); const int r = otaUpdateCall();
  logf("[OTA3] ota.update est REVENU (inattendu si la reprogrammation a eu lieu) = %d après %lu ms", r, (unsigned long)(millis() - t0));
  OTA3_EVT("{\"e\":\"update_returned\",\"r\":%d}", r);
}

static char g_line[96]; static uint8_t g_len = 0;
static void handle(char* s) {
  while (*s == ' ') s++;
  if (g_armedAt) { const bool yes = strcmp(s, "YES") == 0 && millis() - g_armedAt < 60000u; if (yes) { cmdUpdateGo(); return; } g_armedAt = 0; say("U annulé"); if (strcmp(s, "YES") == 0) return; }
  if (!*s) return;
  if (g_stop) { say("ARRÊT (garde écrasée) : aucune commande ne sera exécutée"); return; }
  switch (s[0]) {
    case '?': help(); break;
    case 'i': cmdInfo(); break;
    case 'c': resetCause(); break;
    case 'w': cmdWifi(); break;
    case 's': { char* p = s + 1; while (*p == ' ') p++; char* c = strchr(p, ':'); if (c) { *c = 0; g_port = (uint16_t)atoi(c + 1); } strncpy(g_host, p, sizeof g_host - 1); g_host[sizeof g_host - 1] = 0; if (g_host[0]) logf("[OTA3] serveur : %s:%u", g_host, (unsigned)g_port); else say("serveur effacé"); OTA3_EVT("{\"e\":\"server\",\"ok\":%d}", g_host[0] ? 1 : 0); break; }
    case 'd': { char* p = s + 1; while (*p == ' ') p++; bool ok = *p != 0; for (char* q = p; *q; q++) if (!((*q >= 'a' && *q <= 'z') || (*q >= '0' && *q <= '9') || *q == '-' || *q == '/')) ok = false; if (!ok) say("nom invalide"); else cmdStage(p); break; }
    case 'r': cmdReadback(); break;
    case 'e': cmdExpect(s + 1); break;
    case 'f': cmdFsRoundtrip(); break;
    case 'x': cmdDeleteProbe(); break;
#if OTA3_AUTO
    case 'h': cmdFlashHash(s + 1); break;
    case 'm': evtId("hello", g_rst0, g_rst1, g_rst2); break;   // ré-émet l'identité (même contenu que boot) après une reconnexion série : un événement boot manqué n'est pas perdu
#endif
    case 'U': cmdUpdateArm(); break;
    default: say("commande inconnue (?)");
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 4000) {}
  paintMain();
#if OTA3_AUTO
  pinMode(LED_BUILTIN, OUTPUT);   // témoin de build (voir loop) ; absent du mode manuel
#endif
  Serial.println();
  logf("[OTA3] ===== SONDE OTA-3 R4 | build %s | NE PAS DÉPLOYER | aucune commande automatique ===== compilée %s %s", OTA3_VERSION, __DATE__, __TIME__);
  resetCause();
  logf("[OTA3] DÉMARRAGE (si cette ligne revient sans que vous ayez appuyé sur RESET, la carte a redémarré toute seule : le noter) | EEPROM bloc 0 CRC-32 = %08lX | tas libre %lu | pile principale intacte %lu o", (unsigned long)eepromCrc(), heapFree(), (unsigned long)mainUntouched());
  eepromReport("au démarrage");
#if OTA3_AUTO
  evtId("boot", g_rst0, g_rst1, g_rst2);
#endif
  help();
}

void loop() {
#if OTA3_AUTO
  // Témoin visuel (OTA3-AUTO3, canari automatique seulement) : la LED « L » clignote à 1 Hz sous la build A, à 5 Hz sous la build B. Elle se fige pendant ota.update() (le sketch est bloqué dans l'appel).
  // Permet de distinguer, après une reprogrammation muette, « le RA4M1 ne démarre pas » de « il tourne mais la liaison série est coupée ».
  { static uint32_t nxt = 0; static bool on = false; if (millis() >= nxt) { nxt = millis() + (OTA3_IS_B ? 100u : 500u); on = !on; digitalWrite(LED_BUILTIN, on ? HIGH : LOW); } }
#endif
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { g_line[g_len] = 0; g_len = 0; handle(g_line); }
    else if (g_len < sizeof g_line - 1) g_line[g_len++] = c;
  }
  if (g_armedAt && millis() - g_armedAt >= 60000u) { g_armedAt = 0; say("U expiré (60 s) : annulé"); }
}
