import test from "node:test";
import assert from "node:assert/strict";
import { blank, ellipse, flipH, flipV, floodFill, getPx, inkCount, invert, line, motion, rect, setPixel, shifted, W, H } from "../lib/bench/draw";

const lit = (f: Uint8Array) => { const o: string[] = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (getPx(f, x, y)) o.push(`${x},${y}`); return o; };

test("les primitives ne modifient JAMAIS leur argument (copie sur écriture : l'historique repose dessus)", () => {
  const f = blank(); const snap = Uint8Array.from(f);
  setPixel(f, 3, 3, true); line(f, 0, 0, 50, 20, true); rect(f, 1, 1, 9, 9, true, true); ellipse(f, 5, 5, 40, 30, true, true); floodFill(f, 0, 0, true);
  shifted(f, 3, 3); flipH(f); flipV(f); invert(f);
  assert.deepEqual(Array.from(f), Array.from(snap));
});

test("crayon, gomme, pinceaux carré et rond ; bords de l'image ignorés sans erreur", () => {
  let f = setPixel(blank(), 10, 10, true);
  assert.deepEqual(lit(f), ["10,10"]);
  f = setPixel(f, 10, 10, false); assert.equal(inkCount(f), 0);
  assert.equal(inkCount(setPixel(blank(), 20, 20, true, { size: 3, round: false })), 9);
  const round = inkCount(setPixel(blank(), 20, 20, true, { size: 5, round: true }));
  assert.ok(round > 9 && round < 25, `disque de ${round} pixels`);
  assert.equal(inkCount(setPixel(blank(), -5, 200, true)), 0);
  assert.ok(inkCount(setPixel(blank(), 0, 0, true, { size: 4, round: false })) > 0);
});

test("ligne : extrémités allumées, horizontale / verticale / diagonale exactes, sans trou", () => {
  const h = line(blank(), 5, 7, 30, 7, true);
  assert.equal(inkCount(h), 26);
  assert.equal(inkCount(line(blank(), 9, 2, 9, 40, true)), 39);
  const d = line(blank(), 0, 0, 20, 20, true);
  assert.equal(inkCount(d), 21);
  for (let i = 0; i <= 20; i++) assert.ok(getPx(d, i, i));
  const back = line(blank(), 30, 7, 5, 7, true);
  assert.deepEqual(lit(back), lit(h), "le sens du tracé ne change pas la ligne");
});

test("rectangle : plein = (w × h) pixels, contour = périmètre, ordre des coins indifférent", () => {
  assert.equal(inkCount(rect(blank(), 10, 10, 19, 14, true, true)), 10 * 5);
  const o = rect(blank(), 10, 10, 19, 14, true, false);
  assert.equal(inkCount(o), 2 * 10 + 2 * 3);
  assert.deepEqual(lit(rect(blank(), 19, 14, 10, 10, true, false)), lit(o));
  assert.ok(!getPx(o, 15, 12) && getPx(o, 10, 12) && getPx(o, 19, 12));
});

test("ellipse : symétrique, remplie contient son contour, dégénérée = ligne", () => {
  const e = ellipse(blank(), 20, 10, 60, 40, true, false), fl = ellipse(blank(), 20, 10, 60, 40, true, true);
  for (const p of lit(e)) assert.ok(getPx(fl, ...(p.split(",").map(Number) as [number, number])), `contour hors du remplissage : ${p}`);
  assert.ok(getPx(fl, 40, 25) && !getPx(fl, 21, 11));
  assert.ok(getPx(e, 20, 25) && getPx(e, 60, 25) && getPx(e, 40, 10) && getPx(e, 40, 40));
  assert.ok(inkCount(ellipse(blank(), 10, 10, 10, 30, true, false)) >= 20, "ellipse de largeur 0 = ligne verticale");
});

test("remplissage : borné par un contour, ne déborde pas, fond entier si rien ne borne, no-op si déjà de la bonne valeur", () => {
  const box = rect(blank(), 10, 10, 30, 30, true, false);
  const filled = floodFill(box, 20, 20, true);
  assert.equal(inkCount(filled), 21 * 21);
  assert.ok(!getPx(filled, 5, 5), "l'extérieur n'est pas rempli");
  assert.equal(inkCount(floodFill(blank(), 3, 3, true)), W * H);
  assert.equal(floodFill(box, 10, 10, true), box, "pixel déjà allumé : même objet, aucune copie");
  const outside = floodFill(box, 0, 0, true);
  assert.equal(inkCount(outside), W * H - (19 * 19), "l'intérieur de la boîte reste vide");
  const eraseInside = floodFill(filled, 20, 20, false);
  assert.equal(inkCount(eraseInside), 0, "le bloc plein est d'un seul tenant : tout part");
});

test("décalage bouclé / non bouclé, retournements, inversion : aller-retour exact", () => {
  const f = line(blank(), 0, 0, 40, 25, true);
  assert.deepEqual(lit(shifted(shifted(f, 17, 9), -17, -9)), lit(f), "décaler puis revenir (bouclé) = identique");
  assert.equal(inkCount(shifted(f, W, H)), inkCount(f), "décaler d'une image entière (bouclé) = identique");
  assert.ok(inkCount(shifted(f, 100, 0, false)) < inkCount(f), "non bouclé : ce qui sort est perdu");
  assert.deepEqual(lit(flipH(flipH(f))), lit(f)); assert.deepEqual(lit(flipV(flipV(f))), lit(f));
  assert.ok(getPx(flipH(setPixel(blank(), 0, 5, true)), W - 1, 5) && getPx(flipV(setPixel(blank(), 5, 0, true)), 5, H - 1));
  assert.deepEqual(Array.from(invert(invert(f))), Array.from(f));
  assert.equal(inkCount(invert(blank())), W * H);
});

test("mouvement : N images, la première intacte, chaque image décalée de k·(dx, dy)", () => {
  const sprite = rect(blank(), 10, 10, 15, 15, true, true);
  const m = motion(sprite, 5, 4, 0, true);
  assert.equal(m.length, 5);
  assert.deepEqual(lit(m[0]), lit(sprite));
  for (let k = 0; k < 5; k++) assert.ok(getPx(m[k], 10 + 4 * k, 12) && getPx(m[k], 15 + 4 * k, 12), `image ${k}`);
  assert.equal(inkCount(m[4]), inkCount(sprite));
});
