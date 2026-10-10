/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/disasm-compare.js — compare deux désassemblages ARM (arm-none-eabi-objdump -d --no-show-raw-insn) FONCTION PAR FONCTION, en normalisant ce qui ne dépend que de la disposition :
// adresses absolues (cibles de branchement, remplacées par « <symbole> » + décalage normalisé) et compteurs générés par GCC (« .isra.N », « .part.N », « .constprop.N », « CSWTCH.N »).
//   node scripts/disasm-compare.js <avant.dis> <après.dis> [fonction-à-détailler]
//   node scripts/disasm-compare.js <avant.dis> <après.dis> [fonction] --pool <avant.nm> <avant.hex> <après.nm> <après.hex>
// Option --pool : normalise aussi les MOTS DE LITTÉRAL (« .word 0x… ») qui sont des adresses — résolues par la table des symboles (`nm -S -n`) et le contenu de .text (`objdump -s -j .text`) :
//   adresse de donnée RAM -> « <symbole+décalage> » ; adresse de fonction ou d'objet dans .text -> « <symbole+décalage> » ; chaîne de caractères (littéral) -> « <chaîne:"…"> » (le CONTENU, pas l'adresse).
//   Une vraie constante (valeur qui n'est pas une adresse connue) reste littérale : si elle change, la fonction est « différente ».
// Sert à prouver qu'un changement de source qui déplace du code (ordre d'inclusion, code ajouté ailleurs) ne change AUCUNE instruction des autres fonctions. Limite : les pseudo-fonctions de données décodées
// par objdump (ex. « __FUNCTION__.N ») peuvent différer sans être du code.
const fs = require("fs");
const argv = process.argv.slice(2);
const poolIdx = argv.indexOf("--pool");
const poolFiles = poolIdx >= 0 ? argv.splice(poolIdx, 5).slice(1) : null;
const [a, b, detail] = argv;
if (!a || !b) { console.error("usage : disasm-compare.js <avant.dis> <après.dis> [fonction] [--pool <avant.nm> <avant.hex> <après.nm> <après.hex>]"); process.exit(2); }
const norm = (s) => s.replace(/\.(isra|part|constprop)\.\d+/g, ".$1").replace(/CSWTCH\.\d+/g, "CSWTCH");

function loadPool(nmFile, hexFile) {
  const syms = [];
  for (const l of fs.readFileSync(nmFile, "utf8").split(/\r?\n/)) {
    const m = /^([0-9a-f]{8})\s+(?:([0-9a-f]{8})\s+)?(\S)\s+(\S+)$/.exec(l);
    if (m) syms.push({ addr: parseInt(m[1], 16), size: m[2] ? parseInt(m[2], 16) : 0, name: norm(m[4]) });
  }
  syms.sort((x, y) => x.addr - y.addr);
  const text = new Map();
  for (const l of fs.readFileSync(hexFile, "utf8").split(/\r?\n/)) {
    const m = /^\s([0-9a-f]+)\s((?:[0-9a-f]{2,8}\s?){1,4})/.exec(l);
    if (!m) continue;
    let addr = parseInt(m[1], 16);
    for (const g of m[2].trim().split(/\s+/)) for (let i = 0; i < g.length; i += 2) text.set(addr++, parseInt(g.slice(i, i + 2), 16));
  }
  const find = (v) => { // symbole contenant v : dernier symbole dont addr <= v < addr+size (ou == addr si size 0)
    let lo = 0, hi = syms.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (syms[mid].addr <= v) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    for (let i = best; i >= 0 && i > best - 6; i--) { const s = syms[i]; if (v >= s.addr && (v < s.addr + s.size || v === s.addr)) return s; }
    return null;
  };
  return (val) => {
    const v = val;
    const inRam = v >= 0x20000000 && v < 0x20008000, inText = v >= 0x4000 && v < 0x23000;
    if (!inRam && !inText) return null;
    let vv = v, s = null;
    if (v & 1) { const s0 = find(v & ~1); if (s0 && s0.addr === (v & ~1)) { s = s0; vv = v & ~1; } }   // bit Thumb d'une adresse de FONCTION (une chaîne peut commencer à une adresse impaire)
    if (!s) s = find(v);
    if (s && (inRam || vv === s.addr || /^_ZT[VIS]/.test(s.name))) return `<${s.name}+${vv - s.addr}>`;   // RAM : symbole+décalage ; .text : seulement le DÉBUT d'un symbole (fonction, objet)
    if (inText) {                                           // sinon (chaîne, table sans symbole, intérieur d'un objet) : le CONTENU, pas l'adresse                                           // aucun symbole : chaîne littérale -> son contenu
      let str = "", p = v; while (text.has(p) && text.get(p) !== 0 && str.length < 80) { const c = text.get(p++); str += c >= 32 && c < 127 ? String.fromCharCode(c) : `\\x${c.toString(16)}`; }
      const c0 = text.get(v) ?? 0;
      if (c0 === 0 || (c0 >= 32 && c0 < 127)) return `<chaîne:"${str}">`;     // texte (jusqu'au zéro final) ; sinon : fenêtre de 32 octets (table de constantes)
      return `<rodata:${[...Array(32).keys()].map((i) => (text.get(v + i) ?? 0).toString(16).padStart(2, "0")).join("")}>`;
    }
    return "<ram>";
  };
}

function load(f, pool) {
  const funcs = new Map(); let cur = null;
  for (const raw of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const h = /^[0-9a-f]+ <([^>]+)>:$/.exec(raw);
    if (h) { cur = { name: norm(h[1]), body: [] }; funcs.set(cur.name, cur); continue; }
    if (!cur) continue;
    const m = /^\s+[0-9a-f]+:\s+(.*)$/.exec(raw);
    if (!m) continue;
    let ins = norm(m[1]).replace(/;.*$/, "").replace(/\s+/g, " ").trim();
    ins = ins.replace(/Address 0x[0-9a-f]+ is out of bounds\./, "<hors-limites>");   // objdump décode un mot de littéral hors section
    ins = ins.replace(/\b[0-9a-f]{3,8} </g, "<");                       // cible absolue suivie d'un symbole -> symbole seul
    ins = ins.replace(/<([^>+]+)\+0x[0-9a-f]+>/g, "<$1+off>");          // décalage intra-fonction : normalisé
    if (pool) { const w = /^\.word 0x([0-9a-f]{1,8})$/.exec(ins); if (w) { const r = pool(parseInt(w[1], 16)); if (r) ins = `.word ${r}`; } }
    cur.body.push(ins);
  }
  return funcs;
}
const A = load(a, poolFiles ? loadPool(poolFiles[0], poolFiles[1]) : null), B = load(b, poolFiles ? loadPool(poolFiles[2], poolFiles[3]) : null);
let same = 0; const diff = [], onlyA = [], onlyB = [];
for (const [n, f] of A) { const g = B.get(n); if (!g) { onlyA.push(n); continue; } if (f.body.join("\n") === g.body.join("\n")) same++; else diff.push(n); }
for (const n of B.keys()) if (!A.has(n)) onlyB.push(n);
console.log(JSON.stringify({ fonctions: A.size, identiques: same, differentes: diff.length, seulementAvant: onlyA.length, seulementApres: onlyB.length }));
if (diff.length) console.log("différentes :", diff.slice(0, 40).join(", "));
if (onlyA.length) console.log("seulement avant :", onlyA.slice(0, 20).join(", "));
if (onlyB.length) console.log("seulement après :", onlyB.slice(0, 40).join(", "));
if (detail && A.has(detail) && B.has(detail)) {
  const x = A.get(detail).body, y = B.get(detail).body; let shown = 0;
  for (let i = 0; i < Math.max(x.length, y.length) && shown < 8; i++) if (x[i] !== y[i]) { console.log(`ligne ${i} AVANT: ${x[i]} | APRÈS: ${y[i]}`); shown++; }
}
process.exit(diff.filter((n) => !/^__FUNCTION__|^__func__/.test(n)).length === 0 && onlyA.length === 0 && onlyB.length === 0 ? 0 : 1);
