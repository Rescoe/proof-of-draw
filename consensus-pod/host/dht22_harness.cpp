// dht22_harness.cpp — exécute le code RÉEL de esp8266/_shared/pod_dht22.h (partie pure) sur l'hôte : décodage, plages, planification, tampon, corps JSON. Affiche « PASS n » ou « FAIL … ».
#include "pod_dht22.h"
#include <cstdio>
#include <cstdint>
#include <cstring>
using namespace poddht;

static int fails = 0, checks = 0;
#define CHECK(c) do { checks++; if (!(c)) { fails++; printf("FAIL ligne %d : %s\n", __LINE__, #c); } } while (0)

int main() {
  int t, h;
  { const uint8_t b[5] = {0x02, 0x8C, 0x01, 0x5F, 0xEE}; CHECK(parse(b, t, h) && h == 652 && t == 351); }                 // exemple de la fiche technique : 65,2 % et 35,1 °C
  { const uint8_t b[5] = {0x02, 0x92, 0x80, 0x65, 0x79}; CHECK(parse(b, t, h) && h == 658 && t == -101); }                // température négative (bit 15) : −10,1 °C
  { const uint8_t b[5] = {0x02, 0x8C, 0x01, 0x5F, 0xEF}; CHECK(!parse(b, t, h)); }                                          // somme de contrôle fausse
  { const uint8_t b[5] = {0x04, 0x4C, 0x01, 0x5F, 0xB0}; CHECK(!parse(b, t, h)); }                                          // 110,0 % : hors plage (somme juste)
  { const uint8_t b[5] = {0x02, 0x8C, 0x03, 0x20, 0xB1}; CHECK(parse(b, t, h) && t == 800); }                                    // 80,0 °C : borne haute acceptée
  { const uint8_t b[5] = {0x02, 0x8C, 0x03, 0x21, 0xB2}; CHECK(!parse(b, t, h)); }                                          // 80,1 °C : hors plage (somme juste)
  { const uint8_t b[5] = {0, 0, 0, 0, 0}; CHECK(parse(b, t, h) && t == 0 && h == 0); }                                      // tout à zéro est un cas valide (somme 0) : 0,0 °C et 0,0 %

  // ── planification
  State s; init(s, 1000);
  CHECK(next(s, 1000) == A_NONE);
  CHECK(next(s, 1000 + FIRST_READ_MS - 1) == A_NONE);
  CHECK(next(s, 1000 + FIRST_READ_MS) == A_READ);
  onRead(s, 1000 + FIRST_READ_MS, true, 211, 719);
  CHECK(s.n == 1 && s.nextReadMs == 1000 + FIRST_READ_MS + READ_EVERY_MS);
  CHECK(next(s, 1000 + FIRST_SEND_MS - 1) == A_NONE);
  CHECK(next(s, 1000 + FIRST_SEND_MS) == A_SEND);
  char body[256];
  const uint32_t tSend = 1000 + FIRST_SEND_MS;
  size_t n = buildBody(s, tSend, "dev_KAD6PKC4", "9MTNU94Q", -61, body, sizeof body);
  CHECK(n > 0 && n == strlen(body));
  CHECK(strcmp(body, "{\"deviceId\":\"dev_KAD6PKC4\",\"pairCode\":\"9MTNU94Q\",\"r\":[{\"a\":50,\"temp\":211,\"hum\":719}],\"m\":{\"rssi\":-61}}") == 0);
  onSend(s, tSend, S_OK, 0);
  CHECK(s.n == 0 && s.nextSendMs == tSend + SEND_EVERY_MS && s.sends == 1);
  CHECK(next(s, tSend + 1) == A_NONE);                                                                                          // rien à envoyer sans lecture
  // régime normal : lecture à +30 min, lecture à +60 min, envoi (2 lectures) à +60 min après le 1er envoi
  uint32_t now = s.nextReadMs; CHECK(next(s, now) == A_READ); onRead(s, now, true, 215, 700);
  now = s.nextReadMs; CHECK(next(s, now) == A_READ); onRead(s, now, true, -50, 999);
  CHECK(s.n == 2);
  CHECK(next(s, s.nextSendMs - 1) == A_NONE || next(s, s.nextSendMs - 1) == A_READ);
  now = s.nextSendMs; CHECK(next(s, now) == A_SEND || next(s, now) == A_READ);
  n = buildBody(s, now, "dev_X", "CODE", 5, body, sizeof body);                                                                 // rssi hors plage (positif) : omis
  CHECK(n > 0 && strstr(body, "\"m\"") == nullptr && strstr(body, "\"temp\":-50,\"hum\":999") != nullptr);
  // échec d'envoi : le tampon est CONSERVÉ, nouvel essai dans 5 min
  onSend(s, now, S_FAIL, 0); CHECK(s.n == 2 && s.nextSendMs == now + RETRY_MS && s.sendFails == 1);
  // « trop tôt » du serveur (stored:false, nextSec) : tampon conservé, attente indiquée (bornée)
  onSend(s, now, S_TOO_SOON, 1800); CHECK(s.n == 2 && s.nextSendMs == now + 1800UL * 1000UL);
  onSend(s, now, S_TOO_SOON, 5); CHECK(s.nextSendMs == now + 60UL * 1000UL);
  onSend(s, now, S_TOO_SOON, 999999); CHECK(s.nextSendMs == now + 7200UL * 1000UL);
  CHECK(parseNextSec("{\"ok\":true,\"stored\":false,\"nextSec\":3000}") == 3000 && parseNextSec("{\"ok\":true}") == 0);
  // capteur absent : pas de lecture inventée, nouvel essai dans 5 min
  State z; init(z, 0); onRead(z, FIRST_READ_MS, false, 0, 0); CHECK(z.n == 0 && z.readFails == 1 && z.nextReadMs == FIRST_READ_MS + RETRY_MS);
  // tampon plein : la plus ancienne lecture est perdue, l'ordre est conservé
  State f; init(f, 0); for (int i = 0; i < MAXR + 2; i++) onRead(f, (uint32_t)(i + 1) * READ_EVERY_MS, true, 100 + i, 500);
  CHECK(f.n == MAXR && f.r[0].t10 == 102 && f.r[MAXR - 1].t10 == 100 + MAXR + 1);
  // débordement de millis() (49 jours) : les échéances restent comprises
  State w; init(w, 0xFFFFFFFFu - 5000u); CHECK(next(w, 0xFFFFFFFFu - 5000u) == A_NONE); CHECK(next(w, 0xFFFFFFFFu - 5000u + FIRST_READ_MS) == A_READ);
  // âge plafonné à 86 400 s
  State g; init(g, 0); onRead(g, 1000, true, 1, 1); n = buildBody(g, 1000UL + 200000UL * 1000UL, "d", "c", 0, body, sizeof body); CHECK(n > 0 && strstr(body, "\"a\":86400") != nullptr);
  // tampon de sortie trop petit : 0, jamais de débordement
  CHECK(buildBody(g, 2000, "dev_KAD6PKC4", "9MTNU94Q", -61, body, 20) == 0);

  if (fails) { printf("%d échec(s) sur %d contrôles\n", fails, checks); return 1; }
  printf("PASS %d\n", checks);
  return 0;
}
