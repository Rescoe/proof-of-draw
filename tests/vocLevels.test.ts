// 29/10/2026 — qualité de l'air : l'interface montre le NIVEAU (très faible … extrême), sa couleur et la tendance, jamais le nombre de l'indice Sensirion ni le brut du SGP40.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MEASURE_GROUPS, VOC_EXPLAIN, formatMeasure, kindsOfGroup, vocLevel, vocTrend } from "../lib/measures";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("niveaux : 0–50 très faible, 51–100 faible, 101–150 modéré, 151–200 élevé, 201–300 très élevé, 301–500 extrême (bornes incluses)", () => {
  const cases: [number, string][] = [[1, "Très faible"], [50, "Très faible"], [51, "Faible"], [100, "Faible"], [101, "Modéré"], [150, "Modéré"], [151, "Élevé"], [200, "Élevé"], [201, "Très élevé"], [300, "Très élevé"], [301, "Extrême"], [500, "Extrême"]];
  for (const [v, l] of cases) assert.equal(vocLevel(v).label, l, String(v));
  assert.deepEqual([50, 100, 150, 200, 300, 500].map((v) => vocLevel(v).level), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set([50, 100, 150, 200, 300, 500].map((v) => vocLevel(v).color)).size, 6, "six couleurs distinctes");
});

test("jamais le nombre : formatMeasure(vocidx) rend le niveau ; le brut du SGP40 (voc) n'est plus dans aucun groupe affiché", () => {
  assert.equal(formatMeasure("vocidx", 120), "Modéré");
  assert.doesNotMatch(formatMeasure("vocidx", 120), /\d/);
  const shown = MEASURE_GROUPS.flatMap((g) => g.kinds);
  assert.ok(shown.includes("vocidx") && !shown.includes("voc"));
  assert.deepEqual(kindsOfGroup(["temp", "hum", "voc", "vocidx", "rssi"], "env"), ["temp", "hum", "vocidx"]);
});

test("tendance : dernier quart contre le reste (écart de 8 points) ; trop peu de valeurs = rien", () => {
  const flat = Array.from({ length: 40 }, () => 100);
  assert.equal(vocTrend(flat), "stable");
  assert.equal(vocTrend([...flat.slice(0, 30), ...Array(10).fill(130)]), "up");
  assert.equal(vocTrend([...flat.slice(0, 30), ...Array(10).fill(70)]), "down");
  assert.equal(vocTrend([100, 120, 140]), null);
  assert.match(VOC_EXPLAIN, /variations relatives/);
});

test("câblage : bouton ⓘ d'explication, axe sans nombres pour l'indice, brut absent des cartes ; station : niveaux et aucun nombre COV à l'écran", () => {
  const c = read("app/MeasuresChart.tsx");
  assert.match(c, /aria-label="Comment lire cet indice \?"/);
  assert.match(c, /kind !== "vocidx" && <text x=\{4\} y=\{P \+ 4\}/);
  const ino = read("arduino_uno_r4/pod_uno_r4_tft18_env/pod_uno_r4_tft18_env.ino");
  assert.match(ino, /static uint8_t envVocClass\(\) \{ return histVocLevel\(g_vocIdx\); \}/);
  assert.doesNotMatch(ino, /tft\.print\("COV "\)|tft\.print\("  brut "\)/, "ni l'indice ni le brut à l'écran");
  assert.doesNotMatch(ino, /envFmtU\(b, 3, \(unsigned\)g_vocIdx\)/);
  const hist = read("arduino_uno_r4/pod_uno_r4_tft18_env/pod_hist.h");
  assert.match(hist, /idx <= 50 \? 1 : \(idx <= 100 \? 2 : \(idx <= 150 \? 3 : \(idx <= 200 \? 4 : \(idx <= 300 \? 5 : 6\)\)\)\)/);
});
