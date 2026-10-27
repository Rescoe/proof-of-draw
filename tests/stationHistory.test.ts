// Historique des mesures de la station R4 (28/10/2026) : fonctions pures de pod_hist.h vérifiées sur l'hôte — date civile contre Date (UTC), nom de fichier mensuel, aller-retour de l'enregistrement de
// 10 octets, pente par moindres carrés, moyennes, extrêmes, durées courtes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

const root = path.join(__dirname, "..");
const cc = findCompiler();
const DATE_LINE = /^\d+ \d+ \d+ \//;

test("pod_hist.h : date civile = Date UTC, fichier mensuel vAAMM.bin, enregistrement, pente, moyenne, extrêmes, durées (code réel sur l'hôte)", { skip: cc.path ? false : describeChoice(cc) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hist-"));
  const exe = path.join(dir, "h");
  const inc = path.join(root, "arduino_uno_r4/pod_uno_r4_tft18_env");
  const r0 = runProcess(cc.path as string, ["-std=c++11", "-Wall", "-Wextra", "-Werror", `-I${inc}`, "-o", exe, path.join(root, "consensus-pod/host/hist_harness.cpp")], 60000);
  assert.equal(r0.status, 0, `${r0.stdout}\n${r0.stderr}`);
  const epochs: number[] = [1700000000, 1761600000, 1767225599, 1767225600, 1709251199, 1709251200, 1735689599, 1735689600, 1893455999, 1893456000, 2000000000];
  for (let i = 0; i < 60; i++) epochs.push(1700000000 + i * 5_000_003);                       // un balayage de 9 ans
  const r = runProcess(exe, epochs.map(String), 30000);
  assert.equal(r.status, 0, r.stdout);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.match(lines[lines.length - 1], /RT ok/);
  const dateLines = lines.filter((x) => DATE_LINE.test(x));
  assert.equal(dateLines.length, epochs.length, "chaque date a été convertie");
  for (const l of dateLines) {
    const [e, y, m, p] = l.split(" ");
    const d = new Date(Number(e) * 1000);
    assert.equal(Number(y), d.getUTCFullYear(), l);
    assert.equal(Number(m), d.getUTCMonth() + 1, l);
    assert.equal(p, `/pod18/v${String(d.getUTCFullYear() % 100).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}.bin`, l);
    assert.ok(p.length - "/pod18/".length <= 12, "nom 8.3 : vAAMM.bin");
  }
  const age = (s: number) => lines.find((x) => x.startsWith(`AGE ${s} `))!.slice(`AGE ${s} `.length);
  assert.deepEqual([0, 59, 60, 2699, 3599, 3600, 7800, 172799, 172800, 86400 * 30].map(age), ["1 min", "1 min", "1 min", "44 min", "59 min", "1h00", "2h10", "47h59", "2 j", "30 j"]);
  assert.ok(lines.includes("SLOPE 10000"), "pente d'une rampe : 10 unités par colonne = 10 000 millièmes");
});

test("station R4 : volume de l'historique — un an à 5 min tient dans la réserve de 1 Go (enregistrement de 10 octets)", () => {
  const perYear5min = (365 * 24 * 60 / 5) * 10, hourlyYear = 365 * 24 * 10;
  assert.ok(perYear5min < 1.2e6 && hourlyYear < 1e5);
  assert.ok((perYear5min + hourlyYear) * 14 / 12 < 1e9 / 100, "14 mois de fichiers + horaire = moins de 1 % de la réserve de 1 Go");
});
