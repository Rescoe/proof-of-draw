// tests/measureCharts.test.ts — courbes interactives, œuvre en bulles et lecture (02/11/2026) : logique PURE (lib/chartView.ts, lib/measureArt.ts, lib/measureReading.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { MIN_SPAN_SEC, clampWin, fullWindow, lastHours, medianStep, panBy, segments, seriesOf, valueAxis, visiblePoints, zoomAt } from "../lib/chartView";
import { ART_SURFACE, GAP_CAP_SLOTS, SAT_MAX, SLOT_PX, artTempColor, buildArtwork, haloFor, satellitesFor } from "../lib/measureArt";
import { cellText, exactLabel, findings, heatmap, hourProfile, whenLabel } from "../lib/measureReading";
import type { Measure } from "../lib/measures";

const T0 = Date.UTC(2026, 10, 2, 0, 0, 0) / 1000;
const hourly = (n: number, f: (i: number) => Measure["v"]): Measure[] => Array.from({ length: n }, (_, i) => ({ t: T0 + i * 3600, v: f(i) }));

test("fenêtre : zoom garde le point sous le curseur, borne à 3 h et à la plage totale ; déplacement borné", () => {
  const full = { t0: 0, t1: 100 * 3600 };
  const w = zoomAt(full, full, 0.25, 0.5);
  assert.equal(w.t1 - w.t0, 50 * 3600);
  assert.equal(w.t0 + 0.25 * (w.t1 - w.t0), 25 * 3600, "le point ancré ne bouge pas");
  const tiny = zoomAt(full, full, 0.5, 1e-9);
  assert.equal(tiny.t1 - tiny.t0, MIN_SPAN_SEC);
  assert.deepEqual(zoomAt(full, full, 0.5, 4), full, "dézoom borné à la plage totale");
  assert.deepEqual(panBy({ t0: 0, t1: 10 * 3600 }, full, -5000), { t0: 0, t1: 10 * 3600 });
  assert.deepEqual(panBy({ t0: 0, t1: 10 * 3600 }, full, 1e9), { t0: 90 * 3600, t1: 100 * 3600 });
  assert.deepEqual(lastHours(full, 24), { t0: 76 * 3600, t1: 100 * 3600 });
  assert.deepEqual(clampWin({ t0: -50, t1: 10 * 3600 }, full), { t0: 0, t1: 10 * 3600 + 50 });
});

test("courbes : points réels uniquement, un trou n'est jamais relié, les voisins sortent du cadre", () => {
  const ms = hourly(6, (i) => ({ temp: 200 + i })).filter((m) => m.t !== T0 + 3 * 3600);   // trou d'une heure
  const pts = seriesOf(ms, "temp");
  assert.equal(pts.length, 5);
  assert.equal(medianStep(pts), 3600);
  assert.equal(segments(pts).length, 1, "un seul manque ne coupe pas (écart < 2,5 pas)");
  const gapped = seriesOf([{ t: T0, v: { temp: 200 } }, { t: T0 + 3600, v: { temp: 201 } }, { t: T0 + 2 * 3600, v: { temp: 202 } }, { t: T0 + 20 * 3600, v: { temp: 210 } }, { t: T0 + 21 * 3600, v: { temp: 211 } }], "temp");
  assert.equal(segments(gapped).length, 2, "un long silence coupe la courbe");
  const vis = visiblePoints(pts, { t0: T0 + 2 * 3600 - 10, t1: T0 + 4 * 3600 + 10 });
  assert.deepEqual(vis.map((p) => p.t), [T0 + 3600, T0 + 2 * 3600, T0 + 4 * 3600, T0 + 5 * 3600]);
  assert.equal(fullWindow([]), null);
});

test("axe des valeurs : étendue minimale, indice d'air depuis 0, graduations régulières", () => {
  const flat = valueAxis("temp", [210, 211, 212])!;
  assert.ok(flat.hi - flat.lo >= 2, "une température stable n'est pas agrandie en montagnes russes");
  assert.ok(flat.lo <= 21 && flat.hi >= 21.2);
  const air = valueAxis("vocidx", [80, 120])!;
  assert.equal(air.lo, 0);
  assert.ok(air.hi >= 200, "les niveaux restent lisibles");
  assert.equal(valueAxis("hum", []), null);
  const t = valueAxis("temp", [100, 300])!;
  const steps = t.ticks.slice(1).map((v, i) => Math.round((v - t.ticks[i]) * 1e6));
  assert.ok(steps.every((s) => s === steps[0]), "pas constant");
});

test("œuvre : UNE bulle PAR MESURE, largeur proportionnelle au nombre de mesures (24 h < 7 j < 30 j)", () => {
  const v = (i: number) => ({ temp: 180 + (i % 24) * 3, hum: 500 });
  const w = [24, 168, 720].map((n) => buildArtwork(hourly(n, v)));
  assert.deepEqual(w.map((a) => a.bubbles.length), [24, 168, 720]);
  assert.ok(w[0].widthPx < w[1].widthPx && w[1].widthPx < w[2].widthPx, "plus de données ⇒ œuvre plus grande");
  assert.ok(Math.abs(w[1].widthPx / w[0].widthPx - 168 / 24) < 0.5);
  assert.equal(w[0].bubbles[1].slot - w[0].bubbles[0].slot, 1);
  assert.ok(w[0].widthPx >= 24 * SLOT_PX);
});

test("œuvre : chaque élément encode une donnée — taille = humidité, hauteur = température, halo = air (rien sous 100), satellites = variation", () => {
  const a = buildArtwork([
    { t: T0, v: { temp: 200, hum: 300, vocidx: 90 } },
    { t: T0 + 3600, v: { temp: 220, hum: 800, vocidx: 250 } },
    { t: T0 + 7200, v: { temp: 190, hum: 800 } },
  ]);
  const [b0, b1, b2] = a.bubbles;
  assert.ok(b1.size > b0.size && b1.size === b2.size, "taille = humidité");
  assert.ok(b1.y > b0.y && b2.y < b0.y, "hauteur = température");
  assert.equal(b0.halo, 0, "air habituel : pas de halo");
  assert.ok(b1.halo > 0.7, "air chargé : halo large");
  assert.equal(b2.halo, 0, "pas d'air mesuré : pas de halo inventé");
  assert.equal(b0.sat, 0, "première mesure : aucune variation connue");
  assert.equal(b1.sat, 4, "+2,0 °C = 4 petites bulles vers le haut");
  assert.equal(b2.sat, -SAT_MAX, "−3,0 °C = 5 (plafond) vers le bas");
  assert.equal(satellitesFor(4), 0);
  assert.equal(satellitesFor(-5), -1);
  assert.equal(haloFor(100), 0);
  assert.equal(haloFor(300), 1);
  assert.equal(haloFor(null), 0);
});

test("œuvre : déterministe, sans humidité/air/température → valeurs neutres (rien d'inventé), trou plafonné", () => {
  const ms = hourly(5, (i) => ({ temp: 200 + i }));
  assert.deepEqual(buildArtwork(ms), buildArtwork([...ms].reverse()), "ordre d'entrée sans effet");
  const b = buildArtwork(ms).bubbles[0];
  assert.equal(b.hum, null); assert.equal(b.size, 0.5); assert.equal(b.halo, 0);
  const onlyHum = buildArtwork(hourly(3, () => ({ hum: 500 })));
  assert.ok(onlyHum.bubbles.every((x) => x.y === 0.5 && x.temp === null));
  const gap = buildArtwork([{ t: T0, v: { temp: 200 } }, { t: T0 + 3600, v: { temp: 200 } }, { t: T0 + 3600 * 40, v: { temp: 200 } }]);
  assert.equal(gap.bubbles[2].slot - gap.bubbles[1].slot, GAP_CAP_SLOTS);
  assert.equal(buildArtwork([]).bubbles.length, 0);
});

test("palette : chaud ≠ froid, plage fixe, deux fonds (papier / nuit) avec contraste suffisant", () => {
  for (const s of ["paper", "night"] as const) {
    assert.notEqual(artTempColor(50, s), artTempColor(300, s));
    assert.equal(artTempColor(-200, s), artTempColor(0, s), "borné à 0 °C");
    assert.equal(artTempColor(900, s), artTempColor(340, s), "borné à 34 °C");
  }
  const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0); };
  for (const s of ["paper", "night"] as const) {
    const L1 = lum(ART_SURFACE[s].bg), L2 = lum(ART_SURFACE[s].ink);
    assert.ok((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) >= 7, `contraste texte/fond ${s}`);
  }
});

test("lecture : constats calculés sur les mesures réelles, reliés à leur instant", () => {
  const ms = hourly(72, (i) => ({ temp: 150 + Math.round(80 * Math.sin(((i - 9) / 24) * 2 * Math.PI)), hum: 500, vocidx: i === 40 ? 210 : 90 }));
  const f = findings(ms, 0);
  const byId = Object.fromEntries(f.map((x) => [x.id, x]));
  assert.ok(byId["temp-max"] && byId["temp-min"] && byId["hum-max"] && byId["air-max"] && byId["rhythm"]);
  assert.equal(byId["temp-max"].t, ms.reduce((a, b) => ((b.v.temp as number) > (a.v.temp as number) ? b : a)).t);
  assert.match(byId["air-max"].text, /210/);
  assert.match(byId["air-max"].text, /1 mesure sur 72/);
  assert.match(byId["rhythm"].text, /vers 15 h/);
  assert.equal(findings(ms.slice(0, 2), 0).length, 0, "moins de 3 mesures : aucun constat");
  const hole = [...hourly(10, () => ({ temp: 200 })), ...hourly(10, () => ({ temp: 200 })).map((m) => ({ ...m, t: m.t + 40 * 3600 }))];
  assert.ok(findings(hole, 0).some((x) => x.id === "gap" && /rien n'est inventé/.test(x.text)));
});

test("lecture : grille jours × heures, moyenne par heure, case vide sans mesure, fuseau respecté", () => {
  const ms: Measure[] = [{ t: T0 + 5 * 3600, v: { temp: 200 } }, { t: T0 + 5 * 3600 + 900, v: { temp: 220 } }, { t: T0 + 86400 + 5 * 3600, v: { temp: 100 } }];
  const h = heatmap(ms, "temp", T0 + 86400 + 6 * 3600, 2, 0);
  assert.equal(h.rows.length, 2);
  assert.equal(h.rows[0].cells[5].value, 210);
  assert.equal(h.rows[0].cells[5].n, 2);
  assert.equal(h.rows[1].cells[5].value, 100);
  assert.equal(h.rows[0].cells[6].value, null);
  assert.equal(h.lo, 100); assert.equal(h.hi, 210);
  assert.match(cellText("temp", h.rows[0], 5), /21,0 °C \(moyenne de 2 mesures\)/);
  assert.match(cellText("temp", h.rows[0], 6), /aucune mesure/);
  const paris = heatmap(ms, "temp", T0 + 86400 + 6 * 3600, 2, 60);
  assert.equal(paris.rows[0].cells[6].value, 210, "l'heure locale décale la case");
  assert.equal(hourProfile(seriesOf(ms, "temp"), 0)[5], (200 + 220 + 100) / 3);
  assert.match(whenLabel(T0 + 14 * 3600, 0), /^lun\. 02\/11 14 h$/);
  assert.match(exactLabel(T0 + 14 * 3600 + 300, 0), /^lun\. 02\/11\/2026 à 14:05$/);
});
