import test from "node:test";
import assert from "node:assert/strict";
import { BRUSHES, MAX_BRUSH_SIZE, clampSize, paintDot, paintSegment, toShapeBrush, type BrushSpec } from "../lib/anim/brushes";
import { chooseLayout, fitCanvas } from "../lib/anim/fit";
import { CLIP, clipPixel } from "../lib/bench/clip";

const W = CLIP.W, H = CLIP.H;
const blank = () => new Uint8Array(CLIP.FRAME_BYTES);
const px = (f: Uint8Array, x: number, y: number) => clipPixel(f, x, y) === 1;
const count = (f: Uint8Array) => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px(f, x, y)) n++; return n; };
const pixels = (f: Uint8Array) => { const out: [number, number][] = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px(f, x, y)) out.push([x, y]); return out; };
const spec = (kind: BrushSpec["kind"], size = 4, tone?: 1 | 2 | 3): BrushSpec => ({ kind, size, ...(tone ? { tone } : {}) });

test("toutes les brosses : image d'origine intacte, nouvelle image retournée, jamais d'exception hors cadre", () => {
  for (const b of BRUSHES) {
    const base = blank();
    const out = paintSegment(base, -20, -20, 200, 120, true, spec(b.id, 6), 0, 3).frame;
    assert.equal(count(base), 0, `${b.id} : l'argument ne doit pas être modifié`);
    assert.notStrictEqual(out, base);
    assert.ok(count(out) > 0, `${b.id} dessine quelque chose`);
    assert.doesNotThrow(() => paintDot(base, W + 50, H + 50, true, spec(b.id, 12)));
  }
});

test("rond de taille 1 = un pixel ; gomme (on = false) efface", () => {
  const dot = paintDot(blank(), 10, 10, true, spec("round", 1));
  assert.deepEqual(pixels(dot), [[10, 10]]);
  assert.equal(count(paintDot(dot, 10, 10, false, spec("round", 1))), 0);
});

test("spray : déterministe (mêmes entrées = même image), varie avec la graine, reste dans un disque", () => {
  const a = paintDot(blank(), 60, 30, true, spec("spray", 8), 5);
  const b = paintDot(blank(), 60, 30, true, spec("spray", 8), 5);
  const c = paintDot(blank(), 60, 30, true, spec("spray", 8), 6);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  const radius = 8 * 0.9 + 1.5;
  for (const [x, y] of pixels(a)) assert.ok(Math.hypot(x - 60, y - 30) <= radius, `point hors du nuage (${x},${y})`);
  assert.ok(count(a) >= 4 && count(a) <= 80);
});

test("trame : densité croissante 25 % < 50 % < 75 %, alignée sur des coordonnées absolues (raccord sans couture)", () => {
  const n = (tone: 1 | 2 | 3) => count(paintDot(blank(), 40, 20, true, spec("texture", 8, tone)));
  assert.ok(n(1) < n(2) && n(2) < n(3), `${n(1)} < ${n(2)} < ${n(3)}`);
  // deux tampons voisins ne s'écrasent pas : peindre A puis B = A ∪ B (un pixel est allumé ou non selon SA position absolue seule)
  const left = paintDot(blank(), 30, 20, true, spec("texture", 8, 2));
  const right = paintDot(blank(), 34, 20, true, spec("texture", 8, 2));
  const both = paintDot(left, 34, 20, true, spec("texture", 8, 2));
  const key = ([x, y]: [number, number]) => `${x},${y}`;
  const union = new Set([...pixels(left), ...pixels(right)].map(key));
  assert.deepEqual(new Set(pixels(both).map(key)), union);
});

test("hachures : seulement les pixels de la diagonale (x + y) % 3 = 0", () => {
  const f = paintSegment(blank(), 10, 10, 60, 40, true, spec("hatch", 5)).frame;
  assert.ok(count(f) > 0);
  for (const [x, y] of pixels(f)) assert.equal((x + y) % 3, 0);
});

test("pointillé : des points espacés, régulièrement, même en plusieurs segments (le reste de distance est reporté)", () => {
  const single = paintSegment(blank(), 5, 32, 85, 32, true, spec("dotted", 2)).frame;
  const dots = pixels(single).map(([x]) => x);
  assert.ok(dots.length >= 10 && dots.length <= 32, `${dots.length} points`);
  const gaps = dots.slice(1).map((x, i) => x - dots[i]);
  assert.ok(Math.min(...gaps) >= 2, "points séparés");

  // même trajet en 4 segments avec report du reste : même nombre de points (± 1)
  let f: Uint8Array = blank(), carry = 0;
  for (let k = 0; k < 4; k++) { const r = paintSegment(f, 5 + k * 20, 32, 5 + (k + 1) * 20, 32, true, spec("dotted", 2), carry, k); f = r.frame; carry = r.carry; }
  assert.ok(Math.abs(count(f) - count(single)) <= 2, `${count(f)} vs ${count(single)}`);
});

test("plume : plus épaisse perpendiculairement à son axe (« / ») que le long de son axe", () => {
  const along = count(paintSegment(blank(), 20, 40, 60, 0, true, spec("nib", 6)).frame);        // le long de « / »
  const across = count(paintSegment(blank(), 20, 0, 60, 40, true, spec("nib", 6)).frame);       // le long de « \ »
  assert.ok(across > along, `perpendiculaire ${across} > le long ${along}`);
});

test("taille bornée 1..12, pinceau des formes cohérent", () => {
  assert.equal(clampSize(0), 1);
  assert.equal(clampSize(99), MAX_BRUSH_SIZE);
  assert.equal(clampSize(NaN), 1);
  assert.deepEqual(toShapeBrush(spec("square", 3)), { size: 3, round: false });
  assert.deepEqual(toShapeBrush(spec("spray", 99)), { size: MAX_BRUSH_SIZE, round: true });
});

test("fitCanvas : le canvas TIENT toujours dans la scène (paysage, portrait, minuscule), entier dès que ≥ 3", () => {
  for (const [w, h] of [[800, 246], [375, 300], [1100, 700], [320, 120], [200, 90]]) {
    const r = fitCanvas(w, h, W, H, 12);
    assert.ok(r.width <= w - 24 + 1 && r.height <= h - 24 + 1, `${w}×${h} → ${r.width}×${r.height}`);
    assert.ok(r.scale >= 0.5);
    if (r.scale >= 3) assert.equal(r.scale, Math.floor(r.scale));
  }
  assert.equal(fitCanvas(800, 246, W, H, 12).scale, 3, "paysage téléphone : limité par la hauteur");
  assert.equal(fitCanvas(1100, 700, W, H, 12).scale, 8);
});

test("chooseLayout : téléphone portrait = empilé ; paysage téléphone et ordinateur = latéral ; dense quand la hauteur est faible", () => {
  assert.deepEqual(chooseLayout(375, 812), { layout: "stack", dense: false });
  assert.deepEqual(chooseLayout(812, 375), { layout: "side", dense: true });
  assert.deepEqual(chooseLayout(768, 1024), { layout: "stack", dense: false });
  assert.deepEqual(chooseLayout(1280, 800), { layout: "side", dense: false });
  assert.deepEqual(chooseLayout(1024, 768), { layout: "side", dense: false });
});
