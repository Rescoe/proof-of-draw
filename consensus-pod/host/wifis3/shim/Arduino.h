// consensus-pod/host/wifis3/shim/Arduino.h — SIMULATION minimale de l'API Arduino + du MODULE AT (pont ESP32-S3 de la UNO R4 WiFi) pour compiler sur l'HÔTE
// le VRAI WiFiSSLClient.cpp / WiFiClient.cpp / Modem.cpp des cœurs Renesas 1.5.3 et 1.6.0 (PULLFRAME-BOUNDED-SSL-FIX1). Rien du cœur n'est modifié ni copié dans le dépôt.
//   • horloge VIRTUELLE : millis() avance de 1 ms à chaque appel, delay(n) de n ms (les délais d'attente de 10 s du modem s'épuisent en un instant) ;
//   • UART simulé : analyse les commandes AT émises PAR LE VRAI Modem::write (octets exacts, journal complet) et répond comme le pont (« \r\n+CMD:<n>|<octets>\r\nOK\r\n ») ;
//   • tas contraint : operator new/delete globaux du HARNAIS (jamais du firmware) avec bloc contigu maximal et total vivant maximal ; un refus lève HeapAbort (= l'abort() de la carte).
#pragma once
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <string>
#include <memory>
#include <new>
#include <cstdarg>
#include <vector>
#include <algorithm>

namespace arduino {}
using namespace arduino;
#define byte uint8_t   /* après les en-têtes standard : évite l'ambiguïté avec std::byte (le cœur fait « using namespace std ») */
#define synchronized
#define ARDUINO_UNOWIFIR4 1
#define D24 24
#define D25 25

inline uint32_t g_clockMs = 0;
inline uint32_t millis() { return ++g_clockMs; }
inline void delay(uint32_t ms) { g_clockMs += ms; }

struct String {
  std::string s;
  String() {}
  String(const std::string& x) : s(x) {}
  const char* c_str() const { return s.c_str(); }
};

class Print {
 public:
  virtual ~Print() {}
  virtual size_t write(uint8_t) = 0;
  virtual size_t write(const uint8_t* b, size_t n) { size_t k = 0; while (k < n && write(b[k])) k++; return k; }
  size_t write(const char* s) { return write((const uint8_t*)s, strlen(s)); }
  size_t print(const char*) { return 0; } size_t print(char) { return 0; } size_t print(int) { return 0; } size_t print(unsigned) { return 0; }
  size_t println() { return 0; } size_t println(const char*) { return 0; } size_t println(int) { return 0; } size_t println(unsigned) { return 0; }
};
class Stream : public Print {
 public:
  virtual int available() = 0;
  virtual int read() = 0;
  virtual int peek() = 0;
};
class IPAddress {
 public:
  IPAddress() {}
  IPAddress(uint8_t, uint8_t, uint8_t, uint8_t) {}
  String toString() const { return String(std::string("0.0.0.0")); }
  bool fromString(const char*) { return true; }
};
class Client : public Stream {
 public:
  virtual int connect(IPAddress ip, uint16_t port) = 0;
  virtual int connect(const char* host, uint16_t port) = 0;
  virtual size_t write(uint8_t) = 0;
  virtual size_t write(const uint8_t* buf, size_t size) = 0;
  virtual int available() = 0;
  virtual int read() = 0;
  virtual int read(uint8_t* buf, size_t size) = 0;
  virtual int peek() = 0;
  virtual void flush() = 0;
  virtual void stop() = 0;
  virtual uint8_t connected() = 0;
  virtual operator bool() = 0;
};

// ─── tas contraint (harnais seulement) ────────────────────────────────────────────────────────────────────────────────────────────────────────────
struct HeapAbort { size_t request; size_t live; };
inline bool g_heapArmed = false;
inline size_t g_blockLimit = (size_t)-1, g_liveLimit = (size_t)-1, g_live = 0, g_peakLive = 0, g_peakBlock = 0, g_allocCount = 0;
inline void heapReset(size_t blockLimit, size_t liveLimit) { g_blockLimit = blockLimit; g_liveLimit = liveLimit; g_live = 0; g_peakLive = 0; g_peakBlock = 0; g_allocCount = 0; }

// ─── module AT simulé ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
struct FakeModule {
  static constexpr size_t kLog = 4096;
  const uint8_t* stream = nullptr; size_t total = 0;      // réponse serveur complète (côté TLS du module)
  size_t initialArrived = 0, perCmd = 0;                  // arrivée progressive : octets déjà arrivés + octets arrivant à chaque commande AT
  size_t taken = 0, cmdCount = 0;                         // octets déjà remis à l'hôte ; commandes AT reçues
  bool closedWhenDone = true;                             // le serveur ferme après le dernier octet
  int errorEveryN = 0;                                    // si > 0 : la N-ième, 2N-ième… commande RECEIVE reste SANS réponse (délai du modem), sans rien consommer
  int overlongExtra = 0;                                  // si > 0 : le module répond (demandé + extra) octets (module défectueux)
  bool dropTail = false;                                  // annonce n octets mais n'en envoie que n-1 (réponse coupée)
  // journal
  int recvSizes[kLog]; size_t nRecv = 0; size_t maxRecvSize = 0; size_t totalCmds = 0;
  char cmdLog[64][96]; int nCmdLog = 0;
  // état d'analyse
  char line[160]; size_t ll = 0;
  uint8_t out[4096 + 512]; size_t oh = 0, ot = 0;

  void reset() { stream = nullptr; total = 0; initialArrived = perCmd = 0; taken = cmdCount = 0; closedWhenDone = true; errorEveryN = 0; overlongExtra = 0; dropTail = false;
                 nRecv = 0; maxRecvSize = 0; totalCmds = 0; nCmdLog = 0; ll = 0; oh = ot = 0; }
  size_t arrived() const { size_t a = initialArrived + cmdCount * perCmd; return a > total ? total : a; }
  size_t unread() const { return arrived() - taken; }
  void emit(const char* s) { while (*s) out[ot++] = (uint8_t)*s++; }
  void emitN(const uint8_t* p, size_t n) { for (size_t i = 0; i < n; i++) out[ot++] = p[i]; }
  void handle() {                                         // une ligne « AT+NOM=args\r\n » complète
    cmdCount++; totalCmds++;
    if (nCmdLog < 64) { strncpy(cmdLog[nCmdLog], line, 95); cmdLog[nCmdLog][95] = 0; nCmdLog++; }
    char name[48]; size_t k = 0; const char* p = line + 2;  // saute « AT »
    while (*p && *p != '=' && *p != '\r' && k < 47) name[k++] = *p++;
    name[k] = 0;
    char args[96] = {0}; if (*p == '=') { strncpy(args, p + 1, 95); char* cr = strchr(args, '\r'); if (cr) *cr = 0; }
    char head[64]; snprintf(head, sizeof head, "\r\n%s:", name);
    if (!strcmp(name, "+SSLCLIENTRECEIVE")) {
      int sock = 0, want = 0; sscanf(args, "%d,%d", &sock, &want);
      if (nRecv < kLog) recvSizes[nRecv++] = want;
      if ((size_t)want > maxRecvSize) maxRecvSize = (size_t)want;
      if (want <= 0 || (errorEveryN > 0 && (int)(nRecv % errorEveryN) == 0)) { if (want <= 0) emit("\r\n+SSLCLIENTRECEIVE:\r\nERROR\r\n"); return; }   /* silence = délai de 10 s du modem, rien de consommé */
      size_t take = unread() < (size_t)want ? unread() : (size_t)want;
      size_t declared = take;
      if (overlongExtra > 0) { declared = (size_t)want + (size_t)overlongExtra; if (declared > unread()) declared = unread(); take = declared; }
      emit(head); char num[24]; snprintf(num, sizeof num, "%zu|", declared); emit(num);
      size_t send = (dropTail && take > 0) ? take - 1 : take;
      emitN(stream + taken, send); taken += take;
      if (dropTail) return;                                // pas de « OK » : l'analyseur du cœur attend la fin (délai)
      emit("\r\nOK\r\n"); return;
    }
    if (!strcmp(name, "+SSLAVAILABLE")) { char num[24]; snprintf(num, sizeof num, "%zu", unread()); emit(head); emit(num); emit("\r\nOK\r\n"); return; }
    if (!strcmp(name, "+SSLCLIENTCONNECTED")) { bool c = !(closedWhenDone && arrived() == total && unread() == 0); emit(head); emit(c ? "1" : "0"); emit("\r\nOK\r\n"); return; }
    if (!strcmp(name, "+SSLBEGINCLIENT")) { emit(head); emit("0"); emit("\r\nOK\r\n"); return; }
    emit(head); emit("\r\nOK\r\n");
  }
};
inline FakeModule g_mod;

class UART {
 public:
  UART() {}
  UART(int, int) {}
  void begin(int) {}
  void flush() {}
  void end() {}
  size_t write(const uint8_t* b, size_t n) {
    for (size_t i = 0; i < n; i++) {
      if (g_mod.ll < sizeof g_mod.line - 1) g_mod.line[g_mod.ll++] = (char)b[i];
      if (g_mod.ll >= 2 && g_mod.line[g_mod.ll - 2] == '\r' && g_mod.line[g_mod.ll - 1] == '\n') { g_mod.line[g_mod.ll] = 0; g_mod.handle(); g_mod.ll = 0; }
    }
    return n;
  }
  int available() { return (int)(g_mod.ot - g_mod.oh); }
  int read() { int c = g_mod.oh < g_mod.ot ? g_mod.out[g_mod.oh++] : -1; if (g_mod.oh == g_mod.ot) g_mod.oh = g_mod.ot = 0; return c; }
};
inline UART Serial2;
