// consensus-pod/host/tft28/tft28_mock.h — LOT8B2D : bibliothèques SIMULÉES pour exécuter, sur l'hôte, le firmware UNO R4 + TFT 2,8″ COMPLET (arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino, inclus tel quel) :
// Arduino (String, Serial, temps virtuel), WiFiS3 (WiFiSSLClient scripté), SPI + Adafruit_ILI9341 (fenêtre d'adressage + octets du bus -> mémoire d'image 240×320), Adafruit_STMPE610 (tactile scripté),
// SD (système de fichiers en mémoire avec pannes), EEPROM, Ed25519 / SHA256 / QRCode factices. Les mocks N'IMITENT QUE ce que le firmware appelle ; ils n'ont aucune valeur de preuve pour le matériel.
#pragma once
#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdarg>
#include <string>
#include <vector>
#include <map>
#include <functional>
#include <algorithm>
#include <malloc.h>
#if defined(_WIN32) && !defined(__GLIBC__)
// MinGW : <malloc.h> n'a ni struct mallinfo ni mallinfo() (glibc seulement). Simulation de test pour freeHeapBytes() du sketch (l'hôte ne s'en sert que pour des journaux).
struct mallinfo { int arena, ordblks, smblks, hblks, hblkhd, usmblks, fsmblks, uordblks, fordblks, keepcost; };
static inline struct mallinfo mallinfo() { struct mallinfo m = {}; m.arena = 8000; m.fordblks = 8000; return m; }
#endif

#define HEX 16
#define DEC 10
#define OUTPUT 1
#define INPUT 0
#define HIGH 1
#define LOW 0
#define A0 14
#define WL_NO_MODULE 255
#define WL_CONNECTED 3
#define WL_IDLE_STATUS 0
#define FILE_READ 0
#define FILE_WRITE 1
#define STMPE_INT_STA 0x0B
#define ECC_LOW 0
#define F(x) (reinterpret_cast<const __FlashStringHelper*>(x))
class __FlashStringHelper;

// ── temps virtuel ───────────────────────────────────────────────────────────────────────────────────────────
static uint64_t g_us = 1000000;
static void (*g_idleHook)() = nullptr;                    // appelé à chaque delay() (le réseau simulé et le tactile avancent avec le temps)
static inline unsigned long millis() { return (unsigned long)(g_us / 1000); }
static inline unsigned long micros() { return (unsigned long)g_us; }
static inline void delay(unsigned long ms) { g_us += (uint64_t)ms * 1000; if (g_idleHook) g_idleHook(); }
static inline void delayMicroseconds(unsigned int us) { g_us += us; }
static inline void pinMode(int, int) {}
static inline void digitalWrite(int, int) {}
static inline int analogRead(int) { return 512; }
struct HarnessReset { };
static inline void NVIC_SystemReset() { throw HarnessReset{}; }

// ── String (sous-ensemble d'Arduino utilisé par le firmware et par ArduinoJson) ─────────────────────────────────
static bool g_strFailArmed = false; static int g_strFailAt = 0, g_strAllocN = 0;
static inline bool strAllocOk() { if (!g_strFailArmed) return true; return ++g_strAllocN != g_strFailAt; }
class String {
 public:
  String() {}
  String(const char* c) : s_(c ? c : "") {}
  String(const String& o) : s_(o.s_) {}
  String(char c) : s_(1, c) {}
  String(int v) : s_(std::to_string(v)) {}
  String(unsigned v) : s_(std::to_string(v)) {}
  String(long v) : s_(std::to_string(v)) {}
  String(unsigned long v) : s_(std::to_string(v)) {}
  String(unsigned char v, int base) { char b[16]; std::snprintf(b, sizeof b, base == 16 ? "%x" : "%u", (unsigned)v); s_ = b; }
  String(int v, int base) { char b[24]; std::snprintf(b, sizeof b, base == 16 ? "%x" : "%d", v); s_ = b; }
  String& operator=(const String& o) { if (this == &o) return *this; if (!strAllocOk()) { s_.clear(); return *this; } s_ = o.s_; return *this; }
  String& operator=(const char* c) { s_ = c ? c : ""; return *this; }
  unsigned char reserve(unsigned int n) { s_.reserve(n); return 1; }
  unsigned char concat(const char* c) { if (!c) return 0; if (!strAllocOk()) return 0; s_ += c; return 1; }
  unsigned char concat(const char* c, unsigned int n) { if (!c) return 0; if (!strAllocOk()) return 0; s_.append(c, n); return 1; }
  unsigned char concat(char c) { if (!strAllocOk()) return 0; s_ += c; return 1; }
  String& operator+=(const char* c) { concat(c); return *this; }
  String& operator+=(char c) { concat(c); return *this; }
  String& operator+=(const String& o) { concat(o.c_str()); return *this; }
  String operator+(const String& o) const { String r(*this); r += o; return r; }
  String operator+(const char* o) const { String r(*this); r += o; return r; }
  friend String operator+(const char* a, const String& b) { String r(a); r += b; return r; }
  unsigned int length() const { return (unsigned int)s_.size(); }
  const char* c_str() const { return s_.c_str(); }
  char operator[](unsigned i) const { return i < s_.size() ? s_[i] : 0; }
  char charAt(unsigned i) const { return (*this)[i]; }
  bool operator==(const char* c) const { return s_ == c; }
  bool operator==(const String& o) const { return s_ == o.s_; }
  bool operator!=(const char* c) const { return s_ != c; }
  bool operator!=(const String& o) const { return s_ != o.s_; }
  String substring(unsigned a, unsigned b = 0xFFFFFFFFu) const { if (a > s_.size()) return String(); if (b > s_.size()) b = (unsigned)s_.size(); return String(s_.substr(a, b - a).c_str()); }
  int indexOf(const char* c) const { size_t p = s_.find(c); return p == std::string::npos ? -1 : (int)p; }
  void trim() { size_t a = s_.find_first_not_of(" \t\r\n"); if (a == std::string::npos) { s_.clear(); return; } size_t b = s_.find_last_not_of(" \t\r\n"); s_ = s_.substr(a, b - a + 1); }
  long toInt() const { return std::strtol(s_.c_str(), nullptr, 10); }
  void toUpperCase() { for (auto& c : s_) c = (char)std::toupper((unsigned char)c); }
  void replace(const char* a, const char* b) { std::string x = a, y = b; if (x.empty()) return; size_t p = 0; while ((p = s_.find(x, p)) != std::string::npos) { s_.replace(p, x.size(), y); p += y.size(); } }
 private:
  std::string s_;
};

// ── Serial ─────────────────────────────────────────────────────────────────────────────────────────────────
struct SerialMock {
  std::string log; int space = 256;
  void begin(int) {}
  explicit operator bool() const { return true; }
  int availableForWrite() const { return space; }
  void print(const char* s) { log += s; }
  void print(const __FlashStringHelper* s) { log += reinterpret_cast<const char*>(s); }
  void print(const String& s) { log += s.c_str(); }
  void print(char c) { log += c; }
  void print(unsigned long v) { log += std::to_string(v); }
  void print(unsigned v) { log += std::to_string(v); }
  void print(int v) { log += std::to_string(v); }
  void print(long v) { log += std::to_string(v); }
  void print(unsigned v, int base) { char b[16]; std::snprintf(b, sizeof b, base == 16 ? "%X" : "%u", v); log += b; }
  void println(const char* s) { log += s; log += '\n'; }
  void println(const __FlashStringHelper* s) { print(s); log += '\n'; }
  void println(const String& s) { log += s.c_str(); log += '\n'; }
  void println() { log += '\n'; }
};
static SerialMock Serial;

// ── EEPROM ─────────────────────────────────────────────────────────────────────────────────────────────────
// V4 : HarnessReset (ci-dessus) = coupure de courant / reset simulé ; l'EEPROM, elle, SURVIT
struct EEPROMMock {
  std::vector<uint8_t> m = std::vector<uint8_t>(8192, 0xFF);
  int len = 8192;                         // EEPROM.length()
  int puts = 0;                           // nombre d'appels à put() (écritures de pages)
  int cutPut = 0, cutBytes = 0, cutMode = 0;   // coupure pendant le put n°cutPut : seuls cutBytes octets sont programmés ; cutMode 0 = reste inchangé, 1 = reste mis à 0x00 ; puis HarnessReset
  bool noAlloc = false;                   // veeprom::read_block => UNABLE_TO_ALLOC : put() ne fait RIEN, sans erreur
  uint8_t read(int a) { return a >= 0 && a < (int)m.size() ? m[a] : 0xFF; }
  void update(int a, uint8_t v) { m[a] = v; }
  void write(int a, uint8_t v) { m[a] = v; }
  uint16_t length() const { return (uint16_t)len; }
  template <class T> const T& put(int a, const T& t) {
    puts++;
    if (noAlloc) return t;
    const uint8_t* q = (const uint8_t*)&t;
    if (cutPut == puts) { for (size_t i = 0; i < sizeof(T); i++) m[a + i] = (int)i < cutBytes ? q[i] : (cutMode ? 0x00 : m[a + i]); throw HarnessReset(); }
    for (size_t i = 0; i < sizeof(T); i++) m[a + i] = q[i];
    return t;
  }
  void reset() { m.assign(8192, 0xFF); len = 8192; puts = 0; cutPut = cutBytes = cutMode = 0; noAlloc = false; }
};
static EEPROMMock EEPROM;

// ── Ed25519 / SHA256 / QR factices ──────────────────────────────────────────────────────────────────────────────
#ifndef POD_HOST_REAL_CRYPTO   // LOT8B2E V1 : le harnais de VOTE (tft28_vote_harness.cpp) compile la VRAIE bibliothèque Crypto (SHA-256, Ed25519) ; les autres harnais gardent ces maquettes
struct Ed25519 {
  static void derivePublicKey(uint8_t* pub, const uint8_t* priv) { for (int i = 0; i < 32; i++) pub[i] = priv[i] ^ 0x5A; }
  static void sign(uint8_t* sig, const uint8_t* priv, const uint8_t*, const void*, size_t len) { for (int i = 0; i < 64; i++) sig[i] = (uint8_t)(priv[i % 32] + i + len); }
  static bool verify(const uint8_t* sig, const uint8_t*, const void*, size_t) { return sig != nullptr; }
};
class SHA256 { public: void reset() {} void update(const void*, size_t) {} void finalize(void* out, size_t n) { std::memset(out, 0xAB, n); } };
#endif
struct QRCode { uint8_t size; };
static inline int qrcode_getBufferSize(int v) { return 16 * v; }
static inline int qrcode_initText(QRCode*, uint8_t*, int, int, const char*) { return -1; }
static inline int qrcode_getModule(QRCode*, int, int) { return 0; }

// ── Wi-Fi ───────────────────────────────────────────────────────────────────────────────────────────────────
struct IPAddress { String toString() const { return String("10.0.0.7"); } };
struct WiFiMock {
  int st = WL_CONNECTED;
  int status() { return st; }
  void begin(const char*, const char*) {}
  void macAddress(uint8_t* m) { const uint8_t v[6] = { 0xDC, 0x54, 0x75, 0x00, 0x12, 0x34 }; std::memcpy(m, v, 6); }
  long RSSI() { return -55; }
  IPAddress localIP() { return IPAddress(); }
  const char* firmwareVersion() { return "0.5.2"; }
};
static WiFiMock WiFi;

// ── Réseau scripté : le routeur du test répond à chaque requête ─────────────────────────────────────────────────
struct NetScript {
  bool connectOk = true;
  std::string response;                      // octets envoyés par le serveur (en-têtes + corps)
  std::vector<size_t> chunks;                // tailles d'arrivée successives (cycliques) ; vide = tout d'un coup
  unsigned chunkEveryMs = 1;                 // intervalle entre deux arrivées (temps virtuel)
  size_t stallAfter = (size_t)-1;            // le serveur n'envoie plus rien après N octets (la connexion reste ouverte : timeout)
  size_t closeAfter = (size_t)-1;            // le serveur FERME la connexion après N octets (corps tronqué)
  size_t faultAfter = (size_t)-1;            // défaut collant du client TLS borné après N octets lus
};
struct NetRequest { std::string method, path, body; long busAt = 0; };
static std::vector<NetRequest> g_requests;
static long g_busNow();
static std::function<NetScript(const NetRequest&)> g_route;
static int g_liveClients = 0;
static size_t g_printShort = 0; static std::string g_printShortPath;   // V3-FIX1 : écriture PARTIELLE injectée — la requête ARRIVE au serveur simulé (octets partis) mais print() retourne N octets de moins
class WiFiSSLClient {
 public:
  WiFiSSLClient() { g_liveClients++; }
  virtual ~WiFiSSLClient() { g_liveClients--; }
  bool connect(const char*, uint16_t) { if (!g_route) return false; return connected_ = true; }   // la requête arrive avec print()
  size_t print(const String& req) {
    NetRequest r; const std::string s = req.c_str(); const size_t sp = s.find(' '), sp2 = s.find(' ', sp + 1);
    r.method = s.substr(0, sp); r.path = s.substr(sp + 1, sp2 - sp - 1); const size_t hb = s.find("\r\n\r\n"); r.body = hb == std::string::npos ? "" : s.substr(hb + 4);
    r.busAt = g_busNow(); g_requests.push_back(r);
    sc_ = g_route(r); if (!sc_.connectOk) { connected_ = false; }
    arrived_ = 0; consumed_ = 0; nextUs_ = g_us; ci_ = 0;
    if (g_printShort && r.path.rfind(g_printShortPath, 0) == 0) return s.size() > g_printShort ? s.size() - g_printShort : 0;
    return s.size();
  }
  virtual int read(uint8_t* buf, size_t n) {
    pump();
    const size_t lim = std::min(std::min(sc_.stallAfter, sc_.closeAfter), sc_.response.size());
    const size_t avail = std::min(arrived_, lim) - consumed_;
    if (avail == 0) return 0;
    const size_t k = std::min(n, avail);
    std::memcpy(buf, sc_.response.data() + consumed_, k); consumed_ += k;
    return (int)k;
  }
  virtual uint8_t connected() {
    pump();
    if (!connected_) return 0;
    if (consumed_ >= sc_.closeAfter || consumed_ >= sc_.response.size()) return 0;   // plus rien à lire : fermée
    return 1;
  }
  void stop() { connected_ = false; }
  uint8_t fault() const { return 0; }
 protected:
  void pump() {
    const size_t lim = std::min(std::min(sc_.stallAfter, sc_.closeAfter), sc_.response.size());
    while (arrived_ < lim && g_us >= nextUs_) {
      const size_t step = sc_.chunks.empty() ? lim : sc_.chunks[ci_++ % sc_.chunks.size()];
      arrived_ = std::min(lim, arrived_ + std::max<size_t>(1, step)); nextUs_ += (uint64_t)sc_.chunkEveryMs * 1000;
    }
  }
  NetScript sc_; bool connected_ = false; size_t arrived_ = 0, consumed_ = 0, ci_ = 0; uint64_t nextUs_ = 0;
  friend class PodBoundedSSL;
};

// ── SPI + TFT ILI9341 : les octets du bus remplissent la fenêtre d'adressage ───────────────────────────────────────
#define TFT_W 240
#define TFT_H 320
struct TftState {
  std::vector<uint16_t> fb = std::vector<uint16_t>(TFT_W * TFT_H, 0);
  int wx = 0, wy = 0, ww = 0, wh = 0; size_t wpos = 0; bool inWindow = false;
  long busBytes = 0, windows = 0, fills = 0, texts = 0, fillsMain = 0;   // fillsMain : dessins faits PENDANT que SP est sur la pile principale (REGISTER-STACK-FIX2)
  std::string text;                             // tout le texte imprimé depuis la remise à zéro
  int cx = 0, cy = 0, size = 1; uint16_t fg = 0xFFFF, bg = 0;
  uint8_t odd = 0, hi = 0;                      // octet haut en attente
};
static TftState g_tft;
static bool (*g_onMainStackHook)() = nullptr;   // renseigné par le harnais : « SP est-il sur la pile principale ? »
static long g_busNow() { return g_tft.busBytes; }
struct SPIMock {
  void transfer(void* buf, size_t n) {
    uint8_t* b = static_cast<uint8_t*>(buf);
    for (size_t i = 0; i < n; i++) {
      g_tft.busBytes++;
      if (!g_tft.inWindow) continue;
      if (!g_tft.odd) { g_tft.hi = b[i]; g_tft.odd = 1; continue; }
      g_tft.odd = 0;
      const uint16_t v = (uint16_t)((g_tft.hi << 8) | b[i]);
      if (g_tft.wpos < (size_t)g_tft.ww * g_tft.wh) {
        const int x = g_tft.wx + (int)(g_tft.wpos % g_tft.ww), y = g_tft.wy + (int)(g_tft.wpos / g_tft.ww);
        if (x >= 0 && x < TFT_W && y >= 0 && y < TFT_H) g_tft.fb[y * TFT_W + x] = v;
      }
      g_tft.wpos++;
    }
    g_us += n / 4;                              // ≈ 8 Mo/s
  }
  uint8_t transfer(uint8_t v) { return v; }
};
static SPIMock SPI;
class Adafruit_GFX {};
class Adafruit_ILI9341 {
 public:
  Adafruit_ILI9341(int, int) {}
  void begin() {}
  void setRotation(int) {}
  void startWrite() {}
  void endWrite() { g_tft.inWindow = false; }
  void setAddrWindow(int x, int y, int w, int h) { g_tft.wx = x; g_tft.wy = y; g_tft.ww = w; g_tft.wh = h; g_tft.wpos = 0; g_tft.inWindow = true; g_tft.odd = 0; g_tft.windows++; }
  void fillRect(int x, int y, int w, int h, uint16_t c) { g_tft.fills++; if (g_onMainStackHook && g_onMainStackHook()) g_tft.fillsMain++; for (int j = y; j < y + h; j++) for (int i = x; i < x + w; i++) if (i >= 0 && i < TFT_W && j >= 0 && j < TFT_H) g_tft.fb[j * TFT_W + i] = c; }
  void fillScreen(uint16_t c) { fillRect(0, 0, TFT_W, TFT_H, c); }
  void drawFastHLine(int x, int y, int w, uint16_t c) { fillRect(x, y, w, 1, c); }
  void setTextSize(int s) { g_tft.size = s; }
  void setTextColor(uint16_t f) { g_tft.fg = f; g_tft.bg = f; }
  void setTextColor(uint16_t f, uint16_t b) { g_tft.fg = f; g_tft.bg = b; }
  void setCursor(int x, int y) { g_tft.cx = x; g_tft.cy = y; }
  void print(const char* s) { g_tft.texts++; g_tft.text += s; for (; *s; s++) { const int s_ = g_tft.size; fillRect(g_tft.cx, g_tft.cy, 6 * s_, 8 * s_, g_tft.bg); fillRect(g_tft.cx + s_, g_tft.cy + s_, 4 * s_, 6 * s_, g_tft.fg); g_tft.cx += 6 * s_; } }
  void print(const String& s) { print(s.c_str()); }
};

// ── tactile STMPE610 : scénario = nombre d'interrogations pendant lesquelles « touched() » reste vrai ───────────────────────
struct TsPoint { int x, y, z; };
static int g_touchPressedPolls = 0; static long g_touchPollCount = 0;
class Adafruit_STMPE610 {
 public:
  Adafruit_STMPE610(int) {}
  bool begin() { return true; }
  bool touched() { g_touchPollCount++; if (g_touchPressedPolls > 0) { g_touchPressedPolls--; return true; } return false; }
  bool bufferEmpty() { return true; }
  TsPoint getPoint() { return { 0, 0, 0 }; }
  void writeRegister8(uint8_t, uint8_t) {}
};

// ── microSD en mémoire, avec pannes ───────────────────────────────────────────────────────────────────────────────
struct SdState {
  std::map<std::string, std::vector<uint8_t>> files; std::vector<std::string> dirs;
  bool beginOk = true, failOpenWrite = false, failRemove = false;
  long writeBudget = -1;                         // octets encore acceptés en écriture (-1 = illimité) : carte pleine
  long readFailAt = -1;                          // lecture d'un fichier : échec à partir de cet offset
  long opens = 0, writes = 0, reads = 0, removes = 0;
};
static SdState g_sd;
class File {
 public:
  File() {}
  File(const std::string& p, int mode) : path_(p), mode_(mode), ok_(true) { if (mode == FILE_WRITE) { pos_ = g_sd.files[p].size(); } }
  explicit operator bool() const { return ok_; }
  unsigned long size() { return ok_ ? g_sd.files[path_].size() : 0; }
  bool seek(uint32_t p) { if (!ok_ || p > g_sd.files[path_].size()) return false; pos_ = p; return true; }
  int read(uint8_t* buf, size_t n) {
    if (!ok_) return -1; auto& v = g_sd.files[path_]; g_sd.reads++;
    if (g_sd.readFailAt >= 0 && (long)(pos_ + n) > g_sd.readFailAt) { const long avail = g_sd.readFailAt - (long)pos_; const size_t k = avail > 0 ? (size_t)avail : 0; std::memcpy(buf, v.data() + pos_, std::min(k, n)); pos_ += std::min(k, n); return (int)std::min(k, n); }
    const size_t k = std::min(n, v.size() - std::min(v.size(), pos_)); std::memcpy(buf, v.data() + pos_, k); pos_ += k; return (int)k;
  }
  size_t write(const uint8_t* buf, size_t n) {
    if (!ok_ || mode_ != FILE_WRITE) return 0; g_sd.writes++;
    size_t k = n; if (g_sd.writeBudget >= 0) { k = (size_t)std::min<long>((long)n, g_sd.writeBudget); g_sd.writeBudget -= (long)k; }
    auto& v = g_sd.files[path_]; v.insert(v.end(), buf, buf + k); pos_ += k; return k;
  }
  void println(const String& s) { const std::string t = std::string(s.c_str()) + "\n"; write((const uint8_t*)t.data(), t.size()); }
  void println(const char* s) { println(String(s)); }
  void println(int v) { println(String(v)); }
  String readStringUntil(char term) { String r; auto& v = g_sd.files[path_]; while (pos_ < v.size()) { char c = (char)v[pos_++]; if (c == term) break; r += c; } return r; }
  void close() { ok_ = false; }
 private:
  std::string path_; int mode_ = 0; bool ok_ = false; size_t pos_ = 0;
};
struct SDMock {
  bool begin(int) { return g_sd.beginOk; }
  bool exists(const char* p) { return g_sd.files.count(p) || std::find(g_sd.dirs.begin(), g_sd.dirs.end(), p) != g_sd.dirs.end(); }
  bool mkdir(const char* p) { g_sd.dirs.push_back(p); return true; }
  bool remove(const char* p) { g_sd.removes++; if (g_sd.failRemove) return false; return g_sd.files.erase(p) > 0; }
  File open(const char* p, int mode = FILE_READ) {
    g_sd.opens++;
    if (mode == FILE_READ) { if (!g_sd.files.count(p)) return File(); return File(p, FILE_READ); }
    if (g_sd.failOpenWrite) return File();
    g_sd.files[p];                                // création
    return File(p, FILE_WRITE);
  }
};
static SDMock SD;
