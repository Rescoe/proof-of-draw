import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { BOUNDED_SSL_EDITS } from "./helpers/boundedSslEdits";

// PULLFRAME-BOUNDED-SSL-FIX1 — la commande AT _SSLCLIENTRECEIVE réellement émise par le VRAI cœur Renesas (1.5.3 et 1.6.0) est bornée à 240 octets.
// Le harnais hôte (consensus-pod/host/wifis3/bounded_ssl_harness.cpp) compile les VRAIS WiFiSSLClient.cpp / WiFiClient.cpp / Modem.cpp (téléchargés par scripts/fetch-wifis3-sources.js, SHA-256 vérifiés,
// jamais commités) contre un module AT simulé, avec le VRAI pod_ssl_bounded.h et pod_http.h. Aucun fichier du cœur n'est modifié.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const SK = "arduino_uno_r4/pod_uno_r4_eink29";
const HDR = `${SK}/pod_ssl_bounded.h`;
const CACHE = path.join(root, "consensus-pod/host/wifis3/.cache");
const stripLine = (s: string) => s.replace(/\/\/.*$/gm, "");

test("sketch : les quatre fragments exacts, drapeaux 0/0, aucun new_handler ni operator new, pas de propagation aux autres firmwares", () => {
  const ino = read(`${SK}/pod_uno_r4_eink29.ino`);
  for (const e of BOUNDED_SSL_EDITS) assert.equal(ino.split(e.neu).length - 1, 1, `fragment « ${e.id} » exactement une fois`);
  assert.match(ino, /#ifndef POD_RENDER_V1\n#define POD_RENDER_V1 0\n#endif/);
  assert.match(ino, /#ifndef POD_CANARY\n#define POD_CANARY 0 /);
  const code = stripLine(ino + "\n" + read(HDR));
  assert.doesNotMatch(code, /set_new_handler|operator\s+new|operator\s+delete/);
  // le nom redirigé vers PodBoundedSSL arrive AVANT la définition du canari, et Conn utilise ce nom
  assert.ok(ino.indexOf("#define WiFiSSLClient PodBoundedSSL") < ino.indexOf("struct Conn {"));
  assert.match(ino, /struct Conn \{\n  WiFiSSLClient client;\n  podhttp::Reader<WiFiSSLClient> rd;/);
  // ni les autres firmwares R4/ESP8266, ni de copie du client borné ailleurs
  for (const other of ["pod_uno_r4_tft18", "pod_uno_r4", "pod_uno_r4_tft28"]) {
    const d = path.join(root, "arduino_uno_r4", other);
    if (!fs.existsSync(d)) continue;
    assert.ok(!fs.existsSync(path.join(d, "pod_ssl_bounded.h")), `${other} : pas de copie`);
    for (const f of fs.readdirSync(d)) if (/\.(ino|h)$/.test(f)) assert.doesNotMatch(fs.readFileSync(path.join(d, f), "utf8"), /PodBoundedSSL|pod_ssl_bounded/, `${other}/${f}`);
  }
});

test("en-tête : plafond 240, réservation unique, défaut collant, échec fermé", () => {
  const h = read(HDR), code = stripLine(h);
  assert.match(code, /static constexpr uint32_t kRxCap = 240;/);
  assert.match(code, /if \(size > kRxCap\) size = kRxCap;/);
  assert.match(code, /res\.reserve\(kRxCap \+ 16\);/);
  assert.match(code, /if \(res\.size\(\) > size\) \{ fault_ = FAULT_OVERLONG; return 0; \}/);
  assert.match(code, /uint8_t connected\(\) override \{ return fault_ \? 0 : WiFiSSLClient::connected\(\); \}/);
  assert.doesNotMatch(code, /\bstatic\s+(?!constexpr)[A-Za-z_:<>]+\s+\w+\s*[=;\[]/, "aucun tampon ni variable statique");
});

function prepare(version: string): { dir: string; src: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wifis3-"));
  const src = path.join(dir, "libraries/WiFiS3/src");
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(path.join(dir, "extras/uno-r4-wifi-usb-bridge/UNOR4USBBridge"), { recursive: true });
  for (const f of fs.readdirSync(path.join(CACHE, version))) fs.copyFileSync(path.join(CACHE, version, f), path.join(src, f));
  fs.copyFileSync(path.join(CACHE, "bridge_commands.h"), path.join(dir, "extras/uno-r4-wifi-usb-bridge/UNOR4USBBridge/commands.h"));
  fs.writeFileSync(path.join(src, "WiFiCommands.h"), '#include "../../../extras/uno-r4-wifi-usb-bridge/UNOR4USBBridge/commands.h"\n');   // le fichier du cœur est un lien symbolique git
  return { dir, src };
}
function build(version: string, cxx: string, headerDir?: string): { exe: string; log: string } {
  const { dir, src } = prepare(version);
  const exe = path.join(dir, "h");
  const inc = [`-I${path.join(root, "consensus-pod/host/wifis3/shim")}`, `-I${src}`, ...(headerDir ? [`-I${headerDir}`] : []), `-I${path.join(root, SK)}`];
  const r = runProcess(cxx, ["-std=c++17", "-O1", "-fexceptions", "-Wno-overloaded-virtual", ...inc, "-o", exe,
    path.join(root, "consensus-pod/host/wifis3/bounded_ssl_harness.cpp"), path.join(src, "WiFiSSLClient.cpp"), path.join(src, "WiFiClient.cpp"), path.join(src, "Modem.cpp")], 120000);
  return { exe: r.status === 0 ? exe : "", log: `${r.stdout}\n${r.stderr}`.slice(-1500) };
}

const cc = findCompiler();
function haveSources(): boolean {
  if (fs.existsSync(path.join(CACHE, "1.6.0", "Modem.cpp")) && fs.existsSync(path.join(CACHE, "1.5.3", "Modem.cpp")) && fs.existsSync(path.join(CACHE, "bridge_commands.h"))) return true;
  try { execFileSync("node", [path.join(root, "scripts/fetch-wifis3-sources.js")], { stdio: "ignore", timeout: 120000 }); return true; } catch { return false; }
}
const skipWhy = !cc.path ? describeChoice(cc) : !haveSources() ? "sources WiFiS3 absentes (node scripts/fetch-wifis3-sources.js : réseau requis)" : "";

for (const version of ["1.5.3", "1.6.0"]) {
  test(`cœur Renesas ${version} (VRAI code) : ancien chemin → abort sous bloc contigu 1888 o ; nouveau chemin → AT bornée à 240, octets exacts, échec fermé`, { skip: skipWhy || false }, () => {
    const b = build(version, cc.path as string);
    assert.ok(b.exe, `compilation du harnais impossible\n${b.log}`);
    const r = runProcess(b.exe, [], 120000);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /SUCCES : \d+ controles, 0 echec/);
    assert.match(r.stdout, /OK   A reponse 1023 o : HeapAbort .* 1921 o > bloc contigu 1888 o/);
    assert.match(r.stdout, /AT _SSLCLIENTRECEIVE max demandee = 240/);
    assert.match(r.stdout, /OK   C : frame 9472 o/);
  });
}

const MUTANTS: [string, string, string][] = [
  ["plafond relevé à 1023", "kRxCap = 240;", "kRxCap = 1023;"],
  ["plafond non appliqué", "if (size > kRxCap) size = kRxCap;", ""],
  ["pas de réservation (la chaîne regrandit)", "res.reserve(kRxCap + 16);", ""],
  ["réponse trop longue acceptée", "if (res.size() > size) { fault_ = FAULT_OVERLONG; return 0; }", ""],
  ["read() ne signale pas le défaut", "    if (fault_) return -1;\n    int got = 0;", "    int got = 0;"],
  ["connected() ignore le défaut", "return fault_ ? 0 : WiFiSSLClient::connected();", "return WiFiSSLClient::connected();"],
];
for (const [name, from, to] of MUTANTS) {
  test(`CONTRÔLE NÉGATIF : « ${name} » est REFUSÉ par le harnais (cœur 1.6.0)`, { skip: skipWhy || false }, () => {
    const h = read(HDR);
    assert.equal(h.split(from).length - 1, 1, `fragment unique : ${from}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bsmut-"));
    fs.writeFileSync(path.join(tmp, "pod_ssl_bounded.h"), h.replace(from, to));
    const b = build("1.6.0", cc.path as string, tmp);
    assert.ok(b.exe, `le mutant doit compiler\n${b.log}`);
    const r = runProcess(b.exe, [], 120000);
    assert.notEqual(r.status, 0, `le mutant « ${name} » aurait dû être refusé\n${r.stdout.slice(-800)}`);
  });
}
