// AnimSelfTestEsp8266 — auto-test de l'AUTOMATE D'ANIMATION pod-anim-v3 (podAnimV3.h) sur ESP8266 (BearSSL). Lot 6C.
// ⚠ NE PAS DÉPLOYER : exemple de VALIDATION, séparé de tout firmware de production. COMPILÉ seulement, JAMAIS essayé sur la carte.
// Il utilise le VRAI noyau (aucune réimplémentation) : 9 clips (valide 2 images, valide 64 images, statique, alternance noir/blanc, bruit, CRC altérée, corps altéré, tronqué, racine annoncée fausse)
// lus EN FLUX par fragments de 1, 7, 61 et 256 octets depuis la FLASH (PROGMEM) : le clip entier n'est jamais en RAM. Moniteur série à 115200 : « [ANIMTEST] RESULTAT PASS 36/36 » attendu.
// Les temps affichés (µs) sont des MESURES MATÉRIELLES seulement si ce sketch a réellement tourné sur la carte.
#include <Arduino.h>
#include "podAnimSelfTest.h"            // en premier : résout la bibliothèque ConsensusPoD (dossier src) pour l'include relatif suivant
#include "adapters/crypto_esp8266.h"

typedef PodSha256Br Sha;
static PodAnimTestWork<Sha> W;   // ≈ 4 Ko STATIQUES : acceptable pour un auto-test, PAS le contrat d'intégration (voir docs/LOT_6C : l'automate sera alloué après la fermeture du TLS)
#ifdef POD_ANIMTEST_SIZE_PROBE   // compilation de SONDE (-DPOD_ANIMTEST_SIZE_PROBE) : tailles EXACTES des objets, lues dans l'ELF avec nm (voir docs/LOT_6C) ; absent de la compilation de mesure
__attribute__((used)) char PROBE_SHA[sizeof(Sha)]; __attribute__((used)) char PROBE_STREAM[sizeof(PodAnimStream<Sha>)]; __attribute__((used)) char PROBE_SALTED[sizeof(PodSalted<Sha>)];
__attribute__((used)) char PROBE_RESULT[sizeof(PodAnimResult)]; __attribute__((used)) char PROBE_MERKLE[sizeof(PodMerkleStack<Sha>)]; __attribute__((used)) char PROBE_METRICS[sizeof(PodMetrics)];
#endif
static void sink(const char* s) { Serial.println(s); }
static uint32_t clockUs() { return micros(); }

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf_P(PSTR("\n[ANIMTEST] pod-anim-v3 noyau %s — tas libre avant : %u\n"), POD_CORE_VERSION, (unsigned)ESP.getFreeHeap());
  static char line[160];
#ifdef POD_ANIMTEST_SIZE_PROBE
  Serial.println((int)(PROBE_SHA[0] + PROBE_STREAM[0] + PROBE_SALTED[0] + PROBE_RESULT[0] + PROBE_MERKLE[0] + PROBE_METRICS[0]));   // référence les sondes : l'éditeur de liens ne les supprime pas
#endif
  pod_anim_selftest_sizes<Sha>(sink, line, sizeof(line));
  pod_anim_selftest_run<Sha>(&W, sink, clockUs);
  Serial.printf_P(PSTR("[ANIMTEST] tas libre après : %u (aucune allocation dynamique attendue)\n"), (unsigned)ESP.getFreeHeap());
}

void loop() { delay(1000); }
