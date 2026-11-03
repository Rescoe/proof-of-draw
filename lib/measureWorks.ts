// lib/measureWorks.ts — géométrie PURE des « Œuvres » de mesures autres que la Chronique (03/11/2026) : Trajectoire climatique (température × humidité reliées dans le temps) et Empreinte (rosace jours × heures).
// Déterministe, sans hasard ni horloge ; testé dans tests/measureWorks.test.ts. Aucune valeur inventée : une mesure sans température ET humidité n'a pas de point ; un trou coupe le trait.
import { medianStep, valueAxis, type Pt, type ValueAxis } from "./chartView";
import type { Measure } from "./measures";

export interface TrajPoint { t: number; /** dixièmes de °C */ temp: number; /** dixièmes de % */ hum: number; /** 0 (plus ancien) .. 1 (plus récent) */ age: number }
export interface Trajectory { points: TrajPoint[]; /** indices où le trait est coupé (un trou précède le point) */ breaks: number[]; tempAxis: ValueAxis | null; humAxis: ValueAxis | null }

/** Un point par mesure qui porte température ET humidité, dans l'ordre du temps ; le trait est coupé après un silence de plus de 2,5 écarts typiques. */
export function trajectoryOf(measures: Measure[]): Trajectory {
  const ms = measures.filter((m) => m.v.temp !== undefined && m.v.hum !== undefined).sort((a, b) => a.t - b.t);
  if (ms.length === 0) return { points: [], breaks: [], tempAxis: null, humAxis: null };
  const step = medianStep(ms.map((m) => ({ t: m.t, v: 0 }) as Pt)), t0 = ms[0].t, span = Math.max(1, ms[ms.length - 1].t - t0);
  const points: TrajPoint[] = ms.map((m) => ({ t: m.t, temp: m.v.temp as number, hum: m.v.hum as number, age: (m.t - t0) / span }));
  const breaks: number[] = [];
  for (let i = 1; i < points.length; i++) if (points[i].t - points[i - 1].t > step * 2.5) breaks.push(i);
  return { points, breaks, tempAxis: valueAxis("temp", points.map((p) => p.temp)), humAxis: valueAxis("hum", points.map((p) => p.hum)) };
}

/** Secteur annulaire SVG (angles en radians, 0 = haut, sens horaire) : cellule de l'Empreinte. */
export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}
