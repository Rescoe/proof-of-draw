// tests/canary-orchestrator-mutants.test.mjs — MUTANTS de l'orchestrateur : retirer une garde (confirmation, ambiguïté, prévol, arrêt du serveur, récupération, détection de disparition…) fait échouer au moins une vérification de bout en bout.
import test from "node:test"; import assert from "node:assert/strict"; import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
import { makeSimIo } from "./helpers/canarySimIo.mjs"; import { FQBN } from "../canary/board.mjs";
const CAN = join(dirname(fileURLToPath(import.meta.url)), "..", "canary");
const FAST = { pollMs: 8, settleMs: 5, helloMs: 40, timeouts: { cmd: 1500, wifi: 1500, stage: 1500, ticket: 1500, programming: 2500, hash: 1500, boot: 2500 } };
async function loadRun(mut) {
  const d = mkdtempSync(join(tmpdir(), "canorch-")); for (const f of readdirSync(CAN)) if (f.endsWith(".mjs") && f !== "real-io.mjs") copyFileSync(join(CAN, f), join(d, f));
  let o = readFileSync(join(CAN, "orchestrator.mjs"), "utf8"); if (!o.includes(mut[0])) throw new Error("motif absent : " + mut[0].slice(0, 70)); writeFileSync(join(d, "orchestrator.mjs"), o.replace(mut[0], mut[1]));
  return (await import(pathToFileURL(join(d, "orchestrator.mjs")).href + "?" + Math.random())).runCanary;
}
// vérifications de bout en bout : renvoient une chaîne décrivant l'issue (comparée à celle du programme sain)
async function probe(runCanary) {
  const out = {};
  { const s = makeSimIo({ typed: "non" }); const r = await runCanary(s.io, FAST); out.confirm = `${r.verdict}|upload=${s.io.calls.filter((x) => x.startsWith("upload")).length}|server=${s.serverStarted}`; }
  { const s = makeSimIo({ boards: [{ port: "COM5", protocol: "serial", serial: "A", fqbns: [FQBN] }, { port: "COM6", protocol: "serial", serial: "B", fqbns: [FQBN] }] }); const r = await runCanary(s.io, FAST); out.ambiguous = `${r.verdict}|confirm=${s.io.calls.includes("confirm")}`; }
  { const s = makeSimIo({ preflightOk: false }); const r = await runCanary(s.io, FAST); out.preflight = `${r.verdict}|calls=${s.io.calls.join(",")}`; }
  { const s = makeSimIo({ uploadOk: false }); const r = await runCanary(s.io, FAST); out.upload = `${r.verdict}|recovery=${"recovery.txt" in s.io.files}|stopped=${s.serverStopped}`; }
  { const s = makeSimIo({ mode: "stay-same-transport", vanishAt: 4, vanishSilent: true }); const r = await runCanary(s.io, FAST); out.vanish = `${r.verdict}|${/port_unexpected/.test(s.io.files["verdict.txt"])}|updates=${s.sim.updateCalls}`; }
  { const s = makeSimIo({ mode: "stay-same-transport", extraBoardAt: 4 }); const r = await runCanary(s.io, FAST); out.extra = `${r.verdict}|${/ambiguous_ports/.test(s.io.files["verdict.txt"])}`; }
  { const s = makeSimIo({ mode: "gone-back" }); const r = await runCanary(s.io, FAST); out.ok = `${r.verdict}|stopped=${s.serverStopped}|open=${s.io.calls.filter((x) => x.startsWith("open:")).join(",")}`; }
  { const s = makeSimIo({ mode: "changed-silent" }); const r = await runCanary(s.io, FAST); out.changed = `${r.verdict}|open=${s.io.calls.filter((x) => x.startsWith("open:")).join(",")}`; }
  return out;
}
const MUTANTS = [
  ["confirmation", "if (typed !== CONFIRM_TOKEN) throw", "if (false) throw"],
  ["ambiguïté des cartes", "if (found.length > 1) throw", "if (false) throw"],
  ["prévol", "if (!pre.ok) throw", "if (false) throw"],
  ["échec de téléversement", "if (!up.ok) throw", "if (false) throw"],
  ["arrêt du serveur", "try { if (server) await server.stop(); } catch { /* */ }", ""],
  ["récupération écrite", "if (uploadStarted || ctx.aborted?.phase === \"post-upload\")", "if (false)"],
  ["disparition imprévue", "else if (present) { feed({ t: \"port\", kind: \"gone\", port: present }); present = false; if (finished) return; }", "else if (present) { present = false; }"],
  ["seconde carte", "if (comp.length > 1) { feed({ t: \"ambiguous\", ports: comp.map((b) => b.port) }); return; }", ""],
  ["réouverture sur nouveau COM", "if (!transport || present === false || (present && present !== p)) {", "if (!transport) {"],
];
test("l'orchestrateur sain produit les issues attendues", async () => {
  const { runCanary } = await import("../canary/orchestrator.mjs"); const o = await probe(runCanary);
  assert.equal(o.confirm, "ABORTED|upload=0|server=false"); assert.equal(o.ambiguous, "ABORTED|confirm=false"); assert.equal(o.preflight, "ABORTED|calls=preflight"); assert.equal(o.upload, "ABORTED|recovery=true|stopped=true");
  assert.equal(o.vanish, "FAIL|true|updates=0"); assert.equal(o.extra, "FAIL|true"); assert.equal(o.changed, "PASS|open=open:COM5,open:COM7,open:COM7"); assert.equal(o.ok, "PASS|stopped=true|open=open:COM5,open:COM7,open:COM7");
});
test("MUTANTS de l'orchestrateur : chaque garde est nécessaire", async () => {
  const { runCanary } = await import("../canary/orchestrator.mjs"); const base = await probe(runCanary);
  for (const m of MUTANTS) { let out; try { out = await probe(await loadRun(m.slice(1))); } catch (e) { out = { crash: String(e.message).slice(0, 80) }; } assert.notDeepEqual(out, base, `mutant survivant : ${m[0]}`); }
});
