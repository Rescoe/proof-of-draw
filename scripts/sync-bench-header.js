// scripts/sync-bench-header.js — copie les en-têtes partagés du banc d'essai dans chaque dossier de firmware (un dossier de firmware est AUTONOME :
// il est zippé tel quel par /api/esp-firmware et ouvert seul dans l'IDE Arduino). `node scripts/sync-bench-header.js` ; tests/benchHeaderCopies.test.ts
// échoue si une copie diverge de son original.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

const MASTERS = {
  "pod_bench.h": "arduino_uno_r4/pod_uno_r4/pod_bench.h",          // lecteur de clips (aucune dépendance Arduino)
  "pod_bench_esp.h": "esp8266/_shared/pod_bench_esp.h",            // réseau + mesures ESP8266
};
const COPIES = {
  "pod_bench.h": ["esp8266/esp_tft1.8/pod_bench.h", "esp8266/esp_eink_2.7BW_OLED/pod_bench.h"],
  "pod_bench_esp.h": ["esp8266/esp_tft1.8/pod_bench_esp.h", "esp8266/esp_eink_2.7BW_OLED/pod_bench_esp.h"],
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
