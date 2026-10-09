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
  // Rendu v1 (lot 8B-2A) : noyau de rendu en flux, INACTIF par défaut (POD_RENDER_V1 = 0) — voir docs/LOT_8B2A_INTEGRATION_CANARIS_2026_10_08.md
  "consensusPoD.h": "consensus-pod/src/consensusPoD.h",
  "podRender.h": "consensus-pod/src/podRender.h",
  "podRenderStream.h": "consensus-pod/src/podRenderStream.h",
  "crypto_esp8266.h": "consensus-pod/src/adapters/crypto_esp8266.h",
  "crypto_uno_r4.h": "consensus-pod/src/adapters/crypto_uno_r4.h",
  // Ed25519 sur pile dédiée (lot 8B-2B-2-STACK-FIX1) : les CINQ firmwares UNO R4 qui signent (le TFT 2,8″ inclus)
  "podEdStack.h": "consensus-pod/src/adapters/podEdStack.h",
  // Transactions réseau/TLS sur pile dédiée (lot 8B-2B-2 NETSTACK-FIX1) : les CINQ firmwares UNO R4
  "podNetStack.h": "consensus-pod/src/adapters/podNetStack.h",
};
const RENDER_ESP = ["esp8266/esp_eink_2.9BWR", "esp8266/esp_tft1.8", "esp8266/esp_eink_2.7BW", "esp8266/esp_eink_2.7BW_OLED"], RENDER_R4 = ["arduino_uno_r4/pod_uno_r4_eink29", "arduino_uno_r4/pod_uno_r4_tft18", "arduino_uno_r4/pod_uno_r4_eink27", "arduino_uno_r4/pod_uno_r4_eink27_oled"];
const ED_STACK_R4 = [...RENDER_R4, "arduino_uno_r4/pod_uno_r4"];
const COPIES = {
  "pod_bench.h": ["esp8266/esp_tft1.8/pod_bench.h", "esp8266/esp_eink_2.7BW_OLED/pod_bench.h"],
  "pod_bench_esp.h": ["esp8266/esp_tft1.8/pod_bench_esp.h", "esp8266/esp_eink_2.7BW_OLED/pod_bench_esp.h"],
  "pod_anim_esp.h": ["esp8266/esp_tft1.8/pod_anim_esp.h", "esp8266/esp_eink_2.7BW_OLED/pod_anim_esp.h"],
  // Validation réelle : e-ink 2,9" BWR, TFT 1,8", multiscreen et e-ink 2,7" seul (ESP8266)
  "pod_metrics.h": ["esp8266/esp_eink_2.9BWR/pod_metrics.h", "esp8266/esp_tft1.8/pod_metrics.h", "esp8266/esp_eink_2.7BW_OLED/pod_metrics.h", "esp8266/esp_eink_2.7BW/pod_metrics.h", "consensus-pod/src/pod_metrics.h", "arduino_uno_r4/pod_uno_r4_eink29/pod_metrics.h", "arduino_uno_r4/pod_uno_r4_tft18/pod_metrics.h", "arduino_uno_r4/pod_uno_r4_eink27/pod_metrics.h", "arduino_uno_r4/pod_uno_r4_eink27_oled/pod_metrics.h"],
  "pod_metrics_table.h": ["esp8266/esp_eink_2.9BWR/pod_metrics_table.h", "esp8266/esp_tft1.8/pod_metrics_table.h", "esp8266/esp_eink_2.7BW_OLED/pod_metrics_table.h", "esp8266/esp_eink_2.7BW/pod_metrics_table.h", "consensus-pod/src/pod_metrics_table.h", "arduino_uno_r4/pod_uno_r4_eink29/pod_metrics_table.h", "arduino_uno_r4/pod_uno_r4_tft18/pod_metrics_table.h", "arduino_uno_r4/pod_uno_r4_eink27/pod_metrics_table.h", "arduino_uno_r4/pod_uno_r4_eink27_oled/pod_metrics_table.h"],
  "pod_vote_esp.h": ["esp8266/esp_eink_2.9BWR/pod_vote_esp.h", "esp8266/esp_tft1.8/pod_vote_esp.h", "esp8266/esp_eink_2.7BW_OLED/pod_vote_esp.h", "esp8266/esp_eink_2.7BW/pod_vote_esp.h"],
  // Rendu v1 (INACTIF par défaut) : les HUIT firmwares à cartel gravé (lots 8B-2A + 8B-2B-1) ; les firmwares sans cartel (R4 TFT 2,8″, R4 OLED, multiscreen OLED) ne sont pas concernés
  "consensusPoD.h": [...RENDER_ESP, ...RENDER_R4].map((d) => d + "/consensusPoD.h"),
  "podRender.h": [...RENDER_ESP, ...RENDER_R4].map((d) => d + "/podRender.h"),
  "podRenderStream.h": [...RENDER_ESP, ...RENDER_R4].map((d) => d + "/podRenderStream.h"),
  "crypto_esp8266.h": RENDER_ESP.map((d) => d + "/crypto_esp8266.h"),
  "crypto_uno_r4.h": RENDER_R4.map((d) => d + "/crypto_uno_r4.h"),
  "podEdStack.h": ED_STACK_R4.map((d) => d + "/podEdStack.h"),
  "podNetStack.h": ED_STACK_R4.map((d) => d + "/podNetStack.h"),
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
