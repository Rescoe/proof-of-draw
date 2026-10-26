// tests/canary-orchestrator.test.mjs — orchestrateur de bout en bout contre un `io` SIMULÉ : ordre imposé (confirmation AVANT téléversement), détection sans ambiguïté, ports (disparition facultative, changement de COM),
// aucun retry, serveur toujours arrêté, verdict sans secret ni IP, récupération écrite. Aucune carte, aucun arduino-cli, aucun port série réel.
import test from "node:test"; import assert from "node:assert/strict";
import { runCanary, CONFIRM_TOKEN } from "../canary/orchestrator.mjs"; import { makeSimIo } from "./helpers/canarySimIo.mjs"; import { FQBN } from "../canary/board.mjs";
const FAST = { pollMs: 8, settleMs: 5, helloMs: 40, timeouts: { cmd: 1500, wifi: 1500, stage: 1500, ticket: 1500, programming: 2500, hash: 1500, boot: 2500 } };
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const idx = (calls, c) => calls.findIndex((x) => x === c || x.startsWith(c));

test("succès A -> B -> A, port qui disparaît puis revient sous un AUTRE COM : PASS, ordre imposé, une seule confirmation, un seul téléversement", async () => {
  const s = makeSimIo({ mode: "gone-back" }); const r = await runCanary(s.io, FAST);
  assert.equal(r.verdict, "PASS", s.io.files["verdict.txt"]); assert.equal(r.exitCode, 0);
  const c = s.io.calls; assert.ok(idx(c, "preflight") < idx(c, "build") && idx(c, "build") < idx(c, "listBoards") && idx(c, "listBoards") < idx(c, "confirm") && idx(c, "confirm") < idx(c, "startServer") && idx(c, "startServer") < idx(c, "upload"), c.join(" > "));
  assert.equal(c.filter((x) => x === "confirm").length, 1); assert.equal(c.filter((x) => x.startsWith("upload")).length, 1, "un seul téléversement : aucun retry");
  assert.ok(c.some((x) => x === "open:COM7"), "réouverture sur le nouveau COM"); assert.ok(s.serverStopped, "serveur arrêté");
  assert.equal(s.sim.updateCalls, 2);
  const v = JSON.parse(s.io.files["verdict.json"]); assert.equal(v.update_calls, 2); assert.equal(v.programmings.length, 2); assert.ok(v.data_flash.unchanged_after_each_programming); assert.deepEqual(v.board.ports_seen.sort(), ["COM5", "COM7"]);
  assert.ok(!IPV4.test(s.io.files["verdict.json"]) && !IPV4.test(s.io.files["verdict.txt"]), "ni IP ni secret dans le verdict");
  assert.ok(IPV4.test(s.io.files["serial-A-to-B.log"]), "(les journaux bruts, eux, gardent l'adresse privée : ils restent locaux)");
  for (const f of ["verdict.txt", "verdict.json", "serial-A-to-B.log", "serial-B-to-A.log", "server.log", "preflight.txt", "preflight.json", "images.json"]) assert.ok(f in s.io.files, f);
  assert.ok(!("recovery.txt" in s.io.files), "pas de récupération en cas de succès");
});

for (const mode of ["stay-reopen", "stay-same-transport"]) {
  test(`succès avec le port RESTÉ présent (${mode}) : la disparition du port n'est pas obligatoire`, async () => {
    const s = makeSimIo({ mode }); const r = await runCanary(s.io, FAST); assert.equal(r.verdict, "PASS", s.io.files["verdict.txt"]);
    assert.ok(!s.io.calls.some((x) => x === "open:COM7"), "même COM"); assert.equal(s.io.calls.filter((x) => x.startsWith("upload")).length, 1);
  });
}

test("confirmation incorrecte : AUCUN téléversement, serveur jamais démarré, ABORTED", async () => {
  for (const typed of ["", "oui", "ota3-a-b-a", "OTA3-A-B-A ", " OTA3-A-B-A", "OTA3"]) {
    const s = makeSimIo({ typed }); const r = await runCanary(s.io, FAST);
    assert.equal(r.verdict, "ABORTED", JSON.stringify(typed)); assert.ok(!s.io.calls.some((x) => x.startsWith("upload")), "pas de téléversement"); assert.ok(!s.serverStarted); assert.equal(s.sim.sent.length, 0, "aucune commande envoyée à la carte");
    assert.ok(!("recovery.txt" in s.io.files));
  }
  assert.equal(CONFIRM_TOKEN, "OTA3-A-B-A");
});

test("prévol en échec : ni compilation, ni détection, ni confirmation", async () => {
  const s = makeSimIo({ preflightOk: false }); const r = await runCanary(s.io, FAST); assert.equal(r.verdict, "ABORTED");
  assert.deepEqual(s.io.calls, ["preflight"]); assert.match(s.io.files["verdict.txt"], /prévol/);
});

test("détection : aucune carte, ou plusieurs cartes compatibles = arrêt AVANT la confirmation, jamais de sélection arbitraire", async () => {
  const none = makeSimIo({ boards: [] }); assert.equal((await runCanary(none.io, FAST)).verdict, "ABORTED"); assert.ok(!none.io.calls.includes("confirm"));
  const two = makeSimIo({ boards: [{ port: "COM5", protocol: "serial", serial: "A", fqbns: [FQBN] }, { port: "COM6", protocol: "serial", serial: "B", fqbns: [FQBN] }] });
  const r = await runCanary(two.io, FAST); assert.equal(r.verdict, "ABORTED"); assert.ok(!two.io.calls.includes("confirm") && !two.io.calls.some((x) => x.startsWith("upload") || x.startsWith("open")));
  assert.match(two.io.files["verdict.txt"], /ambiguous_boards/);
  const other = makeSimIo({ boards: [{ port: "COM3", protocol: "serial", serial: "Z", fqbns: ["arduino:avr:uno"] }] }); assert.equal((await runCanary(other.io, FAST)).verdict, "ABORTED", "une carte d'un autre type n'est pas compatible");
});

test("téléversement de A en échec : ABORTED, aucun retry, recovery.txt écrit avec les commandes arduino-cli, serveur arrêté", async () => {
  const s = makeSimIo({ uploadOk: false }); const r = await runCanary(s.io, FAST);
  assert.equal(r.verdict, "ABORTED"); assert.equal(s.io.calls.filter((x) => x.startsWith("upload")).length, 1, "un seul essai"); assert.ok(s.serverStopped);
  const rec = s.io.files["recovery.txt"]; assert.ok(rec && /double appui/.test(rec) && /upload --fqbn arduino:renesas_uno:unor4wifi/.test(rec) && !/dfu-util/.test(rec));
  assert.ok(!IPV4.test(s.io.files["verdict.txt"]));
});

test("arrêts fermés en cours de route : chacun donne FAIL + recovery.txt + serveur arrêté, sans retry", async () => {
  const cases = [["update_returned", { updateReturns: true }, /update_returned/], ["data_flash_changed", { dataFlashChanges: true }, /data_flash_changed/], ["wrong_build", { badRun: true }, /wrong_build/], ["other_board", { otherUid: true }, /other_board/], ["not_programmed", { stillOld: true }, /not_programmed/], ["flash_hash", { wrongFlashHash: true }, /flash_hash/], ["timeout", { noBoot: true }, /timeout/]];
  for (const [name, boardOpts, re] of cases) {
    const s = makeSimIo({ boardOpts, mode: "stay-same-transport" }); const r = await runCanary(s.io, FAST);
    assert.equal(r.verdict, "FAIL", name + " : " + s.io.files["verdict.txt"]); assert.match(s.io.files["verdict.txt"], re); assert.ok("recovery.txt" in s.io.files, name); assert.ok(s.serverStopped, name);
    assert.equal(s.io.calls.filter((x) => x.startsWith("upload")).length, 1, name); assert.ok(s.sim.updateCalls <= 1, name + " : aucune seconde reprogrammation");
  }
});

test("matériel : disparition imprévue ou seconde carte pendant le parcours = arrêt fermé", async () => {
  const gone = makeSimIo({ mode: "stay-same-transport", vanishAt: 4 }); const rg = await runCanary(gone.io, FAST);
  assert.equal(rg.verdict, "FAIL"); assert.match(gone.io.files["verdict.txt"], /port_unexpected|serial_lost/); assert.equal(gone.sim.updateCalls, 0, "aucune reprogrammation après la disparition");
  const extra = makeSimIo({ mode: "stay-same-transport", extraBoardAt: 4 }); const re = await runCanary(extra.io, FAST);
  assert.equal(re.verdict, "FAIL"); assert.match(extra.io.files["verdict.txt"], /ambiguous_ports/); assert.equal(extra.sim.updateCalls, 0);
});

test("liste blanche de bout en bout : aucune commande hors liste, jamais badmagic / badpayload, jamais plus de deux U / YES", async () => {
  const s = makeSimIo({ mode: "gone-back" }); await runCanary(s.io, FAST);
  const sent = s.sim.sent; assert.ok(sent.every((c) => /^(h \d+|w|m|r|U|YES|s [\d.]+:\d+|d (good|to-a)|e [0-9a-f]{64} \d+)$/.test(c)), sent.join(" | "));
  assert.equal(sent.filter((c) => c === "YES").length, 2); assert.equal(sent.filter((c) => c === "U").length, 2);
  assert.ok(!sent.some((c) => /bad|chunked|slow|pad|trunc|lenlie|sigbit/.test(c)));
});

test("flux muet (descripteur périmé après un reset USB) : réouverture du port en lecture seule, AVANT tout acte destructif, puis succès", async () => {
  const fast = { ...FAST, helloMs: 20, reopenMs: 120, settleMs: 5 };
  const dead = makeSimIo({ mode: "stay-same-transport", deadFirst: 1 }); const r = await runCanary(dead.io, fast);
  assert.equal(r.verdict, "PASS", dead.io.files["verdict.txt"]); assert.ok(dead.io.calls.filter((x) => x.startsWith("open:")).length >= 2, "le port a été rouvert"); assert.match(dead.io.files["serial-A-to-B.log"], /flux muet/);
  assert.equal(dead.io.calls.filter((x) => x.startsWith("upload")).length, 1, "un seul téléversement"); assert.equal(dead.sim.updateCalls, 2);
  const stale = makeSimIo({ mode: "stale-handle" }); const r2 = await runCanary(stale.io, fast);
  assert.equal(r2.verdict, "PASS", stale.io.files["verdict.txt"]); assert.match(stale.io.files["serial-A-to-B.log"], /flux muet/);
  const neverEnds = makeSimIo({ mode: "stay-same-transport", deadFirst: 9 }); const r3 = await runCanary(neverEnds.io, { ...fast, timeouts: { ...fast.timeouts, boot: 900 } });
  assert.equal(r3.verdict, "FAIL"); assert.equal(neverEnds.sim.updateCalls, 0, "flux jamais rétabli : aucune reprogrammation");
});

test("expérience --close-on-update : le port PC est fermé dès update_begin et rouvert après le délai ; succès inchangé, aucune commande envoyée pendant la fermeture", async () => {
  const s = makeSimIo({ mode: "stay-reopen" }); const r = await runCanary(s.io, { ...FAST, closeOnUpdate: true, holdMs: 120 });
  assert.equal(r.verdict, "PASS", s.io.files["verdict.txt"]); assert.match(s.io.files["serial-A-to-B.log"], /EXPÉRIENCE : port PC fermé/);
  assert.ok(s.io.calls.filter((x) => x.startsWith("open:")).length >= 3, "ouvert, fermé, rouvert (puis jambe 2)");
});
