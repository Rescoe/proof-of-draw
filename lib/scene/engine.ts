// lib/scene/engine.ts
// MOTEUR DE RÉFÉRENCE UNIQUE de `ana-scene-v1` (contrat note 37 §7) : même code pour
//   1. la preview galerie (navigateur),  2. la poster frame e-ink (serveur),
//   3. les golden vectors comparés byte-for-byte aux firmwares OLED/TFT (tests/fixtures/scene-v1-golden.json).
// Arithmétique ENTIÈRE uniquement, aucune dépendance Node/DOM, aucun accès réseau/Redis : une frame est une fonction
// pure de (scène, largeur, hauteur, tick). Les variantes exactes (conversion pixel, wrap, cercle, traits épais,
// conversions mono/poster) sont figées dans docs/SCENE_V1_MOTEUR.md — les firmwares doivent les reproduire à l'identique.

import type { AnaScene, SceneEntity } from "./spec";
import { motionOffset } from "./validate";

/** Convertit une coordonnée normalisée 0..65535 en pixel : floor(c × (extent − 1) / 65535). */
export function toPixel(c: number, extent: number): number {
  return Math.floor((c * (extent - 1)) / 65535);
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Plot d'un pixel : `wrap` (mouvement linear) fait un tore, sinon rognage aux bords. */
type Plot = (x: number, y: number) => void;

function makePlot(buf: Uint8Array, w: number, h: number, colorIndex: number, wrap: boolean): Plot {
  if (wrap) {
    return (x, y) => { buf[mod(y, h) * w + mod(x, w)] = colorIndex; };
  }
  return (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h) buf[y * w + x] = colorIndex; };
}

/** Carré size×size dont le coin haut-gauche est (x − ⌊size/2⌋, y − ⌊size/2⌋) : size 1 = 1 pixel, 4 = x−2..x+1. */
function stamp(plot: Plot, x: number, y: number, size: number): void {
  const off = size >> 1;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) plot(x - off + i, y - off + j);
}

/** Bresenham entier, tous octants, extrémités incluses ; chaque pixel reçoit un tampon `width`×`width`. */
export function bresenham(x0: number, y0: number, x1: number, y1: number, visit: (x: number, y: number) => void): void {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Cercle « midpoint » entier (rayon en pixels, r ≥ 0) ; plein = spans horizontaux. */
export function midpointCircle(plot: Plot, cx: number, cy: number, r: number, fill: boolean): void {
  const span = (xa: number, xb: number, y: number) => { for (let x = xa; x <= xb; x++) plot(x, y); };
  let x = r, y = 0, d = 1 - r;
  while (x >= y) {
    if (fill) {
      span(cx - x, cx + x, cy + y); span(cx - x, cx + x, cy - y);
      span(cx - y, cx + y, cy + x); span(cx - y, cx + y, cy - x);
    } else {
      plot(cx + x, cy + y); plot(cx - x, cy + y); plot(cx + x, cy - y); plot(cx - x, cy - y);
      plot(cx + y, cy + x); plot(cx - y, cy + x); plot(cx + y, cy - x); plot(cx - y, cy - x);
    }
    y++;
    if (d < 0) d += 2 * y + 1;
    else { x--; d += 2 * (y - x) + 1; }
  }
}

function drawEntity(e: SceneEntity, tick: number, buf: Uint8Array, w: number, h: number): void {
  const wrap = e.motion.type === "linear";
  const off = motionOffset(e.motion, tick);
  // linear : le décalage est ramené dans 0..65535 (tore normalisé) ; les autres mouvements sont bornés par la validation.
  const ox = wrap ? mod(off.x, 65536) : off.x;
  const oy = wrap ? mod(off.y, 65536) : off.y;
  const px = (x: number) => toPixel(x + ox, w);
  const py = (y: number) => toPixel(y + oy, h);
  const plot = makePlot(buf, w, h, e.colorIndex, wrap);
  const g = e.geometry;

  switch (g.type) {
    case "point":
      stamp(plot, px(g.x), py(g.y), g.size);
      return;
    case "line":
      bresenham(px(g.x1), py(g.y1), px(g.x2), py(g.y2), (x, y) => stamp(plot, x, y, g.width));
      return;
    case "rect": {
      const x0 = px(g.x0), x1 = px(g.x1), y0 = py(g.y0), y1 = py(g.y1);
      if (g.fill) {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) plot(x, y);
      } else {
        for (let x = x0; x <= x1; x++) { plot(x, y0); plot(x, y1); }
        for (let y = y0; y <= y1; y++) { plot(x0, y); plot(x1, y); }
      }
      return;
    }
    case "circle": {
      // Rayon mesuré sur le plus petit côté : un cercle reste un cercle sur un écran non carré.
      const rPx = Math.floor((g.r * (Math.min(w, h) - 1)) / 65535);
      midpointCircle(plot, px(g.cx), py(g.cy), rPx, g.fill);
      return;
    }
    case "polyline": {
      const pts = g.points.map((p) => ({ x: px(p.x), y: py(p.y) }));
      const seg = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        bresenham(a.x, a.y, b.x, b.y, (x, y) => stamp(plot, x, y, g.width));
      for (let i = 0; i + 1 < pts.length; i++) seg(pts[i], pts[i + 1]);
      if (g.closed) seg(pts[pts.length - 1], pts[0]);
      return;
    }
  }
}

/** Rend un tick en buffer d'indices de palette (1 octet / pixel, row-major). Ordre des entités = z-order. */
export function renderSceneIndices(scene: AnaScene, width: number, height: number, tick: number): Uint8Array {
  const buf = new Uint8Array(width * height).fill(scene.backgroundIndex);
  for (const e of scene.entities) drawEntity(e, tick, buf, width, height);
  return buf;
}

// ─── Conversions de sortie ────────────────────────────────────────────────────

/** RGB565 little-endian, 2 octets / pixel (même convention que le profil tft18 : 0xFFFF blanc, rouge = 00 F8). */
export function indicesToRgb565LE(idx: Uint8Array, palette: readonly number[]): Uint8Array {
  const out = new Uint8Array(idx.length * 2);
  for (let i = 0; i < idx.length; i++) {
    const c = palette[idx[i]];
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = (c >> 8) & 0xff;
  }
  return out;
}

/** Un pixel est « allumé / encré » s'il diffère du fond : couleur RGB565 ≠ couleur du fond (pas l'index). */
function isLit(idx: Uint8Array, i: number, palette: readonly number[], bg: number): boolean {
  return palette[idx[i]] !== palette[bg];
}

/** OLED SSD1306 : page-major, 1 bit/pixel, bit = 1 → allumé (même convention que encodeOled096). width×height/8 octets. */
export function indicesToOledBuffer(idx: Uint8Array, width: number, height: number, palette: readonly number[], bg: number): Uint8Array {
  const buf = new Uint8Array((width * height) / 8);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isLit(idx, y * width + x, palette, bg)) buf[(y >> 3) * width + x] |= 1 << (y & 7);
    }
  }
  return buf;
}

/** Poster e-ink : gris 8 bits (0 = encre, 255 = blanc) pour encodeForScreen() — l'encre est tout ce qui diffère du fond. */
export function indicesToPosterGray(idx: Uint8Array, palette: readonly number[], bg: number): Uint8Array {
  const g = new Uint8Array(idx.length).fill(255);
  for (let i = 0; i < idx.length; i++) if (isLit(idx, i, palette, bg)) g[i] = 0;
  return g;
}

/** Expansion RGB565 → RGBA 8 bits (aperçu navigateur uniquement ; jamais utilisée pour un hash normatif). */
export function indicesToRgba(idx: Uint8Array, palette: readonly number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(idx.length * 4);
  for (let i = 0; i < idx.length; i++) {
    const c = palette[idx[i]];
    const r5 = c >> 11, g6 = (c >> 5) & 63, b5 = c & 31;
    out[i * 4] = (r5 << 3) | (r5 >> 2);
    out[i * 4 + 1] = (g6 << 2) | (g6 >> 4);
    out[i * 4 + 2] = (b5 << 3) | (b5 >> 2);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Tick de la poster frame e-ink : le milieu de l'animation. */
export const posterTick = (scene: AnaScene): number => Math.floor(scene.durationTicks / 2);

/** Durée de lecture complète (ms) : durationTicks × loopCount à tickRate ticks/s. */
export const playbackMs = (scene: AnaScene): number => Math.ceil((scene.durationTicks * scene.loopCount * 1000) / scene.tickRate);

/** Poster e-ink (gris 0 = encre / 255) à la résolution donnée, prêt pour encodeForScreen(gray, w, h, screen). */
export function renderPosterGray(scene: AnaScene, width: number, height: number): Uint8Array {
  const idx = renderSceneIndices(scene, width, height, posterTick(scene));
  return indicesToPosterGray(idx, scene.palette, scene.backgroundIndex);
}
