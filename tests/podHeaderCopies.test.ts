import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Un dossier de firmware est autonome (l'IDE Arduino ne compile que son dossier) : les en-têtes de validation réelle existent en COPIES IDENTIQUES.
// Après une modification de l'original dans esp8266/_shared : le recopier (la table d'entropie se régénère avec scripts/gen-pod-metrics-table.js).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

const COPIES: Record<string, string[]> = {
  "esp8266/_shared/pod_metrics.h": [
    "esp8266/esp_eink_2.9BWR/pod_metrics.h",
    "esp8266/esp_tft1.8/pod_metrics.h",
    "esp8266/esp_eink_2.7BW_OLED/pod_metrics.h",
    "arduino_uno_r4/pod_uno_r4_eink29/pod_metrics.h",
    "arduino_uno_r4/pod_uno_r4_eink27/pod_metrics.h",
    "arduino_uno_r4/pod_uno_r4_eink27_oled/pod_metrics.h",
    "arduino_uno_r4/pod_uno_r4_tft18/pod_metrics.h",
    "arduino_uno_r4/pod_uno_r4/pod_metrics.h",
  ],
  "esp8266/_shared/pod_metrics_table.h": [
    "esp8266/esp_eink_2.9BWR/pod_metrics_table.h",
    "esp8266/esp_tft1.8/pod_metrics_table.h",
    "esp8266/esp_eink_2.7BW_OLED/pod_metrics_table.h",
    "arduino_uno_r4/pod_uno_r4_eink29/pod_metrics_table.h",
    "arduino_uno_r4/pod_uno_r4_eink27/pod_metrics_table.h",
    "arduino_uno_r4/pod_uno_r4_eink27_oled/pod_metrics_table.h",
    "arduino_uno_r4/pod_uno_r4_tft18/pod_metrics_table.h",
    "arduino_uno_r4/pod_uno_r4/pod_metrics_table.h",
  ],
  "arduino_uno_r4/pod_uno_r4_eink29/pod_vote_r4.h": [
    "arduino_uno_r4/pod_uno_r4_eink27/pod_vote_r4.h",
    "arduino_uno_r4/pod_uno_r4_eink27_oled/pod_vote_r4.h",
    "arduino_uno_r4/pod_uno_r4_tft18/pod_vote_r4.h",
    "arduino_uno_r4/pod_uno_r4/pod_vote_r4.h",
  ],
  "esp8266/_shared/pod_vote_esp.h": ["esp8266/esp_eink_2.9BWR/pod_vote_esp.h", "esp8266/esp_tft1.8/pod_vote_esp.h", "esp8266/esp_eink_2.7BW_OLED/pod_vote_esp.h"],
};

for (const [original, copies] of Object.entries(COPIES)) {
  for (const copy of copies) {
    test(`${copy} = ${original}`, () => assert.equal(read(copy), read(original)));
  }
}

test("l'en-tête de la table d'entropie ne dépend pas de <pgmspace.h> (absent du cœur UNO R4)", () => {
  assert.doesNotMatch(read("esp8266/_shared/pod_metrics_table.h"), /#include <pgmspace\.h>/);
});

// ── Un appareil relit un candidat de N'IMPORTE QUEL écran ───────────────────────────────────────────────────────────────────────────
// Le serveur annonce { v2: écran, taille, hash } pour le candidat COURANT, quel que soit le type d'écran du dessin, et tout appareil actif peut voter. Un firmware qui refuserait
// les écrans qui ne sont pas les siens ne voterait jamais sur un dessin d'un autre type (et un comité de 4 appareils hétérogènes ne verrait que ceux du même écran).
const SKETCHES = [
  "esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino",
  "esp8266/esp_tft1.8/esp_tft1.8.ino",
  "esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino",
  "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino",
  "arduino_uno_r4/pod_uno_r4_eink27/pod_uno_r4_eink27.ino",
  "arduino_uno_r4/pod_uno_r4_eink27_oled/pod_uno_r4_eink27_oled.ino",
  "arduino_uno_r4/pod_uno_r4_tft18/pod_uno_r4_tft18.ino",
  "arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino",
];
for (const sketch of SKETCHES) {
  test(`${sketch} : vote v2 sur tout type d'écran, re-register sur 403`, () => {
    const src = read(sketch);
    assert.ok(src.includes("/api/candidate-frame?candidateId="), "relit le candidat");
    assert.doesNotMatch(src, /kind\s*!=\s*POD_[A-Z0-9]+/, "ne refuse aucun type d'écran");
    assert.ok(src.includes('indexOf("Signature")'), "ré-enregistre la clé publique sur un 403 « Signature »");
    assert.ok(src.includes("doRegister()"));
  });
}
