// usage: node mainreach.js <worktree> <file.dis> : fonctions ATTEIGNABLES sur la pile PRINCIPALE (appels directs depuis hal_entry, sans traverser une barrière de pile dédiée), classées par famille
const path = require("path");
const fs = require("fs");
const { parse } = require(path.join(process.argv[2], "scripts", "stack-callgraph.js"));
const f = parse(fs.readFileSync(process.argv[3], "utf8"));
const BAR = /onSdDirect|runSized|podNetRun|podWifiRun|podWorkRun|PodEd|PodNet|netHttpRaw|logfEmit|podedimpl|podNetCallOnStack/;
const fam = [
  ["JSON (ArduinoJson)", /ArduinoJson|deserializeJson|JsonDocument|MemoryPool/],
  ["Wi-Fi (module)", /ModemClass|WiFiClass|WiFi(Client)?[0-9A-Z]|WiFiS3|ArduinoModem/],
  ["TLS / client", /WiFiSSLClient|PodBoundedSSL|WiFiClient|podhttp|Conn/],
  ["Ed25519 / SHA", /Ed25519|Curve25519|SHA256|SHA512|BigNumberUtil/],
  ["SD", /SDLib|SdFile|SdVolume|Sd2Card|SD[A-Z]/],
  ["TFT / GFX", /Adafruit_ILI9341|Adafruit_SPITFT|Adafruit_GFX|STMPE610|drawCartel|tftStatus|pushRow|fastPixels|FastTft/],
  ["journal (vsniprintf)", /vsniprintf|vsnprintf|svfiprintf|sniprintf|printf/],
  ["String / tas", /arduino6String|_malloc_r|_realloc_r|operator new/],
];
const seen = new Set(); const q = ["hal_entry"]; const owner = new Map();
while (q.length) {
  const n = q.shift(); if (seen.has(n)) continue; seen.add(n);
  const x = f.get(n); if (!x) continue;
  for (const c of [...x.calls, ...x.tails]) { if (BAR.test(c)) continue; if (!owner.has(c)) owner.set(c, n); q.push(c); }
}
const out = {};
for (const n of seen) { for (const [name, re] of fam) if (re.test(n)) (out[name] = out[name] || []).push(n); }
for (const [name] of fam) {
  const l = out[name] || [];
  // appelants directs depuis le code du sketch (fonctions _ZL… ou setup/loop)
  const callers = new Set();
  for (const n of l) { const o = owner.get(n); if (o && /^_ZL|^setup|^loop|^_Z4loop|^_Z5setup|^_ZZL/.test(o) && !fam.some(([, re]) => re.test(o))) callers.add(o.replace(/^_ZL\d*/, "").slice(0, 40)); }
  console.log(`## ${name} : ${l.length} fonctions atteignables sur la pile principale ; entrées depuis le sketch : ${[...callers].slice(0, 25).join(", ") || "-"}`);
}
let ind = 0; for (const n of seen) ind += f.get(n) ? f.get(n).indirect : 0;
console.log(`total fonctions atteignables : ${seen.size} ; appels indirects dans ces fonctions : ${ind}`);
