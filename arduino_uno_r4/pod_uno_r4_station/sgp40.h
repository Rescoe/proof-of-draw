// sgp40.h — capteur de gaz SGP40 (Sensirion ; module Grove « VOC Sensor SGP40 », I2C 0x59). Partie PURE (CRC, commande, compensation, décodage : testée sur l'hôte, tests/stationSgp40.test.ts)
// + lecture par le bus I2C (carte seulement). Sortie = SRAW_VOC BRUTE (« ticks », 0..65535) : ce N'EST PAS l'indice VOC 0..500 de Sensirion (algorithme à part, non inclus).
// Plus la valeur est BASSE, plus l'air contient de composés organiques volatils ; elle dérive avec l'âge de la puce et ne se compare qu'à elle-même.
#ifndef POD_SGP40_H
#define POD_SGP40_H
#include <stdint.h>

#define SGP40_ADDR 0x59

/** CRC-8 Sensirion : polynôme 0x31, initialisation 0xFF (fiche technique : crc(0xBE,0xEF) = 0x92). */
static inline uint8_t sgp40Crc(const uint8_t* d, uint8_t n) {
  uint8_t c = 0xFF;
  for (uint8_t i = 0; i < n; i++) { c ^= d[i]; for (uint8_t b = 0; b < 8; b++) c = (c & 0x80) ? (uint8_t)((c << 1) ^ 0x31) : (uint8_t)(c << 1); }
  return c;
}
/** Humidité (dixièmes de %) -> ticks de compensation (0..65535 = 0..100 %). Valeur hors plage ramenée à la plage. */
static inline uint16_t sgp40RhTicks(int h10) { if (h10 < 0) h10 = 0; if (h10 > 1000) h10 = 1000; return (uint16_t)(((uint32_t)h10 * 65535UL + 500UL) / 1000UL); }
/** Température (dixièmes de °C) -> ticks de compensation (0..65535 = -45..130 °C). */
static inline uint16_t sgp40TempTicks(int t10) { if (t10 < -450) t10 = -450; if (t10 > 1300) t10 = 1300; return (uint16_t)(((uint32_t)(t10 + 450) * 65535UL + 875UL) / 1750UL); }
/** Commande « measure_raw » (0x260F) avec compensation : 8 octets. Défaut de la fiche technique (50 %, 25 °C) : 26 0F 80 00 A2 66 66 93. */
static inline void sgp40BuildMeasure(uint8_t out[8], int h10, int t10) {
  const uint16_t rh = sgp40RhTicks(h10), tt = sgp40TempTicks(t10);
  out[0] = 0x26; out[1] = 0x0F;
  out[2] = (uint8_t)(rh >> 8); out[3] = (uint8_t)rh; out[4] = sgp40Crc(out + 2, 2);
  out[5] = (uint8_t)(tt >> 8); out[6] = (uint8_t)tt; out[7] = sgp40Crc(out + 5, 2);
}
/** Réponse de 3 octets (donnée + CRC). false si le CRC est faux ou si la valeur est 0 / 0xFFFF (bus flottant : aucun capteur). */
static inline bool sgp40Decode(const uint8_t r[3], uint16_t& raw) {
  if (sgp40Crc(r, 2) != r[2]) return false;
  const uint16_t v = (uint16_t)((r[0] << 8) | r[1]);
  if (v == 0 || v == 0xFFFF) return false;
  raw = v;
  return true;
}

#if defined(ARDUINO)
#include <Wire.h>
/** Une mesure brute (≈ 35 ms). Le chauffage du SGP40 met ≈ 10 s à se stabiliser après la mise sous tension : l'appelant jette les premières valeurs. h10 / t10 : dernière mesure DHT22 (sinon 500 / 250). */
static inline bool sgp40Measure(int h10, int t10, uint16_t& raw) {
  uint8_t cmd[8]; sgp40BuildMeasure(cmd, h10, t10);
  Wire.beginTransmission(SGP40_ADDR);
  Wire.write(cmd, 8);
  if (Wire.endTransmission() != 0) return false;
  delay(35);                                        // durée de mesure maximale : 30 ms
  if (Wire.requestFrom((uint8_t)SGP40_ADDR, (uint8_t)3) != 3) return false;
  uint8_t r[3];
  for (uint8_t i = 0; i < 3; i++) r[i] = (uint8_t)Wire.read();
  return sgp40Decode(r, raw);
}
#endif
#endif
