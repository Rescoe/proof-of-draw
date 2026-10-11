import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { propBackup, PROP_SKETCHES } from "./helpers/propagation8b2b3Edits";

// LOT8B2B3-R4-EINK27-PROPAGATION-1 — les mécanismes validés sur carte pour l'UNO R4 e-ink 2,9″ (client TLS borné, décodage JSON register/pull/validate sur pile de travail) sont propagés,
// à l'identique, à l'UNO R4 e-ink 2,7″ (solo) et à l'UNO R4 e-ink 2,7″ + OLED. Ce test prouve : (1) le delta est EXACTEMENT les régions prévues, le reste est la sauvegarde au texte près ;
// (2) les blocs sont ceux du 2,9″ (solo : identiques ; OLED : identiques + le seul champ « screen ») ; (3) le chemin OLED n'a pas bougé ; (4) l'exécution hôte du champ « screen ».
// Compilation ARM, mesures de pile et canaris matériels : NON faits ici (docs/LOT_8B2B3_R4_EINK27_PROPAGATION_2026_10_12.md).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const ino = (sk: string) => read(`arduino_uno_r4/${sk}/${sk}.ino`);
const E29 = "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino";
const noCanary = (s: string) => s.replace(/#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g, "");
const stripLine = (s: string) => s.replace(/("(?:[^"\\\n]|\\.)*")|\/\/.*$/gm, (_m, str?: string) => str ?? "");

/** [début, fin[ : du marqueur de début au marqueur de fin (non compris). */
function span(s: string, a: string, b: string): [number, number] {
  const i = s.indexOf(a), j = s.indexOf(b, i + a.length);
  assert.ok(i >= 0 && j > i, `région introuvable : ${a} … ${b}`);
  return [i, j];
}
const cut = (s: string, a: string, b: string) => { const [i, j] = span(s, a, b); return s.slice(0, i) + s.slice(j); };
const take = (s: string, a: string, b: string) => { const [i, j] = span(s, a, b); return s.slice(i, j); };
/** Fonction « static … name( » jusqu'à la première ligne « } » seule. */
function fnText(s: string, name: string): string {
  const m = new RegExp(`^static [^\\n]*\\b${name}\\(`, "m").exec(s);
  assert.ok(m, `fonction ${name} introuvable`);
  const end = s.indexOf("\n}\n", m.index);
  assert.ok(end > 0);
  return s.slice(m.index, end + 3);
}

const MARK_INC = '#include "pod_ssl_bounded.h"';
const OLD_FAULT = "      got = (b == BUF_SIZE && c.rd.complete());\n";
const NEW_FAULT = "      got = (b == BUF_SIZE && c.rd.complete() && c.client.fault() == 0);   // défaut collant du client TLS borné : frame refusée (ni affichage, ni ACK)\n";
const OLD_REG = `  JSON_DOC(doc, 768);
  if (deserializeJson(doc, resp)) { logf("[REGISTER] JSON illisible"); return false; }
  deviceId   = doc["deviceId"].as<String>();
  pairCode   = doc["pairCode"].as<String>();
  paired     = doc["paired"] | false;
  registered = true;
`;
const NEW_REG = "  if (!doRegisterDecode(resp)) return false;\n";

/** Le sketch d'après le lot, avec TOUTES les régions du lot retirées/rétablies : doit égaler la sauvegarde ainsi traitée. */
function normalizeNow(now: string): string {
  let s = now;
  s = s.split("\n").filter((l) => !l.startsWith(MARK_INC) && !l.startsWith("// PULLFRAME-BOUNDED-SSL-FIX1 : à partir d'ici") && l !== "#define WiFiSSLClient PodBoundedSSL").join("\n");
  assert.ok(s.includes(NEW_FAULT) && s.includes(NEW_REG));
  s = s.replace(NEW_FAULT, OLD_FAULT).replace(NEW_REG, OLD_REG);
  s = cut(s, "// REGISTER-JSON-STACK-FIX1", "static bool doRegister() {");
  s = cut(s, "// ─── PULL ──", "// ─── VALIDATION RÉELLE");
  s = cut(s, "// DOVALIDATE-JSON-STACK-FIX1", "  const String signature = signED25519(candidateId, score);");
  return s;
}
function normalizeBackup(before: string): string {
  let s = cut(before, "// ─── PULL ──", "// ─── VALIDATION RÉELLE");
  s = cut(s, "static bool doValidate() {", "  const String signature = signED25519(candidateId, score);");
  return s;
}

for (const sk of PROP_SKETCHES) {
  test(`${sk} : hors régions du lot (include, define, défaut du client, register, pull, validate) le sketch est la sauvegarde d'avant, au texte près ; chaque fragment est unique`, () => {
    const now = ino(sk), before = propBackup(sk).replace(/\r\n/g, "\n");
    // doValidate : la fin d'avant (ligne « signature ») et d'après sont identiques ; l'en-tête de fonction est dans la région retirée des deux côtés
    const nowFixed = normalizeNow(now).replace("static bool doValidate() {\n", "");
    const beforeFixed = normalizeBackup(before);
    // la ligne « static bool doValidate() { » est conservée par la région retirée côté nouveau (elle précède la ligne de signature) : on compare sans elle des deux côtés
    assert.equal(nowFixed.replace("// ─── VALIDATION ────────────────────────────────────────────────────────────\n", ""), beforeFixed.replace("// ─── VALIDATION ────────────────────────────────────────────────────────────\n", ""));
    for (const f of [MARK_INC, "#define WiFiSSLClient PodBoundedSSL", NEW_FAULT, NEW_REG]) assert.equal(now.split(f).length - 1, 1, `${sk} : « ${f.slice(0, 50)} » exactement une fois`);
    assert.equal(now.split("podNetRun(").length - 1, before.split("podNetRun(").length - 1, "aucune transaction réseau ajoutée ni retirée");
  });

  test(`${sk} : client TLS borné — copie byte-identique du 2,9″, redirection AVANT Conn, drapeaux 0/0, aucun new_handler/operator new, fault() testé avant affichage et ACK`, () => {
    const src = ino(sk), code = stripLine(src);
    const hdr = fs.readFileSync(path.join(root, `arduino_uno_r4/${sk}/pod_ssl_bounded.h`));
    assert.equal(hdr.compare(fs.readFileSync(path.join(root, "arduino_uno_r4/pod_uno_r4_eink29/pod_ssl_bounded.h"))), 0, "copie divergente du 2,9″ (validé sur carte)");
    assert.ok(src.indexOf(MARK_INC) > src.indexOf('#include "pod_http.h"'), "include après pod_http.h");
    assert.ok(src.indexOf("#define WiFiSSLClient PodBoundedSSL") < src.indexOf("struct Conn {"), "redirection avant Conn");
    assert.match(src, /struct Conn \{\n  WiFiSSLClient client;\n  podhttp::Reader<WiFiSSLClient> rd;/);
    assert.match(src, /#ifndef POD_RENDER_V1\n#define POD_RENDER_V1 0\n#endif/);
    assert.doesNotMatch(src, /#define POD_(RENDER_V1|CANARY) 1\b/);
    assert.doesNotMatch(code + stripLine(hdr.toString()), /set_new_handler|operator\s+new|operator\s+delete/);
    // l'unique usage direct du vrai nom est avant la redirection (include du cœur) ; après, plus aucun « WiFiSSLClient » dans le code de production hors Conn
    const after = code.slice(code.indexOf("#define WiFiSSLClient PodBoundedSSL") + 40);
    assert.equal((after.match(/WiFiSSLClient/g) ?? []).length, 2, "uniquement dans Conn (client + Reader)");
    // l'ACK n'est atteint qu'après : image complète (fault() == 0), rendu/affichage réussi
    const df = fnText(src, "doFetchFrame");
    assert.match(df, /got = \(b == BUF_SIZE && c\.rd\.complete\(\) && c\.client\.fault\(\) == 0\);/);
    assert.ok(df.indexOf("if (!got)") < df.indexOf("refreshPanel(false)") && df.indexOf("refreshPanel(false)") < df.indexOf("ackFrame(frameId"), "ordre : image complète, affichage, ACK");
    assert.equal((df.match(/ackFrame\(/g) ?? []).length, 1, "un seul ACK, en dernier");
    assert.match(df, /if \(!got\) \{[^\n]*pas d'ACK[^\n]*return false; \}/);
  });

  test(`${sk} : plus aucun deserializeJson sur la pile principale ; trois décodeurs sur la pile de travail, après la fermeture de TLS, sans effet de bord avant un résultat valide`, () => {
    const src = ino(sk), code = stripLine(src);
    for (const m of code.matchAll(/deserializeJson\(/g)) {
      const before = code.slice(0, m.index);
      const fn = [...before.matchAll(/^static (?:[\w:<>&*]+ )+?(?:__attribute__\(\(noinline\)\) )?(\w+)\(/gm)].pop()![1];
      assert.match(fn, /^(registerParseWork|pullParseWork|validateParseWork)$/, `deserializeJson dans ${fn}`);
    }
    assert.equal((code.match(/^\s+JSON_DOC\(\w+,/gm) ?? []).length, 4, "4 documents : register, pull (429 + réponse), validate — tous sur la pile de travail");
    for (const f of ["doRegister", "doPull", "doValidate"]) assert.doesNotMatch(fnText(src, f), /JSON_DOC|deserializeJson|\.as<String>\(\)/, `${f} sans JSON sur la pile principale`);
    assert.equal((code.match(/podWorkRun\(/g) ?? []).length, 3);
    // les trois lanceurs reçoivent la réponse DÉJÀ lue (httpCall est revenu) ; jamais dans une lambda podNetRun
    for (const lam of src.matchAll(/auto tx = \[&\]\(\) \{[\s\S]*?\n  \};/g)) assert.doesNotMatch(lam[0], /deserializeJson|podWorkRun|ParseWork/, "pas de JSON pendant la transaction TLS");
    assert.match(src, /POD_WORK_JSON_NESTING/);
    assert.match(fnText(src, "doPullStage"), /new \(std::nothrow\) PullParsed\(\)/);
  });
}

test("solo : les blocs register/pull/validate sont IDENTIQUES à ceux du 2,9″ validé sur carte (texte, hors canari) ; la doPull du 2,7″ est celle du 2,9″", () => {
  const e29 = noCanary(read(E29)), s = ino("pod_uno_r4_eink27");
  const reg = (x: string) => take(x, "// REGISTER-JSON-STACK-FIX1", "static bool doRegister() {").replace("#include <new>\n", "").trim();
  assert.equal(reg(s), reg(e29));
  const pull = (x: string) => take(x, "// DOPULL-JSON-STACK-FIX1", "static bool doPull() {").replace("#include <new>\n", "").trim();
  assert.equal(pull(s), pull(e29));
  const val = (x: string) => take(x, "// DOVALIDATE-JSON-STACK-FIX1", "  const String signature = signED25519(candidateId, score);").trim();
  assert.equal(val(s), val(e29));
  // doPull : même corps (le 2,9″ place un saut de ligne dû à son instrument de canari)
  const dp = (x: string) => fnText(x, "doPull").replace(/\s+/g, " ");
  assert.equal(dp(s), dp(e29));
});

test("OLED : le bloc pull est celui du 2,9″ + le SEUL champ « screen » (16 car. max, REFUSÉ au-delà) ; register/validate identiques ; routage OLED/e-ink de doPull inchangé", () => {
  const e29 = noCanary(read(E29)), o = ino("pod_uno_r4_eink27_oled"), before = propBackup("pod_uno_r4_eink27_oled").replace(/\r\n/g, "\n");
  const pull = (x: string) => take(x, "// DOPULL-JSON-STACK-FIX1", "static bool doPull() {").replace("#include <new>\n", "").trim();
  // on rétablit à la main les huit retouches « screen » : le résultat doit être le bloc du 2,9″
  let back = pull(o);
  const rev: [string, string][] = [
    ["#define PULL_SCR_MAX    16        // lot 8B-2B-3 : champ « screen » (OLED + e-ink 2,7″) — « oled096 », « eink27bw » ; plus long => REFUSÉ\n", ""],
    ["frameId, screen, workTitle", "frameId, workTitle"],
    [`  if (!pullSetId(r.screen, doc["screen"] | "", PULL_SCR_MAX, r)) return;
  if (r.frameId.length() == 0) {
    JsonObject fo = doc["frame"];
    if (!fo.isNull()) {
      if (!pullSetId(r.frameId, fo["frameId"] | "", PULL_ID_MAX, r)) return;
      const char* fs = fo["screen"] | "";            // « fo["screen"] | newScreen » d'avant : absent => on garde le « screen » de la racine
      if (fs[0] != '\\0' && !pullSetId(r.screen, fs, PULL_SCR_MAX, r)) return;
    }
  }
`, '  if (r.frameId.length() == 0) { JsonObject fo = doc["frame"]; if (!fo.isNull() && !pullSetId(r.frameId, fo["frameId"] | "", PULL_ID_MAX, r)) return; }\n'],
    ["String& frameId, String& frameSource, String& screen) {\n  r.cartelBlockIndex", "String& frameId, String& frameSource) {\n  r.cartelBlockIndex"],
    [" frameSource = r.frameSource; screen = r.screen;\n", " frameSource = r.frameSource;\n"],
    ["String& frameId, String& frameSource, String& screen) {\n  PullParsed", "String& frameId, String& frameSource) {\n  PullParsed"],
    ["doPullApply(*r, resp, code, frameId, frameSource, screen);", "doPullApply(*r, resp, code, frameId, frameSource);"],
  ];
  for (const [a, b] of rev) { assert.equal(back.split(a).length - 1, 1, `retouche « ${a.slice(0, 50)} » exactement une fois`); back = back.replace(a, b); }
  assert.equal(back.trim(), pull(e29), "hors « screen », le bloc est celui du 2,9″");
  const reg = (x: string) => take(x, "// REGISTER-JSON-STACK-FIX1", "static bool doRegister() {").replace("#include <new>\n", "").trim();
  assert.equal(reg(o), reg(e29));
  const val = (x: string) => take(x, "// DOVALIDATE-JSON-STACK-FIX1", "  const String signature = signED25519(candidateId, score);").trim();
  assert.equal(val(o), val(ino("pod_uno_r4_eink27")), "validate identique au solo");
  // le routage de doPull (OLED / e-ink / repli / inconnu) est celui d'avant, mot pour mot
  const route = (x: string) => x.slice(x.indexOf('  if (newFrameSource == "none" || newFrameId.length() == 0)'), x.indexOf("\n}\n", x.indexOf('  if (newFrameSource == "none" || newFrameId.length() == 0)')));
  assert.equal(route(fnText(o, "doPull")), route(fnText(before, "doPull")));
  // le chemin OLED n'a pas bougé d'un octet
  for (const f of ["saveOledFrame", "restoreOledFrame", "oledStatus", "displayOnboardingOLED", "doFetchFrameOLED", "ackFrame"]) {
    if (!new RegExp(`^static [^\\n]*\\b${f}\\(`, "m").test(before)) continue;
    assert.equal(fnText(o, f), fnText(before, f), `${f} (chemin OLED) inchangé`);
  }
  assert.match(fnText(o, "doFetchFrameOLED"), /n == OLED_BUF_SIZE && c\.rd\.complete\(\)/, "complétude exacte par Content-Length");
});

test("protocole : ni serveur, ni routes, ni version annoncée, ni capteur touchés par le lot (périmètre étroit)", () => {
  for (const sk of PROP_SKETCHES) {
    const now = ino(sk), before = propBackup(sk);
    assert.equal(now.match(/#define FIRMWARE_VERSION\s+"[^"]+"/)![0], before.match(/#define FIRMWARE_VERSION\s+"[^"]+"/)![0], "FIRMWARE_VERSION inchangée");
    for (const route of ["/api/pull?deviceId=", "/api/pull-frame?deviceId=", "/api/validation-result", "/api/register", "/api/candidate-frame?candidateId=", "/api/validate-candidate?deviceId="]) {
      assert.equal(stripLine(now).split(route).length, stripLine(before).split(route).length, `${sk} : route ${route} inchangée`);
    }
  }
  for (const other of ["pod_uno_r4_tft18", "pod_uno_r4", "pod_uno_r4_tft28", "pod_uno_r4_dht22"]) {
    const d = path.join(root, "arduino_uno_r4", other);
    if (!fs.existsSync(d) || other === "pod_uno_r4_dht22") continue;
    assert.ok(!fs.existsSync(path.join(d, "pod_ssl_bounded.h")), `${other} : pas de client borné (hors lot)`);
  }
  assert.ok(!fs.existsSync(path.join(root, "esp8266")) || !fs.readdirSync(path.join(root, "esp8266"), { recursive: true }).some((f) => /pod_ssl_bounded/.test(String(f))), "ESP8266 (BearSSL) : jamais le client borné du cœur Renesas");
});

// ── Exécution hôte ───────────────────────────────────────────────────────────────────────────
const choice = findCompiler();
console.log(`[r4Eink27Propagation] ${describeChoice(choice)}`);
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const skipHost = !choice.path ? `${describeChoice(choice)} — exécution hôte IGNORÉE` : !ajDir ? `ArduinoJson introuvable (variable ARDUINOJSON_DIR) — exécution hôte IGNORÉE` : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oledpull-"));

function oledExtract(): string {
  const s = noCanary(ino("pod_uno_r4_eink27_oled"));
  const a = s.indexOf("#define PULL_ID_MAX"), b = s.indexOf("static bool doPull() {");
  assert.ok(a > 0 && b > a);
  return s.slice(a, b);
}
function buildOled(mutate: (s: string) => string = (s) => s): string {
  const dir = fs.mkdtempSync(path.join(tmp, "b-"));
  fs.writeFileSync(path.join(dir, "pull_extract.inc"), mutate(oledExtract()));
  const out = path.join(dir, "pull_oled_harness");
  compileHarness(choice.path!, path.join(root, "consensus-pod", "host", "pull_oled_harness.cpp"), out,
    [`-I${dir}`, `-I${path.join(root, "consensus-pod", "host", "shim")}`, `-I${path.join(root, "consensus-pod", "src", "adapters")}`, "-isystem", ajDir!,
      "-DARDUINOJSON_ENABLE_ARDUINO_STRING=1", "-DARDUINOJSON_ENABLE_ARDUINO_STREAM=0", "-DARDUINOJSON_ENABLE_ARDUINO_PRINT=0", "-DARDUINOJSON_ENABLE_PROGMEM=0",
      "-Wno-unused-variable", "-Wno-unused-parameter", "-Wno-unused-function", "-Wno-error=mismatched-new-delete", "-Wno-mismatched-new-delete"]);
  return out;
}

test("OLED (HÔTE) : le code RÉEL du pull contre ArduinoJson réel — screen à la racine, dans frame, absent, 16/17 caractères, NOMEM, 429, JSON tronqué : tout ou rien", { skip: skipHost }, () => {
  const r = runProcess(buildOled(), [], 60000);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout.trim(), /^PASS \d+$/);
});

test("OLED (HÔTE) : CONTRÔLES NÉGATIFS — borne du champ screen supprimée, screen de frame ignoré, effet appliqué avant validation : le harnais les REFUSE", { skip: skipHost }, () => {
  const mutants: [string, string, string][] = [
    ["borne de screen supprimée", "PULL_SCR_MAX, r)) return;\n  if (r.frameId", "(size_t)1000, r)) return;\n  if (r.frameId"],
    ["frame.screen ignoré", "if (fs[0] != '\\0' && !pullSetId(r.screen, fs, PULL_SCR_MAX, r)) return;", ""],
    ["screen non transmis", "screen = r.screen;", ""],
  ];
  const base = oledExtract();
  for (const [name, a, b] of mutants) {
    assert.equal(base.split(a).length - 1, 1, `mutation « ${name} » : motif introuvable ou multiple`);
    const r = runProcess(buildOled((s) => s.split(a).join(b)), [], 60000);
    assert.ok(r.status !== 0 || !/^PASS \d+$/.test(r.stdout.trim()), `mutation « ${name} » NON détectée`);
  }
});

// ── Client TLS borné contre le VRAI cœur Renesas, avec la copie de CHAQUE dossier 2,7″ ──────────
const CACHE = path.join(root, "consensus-pod/host/wifis3/.cache");
function haveSources(): boolean {
  if (fs.existsSync(path.join(CACHE, "1.6.0", "Modem.cpp")) && fs.existsSync(path.join(CACHE, "1.5.3", "Modem.cpp")) && fs.existsSync(path.join(CACHE, "bridge_commands.h"))) return true;
  try { execFileSync("node", [path.join(root, "scripts/fetch-wifis3-sources.js")], { stdio: "ignore", timeout: 120000 }); return true; } catch { return false; }
}
const skipCore = !choice.path ? describeChoice(choice) : !haveSources() ? "sources WiFiS3 absentes (node scripts/fetch-wifis3-sources.js : réseau requis)" : "";
for (const sk of PROP_SKETCHES) for (const version of ["1.5.3", "1.6.0"]) {
  test(`${sk} : sa copie de pod_ssl_bounded.h contre le VRAI cœur Renesas ${version} — AT bornée à 240, plan 5 808 o et image OLED 1 024 o exacts, échec fermé`, { skip: skipCore || false }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wifis3p-"));
    const src = path.join(dir, "libraries/WiFiS3/src");
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(path.join(dir, "extras/uno-r4-wifi-usb-bridge/UNOR4USBBridge"), { recursive: true });
    for (const f of fs.readdirSync(path.join(CACHE, version))) fs.copyFileSync(path.join(CACHE, version, f), path.join(src, f));
    fs.copyFileSync(path.join(CACHE, "bridge_commands.h"), path.join(dir, "extras/uno-r4-wifi-usb-bridge/UNOR4USBBridge/commands.h"));
    fs.writeFileSync(path.join(src, "WiFiCommands.h"), '#include "../../../extras/uno-r4-wifi-usb-bridge/UNOR4USBBridge/commands.h"\n');
    const exe = path.join(dir, "h");
    const c = runProcess(choice.path as string, ["-std=c++17", "-O1", "-fexceptions", "-Wno-overloaded-virtual", `-I${path.join(root, "consensus-pod/host/wifis3/shim")}`, `-I${src}`, `-I${path.join(root, "arduino_uno_r4", sk)}`, "-o", exe,
      path.join(root, "consensus-pod/host/wifis3/bounded_ssl_harness.cpp"), path.join(src, "WiFiSSLClient.cpp"), path.join(src, "WiFiClient.cpp"), path.join(src, "Modem.cpp")], 120000);
    assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`.slice(-1500));
    const r = runProcess(exe, [], 120000);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /SUCCES : \d+ controles, 0 echec/);
    assert.match(r.stdout, /OK   A reponse 1023 o : HeapAbort .* 1921 o > bloc contigu 1888 o/);
    assert.match(r.stdout, /AT _SSLCLIENTRECEIVE max demandee = 240/);
    assert.match(r.stdout, /OK   C2 : plan e-ink 2,7 \(5808 o\)/);
    assert.match(r.stdout, /OK   C3 : image OLED \(1024 o\)/);
  });
}
