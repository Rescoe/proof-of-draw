// lib/drawEngine/ops.ts
// Opérations de dessin (tracé, formes, remplissage, dégradé, effacement).
//
// Ce module est la SEULE implémentation du dessin : la session interactive et
// le rejeu (galerie, tests) l'appellent avec les mêmes paramètres, décodés de
// la même manière depuis un `ReplayEvent`. C'est ce qui garantit que l'image
// reconstruite depuis le replay est identique à l'image envoyée.

import type { ReplayEvent } from "@/lib/types/actions";
import { Bitmap, Txn } from "./bitmap";
import { Color, ColorMode, blend565, fromHex, lerp, snapColor } from "./color";
import { BrushMask, anchorX, anchorY, brushMask, rng } from "./brushes";
import { bayerThreshold, textureBit } from "./patterns";
import {
  Pt, SymCfg, bresenham, ellipseInside, ellipseRing, floodRegion, polygonFill,
  rectFill, rectRing, symmetricCopies,
} from "./raster";

export interface EngineCfg {
  width: number;
  height: number;
  mode: ColorMode;
  background: Color;
}

export interface Ink {
  color: Color;   // déjà ramenée sur la palette de l'écran
  op: number;     // opacité 1..100 (significatif uniquement en rgb565)
  tx: string;     // texture
}

export interface Surface {
  bmp: Bitmap;
  txn: Txn;
  mode: ColorMode;
}

export function makeInk(hex: string, mode: ColorMode, op = 100, tx = "solid"): Ink {
  return {
    color: snapColor(fromHex(hex), mode),
    op: mode === "rgb565" ? Math.max(1, Math.min(100, Math.round(op))) : 100,
    tx: tx || "solid",
  };
}

/** Peint un pixel selon l'encre : texture, puis opacité (une seule fois par geste). */
export function plot(s: Surface, ink: Ink, x: number, y: number) {
  const { bmp, txn } = s;
  if (x < 0 || y < 0 || x >= bmp.w || y >= bmp.h) return;
  if (ink.tx !== "solid" && !textureBit(ink.tx, x, y)) return;
  const i = y * bmp.w + x;
  if (ink.op < 100) {
    if (txn.touched(i)) return; // évite l'accumulation d'opacité quand le trait se recoupe
    txn.write(i, blend565(bmp.data[i], ink.color, ink.op));
  } else {
    txn.write(i, ink.color);
  }
}

// ─── Décodage des paramètres depuis un événement ─────────────────────────────

export function symFromEvent(ev: ReplayEvent, cfg: EngineCfg): SymCfg | null {
  if (!ev.sy) return null;
  return { m: ev.sy, cx: ev.cx ?? cfg.width / 2, cy: ev.cy ?? cfg.height / 2 };
}

export function inkFromEvent(ev: ReplayEvent, cfg: EngineCfg): Ink {
  if (ev.tool === "eraser") return { color: cfg.background, op: cfg.mode === "rgb565" ? Math.max(1, Math.min(100, ev.op ?? 100)) : 100, tx: ev.tx ?? "solid" };
  return makeInk(ev.color ?? "#000000", cfg.mode, ev.op ?? 100, ev.tx ?? "solid");
}

// ─── Empreinte de brosse ─────────────────────────────────────────────────────

function stampMask(s: Surface, ink: Ink, m: BrushMask, x: number, y: number, fx: boolean, fy: boolean) {
  const ax = anchorX(m), ay = anchorY(m);
  for (let j = 0; j < m.h; j++) {
    const jj = fy ? m.h - 1 - j : j;
    for (let i = 0; i < m.w; i++) {
      if (!m.bits[j * m.w + i]) continue;
      const ii = fx ? m.w - 1 - i : i;
      plot(s, ink, x - ax + ii, y - ay + jj);
    }
  }
}

// ─── Trait à main levée ──────────────────────────────────────────────────────

export interface StrokeCfg {
  brush: string;
  size: number;
  ink: Ink;
  sym: SymCfg | null;
  pp: boolean;    // pixel parfait
  seed: number;   // graine du spray
}

export function strokeCfgFromEvent(ev: ReplayEvent, cfg: EngineCfg): StrokeCfg {
  return {
    brush: ev.br ?? "round",
    size: ev.size ?? 1,
    ink: inkFromEvent(ev, cfg),
    sym: symFromEvent(ev, cfg),
    pp: ev.pp === 1,
    seed: ev.sd ?? 1,
  };
}

export class StrokeRunner {
  private s: Surface;
  private cfg: StrokeCfg;
  private mask: BrushMask;
  private rand: () => number;
  private last: Pt | null = null;
  private stepCount = 0;
  private usePP: boolean;
  // filtre "pixel parfait" : a = dernier pixel posé, b = candidat en attente
  private a: Pt | null = null;
  private b: Pt | null = null;
  private sprayOnes: number[] = [];

  constructor(s: Surface, cfg: StrokeCfg) {
    this.s = s;
    this.cfg = cfg;
    this.mask = brushMask(cfg.brush, cfg.size);
    this.rand = rng(cfg.seed);
    this.usePP = cfg.pp && !this.mask.spray && this.mask.w * this.mask.h === 1;
    if (this.mask.spray) {
      for (let k = 0; k < this.mask.bits.length; k++) if (this.mask.bits[k]) this.sprayOnes.push(k);
    }
  }

  down(p: Pt) {
    this.last = p;
    this.pathPixel(p);
  }

  move(p: Pt) {
    if (!this.last) { this.down(p); return; }
    if (p.x === this.last.x && p.y === this.last.y) return;
    const from = this.last;
    let first = true;
    bresenham(from.x, from.y, p.x, p.y, (x, y) => {
      if (first) { first = false; return; } // le point de départ est déjà posé
      this.pathPixel({ x, y });
    });
    this.last = p;
  }

  /** À appeler à la fin du trait : pose le dernier pixel retenu par le filtre pixel-parfait. */
  finish() {
    if (this.usePP && this.b) { this.stamp(this.b); this.b = null; }
  }

  private pathPixel(p: Pt) {
    if (!this.usePP) { this.stamp(p); return; }
    if (!this.a) { this.a = p; this.stamp(p); return; }
    if (!this.b) { this.b = p; return; }
    const a = this.a, b = this.b, c = p;
    const isL = Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1 &&
      ((b.x === a.x && b.y === c.y) || (b.y === a.y && b.x === c.x));
    if (isL) { this.b = c; return; }       // on supprime le coin du L
    this.stamp(b);
    this.a = b;
    this.b = c;
  }

  private stamp(p: Pt) {
    const { s, cfg } = this;
    const copies = symmetricCopies(p.x, p.y, cfg.sym);
    if (this.mask.spray) {
      const spacing = Math.max(1, Math.floor(cfg.size / 4));
      const doStamp = this.stepCount++ % spacing === 0;
      if (!doStamp) return;
      const dots = Math.max(1, Math.round(this.sprayOnes.length * 0.16));
      const ax = anchorX(this.mask), ay = anchorY(this.mask);
      for (let d = 0; d < dots; d++) {
        const k = this.sprayOnes[Math.floor(this.rand() * this.sprayOnes.length)];
        const ci = k % this.mask.w, cj = Math.floor(k / this.mask.w);
        for (const c of copies) {
          const ii = c.fx ? this.mask.w - 1 - ci : ci, jj = c.fy ? this.mask.h - 1 - cj : cj;
          plot(s, cfg.ink, c.x - ax + ii, c.y - ay + jj);
        }
      }
      return;
    }
    for (const c of copies) stampMask(s, cfg.ink, this.mask, c.x, c.y, c.fx, c.fy);
  }
}

// ─── Formes ──────────────────────────────────────────────────────────────────

export interface ShapeCfg {
  shape: "line" | "rect" | "ellipse" | "poly";
  a: Pt;
  b: Pt;
  size: number;
  ink: Ink;
  fill: boolean;
  fromCenter: boolean;
  sym: SymCfg | null;
  pts?: number[];
  brush: string;
}

export function shapeCfgFromEvent(ev: ReplayEvent, cfg: EngineCfg): ShapeCfg {
  return {
    shape: ev.shapeType ?? "line",
    a: { x: ev.x, y: ev.y },
    b: { x: ev.x2 ?? ev.x, y: ev.y2 ?? ev.y },
    size: ev.size ?? 1,
    ink: inkFromEvent(ev, cfg),
    fill: ev.fl === 1,
    fromCenter: ev.fc === 1,
    sym: symFromEvent(ev, cfg),
    pts: ev.pts,
    brush: ev.br ?? "round",
  };
}

function drawLineBrush(s: Surface, ink: Ink, brush: string, size: number, a: Pt, b: Pt) {
  const m = brushMask(brush, size);
  bresenham(a.x, a.y, b.x, b.y, (x, y) => stampMask(s, ink, m, x, y, false, false));
}

export function drawShape(s: Surface, sh: ShapeCfg) {
  const ca = symmetricCopies(sh.a.x, sh.a.y, sh.sym);
  const cb = symmetricCopies(sh.b.x, sh.b.y, sh.sym);
  const w = s.bmp.w, h = s.bmp.h;
  for (let k = 0; k < ca.length; k++) {
    const a = ca[k], b = cb[k];
    const plotInk: (x: number, y: number) => void = (x, y) => plot(s, sh.ink, x, y);
    if (sh.shape === "line") {
      drawLineBrush(s, sh.ink, sh.brush, sh.size, a, b);
    } else if (sh.shape === "rect" || sh.shape === "ellipse") {
      let x0 = a.x, y0 = a.y;
      const x1 = b.x, y1 = b.y;
      if (sh.fromCenter) { x0 = a.x - (b.x - a.x); y0 = a.y - (b.y - a.y); }
      if (sh.shape === "rect") {
        if (sh.fill) rectFill(x0, y0, x1, y1, plotInk); else rectRing(x0, y0, x1, y1, Math.max(1, sh.size), plotInk);
      } else {
        if (sh.fill) ellipseInside(x0, y0, x1, y1, plotInk); else ellipseRing(x0, y0, x1, y1, Math.max(1, sh.size), plotInk);
      }
    } else if (sh.shape === "poly" && sh.pts && sh.pts.length >= 4) {
      const pts = sh.sym && sh.sym.m
        ? symmetricPoly(sh.pts, sh.sym, k)
        : sh.pts;
      if (sh.fill) polygonFill(pts, w, h, plotInk);
      const n = pts.length >> 1;
      const closed = sh.fill || n >= 3;
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        drawLineBrush(s, sh.ink, sh.brush, sh.size, { x: pts[2 * i], y: pts[2 * i + 1] }, { x: pts[2 * j], y: pts[2 * j + 1] });
      }
    }
  }
}

function symmetricPoly(pts: number[], sym: SymCfg, copy: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const c = symmetricCopies(pts[i], pts[i + 1], sym)[copy];
    out.push(c ? c.x : pts[i], c ? c.y : pts[i + 1]);
  }
  return out;
}

// ─── Remplissage & dégradé ───────────────────────────────────────────────────

export function fillRegion(s: Surface, ink: Ink, x: number, y: number, global: boolean) {
  const region = floodRegion(s.bmp.data, s.bmp.w, s.bmp.h, x, y, !global);
  const w = s.bmp.w;
  for (let k = 0; k < region.length; k++) {
    const i = region[k];
    plot(s, ink, i % w, (i / w) | 0);
  }
}

/**
 * Dégradé linéaire dans la zone cliquée. Sur un écran 1 bit/BWR : dégradé TRAMÉ
 * (matrice de Bayer) entre les deux couleurs ; en RGB565 : interpolation
 * quantifiée. Tout est entier, donc rejouable à l'identique.
 */
export function gradientRegion(s: Surface, mode: ColorMode, c1: Color, c2: Color, a: Pt, b: Pt, global: boolean) {
  const region = floodRegion(s.bmp.data, s.bmp.w, s.bmp.h, a.x, a.y, !global);
  const w = s.bmp.w;
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  for (let k = 0; k < region.length; k++) {
    const i = region[k];
    const x = i % w, y = (i / w) | 0;
    const t256 = len2 === 0 ? 0 : Math.max(0, Math.min(256, Math.floor((((x - a.x) * vx + (y - a.y) * vy) * 256) / len2)));
    let c: Color;
    if (mode === "rgb565") c = snapColor(lerp(c1, c2, t256), mode);
    else c = bayerThreshold(x, y) < Math.round(t256 / 4) ? c2 : c1;
    s.txn.write(i, c);
  }
}

// ─── Effacement total ────────────────────────────────────────────────────────

export function clearAll(s: Surface, background: Color) {
  const d = s.bmp.data;
  for (let i = 0; i < d.length; i++) if (d[i] !== background) s.txn.write(i, background);
}
