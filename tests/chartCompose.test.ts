// tests/chartCompose.test.ts — composition des courbes, représentations, résumé, sélection, œuvres (03/11/2026) + garde-fous « aucune requête en plus ».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { KIND_STYLE, PRESETS, axisSides, bandBucketSec, decimate, defaultSelection, neighborTime, planCharts, presetKinds, selectableKinds, shortTrend, summarizeKind, trendBucketSec, trendOf, valuesAt } from "../lib/chartCompose";
import { bucketBands, seriesOf, valueAxis, segments } from "../lib/chartView";
import { arcPath, trajectoryOf } from "../lib/measureWorks";
import type { Measure, MeasureKind } from "../lib/measures";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const T0 = Date.UTC(2026, 10, 2) / 1000;
const hourly = (n: number, f: (i: number) => Measure["v"]): Measure[] => Array.from({ length: n }, (_, i) => ({ t: T0 + i * 3600, v: f(i) }));

test("composition : 1 grandeur = simple, 2 = fusionné (axe gauche + droit), 3 et plus = petits graphiques synchronisés", () => {
  assert.equal(planCharts([]).layout, "none");
  assert.deepEqual(planCharts(["temp"]), { layout: "single", charts: [["temp"]] });
  assert.deepEqual(planCharts(["temp", "hum"]), { layout: "merged", charts: [["temp", "hum"]] });
  assert.deepEqual(planCharts(["temp", "hum", "vocidx"]), { layout: "multiples", charts: [["temp"], ["hum"], ["vocidx"]] });
  assert.deepEqual(planCharts(["rssi", "lat", "dl"]).charts, [["rssi"], ["lat"], ["dl"]], "signal, latence et débit ne partagent jamais un axe");
  assert.equal(planCharts(["temp", "temp", "hum"]).layout, "merged", "doublons ignorés");
});

test("axes : la première grandeur à gauche, la seconde (autre unité) à droite ; unités et styles distincts (pas de couleur seule)", () => {
  assert.deepEqual(axisSides(["temp", "hum"]), { temp: "left", hum: "right" });
  assert.deepEqual(axisSides(["temp"]), { temp: "left" });
  const styles = (["temp", "hum", "vocidx", "rssi", "lat", "dl"] as MeasureKind[]).map((k) => JSON.stringify(KIND_STYLE[k]));
  assert.ok(new Set(styles).size >= 4, "traits et marqueurs variés");
  assert.notDeepEqual(KIND_STYLE.temp, KIND_STYLE.hum);
});

test("compositions prêtes : Environnement, Air, Connexion, réduites aux grandeurs disponibles ; défaut = température + humidité", () => {
  assert.deepEqual(PRESETS.map((p) => p.id), ["env", "air", "link"]);
  const avail: MeasureKind[] = ["temp", "hum", "vocidx"];
  assert.deepEqual(presetKinds(PRESETS[0], avail), ["temp", "hum"]);
  assert.deepEqual(presetKinds(PRESETS[1], avail), ["temp", "hum", "vocidx"]);
  assert.deepEqual(presetKinds(PRESETS[2], avail), [], "raccourci sans objet : aucune grandeur de connexion");
  assert.deepEqual(defaultSelection(avail), ["temp", "hum"]);
  assert.deepEqual(defaultSelection(["vocidx", "rssi"]), ["vocidx"]);
  assert.deepEqual(defaultSelection(["rssi"]), ["rssi"]);
  assert.deepEqual(defaultSelection([]), []);
});

test("grandeurs proposables : jamais le brut, jamais une grandeur sans mesure (donc privée ou absente)", () => {
  const ms = hourly(3, () => ({ temp: 200, voc: 30000 }));
  assert.deepEqual(selectableKinds(["temp", "hum", "voc", "vocidx"], ms), ["temp"]);
});

test("échelle : adaptative (marge, étendue minimale) ou complète (humidité 0–100, air 0–500)", () => {
  const ad = valueAxis("hum", [450, 470])!, fu = valueAxis("hum", [450, 470], { full: true })!;
  assert.ok(ad.lo > 30 && ad.hi < 70, "adaptative : resserrée autour de 45–47 %");
  assert.equal(fu.lo, 0); assert.ok(fu.hi >= 100);
  assert.equal(valueAxis("vocidx", [90, 110], { full: true })!.hi, 500);
  assert.ok(valueAxis("temp", [150, 400], { full: true })!.hi >= 40);
  assert.ok(valueAxis("dl", [60], { full: true })!.lo === 0);
});

test("tendance et min–max : tranches, jamais une mesure ; les trous restent des trous", () => {
  assert.equal(bandBucketSec(24 * 3600), 3600, "24 h : bande par heure");
  assert.equal(bandBucketSec(7 * 86400), 86400);
  assert.equal(trendBucketSec(24 * 3600), 3600); assert.equal(trendBucketSec(7 * 86400), 6 * 3600); assert.equal(trendBucketSec(30 * 86400), 86400);
  const pts = seriesOf(hourly(48, (i) => ({ temp: 100 + i })), "temp");
  const tr = trendOf(pts, 6 * 3600, 0);
  assert.equal(tr.length, 8);
  assert.equal(tr[0].v, Math.round((100 + 101 + 102 + 103 + 104 + 105) / 6));
  const hole = [...pts.slice(0, 6), ...pts.slice(30)];
  assert.equal(trendOf(hole, 6 * 3600, 0).length, 4, "les tranches sans mesure ne sont pas comblées");
  assert.ok(trendOf(hole, 6 * 3600, 0).length < 8);
  assert.equal(bucketBands(pts, 86400, 0).length, 2);
});

test("rendu de longues séries : min / max / bornes préservés, ruptures conservées, sources intactes", () => {
  const pts = seriesOf(hourly(4000, (i) => ({ temp: 200 + Math.round(50 * Math.sin(i / 7)) + (i === 1234 ? 90 : 0) - (i === 3001 ? 80 : 0) })), "temp");
  const d = decimate(pts, 600);
  assert.ok(d.length <= 700 && d.length >= 300, `réduit : ${d.length}`);
  assert.equal(Math.max(...d.map((p) => p.v)), Math.max(...pts.map((p) => p.v)), "le maximum est conservé");
  assert.equal(Math.min(...d.map((p) => p.v)), Math.min(...pts.map((p) => p.v)), "le minimum est conservé");
  assert.equal(d[0], pts[0]); assert.equal(d[d.length - 1], pts[pts.length - 1]);
  assert.ok(d.every((p, i) => i === 0 || p.t > d[i - 1].t), "ordre du temps");
  assert.equal(pts.length, 4000, "la série source n'est pas modifiée");
  assert.equal(decimate(pts.slice(0, 50), 600).length, 50, "petite série : inchangée");
  const gapped = [...pts.slice(0, 100), ...pts.slice(2000, 2100).map((p) => ({ ...p }))];
  assert.equal(segments(gapped).length, 2, "la rupture reste une rupture");
  const t = Date.now(); decimate(pts, 600); assert.ok(Date.now() - t < 200, "4 000 relevés : rapide");
});

test("résumé et tendance courte : dernière valeur, min / moyenne / max, hausse / baisse / stable, trop peu de mesures", () => {
  const up = hourly(24, (i) => ({ temp: 150 + i * 4 }));
  const s = summarizeKind(up, "temp");
  assert.equal(s.n, 24); assert.equal(s.min, 150); assert.equal(s.max, 242); assert.equal(s.last?.v, 242); assert.equal(s.dir, "up");
  assert.equal(shortTrend("temp", seriesOf(hourly(20, () => ({ temp: 200 })), "temp")), "stable");
  assert.equal(shortTrend("temp", seriesOf(hourly(20, (i) => ({ temp: 300 - i * 5 })), "temp")), "down");
  assert.equal(shortTrend("temp", seriesOf(hourly(4, () => ({ temp: 200 })), "temp")), null);
  assert.equal(summarizeKind([], "hum").last, null);
});

test("sélection : valeurs de toutes les grandeurs à l'instant, « aucune mesure » plutôt qu'une valeur inventée, mesure précédente / suivante", () => {
  const ms: Measure[] = [{ t: T0, v: { temp: 200, hum: 500 } }, { t: T0 + 3600, v: { temp: 210 } }, { t: T0 + 3 * 3600, v: { temp: 220, hum: 520 } }, { t: T0 + 20 * 3600, v: { temp: 230 } }];
  const at = valuesAt(ms, ["temp", "hum"], T0 + 3600);
  assert.equal(at[0].value, 210);
  assert.equal(at[1].value, 500, "la mesure d'humidité à moins d'un écart et demi est retenue");
  const far = valuesAt(ms, ["temp", "hum"], T0 + 20 * 3600);
  assert.equal(far[0].value, 230);
  assert.equal(far[1].value, null, "aucune humidité près de cet instant : pas d'interpolation");
  assert.equal(neighborTime(ms, ["temp"], T0, 1), T0 + 3600);
  assert.equal(neighborTime(ms, ["temp"], T0, -1), null);
  assert.equal(neighborTime(ms, ["hum"], T0 + 3600, 1), T0 + 3 * 3600, "seules les grandeurs affichées comptent");
  assert.equal(neighborTime(ms, ["temp"], null, -1), T0 + 20 * 3600);
});

test("œuvres : trajectoire déterministe (un point par mesure température + humidité, trait coupé aux trous), empreinte (secteurs)", () => {
  const ms = [...hourly(5, (i) => ({ temp: 200 + i, hum: 500 })), ...hourly(3, () => ({ temp: 210, hum: 520 })).map((m) => ({ ...m, t: m.t + 40 * 3600 })), { t: T0 + 100 * 3600, v: { temp: 190 } }];
  const a = trajectoryOf(ms), b = trajectoryOf([...ms].reverse());
  assert.deepEqual(a, b, "ordre d'entrée sans effet");
  assert.equal(a.points.length, 8, "la mesure sans humidité n'a pas de point");
  assert.deepEqual(a.breaks, [5], "un trou précède le sixième point");
  assert.ok(a.points[0].age === 0 && a.points[7].age === 1);
  assert.equal(trajectoryOf([]).points.length, 0);
  assert.match(arcPath(100, 100, 30, 50, 0, 0.26), /^M[\d.,-]+ L[\d.,-]+ A50,50 0 0 1 [\d.,-]+ L[\d.,-]+ A30,30 0 0 0 [\d.,-]+ Z$/);
});

test("une seule lecture d'historique, aucun endpoint, aucun polling, aucune requête dans les vues (garde-fous statiques)", () => {
  const files = ["MeasuresPanel.tsx", "SeriesChart.tsx", "DataParts.tsx", "WorksView.tsx", "ReadingView.tsx", "ArtworkView.tsx"].map((f) => [f, read("app", "measures", f)] as const);
  for (const [f, s] of files) {
    assert.ok(!/\bfetch\s*\(/.test(s), `${f} : aucune requête`);
    assert.ok(!/setInterval|setTimeout|requestAnimationFrame/.test(s), `${f} : aucun polling ni minuteur`);
    assert.ok(!s.includes("/api/"), `${f} : aucun endpoint`);
  }
  const panel = files[0][1];
  assert.equal((panel.match(/useDeviceMeasures\(/g) ?? []).length, 1, "UNE lecture, dans le panneau");
  assert.ok(files.slice(1).every(([, s]) => !s.includes("useDeviceMeasures")), "les vues ne lisent rien");
  assert.ok(fs.existsSync(path.join(root, "app", "api", "sensor", "route.ts")));
  assert.ok(!fs.existsSync(path.join(root, "app", "api", "sensor-view")), "aucun nouvel endpoint de mesures");
});

test("interface : espaces Données / Œuvres / Lecture, Vue d'ensemble / Analyse détaillée, graphique fusionné par défaut, légende repliable, focus venant de la Lecture réellement utilisé", () => {
  const panel = read("app", "measures", "MeasuresPanel.tsx"), chart = read("app", "measures", "SeriesChart.tsx");
  for (const label of ["Données", "Œuvres", "Lecture", "Vue d’ensemble", "Analyse détaillée", "Réinitialiser la vue", "Choisir les données affichées", "⚙ Affichage"]) assert.ok(panel.includes(label), label);
  assert.ok(panel.includes("defaultSelection(available)") && panel.includes("planCharts(selected)"));
  assert.ok(panel.includes("setFocus(t)") && panel.includes("setPicked(withK)"), "le constat sélectionne la grandeur concernée et centre la période");
  assert.ok(chart.includes("focus !== null") && chart.includes("Instant signalé par la Lecture"), "l'événement est mis en évidence");
  assert.ok(chart.includes("aria-pressed={!off}") && chart.includes("toggle(d.kind)"), "légende cliquable pour masquer une série");
  assert.ok(chart.includes("axisSides(kinds)") && chart.includes("W - PR + 6"), "axe droit coloré");
  const ws = read("app", "measures", "WorksView.tsx");
  for (const label of ["Chronique", "Trajectoire", "Empreinte", "Laboratoire"]) assert.ok(ws.includes(label), label);
  assert.ok(ws.indexOf('useState<Work>("chronicle")') > 0, "Chronique par défaut");
  const css = read("app", "measures", "measures.css");
  assert.match(css, /\.mv-seg__btn \{ min-height: 44px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});
