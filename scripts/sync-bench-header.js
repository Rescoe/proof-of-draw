/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/sync-bench-header.js — copie les en-têtes partagés du banc d'essai dans chaque dossier de firmware (un dossier de firmware est AUTONOME :
// il est zippé tel quel par /api/esp-firmware et ouvert seul dans l'IDE Arduino). `node scripts/sync-bench-header.js` ; tests/benchHeaderCopies.test.ts
// échoue si une copie diverge de son original.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

const MASTERS = {
  "pod_bench.h": "arduino_uno_r4/pod_uno_r4/pod_bench.h",          // lecteur de clips (aucune dépendance Arduino)
  "pod_bench_esp.h": "esp8266/_shared/pod_bench_esp.h",            // réseau + mesures ESP8266
  "pod_anim_esp.h": "esp8266/_shared/pod_anim_esp.h",              // animation résidente (clip en flash, lecture en boucle) ESP8266
  "pod_metrics.h": "esp8266/_shared/pod_metrics.h",                // validation réelle : métriques entières en flux (pur C++)
  "pod_metrics_table.h": "esp8266/_shared/pod_metrics_table.h",    // table d'entropie (générée : scripts/gen-pod-metrics-table.js)
  "pod_vote_esp.h": "esp8266/_shared/pod_vote_esp.h",              // validation réelle : lecture en flux + SHA-256 (ESP8266)
};
const COPIES = {
  "pod_bench.h": ["esp8266/esp_tft1.8/pod_bench.h", "esp8266/esp_eink_2.7BW_OLED/pod_bench.h"],
  "pod_bench_esp.h": ["esp8266/esp_tft1.8/pod_bench_esp.h", "esp8266/esp_eink_2.7BW_OLED/pod_bench_esp.h"],
  "pod_anim_esp.h": ["esp8266/esp_tft1.8/pod_anim_esp.h", "esp8266/esp_eink_2.7BW_OLED/pod_anim_esp.h"],
  // Validation réelle : e-ink 2,9" BWR, TFT 1,8" et multiscreen (ESP8266)
  "pod_metrics.h": ["esp8266/esp_eink_2.9BWR/pod_metrics.h", "esp8266/esp_tft1.8/pod_metrics.h", "esp8266/esp_eink_2.7BW_OLED/pod_metrics.h"],
  "pod_metrics_table.h": ["esp8266/esp_eink_2.9BWR/pod_metrics_table.h", "esp8266/esp_tft1.8/pod_metrics_table.h", "esp8266/esp_eink_2.7BW_OLED/pod_metrics_table.h"],
  "pod_vote_esp.h": ["esp8266/esp_eink_2.9BWR/pod_vote_esp.h", "esp8266/esp_tft1.8/pod_vote_esp.h", "esp8266/esp_eink_2.7BW_OLED/pod_vote_esp.h"],
};
module.exports = { MASTERS, COPIES };

if (require.main === module) {
  for (const [name, master] of Object.entries(MASTERS)) {
    const src = fs.readFileSync(path.join(root, master));
    for (const c of COPIES[name]) {
      fs.mkdirSync(path.dirname(path.join(root, c)), { recursive: true });
      fs.writeFileSync(path.join(root, c), src);
      console.log("copié", master, "→", c);
    }
  }
}
