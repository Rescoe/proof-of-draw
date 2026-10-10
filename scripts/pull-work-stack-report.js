/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/pull-work-stack-report.js — DOPULL-JSON-STACK-FIX1 : dimensionnement STATIQUE de la pile de TRAVAIL (podWorkRun) qui exécute pullParseWork (décodage JSON de /api/pull).
//   node scripts/pull-work-stack-report.js <désassemblage.dis> [limite-d'imbrication=10]
// Sortie : cadre de pullParseWork, pire chaîne ACYCLIQUE en dessous (chemin détaillé), composantes récursives atteignables (ArduinoJson : analyse récursive d'objets imbriqués), coût d'un niveau de récursion
// (borne basse = cycle simple le plus lourd, borne haute = somme des cadres de la composante), pire cas = chaîne acyclique + (limite − 1) × coût d'un niveau. Comparé au budget : POD_WORK_STACK_TOTAL − garde 64 −
// cadre d'exception 104 − invocateur/trampoline 32 (marge exigée 128, objectif 256).
// Hypothèses : analyse STATIQUE (appels directs, cadres fixes) ; appels indirects COMPTÉS, non suivis ; la branche flottante de printf (jamais un %f) et malloc/sbrk (pile du tas) ne sont pas exclues.
const fs = require("fs");
const { parse, deepest, countIndirect } = require("./stack-callgraph");
const [dis, limArg] = process.argv.slice(2);
if (!dis) { console.error("usage : pull-work-stack-report.js <fichier.dis> [limite]"); process.exit(2); }
const LIMIT = Number(limArg || 10);
const funcs = parse(fs.readFileSync(dis, "utf8"));
const names = [...funcs.keys()];
const rootName = process.argv[4] || "pullParseWork";   // REGISTER-JSON-STACK-FIX1 : « registerParseWork » pour la réponse de /api/register
const root = names.find((k) => k.includes(rootName) && !/OnWork/.test(k));
if (!root) { console.error(rootName + " introuvable"); process.exit(1); }
const short = (s) => s.replace(/^_Z[NL]?\d*/, "").replace(/ArduinoJson\d+V\d+/g, "AJ").slice(0, 34);
const skip = new Set(["_printf_float", "__cvt", "_dtoa_r", ...names.filter((k) => /logfEmit/.test(k))]);

// composantes fortement connexes atteignables depuis la racine (Tarjan)
const reach = new Set(); (function walk(n) { if (reach.has(n)) return; reach.add(n); const f = funcs.get(n); if (!f) return; f.calls.forEach(walk); f.tails.forEach(walk); })(root);
let idx = 0; const st = [], on = new Set(), index = new Map(), low = new Map(), sccs = [];
function strong(v) {
  index.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
  const f = funcs.get(v);
  for (const w of f ? [...f.calls, ...f.tails] : []) {
    if (!funcs.has(w) || !reach.has(w)) continue;
    if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1 || (funcs.get(v).calls.has(v))) sccs.push(c); }
}
for (const n of reach) if (funcs.has(n) && !index.has(n)) strong(n);

// cycle simple le plus lourd d'une composante (recherche exhaustive bornée)
function heaviestCycle(comp) {
  const set = new Set(comp); let best = 0, steps = 0;
  const dfs = (start, cur, seen, cost) => {
    if (++steps > 2e6) return;
    const f = funcs.get(cur);
    for (const w of [...f.calls, ...f.tails]) {
      if (!set.has(w)) continue;
      if (w === start) { best = Math.max(best, cost); continue; }
      if (seen.has(w)) continue;
      seen.add(w); dfs(start, w, seen, cost + funcs.get(w).frame); seen.delete(w);
    }
  };
  for (const s of comp) dfs(s, s, new Set([s]), funcs.get(s).frame);
  return { best, sum: comp.reduce((a, n) => a + funcs.get(n).frame, 0), steps };
}

const acyc = deepest(funcs, root, skip);
const out = [];
out.push(`# racine ${short(root)} : cadre ${funcs.get(root).frame} o ; pire chaîne ACYCLIQUE (cycles coupés) : ${acyc.depth} o ; appels indirects atteignables : ${countIndirect(funcs, root)}`);
out.push(`  chemin : ${acyc.path.map(short).join(" > ").slice(0, 400)}`);
let worstLevel = 0, sumLevel = 0;
for (const c of sccs) {
  const h = heaviestCycle(c);
  out.push(`  composante récursive (${c.length} fonctions) : cycle simple le plus lourd ${h.best} o · somme des cadres ${h.sum} o · ex. ${c.slice(0, 3).map(short).join(", ")}`);
  worstLevel = Math.max(worstLevel, h.best); sumLevel = Math.max(sumLevel, h.sum);
}
const lo = acyc.depth + (LIMIT - 1) * worstLevel, hi = acyc.depth + (LIMIT - 1) * sumLevel;
out.push(`  limite d'imbrication ${LIMIT} : pire cas statique ${lo} o (borne basse) à ${hi} o (borne haute) sous l'appelant de ${rootName}`);
const TOTAL = Number(process.env.POD_WORK_STACK_TOTAL || 2048), BUDGET = TOTAL - 64 - 104 - 32;
out.push(`  budget (${TOTAL} − garde 64 − exception 104 − invocateur 32) : ${BUDGET} o => marge au pire cas : ${BUDGET - hi} o (borne haute) / ${BUDGET - lo} o (borne basse) ; exigée >= 128, objectif >= 256`);
console.log(out.join("\n"));
process.exit(BUDGET - hi >= 256 ? 0 : 1);
