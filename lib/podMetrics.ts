// lib/podMetrics.ts — « pod-metrics-2 » : métriques de complexité visuelle en CALCUL ENTIER, déterministes et calculables EN FLUX (sans tampon d'image).
//
// Pourquoi : jusqu'ici le vote des ESP recopiait le score du serveur (docs/CHANTIER_VALIDATION_REELLE.md, F1). Pour qu'un appareil puisse recalculer
// lui-même, il faut des métriques qui donnent LE MÊME RÉSULTAT AU PPM PRÈS sur Node, ESP8266 et R4 : pas de `float`, pas de `log2` à l'exécution.
//
// Spécification (miroir exact : esp8266/_shared/pod_metrics.h)
//   • image = grille w × h de pixels « actifs » (1) / « fond » (0), lue ligne par ligne, gauche → droite (géométrie FIGÉE par écran, voir `screenGrid`) ;
//   • n = w·h ; ones = pixels actifs ; runs = 1 + nombre de changements de valeur dans l'ordre de lecture (franchissement de fin de ligne compris) ;
//     T = nombre de paires voisines différentes (horizontales + verticales) ; total = (w−1)·h + w·(h−1) ;
//   • e = ENTROPY_TABLE[ floor((1024·ones + n/2) / n) ]                          (ppm de bit)
//   • t = floor((10⁶·T + total/2) / total)                                       (ppm)
//   • r = isqrt( floor((10¹²·runs + n/2) / n) )                                  (ppm)
//   • s = min(10⁶, floor((4e + 4t + 2r) / 10))                                   (ppm) — mêmes poids que la V1 (40 / 40 / 20 %)
//
// Corrige deux défauts de la V1 (lib/crypto.ts), qui reste en place pour les blocs existants (`metricsVersion` absent = 1) :
//   1. e-ink 2,9″ BWR : la V1 fusionnait noir et rouge par OU des bits bruts (1 = blanc) → le pixel n'était « actif » que s'il était noir ET rouge :
//      TOUT dessin obtenait entropie 0, transitions 0, score ≈ 0,001. En V2, actif = noir OU rouge (bit 0 dans l'un des deux canaux).
//   2. Géométrie : tampon pilote 128 × 296 (et non 296 × 128), OLED en pages (et non ligne par ligne).

import { ENTROPY_TABLE } from "@/lib/podMetricsTable";

export const METRICS_VERSION = 2;
export const PPM = 1_000_000;

export interface PodMetricsV2 { e: number; t: number; r: number; s: number }
export interface PodMetricsDetail extends PodMetricsV2 { n: number; ones: number; runs: number; transitions: number }

/** Racine carrée entière (plancher) d'un entier ≤ 10¹² : exacte, sans flottant dans le résultat. */
export function isqrt(v: number): number {
  if (v < 2) return v;
  let x = Math.floor(Math.sqrt(v));
  while (x * x > v) x--;
  while ((x + 1) * (x + 1) <= v) x++;
  return x;
}

/** Division entière arrondie : floor((a + b/2) / b), pour des entiers exacts en double (< 2⁵³). */
const divRound = (a: number, b: number) => Math.floor((a + Math.floor(b / 2)) / b);

/** Accumulateur en flux : `push(0|1)` pour chaque pixel dans l'ordre de lecture, puis `finish()`. Mémoire : une ligne. */
export class MetricsAccumulator {
  private readonly row: Uint8Array;
  private x = 0;
  private y = 0;
  private last = 0;
  private ones = 0;
  private runs = 1;
  private trans = 0;
  private count = 0;

  constructor(readonly w: number, readonly h: number) {
    if (!(w > 0 && h > 0)) throw new Error("dimensions invalides");
    this.row = new Uint8Array(w);
  }

  push(a: number): void {
    const v = a ? 1 : 0;
    this.ones += v;
    if (this.count > 0 && v !== this.last) this.runs++;
    if (this.x > 0 && v !== this.last) this.trans++;
    if (this.y > 0 && v !== this.row[this.x]) this.trans++;
    this.row[this.x] = v;
    this.last = v;
    this.count++;
    if (++this.x === this.w) { this.x = 0; this.y++; }
  }

  finish(): PodMetricsDetail {
    const n = this.w * this.h;
    if (this.count !== n) throw new Error(`pixels reçus ${this.count} ≠ attendus ${n}`);
    const total = (this.w - 1) * this.h + this.w * (this.h - 1);
    const q = divRound(1024 * this.ones, n);
    const e = ENTROPY_TABLE[q];
    const t = total > 0 ? divRound(PPM * this.trans, total) : 0;
    // 10¹²·runs peut dépasser 2⁵³ (TFT 2,8″) : division exacte en BigInt ; le quotient (≤ 10¹²) est ensuite exact en double.
    const rq = Number((BigInt(PPM) * BigInt(PPM) * BigInt(this.runs) + BigInt(Math.floor(n / 2))) / BigInt(n));
    const r = isqrt(rq);
    const s = Math.min(PPM, Math.floor((4 * e + 4 * t + 2 * r) / 10));
    return { e, t, r, s, n, ones: this.ones, runs: this.runs, transitions: this.trans };
  }
}

// ─── Géométrie et lecture par écran (FIGÉES : toute modification = nouvelle version) ───────────────────────────────────────────────────────────

export type PodScreen = "oled096" | "eink27bw" | "eink29bwr" | "tft18" | "tft28";
export const POD_SCREENS: readonly PodScreen[] = ["oled096", "eink27bw", "eink29bwr", "tft18", "tft28"];

/** Dimensions de la grille de métriques (= tampon pilote) et taille en octets du contenu brut. */
export const METRIC_GRID: Record<PodScreen, { w: number; h: number; rawBytes: number }> = {
  oled096:   { w: 128, h: 64,  rawBytes: 1024 },
  eink27bw:  { w: 176, h: 264, rawBytes: 5808 },
  eink29bwr: { w: 128, h: 296, rawBytes: 9472 },   // 4 736 (noir) + 4 736 (rouge)
  tft18:     { w: 128, h: 160, rawBytes: 40960 },
  tft28:     { w: 240, h: 320, rawBytes: 153600 },
};

export const isPodScreen = (s: string): s is PodScreen => (POD_SCREENS as readonly string[]).includes(s);

/** Contenu brut dans l'ordre canonique : tampon unique, ou noir ‖ rouge pour l'e-ink 2,9″. */
export function rawContent(screen: PodScreen, p: { buffer?: string; black?: string; red?: string }): Uint8Array {
  const dec = (b64: string | undefined) => new Uint8Array(Buffer.from(b64 ?? "", "base64"));
  const bytes = screen === "eink29bwr" ? Buffer.concat([dec(p.black), dec(p.red)]) : Buffer.from(dec(p.buffer));
  const expected = METRIC_GRID[screen].rawBytes;
  if (bytes.length !== expected) throw new Error(`${screen} : ${bytes.length} octets reçus, ${expected} attendus`);
  return new Uint8Array(bytes);
}

/** Pixel « actif » (1) ou fond (0), pour les contenus bruts de rawContent(). */
export function* activeBits(screen: PodScreen, raw: Uint8Array): Generator<number> {
  const { w, h } = METRIC_GRID[screen];
  if (raw.length !== METRIC_GRID[screen].rawBytes) throw new Error("taille de contenu invalide");
  if (screen === "eink29bwr") {
    const half = raw.length / 2;
    for (let i = 0; i < w * h; i++) {
      const sh = 7 - (i & 7);
      const blackBit = (raw[i >> 3] >> sh) & 1, redBit = (raw[half + (i >> 3)] >> sh) & 1;
      yield blackBit === 0 || redBit === 0 ? 1 : 0;   // 0 = coloré (noir ou rouge) ; 0xFF = blanc
    }
  } else if (screen === "eink27bw") {
    for (let i = 0; i < w * h; i++) yield ((raw[i >> 3] >> (7 - (i & 7))) & 1) === 0 ? 1 : 0;
  } else if (screen === "oled096") {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) yield (raw[(y >> 3) * w + x] >> (y & 7)) & 1;
  } else {
    for (let i = 0; i < w * h; i++) yield (raw[2 * i] | (raw[2 * i + 1] << 8)) !== 0xffff ? 1 : 0;   // RGB565 petit-boutiste, blanc pur = fond
  }
}

export function metricsFromRaw(screen: PodScreen, raw: Uint8Array): PodMetricsDetail {
  const { w, h } = METRIC_GRID[screen];
  const acc = new MetricsAccumulator(w, h);
  for (const bit of activeBits(screen, raw)) acc.push(bit);
  return acc.finish();
}

export function metricsFromPayload(screen: PodScreen, p: { buffer?: string; black?: string; red?: string }): PodMetricsDetail {
  return metricsFromRaw(screen, rawContent(screen, p));
}
