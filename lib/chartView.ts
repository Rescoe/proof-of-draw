// lib/chartView.ts — géométrie PURE des courbes interactives de mesures (02/11/2026) : fenêtre de temps (zoom, déplacement), axes de valeurs, coupure aux trous. Aucun DOM, aucune horloge ; testé dans tests/chartView.test.ts.
// Principe : les courbes montrent les mesures RÉELLES, point par point (aucun lissage, aucun suréchantillonnage, aucune interpolation entre deux mesures séparées par un trou).
import { MEASURE_KINDS, type Measure, type MeasureKind } from "./measures";

export interface Win { t0: number; t1: number }
/** Plus petite fenêtre affichable : 3 h (≈ 3 points pour une mesure horaire, 6 pour une mesure toutes les 30 min). */
export const MIN_SPAN_SEC = 3 * 3600;

/** Ramène la fenêtre dans `full` en conservant sa durée (bornée à [MIN_SPAN_SEC, durée totale]). */
export function clampWin(w: Win, full: Win): Win {
  const fullSpan = Math.max(1, full.t1 - full.t0);
  const span = Math.min(fullSpan, Math.max(Math.min(MIN_SPAN_SEC, fullSpan), w.t1 - w.t0));
  let t0 = w.t0;
  if (t0 < full.t0) t0 = full.t0;
  if (t0 + span > full.t1) t0 = full.t1 - span;
  return { t0, t1: t0 + span };
}
/** Zoom autour d'un point de la fenêtre (`frac` ∈ [0,1] : 0 = bord gauche). `factor` < 1 rapproche, > 1 éloigne. Le point sous le curseur reste sous le curseur. */
export function zoomAt(w: Win, full: Win, frac: number, factor: number): Win {
  const f = Math.min(1, Math.max(0, frac)), span = w.t1 - w.t0;
  const anchor = w.t0 + f * span, next = span * factor;
  return clampWin({ t0: anchor - f * next, t1: anchor - f * next + next }, full);
}
/** Déplacement de `dt` secondes (positif = vers le futur), borné à la plage totale. */
export function panBy(w: Win, full: Win, dt: number): Win {
  return clampWin({ t0: w.t0 + dt, t1: w.t1 + dt }, full);
}
/** Dernières `hours` heures de la plage totale. */
export function lastHours(full: Win, hours: number): Win {
  return clampWin({ t0: full.t1 - hours * 3600, t1: full.t1 }, full);
}
export const sameWin = (a: Win, b: Win) => Math.abs(a.t0 - b.t0) < 1 && Math.abs(a.t1 - b.t1) < 1;

/** Plage totale des mesures (secondes) avec une petite marge de lecture ; null si aucune mesure. */
export function fullWindow(measures: Measure[]): Win | null {
  if (measures.length === 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (const m of measures) { if (m.t < lo) lo = m.t; if (m.t > hi) hi = m.t; }
  const pad = Math.max(600, (hi - lo) * 0.01);
  return { t0: lo - pad, t1: hi + pad };
}

export interface Pt { t: number; v: number }
/** Série (ordre chronologique) d'UNE grandeur, valeurs réelles (dans l'unité stockée : dixièmes pour temp/hum). */
export function seriesOf(measures: Measure[], kind: MeasureKind): Pt[] {
  const out: Pt[] = [];
  for (const m of measures) { const v = m.v[kind]; if (v !== undefined) out.push({ t: m.t, v }); }
  return out.sort((a, b) => a.t - b.t);
}
/** Écart typique entre deux mesures (médiane, secondes) ; 3600 par défaut. */
export function medianStep(points: Pt[]): number {
  if (points.length < 2) return 3600;
  const d: number[] = [];
  for (let i = 1; i < points.length; i++) d.push(points[i].t - points[i - 1].t);
  d.sort((a, b) => a - b);
  return Math.max(60, d[(d.length - 1) >> 1]);
}
/** Découpe en tronçons continus : on ne relie jamais deux mesures séparées par plus de 2,5 écarts typiques (un trou reste un trou). */
export function segments(points: Pt[], step = medianStep(points)): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of points) {
    if (cur.length && p.t - cur[cur.length - 1].t > step * 2.5) { out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}
/** Points dans la fenêtre, plus un voisin de chaque côté pour que la courbe sorte proprement du cadre. */
export function visiblePoints(points: Pt[], w: Win): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.t >= w.t0 && p.t <= w.t1) { if (!out.length && i > 0) out.push(points[i - 1]); out.push(p); }
    else if (out.length && p.t > w.t1) { out.push(p); break; }
  }
  return out;
}

/** Étendue minimale de l'axe des valeurs (en unités AFFICHÉES) : évite qu'un capteur très stable ressemble à une montagne russe. */
const MIN_SPAN_DISPLAY: Partial<Record<MeasureKind, number>> = { temp: 2, hum: 6, vocidx: 60, rssi: 10, lat: 200, dl: 20 };
export interface ValueAxis { lo: number; hi: number; ticks: number[] }
/** Axe « propre » en unités affichées pour des valeurs stockées (`stored`). L'indice d'air part toujours de 0 pour garder ses niveaux lisibles. */
export function valueAxis(kind: MeasureKind, stored: number[]): ValueAxis | null {
  if (stored.length === 0) return null;
  const sc = MEASURE_KINDS[kind].scale;
  let lo = Math.min(...stored) / sc, hi = Math.max(...stored) / sc;
  if (kind === "vocidx") { lo = 0; hi = Math.max(hi, 200); }
  const minSpan = MIN_SPAN_DISPLAY[kind] ?? 1;
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const pad = (hi - lo) * 0.08;
  if (kind !== "vocidx") lo -= pad;
  hi += pad;
  const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  const aLo = Math.floor(lo / step) * step, aHi = Math.ceil(hi / step) * step, ticks: number[] = [];
  for (let v = aLo; v <= aHi + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo: aLo, hi: aHi, ticks };
}

// ── Amplitude du jour (vue « Amplitude ») ─────────────────────────────────────────────────────────────────────────────────
export interface DayBand { start: number; end: number; min: number; max: number; avg: number; n: number }
/** Min / max / moyenne de chaque jour LOCAL (décalage `tzMin` en minutes) qui porte au moins une mesure. Valeurs réelles, jamais interpolées ; un jour sans mesure n'a pas de bande. */
export function dailyBands(points: Pt[], tzMin = 0): DayBand[] {
  const off = tzMin * 60, byDay = new Map<number, { min: number; max: number; sum: number; n: number }>();
  for (const p of points) {
    const d = Math.floor((p.t + off) / 86400), b = byDay.get(d);
    if (!b) byDay.set(d, { min: p.v, max: p.v, sum: p.v, n: 1 });
    else { if (p.v < b.min) b.min = p.v; if (p.v > b.max) b.max = p.v; b.sum += p.v; b.n++; }
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, b]) => ({ start: d * 86400 - off, end: (d + 1) * 86400 - off, min: b.min, max: b.max, avg: Math.round(b.sum / b.n), n: b.n }));
}
