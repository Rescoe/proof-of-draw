/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/tft28-stack-report.js — LOT8B2D : pile PRINCIPALE (1 024 o) du firmware UNO R4 + TFT 2,8″, ANALYSE STATIQUE par chaînes d'appels : hal_entry → arduino_main → setup | loop → <étape> → …
//   arm-none-eabi-objdump -d --no-show-raw-insn <elf> > f.dis ; node scripts/tft28-stack-report.js f.dis
// Pour chaque étape : cadre propre, pire chaîne en dessous (appels DIRECTS ; les lambdas passées à podNetRun / podWifiRun / podWorkRun / PodEd / logf s'exécutent sur leur pile dédiée et ne sont pas suivies),
// cumul depuis hal_entry et marge restante sur 1 024 o. ⚠ statique : ni interruptions, ni appels indirects, ni alloca ; la branche flottante de printf (jamais exécutée) est exclue. Ne remplace pas la mesure du canari.
const fs = require("fs");
const { parse, countIndirect } = require("./stack-callgraph");
const dis = process.argv[2];
if (!dis) { console.error("usage : tft28-stack-report.js <fichier.dis>"); process.exit(2); }
const funcs = parse(fs.readFileSync(dis, "utf8"));
const names = [...funcs.keys()];
const find = (n) => names.find((k) => k === n || k.startsWith("_ZL" + n.length + n) || k.startsWith("_Z" + n.length + n));   // le préfixe de longueur du nom manglé distingue doValidate de doValidateDecode
// BARRIÈRES : les enveloppes qui déplacent SP vers une pile dédiée (onSd, PodNet::runSized, podNetRun, podWifiRun, podWorkRun) ne sont comptées que pour leur propre cadre : la lambda qu'elles exécutent vit sur l'autre pile.
// (onSd contient aussi un appel DIRECT à la lambda pour le cas « déjà sur une pile dédiée » : sans barrière, l'analyse statique suivrait à tort cette branche depuis la pile principale.)
const BARRIER = /onSdDirect|runSized|podNetRun|podWifiRun|podWorkRun|PodEd|PodNet/;
function deepest(fs_, entry, skipSet) {
  const memo = new Map(), visiting = new Set();
  const go = (name) => {
    if (memo.has(name)) return memo.get(name);
    if (skipSet && skipSet.has(name)) return { depth: 0, path: [`${name}(ignorée)`] };
    const f = fs_.get(name);
    if (!f) return { depth: 0, path: [`${name}?`] };
    if (BARRIER.test(name)) { const r = { depth: f.frame, path: [`${name}(${f.frame}, barrière : lambda sur pile dédiée)`] }; memo.set(name, r); return r; }
    if (visiting.has(name)) return { depth: 0, path: [`${name}(récursion)`] };
    visiting.add(name);
    let best = { depth: 0, path: [] };
    for (const c of f.calls) { const r = go(c); if (r.depth > best.depth) best = r; }
    let bestT = { depth: 0, path: [] };
    for (const c of f.tails) { const r = go(c); if (r.depth > bestT.depth) bestT = r; }
    visiting.delete(name);
    const viaCall = f.frame + best.depth, viaTail = bestT.depth;
    const res = viaCall >= viaTail ? { depth: viaCall, path: [`${name}(${f.frame})`, ...best.path] } : { depth: viaTail, path: [`${name}(tail)`, ...bestT.path] };
    memo.set(name, res);
    return res;
  };
  return go(entry);
}
const skip = new Set(["_printf_float", "__cvt", "_dtoa_r", ...names.filter((k) => /logfEmit/.test(k))]);
const fr = (n) => (n && funcs.get(n) ? funcs.get(n).frame : 0);
const hal = "hal_entry", am = names.find((k) => /^_Z12arduino_mainv$/.test(k));
const steps = ["doRegister", "doRegisterDecode", "doPull", "doPullStage", "doFetchFrame", "ackFrame", "httpCall", "doValidate", "doValidateV2", "votePhaseRead", "votePhaseSign", "votePhasePost", "voteFinish", "netReadCandidate", "doValidateDecode", "doObsConfirm", "benchPollOnce",
  "toggleCartel", "serviceTouch", "drawCartel", "restoreRows", "restoreLastFrame", "runResidentAnim", "fetchAnimToSd", "playBenchClip", "selfTestEd25519", "generateKeys", "displayKeyMaterialOnce", "displayOnboardingTFT", "macString", "initSD"];
console.log(`# frames : hal_entry ${fr(hal)} + arduino_main ${fr(am)} ; setup ${fr("setup")} ; loop ${fr("loop")}`);
console.log("| étape | cadre | pire chaîne sous l'étape | cumul depuis setup | marge (setup) | cumul depuis loop | marge (loop) | indirects |\n|---|---|---|---|---|---|---|---|");
for (const st of steps) {
  const n = find(st);
  if (!n) { console.log(`| ${st} | (absente du binaire) | | | | | | |`); continue; }
  const d = deepest(funcs, n, skip);
  const base = fr(hal) + fr(am);
  const cs = base + fr("setup") + d.depth, cl = base + fr("loop") + d.depth;
  console.log(`| ${st} | ${fr(n)} | ${d.depth} | ${cs} | ${1024 - cs} | ${cl} | ${1024 - cl} | ${countIndirect(funcs, n)} |`);
}
if (process.argv[3]) {   // détail : node scripts/tft28-stack-report.js f.dis <étape> → chaîne la plus profonde
  const n = find(process.argv[3]);
  if (n) { const d = deepest(funcs, n, skip); console.log(`\n# chaîne la plus profonde sous ${process.argv[3]} (${d.depth} o) :\n  ${d.path.join("\n  > ")}`); }
}
