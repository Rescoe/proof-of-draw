import test from "node:test";
import assert from "node:assert/strict";
import type { Measure } from "../lib/measures";
import {
  aggregate, alignEnd, avgOf, bucketLabel, climateWord, constellation, diskSpec, hasData, nearestBucket, niceScale, seeded, summarizePeriod, tempColor, VIZ_RANGES,
} from "../lib/measureViz";

const H = 3600, D = 86400;
const T0 = Date.UTC(2026, 9, 20) / 1000;   // 20/10/2026 00:00 UTC
const m = (t: number, temp?: number, hum?: number): Measure => ({ t, v: { ...(temp !== undefined ? { temp } : {}), ...(hum !== undefined ? { hum } : {}) } });

test("alignEnd : frontière du seau suivant, UTC et fuseau", () => {
  assert.equal(alignEnd(T0 + 5 * H + 12, H), T0 + 6 * H);
  assert.equal(alignEnd(T0 + 5 * H, H), T0 + 5 * H);   // déjà aligné : conservé
  // Paris été (UTC+2) : minuit local = 22:00 UTC la veille
  assert.equal(alignEnd(T0 + 10 * H, D, 120), T0 + 22 * H);
});

test("aggregate jour : 24 seaux horaires, trous conservés, moyenne/min/max en dixièmes", () => {
  const end = T0 + 24 * H;
  const b = aggregate([m(T0 + 1 * H + 5, 200, 500), m(T0 + 1 * H + 1800, 220, 520), m(T0 + 23 * H, 150, undefined)], "day", end - 1);
  assert.equal(b.length, 24);
  assert.equal(b[1].temp?.avg, 210); assert.equal(b[1].temp?.min, 200); assert.equal(b[1].temp?.max, 220); assert.equal(b[1].n, 2);
  assert.equal(b[1].hum?.avg, 510);
  assert.equal(b[0].n, 0); assert.equal(b[0].temp, null);   // un trou reste un trou
  assert.equal(b[23].hum, null); assert.equal(b[23].temp?.avg, 150);
});

test("aggregate semaine / mois : 7 et 30 seaux quotidiens ; hors période ignoré ; ordre d'entrée indifférent", () => {
  const end = T0 + 7 * D;
  const data = [m(T0 + 6 * D + 100, 100), m(T0 - 1, 999), m(T0 + 3 * D, 180), m(end, 777)];
  const w = aggregate(data, "week", end - 1);
  assert.equal(w.length, 7);
  assert.equal(w.reduce((s, x) => s + x.n, 0), 2);
  assert.deepEqual(aggregate([...data].reverse(), "week", end - 1), w);
  assert.equal(aggregate([], "month", end).length, 30);
  assert.equal(VIZ_RANGES.month.buckets, 30);
});

test("aggregate ne modifie pas les données brutes", () => {
  const data = [m(T0 + 10, 200, 500)];
  const copy = JSON.parse(JSON.stringify(data));
  aggregate(data, "day", T0 + H); summarizePeriod(data, "day", T0 + H);
  assert.deepEqual(data, copy);
});

test("hasData / summarizePeriod : période vide = rien d'inventé", () => {
  assert.equal(hasData(aggregate([], "day", T0)), false);
  const s = summarizePeriod([], "week", T0);
  assert.deepEqual(s, { count: 0, temp: null, hum: null });
  const s2 = summarizePeriod([m(T0 + 10, 100, 400), m(T0 + 20, 300, 600)], "day", T0 + H);
  assert.equal(s2.temp?.avg, 200); assert.equal(s2.hum?.max, 600); assert.equal(s2.count, 2);
});

test("tempColor : froid = bleu, chaud = rouge, borné, jamais vert dominant", () => {
  const rgb = (c: string) => (c.match(/\d+/g) as string[]).map(Number);
  const [r0, g0, b0] = rgb(tempColor(-500)), [r1, , b1] = rgb(tempColor(400)), [rc, , bc] = rgb(tempColor(0)), [rh, , bh] = rgb(tempColor(330));
  assert.ok(b0 > r0 && b0 > g0);              // glacé : bleu dominant
  assert.ok(r1 > b1);                         // brûlant : rouge dominant
  assert.ok(bc > rc && rh > bh);              // 0 °C bleuté, 33 °C rougeâtre
  assert.equal(tempColor(-900), tempColor(-500)); assert.equal(tempColor(900), tempColor(400));
  for (const t of [-100, 50, 120, 190, 250, 300]) { const [r, g, b] = rgb(tempColor(t)); assert.ok(!(g > r + 40 && g > b + 40), `vert à ${t}`); }
});

test("diskSpec : vide, déterministe, humidité = anneau + gouttes, jamais de valeur inventée", () => {
  const empty = aggregate([], "day", T0 + H)[0];
  assert.equal(diskSpec(empty).empty, true);
  const b = aggregate([m(T0 + 10, 200, 800), m(T0 + 20, 260, 820)], "day", T0 + H).find((x) => x.n > 0)!;
  const a = diskSpec(b), c = diskSpec(b);
  assert.deepEqual(a, c);   // déterministe
  assert.ok(a.ring > 0.3 && a.drops.length >= 10);
  const dry = diskSpec(aggregate([m(T0 + 10, 200, 150)], "day", T0 + H).find((x) => x.n > 0)!);
  assert.ok(dry.ring < a.ring && dry.drops.length < a.drops.length);
  const noHum = diskSpec(aggregate([m(T0 + 10, 200)], "day", T0 + H).find((x) => x.n > 0)!);
  assert.equal(noHum.ring, 0); assert.equal(noHum.drops.length, 0); assert.notEqual(noHum.color, null);
  const noTemp = diskSpec(aggregate([m(T0 + 10, undefined, 500)], "day", T0 + H).find((x) => x.n > 0)!);
  assert.equal(noTemp.color, null);
});

test("seeded : même graine, même suite", () => {
  const a = seeded(42), b = seeded(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("constellation : une étoile par seau complet, ordre du temps, coordonnées dans [0,1]", () => {
  const data = [m(T0 + 1 * H, 100, 700), m(T0 + 2 * H, 200, 500), m(T0 + 3 * H, 300, 300), m(T0 + 4 * H, 250, undefined)];
  const c = constellation(aggregate(data, "day", T0 + 24 * H - 1));
  assert.equal(c.stars.length, 3);
  assert.deepEqual(c.links, [[0, 1], [1, 2]]);
  for (const s of c.stars) { assert.ok(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1); }
  assert.ok(c.stars[0].bucket < c.stars[2].bucket);
  assert.deepEqual(constellation(aggregate([], "day", T0)), { stars: [], links: [], word: "" });
  assert.deepEqual(constellation(aggregate(data, "day", T0 + 24 * H - 1)), c);
});

test("climateWord : règles fixes, null sans donnée", () => {
  assert.equal(climateWord(null, null), null);
  assert.equal(climateWord(220, 450), "temps tempéré et air à l'aise");
  assert.equal(climateWord(50, 800), "temps froid et air très humide");
  assert.equal(climateWord(null, 200), "air sec");
});

test("avgOf : pondéré par le nombre de mesures", () => {
  const b = aggregate([m(T0 + 1, 100), m(T0 + 2, 100), m(T0 + 3, 100), m(T0 + H + 1, 200)], "day", T0 + 24 * H - 1);
  assert.equal(avgOf(b, "temp"), 125);
  assert.equal(avgOf(b, "hum"), null);
});

test("niceScale : englobe les valeurs, marge minimale, null sans donnée", () => {
  assert.equal(niceScale([]), null);
  const s = niceScale([215, 218])!;
  assert.ok(s.lo <= 21.5 && s.hi >= 21.8 && s.hi - s.lo >= 4);
  assert.ok(s.ticks.length >= 2 && s.ticks[0] === s.lo);
});

test("nearestBucket borné ; bucketLabel indépendant du fuseau machine", () => {
  assert.equal(nearestBucket(-1, 24), 0); assert.equal(nearestBucket(2, 24), 23); assert.equal(nearestBucket(0.5, 24), 12);
  const b = aggregate([], "day", T0 + 24 * H)[14];
  assert.equal(bucketLabel(b, "day"), "20/10 14 h");
  assert.equal(bucketLabel(aggregate([], "week", T0 + 7 * D)[0], "week"), "mar. 20/10");
});
