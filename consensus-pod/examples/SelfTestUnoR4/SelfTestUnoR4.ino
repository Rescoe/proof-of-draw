// SelfTestUnoR4 — auto-test du noyau consensusPoD sur UNO R4 WiFi (bibliothèque Crypto). ⚠ COMPILÉ seulement, JAMAIS essayé sur la carte.
// Moniteur série à 115200 : « [PODCORE] OK 4/4 » attendu. Pile principale de 1 Ko : tous les tampons sont STATIQUES.
#include <Arduino.h>
#include "consensusPoD.h"
#include "consensusPoD_selftest.h"
#include "adapters/crypto_uno_r4.h"

typedef PodSha256Rw Sha;

static uint8_t g_nonce[32], g_raw[16], g_leaves[3][32], g_root[32];
static char g_hex[65], g_sig[129], g_pub[65], g_seed[65];

static void repeatInto(char* dst, const char* pat, int times) { dst[0] = 0; for (int i = 0; i < times; i++) strcat(dst, pat); }

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.print("\n[PODCORE] noyau "); Serial.println(POD_CORE_VERSION);
  int ok = 0;

  pod_salt_nonce<Sha>(POD_SELFTEST_CANDIDATE, POD_SELFTEST_PARENT, POD_SELFTEST_DEVICE, g_nonce);
  pod_hex(g_nonce, 32, g_hex);
  if (!strcmp(g_hex, POD_SELFTEST_NONCE_HEX)) ok++; else Serial.println("[PODCORE] ECART nonce");

  static PodSalted<Sha> salted; salted.begin(g_nonce);
  for (int i = 0; i < 16; i++) g_raw[i] = (uint8_t)i;
  salted.update(g_raw, 16); salted.finish(g_hex);
  if (!strcmp(g_hex, POD_SELFTEST_SALTED16)) ok++; else Serial.println("[PODCORE] ECART hash sale");

  repeatInto(g_sig, "ab", 64); repeatInto(g_pub, "cd", 32);
  const char* msgs[3] = { "m0", "m1", "m2" };
  for (int i = 0; i < 3; i++) pod_vote_leaf<Sha>(msgs[i], g_sig, g_pub, g_leaves[i]);
  pod_merkle_root<Sha>(g_leaves, 3, g_root); pod_hex(g_root, 32, g_hex);
  if (!strcmp(g_hex, POD_SELFTEST_MERKLE3)) ok++; else Serial.println("[PODCORE] ECART Merkle");

  pod_committee_seed<Sha>(POD_SELFTEST_PARENT, POD_SELFTEST_CONTENT, g_seed);
  if (!strcmp(g_seed, POD_SELFTEST_SEED)) ok++; else Serial.println("[PODCORE] ECART graine du comite");

  Serial.print("[PODCORE] "); Serial.print(ok == 4 ? "OK " : "ECHEC "); Serial.print(ok); Serial.println("/4");
}

void loop() { delay(1000); }
