/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/net-stack-report.js — profondeur de pile STATIQUE des transactions réseau (NETSTACK-FIX1) d'un firmware UNO R4, à partir de son désassemblage (arm-none-eabi-objdump -d --no-show-raw-insn <elf>).
//   node scripts/net-stack-report.js <désassemblage.dis> [taille_de_pile_dédiée=1984]
// Pour chaque lambda lancée par podNetRun (« _FUN ») : cadre propre, profondeur pire cas AVEC la branche flottante de printf, profondeur SANS elle (la mesure du 09/10/2026 — 1480 o au retour de connect() — correspond
// au chemin SANS flottant : aucun format %f/%e/%g n'est utilisé), puis la marge statique restante dans la pile dédiée une fois ajouté un cadre matériel d'exception (104 o, contexte FPU paresseux).
// Limite : analyse statique (cadres fixes, pas d'alloca, appels indirects non suivis, interruptions hors modèle) ; elle ne remplace pas la mesure sur la carte.
const fs = require("fs");
const { parse, deepest } = require("./stack-callgraph");
const funcs = parse(fs.readFileSync(process.argv[2], "utf8"));
const STACK = Number(process.argv[3] || 1984), HW = 104;
const skipFloat = new Set(["_printf_float", "_scanf_float", "__cvt", "_dtoa_r"]);
const rows = [];
for (const name of [...funcs.keys()].filter((k) => /^_ZZ9podNetRun/.test(k) && /FUN/.test(k))) {
  const withF = deepest(funcs, name), noF = deepest(funcs, name, skipFloat);
  const site = (/podNetRunIZL?\d*([A-Za-z0-9]+?)(?:PK|RK|EU|E)/.exec(name) || ["", "?"])[1];
  rows.push({ site, frame: funcs.get(name).frame, withF: withF.depth, noF: noF.depth, spareWorst: STACK - (withF.depth + HW), spareReal: STACK - (noF.depth + HW) });
}
rows.sort((a, b) => b.withF - a.withF);
console.log(`# Profondeur statique des transactions réseau (octets) — pile dédiée de ${STACK} o utilisables, cadre matériel d'exception ${HW} o`);
console.log("# site (lambda)".padEnd(28), "cadre", "pire cas (avec %f)", "sans %f", "reste (pire cas)", "reste (sans %f)");
for (const r of rows) console.log(r.site.padEnd(28), String(r.frame).padStart(5), String(r.withF).padStart(18), String(r.noF).padStart(7), String(r.spareWorst).padStart(16), String(r.spareReal).padStart(15));
