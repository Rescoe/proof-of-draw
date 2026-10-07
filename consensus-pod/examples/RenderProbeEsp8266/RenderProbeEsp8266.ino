// RenderProbeEsp8266 — SONDE D'ENCOMBREMENT du noyau de rendu en flux (podRenderStream.h) sur ESP8266 (BearSSL). Lot 8B-1.
// ⚠ NE PAS DÉPLOYER : exemple de MESURE, séparé de tout firmware de production. COMPILÉ seulement, JAMAIS essayé sur la carte. Ce n'est PAS un test d'exactitude : l'exactitude est établie sur l'hôte
// (consensus-pod/host/render_stream_harness.cpp, 228 vecteurs d'or). Il appelle chaque fonction publique du noyau (e-ink 2,9″ puis TFT 1,8″, fit) pour que le compilateur les garde, sur des octets pseudo-aléatoires
// produits À LA VOLÉE (aucune image en RAM statique ; les deux plans e-ink de 4 736 o sont alloués au TAS dans setup(), comme le fera le firmware après la fermeture du TLS) ; les hashes affichés ne sont comparés à rien. Moniteur série à 115200.
// ESP8266 : les tampons image n'existent pas ici ; l'appelant réel fournira les plans reçus (4 736 o chacun, alloués APRÈS la fermeture du TLS) — voir docs/LOT_8B1_NOYAU_RENDU_FLUX_2026_10_07.md.
#include <Arduino.h>
#include "podRenderStream.h"          // en premier : résout la bibliothèque ConsensusPoD (dossier src) pour l'include relatif suivant
#include "adapters/crypto_esp8266.h"

typedef PodSha256Br Sha;
static PodEinkRenderer<Sha> E;
static PodTftRenderer<Sha> T;
static PodFrameHasher<Sha> FH;
static PodPassHasher<Sha> P;
static uint8_t srcRow[POD_R_MAX_ROW_BYTES], outRow[POD_R_MAX_ROW_BYTES], chunk[32];
#ifdef POD_RENDERPROBE_SIZE_PROBE   // compilation de SONDE (-DPOD_RENDERPROBE_SIZE_PROBE) : tailles EXACTES des objets, lues dans l'ELF avec nm ; absent de la compilation de mesure
__attribute__((used)) char PROBE_SHA[sizeof(Sha)]; __attribute__((used)) char PROBE_EINK[sizeof(PodEinkRenderer<Sha>)]; __attribute__((used)) char PROBE_TFT[sizeof(PodTftRenderer<Sha>)];
__attribute__((used)) char PROBE_FRAME[sizeof(PodFrameHasher<Sha>)]; __attribute__((used)) char PROBE_PASS[sizeof(PodPassHasher<Sha>)]; __attribute__((used)) char PROBE_LINE[sizeof(PodRLine)];
#endif
static void hex(const __FlashStringHelper* label, const char* h) { Serial.print(label); Serial.println(h); }

void setup() {
  Serial.begin(115200);
  delay(300);
#ifdef POD_RENDERPROBE_SIZE_PROBE
  Serial.println((int)(PROBE_SHA[0] + PROBE_EINK[0] + PROBE_TFT[0] + PROBE_FRAME[0] + PROBE_PASS[0] + PROBE_LINE[0]));   // référence les sondes : l'éditeur de liens ne les supprime pas
#endif
  const PodRenderSpec e29 = pod_render_spec(POD_R_EINK29), t18 = pod_render_spec(POD_R_TFT18), oled = pod_render_spec(POD_R_OLED96);
  const uint8_t art[] = { 'L', 'e', 'a' }; PodRenderMeta meta = { art, 3, 42, art, 3, art, 3 };
  char a[65], b[65];
  uint8_t* planes = (uint8_t*)malloc(2 * 4736);   // 9 472 o au tas, libérés à la fin
  if (planes) {
    for (uint32_t i = 0; i < 2 * 4736; i++) planes[i] = (uint8_t)pod_render_hash32(1, i, 0);
    FH.begin(e29); for (uint32_t off = 0; off < 2 * 4736; off += 32) FH.update(planes + off, 32);   // frameHash alimenté par morceaux (ici 32 o) comme pendant le téléchargement
    if (FH.finish(a) && E.begin(e29, POD_R_FIT, meta, planes, planes + 4736, 4736)) {
      uint32_t got;
      while ((got = E.read(chunk, sizeof(chunk))) > 0) { /* ici l'appelant réel envoie chunk[0..got) au pilote, puis yield() / chien de garde */ }
      if (E.finish(b)) { hex(F("[RENDERPROBE] eink29 frame  "), a); hex(F("[RENDERPROBE] eink29 render "), b); }
    }
    free(planes);
  }
  P.begin(oled, POD_R_FIT); P.update(srcRow, 1024 > sizeof(srcRow) ? sizeof(srcRow) : 1024);   // chemin « sans traitement » (OLED / TFT 2,8″ / hidden)
  // TFT 1,8″ : le protocole ligne par ligne complet sur des lignes pseudo-aléatoires calculées à la volée
  if (T.begin(t18, POD_R_FIT, meta)) {
    uint16_t src = 0;
    while (!T.allRowsEmitted()) {
      while (T.needsSource()) { for (uint16_t k = 0; k < 256; k++) srcRow[k] = (uint8_t)pod_render_hash32(7, (uint32_t)src * 256 + k, 0); src++; T.consumeSource(srcRow); }
      T.emitRow(srcRow, outRow);   // ici l'appelant réel écrit outRow sur le pilote, puis yield() / chien de garde
    }
    while (T.sourceRemaining()) { for (uint16_t k = 0; k < 256; k++) srcRow[k] = (uint8_t)pod_render_hash32(7, (uint32_t)src * 256 + k, 0); src++; T.consumeSource(srcRow); }
    if (T.finish(a, b)) { hex(F("[RENDERPROBE] tft18 frame  "), a); hex(F("[RENDERPROBE] tft18 render "), b); }
  }
  Serial.println(F("[RENDERPROBE] fin — mesure d'encombrement seulement, rien n'est comparé"));
}

void loop() { delay(1000); }
