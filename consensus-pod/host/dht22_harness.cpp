// consensus-pod/host/dht22_harness.cpp — décodage DHT22 (arduino_uno_r4/pod_uno_r4_dht22/dht22.h, code RÉEL, hors lecture par la broche). Sortie « OK|FAIL nom », code de sortie = nombre d'échecs.
#include <cstdio>
#include "dht22.h"
static int fails = 0;
static void check(bool ok, const char* name) { if (!ok) fails++; printf("%s %s\n", ok ? "OK  " : "FAIL", name); }
static void frame(uint8_t* b, uint16_t h, uint16_t traw, bool neg) {
  b[0] = h >> 8; b[1] = h & 0xFF; b[2] = (traw >> 8) | (neg ? 0x80 : 0); b[3] = traw & 0xFF; b[4] = (uint8_t)(b[0] + b[1] + b[2] + b[3]);
}
int main() {
  uint8_t b[5]; int16_t c; uint16_t h;
  frame(b, 652, 351, false);   check(dht22Decode(b, c, h) && c == 351 && h == 652, "35,1 C / 65,2 % (exemple de la fiche technique)");
  frame(b, 456, 215, false);   check(dht22Decode(b, c, h) && c == 215 && h == 456, "21,5 C / 45,6 %");
  frame(b, 800, 101, true);    check(dht22Decode(b, c, h) && c == -101 && h == 800, "-10,1 C (bit de signe)");
  frame(b, 0, 0, false);       check(dht22Decode(b, c, h) && c == 0 && h == 0, "0 C / 0 %");
  frame(b, 1000, 800, false);  check(dht22Decode(b, c, h) && c == 800 && h == 1000, "bornes hautes 80 C / 100 %");
  frame(b, 500, 400, true);    check(dht22Decode(b, c, h) && c == -400, "borne basse -40 C");
  frame(b, 1001, 200, false);  check(!dht22Decode(b, c, h), "humidite > 100 % refusee");
  frame(b, 500, 801, false);   check(!dht22Decode(b, c, h), "temperature > 80 C refusee");
  frame(b, 500, 401, true);    check(!dht22Decode(b, c, h), "temperature < -40 C refusee");
  frame(b, 456, 215, false); b[4] ^= 1; check(!dht22Decode(b, c, h), "somme de controle fausse refusee");
  frame(b, 456, 215, false); b[1] ^= 0x10; check(!dht22Decode(b, c, h), "bit corrompu refuse");
  frame(b, 456, 215, false); c = 7; h = 7; b[4] ^= 1; dht22Decode(b, c, h); check(c == 7 && h == 7, "sorties intactes en cas de refus");
  check(dht22BitFromHighUs(26) == 0 && dht22BitFromHighUs(28) == 0 && dht22BitFromHighUs(48) == 0, "impulsion courte = 0");
  check(dht22BitFromHighUs(49) == 1 && dht22BitFromHighUs(70) == 1 && dht22BitFromHighUs(120) == 1, "impulsion longue = 1");
  printf("%s : %d echec(s)\n", fails ? "ECHEC" : "SUCCES", fails);
  return fails ? 1 : 0;
}
