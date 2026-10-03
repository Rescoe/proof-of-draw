import test from "node:test";
import assert from "node:assert/strict";
import { CLIP, encodeClip, decodeClip, clipStats, clipPlayMs, validateClipInput, type ClipInput } from "../lib/bench/clip";

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); }
const randFrame = (r: () => number, density: number) => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => (r() < density ? Math.floor(r() * 256) : 0));
const mk = (frames: Uint8Array[], extra: Partial<ClipInput> = {}): ClipInput => ({ frames, delaysMs: frames.map(() => 100), loops: 2, fg: 0x07e0, bg: 0x0000, ...extra });

test("aller-retour : décodeur de référence = images d'origine, délais, boucles, couleurs (N = 1, 2, 7, 64)", () => {
  const r = rng(1);
  for (const n of [1, 2, 7, 64]) {
    const frames = Array.from({ length: n }, () => randFrame(r, 0.3));
    const delaysMs = frames.map(() => 20 + Math.floor(r() * 30) * 10);
    const input = mk(frames, { delaysMs, loops: 1 + Math.floor(r() * 3), fg: 0xf81f, bg: 0x0842 });
    const d = decodeClip(encodeClip(input));
    assert.equal(d.frames.length, n);
    d.frames.forEach((f, i) => assert.deepEqual(Array.from(f), Array.from(input.frames[i]), `n=${n} image ${i}`));
    assert.deepEqual(d.delaysMs, delaysMs.map((x) => Math.round(x / 10) * 10));
    assert.equal(d.loops, input.loops); assert.equal(d.fg, 0xf81f); assert.equal(d.bg, 0x0842);
    assert.equal(d.transitionBytes.length, n > 1 ? n : 0);
  }
});

test("les différences sont minimales : une image qui change d'un octet coûte ~7 octets, pas 1024", () => {
  const a = new Uint8Array(CLIP.FRAME_BYTES), b = Uint8Array.from(a); b[500] = 0xff;
  const st = clipStats(mk([a, b]));
  assert.ok(st.maxTransitionBytes <= 8, `transition de ${st.maxTransitionBytes} octets`);   // délai + nbRuns(2) + run(3 + 1)
  assert.ok(st.bytes < 1200);
  const identical = clipStats(mk([a, Uint8Array.from(a)]));
  assert.equal(identical.maxTransitionBytes, 3);                                              // aucune différence : délai + 0 run
});

test("runs : les petits trous sont fondus, les longues différences coupées à 255 octets", () => {
  const a = new Uint8Array(CLIP.FRAME_BYTES), b = Uint8Array.from(a);
  b[10] = 1; b[13] = 1;                    // trou de 2 octets : un seul run (coûte moins que deux)
  b[100] = 1; b[110] = 1;                  // trou de 9 : deux runs
  b.fill(7, 300, 800);                     // 500 octets : coupés en 255 + 245
  const d = decodeClip(encodeClip(mk([a, b])));
  assert.deepEqual(Array.from(d.frames[1]), Array.from(b));
});

test("pire cas : bruit plein écran 64 images = refusé comme trop gros pour l'appareil, mais encodable et fidèle", () => {
  const r = rng(9);
  const frames = Array.from({ length: 64 }, () => randFrame(r, 1));
  const st = clipStats(mk(frames, { loops: 1 }));
  assert.equal(st.fitsDevice, false);
  assert.ok(st.bytes > CLIP.MAX_CLIP_BYTES);
});

test("une animation simple (balle qui rebondit, 32 images) tient largement dans le plafond", () => {
  const frames: Uint8Array[] = [];
  for (let k = 0; k < 32; k++) {
    const f = new Uint8Array(CLIP.FRAME_BYTES);
    const cx = 10 + Math.round(((k < 16 ? k : 31 - k) / 15) * 100), cy = 32;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= 16) { const px = cx + x, py = cy + y; f[py * 16 + (px >> 3)] |= 0x80 >> (px & 7); }
    frames.push(f);
  }
  const st = clipStats(mk(frames, { loops: 3 }));
  assert.ok(st.fitsDevice, `${st.bytes} octets`);
  assert.ok(st.avgTransitionBytes < 120, `moyenne ${st.avgTransitionBytes}`);
});

test("décodeur : refuse un clip altéré (CRC, signature, version, taille, run hors image, retour incohérent)", () => {
  const r = rng(3);
  const good = encodeClip(mk([randFrame(r, 0.2), randFrame(r, 0.2), randFrame(r, 0.2)]));
  decodeClip(good);
  const flip = (i: number) => { const c = Uint8Array.from(good); c[i] ^= 0x55; return c; };
  for (const i of [0, 4, 5, 8, 10, 16, 18, 25, 700, good.length - 6, good.length - 1]) assert.throws(() => decodeClip(flip(i)), /clip invalide/, `octet ${i}`);
  assert.throws(() => decodeClip(good.subarray(0, good.length - 1)), /clip invalide/);
  assert.throws(() => decodeClip(new Uint8Array(10)), /clip invalide/);
});

test("validation : bornes des images, délais, boucles, durée, couleurs", () => {
  const f = new Uint8Array(CLIP.FRAME_BYTES);
  assert.equal(validateClipInput(mk([f])), null);
  assert.match(validateClipInput(mk([]))!, /images/);
  assert.match(validateClipInput(mk(Array.from({ length: 65 }, () => f)))!, /images/);
  assert.match(validateClipInput(mk([new Uint8Array(10)]))!, /1024/);
  assert.match(validateClipInput({ ...mk([f]), delaysMs: [] })!, /délai/);
  assert.equal(validateClipInput(mk([f], { loops: 0 })), null, "loops = 0 : en boucle");
  assert.match(validateClipInput(mk([f], { loops: -1 }))!, /boucles/);
  assert.match(validateClipInput(mk([f], { loops: 101 }))!, /boucles/);
  assert.match(validateClipInput(mk([f], { fg: 70000 }))!, /couleur/);
  assert.match(validateClipInput(mk([f], { delaysMs: [2550], loops: 100 }))!, /durée/);
  assert.equal(clipPlayMs([100, 200], 3), 900);
  assert.equal(clipPlayMs([1], 1), 20);      // plancher 20 ms
  assert.equal(clipPlayMs([100, 200], 0), 300, "en boucle : la durée d'un tour");
});
