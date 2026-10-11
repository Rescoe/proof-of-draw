/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/r4-eink27-chains.js — LOT8B2B3-R4-EINK27-PROPAGATION-FIX1 : pires chaînes d'appels STATIQUES sur la pile PRINCIPALE (1 024 o) d'un firmware UNO R4 (e-ink 2,9″ de référence, 2,7″ solo, 2,7″ + OLED)
//   node scripts/r4-eink27-chains.js <désassemblage.dis>      (arm-none-eabi-objdump -d --no-show-raw-insn <elf>)
// Pour chaque point d'entrée métier (register, pull + pull-frame + affichage + ACK, validate/vote, obs-confirm) : hal_entry + arduino_main + (setup | loop) + chaîne la plus profonde, marge restante sur 1 024 o.
// Deux lignes pour tout ce qui peut atteindre doRegister : « toutes branches » ET « hors affichage d'appairage » (displayOnboardingQR / displayKeyMaterialOnce / displayOnboardingOLED ne s'exécutent que si l'appareil
// n'est PAS appairé — jamais pendant un vote, qui suppose un appareil appairé : le « re-register » d'un vote refusé ne les atteint donc pas). Aucune hypothèse cachée : les deux chiffres sont donnés.
// Hypothèses : analyse STATIQUE (appels directs, cadres fixes, pas d'alloca, appels indirects non suivis) ; _printf_float / __cvt / _dtoa_r (jamais exécutés : aucun %f) et logfEmit (s'exécute sur la pile de journal dédiée) exclus ;
// les suffixes gcc « .isra.N » / « .constprop.N » sont acceptés. Ne remplace PAS la mesure sur la carte (canari). Seuil impératif : 128 o ; objectif : 256 o.
const fs = require("fs");
const { parse, deepest } = require("./stack-callgraph");
const dis = process.argv[2];
if (!dis) { console.error("usage : r4-eink27-chains.js <fichier.dis>"); process.exit(2); }
const funcs = parse(fs.readFileSync(dis, "utf8"));
const names = [...funcs.keys()];
const base = (n) => names.find((k) => new RegExp("^" + n + "(\\.[A-Za-z0-9_]+)*$").test(k));
const fn = (n) => base(`_ZL${n.length}${n}v`);
const fr = (n) => (n && funcs.get(n) ? funcs.get(n).frame : 0);
const hal = base("hal_entry"), am = base("_Z12arduino_mainv"), setup = base("setup"), loop = base("loop");
const skipBase = new Set(["_printf_float", "__cvt", "_dtoa_r", ...names.filter((k) => /logfEmit/.test(k))]);
const pairing = names.filter((k) => /displayOnboardingQR|displayKeyMaterialOnce|displayOnboardingOLED/.test(k));
const short = (s) => s.replace(/^_Z[NL]?\d*/, "").slice(0, 24);
const rows = [];
function chain(label, entryName, from, skip) {
  const e = fn(entryName);
  if (!e) return;
  const caller = from === "setup" ? setup : loop;
  const upTo = fr(hal) + fr(am) + fr(caller);
  const d = deepest(funcs, e, skip);
  const total = upTo + d.depth;
  rows.push({ label, from, total, margin: 1024 - total, path: d.path.slice(0, 7).map(short).join(" > ") });
}
const skipNoPair = new Set([...skipBase, ...pairing]);
for (const [label, name, froms] of [["register", "doRegister", ["setup", "loop"]], ["pull + pull-frame + affichage + ACK", "doPull", ["setup", "loop"]], ["validate / vote", "doValidate", ["loop"]], ["obs-confirm", "doObsConfirm", ["loop"]]]) {
  for (const f of froms) {
    chain(`${label} (toutes branches)`, name, f, skipBase);
    if (name === "doRegister" || name === "doValidate") chain(`${label} (hors affichage d'appairage)`, name, f, skipNoPair);
  }
}
console.log("# chaînes STATIQUES sur la pile principale (1 024 o) : hal_entry " + fr(hal) + " + arduino_main " + fr(am) + " + setup " + fr(setup) + " / loop " + fr(loop));
for (const r of rows) console.log(`${r.label.padEnd(58)} depuis ${r.from.padEnd(5)} ${String(r.total).padStart(5)} o  marge ${String(r.margin).padStart(5)} o  ${r.margin < 128 ? "SOUS 128 !" : r.margin < 256 ? "sous 256" : "ok"}  ${r.path}`);
const worst = rows.filter((r) => !/toutes branches\)/.test(r.label) || !/register|validate/.test(r.label)).reduce((a, b) => (a && a.margin < b.margin ? a : b), null);
console.log(`=> pire marge hors branche d'appairage : ${worst ? worst.margin : "?"} o (${worst ? worst.label + " depuis " + worst.from : ""})`);
