/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/tft28-inventory.js — LOT8B2D : INVENTAIRE FORMEL du firmware UNO R4 + TFT 2,8″ (arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino) : appels au module Wi-Fi (WiFi.*), sites réseau (Conn), décodages JSON, appels Ed25519,
// accès à la carte SD, lanceurs de piles dédiées et routes serveur — pour la PRODUCTION (POD_CANARY = 0) et le CANARI (POD_CANARY = 1).
//   node scripts/tft28-inventory.js [--json]
// Texte seulement (aucun binaire) : le binaire est contrôlé à part (routes et symboles de vote ABSENTS de l'ELF du canari : docs/mesures/8B2D_2026_10_12/).
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "arduino_uno_r4", "pod_uno_r4", "pod_uno_r4.ino"), "utf8").replace(/\r\n/g, "\n");

function effective(src, canary) {   // même évaluation que tests/helpers/tft28Source.ts
  const out = [], stack = [];
  const keep = () => stack.every((s) => !s.ours || s.active);
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (/^#if\s+POD_CANARY\s*$/.test(t)) { stack.push({ ours: true, active: canary }); continue; }
    if (/^#if\s+!POD_CANARY\s*$/.test(t)) { stack.push({ ours: true, active: !canary }); continue; }
    if (/^#(if|ifdef|ifndef)\b/.test(t)) { stack.push({ ours: false, active: true }); if (keep()) out.push(line); continue; }
    const top = stack[stack.length - 1];
    if (/^#else\b/.test(t)) { if (top && top.ours) { top.active = !top.active; continue; } if (keep()) out.push(line); continue; }
    if (/^#endif\b/.test(t)) { const s = stack.pop(); if (s && !s.ours && keep()) out.push(line); continue; }
    if (keep()) out.push(line);
  }
  return out.join("\n");
}
const stripComments = (s) => s.replace(/("(?:[^"\\\n]|\\.)*")|\/\/.*$/gm, (_m, str) => str || "");
function enclosing(lines, idx, noLambda) {
  for (let i = idx; i >= 0; i--) {
    const l = lines[i].replace(/__attribute__\(\([^)]*\)\)\s*/g, "");
    const m = /^(?:template\s*<[^>]*>\s*)?(?:static\s+)?(?:inline\s+)?[A-Za-z_][\w:<>,\s*&]*?\b([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{\s*$/.exec(l);
    if (m && !/^(if|for|while|switch|else)$/.test(m[1])) return m[1];
    if (!noLambda && /^\s+auto (tx|wx|rk|wk|vk|bk|w|store|sizeOf|readClip) = \[/.test(lines[i])) { const lm = /auto (\w+) =/.exec(lines[i]); const outer = enclosing(lines, i - 1, true); return `${outer}/λ${lm[1]}`; }
  }
  return "?";
}
function sites(src, re) {
  const lines = stripComments(src).split("\n"), res = [];
  lines.forEach((l, i) => { if (/^\s*#define\b/.test(l)) return; for (const m of l.matchAll(re)) res.push({ fn: enclosing(lines, i), what: m[0].replace(/\($/, "") }); });
  return res;
}
const group = (a) => { const m = new Map(); for (const s of a) { const k = `${s.fn} → ${s.what}`; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`); };

const report = {};
for (const [name, canary] of [["production", false], ["canari", true]]) {
  const src = effective(raw, canary);
  report[name] = {
    wifi: group(sites(src, /\bWiFi\.[A-Za-z]+\(/g)),
    conn: group(sites(src, /\bConn c\(/g)),
    json: group(sites(src, /\bdeserializeJson\(/g)),
    ed25519: group(sites(src, /\b(?:Ed25519|PodEd)::[A-Za-z]+\(/g)),
    sd: group(sites(src, /\bSD\.(?:begin|open|exists|remove|mkdir)\(/g)),
    launchers: group(sites(src, /\b(?:podNetRun|podWifiRun|podWorkRun|onSd|PodNet::runSized)\(/g)),
    routes: [...new Set([...stripComments(src).matchAll(/"(\/api\/[a-z\-/?]+)/g)].map((m) => m[1]))].sort(),
  };
}
if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }
for (const [name, r] of Object.entries(report)) {
  console.log(`\n## ${name === "production" ? "PRODUCTION (POD_CANARY = 0)" : "CANARI (POD_CANARY = 1)"}\n`);
  for (const [k, title] of [["wifi", "WiFi.* (module Wi-Fi : doit être sur pile dédiée podWifiRun)"], ["conn", "Conn (transaction TLS : doit être dans un « auto tx » de podNetRun)"], ["json", "deserializeJson (doit être sur la pile de travail podWorkRun)"],
    ["ed25519", "Ed25519 / PodEd (doit passer par PodEd, pile dédiée)"], ["sd", "SD.* (carte : pile réseau dédiée dans streamFrame, sinon onSd)"], ["launchers", "lanceurs de piles dédiées"], ["routes", "routes serveur atteignables"]]) {
    console.log(`### ${title}\n`); for (const x of r[k]) console.log(`- ${x}`); console.log("");
  }
}
