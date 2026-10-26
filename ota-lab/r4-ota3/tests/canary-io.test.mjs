// tests/canary-io.test.mjs — parties « E/S » du canari, SANS matériel : pont PowerShell (syntaxe + chemin d'erreur sur un port INEXISTANT), transport (protocole du pont, liste blanche avant écriture), arduino-cli (analyse de board list, arguments),
// prévol, verdict propre, récupération. Aucun vrai port série n'est ouvert (COM999 n'existe pas), aucun arduino-cli n'est lancé.
import test from "node:test"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import { PassThrough } from "node:stream"; import { EventEmitter } from "node:events"; import { readFileSync } from "node:fs";
import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { openSerial, BRIDGE } from "../canary/transport.mjs"; import { parseBoardList, compatible, compileArgs, uploadArgs, recoveryText, FQBN } from "../canary/board.mjs"; import { runPreflight } from "../canary/preflight.mjs"; import { buildVerdict, verdictText, assertClean, safeText, shortId } from "../canary/verdict.mjs";
const LAB = join(dirname(fileURLToPath(import.meta.url)), "..");
const hasPs = spawnSync("powershell", ["-NoProfile", "-Command", "1"], { encoding: "utf8" }).status === 0;

test("pont PowerShell : le script s'analyse sans erreur de syntaxe", { skip: !hasPs }, () => {
  const ps = "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('" + BRIDGE.split(String.fromCharCode(92)).join("/") + "',[ref]$t,[ref]$e); if($e.Count){$e|%{$_.Message};exit 1}else{'ok'}";
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test("pont PowerShell : un port inexistant donne une erreur JSON propre et le code 3 (aucun port réel ouvert)", { skip: !hasPs }, () => {
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", BRIDGE, "-Port", "COM999"], { encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 3, r.stdout + r.stderr); const m = JSON.parse(r.stdout.trim().split(/\r?\n/)[0]); assert.equal(m.t, "error"); assert.ok(m.s.length > 0);
});
test("pont PowerShell : ne bloque JAMAIS sur stdin ni sur le port (régression du 17/10/2026 : [Console]::In.ReadLineAsync est synchrone en PowerShell 5.1 -> réponses de la carte livrées avec une commande de retard)", () => {
  const code = readFileSync(BRIDGE, "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.ok(!/\[Console\]::In\b|\.ReadLineAsync|\.ReadLine\(|ReadExisting/.test(code), "aucune lecture synchrone déguisée");
  assert.ok(code.includes("OpenStandardInput") && code.includes("ReadAsync") && code.includes("BaseStream.ReadAsync"), "stdin ET port lus en asynchrone");
  assert.ok(/Start-Sleep -Milliseconds [0-9]\b/.test(code), "boucle d'interrogation courte");
});
test("pont PowerShell : source — un seul port, aucune exécution de texte reçu", () => {
  const s = readFileSync(BRIDGE, "utf8"); assert.ok(s.includes("System.IO.Ports.SerialPort") && s.includes("$sp.Open()") && s.includes("DtrEnable"));
  assert.ok(!/Invoke-Expression|\biex\b|Start-Process|Invoke-Command/i.test(s), "le pont n'exécute rien de ce qu'il reçoit");
});

function fakeSpawn() { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.written = []; child.stdin.on("data", (d) => child.written.push(d.toString())); child.kill = () => {}; return child; }
test("transport : lignes, ouverture, fermeture, erreur d'ouverture ; la liste blanche est appliquée AVANT toute écriture", async () => {
  const child = fakeSpawn(); const t = openSerial("COM5", { spawn: () => child }); const lines = [], opens = [], closes = [];
  t.onLine((l) => lines.push(l)); t.onOpen((e) => opens.push(e)); t.onClose((w) => closes.push(w));
  child.stdout.write(JSON.stringify({ t: "open" }) + "\n" + JSON.stringify({ t: "line", s: '@OTA3 {"e":"armed"}' }) + "\n" + '{"t":"li'); child.stdout.write('ne","s":"suite"}\n'); await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(opens, [null]); assert.deepEqual(lines, ['@OTA3 {"e":"armed"}', "suite"]);
  t.send("w"); assert.equal(JSON.parse(child.written.join("").trim()).s, "w");
  for (const bad of ["d badmagic", "d badpayload", "f", "h 0", "h 999999"]) assert.throws(() => t.send(bad), /refusée|hors limites/); assert.equal(child.written.length, 1, "rien d'écrit pour les commandes refusées");
  child.stdout.write(JSON.stringify({ t: "closed", why: "IOException" }) + "\n"); await new Promise((r) => setTimeout(r, 20)); assert.deepEqual(closes, ["IOException"]); assert.throws(() => t.send("w"), /fermé/);
  const c2 = fakeSpawn(); const t2 = openSerial("COM6", { spawn: () => c2 }); const o2 = [], k2 = []; t2.onOpen((e) => o2.push(e)); t2.onClose((w) => k2.push(w)); c2.stdout.write(JSON.stringify({ t: "error", s: "Access denied" }) + "\n"); await new Promise((r) => setTimeout(r, 20));
  assert.equal(o2[0].message, "Access denied"); assert.equal(k2.length, 1);
});

test("arduino-cli : board list (formats récent et ancien), compatibilité stricte par FQBN, arguments de compilation et de téléversement (le cœur choisit son outil)", () => {
  const recent = JSON.stringify({ detected_ports: [{ matching_boards: [{ name: "UNO R4 WiFi", fqbn: FQBN }], port: { address: "COM5", protocol: "serial", properties: { serialNumber: "SN1", vid: "0x2341", pid: "0x1002" } } }, { port: { address: "COM3", protocol: "serial", properties: {} } }, { matching_boards: [{ fqbn: FQBN }], port: { address: "reseau-1", protocol: "network" } }] });
  const l = parseBoardList(recent); assert.equal(l.length, 3); assert.deepEqual(compatible(l).map((b) => b.port), ["COM5"], "ni port sans carte, ni port réseau");
  assert.equal(parseBoardList(JSON.stringify([{ port: { address: "COM7", protocol: "serial" }, boards: [{ fqbn: FQBN }] }]))[0].port, "COM7"); assert.equal(parseBoardList("pas du json"), null);
  const up = uploadArgs("COM5", "/b/A"); assert.deepEqual(up, ["upload", "--fqbn", "arduino:renesas_uno:unor4wifi", "-p", "COM5", "--input-dir", "/b/A"]); assert.ok(!up.join(" ").includes("dfu"));
  const cc = compileArgs("/s", "/o", { isB: true, runId: "A1B2C3D4" }).join(" "); assert.ok(cc.includes("-DOTA3_AUTO=1 -DOTA3_IS_B=1 -DOTA3_RUN_ID=0xA1B2C3D4u"));
  const rec = recoveryText({ cli: "cli", sketchDir: "/s", buildDirA: "/a", productionSketch: "/p", state: "PROGRAMMING (jambe 1)" }); assert.ok(rec.includes("double appui") && rec.includes("upload --fqbn") && !rec.includes("dfu-util") && rec.includes("aucun retry"));
});

test("prévol : chaque vérification peut faire échouer le lot ; aucune carte n'est touchée", async () => {
  const core = (v) => async (c, a) => (a[0] === "core" ? { code: 0, stdout: JSON.stringify({ platforms: [{ id: "arduino:renesas_uno", installed_version: v }] }), stderr: "" } : { code: 0, stdout: "arduino-cli 1.4.1\n", stderr: "" });
  const base = () => ({ nodeVersion: "v22.12.0", exec: core("1.6.0"), cli: "cli", git: (a) => (a[0] === "rev-parse" ? "abc1234\n" : ""), exists: () => true, ignored: () => true, runHostTests: async () => ({ ok: true, summary: "pass 99" }), portFree: async () => true, powershell: async () => true, root: "/", sketchDir: "/s", bridge: "/b/serial-bridge.ps1", serverPort: 8080 });
  assert.ok((await runPreflight(base())).ok);
  const breaks = { node: { nodeVersion: "v16.0.0" }, powershell: { powershell: async () => false }, pont: { exists: (p) => !p.endsWith("serial-bridge.ps1") }, secrets: { exists: (p) => !p.endsWith("secrets.h") }, "secrets non ignoré": { ignored: () => false },
    "cœur absent": { exec: async (c, a) => (a[0] === "core" ? { code: 0, stdout: "[]", stderr: "" } : { code: 0, stdout: "x", stderr: "" }) }, "mauvais cœur": { exec: core("1.5.3") },
    "arbre modifié": { git: (a) => (a[0] === "status" ? " M ota-lab/r4-ota3/x\n" : "abc\n") }, "tests en échec": { runHostTests: async () => ({ ok: false, summary: "fail 1" }) }, "port occupé": { portFree: async () => false } };
  for (const [n, over] of Object.entries(breaks)) { const r = await runPreflight({ ...base(), ...over }); assert.equal(r.ok, false, n); }
});

test("verdict : jamais d'IP ni de secret ; l'identifiant de puce n'est exposé que haché ; ABORTED/FAIL/PASS distingués", () => {
  const uid = "0123456789ABCDEF0123456789ABCDEF";
  const st = { done: true, failed: null, ctx: { uid, base: ["1", "2", "3", "4", "5"], updateBegins: 2 }, report: [{ k: "boot_after", leg: 1, build: "B", run: "E5F60718", kind: "boot", rst: "010000", fcrc_same: true }, { k: "flash_hash" }, { k: "port", kind: "gone", port: "COM5" }] };
  const v = buildVerdict(st, { runId: "R", commit: "abc1234", dirty: false, images: { A: { size: 1, sha: "a".repeat(64), run: "A1B2C3D4" }, B: { size: 2, sha: "b".repeat(64), run: "E5F60718" } }, portsSeen: ["COM5"] });
  assert.equal(v.verdict, "PASS"); const txt = JSON.stringify(v) + verdictText(v); assert.ok(!txt.includes(uid)); assert.equal(v.board.id_hash, shortId(uid));
  assert.equal(buildVerdict({ ...st, done: false, failed: { code: "x", why: "y", phase: "p", leg: 1 } }, { runId: "R" }).verdict, "FAIL");
  assert.equal(buildVerdict({ done: false, failed: null, ctx: {}, report: [] }, { runId: "R", aborted: { code: "a", why: "b" } }).verdict, "ABORTED");
  for (const bad of ["adresse 192.168.1.5", "SECRET_WIFI_SSID", "password=1", "ssid: maison"]) assert.throws(() => assertClean(bad), /refus/);
  assert.doesNotThrow(() => assertClean("secrets.h présent dans le sketch"), "le nom du fichier secrets.h est légitime");
  assert.match(safeText("fuite 10.0.0.1", "x.json"), /NON ÉCRIT/, "un verdict refusé est remplacé par un message, jamais écrit ni fatal");
});

test("lanceur .cmd : reste ouvert (pause), affiche code et dossier, se place à la racine, ne téléverse rien lui-même", () => {
  const c = readFileSync(join(LAB, "RUN-CANARY.cmd"), "utf8"); assert.ok(/pause/i.test(c) && c.includes("orchestrator.mjs") && /cd \/d/.test(c) && /ERRORLEVEL/.test(c) && c.includes("runs"));
  assert.ok(!/arduino-cli|upload/i.test(c.split(/\r?\n/).filter((l) => !/^rem /i.test(l)).join("\n")), "le lanceur ne téléverse rien lui-même");
});
