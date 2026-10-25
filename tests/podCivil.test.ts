// tests/podCivil.test.ts — date civile du firmware (pod_civil.h) comparée à Date de JavaScript sur des milliers d'instants, dont les limites de mois, d'années bissextiles et de fin de journée.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findCompiler, runProcess, formatFailure } from "./helpers/cppHarness";

const root = path.join(__dirname, "..");
const compiler = findCompiler().path;
const skip = compiler ? false : "aucun compilateur C++ : test de pod_civil.h ignoré — définir CXX";
const pad = (n: number) => String(n).padStart(2, "0");
const ref = (sec: number) => { const d = new Date(sec * 1000); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

test("pod_civil.h : « JJ/MM HH:MM » identique à JavaScript sur 5 000 instants (1970–2105) et les cas limites", { skip }, () => {
  const exe = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "civil-")), "h" + (process.platform === "win32" ? ".exe" : ""));
  const c = runProcess(compiler!, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O1", "-I" + path.join(root, "esp8266", "_shared"), path.join(root, "consensus-pod", "host", "civil_harness.cpp"), "-o", exe]);
  if (c.status !== 0) throw new Error(formatFailure("compilation du harnais pod_civil impossible", c));
  const cases = [1, 59, 60, 86399, 86400, 951782400 /* 29/02/2000 */, 1709164800 /* 29/02/2024 */, 1798675199 /* 31/12/2026 23:59:59 */, 1792800000, 1792853000, 4102444799 /* 31/12/2099 */, 4294967295 /* max 32 bits */];
  let x = 12345; for (let i = 0; i < 5000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; cases.push(Math.floor((x / 0x7fffffff) * 4294967295)); }
  const r = spawnSync(exe, [], { input: cases.join("\n") + "\n", encoding: "utf8" });
  assert.equal(r.status, 0, String(r.stderr));
  const out = String(r.stdout).trim().split(/\r?\n/);
  assert.equal(out.length, cases.length);
  cases.forEach((s, i) => assert.equal(out[i], ref(s), `secondes ${s}`));
});
test("pod_civil.h : l'heure locale se déduit de l'heure serveur et du décalage (Paris été 24/10/2026 15:28Z → 17:28)", () => {
  const sec = Date.UTC(2026, 9, 24, 15, 28) / 1000 + 120 * 60;
  assert.equal(ref(sec), "24/10 17:28");
});
