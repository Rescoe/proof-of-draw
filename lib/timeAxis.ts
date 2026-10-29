// lib/timeAxis.ts — repères de l'axe du temps des courbes de mesures (29/10/2026) : fonctions PURES (aucune horloge, aucun DOM), testées dans tests/timeAxis.test.ts.
// Les repères tombent sur des heures PLEINES / des minuits en heure LOCALE (décalage `tzMin` en minutes, comme `aggregate` de lib/measureViz.ts) ; un décalage constant suffit
// ici : le tracé web couvre au plus 31 jours et un changement d'heure ne déplace un repère que d'une heure sur son jour.

export interface AxisTick { t: number; label: string; major: boolean }

/** Pas candidats, en secondes : le plus petit qui donne au plus `maxTicks` repères est retenu. */
const STEPS = [3600, 2 * 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400, 7 * 86400, 14 * 86400];

const two = (n: number) => String(n).padStart(2, "0");

/** Pas retenu pour une plage de `spanSec` secondes (0 = plage vide). */
export function axisStep(spanSec: number, maxTicks = 7): number {
  if (!(spanSec > 0)) return 0;
  for (const s of STEPS) if (spanSec / s <= maxTicks) return s;
  return STEPS[STEPS.length - 1];
}

/**
 * Repères sur [t0, t1] (secondes Unix). Pas < 1 jour : « HH h », avec la date « jj/mm » (repère majeur) à chaque minuit ; pas ≥ 1 jour : « jj/mm » (majeur le lundi).
 * Les pas de 7 et 14 jours tombent sur des lundis. Retour vide si la plage est vide.
 */
export function timeAxisTicks(t0: number, t1: number, tzMin = 0, maxTicks = 7): AxisTick[] {
  const span = t1 - t0, step = axisStep(span, maxTicks);
  if (!step || !Number.isFinite(t0) || !Number.isFinite(t1)) return [];
  const off = tzMin * 60;
  // jour 0 = jeudi 01/01/1970 ; le lundi est donc le jour 4 modulo 7
  const align = step >= 7 * 86400 ? 4 * 86400 : 0;
  const out: AxisTick[] = [];
  let u = Math.ceil((t0 + off - align) / step) * step + align;      // temps LOCAL du premier repère
  for (; u - off <= t1; u += step) {
    const d = new Date(u * 1000);                                    // lu en UTC : u est déjà décalé
    const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
    const date = `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`;
    if (step < 86400) out.push({ t: u - off, label: midnight ? date : `${two(d.getUTCHours())} h`, major: midnight });
    else out.push({ t: u - off, label: date, major: d.getUTCDay() === 1 });
  }
  return out;
}

/** Index du point le plus proche de l'instant `t` dans une liste TRIÉE par date croissante (−1 si la liste est vide). */
export function nearestPointIndex(times: number[], t: number): number {
  if (times.length === 0) return -1;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; }
  if (lo > 0 && t - times[lo - 1] <= times[lo] - t) return lo - 1;
  return lo;
}
