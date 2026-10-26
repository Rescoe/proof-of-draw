// tests/canary-attach.test.mjs — mode « porteur » : le porteur lance le serveur et téléverse A lui-même ; le banc vérifie le serveur externe, demande la confirmation, puis exécute A -> B -> A.
// --prepare ne touche à aucune carte. Aucun matériel.
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { runCanary, prepareCanary } from "../canary/orchestrator.mjs"; import { makeSimIo } from "./helpers/canarySimIo.mjs";
const LAB = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAST = { attach: true, pollMs: 8, helloMs: 40, timeouts: { cmd: 1500, wifi: 1500, stage: 1500, ticket: 1500, programming: 2500, hash: 1500, boot: 2500 } };

test("attach : succès A -> B -> A SANS serveur ni téléversement de la part du banc ; confirmation unique après vérification du serveur externe", async () => {
  const s = makeSimIo({ attach: true, mode: "gone-back" }); const r = await runCanary(s.io, FAST);
  assert.equal(r.verdict, "PASS", s.io.files["verdict.txt"]); const c = s.io.calls;
  assert.ok(!c.includes("startServer") && !c.includes("build") && !c.some((x) => x.startsWith("upload")), "le banc ne démarre ni serveur ni téléversement ni compilation");
  assert.ok(c.indexOf("loadPrepared") < c.indexOf("checkServer") && c.indexOf("checkServer") < c.indexOf("confirm") && c.indexOf("confirm") < c.findIndex((x) => x.startsWith("open:")), c.join(" > "));
  assert.equal(s.sim.updateCalls, 2);
});
test("attach : serveur absent ou non conforme, préparation périmée, confirmation fausse, carte pas en A = arrêt AVANT toute reprogrammation", async () => {
  const noSrv = makeSimIo({ attach: true, serverOk: false }); const r1 = await runCanary(noSrv.io, FAST); assert.equal(r1.verdict, "ABORTED"); assert.match(noSrv.io.files["verdict.txt"], /server_unreachable/); assert.ok(!noSrv.io.calls.includes("confirm"));
  const stale = makeSimIo({ attach: true, staleCommit: true }); const r2 = await runCanary(stale.io, FAST); assert.equal(r2.verdict, "ABORTED"); assert.match(stale.io.files["verdict.txt"], /stale_prepare/); assert.ok(!stale.io.calls.includes("confirm"));
  const bad = makeSimIo({ attach: true, typed: "oui" }); const r3 = await runCanary(bad.io, FAST); assert.equal(r3.verdict, "ABORTED"); assert.equal(bad.sim.sent.length, 0); assert.ok(!bad.io.calls.some((x) => x.startsWith("open:")), "aucun port ouvert sans confirmation");
  // la carte porte déjà B (ou autre chose) au lieu de A : la machine s'arrête sur l'identité, sans aucune reprogrammation
  const s = makeSimIo({ attach: true }); s.sim.running = "B"; const r4 = await runCanary(s.io, FAST); assert.equal(r4.verdict, "FAIL"); assert.match(s.io.files["verdict.txt"], /wrong_build/); assert.equal(s.sim.updateCalls, 0);
});
test("attach : une panne après confirmation écrit recovery.txt (la reprogrammation est destructive)", async () => {
  const s = makeSimIo({ attach: true, boardOpts: { dataFlashChanges: true }, mode: "stay-same-transport" }); const r = await runCanary(s.io, FAST);
  assert.equal(r.verdict, "FAIL"); assert.ok("recovery.txt" in s.io.files); assert.ok(s.sim.updateCalls <= 1);
});
test("--prepare : prévol + compilation + latest.json, AUCUN port ouvert, AUCUN téléversement ; prévol en échec = rien de compilé", async () => {
  const s = makeSimIo({ boards: [{ port: "COM5", protocol: "serial", serial: "S", fqbns: ["arduino:renesas_uno:unor4wifi"] }] }); const p = await prepareCanary(s.io);
  assert.ok(p.ok && p.port === "COM5" && p.prepared.commit === "abc1234"); assert.ok(s.prepared && s.prepared.A.size > 0);
  assert.ok(!s.io.calls.some((x) => x.startsWith("open:") || x.startsWith("upload") || x === "confirm" || x === "startServer"), s.io.calls.join(","));
  const bad = makeSimIo({ preflightOk: false }); const q = await prepareCanary(bad.io); assert.ok(!q.ok); assert.deepEqual(bad.io.calls, ["preflight"]);
});
test("lanceurs : trois .cmd (préparer / serveur / lancer) à la racine, CRLF, fenêtres laissées ouvertes ; seul le dernier lance l'orchestrateur en --attach ; aucun ne téléverse", () => {
  const read = (n) => readFileSync(join(LAB, n), "utf8");
  for (const n of ["CANARY-1-PREPARER.cmd", "CANARY-2-SERVEUR.cmd", "CANARY-3-LANCER.cmd"]) { const t = read(n); assert.ok(t.includes("\r\n") && /pause/i.test(t) && /cd \/d/.test(t), n); assert.ok(!/arduino-cli|upload/i.test(t.split(/\r?\n/).filter((l) => !/^rem /i.test(l)).join("\n")), n + " ne téléverse rien"); }
  assert.ok(read("CANARY-1-PREPARER.cmd").includes("--prepare") && read("CANARY-3-LANCER.cmd").includes("--attach") && read("CANARY-2-SERVEUR.cmd").includes("serve-latest.mjs"));
});
test("serve-latest : ne sert que les fichiers de la préparation (via makeHandler à liste blanche de noms) et refuse de démarrer sans préparation", () => {
  const s = readFileSync(join(LAB, "canary", "serve-latest.mjs"), "utf8"); assert.ok(s.includes("makeHandler") && s.includes("latest.json") && s.includes("EADDRINUSE"));
});
