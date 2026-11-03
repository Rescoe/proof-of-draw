// lib/measureReading.ts — LECTURE des mesures (vue « Interprétation », refonte du 02/11/2026). Fonctions PURES, déterministes, sans IA ni horloge (le fuseau est un paramètre) ; testées dans tests/measureReading.test.ts.
// Remplace la « constellation climatique » (archivée : archive/2026-11-02_vue-capteurs-v1) par deux choses lisibles :
//   1. des CONSTATS en phrases, calculés par règles fixes sur les mesures réelles, chacun relié à son instant (cliquable → courbe zoomée) ;
//   2. une GRILLE JOURS × HEURES (rythme d'une journée) où chaque case est la moyenne des mesures de cette heure, vide s'il n'y en a pas.
import { formatMeasure, type Measure, type MeasureKind } from "./measures";
import { medianStep, seriesOf, type Pt } from "./chartView";

const two = (n: number) => String(n).padStart(2, "0");
const DAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const local = (t: number, tzMin: number) => new Date((t + tzMin * 60) * 1000);   // lu en getUTC* : pas de dépendance au fuseau de la machine
/** « mar. 14 h » (heure locale). */
export function whenLabel(t: number, tzMin = 0): string {
  const d = local(t, tzMin);
  return `${DAYS[d.getUTCDay()]} ${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)} ${d.getUTCMinutes() ? `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}` : `${d.getUTCHours()} h`}`;
}
/** « mardi 03/11/2026 14:05 » complet, pour la valeur exacte d'un point sélectionné. */
export function exactLabel(t: number, tzMin = 0): string {
  const d = local(t, tzMin);
  return `${DAYS[d.getUTCDay()]} ${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} à ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
const durLabel = (sec: number) => (sec >= 86400 ? `${Math.round(sec / 3600 / 24 * 10) / 10} j` : sec >= 3600 ? `${Math.round(sec / 360) / 10} h`.replace(".", ",") : `${Math.round(sec / 60)} min`);

export interface Finding { id: string; kind: MeasureKind | null; t: number | null; text: string }

const extreme = (pts: Pt[], max: boolean) => pts.reduce((a, b) => ((max ? b.v > a.v : b.v < a.v) ? b : a));

/** Constats (au plus ~7), du plus parlant au plus technique. Vide s'il y a moins de 3 mesures. */
export function findings(measures: Measure[], tzMin = 0): Finding[] {
  const out: Finding[] = [];
  const temp = seriesOf(measures, "temp"), hum = seriesOf(measures, "hum"), air = seriesOf(measures, "vocidx");
  if (measures.length < 3) return out;
  if (temp.length >= 3) {
    const hi = extreme(temp, true), lo = extreme(temp, false);
    out.push({ id: "temp-max", kind: "temp", t: hi.t, text: `Le plus chaud : ${formatMeasure("temp", hi.v)}, ${whenLabel(hi.t, tzMin)}.` });
    if (lo.t !== hi.t) out.push({ id: "temp-min", kind: "temp", t: lo.t, text: `Le plus frais : ${formatMeasure("temp", lo.v)}, ${whenLabel(lo.t, tzMin)}.` });
    // plus forte variation entre deux mesures voisines (écart ≤ 2 pas typiques)
    const st = medianStep(temp);
    let best: { a: Pt; b: Pt; d: number } | null = null;
    for (let i = 1; i < temp.length; i++) {
      if (temp[i].t - temp[i - 1].t > st * 2) continue;
      const d = temp[i].v - temp[i - 1].v;
      if (!best || Math.abs(d) > Math.abs(best.d)) best = { a: temp[i - 1], b: temp[i], d };
    }
    if (best && Math.abs(best.d) >= 10) out.push({ id: "temp-jump", kind: "temp", t: best.b.t, text: `Plus forte variation : ${best.d > 0 ? "+" : "−"}${(Math.abs(best.d) / 10).toFixed(1).replace(".", ",")} °C en ${durLabel(best.b.t - best.a.t)}, ${whenLabel(best.b.t, tzMin)}.` });
  }
  if (hum.length >= 3) {
    const hi = extreme(hum, true);
    out.push({ id: "hum-max", kind: "hum", t: hi.t, text: `Air le plus humide : ${formatMeasure("hum", hi.v)}, ${whenLabel(hi.t, tzMin)}.` });
  }
  if (air.length >= 3) {
    const hi = extreme(air, true);
    const over = air.filter((p) => p.v > 150).length;
    out.push({ id: "air-max", kind: "vocidx", t: hi.t, text: `Air le plus chargé : ${formatMeasure("vocidx", hi.v)}, ${whenLabel(hi.t, tzMin)}${over ? ` ; au-dessus de « Modéré » pendant ${over} mesure${over > 1 ? "s" : ""} sur ${air.length}` : " ; jamais au-dessus de « Modéré »"}.` });
  }
  // plus long silence (aucune mesure d'aucune sorte)
  const ts = measures.map((m) => m.t).sort((a, b) => a - b);
  const st = medianStep(ts.map((t) => ({ t, v: 0 })));
  let gap: { a: number; b: number } | null = null;
  for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > st * 2.5 && (!gap || ts[i] - ts[i - 1] > gap.b - gap.a)) gap = { a: ts[i - 1], b: ts[i] };
  if (gap) out.push({ id: "gap", kind: null, t: gap.a, text: `Aucune mesure pendant ${durLabel(gap.b - gap.a)} (du ${whenLabel(gap.a, tzMin)} au ${whenLabel(gap.b, tzMin)}) : la courbe est coupée, rien n'est inventé.` });
  // rythme d'une journée : heure moyenne la plus chaude / la plus fraîche (≥ 2 jours de mesures)
  const days = new Set(temp.map((p) => Math.floor((p.t + tzMin * 60) / 86400)));
  if (days.size >= 2) {
    const g = hourProfile(temp, tzMin);
    const hours = g.map((v, h) => ({ v, h })).filter((x) => x.v !== null) as { v: number; h: number }[];
    if (hours.length >= 6) {
      const hi = hours.reduce((a, b) => (b.v > a.v ? b : a)), lo = hours.reduce((a, b) => (b.v < a.v ? b : a));
      out.push({ id: "rhythm", kind: "temp", t: null, text: `Rythme d'une journée : en moyenne le plus chaud vers ${hi.h} h (${formatMeasure("temp", Math.round(hi.v))}), le plus frais vers ${lo.h} h (${formatMeasure("temp", Math.round(lo.v))}).` });
    }
  }
  return out;
}

/** Moyenne par heure du jour (0..23), null sans mesure. */
export function hourProfile(points: Pt[], tzMin = 0): (number | null)[] {
  const sum = new Array(24).fill(0), n = new Array(24).fill(0);
  for (const p of points) { const h = local(p.t, tzMin).getUTCHours(); sum[h] += p.v; n[h]++; }
  return sum.map((s, h) => (n[h] ? s / n[h] : null));
}

export interface HeatCell { value: number | null; n: number }
export interface HeatRow { dayStart: number; label: string; cells: HeatCell[] }
export interface Heatmap { rows: HeatRow[]; lo: number | null; hi: number | null }
/** Grille jours × heures (jour le plus ancien en haut) des `days` derniers jours LOCAUX se terminant à `endSec`. Moyenne des mesures de chaque heure ; case vide (n = 0) sans mesure. */
export function heatmap(measures: Measure[], kind: MeasureKind, endSec: number, days: number, tzMin = 0): Heatmap {
  const off = tzMin * 60, lastDay = Math.floor((endSec + off) / 86400);
  const rows: HeatRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = (lastDay - i) * 86400 - off, d = local(dayStart, tzMin);
    rows.push({ dayStart, label: `${DAYS[d.getUTCDay()]} ${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`, cells: Array.from({ length: 24 }, () => ({ value: null as number | null, n: 0 })) });
  }
  const first = rows[0].dayStart, sums: number[][] = rows.map(() => new Array(24).fill(0));
  for (const m of measures) {
    const v = m.v[kind];
    if (v === undefined || m.t < first || m.t >= rows[rows.length - 1].dayStart + 86400) continue;
    const r = Math.floor((m.t - first) / 86400), h = local(m.t, tzMin).getUTCHours();
    sums[r][h] += v; rows[r].cells[h].n++;
  }
  let lo: number | null = null, hi: number | null = null;
  rows.forEach((row, r) => row.cells.forEach((c, h) => {
    if (!c.n) return;
    c.value = sums[r][h] / c.n;
    if (lo === null || c.value < lo) lo = c.value;
    if (hi === null || c.value > hi) hi = c.value;
  }));
  return { rows, lo, hi };
}

/** Texte de lecture d'une case (valeur exacte) — pour l'infobulle et la lecture au clavier. */
export function cellText(kind: MeasureKind, row: HeatRow, h: number): string {
  const c = row.cells[h];
  return c.value === null ? `${row.label} ${h} h : aucune mesure` : `${row.label} ${h} h : ${formatMeasure(kind, Math.round(c.value))}${c.n > 1 ? ` (moyenne de ${c.n} mesures)` : ""}`;
}
