// lib/measureArt.ts — ŒUVRE EN BULLES des mesures (02/11/2026, refonte). Fonctions PURES et DÉTERMINISTES (aucun hasard, aucune horloge) ; testées dans tests/measureArt.test.ts.
// Remplace le disque-par-seau de lib/measureViz.ts (archivé : archive/2026-11-02_vue-capteurs-v1). Principe retenu de l'ancienne œuvre : une bulle par instant, la couleur dit le chaud et le froid.
//
// RÈGLE : chaque élément visuel encode UNE donnée réelle, et la légende le dit. Rien n'est tiré au sort.
//   • UNE bulle PAR MESURE reçue (pas par heure ni par jour) : l'œuvre est plus grande et plus riche quand il y a plus de données (largeur ∝ nombre de mesures).
//   • position horizontale = le temps (un trou dans les données reste un trou, plafonné à GAP_CAP_SLOTS pour ne pas étirer l'œuvre) ;
//   • position verticale = la température (haut = chaud), normalisée sur la plage de la période ;
//   • taille de la bulle = l'humidité (plus l'air est humide, plus la bulle est grande) ;
//   • couleur = la température (palette chaud/froid fixe, comparable d'une œuvre à l'autre) ;
//   • halo = l'indice de qualité d'air (Sensirion). Pas de halo tant que l'air est « habituel » (indice ≤ 100) ; au-delà, un halo violet de plus en plus large et opaque (la couleur est un événement rare) ;
//   • petites bulles satellites = la VARIATION de température depuis la mesure précédente : une petite bulle par demi-degré (5 au plus), au-dessus si ça se réchauffe, en dessous si ça se refroidit.
// Une grandeur absente (ou privée, donc absente de la réponse publique) n'est pas inventée : sans humidité, taille neutre ; sans température, ligne médiane ; sans air, pas de halo.
import type { Measure } from "./measures";

export const SLOT_PX = 22;            // largeur d'un « emplacement » (une mesure à l'écart typique)
export const ART_HEIGHT = 300;
export const GAP_CAP_SLOTS = 6;       // un trou plus long n'allonge pas l'œuvre au-delà de 6 emplacements
export const SAT_STEP_TENTHS = 5;     // une petite bulle par 0,5 °C de variation
export const SAT_MAX = 5;
export const HALO_FROM_INDEX = 100;   // en dessous : air habituel, pas de halo

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export interface Bubble {
  t: number;
  /** abscisse en emplacements (0 = première mesure) */
  slot: number;
  /** 0 (bas) .. 1 (haut) — température normalisée ; 0,5 sans température */
  y: number;
  /** rayon relatif 0..1 (humidité) ; 0,5 sans humidité */
  size: number;
  /** température en dixièmes de °C, ou null */
  temp: number | null;
  hum: number | null;
  air: number | null;
  /** halo 0..1 (0 = aucun) */
  halo: number;
  /** petites bulles : nombre signé (+ = se réchauffe, − = se refroidit) ; 0 = aucune */
  sat: number;
  /** variation de température depuis la mesure précédente (dixièmes), null sans mesure précédente */
  delta: number | null;
}
export interface Artwork { bubbles: Bubble[]; slots: number; widthPx: number; step: number; tempLo: number | null; tempHi: number | null }

/** Écart typique (médiane, secondes) entre deux mesures consécutives ; 3600 si moins de deux. */
export function typicalStep(ts: number[]): number {
  if (ts.length < 2) return 3600;
  const d: number[] = [];
  for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  d.sort((a, b) => a - b);
  return Math.max(60, d[(d.length - 1) >> 1]);
}

/** Nombre de petites bulles (signé) pour une variation en dixièmes de °C. */
export function satellitesFor(deltaTenths: number | null): number {
  if (deltaTenths === null) return 0;
  const n = Math.min(SAT_MAX, Math.floor(Math.abs(deltaTenths) / SAT_STEP_TENTHS));
  return deltaTenths < 0 ? -n : n;
}
/** Halo 0..1 pour un indice d'air : 0 jusqu'à 100, 1 à 300 et au-delà. */
export function haloFor(airIndex: number | null): number {
  return airIndex === null ? 0 : clamp01((airIndex - HALO_FROM_INDEX) / 200);
}

/** Construit l'œuvre depuis les mesures (ordre quelconque). Une bulle par mesure qui porte au moins température, humidité ou air. */
export function buildArtwork(measures: Measure[]): Artwork {
  const ms = measures.filter((m) => m.v.temp !== undefined || m.v.hum !== undefined || m.v.vocidx !== undefined).sort((a, b) => a.t - b.t);
  if (ms.length === 0) return { bubbles: [], slots: 0, widthPx: 0, step: 3600, tempLo: null, tempHi: null };
  const step = typicalStep(ms.map((m) => m.t));
  const temps = ms.flatMap((m) => (m.v.temp !== undefined ? [m.v.temp] : []));
  const tempLo = temps.length ? Math.min(...temps) : null, tempHi = temps.length ? Math.max(...temps) : null;
  const span = tempLo !== null && tempHi !== null ? Math.max(30, tempHi - tempLo) : 1;   // au moins 3 °C d'étendue : une journée plate reste plate
  const mid = tempLo !== null && tempHi !== null ? (tempLo + tempHi) / 2 : 0;
  let slot = 0, prevT: number | null = null, prevTemp: number | null = null;
  const bubbles: Bubble[] = [];
  for (const m of ms) {
    if (prevT !== null) slot += Math.min(GAP_CAP_SLOTS, Math.max(0.35, (m.t - prevT) / step));
    const temp = m.v.temp ?? null, hum = m.v.hum ?? null, air = m.v.vocidx ?? null;
    const delta = temp !== null && prevTemp !== null ? temp - prevTemp : null;
    bubbles.push({
      t: m.t, slot,
      y: temp === null ? 0.5 : clamp01(0.5 + (temp - mid) / span),
      size: hum === null ? 0.5 : clamp01(hum / 1000),
      temp, hum, air, halo: haloFor(air), sat: satellitesFor(delta), delta,
    });
    prevT = m.t;
    if (temp !== null) prevTemp = temp;
  }
  return { bubbles, slots: slot + 1, widthPx: Math.round((slot + 2) * SLOT_PX), step, tempLo, tempHi };
}

// ── Palette : « pigments et terres » (palette rabattue de l'artiste, vault Art Génératif/Palettes) — le froid est ardoise, le chaud est terre cuite ; la couleur vive est l'événement rare (air). ──
export type ArtScheme = "paper" | "night";
type RGB = [number, number, number];
const STOPS: Record<ArtScheme, [number, RGB][]> = {
  // papier de riz : pigments soutenus
  paper: [[0, [74, 111, 140]], [10, [91, 140, 168]], [17, [91, 168, 140]], [22, [201, 168, 76]], [28, [192, 100, 43]], [34, [160, 40, 40]]],
  // nuit : mêmes teintes, éclaircies pour tenir sur fond sombre
  night: [[0, [110, 156, 196]], [10, [130, 184, 214]], [17, [120, 204, 170]], [22, [232, 200, 104]], [28, [240, 140, 80]], [34, [236, 90, 80]]],
};
export const ART_SURFACE: Record<ArtScheme, { bg: string; ink: string; muted: string; halo: string; empty: string }> = {
  paper: { bg: "#f2ece0", ink: "#2b2622", muted: "#7a6f62", halo: "#7a5ba8", empty: "#c9bfae" },
  night: { bg: "#0b0d17", ink: "#ececf6", muted: "#8a8da6", halo: "#a98bff", empty: "#2a2d44" },
};
/** Couleur d'une température (dixièmes de °C), bornée à [0 ; 34] °C : plage FIXE pour que deux œuvres restent comparables. */
export function artTempColor(tempTenths: number | null, scheme: ArtScheme): string {
  if (tempTenths === null) return ART_SURFACE[scheme].muted;
  const stops = STOPS[scheme], c = Math.min(34, Math.max(0, tempTenths / 10));
  let i = 0;
  while (i < stops.length - 2 && c > stops[i + 1][0]) i++;
  const [t0, a] = stops[i], [t1, b] = stops[i + 1], f = clamp01((c - t0) / (t1 - t0));
  return `rgb(${[0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)).join(",")})`;
}
/** Rayon d'une bulle en pixels depuis sa taille relative (0..1) : 5 .. 17 px. */
export const bubbleRadius = (size: number): number => 5 + 12 * clamp01(size);
