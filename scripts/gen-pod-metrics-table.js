// Génère la table d'entropie de « pod-metrics-2 » : H(q/1024) en bits × 1 000 000, arrondi à l'entier, q = 0..1024.
// Sortie : lib/podMetricsTable.ts (serveur) et esp8266/_shared/pod_metrics_table.h (firmwares). À relancer seulement si la spécification change
// (alors incrémenter METRICS_VERSION). Test : tests/podMetrics.test.ts vérifie que les deux fichiers correspondent à cette formule.
const fs = require("fs");
const path = require("path");
const H = (q) => { if (q === 0 || q === 1024) return 0; const p = q / 1024; return Math.round(1e6 * -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p))); };
const table = Array.from({ length: 1025 }, (_, q) => H(q));
const rows = (items, per) => { const out = []; for (let i = 0; i < items.length; i += per) out.push("  " + items.slice(i, i + per).join(", ")); return out.join(",\n"); };
const root = path.join(__dirname, "..");
fs.writeFileSync(path.join(root, "lib", "podMetricsTable.ts"),
`// lib/podMetricsTable.ts — GÉNÉRÉ par scripts/gen-pod-metrics-table.js (ne pas éditer). Entropie binaire H(q/1024) en ppm de bit, q = 0..1024.
export const ENTROPY_TABLE: readonly number[] = [
${rows(table, 12)},
];
`);
fs.writeFileSync(path.join(root, "esp8266", "_shared", "pod_metrics_table.h"),
`// pod_metrics_table.h — GÉNÉRÉ par scripts/gen-pod-metrics-table.js (ne pas éditer). Entropie binaire H(q/1024) en ppm de bit, q = 0..1024 (4 100 octets en flash).
#pragma once
#include <stdint.h>
#ifdef ARDUINO
#include <pgmspace.h>
#define POD_PROGMEM PROGMEM
#else
#define POD_PROGMEM
#endif
static const uint32_t POD_ENTROPY_TABLE[1025] POD_PROGMEM = {
${rows(table, 12)}
};
`);
console.log("ok", table[512], table[1], table[1024]);
