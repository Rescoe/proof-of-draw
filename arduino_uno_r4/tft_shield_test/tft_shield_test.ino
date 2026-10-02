/*
 * tft_shield_test.ino — test clé en main du shield « 2.8" TFT Touch » (ILI9341 + STMPE610 + microSD)
 * sur Arduino UNO R4 WiFi.
 *
 * Câblage standard du shield Adafruit 1651 (résistif, STMPE610) :
 *   TFT  : CS = 10, DC = 9      (SPI matériel : D11 MOSI, D12 MISO, D13 SCK / en-tête ICSP)
 *   Tactile STMPE610 : CS = 8
 *   microSD : CS = 4
 * Si l'écran reste noir ET que le tactile est signalé « non détecté », ton shield a peut-être TFT/tactile inversés :
 * décommente `#define SWAP_TFT_TOUCH_CS` ci-dessous.
 *
 * Bibliothèques (Gestionnaire de bibliothèques) : Adafruit ILI9341, Adafruit GFX Library, Adafruit STMPE610, Adafruit BusIO.
 * Carte : « Arduino UNO R4 WiFi » (cœur « Arduino UNO R4 Boards »). Moniteur série : 115200 bauds.
 *
 * Déroulé (≈ 25 s) : couleurs → 4 rotations → dégradés/textes → vitesse de remplissage → lecture microSD
 *                    → écran-bilan → calibration tactile (3 croix à toucher) → mode dessin au doigt.
 * Moniteur série : 'r' = rejouer tous les tests, 'c' = recalibrer le tactile + dessin.
 * Le script ne MODIFIE jamais la carte SD (lecture seule) ; une carte vide mais formatée FAT/FAT32 est parfaitement normale.
 */

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Adafruit_STMPE610.h>
#include <SD.h>

// #define SWAP_TFT_TOUCH_CS          // décommenter si TFT = 8 et tactile = 10 sur ton exemplaire
#ifdef SWAP_TFT_TOUCH_CS
  #define TFT_CS   8
  #define STMPE_CS 10
#else
  #define TFT_CS   10
  #define STMPE_CS 8
#endif
#define TFT_DC 9
#define SD_CS  4

Adafruit_ILI9341  tft(TFT_CS, TFT_DC);
Adafruit_STMPE610 ts(STMPE_CS);

static bool   tftOk = false, touchOk = false, sdOk = false, sdPresent = false;
static int    sdEntries = 0;
static uint32_t fillMs = 0;
static uint8_t diag[5] = {0, 0, 0, 0, 0};

// calibration tactile (remplie par la calibration à 3 croix)
struct Cal { bool valid; bool swapXY; int a0, a1, b0, b2; } cal = { false, false, 0, 0, 0, 0 };
static const int MARGIN = 20;

// ---------------------------------------------------------------- utilitaires d'affichage
static void centerText(const char* s, int y, uint8_t size, uint16_t color) {
  tft.setTextSize(size);
  tft.setTextColor(color);
  int w = (int)strlen(s) * 6 * size;
  tft.setCursor((tft.width() - w) / 2, y);
  tft.print(s);
}

static void bigLabel(const char* s, uint16_t bg, uint16_t fg) {
  tft.fillScreen(bg);
  centerText(s, tft.height() / 2 - 8, 3, fg);
}

// ---------------------------------------------------------------- tests d'affichage
static void testColors() {
  tft.setRotation(0);
  bigLabel("ROUGE", ILI9341_RED, ILI9341_WHITE);     delay(600);
  bigLabel("VERT", ILI9341_GREEN, ILI9341_BLACK);    delay(600);
  bigLabel("BLEU", ILI9341_BLUE, ILI9341_WHITE);     delay(600);
  bigLabel("BLANC", ILI9341_WHITE, ILI9341_BLACK);   delay(600);
  bigLabel("NOIR", ILI9341_BLACK, ILI9341_WHITE);    delay(600);
  // si « ROUGE » s'affiche bleu (et inversement), l'ordre des couleurs est inversé : à signaler
}

static void testRotations() {
  for (uint8_t r = 0; r < 4; r++) {
    tft.setRotation(r);
    const int w = tft.width(), h = tft.height();
    tft.fillScreen(ILI9341_BLACK);
    tft.drawRect(0, 0, w, h, ILI9341_WHITE);
    tft.fillRect(1, 1, 18, 18, ILI9341_RED);                    // coin haut-gauche  : rouge
    tft.fillRect(w - 19, 1, 18, 18, ILI9341_GREEN);             // haut-droite       : vert
    tft.fillRect(1, h - 19, 18, 18, ILI9341_BLUE);              // bas-gauche        : bleu
    tft.fillRect(w - 19, h - 19, 18, 18, ILI9341_YELLOW);       // bas-droite        : jaune
    char buf[32];
    snprintf(buf, sizeof(buf), "ROTATION %u", r);
    centerText(buf, h / 2 - 20, 2, ILI9341_CYAN);
    snprintf(buf, sizeof(buf), "%d x %d", w, h);
    centerText(buf, h / 2 + 4, 2, ILI9341_WHITE);
    delay(900);
  }
  tft.setRotation(0);
}

static void testGradients() {
  tft.setRotation(0);
  const int w = tft.width();
  tft.fillScreen(ILI9341_BLACK);
  for (int x = 0; x < w; x++) {
    const uint8_t v = (uint8_t)(x * 255L / (w - 1));
    tft.drawFastVLine(x,  10, 40, tft.color565(v, 0, 0));
    tft.drawFastVLine(x,  55, 40, tft.color565(0, v, 0));
    tft.drawFastVLine(x, 100, 40, tft.color565(0, 0, v));
    tft.drawFastVLine(x, 145, 40, tft.color565(v, v, v));
  }
  tft.setTextColor(ILI9341_WHITE);
  tft.setTextSize(1); tft.setCursor(4, 195);  tft.print("Taille 1 : Proof of Draw / ANA 0123456789");
  tft.setTextSize(2); tft.setCursor(4, 212);  tft.print("Taille 2 : PoD");
  tft.setTextSize(3); tft.setCursor(4, 240);  tft.print("Taille 3");
  tft.drawLine(0, 275, w - 1, 319, ILI9341_MAGENTA);
  tft.drawLine(w - 1, 275, 0, 319, ILI9341_ORANGE);
  tft.drawCircle(w / 2, 297, 20, ILI9341_CYAN);
  tft.fillCircle(w / 2, 297, 8, ILI9341_YELLOW);
  delay(3000);
}

static void testSpeed() {
  tft.setRotation(0);
  const uint32_t t0 = micros();
  for (int i = 0; i < 6; i++) tft.fillScreen((i & 1) ? ILI9341_WHITE : ILI9341_BLACK);
  fillMs = (micros() - t0) / 6000;   // ms par remplissage plein écran
}

// ---------------------------------------------------------------- microSD (lecture seule)
static void testSd() {
  sdOk = false; sdPresent = false; sdEntries = 0;
  digitalWrite(TFT_CS, HIGH); digitalWrite(STMPE_CS, HIGH);
  if (SD.begin(SD_CS)) {
    sdPresent = true; sdOk = true;
    File root = SD.open("/");
    if (root) {
      while (true) {
        File f = root.openNextFile();
        if (!f) break;
        sdEntries++;
        f.close();
      }
      root.close();
    }
  }
  digitalWrite(SD_CS, HIGH);
}

// ---------------------------------------------------------------- bilan
static void line(int y, const char* label, bool ok, const char* detail) {
  tft.setTextSize(2);
  tft.setTextColor(ILI9341_WHITE); tft.setCursor(4, y); tft.print(label);
  tft.setTextColor(ok ? ILI9341_GREEN : ILI9341_RED); tft.print(ok ? " OK" : " KO");
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_LIGHTGREY); tft.setCursor(8, y + 20); tft.print(detail);
}

static void summary() {
  tft.setRotation(0);
  tft.fillScreen(ILI9341_BLACK);
  centerText("BILAN", 6, 3, ILI9341_YELLOW);
  char d[64];
  snprintf(d, sizeof(d), "Mode 0x%02X MADCTL 0x%02X Pixel 0x%02X Diag 0x%02X", diag[0], diag[1], diag[2], diag[4]);
  line(50, "Ecran", tftOk, d);
  snprintf(d, sizeof(d), "plein ecran = %lu ms (~%lu images/s)", (unsigned long)fillMs, fillMs ? 1000UL / fillMs : 0UL);
  line(100, "Vitesse", fillMs > 0, d);
  line(150, "Tactile", touchOk, touchOk ? "STMPE610 detecte (SPI)" : "STMPE610 non detecte");
  snprintf(d, sizeof(d), sdOk ? "carte lue, %d element(s) a la racine" : (sdPresent ? "?" : "pas de carte lisible (non formatee FAT ?)"), sdEntries);
  line(200, "microSD", sdOk, d);
  tft.setTextSize(1); tft.setTextColor(ILI9341_CYAN);
  tft.setCursor(4, 260); tft.print("Une carte vide mais FAT32 est normale.");
  tft.setCursor(4, 275); tft.print("La microSD n'est PAS requise pour PoD.");
  delay(5000);

  Serial.println();
  Serial.println(F("===== BILAN ====="));
  Serial.print(F("Ecran  : ")); Serial.println(tftOk ? "OK" : "KO");
  Serial.print(F("Diag ILI9341 (attendu 0x9C 0x48 0x05 0x00 0xC0) : "));
  for (int i = 0; i < 5; i++) { Serial.print("0x"); Serial.print(diag[i], HEX); Serial.print(' '); }
  Serial.println(F("\n  (0x00 ou 0xFF partout = lecture MISO impossible : pas grave si l'image s'affiche)"));
  Serial.print(F("Vitesse: plein ecran en ")); Serial.print(fillMs); Serial.println(F(" ms"));
  Serial.print(F("Tactile: ")); Serial.println(touchOk ? "STMPE610 OK" : "NON DETECTE (essaie SWAP_TFT_TOUCH_CS ?)");
  Serial.print(F("microSD: ")); Serial.println(sdOk ? "carte lue" : "non lue (carte absente / non formatee FAT)");
  if (sdOk) { Serial.print(F("  elements a la racine : ")); Serial.println(sdEntries); }
}

// ---------------------------------------------------------------- tactile
static bool readTouch(int &x, int &y, int &z) {
  if (!touchOk || ts.bufferEmpty()) return false;
  TS_Point p;
  while (!ts.bufferEmpty()) p = ts.getPoint();
  ts.writeRegister8(STMPE_INT_STA, 0xFF);
  x = p.x; y = p.y; z = p.z;
  return true;
}

// attend un appui, moyenne les mesures pendant l'appui, attend le relâchement
static bool captureRaw(int &rx, int &ry) {
  const uint32_t t0 = millis();
  while (!ts.touched()) { if (millis() - t0 > 30000UL) return false; delay(5); }
  delay(120);
  long sx = 0, sy = 0; int n = 0, x, y, z;
  const uint32_t t1 = millis();
  while (ts.touched() && millis() - t1 < 600UL) { if (readTouch(x, y, z)) { sx += x; sy += y; n++; } delay(5); }
  while (ts.touched()) delay(5);
  delay(150);
  if (!n) return false;
  rx = sx / n; ry = sy / n;
  return true;
}

static void drawCross(int cx, int cy, uint16_t color) {
  tft.drawFastHLine(cx - 12, cy, 25, color);
  tft.drawFastVLine(cx, cy - 12, 25, color);
  tft.drawCircle(cx, cy, 6, color);
}

static bool mapTouch(int rx, int ry, int &sx, int &sy) {
  if (!cal.valid) return false;
  const int a = cal.swapXY ? ry : rx, b = cal.swapXY ? rx : ry;
  sx = MARGIN + (long)(a - cal.a0) * (tft.width()  - 2 * MARGIN) / (cal.a1 - cal.a0);
  sy = MARGIN + (long)(b - cal.b0) * (tft.height() - 2 * MARGIN) / (cal.b2 - cal.b0);
  if (sx < 0) sx = 0; if (sx >= tft.width())  sx = tft.width()  - 1;
  if (sy < 0) sy = 0; if (sy >= tft.height()) sy = tft.height() - 1;
  return true;
}

static bool calibrate() {
  if (!touchOk) return false;
  tft.setRotation(0);
  const int w = tft.width(), h = tft.height();
  const int px[3] = { MARGIN, w - MARGIN, MARGIN };
  const int py[3] = { MARGIN, MARGIN, h - MARGIN };
  const char* names[3] = { "haut-gauche", "haut-droite", "bas-gauche" };
  int rx[3], ry[3];
  for (int i = 0; i < 3; i++) {
    tft.fillScreen(ILI9341_BLACK);
    centerText("CALIBRATION", 100, 2, ILI9341_YELLOW);
    char buf[40]; snprintf(buf, sizeof(buf), "Touche la croix %s", names[i]);
    centerText(buf, 130, 1, ILI9341_WHITE);
    drawCross(px[i], py[i], ILI9341_RED);
    if (!captureRaw(rx[i], ry[i])) { Serial.println(F("Calibration : pas d'appui détecté")); return false; }
    Serial.print(F("  croix ")); Serial.print(names[i]); Serial.print(F(" -> brut x=")); Serial.print(rx[i]);
    Serial.print(F(" y=")); Serial.println(ry[i]);
  }
  // quel axe brut varie quand on va de gauche à droite ? (détecte les axes échangés et les inversions)
  const int dxx = rx[1] - rx[0], dxy = ry[1] - ry[0];
  cal.swapXY = abs(dxy) > abs(dxx);
  cal.a0 = cal.swapXY ? ry[0] : rx[0];  cal.a1 = cal.swapXY ? ry[1] : rx[1];
  cal.b0 = cal.swapXY ? rx[0] : ry[0];  cal.b2 = cal.swapXY ? rx[2] : ry[2];
  cal.valid = abs(cal.a1 - cal.a0) > 500 && abs(cal.b2 - cal.b0) > 500;
  Serial.print(F("// calibration tactile (rotation 0) : swapXY=")); Serial.print(cal.swapXY);
  Serial.print(F(" a0=")); Serial.print(cal.a0); Serial.print(F(" a1=")); Serial.print(cal.a1);
  Serial.print(F(" b0=")); Serial.print(cal.b0); Serial.print(F(" b2=")); Serial.print(cal.b2);
  Serial.println(cal.valid ? F("  [OK]") : F("  [INVALIDE : appuis trop proches]"));
  return cal.valid;
}

// ---------------------------------------------------------------- mode dessin
static void paintUi() {
  tft.setRotation(0);
  tft.fillScreen(ILI9341_BLACK);
  tft.fillRect(0, tft.height() - 28, tft.width(), 28, ILI9341_DARKGREY);
  centerText("EFFACER (touche ici)", tft.height() - 20, 1, ILI9341_WHITE);
  tft.setTextSize(1); tft.setTextColor(ILI9341_CYAN, ILI9341_BLACK);
  tft.setCursor(4, 4); tft.print("Dessine au doigt - coin bas = effacer");
}

static void paintLoop() {
  int rx, ry, rz, sx, sy;
  if (!readTouch(rx, ry, rz)) return;
  if (!mapTouch(rx, ry, sx, sy)) return;
  if (sy >= tft.height() - 28) { paintUi(); return; }
  tft.fillCircle(sx, sy, 3, ILI9341_WHITE);
  char buf[48]; snprintf(buf, sizeof(buf), "brut %4d %4d p%3d  px %3d %3d ", rx, ry, rz, sx, sy);
  tft.setTextSize(1); tft.setTextColor(ILI9341_GREEN, ILI9341_BLACK);
  tft.setCursor(4, 16); tft.print(buf);
}

// ---------------------------------------------------------------- séquence complète
static void runAll() {
  if (!tftOk) return;
  Serial.println(F("--- couleurs ---"));      testColors();
  Serial.println(F("--- rotations ---"));     testRotations();
  Serial.println(F("--- dégradés/textes ---")); testGradients();
  Serial.println(F("--- vitesse ---"));       testSpeed();
  Serial.println(F("--- microSD ---"));       testSd();
  summary();
  if (touchOk) {
    int tries = 0;
    while (!calibrate() && tries++ < 2) {}
    if (cal.valid) paintUi();
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 2500) {}
  Serial.println(F("\n=== PoD — test shield TFT 2.8\" (ILI9341 + STMPE610 + SD) sur UNO R4 WiFi ==="));

  // désélectionner les 3 périphériques SPI avant tout
  pinMode(TFT_CS, OUTPUT);   digitalWrite(TFT_CS, HIGH);
  pinMode(STMPE_CS, OUTPUT); digitalWrite(STMPE_CS, HIGH);
  pinMode(SD_CS, OUTPUT);    digitalWrite(SD_CS, HIGH);

  tft.begin();
  tft.fillScreen(ILI9341_BLACK);
  diag[0] = tft.readcommand8(ILI9341_RDMODE);
  diag[1] = tft.readcommand8(ILI9341_RDMADCTL);
  diag[2] = tft.readcommand8(ILI9341_RDPIXFMT);
  diag[3] = tft.readcommand8(ILI9341_RDIMGFMT);
  diag[4] = tft.readcommand8(ILI9341_RDSELFDIAG);
  tftOk = true;   // l'init SPI n'a pas de retour : c'est ton œil qui valide (écran allumé = OK)
  Serial.print(F("ILI9341 registres : "));
  for (int i = 0; i < 5; i++) { Serial.print("0x"); Serial.print(diag[i], HEX); Serial.print(' '); }
  Serial.println();

  touchOk = ts.begin();
  Serial.println(touchOk ? F("STMPE610 : détecté") : F("STMPE610 : NON détecté (câblage / CS ?)"));

  runAll();
  Serial.println(F("\nMode dessin actif. 'r' = tout rejouer, 'c' = recalibrer."));
}

void loop() {
  if (Serial.available()) {
    const char c = Serial.read();
    if (c == 'r') runAll();
    else if (c == 'c' && touchOk) { cal.valid = false; if (calibrate()) paintUi(); }
  }
  if (touchOk && cal.valid) paintLoop();
  delay(2);
}
