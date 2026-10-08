/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/stack-callgraph.js — profondeur de pile STATIQUE (pire chemin du graphe d'appels) d'un firmware ARM Cortex-M à partir de son désassemblage (arm-none-eabi-objdump -d --no-show-raw-insn).
//   node scripts/stack-callgraph.js <désassemblage.dis> <symbole-mangled> [<symbole> …]            →  profondeur maximale + chemin le plus profond pour chaque symbole d'entrée
//   node scripts/stack-callgraph.js <désassemblage.dis> --frames <motif>                          →  cadres de pile des fonctions dont le nom contient <motif>
// Cadre d'une fonction = 4 o × registres empilés (push, LR compris) + 8 o × registres flottants (vpush) + sub sp, #imm du prologue — exactement ce que -fstack-usage rapporte pour les cadres fixes.
// Hypothèses (documentées dans docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md) : appels directs `bl` ; `b.w <fonction>` = appel terminal (le cadre de l'appelant est déjà dépilé) ; appels indirects `blx rN`
// COMPTÉS et signalés (aucun dans le code Ed25519 / SHA-512 / Curve25519 des firmwares R4) ; pas de récursion. C'est une analyse STATIQUE : elle ne mesure pas l'exécution, et ne voit ni les interruptions ni alloca.
const fs = require("fs");

function parse(text) {
  const funcs = new Map();   // nom -> { frame, calls:Set, tails:Set, indirect:n }
  let cur = null, prologue = 0;
  for (const raw of text.split(/\r?\n/)) {
    const head = /^([0-9a-f]+) <([^>+]+)>:$/.exec(raw);
    if (head) { cur = { name: head[2], addr: parseInt(head[1], 16), frame: 0, calls: new Set(), tails: new Set(), indirect: 0 }; funcs.set(cur.name, cur); prologue = 0; continue; }
    if (!cur) continue;
    const m = /^\s+[0-9a-f]+:\s+(\S+)\s*(.*)$/.exec(raw);
    if (!m) continue;
    const op = m[1], args = m[2];
    prologue++;
    if (prologue <= 14) {
      if (op === "push" || op === "push.w" || ((op === "stmdb" || op === "stmdb.w" || op === "stmfd") && /^sp!/.test(args))) { const regs = (/\{([^}]*)\}/.exec(args) || ["", ""])[1].split(",").filter((x) => x.trim()).length; cur.frame += 4 * regs; }
      else if (op === "vpush") { const regs = (/\{([^}]*)\}/.exec(args) || ["", ""])[1].split(",").filter((x) => x.trim()).length; cur.frame += 8 * regs; }
      else if ((op === "sub" || op === "sub.w" || op === "subw") && /^sp,\s*(sp,\s*)?#(\d+)/.test(args)) cur.frame += parseInt(/#(\d+)/.exec(args)[1], 10);
    }
    if (op === "bl" || op === "blx") {
      const t = /<([^>+]+)>/.exec(args);
      if (t) cur.calls.add(t[1]); else cur.indirect++;
    } else if (op === "b.w" || op === "b") {
      const t = /<([^>+]+)>\s*$/.exec(args);   // « <sym> » sans « +0x… » : début d'une autre fonction
      if (t && t[1] !== cur.name) cur.tails.add(t[1]);
    }
  }
  return funcs;
}

function deepest(funcs, entry) {
  const memo = new Map();
  const visiting = new Set();
  const go = (name) => {
    if (memo.has(name)) return memo.get(name);
    const f = funcs.get(name);
    if (!f) return { depth: 0, path: [`${name}?`] };   // fonction externe / ROM : cadre inconnu = 0
    if (visiting.has(name)) return { depth: 0, path: [`${name}(récursion)`] };
    visiting.add(name);
    let best = { depth: 0, path: [] };
    for (const c of f.calls) { const r = go(c); if (r.depth > best.depth) best = r; }
    let bestT = { depth: 0, path: [] };
    for (const c of f.tails) { const r = go(c); if (r.depth > bestT.depth) bestT = r; }
    visiting.delete(name);
    const viaCall = f.frame + best.depth, viaTail = bestT.depth;   // appel terminal : le cadre de l'appelant n'existe plus
    const res = viaCall >= viaTail ? { depth: viaCall, path: [`${name}(${f.frame})`, ...best.path], indirect: f.indirect } : { depth: viaTail, path: [`${name}(tail)`, ...bestT.path], indirect: f.indirect };
    memo.set(name, res);
    return res;
  };
  return go(entry);
}

function countIndirect(funcs, entry) {
  const seen = new Set(); let n = 0;
  const walk = (name) => { if (seen.has(name)) return; seen.add(name); const f = funcs.get(name); if (!f) return; n += f.indirect; f.calls.forEach(walk); f.tails.forEach(walk); };
  walk(entry); return n;
}

module.exports = { parse, deepest, countIndirect };

if (require.main === module) {
  const [dis, ...rest] = process.argv.slice(2);
  if (!dis || !rest.length) { console.error("usage : stack-callgraph.js <fichier.dis> <symbole…> | --frames <motif>"); process.exit(2); }
  const funcs = parse(fs.readFileSync(dis, "utf8"));
  if (rest[0] === "--frames") {
    for (const f of [...funcs.values()].filter((x) => x.name.includes(rest[1])).sort((a, b) => b.frame - a.frame)) console.log(`${f.frame}\t${f.name}`);
  } else {
    for (const sym of rest) {
      if (!funcs.has(sym)) { console.log(`${sym} : introuvable`); continue; }
      const r = deepest(funcs, sym);
      console.log(`${sym}\tprofondeur ${r.depth} o\tappels indirects atteignables : ${countIndirect(funcs, sym)}\n  ${r.path.join(" > ")}`);
    }
  }
}
