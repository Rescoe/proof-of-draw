// lib/chartCompose.ts — COMPOSITION des courbes de mesures (03/11/2026) : quelles grandeurs vont ensemble, sur quels axes, avec quelle représentation. Fonctions PURES (aucun DOM, aucune requête, aucune horloge) ;
// testées dans tests/chartCompose.test.ts. Tout est calculé sur le tableau DÉJÀ chargé (une seule lecture d'historique) : changer de composition, de représentation ou d'échelle ne touche jamais le réseau.
import { MEASURE_KINDS, type Measure, type MeasureKind } from "./measures";
import { bucketBands, medianStep, seriesOf, type DayBand, type Pt } from "./chartView";

// ── Grandeurs et compositions ───────────────────────────────────────────────────────────────────────────────────────────────
/** Grandeurs proposables : celles qui ont des mesures ; le brut du SGP40 (`voc`) n'est jamais proposé. */
export const selectableKinds = (kinds: MeasureKind[], measures: Measure[]): MeasureKind[] => kinds.filter((k) => k !== "voc" && measures.some((m) => m.v[k] !== undefined));

export interface Preset { id: "env" | "air" | "link"; label: string; kinds: MeasureKind[] }
export const PRESETS: Preset[] = [
  { id: "env", label: "Environnement", kinds: ["temp", "hum"] },
  { id: "air", label: "Air", kinds: ["temp", "hum", "vocidx"] },
  { id: "link", label: "Connexion", kinds: ["rssi", "lat", "dl"] },
];
/** Composition prête à l'emploi réduite aux grandeurs disponibles ; vide si le raccourci n'a aucun sens pour cet appareil (moins de la moitié de ses grandeurs). */
export function presetKinds(p: Preset, available: MeasureKind[]): MeasureKind[] {
  const ks = p.kinds.filter((k) => available.includes(k));
  return ks.length >= Math.min(2, p.kinds.length) || (ks.length === 1 && p.kinds.length === 1) ? ks : [];
}
/** Composition par défaut : température + humidité si disponibles, sinon la première grandeur environnementale, sinon la première grandeur. */
export function defaultSelection(available: MeasureKind[]): MeasureKind[] {
  const th = (["temp", "hum"] as MeasureKind[]).filter((k) => available.includes(k));
  if (th.length) return th;
  const env = (["vocidx"] as MeasureKind[]).filter((k) => available.includes(k));
  return env.length ? env : available.slice(0, 1);
}

// ── Plan d'affichage : fusion ou petits graphiques synchronisés ─────────────────────────────────────────────────────────────
export type Layout = "none" | "single" | "merged" | "multiples";
export interface Plan { layout: Layout; /** un tableau par graphique : 1 grandeur (axe gauche) ou 2 (gauche puis droite) */ charts: MeasureKind[][] }
/** 0 grandeur : rien ; 1 : graphique simple ; 2 : graphique fusionné à deux axes (gauche, droite) ; 3 et plus : petits graphiques synchronisés (jamais de troisième axe ni de superposition illisible). */
export function planCharts(selected: MeasureKind[]): Plan {
  const ks = [...new Set(selected)];
  if (ks.length === 0) return { layout: "none", charts: [] };
  if (ks.length === 1) return { layout: "single", charts: [[ks[0]]] };
  if (ks.length === 2) return { layout: "merged", charts: [[ks[0], ks[1]]] };
  return { layout: "multiples", charts: ks.map((k) => [k]) };
}
export type AxisSide = "left" | "right";
/** Côté de l'axe de chaque grandeur d'un graphique : la première à gauche, la seconde à droite ; deux grandeurs de MÊME unité partagent l'axe de gauche. */
export function axisSides(kinds: MeasureKind[]): Record<string, AxisSide> {
  const out: Record<string, AxisSide> = {};
  kinds.forEach((k, i) => { out[k] = i === 0 || MEASURE_KINDS[k].unit === MEASURE_KINDS[kinds[0]].unit ? "left" : "right"; });
  return out;
}

/** Tracé qui ne dépend pas de la seule couleur : trait, marqueur. */
export interface KindStyle { dash: string; marker: "circle" | "square" | "diamond" | "triangle" }
export const KIND_STYLE: Record<MeasureKind, KindStyle> = {
  temp: { dash: "", marker: "circle" },
  hum: { dash: "7 4", marker: "square" },
  vocidx: { dash: "2 4", marker: "diamond" },
  voc: { dash: "2 4", marker: "diamond" },
  rssi: { dash: "", marker: "triangle" },
  lat: { dash: "7 4", marker: "square" },
  dl: { dash: "2 4", marker: "diamond" },
};

// ── Représentations ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Repr = "points" | "trend" | "band" | "both";
export const REPRS: { id: Repr; label: string; hint: string }[] = [
  { id: "points", label: "Mesures", hint: "Les valeurs reçues, reliées sans lissage" },
  { id: "trend", label: "Tendance", hint: "Moyenne par tranche de temps (pas une mesure) ; les mesures restent consultables" },
  { id: "band", label: "Min–max", hint: "Bande du minimum au maximum de chaque tranche, et sa moyenne" },
  { id: "both", label: "Mesures + min–max", hint: "Bande min–max et mesures réelles" },
];
/** Tranche de la bande min–max : l'heure pour une fenêtre d'au plus 36 h (le jour ne donnerait qu'une bande), le jour au-delà. */
export const bandBucketSec = (spanSec: number): number => (spanSec <= 36 * 3600 ? 3600 : 86400);
/** Tranche de la tendance : 1 h jusqu'à 48 h, 6 h jusqu'à 8 jours, 1 jour au-delà. */
export const trendBucketSec = (spanSec: number): number => (spanSec <= 48 * 3600 ? 3600 : spanSec <= 8 * 86400 ? 6 * 3600 : 86400);
export const bucketName = (sec: number): string => (sec === 3600 ? "par heure" : sec === 86400 ? "par jour" : `par tranche de ${sec / 3600} h`);

/** Tendance : moyenne par tranche, posée au milieu de la tranche (valeurs entières comme le stockage). Un trou reste un trou : la tranche absente n'est pas comblée. */
export function trendOf(points: Pt[], bucketSec: number, tzMin = 0): Pt[] {
  return bucketBands(points, bucketSec, tzMin).map((b) => ({ t: Math.round((b.start + b.end) / 2), v: b.avg }));
}
export type { DayBand };

/** Réduit le nombre de points POUR LE RENDU seulement : par paquet, on garde le premier, le dernier, le minimum et le maximum (dans l'ordre du temps). Appliquer segment par segment pour préserver les ruptures. */
export function decimate(points: Pt[], maxPts: number): Pt[] {
  if (points.length <= maxPts || maxPts < 8) return points;
  const per = Math.ceil(points.length / Math.floor(maxPts / 4)), out: Pt[] = [];
  for (let i = 0; i < points.length; i += per) {
    const chunk = points.slice(i, i + per);
    let lo = chunk[0], hi = chunk[0];
    for (const p of chunk) { if (p.v < lo.v) lo = p; if (p.v > hi.v) hi = p; }
    const keep = new Set([chunk[0], chunk[chunk.length - 1], lo, hi]);
    out.push(...[...keep].sort((a, b) => a.t - b.t));
  }
  return out;
}

// ── Résumé de la période et sélection ───────────────────────────────────────────────────────────────────────────────────────
export type Dir = "up" | "down" | "stable";
export interface KindSummary { kind: MeasureKind; n: number; last: Pt | null; min: number | null; avg: number | null; max: number | null; dir: Dir | null }
/** Écart (valeur stockée) à partir duquel la tendance courte n'est plus « stable ». */
const DIR_THRESHOLD: Partial<Record<MeasureKind, number>> = { temp: 5, hum: 30, vocidx: 8, rssi: 4, lat: 100, dl: 10 };
/** Tendance courte : moyenne du dernier quart contre le reste (au moins 8 mesures) ; null si trop peu de mesures. */
export function shortTrend(kind: MeasureKind, points: Pt[]): Dir | null {
  if (points.length < 8) return null;
  const cut = Math.floor(points.length * 0.75), mean = (a: Pt[]) => a.reduce((x, p) => x + p.v, 0) / a.length;
  const d = mean(points.slice(cut)) - mean(points.slice(0, cut)), th = DIR_THRESHOLD[kind] ?? 1;
  return d >= th ? "up" : d <= -th ? "down" : "stable";
}
export function summarizeKind(measures: Measure[], kind: MeasureKind): KindSummary {
  const pts = seriesOf(measures, kind);
  if (pts.length === 0) return { kind, n: 0, last: null, min: null, avg: null, max: null, dir: null };
  let min = Infinity, max = -Infinity, sum = 0;
  for (const p of pts) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; sum += p.v; }
  return { kind, n: pts.length, last: pts[pts.length - 1], min, avg: Math.round(sum / pts.length), max, dir: shortTrend(kind, pts) };
}

export interface ValueAt { kind: MeasureKind; /** valeur à cet instant, ou null s'il n'y a AUCUNE mesure de cette grandeur assez près */ value: number | null; t: number | null }
/** Pour chaque grandeur, la mesure la plus proche de `t`, seulement si elle est à moins d'un écart et demi (au moins 30 min) ; sinon null (« aucune mesure à cet instant »). Jamais d'interpolation. */
export function valuesAt(measures: Measure[], kinds: MeasureKind[], t: number): ValueAt[] {
  return kinds.map((kind) => {
    const pts = seriesOf(measures, kind);
    if (pts.length === 0) return { kind, value: null, t: null };
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    const tol = Math.max(medianStep(pts) * 1.5, 1800);
    return Math.abs(best.t - t) <= tol ? { kind, value: best.v, t: best.t } : { kind, value: null, t: null };
  });
}
/** Instant de mesure précédent / suivant parmi les grandeurs affichées (null au bord). */
export function neighborTime(measures: Measure[], kinds: MeasureKind[], t: number | null, dir: -1 | 1): number | null {
  const ts = [...new Set(measures.filter((m) => kinds.some((k) => m.v[k] !== undefined)).map((m) => m.t))].sort((a, b) => a - b);
  if (ts.length === 0) return null;
  if (t === null) return dir === 1 ? ts[0] : ts[ts.length - 1];
  const next = dir === 1 ? ts.find((x) => x > t) : [...ts].reverse().find((x) => x < t);
  return next ?? null;
}
