// consensus-pod/host/esp_mock/esp_mock.h — SIMULATION de l'environnement Arduino ESP8266 (cœur 3.1.2) pour exécuter sur l'HÔTE le CODE RÉEL de esp_eink_2.9BWR.ino (LOT8B2C) :
// doFetchFrame, podRenderAndShow, clearDisplayWhite, initDisplayForRefresh, ackFrame, doValidate, doObsConfirm, le bloc de canari et Epd::DisplayStream (pilote). Rien d'autre n'est réimplémenté :
// ce fichier ne simule que les FRONTIÈRES (HTTP/TLS, tas, horloge, panneau, port série, mémoire RTC), avec journal d'événements et injection de pannes.
// Ce que cette simulation NE PROUVE PAS : le comportement réel de BearSSL, de lwIP, du chien de garde matériel, la fragmentation réelle du tas, les durées réelles (l'horloge est virtuelle).
#pragma once
#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstdarg>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <map>
#include <functional>
#include <algorithm>

#define PROGMEM
#define PSTR(s) (s)
class __FlashStringHelper;
#define F(s) (reinterpret_cast<const __FlashStringHelper*>(s))
typedef uint8_t byte;
#define HEX 16

// ── événements (ordre des opérations observables) ─────────────────────────────────────────────────────────
static std::vector<std::string> g_ev;
static void ev(const std::string& e) { g_ev.push_back(e); }
static int evIndex(const std::string& prefix, size_t from = 0) { for (size_t i = from; i < g_ev.size(); i++) if (g_ev[i].compare(0, prefix.size(), prefix) == 0) return (int)i; return -1; }
static int evCount(const std::string& prefix) { int n = 0; for (auto& e : g_ev) if (e.compare(0, prefix.size(), prefix) == 0) n++; return n; }

// ── horloge virtuelle ────────────────────────────────────────────────────────────────────────────────────────
static uint64_t g_us = 1000000;            // µs depuis le « démarrage »
static std::function<void()> g_pump;       // appelé à chaque avance du temps (arrivée des données du flux)
static uint32_t g_yields = 0, g_wdt = 0;
static uint32_t g_yieldCostUs = 20;        // coût simulé d'un yield() (tâches système)
static inline unsigned long millis() { return (unsigned long)(g_us / 1000); }
static inline unsigned long micros() { return (unsigned long)g_us; }
static inline void advanceUs(uint64_t us) { g_us += us; if (g_pump) g_pump(); }
static uint64_t g_lastFeedUs = 1000000, g_maxNoFeedUs = 0;   // LOT8B2C-27 : plus long intervalle sans delay() / yield() / wdtFeed() (chien de garde logiciel ≈ 3,2 s) ; mesuré par les harnais qui le lisent
static inline void noteNoFeedGap() { const uint64_t gap = g_us - g_lastFeedUs; if (gap > g_maxNoFeedUs) g_maxNoFeedUs = gap; }
struct HostHalt { int code; };
static bool g_haltOnDelayLoop = false;
static inline void delay(unsigned long ms) { advanceUs((uint64_t)ms * 1000); g_lastFeedUs = g_us; if (g_haltOnDelayLoop) throw HostHalt{ 2 }; }
static inline void yield() { g_yields++; advanceUs(g_yieldCostUs); g_lastFeedUs = g_us; }
static inline void delayMicroseconds(unsigned int us) { advanceUs(us); }

// ── String (sous-ensemble d'Arduino String, assez pour le code extrait et pour ArduinoJson) ─────────────────────
class String {
 public:
  String() {}
  String(const char* c) : s_(c ? c : "") {}
  String(const String& o) : s_(o.s_) {}
  explicit String(char c) : s_(1, c) {}
  explicit String(int v) : s_(std::to_string(v)) {}
  explicit String(unsigned v) : s_(std::to_string(v)) {}
  explicit String(long v) : s_(std::to_string(v)) {}
  explicit String(unsigned long v) : s_(std::to_string(v)) {}
  String(unsigned char v, unsigned base) { char b[16]; std::snprintf(b, sizeof b, base == 16 ? "%x" : "%u", (unsigned)v); s_ = b; }
  String& operator=(const String& o) { s_ = o.s_; return *this; }
  String& operator=(const char* c) { s_ = c ? c : ""; return *this; }
  unsigned char concat(const char* c) { if (!c) return 0; s_ += c; return 1; }
  unsigned char concat(const char* c, unsigned int n) { if (!c) return 0; s_.append(c, n); return 1; }
  String& operator+=(const char* c) { concat(c); return *this; }
  String& operator+=(const String& o) { s_ += o.s_; return *this; }
  String& operator+=(char c) { s_ += c; return *this; }
  String operator+(const String& o) const { String r(*this); r.s_ += o.s_; return r; }
  String operator+(const char* o) const { String r(*this); r.s_ += o; return r; }
  friend String operator+(const char* a, const String& b) { String r(a); r.s_ += b.s_; return r; }
  unsigned int length() const { return (unsigned int)s_.size(); }
  const char* c_str() const { return s_.c_str(); }
  char operator[](unsigned i) const { return i < s_.size() ? s_[i] : 0; }
  bool operator==(const char* c) const { return s_ == c; }
  bool operator==(const String& o) const { return s_ == o.s_; }
  bool operator!=(const char* c) const { return s_ != c; }
  bool operator!=(const String& o) const { return s_ != o.s_; }
  String substring(unsigned a, unsigned b = 0xFFFFFFFFu) const { if (a >= s_.size()) return String(); return String(s_.substr(a, b == 0xFFFFFFFFu ? std::string::npos : b - a).c_str()); }
  void remove(unsigned idx) { if (idx < s_.size()) s_.erase(idx); }
  void toLowerCase() { for (auto& c : s_) c = (char)std::tolower(c); }
  void toUpperCase() { for (auto& c : s_) c = (char)std::toupper(c); }
  void replace(const char* a, const char* b) { size_t p = 0, la = std::strlen(a); while ((p = s_.find(a, p)) != std::string::npos) { s_.replace(p, la, b); p += std::strlen(b); } }
  int indexOf(const char* c) const { size_t p = s_.find(c); return p == std::string::npos ? -1 : (int)p; }
  void reserve(unsigned) {}
  void trim() { const char* ws = " \t\r\n"; size_t b = s_.find_first_not_of(ws); if (b == std::string::npos) { s_.clear(); return; } size_t e = s_.find_last_not_of(ws); s_ = s_.substr(b, e - b + 1); }
 private:
  std::string s_;
};

// ── port série (journal capturé) ──────────────────────────────────────────────────────────────────────────────
struct SerialMock {
  std::string log;
  void print(const char* s) { log += s; }
  void print(const String& s) { log += s.c_str(); }
  void print(const __FlashStringHelper* s) { log += reinterpret_cast<const char*>(s); }
  void print(int v) { log += std::to_string(v); }
  void println() { log += "\n"; }
  void println(const char* s) { log += s; log += "\n"; }
  void println(const String& s) { log += s.c_str(); log += "\n"; }
  void println(const __FlashStringHelper* s) { log += reinterpret_cast<const char*>(s); log += "\n"; }
  void printf(const char* f, ...) __attribute__((format(printf, 2, 3))) { char b[512]; va_list ap; va_start(ap, f); std::vsnprintf(b, sizeof b, f, ap); va_end(ap); log += b; }
  void printf_P(const char* f, ...) __attribute__((format(printf, 2, 3))) { char b[512]; va_list ap; va_start(ap, f); std::vsnprintf(b, sizeof b, f, ap); va_end(ap); log += b; }
  void begin(unsigned long) {}
};
static SerialMock Serial;

// ── mémoire : malloc/free interposés (sont #define-és avant le code extrait), tas simulé ─────────────────────────────
static std::map<void*, size_t> g_allocs;
static size_t g_outstanding = 0, g_peakOutstanding = 0;
static int g_mallocCount = 0, g_failMallocAt = 0;   // g_failMallocAt = N : la N-ième allocation échoue (1 = la première)
static uint32_t g_heapTotal = 38000;                // tas libre au départ (≈ « [HEAP] après WiFi » mesuré)
static uint32_t g_tlsBytes = 0;                     // octets BearSSL actuellement tenus par un WiFiClientSecure vivant
static uint32_t g_leakBytes = 0;                    // fuite simulée à la fermeture TLS
static uint32_t g_fragBytes = 2000;                 // plus grand bloc = tas libre − g_fragBytes
static void* pod_mock_malloc(size_t n) { g_mallocCount++; if (g_failMallocAt && g_mallocCount == g_failMallocAt) { ev("malloc_fail " + std::to_string(n)); return nullptr; } void* p = std::malloc(n ? n : 1); g_allocs[p] = n; g_outstanding += n; if (g_outstanding > g_peakOutstanding) g_peakOutstanding = g_outstanding; ev("malloc " + std::to_string(n)); return p; }
static void pod_mock_free(void* p) { if (!p) return; auto it = g_allocs.find(p); if (it == g_allocs.end()) { ev("free_INVALIDE"); return; } g_outstanding -= it->second; ev("free " + std::to_string(it->second)); g_allocs.erase(it); std::free(p); }
#define malloc(n) pod_mock_malloc(n)
#define free(p) pod_mock_free(p)

// ── ESP ────────────────────────────────────────────────────────────────────────────────────────────────────────
struct HostRestart {};
struct rst_info { uint32_t reason, exccause, epc1, epc2, epc3, excvaddr, depc; };
static rst_info g_rst = { 0, 0, 0, 0, 0, 0, 0 };
static uint32_t g_rtc[128 / 4 * 4];
static uint32_t g_contStack = 3000;
struct EspMock {
  uint32_t getFreeHeap() { uint32_t used = (uint32_t)g_outstanding + g_tlsBytes + g_leakBytes; return used >= g_heapTotal ? 0 : g_heapTotal - used; }
  uint32_t getMaxFreeBlockSize() { uint32_t f = getFreeHeap(); return f > g_fragBytes ? f - g_fragBytes : 0; }
  uint8_t getHeapFragmentation() { uint32_t f = getFreeHeap(); return f ? (uint8_t)(100 - 100 * getMaxFreeBlockSize() / f) : 100; }
  uint32_t getFreeContStack() { return g_contStack; }
  void wdtFeed() { g_wdt++; g_lastFeedUs = g_us; }
  void restart() { throw HostRestart{}; }
  const rst_info* getResetInfoPtr() { return &g_rst; }
  String getResetReason() { return String("mock"); }
  bool rtcUserMemoryWrite(uint32_t off, uint32_t* d, size_t n) { std::memcpy(&g_rtc[off], d, n); return true; }
  bool rtcUserMemoryRead(uint32_t off, uint32_t* d, size_t n) { std::memcpy(d, &g_rtc[off], n); return true; }
};
static EspMock ESP;

// ── HTTP / TLS simulés ────────────────────────────────────────────────────────────────────────────────────────────
struct Scn {                               // scénario du serveur pour /api/pull-frame
  std::vector<uint8_t> body;               // octets que le serveur envoie
  int code = 200, contentLength = -2;      // -2 = body.size() ; -1 = inconnu
  bool beginFails = false;
  std::vector<size_t> chunks;              // tailles d'arrivée (répétées en boucle) ; vide = tout d'un coup
  unsigned chunkEveryMs = 1;               // intervalle entre deux arrivées
  size_t earlySurplus = 0;                 // octets en trop DÉJÀ arrivés avant la fin de la lecture
  bool blockingRead = false;               // readBytes attend len octets (comme Stream::readBytes) ou le délai
};
static Scn g_scn;
static int g_liveClients = 0;
static int g_ackCalls = 0; static bool g_ackResult = true;
static int g_httpGetCalls = 0, g_httpPostCalls = 0; static std::string g_lastPostPath;

class WiFiClient {
 public:
  size_t arrived = 0, consumed = 0, chunkIdx = 0; uint64_t nextArrivalUs = 0; bool started = false;
  void start() { started = true; nextArrivalUs = g_us; pump(); }
  void pump() {
    if (!started) return;
    while (arrived < g_scn.body.size() && g_us >= nextArrivalUs) {
      size_t c = g_scn.chunks.empty() ? g_scn.body.size() : g_scn.chunks[chunkIdx++ % g_scn.chunks.size()];
      if (c == 0) c = 1;
      arrived = std::min(g_scn.body.size(), arrived + c);
      nextArrivalUs += (uint64_t)g_scn.chunkEveryMs * 1000;
    }
  }
  int available() { pump(); return (int)(arrived - consumed); }
  size_t readBytes(uint8_t* dst, size_t len) {
    pump();
    if (g_scn.blockingRead) { uint64_t t0 = g_us; while (arrived - consumed < len && arrived < g_scn.body.size() && g_us - t0 < 20000000ull) advanceUs(1000); pump(); }
    size_t n = std::min(len, arrived - consumed); std::memcpy(dst, g_scn.body.data() + consumed, n); consumed += n; return n;
  }
  int read() { pump(); if (arrived == consumed) return -1; return g_scn.body[consumed++]; }
};
class WiFiClientSecure : public WiFiClient {
 public:
  WiFiClientSecure() { g_liveClients++; g_tlsBytes += 6200; ev("tls_ctor"); }   // pile de poussée BearSSL (StackThunk) : 6 200 o dès la construction
  ~WiFiClientSecure() { g_liveClients--; g_tlsBytes = 0; g_leakBytes += g_leakOnClose; ev("tls_dtor"); }
  void setInsecure() {}
  void tlsOpen() { g_tlsBytes += 16384 + 512 + 3500; }                          // iobufs + contextes, au connect()
  static inline uint32_t g_leakOnClose = 0;
};
class HTTPClient {
 public:
  bool begin(WiFiClientSecure& c, const String& url) { if (g_scn.beginFails) { ev("http_begin_fail"); return false; } cl_ = &c; url_ = url; ev("http_begin " + std::string(url.c_str())); return true; }
  void setTimeout(int) {}
  void useHTTP10(bool) {}
  int GET() { g_httpGetCalls++; ev("http_get"); cl_->tlsOpen(); cl_->start(); return g_scn.code; }
  WiFiClient* getStreamPtr() { return cl_; }
  WiFiClient& getStream() { return *cl_; }   // doPull : deserializeJson(doc, http.getStream())
  String getString() { std::string o; for (int c; (c = cl_->read()) >= 0;) o.push_back((char)c); return String(o.c_str()); }
  int getSize() { return g_scn.contentLength == -2 ? (int)g_scn.body.size() : g_scn.contentLength; }
  void end() { if (cl_) { while (cl_->available() > 0) cl_->read(); g_tlsBytes = 6200; } ev("http_end"); }   // comme HTTPClient::disconnect : vide le tampon puis stop() (libère les iobufs)
 private:
  WiFiClientSecure* cl_ = nullptr; String url_;
};
