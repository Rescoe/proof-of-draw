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

// ── Échelle de temps des courbes (29/10/2026) : heure locale (France, heure d'été comprise) et repères de l'axe — code réel sur l'hôte contre Intl (Europe/Paris), calculé autrement ──
const PARIS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23", weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
const parisParts = (t: number) => { const o: Record<string, string> = {}; for (const p of PARIS.formatToParts(new Date(t * 1000))) o[p.type] = p.value; return { h: Number(o.hour), min: Number(o.minute), d: Number(o.day), m: Number(o.month), wd: o.weekday }; };
const parisOffset = (t: number) => { const p = new Date(t * 1000); const o: Record<string, string> = {}; for (const x of PARIS.formatToParts(p)) o[x.type] = x.value; return Math.round((Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day), Number(o.hour), Number(o.minute)) / 1000 - Math.floor(t / 60) * 60)); };
type Tk = { col: number; level: number; num: number };
function runTicks(exe: string, ranges: [number, number][]): Tk[][] {
  const r = runProcess(exe, ranges.map(([t0, sp]) => `T:${t0}:${sp}`), 30000);
  assert.equal(r.status, 0, r.stdout);
  const out: Tk[][] = []; let cur: Tk[] = [];
  for (const l of r.stdout.split(/\r?\n/)) {
    if (l.startsWith("TKB")) cur = [];
    else if (l.startsWith("TK ")) { const [, c, v, n] = l.split(" "); cur.push({ col: Number(c), level: Number(v), num: Number(n) }); }
    else if (l.startsWith("TKN")) { assert.equal(Number(l.split(" ")[1]), cur.length); out.push(cur); }
  }
  return out;
}
function buildHist(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "histtk-")); const exe = path.join(dir, "h");
  const inc = path.join(root, "arduino_uno_r4/pod_uno_r4_tft18_env");
  const r0 = runProcess(cc.path as string, ["-std=c++11", "-Wall", "-Wextra", "-Werror", `-I${inc}`, "-o", exe, path.join(root, "consensus-pod/host/hist_harness.cpp")], 60000);
  assert.equal(r0.status, 0, `${r0.stdout}\n${r0.stderr}`);
  return exe;
}
test("pod_hist.h : heure locale = Europe/Paris (UTC+1, heure d'été entre les derniers dimanches de mars et d'octobre à 01:00 UTC) — 5 ans, autour de chaque changement", { skip: cc.path ? false : describeChoice(cc) }, () => {
  const exe = buildHist();
  const sample: number[] = [];
  for (let y = 2024; y <= 2030; y++) for (const mo of [2, 9]) {                                  // mars (index 2) et octobre (index 9)
    const last = new Date(Date.UTC(y, mo, 31)); const sunday = Date.UTC(y, mo, 31 - last.getUTCDay()) / 1000 + 3600;
    for (const dt of [-7200, -1, 0, 1, 3599, 7200, 86400]) sample.push(sunday + dt);
  }
  for (let i = 0; i < 400; i++) sample.push(1700000000 + i * 1_234_567);
  const r = runProcess(exe, sample.map((e) => `Z:${e}`), 30000);
  assert.equal(r.status, 0, r.stdout);
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith("OFF "));
  assert.equal(lines.length, sample.length);
  for (const l of lines) { const [, e, o] = l.split(" "); assert.equal(Number(o), parisOffset(Number(e)), `${new Date(Number(e) * 1000).toISOString()} : écart local`); }
});

test("pod_hist.h : repères de l'axe — 24 h = un trait par heure, 00/12 forts, 06/18 moyens, nombres 00-06-12-18 ; colonnes = formule de classement des relevés", { skip: cc.path ? false : describeChoice(cc) }, () => {
  const exe = buildHist();
  // 24 h finissant le 29/10/2026 14:37 locale (13:37 UTC) ; un autre le jour du passage à l'heure d'hiver (25/10/2026)
  const cases: [number, number][] = [[Date.UTC(2026, 9, 28, 13, 37) / 1000 + 1, 86400], [Date.UTC(2026, 9, 25, 4, 0) / 1000, 86400], [Date.UTC(2026, 2, 29, 0, 0) / 1000, 86400], [Date.UTC(2026, 9, 29, 11, 0) / 1000, 7200], [Date.UTC(2026, 9, 29, 0, 0) / 1000, 172800]];
  const got = runTicks(exe, cases);
  cases.forEach(([t0, span], k) => {
    const exp: Tk[] = [];
    const pxH10 = Math.floor((96 * 3600 * 10) / span), step = [1, 2, 3, 6, 12].find((s) => pxH10 * s >= 200) ?? 12;
    for (let u = Math.ceil(t0 / 3600) * 3600; u < t0 + span; u += 3600) {
      const h = parisParts(u).h;
      exp.push({ col: Math.min(95, Math.floor(((u - t0) * 96) / span)), level: h % 12 === 0 ? 2 : h % 6 === 0 ? 1 : 0, num: h % step === 0 ? h : -1 });
    }
    assert.deepEqual(got[k], exp, `plage ${k}`);
  });
  assert.equal(got[0].length, 24, "24 traits sur 24 h");
  assert.deepEqual(got[0].filter((t) => t.num >= 0).map((t) => t.num).sort((a, b) => a - b), [0, 6, 12, 18], "nombres 00 / 06 / 12 / 18 (≥ 20 px d'écart)");
  assert.deepEqual(got[0].filter((t) => t.level === 2).map((t) => t.num).sort((a, b) => a - b), [0, 12], "traits forts = minuit et midi");
  assert.equal(got[3].length, 2, "2 h : les deux heures pleines");
  assert.ok(got[3].every((t) => t.num >= 0), "plage courte : chaque heure est écrite");
  for (const g of got) for (let i = 1; i < g.length; i++) assert.ok(g[i].col >= g[i - 1].col, "ordre chronologique");
});

test("pod_hist.h : repères de l'axe — 7 jours = un trait par minuit local (lundi fort, jour du mois), 30 jours = lundis fins + 1er du mois fort, 1 an = mois", { skip: cc.path ? false : describeChoice(cc) }, () => {
  const exe = buildHist();
  const end = Date.UTC(2026, 9, 29, 13, 0) / 1000;
  const cases: [number, number][] = [[end - 7 * 86400, 7 * 86400], [end - 30 * 86400, 30 * 86400], [end - 365 * 86400, 365 * 86400], [end - 3 * 86400, 3 * 86400]];
  const got = runTicks(exe, cases);
  const midnights = (t0: number, span: number) => { const o: { u: number; p: ReturnType<typeof parisParts> }[] = []; for (let u = Math.ceil(t0 / 3600) * 3600; u < t0 + span; u += 3600) { const p = parisParts(u); if (p.h === 0) o.push({ u, p }); } return o; };
  // 7 jours : 13,7 px par jour → nombres aux seuls lundis ; 3 jours : 32 px par jour → chaque jour
  for (const [k, everyDay] of [[0, false], [3, true]] as [number, boolean][]) {
    const [t0, span] = cases[k]; const mids = midnights(t0, span);
    assert.deepEqual(got[k], mids.map(({ u, p }) => ({ col: Math.min(95, Math.floor(((u - t0) * 96) / span)), level: p.wd === "Mon" ? 2 : 1, num: everyDay || p.wd === "Mon" ? p.d : -1 })), `plage ${k}`);
  }
  // 30 jours : lundis (niveau 0) + 1er du mois (niveau 2, nombre = mois quand la place le permet : 96/30 = 3,2 px par jour → 96 px par mois → chaque mois)
  { const [t0, span] = cases[1]; const exp = midnights(t0, span).flatMap(({ u, p }) => (p.d === 1 ? [{ col: Math.min(95, Math.floor(((u - t0) * 96) / span)), level: 2, num: p.m }] : p.wd === "Mon" ? [{ col: Math.min(95, Math.floor(((u - t0) * 96) / span)), level: 0, num: -1 }] : [])); assert.deepEqual(got[1], exp); }
  // 1 an : seulement les 1er du mois (12 ou 13), nombres tous les 3 mois (7,9 px par mois → pas de 3)
  { const [t0, span] = cases[2]; const firsts = midnights(t0, span).filter(({ p }) => p.d === 1); assert.deepEqual(got[2], firsts.map(({ u, p }) => ({ col: Math.min(95, Math.floor(((u - t0) * 96) / span)), level: 2, num: (p.m - 1) % 3 === 0 ? p.m : -1 }))); assert.ok(firsts.length >= 12); }
});
