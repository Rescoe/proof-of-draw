// AnimSelfTestUnoR4 — auto-test de l'AUTOMATE D'ANIMATION pod-anim-v3 (podAnimV3.h) sur UNO R4 WiFi (bibliothèque Crypto). Lot 6C.
// ⚠ NE PAS DÉPLOYER : exemple de VALIDATION, séparé de tout firmware de production. COMPILÉ seulement, JAMAIS essayé sur la carte.
// Vrai noyau, 9 clips lus EN FLUX par fragments de 1, 7, 61 et 256 octets depuis la flash : le clip entier n'est jamais en RAM. Moniteur série à 115200 : « [ANIMTEST] RESULTAT PASS 36/36 » attendu.
// PILE PRINCIPALE DE ~1 Ko : l'automate et tout l'état de l'auto-test (PodAnimTestWork) sont un OBJET GLOBAL — jamais une variable locale. Les temps (µs) sont des MESURES MATÉRIELLES seulement
// si ce sketch a réellement tourné sur la carte.
#include <Arduino.h>
#include "podAnimSelfTest.h"            // en premier : résout la bibliothèque ConsensusPoD (dossier src) pour l'include relatif suivant
#include "adapters/crypto_uno_r4.h"

typedef PodSha256Rw Sha;
static PodAnimTestWork<Sha> W;   // GLOBAL (≈ 4 Ko de RAM statique) — jamais sur la pile
#ifdef POD_ANIMTEST_SIZE_PROBE   // compilation de SONDE (-DPOD_ANIMTEST_SIZE_PROBE) : tailles EXACTES des objets, lues dans l'ELF avec nm (voir docs/LOT_6C) ; absent de la compilation de mesure
__attribute__((used)) char PROBE_SHA[sizeof(Sha)]; __attribute__((used)) char PROBE_STREAM[sizeof(PodAnimStream<Sha>)]; __attribute__((used)) char PROBE_SALTED[sizeof(PodSalted<Sha>)];
__attribute__((used)) char PROBE_RESULT[sizeof(PodAnimResult)]; __attribute__((used)) char PROBE_MERKLE[sizeof(PodMerkleStack<Sha>)]; __attribute__((used)) char PROBE_METRICS[sizeof(PodMetrics)];
#endif
static char line[160];
static void sink(const char* s) { Serial.println(s); }
static uint32_t clockUs() { return (uint32_t)micros(); }

void setup() {
  Serial.begin(115200);
  const unsigned long t0 = millis(); while (!Serial && millis() - t0 < 3000) {}
  Serial.print(F("\n[ANIMTEST] pod-anim-v3 noyau ")); Serial.println(POD_CORE_VERSION);
#ifdef POD_ANIMTEST_SIZE_PROBE
  Serial.println((int)(PROBE_SHA[0] + PROBE_STREAM[0] + PROBE_SALTED[0] + PROBE_RESULT[0] + PROBE_MERKLE[0] + PROBE_METRICS[0]));   // référence les sondes : l'éditeur de liens ne les supprime pas
#endif
  pod_anim_selftest_sizes<Sha>(sink, line, sizeof(line));
  pod_anim_selftest_run<Sha>(&W, sink, clockUs);
}

void loop() { delay(1000); }
