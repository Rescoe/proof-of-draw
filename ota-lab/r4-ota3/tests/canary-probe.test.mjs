// tests/canary-probe.test.mjs — la sonde de lecture seule n'envoie JAMAIS rien, refuse 0 / 2 cartes, signale une ouverture impossible. Aucun matériel.
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { runSerialProbe } from "../canary/serial-probe.mjs"; import { FQBN } from "../canary/board.mjs";
const board = (port, serial = "S") => ({ port, protocol: "serial", serial, fqbns: [FQBN] });
function fakeIo(boards, { openErr = null, lines = [], closeAfter = false } = {}) {
  const sent = []; let t = 0;
  const io = { sent, now: () => t, sleep: async (ms) => { t += ms; await new Promise((r) => setTimeout(r, 1)); }, listBoards: async () => boards,
    openSerial: () => ({ onOpen: (f) => setTimeout(() => f(openErr), 0), onLine: (f) => setTimeout(() => lines.forEach((l) => f(l)), 0), onClose: (f) => { if (closeAfter) setTimeout(() => f("simulé"), 0); }, send: (c) => sent.push(c), close: () => {} }) };
  return io;
}
test("lecture seule : lit des lignes, n'appelle jamais send(), résumé sans adresse IP", async () => {
  const io = fakeIo([board("COM5")], { lines: ["[OTA3] ===== SONDE =====", '@OTA3 {"e":"boot"}', "texte 192.168.1.5"] }); const r = await runSerialProbe(io, { seconds: 1 });
  assert.ok(r.ok && r.code === "ok"); assert.equal(io.sent.length, 0, "rien envoyé"); assert.equal(r.lines.length, 3); assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(r.summary), "le résumé affiché ne contient pas d'IP");
});
test("0 carte, 2 cartes, mauvais FQBN, ouverture impossible : échec franc, jamais d'ouverture hors cas unique", async () => {
  assert.equal((await runSerialProbe(fakeIo([]), { seconds: 1 })).code, "no_board");
  const two = fakeIo([board("COM5", "A"), board("COM6", "B")]); assert.equal((await runSerialProbe(two, { seconds: 1 })).code, "ambiguous_boards");
  assert.equal((await runSerialProbe(fakeIo([{ port: "COM3", protocol: "serial", serial: "Z", fqbns: ["arduino:avr:uno"] }]), { seconds: 1 })).code, "no_board");
  const bad = await runSerialProbe(fakeIo([board("COM5")], { openErr: new Error("Access denied") }), { seconds: 1 }); assert.ok(!bad.ok && bad.code === "open_failed" && /Access denied/.test(bad.summary));
});
test("source : la sonde ne contient aucun appel à send(), à upload ni à compile", () => {
  const s = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "canary", "serial-probe.mjs"), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/\.send\(|uploadArgs|compileArgs|upload\b/.test(s.replace(/n'appelle JAMAIS send\(\)/g, "")), "aucune écriture, aucun téléversement");
});
