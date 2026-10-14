// consensus-pod/host/esp_mock/esp27_mock.h — SIMULATION des FRONTIÈRES propres à l'ESP8266 e-ink 2,7″ BW + OLED (LOT8B2C-ESP8266-EINK27-OLED-CANARY-1), en complément de esp_mock.h :
// Wi-Fi, bus SPI (pilote e-ink) / I2C (OLED SSD1306), système de fichiers LittleFS, broches. Rien du code du sketch n'est réimplémenté ici.
// Modèle du conflit de bus (ce que le firmware doit respecter) : le pilote e-ink utilise le SPI ; SPI.begin() prend GPIO12 (MISO) — qui est AUSSI la broche SDA de l'OLED. Après SPI.end(), l'OLED n'est de nouveau utilisable qu'APRÈS
// Wire.begin(OLED_SDA, OLED_SCL) puis oled.begin(). Toute opération du panneau sans SPI actif, ou de l'OLED pendant que le SPI est actif / sans Wire ré-initialisé, est une « VIOLATION » enregistrée dans le journal d'événements.
// Ce que cette simulation NE PROUVE PAS : la tension réelle des broches, le comportement électrique du SSD1306, la réalité du conflit GPIO12 (modélisé d'après le commentaire du sketch), les durées réelles de BUSY.
#pragma once
#include "esp_mock.h"

#define D4 2
#define D6 12
#define MSBFIRST 1
#define SPI_MODE0 0
#define SSD1306_SWITCHCAPVCC 2
#define SSD1306_WHITE 1
#define WL_CONNECTED 3

// ── Wi-Fi ───────────────────────────────────────────────────────────────────────────────────────
struct WiFiMock { int st = WL_CONNECTED; int status() { return st; } };
static WiFiMock WiFi;

// ── bus ────────────────────────────────────────────────────────────────────────────────────────
static bool g_spiActive = false, g_wireOn = false, g_gpio12Spi = false;   // g_gpio12Spi : GPIO12 est pris par le SPI (MISO) et n'est rendu qu'à Wire.begin()
static int g_spiBegins = 0, g_spiEnds = 0, g_wireBegins = 0, g_txDepth = 0;
struct SPISettings { SPISettings(uint32_t = 0, int = 0, int = 0) {} };
struct SPIMock {
  void begin() { g_spiBegins++; g_spiActive = true; g_gpio12Spi = true; ev("SPI.begin"); }
  void end() { g_spiEnds++; g_spiActive = false; ev("SPI.end"); }
  void beginTransaction(const SPISettings&) { g_txDepth++; ev("SPI.beginTransaction"); }
  void endTransaction() { if (g_txDepth > 0) g_txDepth--; ev("SPI.endTransaction"); }
};
static SPIMock SPI;
struct WireMock {
  void begin(int = 0, int = 0) { g_wireBegins++; g_wireOn = true; g_gpio12Spi = false; ev("Wire.begin"); }   // reprend GPIO12 : SDA
  void setClock(uint32_t) {}
};
static WireMock Wire;

// ── OLED SSD1306 128×64 ──────────────────────────────────────────────────────────────────────────────────
static bool g_oledBeginOk = true; static int g_oledBegins = 0, g_oledDisplays = 0; static std::vector<uint8_t> g_oledShown;
class Adafruit_SSD1306 {
 public:
  Adafruit_SSD1306(int, int, WireMock*, int) {}
  bool begin(int, int) {
    g_oledBegins++;
    if (g_spiActive) ev("VIOLATION oled.begin pendant SPI actif");
    const bool ok = g_oledBeginOk && g_wireOn && !g_gpio12Spi;   // GPIO12 encore pris par le SPI => pas de I2C
    ev(ok ? "oled.begin OK" : "oled.begin ECHEC");
    return ok;
  }
  uint8_t* getBuffer() { return buf_; }
  void clearDisplay() { std::memset(buf_, 0, sizeof buf_); }
  void display() {
    g_oledDisplays++;
    if (g_spiActive) ev("VIOLATION oled.display pendant SPI actif");
    if (g_gpio12Spi) ev("VIOLATION oled.display GPIO12 pris par le SPI");
    g_oledShown.assign(buf_, buf_ + sizeof buf_); ev("oled.display");
  }
  void setTextWrap(bool) {} void setTextSize(int) {} void setTextColor(int) {} void setCursor(int16_t, int16_t) {}
  void print(const String&) {}
  void drawBitmap(int16_t, int16_t, const uint8_t*, int16_t, int16_t, uint16_t) {}
 private:
  uint8_t buf_[1024] = {0};
};

// ── LittleFS ───────────────────────────────────────────────────────────────────────────────────────
static std::map<std::string, std::vector<uint8_t>> g_fs;
static bool g_fsOpenWriteFails = false; static long g_fsWriteFailAfter = -1;   // octets acceptés avant échec d'écriture (-1 = jamais)
class File {
 public:
  File() {}
  File(const std::string& p, bool w) : path_(p), w_(w), ok_(true) { if (w_) g_fs[path_].clear(); }
  explicit operator bool() const { return ok_; }
  size_t write(const uint8_t* b, size_t n) {
    if (!ok_ || !w_) return 0;
    if (g_fsWriteFailAfter >= 0) { long room = g_fsWriteFailAfter - (long)g_fs[path_].size(); if (room < (long)n) { if (room > 0) g_fs[path_].insert(g_fs[path_].end(), b, b + room); return room > 0 ? (size_t)room : 0; } }
    g_fs[path_].insert(g_fs[path_].end(), b, b + n); return n;
  }
  size_t read(uint8_t* b, size_t n) { if (!ok_ || w_) return 0; auto& v = g_fs[path_]; size_t k = std::min(n, v.size() - std::min(v.size(), pos_)); std::memcpy(b, v.data() + pos_, k); pos_ += k; return k; }
  void close() { ok_ = false; }
 private:
  std::string path_; bool w_ = false, ok_ = false; size_t pos_ = 0;
};
struct LittleFSMock {
  File open(const char* p, const char* mode) {
    const bool w = mode[0] == 'w';
    if (w && g_fsOpenWriteFails) return File();
    if (!w && !g_fs.count(p)) return File();
    return File(p, w);
  }
  bool exists(const char* p) { return g_fs.count(p) > 0; }
  bool remove(const char* p) { return g_fs.erase(p) > 0; }
};
static LittleFSMock LittleFS;
