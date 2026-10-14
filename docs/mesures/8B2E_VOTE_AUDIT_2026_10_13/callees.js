// usage: node callees.js <worktree> <file.dis> <racine-substr> ...  : pour chaque racine, ses appelés DIRECTS triés par profondeur (barrières: piles dédiées)
const path = require("path");
const fs = require("fs");
const { parse } = require(path.join(process.argv[2], "scripts", "stack-callgraph.js"));
const f = parse(fs.readFileSync(process.argv[3], "utf8"));
const names = [...f.keys()];
const BAR = /onSdDirect|runSized|podNetRun|podWifiRun|podWorkRun|PodEd|PodNet|netHttpRaw|logfEmit/;
const skip = new Set(["_printf_float", "__cvt", "_dtoa_r"]);
function deep(n, vis = new Set(), memo = new Map(), root = false) {
  if (memo.has(n)) return memo.get(n);
  const x = f.get(n);
  if (!x || skip.has(n)) return { d: 0, p: [n + "?"] };
  if (!root && BAR.test(n)) return { d: x.frame, p: [n.slice(0, 70) + "(" + x.frame + " barriere)"] };
  if (vis.has(n)) return { d: 0, p: [] };
  vis.add(n);
  let b = { d: 0, p: [] };
  for (const c of [...x.calls, ...x.tails]) { const r = deep(c, vis, memo); if (r.d > b.d) b = r; }
  vis.delete(n);
  const r = { d: x.frame + b.d, p: [n.slice(0, 70) + "(" + x.frame + ")", ...b.p] };
  memo.set(n, r);
  return r;
}
for (const a of process.argv.slice(4)) {
  const n = names.find((k) => k === a || k.includes(a));
  if (!n) { console.log(a, "absente"); continue; }
  const x = f.get(n);
  console.log(`## ${n} cadre ${x.frame}, appels indirects ${x.indirect}`);
  const rows = [...x.calls, ...x.tails].map((c) => { const r = deep(c, new Set(), new Map()); return { c, d: r.d, bar: BAR.test(c) }; }).sort((p, q) => q.d - p.d);
  for (const r of rows.slice(0, 40)) console.log(`   ${String(r.d).padStart(4)}  ${r.bar ? "[BARRIERE] " : ""}${r.c.slice(0, 110)}`);
}
