// lib/anim/brushes.ts — BROSSES de l'atelier d'animation 128×64 (1 bit) : fonctions PURES, déterministes, testées.
//
// Même convention que lib/bench/draw.ts : une image = 16 octets par ligne, MSB = pixel de gauche ; aucune fonction ne modifie son argument (copie sur écriture),
// ce qui garde l'historique annuler / rétablir bon marché. Le « hasard » du spray est un hachage de (x, y, graine) : la même opération redonne exactement la même image
// (indispensable pour rejouer / tester un trait), sans jamais appeler Math.random().
//
// Une brosse peint des TAMPONS le long d'un segment (algorithme de Bresenham). Deux brosses sont « à espacement » (pointillé) : un reste de distance (`carry`)
// est reporté d'un segment au suivant pour que le motif reste régulier pendant tout le trait, quelle que soit la vitesse du doigt.

import { CLIP } from "@/lib/bench/clip";

const W = CLIP.W, H = CLIP.H, RB = CLIP.ROW_BYTES;
export type Frame = Uint8Array;

export type BrushKind = "round" | "square" | "spray" | "texture" | "dotted" | "nib" | "hatch";
export interface BrushSpec {
  kind: BrushKind;
  /** 1 à 12 pixels. */
  size: number;
  /** « texture » : densité 1 (25 %) · 2 (50 %) · 3 (75 %). */
  tone?: 1 | 2 | 3;
}

export const MAX_BRUSH_SIZE = 12;

export const BRUSHES: { id: BrushKind; label: string; hint: string }[] = [
  { id: "round",   label: "Rond",         hint: "Pinceau rond classique" },
  { id: "square",  label: "Carré",        hint: "Pixel net, bords droits" },
  { id: "spray",   label: "Spray",        hint: "Nuage de points : fumée, poussière, étincelles" },
  { id: "texture", label: "Trame",        hint: "Motif tramé (25 / 50 / 75 %) : ombres et dégradés" },
  { id: "dotted",  label: "Pointillé",    hint: "Points réguliers le long du trait" },
  { id: "nib",     label: "Plume",        hint: "Plume plate à 45° : traits pleins et déliés" },
  { id: "hatch",   label: "Hachures",     hint: "Hachures en diagonale : volumes et textures" },
];

export const clampSize = (n: number): number => Math.max(1, Math.min(MAX_BRUSH_SIZE, Math.round(Number.isFinite(n) ? n : 1)));

/** Écrit un pixel DANS `f` (usage interne : appelé sur une copie). */
function put(f: Frame, x: number, y: number, on: boolean): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = y * RB + (x >> 3), m = 0x80 >> (x & 7);
  if (on) f[i] |= m; else f[i] &= ~m;
}

// Matrice de Bayer 4×4 (seuils 0..15) : une trame ordonnée, alignée sur les coordonnées ABSOLUES de l'image (deux traits voisins se raccordent sans couture).
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Hachage entier 32 bits (Wang/Murmur-like) → [0, 1[. Déterministe : mêmes entrées, même sortie. */
function hash01(a: number, b: number, c: number): number {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 0x1_0000_0000;
}

function stampRound(f: Frame, cx: number, cy: number, size: number, on: boolean, round: boolean, mask?: (x: number, y: number) => boolean): void {
  const r = size / 2, x0 = cx - Math.floor((size - 1) / 2), y0 = cy - Math.floor((size - 1) / 2);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    if (round && size > 2) { const dx = i + 0.5 - r, dy = j + 0.5 - r; if (dx * dx + dy * dy > r * r) continue; }
    const x = x0 + i, y = y0 + j;
    if (mask && !mask(x, y)) continue;
    put(f, x, y, on);
  }
}

function stampOne(f: Frame, x: number, y: number, on: boolean, spec: BrushSpec, seed: number): void {
  const size = clampSize(spec.size);
  switch (spec.kind) {
    case "round": stampRound(f, x, y, size, on, true); break;
    case "square": stampRound(f, x, y, size, on, false); break;
    case "dotted": stampRound(f, x, y, Math.max(1, Math.ceil(size / 2)), on, true); break;
    case "texture": {
      const level = (spec.tone ?? 2) * 4;   // 4, 8, 12 cases allumées sur 16
      stampRound(f, x, y, Math.max(2, size), on, true, (px, py) => BAYER[(py & 3) * 4 + (px & 3)] < level);
      break;
    }
    case "hatch":
      stampRound(f, x, y, Math.max(2, size), on, false, (px, py) => (px + py) % 3 === 0);
      break;
    case "nib": {                       // plume plate inclinée à 45° : un petit segment diagonal « / » de longueur ~ size
      const half = Math.max(1, Math.round(size / 2));
      for (let k = -half; k <= half; k++) put(f, x + k, y - k, on);
      break;
    }
    case "spray": {                     // nuage : ~0,6 point par pixel du disque, positions hachées sur (x, y, graine, rang)
      const radius = Math.max(1.5, size * 0.9), count = Math.max(2, Math.round(radius * radius * 0.9));
      for (let i = 0; i < count; i++) {
        const a = hash01(x, y, seed * 131 + i * 2) * Math.PI * 2;
        const d = Math.sqrt(hash01(x + 17, y + 31, seed * 131 + i * 2 + 1)) * radius;   // racine : répartition uniforme sur le disque
        put(f, x + Math.round(Math.cos(a) * d), y + Math.round(Math.sin(a) * d), on);
      }
      break;
    }
  }
}

/** Distance (en pixels) entre deux points pour les brosses à espacement. */
const spacing = (spec: BrushSpec): number => (spec.kind === "dotted" ? Math.max(3, clampSize(spec.size) * 2) : 1);

export interface Painted { frame: Frame; carry: number }

/**
 * Peint un segment (x0,y0) → (x1,y1) avec la brosse. `carry` = distance déjà parcourue depuis le dernier tampon (pointillé) ;
 * `seed` = numéro du segment dans le trait (varie le spray d'un segment à l'autre). Retourne la nouvelle image ET le reste à reporter.
 */
export function paintSegment(f: Frame, x0: number, y0: number, x1: number, y1: number, on: boolean, spec: BrushSpec, carry = 0, seed = 0): Painted {
  const c = Uint8Array.from(f);
  const step = spacing(spec);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0, acc = carry;
  for (let guard = 0; guard < 4096; guard++) {
    if (acc >= step || (acc === carry && carry === 0 && guard === 0)) { stampOne(c, x, y, on, spec, seed); acc = 0; }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    acc += 1;
  }
  return { frame: c, carry: acc };
}

/** Un seul tampon (toucher sans glisser). */
export function paintDot(f: Frame, x: number, y: number, on: boolean, spec: BrushSpec, seed = 0): Frame {
  const c = Uint8Array.from(f);
  stampOne(c, x, y, on, spec, seed);
  return c;
}

/** Pinceau compatible lib/bench/draw.ts (ligne, rectangle, ellipse) : taille + rond/carré. */
export const toShapeBrush = (spec: BrushSpec): { size: number; round: boolean } => ({ size: clampSize(spec.size), round: spec.kind !== "square" });
