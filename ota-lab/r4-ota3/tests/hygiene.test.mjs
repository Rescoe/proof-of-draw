// tests/hygiene.test.mjs — invariants de SÛRETÉ de la sonde R4 (lecture du source) : aucun appel au module hors pile dédiée, aucune reprogrammation sans YES, aucune variante visant l'ESP32 lui-même,
// aucune commande automatique, aucun protocole PoD, rien de sensible suivi par git.
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync, readdirSync } from "node:fs"; import { execFileSync } from "node:child_process"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."), REPO = join(ROOT, "..", ".."), SK = join(ROOT, "sketch", "ota3_r4_probe");
const SRC = readFileSync(join(SK, "ota3_r4_probe.ino"), "utf8");
const CODE_S = SRC.split("\n").map((l) => { const i = l.indexOf("// "); return i >= 0 && (l.slice(0, i).match(/"/g) ?? []).length % 2 === 0 ? l.slice(0, i) : l; }).join("\n");
const CODE = CODE_S.replace(/"(?:[^"\\]|\\.)*"/g, '""');   // chaînes vidées : « ota.begin(chemin) » dans un message n'est pas un appel
const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" });

function lambdaSpans(code) {
  const spans = []; const re = /\[&\]\(\)\s*\{/g; let m;
  while ((m = re.exec(code))) { let d = 1, i = re.lastIndex; while (d && i < code.length) { if (code[i] === "{") d++; else if (code[i] === "}") d--; i++; } spans.push([m.index, i]); }
  return spans;
}
test("tout appel au module (ota.*, modem.*, WiFi.*, fs.*) est DANS une lambda, et chaque lambda est passée à podWifiRun", () => {
  const spans = lambdaSpans(CODE); assert.ok(spans.length >= 8);
  for (const re of [/\bota\.\w+\(/g, /\bmodem\.\w+\(/g, /\bWiFi\.\w+\(/g, /\bfs\.\w+\(/g]) { let m; while ((m = re.exec(CODE))) assert.ok(spans.some(([a, b]) => m.index > a && m.index < b), `appel hors lambda : ${m[0]} @${m.index}`); }
  for (const [, b] of spans) assert.match(CODE.slice(b, b + 120), /podWifiRun\(f/, "lambda non confiée à podWifiRun");
});
test("jamais ota.begin() ni ota.update() sans chemin (cibles : l'ESP32 lui-même) ; ni téléchargement non bloquant ni CA", () => {
  assert.ok(!/ota\.begin\(\s*\)/.test(CODE) && !/ota\.update\(\s*\)/.test(CODE));
  for (const m of CODE.matchAll(/ota\.(begin|update|download)\(([^)]*)\)/g)) assert.match(m[2], /OTA3_PATH/, m[0]);
  assert.ok(!/startDownload|setCACert/.test(CODE));
});
test("la reprogrammation exige YES dans les 60 s : otaUpdateCall n'est appelé que par cmdUpdateGo, appelé une seule fois, après le test de YES", () => {
  assert.equal((CODE.match(/otaUpdateCall\(\)/g) ?? []).length, 2);     // définition + 1 appel
  assert.equal((CODE.match(/cmdUpdateGo\(\)/g) ?? []).length, 2);
  assert.match(CODE_S, /strcmp\(s, "YES"\) == 0 && millis\(\) - g_armedAt < 60000u/);
  assert.match(CODE, /case 'U': cmdUpdateArm\(\)/);
});
test("setup() et loop() ne lancent AUCUNE commande réseau / OTA tout seuls", () => {
  const setup = CODE.slice(CODE.indexOf("void setup()"), CODE.indexOf("void loop()"));
  assert.ok(!/cmdWifi|cmdStage|cmdUpdate|cmdReadback|cmdFs|otaBegin|otaDownload|WiFi\./.test(setup));
  const loop = CODE.slice(CODE.indexOf("void loop()"));
  assert.ok(!/cmdWifi|cmdStage|cmdUpdateGo|otaUpdateCall|otaDownload/.test(loop));
});
test("aucun protocole PoD, aucune clé, aucune identité dans la sonde ; EEPROM lue seulement", () => {
  for (const w of ["register", "api/pull", "validation-result", "Ed25519", "deviceId", "pairCode", "frameId", "EEPROM.write", "EEPROM.update", "EEPROM.put"]) assert.ok(!CODE.includes(w), w);
  assert.match(CODE, /EEPROM\.read\(i\)/);
});
test("PILE PRINCIPALE (1 024 o) : aucune sortie Serial.print / printf direct, aucun tableau local > 32 o, aucun objet SHA-256 ou WiFiFileSystem local, aucun snprintf hors du journal", () => {
  assert.ok(!/Serial\.print\(/.test(CODE), "Serial.print direct : tout passe par logf()");
  const vs = [...CODE.matchAll(/(?:^|\n)([^\n]*\b(?:uint8_t|char|int|uint16_t|uint32_t|unsigned)\s+\w+\[(\d+)\][^\n]*)/g)].filter((m) => Number(m[2]) > 32);
  for (const m of vs) assert.match(m[1], /\bstatic\b/, `tableau > 32 o sur la pile : ${m[1].trim().slice(0, 80)}`);
  assert.ok(!/\n\s+SHA256\s+\w+\s*[;(]/.test(CODE) && !/\n\s+WiFiFileSystem\s+\w+\s*[;(]/.test(CODE), "objet lourd local");
  const sn = [...CODE.matchAll(/\bv?s?n?printf\s*\(/g)].length; assert.equal(sn, 1, "un seul vsnprintf (dans logEmit)");
  assert.match(CODE, /static void logEmit[\s\S]*?vsnprintf/);
});
test("dossier du sketch : fichiers attendus seulement ; podNetStack.h identique à l'original", () => {
  const ok = ["ota3_r4_probe.ino", "podNetStack.h", "ota3_ticket.h", "secrets.example.h", "secrets.h"];
  for (const f of readdirSync(SK)) assert.ok(ok.includes(f), f);
  assert.equal(readFileSync(join(SK, "podNetStack.h"), "utf8"), readFileSync(join(REPO, "consensus-pod/src/adapters/podNetStack.h"), "utf8"));
});
test("git : ni binaire, ni .ota, ni secrets.h, ni journal, ni clé suivis dans ota-lab/r4-ota3", () => {
  const tracked = git("ls-files", "ota-lab/r4-ota3").split("\n").filter(Boolean);
  for (const f of tracked) assert.ok(!/\.(bin|ota|elf|hex|log|key|pem)$/.test(f) && !/secrets\.h$/.test(f), f);
  assert.ok(git("check-ignore", "ota-lab/r4-ota3/sketch/ota3_r4_probe/secrets.h").trim());
  assert.ok(git("check-ignore", "ota-lab/r4-ota3/artifacts/serve/good.ota").trim());
});

test("OTA3-FIX5 : U et YES passent par le ticket de flash (relecture + ota3Ticket), jamais directement ; la relecture n'avale pas un fichier plus grand que la flash", () => {
  const arm = CODE.slice(CODE.indexOf("static void cmdUpdateArm()"), CODE.indexOf("static void cmdUpdateGo()"));
  const go = CODE.slice(CODE.indexOf("static void cmdUpdateGo()"), CODE.indexOf("static char g_line"));
  assert.ok(arm.includes("if (!verifyStaged(true))") && arm.includes("return;"));
  assert.ok(arm.indexOf("verifyStaged") < arm.indexOf("g_armedAt = millis()"), "relecture AVANT d'armer");
  assert.ok(go.includes("if (!verifyStaged(true))"));
  assert.ok(go.indexOf("verifyStaged") < go.indexOf("otaUpdateCall()"), "relecture JUSTE AVANT l'appel du module");
  assert.ok(CODE.includes("ota3Ticket(g_exp, g_total, g_sha, g_head, g_verifyOk, g_moduleDirty)"));
  assert.ok(CODE.includes("g_verifyOk = false;") && CODE.includes("g_verifyOk = (v == 0)"));
  assert.ok(CODE_S.includes("if (!g_mountOk) { say(\"montage SPIFFS impossible"));
  assert.ok(CODE.includes("g_total <= OTA3_APP_MAX") && !CODE.includes("600000"));
  assert.ok(CODE.includes("case 'e': cmdExpect(s + 1)"));
  assert.ok(CODE_S.includes("CRC[5120-7167]"), "CRC de la flash de données complète (verrou de vote 5120-7167)");
});

// ── OTA3-AUTO1 : mode canari automatique, consommation du ticket, commande h ──
const BS = String.fromCharCode(92);
function evtFormats(src) {
  const out = []; let i = 0;
  while ((i = src.indexOf('OTA3_EVT("', i)) >= 0) {
    i += 'OTA3_EVT("'.length; let f = "";
    while (i < src.length && !(src[i] === '"' && src[i - 1] !== BS)) { if (src[i] === BS && src[i + 1] === '"') { f += '"'; i += 2; } else { f += src[i]; i++; } }
    out.push(f);
  }
  return out;
}
test("OTA3-AUTO1 : le ticket est CONSOMMÉ avant l'appel du module (aucun retry après retour, échec ou délai)", () => {
  const go = CODE.slice(CODE.indexOf("static void cmdUpdateGo()"), CODE.indexOf("static char g_line"));
  assert.ok(go.includes("ota3Consume(g_exp, g_verifyOk)"));
  assert.ok(go.indexOf("verifyStaged") < go.indexOf("ota3Consume") && go.indexOf("ota3Consume") < go.indexOf("otaUpdateCall()"), "relecture -> consommation -> appel");
  assert.equal((CODE.match(/otaUpdateCall\(\)/g) ?? []).length, 2);
  const hdr = readFileSync(join(SK, "ota3_ticket.h"), "utf8"); assert.ok(hdr.includes("static inline void ota3Consume"));
});
test("OTA3-AUTO1 : mode automatique explicite — OTA3_AUTO vaut 0 par défaut ; événements et commande h absents (aucun code) quand il vaut 0", () => {
  assert.ok(CODE.includes("#ifndef OTA3_AUTO") && CODE.includes("#define OTA3_AUTO 0"));
  assert.ok(CODE.includes("#define OTA3_EVT(...) ((void)0)"), "événements = macro vide hors mode auto");
  const h = CODE.slice(CODE.indexOf("static void cmdFlashHash"), CODE.indexOf("static void cmdUpdateArm()"));
  assert.ok(CODE.slice(0, CODE.indexOf("static void cmdFlashHash")).lastIndexOf("#if OTA3_AUTO") > CODE.slice(0, CODE.indexOf("static void cmdFlashHash")).lastIndexOf("#endif"), "cmdFlashHash sous #if OTA3_AUTO");
  assert.ok(CODE.includes("case 'h': cmdFlashHash(s + 1)") && CODE.slice(CODE.indexOf("case 'h'") - 30, CODE.indexOf("case 'h'")).includes("#if OTA3_AUTO"));
  assert.ok(h.includes("sz == 0 || sz > OTA3_APP_MAX"), "h refuse 0 et toute taille > 0x3C000");
  assert.ok(h.includes("(const uint8_t*)OTA3_APP_BASE") && !/write|erase|program/i.test(h), "lecture seule");
});
test("OTA3-AUTO1 : chaque événement tient dans le tampon du journal (256 o) dans le pire cas, et les événements attendus par l'orchestrateur existent", () => {
  const fmts = evtFormats(CODE_S);
  const names = fmts.map((f) => /"e":"(\w+)"/.exec(f)?.[1]).filter(Boolean);
  assert.ok(CODE_S.includes('evtId("boot"') && CODE_S.includes('evtId("hello"') && CODE_S.includes("case 'm':"));
  for (const n of ["wifi", "server", "stage", "expect", "ticket", "armed", "update_begin", "update_returned", "fhash", "err"]) assert.ok(names.includes(n), `événement manquant : ${n}`);
  for (const f of fmts) {
    const isBoot = f.includes('"build":');
    const worst = "@OTA3 " + f.replace(/%0?(\d*)l?[uXdx]/g, (m) => (m.includes("08") ? "XXXXXXXX" : m.includes("04") ? "XXXX" : m.includes("02") ? "XX" : m.endsWith("u") ? "4294967295" : m.endsWith("d") ? "-99999" : "XXXXXXXX")).replace(/%s/g, (m, off) => (isBoot ? (off < 12 ? "hello" : "A") : "S".repeat(64)));
    assert.ok(worst.length <= 248, `événement trop long (${worst.length}) : ${f.slice(0, 60)}`);
  }
});
test("OTA3-AUTO1 : aucun événement ne contient ni identifiant Wi-Fi ni secret (l'IP du réseau local n'est que dans l'événement wifi)", () => {
  for (const f of evtFormats(CODE_S)) assert.ok(!/SECRET|ssid|password|WIFI_SSID/i.test(f), f);
  const ev = evtFormats(CODE_S); assert.equal(ev.filter((f) => f.includes('"ip"')).length, 1);
});

test("OTA3-AUTO3 : témoin LED (1 Hz en A, 5 Hz en B) uniquement en mode canari automatique ; aucune broche touchée en mode manuel", () => {
  const blink = CODE.indexOf("LED_BUILTIN, on ? HIGH : LOW");
  assert.ok(blink > 0 && CODE.slice(0, blink).lastIndexOf("#if OTA3_AUTO") > CODE.slice(0, blink).lastIndexOf("#endif"), "clignotement sous #if OTA3_AUTO");
  assert.ok(CODE.includes("OTA3_IS_B ? 100u : 500u"));
  const pm = CODE.indexOf("pinMode(LED_BUILTIN, OUTPUT)"); assert.ok(pm > 0 && CODE.slice(0, pm).lastIndexOf("#if OTA3_AUTO") > CODE.slice(0, pm).lastIndexOf("#endif"), "pinMode sous #if OTA3_AUTO");
  assert.equal((CODE.match(/digitalWrite\(|pinMode\(/g) ?? []).length, 2, "aucune autre écriture de broche");
});
