/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/dopull-chain-report.js — DOPULL-PHASE-AUDIT1 : chaînes d'appels STATIQUES `hal_entry → arduino_main → setup → doPull → …` et `… → loop → doPull → …` sur la pile PRINCIPALE du UNO R4 (1 024 o).
//   node scripts/dopull-chain-report.js <désassemblage.dis>
// Pour chaque appelé direct de doPull : profondeur (cadre + pire chaîne en dessous), cumul depuis hal_entry, marge restante. Catégories : ArduinoJson, asciiFold, EEPROM, journal (logf), String, autres.
// Hypothèses : analyse STATIQUE (appels directs `bl` / `b.w`, cadres fixes) ; la branche flottante de printf (jamais exécutée, aucun %f) est exclue ; `logfEmit` est exclu : il s'exécute sur la pile de JOURNAL dédiée (trampoline),
// seule sa branche directe (déjà sur une pile dédiée) le met sur la pile principale, ce qui n'arrive jamais depuis doPull. Les appels indirects ne sont pas suivis (comptés). Les fonctions en ligne dans doPull sont dans son cadre.
const fs = require("fs");
const { parse, deepest, countIndirect } = require("./stack-callgraph");
const dis = process.argv[2];
const rootName = process.argv[3] || "doPull";   // REGISTER-JSON-STACK-FIX1 : « doRegister » pour la chaîne de l'inscription (mangling _ZL10doRegisterv)
if (!dis) { console.error("usage : dopull-chain-report.js <fichier.dis>"); process.exit(2); }
const funcs = parse(fs.readFileSync(dis, "utf8"));
const names = [...funcs.keys()];
const find = (re) => names.find((k) => re.test(k));
const fr = (n) => (n && funcs.get(n) ? funcs.get(n).frame : 0);
const skip = new Set(["_printf_float", "__cvt", "_dtoa_r", ...names.filter((k) => /logfEmit/.test(k))]);
const short = (s) => s.replace(/^_Z[NL]?\d*/, "").slice(0, 26);
const category = (n) => /ArduinoJson/.test(n) ? "ArduinoJson" : /asciiFold/.test(n) ? "asciiFold" : /EEPROM|saveBlockHash|saveOwnedBlock|persist|saveKeys/i.test(n) ? "EEPROM" : /^_ZL4logf|logf/.test(n) ? "journal (logf)" : /String/.test(n) ? "String" : "autre";
const hal = find(/^hal_entry$/), am = find(/^_Z12arduino_mainv$/), setup = find(/^setup$/), loop = find(/^loop$/), doPull = find(new RegExp("^_ZL" + rootName.length + rootName + "v$"));
if (!doPull) { console.error(rootName + " introuvable dans le désassemblage"); process.exit(1); }
const out = [];
out.push(`# doPull : cadre ${fr(doPull)} o ; appelés directs : ${funcs.get(doPull).calls.size + funcs.get(doPull).tails.size} ; appels indirects dans doPull : ${funcs.get(doPull).indirect}`);
for (const [label, entry] of [["setup", setup], ["loop", loop]]) {
  const base = fr(hal) + fr(am) + fr(entry);
  const upToDoPull = base + fr(doPull);
  out.push(`\n# ${label} → ${rootName} : hal_entry ${fr(hal)} + arduino_main ${fr(am)} + ${label} ${fr(entry)} + doPull ${fr(doPull)} = ${upToDoPull} o (${1024 - upToDoPull} o restants pour les appelés)`);
  const rows = [...funcs.get(doPull).calls, ...funcs.get(doPull).tails].map((c) => { const d = deepest(funcs, c, skip); return { c, depth: d.depth, cat: category(c), path: d.path.map(short).join(" > "), ind: countIndirect(funcs, c) }; }).sort((a, b) => b.depth - a.depth);
  for (const r of rows.slice(0, 14)) {
    const total = upToDoPull + r.depth;
    out.push(`  ${short(r.c).padEnd(28)} ${r.cat.padEnd(15)} sous doPull ${String(r.depth).padStart(4)} o · cumul ${String(total).padStart(4)} o · marge ${String(1024 - total).padStart(4)} o${r.ind ? ` · indirects ${r.ind}` : ""}   ${r.path.slice(0, 110)}`);
  }
  const byCat = {};
  for (const r of rows) byCat[r.cat] = Math.max(byCat[r.cat] || 0, r.depth);
  out.push(`  pire chaîne par catégorie (sous doPull) : ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} o`).join(" · ")}`);
  const worst = rows[0];
  out.push(`  => pire cas statique ${label} : ${upToDoPull + (worst ? worst.depth : 0)} o sur 1024 (marge ${1024 - upToDoPull - (worst ? worst.depth : 0)} o) via ${worst ? short(worst.c) : "(aucun)"}`);
}
console.log(out.join("\n"));
