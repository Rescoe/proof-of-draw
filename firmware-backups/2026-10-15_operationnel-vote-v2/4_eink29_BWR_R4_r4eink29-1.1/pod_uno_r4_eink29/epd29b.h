// epd29b.h — pilote minimal du module Waveshare « 2.9inch e-Paper Module (B) » V4 (SSD1680, 128×296, noir/blanc/rouge)
// pour l'UNO R4 WiFi. Séquences d'init/affichage identiques à esp8266/esp_eink_2.9BWR/epd2in9b_V4.cpp (celui qui tourne en production),
// avec UNE correction : la polarité de BUSY (voir waitBusy).
//
// Buffers : 128 px de large (16 octets/ligne) × 296 lignes = 4736 octets chacun.
//   noir  : bit à 0 = pixel noir   (0xFF = blanc)
//   rouge : bit à 0 = pixel rouge  (0xFF = pas de rouge) — le pilote envoie ~rouge dans la RAM 0x26, comme le pilote Waveshare.

#ifndef EPD29B_H
#define EPD29B_H

#include <Arduino.h>
#include <SPI.h>

// ─── BROCHES (UNO R4 WiFi) — SPI matériel : DIN = D11 (COPI), CLK = D13 (SCK) ───
#ifndef EPD_CS_PIN
#define EPD_CS_PIN    10
#endif
#ifndef EPD_DC_PIN
#define EPD_DC_PIN    9
#endif
#ifndef EPD_RST_PIN
#define EPD_RST_PIN   8
#endif
#ifndef EPD_BUSY_PIN
#define EPD_BUSY_PIN  7
#endif

#define EPD_WIDTH          128
#define EPD_HEIGHT         296
#define EPD_BYTES_PER_ROW  (EPD_WIDTH / 8)               // 16
#define EPD_BUF_SIZE       (EPD_BYTES_PER_ROW * EPD_HEIGHT)  // 4736

class Epd29b {
 public:
  void begin() {
    pinMode(EPD_CS_PIN, OUTPUT);  digitalWrite(EPD_CS_PIN, HIGH);
    pinMode(EPD_DC_PIN, OUTPUT);  digitalWrite(EPD_DC_PIN, LOW);
    pinMode(EPD_RST_PIN, OUTPUT); digitalWrite(EPD_RST_PIN, HIGH);
    pinMode(EPD_BUSY_PIN, INPUT);
    SPI.begin();
  }

  /** Réveille le panneau (reset matériel) et le configure. false = BUSY ne retombe jamais (câblage ?). */
  bool init() {
    reset();
    if (!waitBusy(5000)) return false;
    command(0x12);                       // SWRESET
    delay(20);
    if (!waitBusy(5000)) return false;

    command(0x01);                       // Driver output control
    data((EPD_HEIGHT - 1) % 256); data((EPD_HEIGHT - 1) / 256); data(0x00);
    command(0x11); data(0x03);           // Data entry mode : X+, Y+
    command(0x44); data(0x00); data(EPD_WIDTH / 8 - 1);                                   // RAM X
    command(0x45); data(0x00); data(0x00); data((EPD_HEIGHT - 1) % 256); data((EPD_HEIGHT - 1) / 256);   // RAM Y
    command(0x3C); data(0x05);           // Border waveform
    command(0x21); data(0x00); data(0x80);   // Display update control 1
    command(0x18); data(0x80);           // Capteur de température interne
    command(0x4E); data(0x00);           // Compteur X
    command(0x4F); data(0x00); data(0x00);   // Compteur Y
    return waitBusy(5000);
  }

  /** Envoie les deux plans et lance le rafraîchissement complet (~15 s). false = le panneau n'a pas fini (BUSY resté actif). */
  bool display(const uint8_t* black, const uint8_t* red) {
    writeRam(0x24, black, 0xFF, false);
    writeRam(0x26, red, 0xFF, true);     // ~rouge
    return refresh();
  }

// POD_RENDER_V1_BEGIN
  /**
   * Rendu en flux (lot 8B-2A) : `produce(ctx, out, cap)` remplit `out` d'au plus `cap` octets et retourne leur nombre (0 = fin ou erreur). Mêmes écritures que display() : plan noir (0x24) tel quel, plan rouge (0x26)
   * INVERSÉ (~octet), sans tampon intermédiaire ; un appel de `produce` ne franchit jamais la frontière entre les plans. Retourne 0 = rafraîchi (BUSY retombé) ; -1 = production interrompue (le rafraîchissement n'est PAS lancé ; la RAM du panneau est partiellement écrite,
   * il garde son état physique du moment, éventuellement une page blanche) ; -2 = TOUTES les données et la commande de rafraîchissement ont été envoyées, mais BUSY n'est pas retombé dans le délai : la fin physique du rafraîchissement n'est PAS confirmée (l'image peut être affichée). Le chunk (32 o) vit sur la pile : l'appelant garde ses gros objets en global (pile principale R4 : 1 Ko).
   */
  typedef uint32_t (*ProduceFn)(void* ctx, uint8_t* out, uint32_t cap);
  int8_t displayStream(ProduceFn produce, void* ctx) {
    uint8_t chunk[32];
    for (uint8_t plane = 0; plane < 2; plane++) {
      command(plane == 0 ? 0x24 : 0x26);
      SPI.beginTransaction(settings());
      digitalWrite(EPD_DC_PIN, HIGH);
      digitalWrite(EPD_CS_PIN, LOW);
      uint32_t sent = 0;
      while (sent < EPD_BUF_SIZE) {
        const uint32_t left = EPD_BUF_SIZE - sent, cap = left < sizeof(chunk) ? left : (uint32_t)sizeof(chunk);
        const uint32_t n = produce(ctx, chunk, cap);
        if (n == 0 || n > cap) { digitalWrite(EPD_CS_PIN, HIGH); SPI.endTransaction(); return -1; }
        for (uint32_t i = 0; i < n; i++) SPI.transfer(plane == 0 ? chunk[i] : (uint8_t)~chunk[i]);
        sent += n;
      }
      digitalWrite(EPD_CS_PIN, HIGH);
      SPI.endTransaction();
    }
    return refresh() ? 0 : -2;
  }
// POD_RENDER_V1_END

  /** Page entièrement blanche (efface les rémanences avant une nouvelle image). */
  bool displayWhite() {
    writeRam(0x24, nullptr, 0xFF, false);
    writeRam(0x26, nullptr, 0xFF, true); // 0xFF inversé = 0x00 : pas de rouge
    return refresh();
  }

  /** Veille profonde : consommation ~0, l'image reste affichée. Un nouveau init() (reset) est nécessaire ensuite. */
  void sleep() { command(0x10); data(0x01); }

 private:
  static SPISettings settings() { return SPISettings(2000000, MSBFIRST, SPI_MODE0); }

  void reset() {
    digitalWrite(EPD_RST_PIN, HIGH); delay(20);
    digitalWrite(EPD_RST_PIN, LOW);  delay(20);
    digitalWrite(EPD_RST_PIN, HIGH); delay(200);
  }

  /** BUSY = HAUT pendant que le contrôleur SSD1680 travaille, BAS quand il est prêt (polarité du pilote officiel Waveshare V4).
   *  (Le pilote ESP du dépôt attend l'inverse : il ne « bloque » donc que par ses temporisations.) */
  bool waitBusy(unsigned long timeoutMs) {
    const unsigned long t0 = millis();
    while (digitalRead(EPD_BUSY_PIN) == HIGH) {
      if (millis() - t0 > timeoutMs) { Serial.println(F("[EPD] BUSY reste actif (timeout) : vérifier le fil BUSY -> D7")); return false; }
      delay(10);
    }
    delay(10);
    return true;
  }

  bool refresh() {
    command(0x22); data(0xF7);           // Display update control 2 : séquence complète
    command(0x20);                       // Master activation
    delay(100);                          // laisse BUSY monter avant de le lire
    return waitBusy(40000);
  }

  void command(uint8_t c) {
    SPI.beginTransaction(settings());
    digitalWrite(EPD_DC_PIN, LOW);
    digitalWrite(EPD_CS_PIN, LOW);
    SPI.transfer(c);
    digitalWrite(EPD_CS_PIN, HIGH);
    SPI.endTransaction();
  }
  void data(uint8_t d) {
    SPI.beginTransaction(settings());
    digitalWrite(EPD_DC_PIN, HIGH);
    digitalWrite(EPD_CS_PIN, LOW);
    SPI.transfer(d);
    digitalWrite(EPD_CS_PIN, HIGH);
    SPI.endTransaction();
  }
  /** Commande + un plan complet (4736 octets) sous un seul CS. buf == nullptr : octet constant « fill ». */
  void writeRam(uint8_t cmd, const uint8_t* buf, uint8_t fill, bool invert) {
    command(cmd);
    SPI.beginTransaction(settings());
    digitalWrite(EPD_DC_PIN, HIGH);
    digitalWrite(EPD_CS_PIN, LOW);
    for (size_t i = 0; i < EPD_BUF_SIZE; i++) {
      uint8_t b = buf ? buf[i] : fill;
      SPI.transfer(invert ? (uint8_t)~b : b);
    }
    digitalWrite(EPD_CS_PIN, HIGH);
    SPI.endTransaction();
  }
};

#endif  // EPD29B_H
