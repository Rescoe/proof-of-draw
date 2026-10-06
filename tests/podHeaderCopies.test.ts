import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Un dossier de firmware est autonome (l'IDE Arduino ne compile que son dossier) : les en-têtes de validation réelle existent en COPIES IDENTIQUES.
// Après une modification de l'original dans esp8266/_shared : le recopier (la table d'entropie se régénère avec scripts/gen-pod-metrics-table.js).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

const COPIES: Record<string, string[]> = {
  "esp8266/_shared/pod_metrics.h": ["esp8266/esp_eink_2.9BWR/pod_metrics.h", "arduino_uno_r4/pod_uno_r4_eink29/pod_metrics.h"],
  "esp8266/_shared/pod_metrics_table.h": ["esp8266/esp_eink_2.9BWR/pod_metrics_table.h", "arduino_uno_r4/pod_uno_r4_eink29/pod_metrics_table.h"],
  "esp8266/_shared/pod_vote_esp.h": ["esp8266/esp_eink_2.9BWR/pod_vote_esp.h"],
};

for (const [original, copies] of Object.entries(COPIES)) {
  for (const copy of copies) {
    test(`${copy} = ${original}`, () => assert.equal(read(copy), read(original)));
  }
}

test("l'en-tête de la table d'entropie ne dépend pas de <pgmspace.h> (absent du cœur UNO R4)", () => {
  assert.doesNotMatch(read("esp8266/_shared/pod_metrics_table.h"), /#include <pgmspace\.h>/);
});
