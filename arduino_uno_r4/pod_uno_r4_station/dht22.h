// dht22.h — lecture d'un DHT22 / AM2302 (UNO R4 WiFi). Décodage PUR (testé sur l'hôte : tests/dht22.test.ts) + lecture par la broche (carte seulement).
// Trame : 40 bits = humidité (16 bits, dixièmes de %), température (16 bits, bit 15 = signe, dixièmes de °C), somme de contrôle (8 bits = somme des 4 octets modulo 256).
#ifndef POD_DHT22_H
#define POD_DHT22_H
#include <stdint.h>

/** Décode 5 octets. false si la somme de contrôle ou la plage (DHT22 : -40..80 °C, 0..100 %) est fausse ; sinon c10 = dixièmes de °C, h10 = dixièmes de %. */
static inline bool dht22Decode(const uint8_t b[5], int16_t& c10, uint16_t& h10) {
  if ((uint8_t)(b[0] + b[1] + b[2] + b[3]) != b[4]) return false;
  const uint16_t h = (uint16_t)((b[0] << 8) | b[1]);
  const uint16_t traw = (uint16_t)(((b[2] & 0x7F) << 8) | b[3]);
  const int16_t t = (b[2] & 0x80) ? (int16_t)(-(int16_t)traw) : (int16_t)traw;
  if (h > 1000 || t < -400 || t > 800) return false;
  c10 = t; h10 = h;
  return true;
}
/** Un bit : impulsion haute ≈ 26–28 µs = 0, ≈ 70 µs = 1 ; seuil à 48 µs. */
static inline uint8_t dht22BitFromHighUs(uint32_t us) { return us > 48 ? 1 : 0; }

#if defined(ARDUINO)
#include <Arduino.h>
/** Attend que la broche prenne le niveau `lvl` ; retourne la durée en µs, ou -1 au dépassement de `maxUs`. */
static inline int32_t dht22Wait(uint8_t pin, uint8_t lvl, uint32_t maxUs) {
  const uint32_t t0 = micros();
  while (digitalRead(pin) != lvl) { if (micros() - t0 > maxUs) return -1; }
  return (int32_t)(micros() - t0);
}
/** UNE tentative de lecture (≈ 5 ms). Broche DATA avec résistance de rappel de 10 kΩ vers 3,3 V (les modules à 3 broches l'ont déjà). */
static bool dht22ReadOnce(uint8_t pin, int16_t& c10, uint16_t& h10) {
  uint8_t b[5] = {0, 0, 0, 0, 0};
  pinMode(pin, OUTPUT); digitalWrite(pin, LOW); delay(2);          // départ : ≥ 1 ms à l'état bas
  digitalWrite(pin, HIGH); delayMicroseconds(30);
  pinMode(pin, INPUT_PULLUP);
  if (dht22Wait(pin, LOW, 120) < 0) return false;                  // réponse : 80 µs bas…
  if (dht22Wait(pin, HIGH, 120) < 0) return false;                 // … puis 80 µs haut
  if (dht22Wait(pin, LOW, 120) < 0) return false;
  for (uint8_t i = 0; i < 40; i++) {
    if (dht22Wait(pin, HIGH, 100) < 0) return false;               // 50 µs bas puis…
    const int32_t hi = dht22Wait(pin, LOW, 120);                   // … impulsion haute dont la durée porte le bit
    if (hi < 0) return false;
    b[i >> 3] = (uint8_t)((b[i >> 3] << 1) | dht22BitFromHighUs((uint32_t)hi));
  }
  return dht22Decode(b, c10, h10);
}
/** Jusqu'à 3 tentatives espacées de 2,5 s (le DHT22 veut ≥ 2 s entre deux lectures). */
static bool dht22Read(uint8_t pin, int16_t& c10, uint16_t& h10) {
  for (uint8_t k = 0; k < 3; k++) {
    if (k) delay(2500);
    if (dht22ReadOnce(pin, c10, h10)) return true;
  }
  return false;
}
#endif
#endif
