// host/wifi_calls_harness.cpp — LOT8B2B2 NETSTACK-WIFI-CALLS-FIX1 : exécute, sur l'hôte, le CODE RÉEL des enveloppes du module Wi-Fi (wifiStatusT, wifiFirmware, wifiBegin, wifiMac, wifiRssi, wifiIpString, wifiFailed)
// et de macHexDigit / macString, extrait mot pour mot de l'un des cinq sketches R4 par tests/wifiCalls.test.ts (fichier « wifi_extract.inc »), contre un module Wi-Fi SIMULÉ et la logique réelle de podNetStack.h
// (POD_NET_HOST_TEST : pile profonde simulée, garde écrasée, malloc impossible, imbrication).
//   wifi_calls_harness  →  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// Ce que l'hôte PROUVE : (1) chaque appel au module s'exécute sur la pile de 1 536 o (POD_WIFI_STACK_TOTAL) ; (2) les résultats vivent chez l'appelant ; (3) ÉCHEC FERMÉ : NOMEM / NESTED (module NON appelé) et MARGIN
// (module appelé mais résultat REJETÉ, même si le module a écrit des valeurs) → valeur « inconnue », chaîne vide ou false, jamais un résultat partiel ; (4) GUARD → arrêt sûr (logfSafeStop), aucun résultat ;
// (5) formulations honnêtes (non exécuté ≠ exécuté-rejeté) ; (6) la MAC encodée en hexadécimal manuel est identique à « %02x:… » pour toutes les valeurs d'octet.
// Ce qu'il NE PROUVE PAS : le déplacement réel de SP, ni la profondeur de la chaîne du module sur la carte (canari sans frame).
#define POD_NET_HOST_TEST 1
#include <cstdio>
#include <cstdlib>
#include <cstdarg>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>
#include <functional>

struct String {
  std::string s;
  String() {}
  String(const char* c) : s(c ? c : "") {}
  unsigned length() const { return (unsigned)s.size(); }
  const char* c_str() const { return s.c_str(); }
};
struct IPAddress {
  uint32_t a = 0;
  String toString() const { char b[24]; std::snprintf(b, sizeof(b), "%u.%u.%u.%u", (a >> 24) & 255, (a >> 16) & 255, (a >> 8) & 255, a & 255); return String(b); }
};
#define WIFI_SSID "ssid-test"
#define WIFI_PASSWORD "mdp-test"
#define WL_NO_MODULE 255
#define WL_CONNECTED 3

static int g_statusCalls = 0, g_fwCalls = 0, g_beginCalls = 0, g_macCalls = 0, g_rssiCalls = 0, g_ipCalls = 0;
static uint8_t g_macBytes[6] = { 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 };
struct WiFiShim {
  uint8_t status() { g_statusCalls++; return WL_CONNECTED; }
  const char* firmwareVersion() { g_fwCalls++; return "0.5.2"; }
  int begin(const char*, const char*) { g_beginCalls++; return WL_CONNECTED; }
  void macAddress(uint8_t* m) { g_macCalls++; for (int i = 0; i < 6; i++) m[i] = g_macBytes[i]; }
  long RSSI() { g_rssiCalls++; return -61; }
  IPAddress localIP() { g_ipCalls++; IPAddress i; i.a = 0xC0A80105u; return i; }
} WiFi;

static std::string g_log;
struct Halt { int code; };
static void logf(const char* fmt, ...) { char b[512]; va_list ap; va_start(ap, fmt); std::vsnprintf(b, sizeof(b), fmt, ap); va_end(ap); g_log += b; g_log += "\n"; }
[[noreturn]] __attribute__((unused)) static void logfSafeStop() { throw Halt{ 1 }; }

#include "../src/adapters/podNetStack.h"
#include "wifi_extract.inc"

static int g_pass = 0, g_fail = 0;
static void expect(const std::string& name, bool ok) { if (ok) g_pass++; else { g_fail++; std::printf("ÉCART : %s\n", name.c_str()); } }
static void resetCalls() { g_statusCalls = g_fwCalls = g_beginCalls = g_macCalls = g_rssiCalls = g_ipCalls = 0; g_log.clear(); }
static int moduleCalls() { return g_statusCalls + g_fwCalls + g_beginCalls + g_macCalls + g_rssiCalls + g_ipCalls; }
static size_t g_hookStackBytes = 0; static int g_hookRuns = 0;
static void recordHook(uint8_t*, size_t stackBytes, uint8_t*) { g_hookStackBytes = stackBytes; g_hookRuns++; }
static size_t g_touchAt = 0;
static void touch(uint8_t* low, size_t, uint8_t*) { low[g_touchAt] = 0x00; }
static void smashGuard(uint8_t*, size_t, uint8_t* guard) { guard[3] = 0x00; }

// exécute les six enveloppes ; retourne ce que l'appelant OBTIENT (pour comparer au cas sain)
struct Got { uint8_t st; uint8_t stT; std::string fw, ip; bool macOk; uint8_t mac[6]; bool rssiOk; int32_t rssi; };
static Got callAll() {
  Got g; g.st = wifiStatus(); g.stT = wifiStatusT("etiquette"); g.fw = wifiFirmware().s; wifiBegin(); g.ip = wifiIpString().s;
  std::memset(g.mac, 0x77, 6); g.macOk = wifiMac(g.mac);
  g.rssi = 12345; g.rssiOk = wifiRssi(g.rssi);
  return g;
}

int main() {
  // 1) cas sain : chaque appel s'exécute SUR la pile de 1 536 o ; résultats chez l'appelant
  podNetTestHook = recordHook; resetCalls();
  { const Got g = callAll();
    expect("sain : statut, statut avec étiquette, firmware, IP", g.st == WL_CONNECTED && g.stT == WL_CONNECTED && g.fw == "0.5.2" && g.ip == "192.168.1.5");
    expect("sain : MAC et RSSI chez l'appelant", g.macOk && std::memcmp(g.mac, g_macBytes, 6) == 0 && g.rssiOk && g.rssi == -61);
    expect("sain : un appel au module par enveloppe (status ×2, firmware, begin, mac, rssi, ip)", g_statusCalls == 2 && g_fwCalls == 1 && g_beginCalls == 1 && g_macCalls == 1 && g_rssiCalls == 1 && g_ipCalls == 1);
    expect("sain : 7 exécutions sur la pile dédiée, chacune de POD_WIFI_STACK_TOTAL - 64 = 1472 o", g_hookRuns == 7 && g_hookStackBytes == 1536u - 64u);
    expect("sain : aucune alerte journalisée", g_log.empty()); }
  podNetTestHook = nullptr;

  // 2) NOMEM : le module n'est PAS appelé ; échec fermé partout
  for (int mode = 0; mode < 2; mode++) {
    resetCalls();
    if (mode == 0) podNetTestFailAlloc = 1; else podNetTestNested = 1;
    const Got g = callAll();
    podNetTestFailAlloc = 0; podNetTestNested = 0;
    const std::string tag = mode == 0 ? "NOMEM" : "NESTED";
    expect(tag + " : le module Wi-Fi n'est JAMAIS appelé", moduleCalls() == 0);
    expect(tag + " : statut INCONNU (0xFE : ni connecté ni module absent), jamais un état fabriqué", g.st == POD_WIFI_UNKNOWN && g.stT == POD_WIFI_UNKNOWN && POD_WIFI_UNKNOWN != WL_CONNECTED && POD_WIFI_UNKNOWN != WL_NO_MODULE);
    expect(tag + " : firmware et IP « ? »", g.fw == "?" && g.ip == "?");
    expect(tag + " : MAC refusée et mise à zéro, RSSI refusé et remis à zéro", !g.macOk && g.mac[0] == 0 && g.mac[5] == 0 && !g.rssiOk && g.rssi == 0);
    expect(tag + " : journal « NON exécutée »", g_log.find("NON exécutée") != std::string::npos && g_log.find("EXÉCUTÉE") == std::string::npos);
  }

  // 3) MARGIN : le module A tourné, mais le résultat est REJETÉ — même si le module a écrit des valeurs
  podNetTestHook = touch; g_touchAt = 100; resetCalls();
  { const Got g = callAll(); podNetTestHook = nullptr;
    expect("MARGIN : le module a bien été appelé (EXÉCUTÉ)", g_statusCalls == 2 && g_fwCalls == 1 && g_beginCalls == 1 && g_macCalls == 1 && g_rssiCalls == 1 && g_ipCalls == 1);
    expect("MARGIN : statut inconnu, firmware et IP « ? »", g.st == POD_WIFI_UNKNOWN && g.stT == POD_WIFI_UNKNOWN && g.fw == "?" && g.ip == "?");
    expect("MARGIN : MAC REJETÉE et remise à zéro (le module l'avait écrite), RSSI rejeté", !g.macOk && g.mac[0] == 0 && g.mac[3] == 0 && !g.rssiOk && g.rssi == 0);
    expect("MARGIN : journal « EXÉCUTÉE mais résultat local REJETÉ »", g_log.find("EXÉCUTÉE mais résultat local REJETÉ") != std::string::npos && g_log.find("résultat IGNORÉ") != std::string::npos); }

  // 4) GUARD : arrêt sûr (logfSafeStop), aucun résultat présenté
  podNetTestHook = smashGuard;
  { int halts = 0, silent = 0;
    auto t = [&](const std::function<void()>& fn) { resetCalls(); try { fn(); } catch (const Halt&) { halts++; if (g_log.empty()) silent++; } };   // silent : AUCUNE ligne journalisée avant l arrêt
    t([] { wifiStatus(); }); t([] { wifiFirmware(); }); t([] { wifiBegin(); }); t([] { uint8_t m[6]; wifiMac(m); }); t([] { int32_t r; wifiRssi(r); }); t([] { wifiIpString(); });
    podNetTestHook = nullptr;
    expect("GUARD : chacune des six enveloppes déclenche l arrêt sûr (aucun retour)", halts == 6);
    expect("GUARD : arrêt AVANT tout journal (logf alloue au tas voisin, peut-être corrompu) : aucune ligne écrite dans les six cas", silent == 6); }

  // 5) MAC en hexadécimal manuel == « %02x:%02x:… » pour TOUTES les valeurs d'octet, dans chaque position, taille bornée à 17 + NUL
  { bool same = true; bool bounded = true;
    for (int v = 0; v < 256 && same; v++) {
      const uint8_t pat[6] = { (uint8_t)v, (uint8_t)(255 - v), (uint8_t)(v ^ 0x5A), (uint8_t)(v * 7), (uint8_t)(v + 13), (uint8_t)(v ^ 0xFF) };
      std::memcpy(g_macBytes, pat, 6);
      char want[24]; std::snprintf(want, sizeof(want), "%02x:%02x:%02x:%02x:%02x:%02x", pat[0], pat[1], pat[2], pat[3], pat[4], pat[5]);
      const String got = macString();
      if (got.s != want) same = false;
      if (got.s.size() != 17) bounded = false;
    }
    expect("macString (hexadécimal manuel) == snprintf(\"%02x:…\") pour 256 motifs d'octets", same);
    expect("macString : toujours 17 caractères (char[18] borné, NUL final)", bounded); }
  { const uint8_t def[6] = { 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 }; std::memcpy(g_macBytes, def, 6); }
  // 6) échec du module → macString VIDE (doRegister n'inscrit pas)
  podNetTestFailAlloc = 1; resetCalls();
  { const String m = macString(); podNetTestFailAlloc = 0; expect("NOMEM : macString vide, module non appelé", m.length() == 0 && g_macCalls == 0); }
  podNetTestHook = touch; g_touchAt = 50; resetCalls();
  { const String m = macString(); podNetTestHook = nullptr; expect("MARGIN : macString vide malgré une MAC lue par le module", m.length() == 0 && g_macCalls == 1); }

  if (g_fail) std::printf("FAIL %d écarts / %d vérifications\n", g_fail, g_pass + g_fail); else std::printf("PASS %d\n", g_pass);
  return g_fail ? 1 : 0;
}
