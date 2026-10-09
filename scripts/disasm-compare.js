/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/disasm-compare.js — compare deux désassemblages ARM (arm-none-eabi-objdump -d --no-show-raw-insn) FONCTION PAR FONCTION, en normalisant ce qui ne dépend que de la disposition :
// adresses absolues (cibles de branchement, remplacées par « <symbole> » + décalage normalisé) et compteurs générés par GCC (« .isra.N », « .part.N », « .constprop.N », « CSWTCH.N »).
//   node scripts/disasm-compare.js <avant.dis> <après.dis> [fonction-à-détailler]
// Sert à prouver qu'un changement de source qui déplace du code (ordre d'inclusion) ne change AUCUNE instruction du firmware de production. Limite : les littéraux de pool qui contiennent des adresses
// sont des commentaires (« ; (0x…) ») ignorés ; les pseudo-fonctions de données décodées par objdump (ex. « __FUNCTION__.N ») peuvent différer sans être du code.
const fs = require("fs");
const [a, b, detail] = process.argv.slice(2);
if (!a || !b) { console.error("usage : disasm-compare.js <avant.dis> <apres.dis> [fonction]"); process.exit(2); }
const norm = (s) => s.replace(/\.(isra|part|constprop)\.\d+/g, ".$1").replace(/CSWTCH\.\d+/g, "CSWTCH");
function load(f) {
  const funcs = new Map(); let cur = null;
  for (const raw of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const h = /^[0-9a-f]+ <([^>]+)>:$/.exec(raw);
    if (h) { cur = { name: norm(h[1]), body: [] }; funcs.set(cur.name, cur); continue; }
    if (!cur) continue;
    const m = /^\s+[0-9a-f]+:\s+(.*)$/.exec(raw);
    if (!m) continue;
    let ins = norm(m[1]).replace(/;.*$/, "").replace(/\s+/g, " ").trim();
    ins = ins.replace(/\b[0-9a-f]{3,8} </g, "<");                       // cible absolue suivie d'un symbole -> symbole seul
    ins = ins.replace(/<([^>+]+)\+0x[0-9a-f]+>/g, "<$1+off>");          // décalage intra-fonction : normalisé
    cur.body.push(ins);
  }
  return funcs;
}
const A = load(a), B = load(b);
let same = 0; const diff = [], onlyA = [], onlyB = [];
for (const [n, f] of A) { const g = B.get(n); if (!g) { onlyA.push(n); continue; } if (f.body.join("\n") === g.body.join("\n")) same++; else diff.push(n); }
for (const n of B.keys()) if (!A.has(n)) onlyB.push(n);
console.log(JSON.stringify({ fonctions: A.size, identiques: same, differentes: diff.length, seulementAvant: onlyA.length, seulementApres: onlyB.length }));
if (diff.length) console.log("différentes :", diff.slice(0, 12).join(", "));
if (detail && A.has(detail) && B.has(detail)) {
  const x = A.get(detail).body, y = B.get(detail).body; let shown = 0;
  for (let i = 0; i < Math.max(x.length, y.length) && shown < 8; i++) if (x[i] !== y[i]) { console.log(`ligne ${i} AVANT: ${x[i]} | APRÈS: ${y[i]}`); shown++; }
}
process.exit(diff.filter((n) => !/^__FUNCTION__|^__func__/.test(n)).length === 0 && onlyA.length === 0 && onlyB.length === 0 ? 0 : 1);
