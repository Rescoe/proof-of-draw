// lib/measureViz.ts — agrégation et visualisations des mesures température / humidité. Fonctions PURES et DÉTERMINISTES (aucun accès réseau, aucun hasard,
// aucune horloge implicite : `endSec` et le fuseau sont des paramètres). Les données brutes ne sont jamais modifiées : on construit seulement des vues.
//
// Trois lectures des MÊMES seaux (buckets) : graphique (courbes), œuvre (un disque par seau), interprétation générative locale (« constellation climatique »).
// Aucune IA : tout est calculé par des règles fixes ; l'architecture reste ouverte (une couche IA future recevrait les mêmes `Bucket[]`).
import type { Measure } from "./measures";

export type VizRange = "day" | "week" | "month";
export interface RangeSpec { id: VizRange; label: string; hours: number; bucketSec: number; buckets: number; unit: "heure" | "jour" }
export const VIZ_RANGES: Record<VizRange, RangeSpec> = {
  day:   { id: "day",   label: "Jour",    hours: 24,  bucketSec: 3600,  buckets: 24, unit: "heure" },
  week:  { id: "week",  label: "Semaine", hours: 168, bucketSec: 86400, buckets: 7,  unit: "jour" },
  month: { id: "month", label: "Mois",    hours: 720, bucketSec: 86400, buckets: 30, unit: "jour" },
};
export const VIZ_RANGE_IDS: VizRange[] = ["day", "week", "month"];

/** Statistiques d'UNE grandeur dans un seau ; valeurs en DIXIÈMES (comme le stockage : 215 = 21,5). */
export interface Stat { avg: number; min: number; max: number; n: number }
export interface Bucket { start: number; end: number; temp: Stat | null; hum: Stat | null; /** nombre de mesures du seau (toutes grandeurs confondues) */ n: number }

/** Fin (exclue) de la dernière période : frontière du prochain seau dans le fuseau demandé (décalage en minutes EST de UTC, ex. 120 pour Paris l'été). */
export function alignEnd(endSec: number, bucketSec: number, tzOffsetMin = 0): number {
  const off = tzOffsetMin * 60;
  return Math.ceil((endSec + off) / bucketSec) * bucketSec - off;
}

function statOf(values: number[]): Stat | null {
  if (values.length === 0) return null;
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  return { avg: Math.round(sum / values.length), min, max, n: values.length };
}

/** Répartit les mesures dans les seaux de la période. Les seaux sans mesure sont CONSERVÉS (n = 0) : un trou reste un trou, jamais comblé ni interpolé. Entrée dans n'importe quel ordre. */
export function aggregate(measures: Measure[], range: VizRange, endSec: number, tzOffsetMin = 0): Bucket[] {
  const spec = VIZ_RANGES[range];
  const end = alignEnd(endSec, spec.bucketSec, tzOffsetMin);
  const first = end - spec.buckets * spec.bucketSec;
  const temps: number[][] = Array.from({ length: spec.buckets }, () => []);
  const hums: number[][] = Array.from({ length: spec.buckets }, () => []);
  const counts: number[] = new Array(spec.buckets).fill(0);
  for (const m of measures) {
    if (m.t < first || m.t >= end) continue;
    const i = Math.floor((m.t - first) / spec.bucketSec);
    let used = false;
    if (m.v.temp !== undefined) { temps[i].push(m.v.temp); used = true; }
    if (m.v.hum !== undefined) { hums[i].push(m.v.hum); used = true; }
    if (used) counts[i]++;
  }
  return temps.map((t, i) => ({ start: first + i * spec.bucketSec, end: first + (i + 1) * spec.bucketSec, temp: statOf(t), hum: statOf(hums[i]), n: counts[i] }));
}

export interface PeriodSummary { count: number; temp: Stat | null; hum: Stat | null }
/** Résumé sur la période entière (moyenne pondérée par mesure, non par seau). */
export function summarizePeriod(measures: Measure[], range: VizRange, endSec: number, tzOffsetMin = 0): PeriodSummary {
  const spec = VIZ_RANGES[range];
  const end = alignEnd(endSec, spec.bucketSec, tzOffsetMin);
  const first = end - spec.buckets * spec.bucketSec;
  const inside = measures.filter((m) => m.t >= first && m.t < end);
  return {
    count: inside.length,
    temp: statOf(inside.filter((m) => m.v.temp !== undefined).map((m) => m.v.temp as number)),
    hum: statOf(inside.filter((m) => m.v.hum !== undefined).map((m) => m.v.hum as number)),
  };
}

export const hasData = (buckets: Bucket[]): boolean => buckets.some((b) => b.n > 0);

// ── Œuvre : un disque par seau ──────────────────────────────────────────────────
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Plage de température (°C) de la palette : fixe, pour que deux journées restent comparables d'une œuvre à l'autre. */
export const ART_TEMP_MIN_C = -5;
export const ART_TEMP_MAX_C = 40;

/** Palette chaud/froid (RGB, interpolation linéaire entre repères) : bleu glacé → cyan → jaune pâle → orange → rouge sombre. Pas de vert : le vert ne dit ni chaud ni froid. */
const TEMP_STOPS: [number, [number, number, number]][] = [
  [-5, [59, 79, 216]], [5, [59, 158, 230]], [14, [143, 211, 200]], [19, [242, 224, 138]], [26, [245, 158, 59]], [33, [229, 80, 47]], [40, [160, 20, 44]],
];
/** Couleur CSS `rgb(r,g,b)` d'une température (dixièmes de °C), bornée à [−5 ; 40] °C. */
export function tempColor(tempTenths: number): string {
  const c = Math.min(ART_TEMP_MAX_C, Math.max(ART_TEMP_MIN_C, tempTenths / 10));
  let i = 0;
  while (i < TEMP_STOPS.length - 2 && c > TEMP_STOPS[i + 1][0]) i++;
  const [t0, a] = TEMP_STOPS[i], [t1, b] = TEMP_STOPS[i + 1];
  const f = clamp01((c - t0) / (t1 - t0));
  return `rgb(${[0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)).join(",")})`;
}

/** PRNG déterministe (mulberry32) : mêmes données → mêmes gouttes, d'un affichage à l'autre. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Drop { angle: number; dist: number; r: number }
export interface DiskSpec {
  empty: boolean;
  /** Couleur CSS de la température (palette chaud/froid) ; null sans température. */
  color: string | null;
  /** Rayon de la partie pleine, 0–1 du rayon du disque (réduit quand l'air est humide). */
  inner: number;
  /** Épaisseur de l'anneau d'humidité, 0–1 du rayon (0 sans humidité). */
  ring: number;
  /** Halo : amplitude min–max de température dans le seau, 0–1. */
  halo: number;
  /** Gouttes (texture d'humidité), positions dans l'anneau. */
  drops: Drop[];
}

/** Spécification graphique d'un disque. Température → couleur ; humidité → épaisseur de l'anneau + nombre de gouttes ; amplitude → halo. Aucune valeur inventée : seau vide → disque vide. */
export function diskSpec(b: Bucket): DiskSpec {
  if (b.n === 0 || (!b.temp && !b.hum)) return { empty: true, color: null, inner: 0, ring: 0, halo: 0, drops: [] };
  const hum01 = b.hum ? clamp01(b.hum.avg / 1000) : 0;
  const ring = b.hum ? 0.1 + 0.4 * hum01 : 0;
  const rnd = seeded(b.start ^ 0x9e3779b9);
  const nDrops = b.hum ? Math.round(hum01 * 14) : 0;
  const drops: Drop[] = [];
  for (let i = 0; i < nDrops; i++) drops.push({ angle: rnd() * Math.PI * 2, dist: 1 - ring + rnd() * ring, r: 0.025 + rnd() * 0.04 });
  return {
    empty: false,
    color: b.temp ? tempColor(b.temp.avg) : null,
    inner: 1 - ring,
    ring,
    halo: b.temp ? clamp01((b.temp.max - b.temp.min) / 10 / 15) : 0,
    drops,
  };
}

/** Grille des disques : 24 h en 12×2, 7 jours sur une ligne, 30 jours en 10×3. */
export function diskGrid(range: VizRange): { cols: number; rows: number } {
  return range === "day" ? { cols: 12, rows: 2 } : range === "week" ? { cols: 7, rows: 1 } : { cols: 10, rows: 3 };
}

// ── Interprétation générative locale : « constellation climatique » ─────────────
export interface Star { x: number; y: number; r: number; bucket: number; color: string }
export interface Constellation { stars: Star[]; links: [number, number][]; word: string }

const bandTemp = (c: number) => (c < 8 ? "froid" : c < 16 ? "frais" : c < 24 ? "tempéré" : c < 30 ? "chaud" : "très chaud");
const bandHum = (h: number) => (h < 30 ? "sec" : h < 55 ? "à l'aise" : h < 75 ? "humide" : "très humide");
/** Étiquette lisible obtenue par règles fixes (pas de modèle) ; null s'il n'y a ni température ni humidité. */
export function climateWord(avgTemp: number | null, avgHum: number | null): string | null {
  if (avgTemp === null && avgHum === null) return null;
  if (avgTemp === null) return `air ${bandHum((avgHum as number) / 10)}`;
  if (avgHum === null) return `temps ${bandTemp(avgTemp / 10)}`;
  return `temps ${bandTemp(avgTemp / 10)} et air ${bandHum(avgHum / 10)}`;
}

/** Une étoile par seau qui porte température ET humidité : x = température, y = humidité (haut = humide), taille = nombre de mesures. Reliées dans l'ordre du temps. Coordonnées 0–1 normalisées sur les valeurs présentes. */
export function constellation(buckets: Bucket[]): Constellation {
  const pts = buckets.map((b, i) => ({ b, i })).filter(({ b }) => b.temp && b.hum);
  const word = climateWord(avgOf(buckets, "temp"), avgOf(buckets, "hum")) ?? "";
  if (pts.length === 0) return { stars: [], links: [], word };
  const tv = pts.map(({ b }) => (b.temp as Stat).avg), hv = pts.map(({ b }) => (b.hum as Stat).avg);
  const tLo = Math.min(...tv), tHi = Math.max(...tv), hLo = Math.min(...hv), hHi = Math.max(...hv);
  const norm = (v: number, lo: number, hi: number) => (hi === lo ? 0.5 : (v - lo) / (hi - lo));
  const maxN = Math.max(...pts.map(({ b }) => b.n));
  const stars: Star[] = pts.map(({ b, i }) => ({
    x: 0.08 + 0.84 * norm((b.temp as Stat).avg, tLo, tHi),
    y: 0.92 - 0.84 * norm((b.hum as Stat).avg, hLo, hHi),
    r: 0.006 + 0.012 * (b.n / maxN),
    bucket: i,
    color: tempColor((b.temp as Stat).avg),
  }));
  const links: [number, number][] = [];
  for (let k = 1; k < stars.length; k++) links.push([k - 1, k]);
  return { stars, links, word };
}

/** Moyenne (dixièmes) d'une grandeur sur les seaux, pondérée par le nombre de mesures ; null si aucune. */
export function avgOf(buckets: Bucket[], kind: "temp" | "hum"): number | null {
  let sum = 0, n = 0;
  for (const b of buckets) { const s = b[kind]; if (s) { sum += s.avg * s.n; n += s.n; } }
  return n === 0 ? null : Math.round(sum / n);
}

// ── Graphique ───────────────────────────────────────────────────────────────────
export interface AxisScale { lo: number; hi: number; ticks: number[] }
/** Échelle « propre » (unités réelles, pas les dixièmes) englobant les valeurs ; marge d'au moins 1 unité. */
export function niceScale(valuesTenths: number[], minSpan = 4): AxisScale | null {
  if (valuesTenths.length === 0) return null;
  const lo0 = Math.min(...valuesTenths) / 10, hi0 = Math.max(...valuesTenths) / 10;
  const span = Math.max(minSpan, hi0 - lo0);
  const step = span <= 6 ? 1 : span <= 14 ? 2 : span <= 35 ? 5 : 10;
  const mid = (lo0 + hi0) / 2;
  const lo = Math.floor((mid - span / 2 - 0.5) / step) * step, hi = Math.ceil((mid + span / 2 + 0.5) / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

/** Index du seau le plus proche d'une abscisse normalisée (0–1) : sert au survol (souris ou doigt). */
export function nearestBucket(fraction: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor(clamp01(fraction) * count)));
}

/** Libellé d'un seau : « 14 h » + date en vue jour, « lun. 12/10 » en vues semaine / mois. */
export function bucketLabel(b: Bucket, range: VizRange, tzOffsetMin = 0): string {
  const d = new Date((b.start + tzOffsetMin * 60) * 1000);   // décalé puis lu en UTC : pas de dépendance au fuseau de la machine
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (range === "day") return `${dd}/${mm} ${String(d.getUTCHours()).padStart(2, "0")} h`;
  const days = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  return `${days[d.getUTCDay()]} ${dd}/${mm}`;
}
