// SelfTestEsp8266 — auto-test du noyau consensusPoD sur ESP8266 (BearSSL). ⚠ COMPILÉ seulement, JAMAIS essayé sur la carte.
// Ouvrir le moniteur série à 115200 : « [PODCORE] OK 4/4 » attendu ; relever aussi la mémoire libre (le noyau ne doit pas entamer le tas : pas d'allocation).
#include <Arduino.h>
#include "consensusPoD.h"
#include "consensusPoD_selftest.h"
#include "adapters/crypto_esp8266.h"

typedef PodSha256Br Sha;

static void repeatInto(char* dst, const char* pat, int times) { dst[0] = 0; for (int i = 0; i < times; i++) strcat(dst, pat); }

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf_P(PSTR("\n[PODCORE] noyau %s — tas libre avant : %u\n"), POD_CORE_VERSION, (unsigned)ESP.getFreeHeap());
  int ok = 0;

  uint8_t nonce[32]; char hex[65];
  pod_salt_nonce<Sha>(POD_SELFTEST_CANDIDATE, POD_SELFTEST_PARENT, POD_SELFTEST_DEVICE, nonce);
  pod_hex(nonce, 32, hex);
  if (!strcmp(hex, POD_SELFTEST_NONCE_HEX)) ok++; else Serial.println(F("[PODCORE] ÉCART nonce"));

  PodSalted<Sha> salted; salted.begin(nonce);
  uint8_t raw[16]; for (int i = 0; i < 16; i++) raw[i] = (uint8_t)i;
  salted.update(raw, 16); salted.finish(hex);
  if (!strcmp(hex, POD_SELFTEST_SALTED16)) ok++; else Serial.println(F("[PODCORE] ÉCART hash salé"));

  static uint8_t leaves[3][32];
  char sig[129], pub[65]; repeatInto(sig, "ab", 64); repeatInto(pub, "cd", 32);
  const char* msgs[3] = { "m0", "m1", "m2" };
  for (int i = 0; i < 3; i++) pod_vote_leaf<Sha>(msgs[i], sig, pub, leaves[i]);
  uint8_t root[32]; pod_merkle_root<Sha>(leaves, 3, root); pod_hex(root, 32, hex);
  if (!strcmp(hex, POD_SELFTEST_MERKLE3)) ok++; else Serial.println(F("[PODCORE] ÉCART Merkle"));

  char seed[65]; pod_committee_seed<Sha>(POD_SELFTEST_PARENT, POD_SELFTEST_CONTENT, seed);
  if (!strcmp(seed, POD_SELFTEST_SEED)) ok++; else Serial.println(F("[PODCORE] ÉCART graine du comité"));

  Serial.printf_P(PSTR("[PODCORE] %s %d/4 — tas libre après : %u\n"), ok == 4 ? "OK" : "ÉCHEC", ok, (unsigned)ESP.getFreeHeap());
}

void loop() { delay(1000); }
