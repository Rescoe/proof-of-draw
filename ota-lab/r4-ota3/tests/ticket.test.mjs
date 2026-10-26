// tests/ticket.test.mjs — le ticket de flash (ota3_ticket.h, le MÊME fichier que celui de la sonde) refuse tout ce qu'il doit refuser ; chaque garde est NÉCESSAIRE (mutants : la retirer change au moins un résultat).
import test from "node:test"; import assert from "node:assert/strict"; import { execFileSync } from "node:child_process"; import { mkdtempSync, readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."), SK = join(ROOT, "sketch", "ota3_r4_probe"), HARNESS = join(ROOT, "tests", "ticket_harness.cpp");
const WINLIBS = "C:/Users/thibf/tools/winlibs-14.2/mingw64/bin";
const env = { ...process.env, PATH: (existsSync(WINLIBS) ? WINLIBS + ";" + WINLIBS.replace(/\//g, "\\") + ";" : "") + process.env.PATH };
function run(headerText) {
  const d = mkdtempSync(join(tmpdir(), "ota3t-")); writeFileSync(join(d, "ota3_ticket.h"), headerText); copyFileSync(HARNESS, join(d, "h.cpp"));
  const exe = join(d, "h.exe"); execFileSync("g++", ["-std=c++11", "-Wall", "-Wextra", "-I", d, join(d, "h.cpp"), "-o", exe], { env, stdio: "pipe" });
  return Object.fromEntries(execFileSync(exe, { env, encoding: "utf8" }).trim().split(/\r?\n/).map((l) => l.split(" ")).map(([n, c]) => [n, Number(c)]));
}
const H = readFileSync(join(SK, "ota3_ticket.h"), "utf8");
const OK = 0, NOEXPECT = 1, DIRTY = 2, NOVERIFY = 3, TOOBIG = 4, SIZE = 5, SHA = 6, SHORT = 7, SP = 8, RESET = 9;
const EXPECT = { ok: OK, noexpect: NOEXPECT, dirty: DIRTY, noverify: NOVERIFY, zero: TOOBIG, toobig: TOOBIG, "size-differs": SIZE, "sha-differs": SHA, "sha-last-byte": SHA, short: SHORT, "sp-low": SP, "sp-high": SP, "sp-edge-ok": OK,
  "reset-even": RESET, "reset-boot": RESET, "reset-base": OK, "reset-base-eq": RESET, "reset-beyond": RESET, "reset-at-end": RESET, "reset-last": OK,
  "consumed-v": 0, "consumed-expect": NOEXPECT, "consumed-reset-expect": NOVERIFY, "consumed-size": 0, "consumed-sha0": 0 };

test("ticket : chaque cas rend le code attendu (image B réelle : taille 72 800, SP 0x20007F00, reset 0xA98D)", () => { assert.deepEqual(run(H), EXPECT); });

test("mutants : retirer N'IMPORTE QUELLE garde est détecté (au moins un cas change)", () => {
  const lines = H.split("\n"); const guards = lines.map((l, i) => [l, i]).filter(([l]) => /^\s*if \(.*\) return OTA3_/.test(l) && !/OTA3_OK/.test(l));
  assert.equal(guards.length, 9, "neuf gardes");
  for (const [l, i] of guards) { const m = lines.slice(); m[i] = "  // garde retirée"; const out = run(m.join("\n")); assert.notDeepEqual(out, EXPECT, `garde non nécessaire : ${l.trim()}`); }
  // mutants de comparaison
  const swaps = [["rst < OTA3_APP_BASE", "false"], ["rst >= OTA3_APP_BASE + size", "rst > OTA3_APP_BASE + size"], ["sp < OTA3_SRAM_LO || sp > OTA3_SRAM_HI", "sp < OTA3_SRAM_LO"], ["size > OTA3_APP_MAX", "size > OTA3_APP_MAX + 1"], ["memcmp(sha, e.sha, 32) != 0", "memcmp(sha, e.sha, 31) != 0"]];
  for (const [a, b] of swaps) { assert.ok(H.includes(a), a); assert.notDeepEqual(run(H.replace(a, b)), EXPECT, `comparaison non couverte : ${a}`); }
});

test("consommation : chaque instruction de ota3Consume est NÉCESSAIRE (mutants)", () => {
  const stmts = ["e.set = false;", "e.size = 0;", "memset(e.sha, 0, 32);", "verifyOk = false;"];
  for (const st of stmts) { assert.ok(H.includes(st), st); assert.notDeepEqual(run(H.replace(st, "")), EXPECT, `instruction non nécessaire : ${st}`); }
});
