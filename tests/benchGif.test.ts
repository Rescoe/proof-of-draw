import test from "node:test";
import assert from "node:assert/strict";
import { encodeGif } from "../lib/bench/gif";
import { CLIP, clipPixel } from "../lib/bench/clip";

// Décodeur GIF INDÉPENDANT (LZW classique) : relit palette, images, délais et boucle pour vérifier l'encodeur.
function decodeGif(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assert.equal(String.fromCharCode(...b.slice(0, 6)), "GIF89a");
  const w = dv.getUint16(6, true), h = dv.getUint16(8, true);
  const flags = b[10];
  assert.ok(flags & 0x80, "palette globale");
  const palSize = 2 << (flags & 7);
  let p = 13;
  const palette: number[][] = [];
  for (let i = 0; i < palSize; i++) { palette.push([b[p], b[p + 1], b[p + 2]]); p += 3; }
  const frames: { delay: number; px: Uint8Array }[] = [];
  let loops = -1, delay = 0;
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xf9) { assert.equal(b[p], 4); delay = dv.getUint16(p + 2, true); p += 6; }
      else if (label === 0xff) { p += 1 + b[p]; assert.equal(b[p], 3); loops = dv.getUint16(p + 2, true); p += 5; }
      else throw new Error("extension inconnue");
      continue;
    }
    assert.equal(t, 0x2c);
    assert.deepEqual([dv.getUint16(p, true), dv.getUint16(p + 2, true), dv.getUint16(p + 4, true), dv.getUint16(p + 6, true)], [0, 0, w, h]);
    p += 9;
    const minCode = b[p++];
    const data: number[] = [];
    for (let n = b[p++]; n > 0; n = b[p++]) { for (let i = 0; i < n; i++) data.push(b[p++]); }
    // LZW
    const clear = 1 << minCode, eoi = clear + 1;
    let size = minCode + 1, next = eoi + 1;
    let dict: number[][] = [];
    const reset = () => { dict = Array.from({ length: clear }, (_, i) => [i]); dict.push([], []); size = minCode + 1; next = eoi + 1; };
    reset();
    const px: number[] = [];
    let bits = 0, acc = 0, di = 0, prev: number[] | null = null;
    for (;;) {
      while (bits < size && di < data.length) { acc |= data[di++] << bits; bits += 8; }
      if (bits < size) break;
      const code = acc & ((1 << size) - 1); acc >>>= size; bits -= size;
      if (code === clear) { reset(); prev = null; continue; }
      if (code === eoi) break;
      let entry: number[];
      if (code < dict.length) entry = dict[code];
      else if (code === dict.length && prev) entry = [...prev, prev[0]];
      else throw new Error("code LZW invalide");
      px.push(...entry);
      if (prev) { dict.push([...prev, entry[0]]); next++; if (next >= (1 << size) && size < 12) size++; }
      prev = entry;
    }
    frames.push({ delay, px: Uint8Array.from(px) });
  }
  return { w, h, palette, frames, loops };
}

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); }
const randFrame = (r: () => number, density: number) => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => (r() < density ? Math.floor(r() * 256) : 0));

test("GIF : aller-retour exact — dimensions, palette, délais, boucle infinie, chaque pixel de chaque image", () => {
  const r = rng(4);
  for (const scale of [1, 2, 4]) {
    const frames = [randFrame(r, 0.2), randFrame(r, 0.5), new Uint8Array(CLIP.FRAME_BYTES), Uint8Array.from({ length: 1024 }, () => 0xff)];
    const gif = encodeGif({ frames, delaysMs: [100, 250, 40, 1000], fg: [0, 255, 136], bg: [8, 8, 8], scale });
    const d = decodeGif(gif);
    assert.deepEqual([d.w, d.h], [128 * scale, 64 * scale]);
    assert.deepEqual(d.palette, [[8, 8, 8], [0, 255, 136]]);
    assert.equal(d.loops, 0);
    assert.deepEqual(d.frames.map((f) => f.delay), [10, 25, 4, 100]);
    d.frames.forEach((f, n) => {
      assert.equal(f.px.length, d.w * d.h, `image ${n} : nombre de pixels`);
      for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++)
        if (f.px[y * d.w + x] !== clipPixel(frames[n], Math.floor(x / scale), Math.floor(y / scale))) assert.fail(`scale=${scale} image ${n} pixel (${x},${y})`);
    });
  }
});

test("GIF : un délai trop court est relevé à 20 ms ; image unique et dictionnaire saturé (bruit plein cadre, ×8) restent corrects", () => {
  const r = rng(8);
  const noise = randFrame(r, 1);
  const gif = encodeGif({ frames: [noise], delaysMs: [1], fg: [255, 255, 255], bg: [0, 0, 0], scale: 8, loops: 3 });
  const d = decodeGif(gif);
  assert.equal(d.frames[0].delay, 2);
  assert.equal(d.loops, 3);
  for (let y = 0; y < d.h; y += 3) for (let x = 0; x < d.w; x++)
    if (d.frames[0].px[y * d.w + x] !== clipPixel(noise, Math.floor(x / 8), Math.floor(y / 8))) assert.fail(`pixel (${x},${y})`);
});
