// 29/10/2026 — courbes de mesures du site : repères de l'axe du temps (heures pleines / minuits locaux), point le plus proche du doigt, et tracé explorable au toucher sans sélection de texte.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { axisStep, nearestPointIndex, timeAxisTicks } from "../lib/timeAxis";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;

test("pas retenu : le plus petit qui donne au plus 7 repères", () => {
  assert.equal(axisStep(0), 0);
  assert.equal(axisStep(3 * 3600), 3600);
  assert.equal(axisStep(24 * 3600), 6 * 3600, "24 h : 24/3 = 8 repères > 7, donc pas de 6 h");
  assert.equal(axisStep(7 * 86400), 86400);
  assert.equal(axisStep(31 * 86400), 7 * 86400);
});

test("24 h (UTC+1) : repères toutes les 6 h sur des heures locales rondes, « jj/mm » en gras à minuit", () => {
  const t1 = utc(2026, 10, 29, 13, 37), t0 = t1 - 86400;
  const ticks = timeAxisTicks(t0, t1, 60);
  assert.deepEqual(ticks.map((k) => k.label), ["18 h", "29/10", "06 h", "12 h"]);
  assert.deepEqual(ticks.map((k) => k.major), [false, true, false, false]);
  for (const k of ticks) { assert.ok(k.t >= t0 && k.t <= t1); assert.equal((k.t + 3600) % (6 * 3600), 0, "heure locale ronde"); }
});

test("7 jours : un repère par minuit local, le lundi en gras", () => {
  const t1 = utc(2026, 10, 29, 13, 0), t0 = t1 - 7 * 86400;
  const ticks = timeAxisTicks(t0, t1, 60);
  assert.deepEqual(ticks.map((k) => k.label), ["23/10", "24/10", "25/10", "26/10", "27/10", "28/10", "29/10"]);
  assert.deepEqual(ticks.map((k) => k.major), [false, false, false, true, false, false, false], "26/10/2026 est un lundi");
});

test("31 jours : un repère par lundi (pas de 7 jours), majeurs", () => {
  const t1 = utc(2026, 10, 29, 13, 0), t0 = t1 - 31 * 86400;
  const ticks = timeAxisTicks(t0, t1, 60);
  assert.ok(ticks.length >= 4 && ticks.length <= 5);
  assert.ok(ticks.every((k) => k.major), "chaque repère est un lundi");
  assert.deepEqual(ticks.map((k) => k.label).slice(-1), ["26/10"]);
});

test("plage vide ou invalide : aucun repère ; point le plus proche d'un instant", () => {
  assert.deepEqual(timeAxisTicks(100, 100), []);
  assert.deepEqual(timeAxisTicks(NaN, 5), []);
  const ts = [10, 20, 30, 100];
  assert.equal(nearestPointIndex([], 5), -1);
  assert.equal(nearestPointIndex(ts, -50), 0);
  assert.equal(nearestPointIndex(ts, 14), 0);
  assert.equal(nearestPointIndex(ts, 16), 1);
  assert.equal(nearestPointIndex(ts, 65), 2);
  assert.equal(nearestPointIndex(ts, 66), 3);
  assert.equal(nearestPointIndex(ts, 9999), 3);
});

test("câblage : un appui suffit (pas d'appui prolongé), le doigt levé garde la valeur, aucune sélection de texte ni menu contextuel — courbes Sensirion/connexion ET température/humidité", () => {
  const c = read("app/MeasuresChart.tsx");
  assert.match(c, /userSelect: "none"[\s\S]*WebkitTouchCallout: "none"/);
  assert.match(c, /onPointerDown=\{at\} onPointerMove=\{at\}/, "un appui place le curseur");
  assert.match(c, /pointerType === "mouse"\) setHover\(null\)/, "seule la souris efface à la sortie : un doigt levé laisse la valeur affichée");
  assert.match(c, /onContextMenu=\{\(e\) => e\.preventDefault\(\)\}/);
  assert.match(c, /touchAction: "pan-y"/, "le défilement vertical de la page reste possible");
  assert.match(c, /timeAxisTicks\(t0, t1, tz\)/);
  const e = read("app/MeasuresExplorer.tsx");
  assert.match(e, /\.\.\.NO_SELECT/);
  assert.match(e, /pointerType === "mouse"\) setHover\(null\)/);
  assert.doesNotMatch(e, /onPointerLeave=\{\(\) => setHover\(null\)\}/, "plus d'effacement au lever du doigt");
});
