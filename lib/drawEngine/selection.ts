// lib/drawEngine/selection.ts
// Sélection (rectangle, baguette magique par couleur, lasso) et transformation
// de son contenu (déplacer, dupliquer, retourner, pivoter de 90°, supprimer).
//
// Une sélection est DÉCRITE de façon reproductible (`SelectionDesc`) puis résolue
// contre l'image au moment du geste : le replay n'a pas besoin d'embarquer de
// masque, il recalcule le même à partir de l'image reconstruite.

import type { SelectionDesc } from "@/lib/types/actions";
import { Bitmap } from "./bitmap";
import { Color } from "./color";
import { floodRegion, polygonFill } from "./raster";
import type { Surface } from "./ops";

export interface Sel {
  x: number; y: number; w: number; h: number;
  mask: Uint8Array;   // w*h, 1 = pixel sélectionné
}

export type Mat = [number, number, number, number];

export const MAT_IDENTITY: Mat = [1, 0, 0, 1];
export const MAT_FLIP_H: Mat = [-1, 0, 0, 1];
export const MAT_FLIP_V: Mat = [1, 0, 0, -1];
export const MAT_ROT_CW: Mat = [0, -1, 1, 0];
export const MAT_ROT_CCW: Mat = [0, 1, -1, 0];

/** Composition : applique `first`, puis `second`. */
export function matMul(second: Mat, first: Mat): Mat {
  const [a2, b2, c2, d2] = second, [a1, b1, c1, d1] = first;
  return [a2 * a1 + b2 * c1, a2 * b1 + b2 * d1, c2 * a1 + d2 * c1, c2 * b1 + d2 * d1];
}

export function resolveSelection(bmp: Bitmap, desc: SelectionDesc): Sel | null {
  const W = bmp.w, H = bmp.h;
  if (desc.t === "rect") {
    const x0 = Math.max(0, Math.min(desc.x, desc.x + desc.w)), y0 = Math.max(0, Math.min(desc.y, desc.y + desc.h));
    const x1 = Math.min(W, Math.max(desc.x, desc.x + desc.w)), y1 = Math.min(H, Math.max(desc.y, desc.y + desc.h));
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return null;
    return { x: x0, y: y0, w, h, mask: new Uint8Array(w * h).fill(1) };
  }
  const idx: number[] = [];
  if (desc.t === "wand") {
    const region = floodRegion(bmp.data, W, H, desc.x, desc.y, desc.g !== 1);
    for (let k = 0; k < region.length; k++) idx.push(region[k]);
  } else {
    polygonFill(desc.pts, W, H, (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) idx.push(y * W + x); });
  }
  if (idx.length === 0) return null;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (const i of idx) {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (const i of idx) mask[(((i / W) | 0) - y0) * w + (i % W) - x0] = 1;
  return { x: x0, y: y0, w, h, mask };
}

export interface TransformOpts {
  m: Mat;
  dx: number;
  dy: number;
  copy: boolean;
  del: boolean;
}

/** Taille du bloc après transformation. */
export function transformedSize(w: number, h: number, m: Mat) {
  return { w: Math.abs(m[0]) * w + Math.abs(m[1]) * h, h: Math.abs(m[2]) * w + Math.abs(m[3]) * h };
}

/**
 * Applique la transformation d'une sélection sur la surface.
 * (1) copie le contenu, (2) efface la source (sauf copie), (3) pose le bloc
 * transformé à la nouvelle position — uniquement là où le masque est plein.
 */
export function transformSelection(s: Surface, sel: Sel, background: Color, o: TransformOpts) {
  const { bmp, txn } = s;
  const W = bmp.w, H = bmp.h;

  const block = new Uint32Array(sel.w * sel.h);
  for (let j = 0; j < sel.h; j++) for (let i = 0; i < sel.w; i++) {
    if (sel.mask[j * sel.w + i]) block[j * sel.w + i] = bmp.data[(sel.y + j) * W + sel.x + i];
  }

  if (!o.copy) {
    for (let j = 0; j < sel.h; j++) for (let i = 0; i < sel.w; i++) {
      if (sel.mask[j * sel.w + i]) txn.write((sel.y + j) * W + sel.x + i, background);
    }
  }
  if (o.del) return;

  const [a, b, c, d] = o.m;
  const { w: nw, h: nh } = transformedSize(sel.w, sel.h, o.m);
  const ox = sel.x + Math.floor((sel.w - nw) / 2) + o.dx;
  const oy = sel.y + Math.floor((sel.h - nh) / 2) + o.dy;
  for (let j = 0; j < sel.h; j++) for (let i = 0; i < sel.w; i++) {
    if (!sel.mask[j * sel.w + i]) continue;
    const u = i - (sel.w - 1) / 2, v = j - (sel.h - 1) / 2;
    const ni = Math.round(a * u + b * v + (nw - 1) / 2);
    const nj = Math.round(c * u + d * v + (nh - 1) / 2);
    const X = ox + ni, Y = oy + nj;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    txn.write(Y * W + X, block[j * sel.w + i]);
  }
}

/** Rectangle occupé par le contenu après transformation (pour l'affichage du cadre). */
export function transformedBounds(sel: Sel, o: { m: Mat; dx: number; dy: number }) {
  const { w, h } = transformedSize(sel.w, sel.h, o.m);
  return {
    x: sel.x + Math.floor((sel.w - w) / 2) + o.dx,
    y: sel.y + Math.floor((sel.h - h) / 2) + o.dy,
    w, h,
  };
}

/** Contour (segments de pixels) d'une sélection — pour les "fourmis marchantes". */
export function selectionEdges(sel: Sel): { x: number; y: number; dir: "t" | "b" | "l" | "r" }[] {
  const out: { x: number; y: number; dir: "t" | "b" | "l" | "r" }[] = [];
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < sel.w && j < sel.h && sel.mask[j * sel.w + i] === 1;
  for (let j = 0; j < sel.h; j++) for (let i = 0; i < sel.w; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) out.push({ x: sel.x + i, y: sel.y + j, dir: "t" });
    if (!at(i, j + 1)) out.push({ x: sel.x + i, y: sel.y + j, dir: "b" });
    if (!at(i - 1, j)) out.push({ x: sel.x + i, y: sel.y + j, dir: "l" });
    if (!at(i + 1, j)) out.push({ x: sel.x + i, y: sel.y + j, dir: "r" });
  }
  return out;
}
