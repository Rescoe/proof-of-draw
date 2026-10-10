/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/json-inventory.js — REGISTER-JSON-STACK-FIX1 : INVENTAIRE FORMEL des appels `deserializeJson(` des cinq sketches UNO R4 (fonction englobante, ligne, capacité du document, pile d'exécution).
//   node scripts/json-inventory.js            → tableau Markdown sur la sortie standard
// « travail » = exécuté par podWorkRun (pullParseWork, registerParseWork) ; « principale » = pile principale de 1 024 o (À MIGRER). tests/registerJsonStack.test.ts fige la liste attendue.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const SKETCHES = ["pod_uno_r4_eink29", "pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"];
const WORK = /^(pullParseWork|registerParseWork)$/;
const PLAN = {
  doValidate: "à migrer AVANT le premier vote réel (réponse /api/validate-candidate ; le vote signe ensuite sur PodEd)",
  doRegister: "à migrer après validation matérielle (REGISTER-JSON-STACK-FIX1 du e-ink 2,9″)",
  doPull: "à migrer après validation matérielle (DOPULL-JSON-STACK-FIX1 du e-ink 2,9″)",
  benchPollOnce: "banc d'essai TFT 2,8″ : firmware bloqué pour tout flash",
};
function enclosing(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    const l = lines[i].replace(/__attribute__\(\([^)]*\)\)\s*/g, "");
    const m = /^[A-Za-z_][^(]*?\b([A-Za-z_]\w*)\([^;]*\)\s*(?:const\s*)?\{\s*$/.exec(l);
    if (m && !/^(if|for|while|switch|else)$/.test(m[1])) return m[1];
  }
  return "?";
}
const rows = [];
for (const sk of SKETCHES) {
  const lines = fs.readFileSync(path.join(root, "arduino_uno_r4", sk, sk + ".ino"), "utf8").replace(/\r\n/g, "\n").split("\n");
  lines.forEach((l, i) => {
    if (/^\s*\/\//.test(l) || !/\bdeserializeJson\(/.test(l.replace(/\/\/.*$/, ""))) return;
    const fn = enclosing(lines, i);
    let cap = "?";
    for (let k = i; k >= Math.max(0, i - 8); k--) { const m = /JSON_DOC\((\w+),\s*(\d+)\)/.exec(lines[k]); if (m) { cap = m[2]; break; } }
    rows.push({ sk, fn, line: i + 1, cap, stack: WORK.test(fn) ? "travail" : "principale" });
  });
}
console.log("| firmware | fonction | ligne | document | pile | décision |\n|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.sk} | ${r.fn} | ${r.line} | ${r.cap} | **${r.stack}** | ${r.stack === "travail" ? "migré (pile de travail dédiée)" : PLAN[r.fn] || "?"} |`);
const main = rows.filter((r) => r.stack === "principale").length;
console.log(`\nTotal : ${rows.length} sites ; pile de travail : ${rows.length - main} ; pile principale : ${main}.`);
