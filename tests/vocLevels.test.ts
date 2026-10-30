// 29/10/2026 puis 30/10/2026 — qualité de l’air : niveau (très faible … extrême), couleur, tendance ET indice chiffré de Sensirion (1–500) ; jamais le brut du SGP40.
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

test("niveau ET indice chiffré : formatMeasure(vocidx) rend « Modéré (120) » ; le brut du SGP40 (voc) n'est plus dans aucun groupe affiché", () => {
  assert.equal(formatMeasure("vocidx", 120), "Modéré (120)");
  assert.equal(formatMeasure("vocidx", 50), "Très faible (50)");
  assert.equal(formatMeasure("vocidx", 301), "Extrême (301)");
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

test("câblage : bouton ⓘ d'explication, axe chiffré pour l'indice, brut absent ; station : niveau ET indice chiffré à l'écran, jamais le brut", () => {
  const c = read("app/MeasuresChart.tsx");
  assert.match(c, /aria-label="Comment lire cet indice \?"/);
  assert.doesNotMatch(c, /kind !== "vocidx" && <text/, "repères chiffrés aussi pour l'indice");
  assert.match(c, /\{lv\.label\} \(\{Math\.round\(last\)\}\)/, "valeur actuelle : niveau + indice");
  const ino = read("arduino_uno_r4/pod_uno_r4_tft18_env/pod_uno_r4_tft18_env.ino");
  assert.match(ino, /static uint8_t envVocClass\(\) \{ return histVocLevel\(g_vocIdx\); \}/);
  assert.doesNotMatch(ino, /tft\.print\("COV "\)|tft\.print\("  brut "\)/, "jamais le brut à l'écran");
  assert.match(ino, /tft\.print\("air : indice "\);/, "page principale : indice chiffré");
  assert.match(ino, /envFmtU\(nb, 3, \(unsigned\)g_vocIdx\)/);
  assert.match(ino, /kind == 2 && g_vocIdx > 0\) \{ char nb\[8\]/, "page détail : indice dans l'en-tête");
  assert.match(ino, /envFmtU\(b, 3, \(unsigned\)\(vmax > 0 \? vmax : 0\)\)/, "courbes : repères chiffrés min / max");
  const hist = read("arduino_uno_r4/pod_uno_r4_tft18_env/pod_hist.h");
  assert.match(hist, /idx <= 50 \? 1 : \(idx <= 100 \? 2 : \(idx <= 150 \? 3 : \(idx <= 200 \? 4 : \(idx <= 300 \? 5 : 6\)\)\)\)/);
});
