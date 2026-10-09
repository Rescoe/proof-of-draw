/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/wifi-stack-report.js — NETSTACK-WIFI-CALLS-FIX1 : (1) profondeur statique de chaque appel au module Wi-Fi exécuté sur la pile dédiée (invocateur de podWifiRun → CWifi::…) et taille minimale
// requise comparée à POD_WIFI_STACK_TOTAL ; (2) AUDIT des appelants : aucune fonction autre que ces invocateurs n'appelle directement une méthode de CWifi (hors constructeur/destructeur statiques).
//   node scripts/wifi-stack-report.js <désassemblage.dis> [taille-totale=1536]
// Hypothèses : analyse STATIQUE (appels directs `bl` et `b.w`, cadres fixes) ; la branche flottante de printf (_printf_float, __cvt, _dtoa_r), jamais exécutée (aucun %f), est exclue ; les appels indirects ne sont pas suivis.
// Exigence : garde 64 o + profondeur + 32 o (réserve invocateur/lambda non comptés) + cadre d'exception 104 o + objectif de marge 256 o <= taille totale.
const fs = require("fs");
const { parse, deepest, countIndirect } = require("./stack-callgraph");
const dis = process.argv[2];
const total = parseInt(process.argv[3] || "1536", 10);
if (!dis) { console.error("usage : wifi-stack-report.js <fichier.dis> [taille-totale]"); process.exit(2); }
const funcs = parse(fs.readFileSync(dis, "utf8"));
const skipFloat = new Set(["_printf_float", "__cvt", "_dtoa_r"]);
const short = (s) => s.replace(/^_Z[NL]?\d*/, "").slice(0, 22);
const out = [];
const invokers = [...funcs.keys()].filter((k) => /^_ZZ10podWifiRun/.test(k));
const label = (k) => { const m = /podWifiRunIZL\d*([A-Za-z]+?)(?:P|R|v|E)/.exec(k); return m ? m[1] : k.slice(0, 40); };
out.push(`# 1. Appels au module Wi-Fi sur la pile dédiée (${invokers.length} invocateurs trouvés) — taille totale ${total} o, garde 64 o`);
let worst = 0;
const rows = invokers.map((k) => { const d = deepest(funcs, k, skipFloat); return { k, depth: d.depth, indirect: countIndirect(funcs, k), path: d.path.map(short).join(" > ") }; }).sort((a, b) => b.depth - a.depth);
for (const r of rows) { worst = Math.max(worst, r.depth); out.push(`  ${label(r.k).padEnd(16)} profondeur ${String(r.depth).padStart(4)} o   appels indirects atteignables ${r.indirect}   ${r.path.slice(0, 120)}`); }
const required = 64 + worst + 32 + 104 + 256;
out.push(`=> pire cas statique ${worst} o ; exigé = 64 (garde) + ${worst} + 32 (réserve) + 104 (cadre d'exception) + 256 (objectif de marge) = ${required} o ; taille ${total} o → ${total >= required ? "SUFFISANTE" : "INSUFFISANTE"} (réserve ${total - required} o)`);
// 2. audit des appelants
out.push("\n# 2. Audit : qui appelle directement le module Wi-Fi (méthodes de CWifi) ?");
const isCwifiMethod = (n) => /^_ZN5CWifi/.test(n) && !/^_ZN5CWifi(C[12]|D[12])/.test(n);
const callers = [];
for (const f of funcs.values()) {
  if (/^_ZN5CWifi/.test(f.name)) continue;
  const hit = [...f.calls, ...f.tails].filter(isCwifiMethod);
  if (hit.length) callers.push({ name: f.name, hit: hit.map((h) => h.replace(/^_ZN5CWifi\d*/, "").slice(0, 20)) });
}
let bad = 0;
for (const c of callers) { const ok = /^_ZZ10podWifiRun/.test(c.name); if (!ok) bad++; out.push(`  ${ok ? "OK " : "⚠ "} ${short(c.name).padEnd(30)} → ${c.hit.join(", ")}${ok ? "" : "   ⚠ appel direct HORS pile dédiée"}`); }
out.push(`=> ${callers.length} appelants du module, dont ${bad} hors invocateur de podWifiRun ${bad === 0 ? "(AUCUN : tout appel direct passe par la pile dédiée)" : "⚠"}`);
// l'appel des méthodes de CWifi par des fonctions de la bibliothèque (ex. WiFiClient) reste dans la transaction PodNet ou la pile du module
console.log(out.join("\n"));
process.exit(bad === 0 && total >= required ? 0 : 1);
