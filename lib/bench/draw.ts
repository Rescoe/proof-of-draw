// lib/bench/draw.ts — primitives de dessin PURES pour l'éditeur d'animation 128×64 (1 bit, lignes de 16 octets, MSB = pixel de gauche).
// Aucune fonction ne modifie son argument : chacune retourne une NOUVELLE image (copie sur écriture) — c'est ce qui rend l'historique
// annuler / rétablir bon marché (les images inchangées sont partagées entre les états).

import { CLIP, clipPixel } from "@/lib/bench/clip";

export const W = CLIP.W, H = CLIP.H, RB = CLIP.ROW_BYTES;
export type Frame = Uint8Array;

export const blank = (): Frame => new Uint8Array(CLIP.FRAME_BYTES);
export const getPx = (f: Frame, x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && clipPixel(f, x, y) === 1;

/** Écrit un pixel DANS `f` (usage interne : appelé sur une copie). */
function put(f: Frame, x: number, y: number, on: boolean) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = y * RB + (x >> 3), m = 0x80 >> (x & 7);
  if (on) f[i] |= m; else f[i] &= ~m;
}

/** Pinceau : carré (size × size) ou rond, centré sur (x, y). */
function stamp(f: Frame, x: number, y: number, on: boolean, size: number, round: boolean) {
  if (size <= 1) { put(f, x, y, on); return; }
  const r = size / 2, x0 = x - Math.floor((size - 1) / 2), y0 = y - Math.floor((size - 1) / 2);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    if (round) { const dx = i + 0.5 - r, dy = j + 0.5 - r; if (dx * dx + dy * dy > r * r) continue; }
    put(f, x0 + i, y0 + j, on);
  }
}

export interface Brush { size: number; round: boolean }
const B1: Brush = { size: 1, round: false };

export function setPixel(f: Frame, x: number, y: number, on: boolean, b: Brush = B1): Frame {
  const c = Uint8Array.from(f); stamp(c, x, y, on, b.size, b.round); return c;
}

function lineInto(c: Frame, x0: number, y0: number, x1: number, y1: number, on: boolean, b: Brush) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (let guard = 0; guard < 4096; guard++) {
    stamp(c, x, y, on, b.size, b.round);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
export function line(f: Frame, x0: number, y0: number, x1: number, y1: number, on: boolean, b: Brush = B1): Frame {
  const c = Uint8Array.from(f); lineInto(c, x0, y0, x1, y1, on, b); return c;
}

export function rect(f: Frame, x0: number, y0: number, x1: number, y1: number, on: boolean, filled: boolean, b: Brush = B1): Frame {
  const c = Uint8Array.from(f);
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  if (filled) { for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) put(c, x, y, on); return c; }
  lineInto(c, ax, ay, bx, ay, on, b); lineInto(c, bx, ay, bx, by, on, b); lineInto(c, bx, by, ax, by, on, b); lineInto(c, ax, by, ax, ay, on, b);
  return c;
}

/** Ellipse inscrite dans le rectangle (x0,y0)-(x1,y1) : contour (pinceau) ou pleine. */
export function ellipse(f: Frame, x0: number, y0: number, x1: number, y1: number, on: boolean, filled: boolean, b: Brush = B1): Frame {
  const c = Uint8Array.from(filled ? blank() : f);        // plein : le contour est d'abord tracé sur une image VIERGE (pour en lire les bornes par ligne)
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax) / 2, ry = (by - ay) / 2;
  if (rx < 0.5 || ry < 0.5) { const d = Uint8Array.from(f); lineInto(d, ax, ay, bx, by, on, b); return d; }   // dégénérée = ligne, sur l'image d'origine
  // contour : on parcourt l'ellipse assez finement pour ne laisser aucun trou, puis on relie les points
  const steps = Math.max(32, Math.ceil(Math.PI * 2 * Math.max(rx, ry) * 2));
  let px = Math.round(cx + rx), py = Math.round(cy);
  for (let k = 1; k <= steps; k++) {
    const a = (k / steps) * Math.PI * 2, x = Math.round(cx + rx * Math.cos(a)), y = Math.round(cy + ry * Math.sin(a));
    lineInto(c, px, py, x, y, filled ? true : on, filled ? B1 : b); px = x; py = y;
  }
  if (!filled) return c;
  // Plein : pour chaque ligne, de l'abscisse la plus à gauche à la plus à droite du contour (le plein contient donc toujours le contour).
  const outline = c;
  const out = Uint8Array.from(f);
  for (let y = Math.max(0, ay); y <= Math.min(H - 1, by); y++) {
    let l = -1, r = -1;
    for (let x = Math.max(0, ax); x <= Math.min(W - 1, bx); x++) if (getPx(outline, x, y)) { if (l < 0) l = x; r = x; }
    if (l >= 0) for (let x = l; x <= r; x++) put(out, x, y, on);
  }
  return out;
}

/** Remplissage (pot de peinture) : région 4-connexe de même valeur que le pixel cliqué, remplie avec `on`. */
export function floodFill(f: Frame, x: number, y: number, on: boolean): Frame {
  if (x < 0 || y < 0 || x >= W || y >= H) return f;
  const target = getPx(f, x, y);
  if (target === on) return f;
  const c = Uint8Array.from(f);
  const stack: number[] = [x, y];
  while (stack.length) {
    const sy = stack.pop()!, sx = stack.pop()!;
    if (sy < 0 || sy >= H || getPx(c, sx, sy) !== target) continue;
    let l = sx, r = sx;
    while (l > 0 && getPx(c, l - 1, sy) === target) l--;
    while (r < W - 1 && getPx(c, r + 1, sy) === target) r++;
    for (let i = l; i <= r; i++) put(c, i, sy, on);
    for (let i = l; i <= r; i++) { if (sy > 0 && getPx(c, i, sy - 1) === target) stack.push(i, sy - 1); if (sy < H - 1 && getPx(c, i, sy + 1) === target) stack.push(i, sy + 1); }
  }
  return c;
}

export function shifted(f: Frame, dx: number, dy: number, wrap = true): Frame {
  const out = blank();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!getPx(f, x, y)) continue;
    const nx = x + dx, ny = y + dy;
    if (wrap) put(out, ((nx % W) + W) % W, ((ny % H) + H) % H, true);
    else put(out, nx, ny, true);
  }
  return out;
}
export const flipH = (f: Frame): Frame => { const o = blank(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (getPx(f, x, y)) put(o, W - 1 - x, y, true); return o; };
export const flipV = (f: Frame): Frame => { const o = blank(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (getPx(f, x, y)) put(o, x, H - 1 - y, true); return o; };
export const invert = (f: Frame): Frame => Uint8Array.from(f, (v) => v ^ 0xff);

/** N images : l'image de départ décalée de (dx, dy) à chaque image — un mouvement à partir d'un seul dessin. */
export function motion(f: Frame, n: number, dx: number, dy: number, wrap: boolean): Frame[] {
  return Array.from({ length: n }, (_, k) => (k === 0 ? Uint8Array.from(f) : shifted(f, dx * k, dy * k, wrap)));
}

/** Nombre de pixels allumés (pour repérer une image vide). */
export const inkCount = (f: Frame): number => { let n = 0; for (const v of f) { let b = v; while (b) { n += b & 1; b >>= 1; } } return n; };
