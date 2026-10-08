/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/ed25519-stack-report.js — profondeur de pile STATIQUE de chaque usage d'Ed25519 dans un firmware UNO R4, à partir de son désassemblage (arm-none-eabi-objdump -d --no-show-raw-insn <elf>).
//   node scripts/ed25519-stack-report.js <désassemblage.dis>
// Pour chaque chemin d'appel (démarrage, vote, génération de clé) : somme des cadres depuis hal_entry jusqu'au pire cadre d'Ed25519, à comparer aux 1 024 o de la pile principale du cœur UNO R4.
// Les appels indirects (pointeur de fonction : ici le trampoline de podEdStack.h) ne sont PAS suivis : la profondeur de la pile dédiée est donnée à part (podedimpl::run).
// Limite : analyse statique (cadres fixes, pas d'alloca, pas d'interruptions) ; elle ne remplace pas la mesure sur la carte (micro-canari).
const fs = require("fs");
const { parse, deepest } = require("./stack-callgraph");
const funcs = parse(fs.readFileSync(process.argv[2], "utf8"));
const MAIN_STACK = 1024;
const callersOf = (t) => [...funcs.values()].filter((f) => f.calls.has(t) || f.tails.has(t)).map((f) => f.name);
const find = (re) => [...funcs.keys()].filter((k) => re.test(k));
const frame = (n) => (funcs.get(n) ? funcs.get(n).frame : 0);
const lines = [];
const row = (label, depth, extra = "") => lines.push(`${label.padEnd(58)} ${String(depth).padStart(5)} o  ${depth > MAIN_STACK ? `DÉPASSE de ${depth - MAIN_STACK} o` : `marge ${MAIN_STACK - depth} o`}${extra ? "  " + extra : ""}`);
lines.push(`# Profondeur de pile STATIQUE (octets) — pile principale du cœur UNO R4 = ${MAIN_STACK} o (BSP_CFG_STACK_MAIN_BYTES = 0x400)`);
const isPre = find(/^_ZN7Ed255194sign/).length > 0 && !find(/podedimpl/).length;
const ent = { derive: "_ZN7Ed2551915derivePublicKeyEPhPKh", sign: "_ZN7Ed255194signEPhPKhS2_PKvj", verify: "_ZN7Ed255196verifyEPKhS1_PKvj" };
for (const [k, s] of Object.entries(ent)) if (funcs.has(s)) { const d = deepest(funcs, s); lines.push(`Ed25519::${k.padEnd(20)} (bibliothèque seule, depuis son entrée) ${String(d.depth).padStart(5)} o   ${d.path.join(" > ").replace(/_ZN\d+/g, "").slice(0, 200)}`); }
const runName = find(/^_ZN9podedimpl.*3run/)[0];
if (runName) { const d = deepest(funcs, runName); lines.push(`PILE DÉDIÉE : podedimpl::run (appelée par le trampoline)        ${String(d.depth).padStart(5)} o   ${d.path.join(" > ").replace(/_ZN\d+/g, "").slice(0, 200)}`); }
// chaînes depuis hal_entry : on cherche les fonctions qui appellent directement Ed25519 (ou PodEd), et on remonte jusqu'à hal_entry
const target = isPre ? Object.values(ent) : find(/^_ZN9podedimplL7execute/);
const up = (name, seen = new Set()) => {   // plus longue chaîne d'appelants jusqu'à hal_entry (cadres cumulés)
  if (name === "hal_entry" || seen.has(name)) return { sum: frame(name), path: [name] };
  seen.add(name);
  let best = null;
  for (const c of callersOf(name)) { const r = up(c, new Set(seen)); if (!best || r.sum > best.sum) best = r; }
  return best ? { sum: best.sum + frame(name), path: [...best.path, name] } : { sum: frame(name), path: [name] };
};
const seenCallers = new Set();
for (const t of target) for (const c of callersOf(t)) {
  if (seenCallers.has(c + "|" + t)) continue; seenCallers.add(c + "|" + t);
  const chain = up(c);   // cadres de hal_entry … c
  const tail = isPre ? deepest(funcs, t).depth : 0;   // avant : on ajoute la profondeur d'Ed25519 ; après : le wrapper (execute) et le trampoline
  const wrapper = isPre ? 0 : deepest(funcs, t).depth + 12;
  const total = chain.sum + tail + wrapper;
  row(`${chain.path.map((n) => n.replace(/^_ZL\d+/, "").replace(/^_Z\d+/, "")).join(" > ")} > ${isPre ? t.replace(/_ZN\d+/g, "").slice(0, 30) : "PodEd (execute+malloc+trampoline)"}`, total);
}
console.log(lines.join("\n"));
