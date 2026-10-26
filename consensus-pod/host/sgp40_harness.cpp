// Harnais hôte de sgp40.h (partie pure) : vecteurs de la fiche technique Sensirion.
#include <cstdio>
#include "sgp40.h"
static int fails = 0;
#define CHECK(c, m) do { if (!(c)) { printf("ECHEC : %s\n", m); fails++; } } while (0)
int main() {
  const uint8_t beef[2] = {0xBE, 0xEF};
  CHECK(sgp40Crc(beef, 2) == 0x92, "crc(BEEF)");
  uint8_t cmd[8]; sgp40BuildMeasure(cmd, 500, 250);
  const uint8_t ref[8] = {0x26, 0x0F, 0x80, 0x00, 0xA2, 0x66, 0x66, 0x93};
  for (int i = 0; i < 8; i++) CHECK(cmd[i] == ref[i], "commande par défaut 50 % / 25 °C");
  CHECK(sgp40RhTicks(0) == 0 && sgp40RhTicks(1000) == 65535 && sgp40RhTicks(5000) == 65535 && sgp40RhTicks(-9) == 0, "bornes humidité");
  CHECK(sgp40TempTicks(-450) == 0 && sgp40TempTicks(1300) == 65535 && sgp40TempTicks(-9999) == 0, "bornes température");
  const uint8_t good[3] = {0x12, 0x34, 0};
  uint8_t g[3] = {0x12, 0x34, sgp40Crc(good, 2)};
  uint16_t raw = 0; CHECK(sgp40Decode(g, raw) && raw == 0x1234, "décodage valide");
  g[2] ^= 1; CHECK(!sgp40Decode(g, raw), "CRC faux refusé");
  const uint8_t z[3] = {0, 0, sgp40Crc((const uint8_t[]){0, 0}, 2)}; CHECK(!sgp40Decode(z, raw), "0 refusé");
  const uint8_t f[3] = {0xFF, 0xFF, sgp40Crc((const uint8_t[]){0xFF, 0xFF}, 2)}; CHECK(!sgp40Decode(f, raw), "0xFFFF refusé");
  printf("SUCCES : %d echec\n", fails);
  return fails ? 1 : 0;
}
