/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/podnet-epilogue-report.js — NETSTACK-FIX3 : où la pile PRINCIPALE du UNO R4 e-ink 2,9″ peut-elle atteindre 1 048 o (24 o sous __StackLimit) pendant doRegister ?
//   node scripts/podnet-epilogue-report.js <désassemblage.dis> [adresse-hex …]
// 1. cadres cumulés hal_entry → arduino_main → setup → doRegister → httpCall → netHttpRaw → PodNet::runSized, et profondeur statique de l'ÉPILOGUE de PodNet (malloc, memset, free, effacement) ;
// 2. profondeur statique des appels au module Wi-Fi faits par doRegister AVANT sa transaction (WiFi.macAddress → ModemClass::write → vsnprintf → __ssputs_r → _realloc_r) : cumul depuis hal_entry ;
// 3. résolution des adresses données (ex. les adresses de code relevées parmi les octets détruits autour de __StackLimit) vers la fonction qui les contient.
// Hypothèses : analyse statique (cadres fixes, appels directs ; la branche flottante de printf, jamais exécutée, est exclue ; appels indirects non suivis).
const fs = require("fs");
const { parse, deepest } = require("./stack-callgraph");
const text = fs.readFileSync(process.argv[2], "utf8");
const funcs = parse(text);
const skipFloat = new Set(["_printf_float", "__cvt", "_dtoa_r"]);
const find = (re) => [...funcs.keys()].find((k) => re.test(k));
const frame = (n) => (n && funcs.get(n) ? funcs.get(n).frame : 0);
const out = [];
const chain = [["hal_entry", "hal_entry"], ["arduino_main", /^_Z12arduino_mainv$/], ["setup", /^setup$/], ["doRegister", /^_ZL10doRegisterv$/], ["httpCall", /^_ZL8httpCallPKcRKN7arduino6StringEPS3_RS2_$/],
  ["netHttpRaw", /^_ZL10netHttpRaw/], ["PodNet::runSized", /^_ZN6PodNet8runSized/]];
out.push("# 1. Cadres cumulés jusqu'à PodNet::runSized (octets) — pile principale du cœur UNO R4 = 1 024 o");
let cum = 0;
for (const [label, key] of chain) {
  const n = typeof key === "string" ? key : find(key);
  const fr = frame(n); cum += fr;
  out.push(`${label.padEnd(20)} cadre ${String(fr).padStart(4)}  cumul ${String(cum).padStart(5)}`);
}
const runSized = find(/^_ZN6PodNet8runSized/);
const epi = [];
for (const c of funcs.get(runSized).calls) { const d = deepest(funcs, c, skipFloat); epi.push({ name: c, depth: d.depth, path: d.path.map((s) => s.replace(/^_Z[NL]?\d*/, "").slice(0, 16)).join(">") }); }
epi.sort((a, b) => b.depth - a.depth);
out.push("\n# Épilogue de PodNet (appels directs de runSized, sans la branche flottante) :");
for (const e of epi) out.push(`  ${e.name.replace(/^_Z[NL]?\d*/, "").padEnd(34).slice(0, 34)} profondeur ${String(e.depth).padStart(4)}  ${e.path}`);
const epiMax = epi.length ? epi[0].depth : 0;
out.push(`=> pire cas statique de l'épilogue, sous le cadre de runSized : cumul ${cum} + ${epiMax} = ${cum + epiMax} o`);
// 2. appels au module Wi-Fi faits par doRegister
const baseDoReg = ["hal_entry", /^_Z12arduino_mainv$/, /^setup$/, /^_ZL10doRegisterv$/].reduce((s, k) => s + frame(typeof k === "string" ? k : find(k)), 0);
out.push(`\n# 2. Appels faits par doRegister AVANT sa transaction : cumul des cadres jusqu'à doRegister = ${baseDoReg} o`);
const cands = [...funcs.keys()].filter((k) => /^_ZN5CWifi(10macAddress|6status|7localIP|4RSSI|15firmwareVersion|5begin)/.test(k) || /^sniprintf$/.test(k));
const rows = cands.map((n) => { const d = deepest(funcs, n, skipFloat); return { n, depth: d.depth, path: d.path.map((s) => s.replace(/^_Z[NL]?\d*/, "").slice(0, 18)).join(">") }; }).sort((a, b) => b.depth - a.depth);
for (const r of rows) out.push(`  ${r.n.replace(/^_ZN?\d*/, "").padEnd(30).slice(0, 30)} profondeur ${String(r.depth).padStart(4)}  cumul depuis hal_entry (si appelé par doRegister) ${String(baseDoReg + r.depth).padStart(5)}`);
const calls = [...funcs.get(find(/^_ZL10doRegisterv$/)).calls].filter((c) => /CWifi|sniprintf/.test(c)).map((c) => c.replace(/^_ZN?\d*/, ""));
out.push(`  appelés DIRECTEMENT par doRegister : ${calls.join(", ") || "(aucun)"}`);
// 3. résolution d'adresses
const addrs = process.argv.slice(3).map((a) => parseInt(a, 16));
if (addrs.length) {
  out.push("\n# 3. Adresses de code relevées parmi les octets détruits → fonction contenante");
  const list = [...funcs.values()].sort((a, b) => a.addr - b.addr);
  for (const a of addrs) { let hit = null; for (const f of list) if (f.addr <= (a & ~1)) hit = f; else break; out.push(`  0x${a.toString(16)} → ${hit ? hit.name.replace(/^_Z[NL]?\d*/, "") + ` (+0x${((a & ~1) - hit.addr).toString(16)})` : "?"}`); }
}
console.log(out.join("\n"));
