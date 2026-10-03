// tests/podBenchR4.test.ts — le lecteur de clips du firmware R4 (arduino_uno_r4/pod_uno_r4/pod_bench.h) compilé avec g++ et comparé au
// codeur/décodeur TypeScript (lib/bench/clip.ts) :
//   • lecture complète (images, boucles, retour à l'image 0) : l'écran 240×320 après CHAQUE image = l'agrandissement ×15/8 de l'image attendue ;
//   • aucune fenêtre débordante ni à moitié remplie ; on ne repeint QUE les octets modifiés ;
//   • validation DIFFÉRENTIELLE : sur des milliers de clips mutés (CRC re-signé) le firmware accepte et refuse exactement comme le décodeur TS.
// Sans compilateur C++ : ignoré (et le dit) — jamais faussement vert.

import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { CLIP, encodeClip, decodeClip, type ClipInput } from "../lib/bench/clip";
import { crc32 } from "../lib/scene/package";

const FW_DIR = path.join(__dirname, "..", "arduino_uno_r4", "pod_uno_r4");
function findCompiler(): string | null {
  for (const c of [process.env.CXX, "g++", "C:\\msys64\\mingw64\\bin\\g++.exe", "/usr/bin/g++", "/usr/local/bin/g++"].filter(Boolean) as string[]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* suivant */ }
  }
  return null;
}
const compiler = findCompiler();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "podbench-"));
const exe = path.join(tmp, process.platform === "win32" ? "bench_harness.exe" : "bench_harness");
const skip = compiler ? false : "aucun compilateur C++ (g++) trouvé : tests du lecteur de clips R4 ignorés — définir CXX pour les activer";

before(() => {
  if (!compiler) return;
  const r = spawnSync(compiler, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O2", path.join(FW_DIR, "host", "bench_harness.cpp"), "-o", exe], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`compilation du lecteur de clips impossible :\n${r.stdout}\n${r.stderr}`);
});

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); }
const randFrame = (r: () => number, density: number) => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => (r() < density ? Math.floor(r() * 256) : 0));
const mk = (frames: Uint8Array[], extra: Partial<ClipInput> = {}): ClipInput => ({ frames, delaysMs: frames.map(() => 100), loops: 2, fg: 0x07e0, bg: 0x0842, ...extra });

let n = 0;
const hexFile = (bytes: Uint8Array) => { const f = path.join(tmp, `c${n++}.hex`); fs.writeFileSync(f, Buffer.from(bytes).toString("hex")); return f; };

// agrandissement de référence ×15/8 : le pixel source sx couvre les colonnes [⌊15sx/8⌋, ⌊15(sx+1)/8⌋), la ligne sy les lignes [⌊15sy/8⌋, ⌊15(sy+1)/8⌋)
function expectedScreen(frame: Uint8Array, fg: number, bg: number): Buffer {
  const out = Buffer.alloc(240 * 320 * 2);
  for (let i = 0; i < 240 * 320; i++) { out[2 * i] = bg & 0xff; out[2 * i + 1] = bg >> 8; }
  for (let sy = 0; sy < 64; sy++) for (let sx = 0; sx < 128; sx++) {
    const on = (frame[sy * 16 + (sx >> 3)] >> (7 - (sx & 7))) & 1;
    const c = on ? fg : bg;
    for (let dy = Math.floor((sy * 15) / 8); dy < Math.floor(((sy + 1) * 15) / 8); dy++)
      for (let dx = Math.floor((sx * 15) / 8); dx < Math.floor(((sx + 1) * 15) / 8); dx++) {
        const o = ((100 + dy) * 240 + dx) * 2; out[o] = c & 0xff; out[o + 1] = c >> 8;
      }
  }
  return out;
}

function play(clip: Uint8Array, maxFrames?: number) {
  const r = spawnSync(exe, ["play", hexFile(clip), ...(maxFrames ? [String(maxFrames)] : [])], { maxBuffer: 512 * 1024 * 1024 });
  assert.equal(r.status, 0, `harness: ${r.stderr?.toString()}`);
  const m = /shown=(\d+) windows=(\d+) overflow=(\d+) underfill=(\d+) pixels=(\d+) begins=(\d+)/.exec(r.stderr.toString());
  assert.ok(m, "statistiques absentes");
  return { screens: r.stdout as Buffer, shown: +m[1], windows: +m[2], overflow: +m[3], underfill: +m[4], pixels: +m[5], begins: +m[6] };
}

test("le zoom ×15/8 est exact : 8 pixels source = 15 pixels, 128 colonnes = 240, 64 lignes = 120", () => {
  assert.equal((8 * 15) / 8, 15);
  assert.equal(Math.floor((128 * 15) / 8), 240);
  assert.equal(Math.floor((64 * 15) / 8), 120);
  for (let b = 0; b < 16; b++) assert.equal(Math.floor((b * 8 * 15) / 8), 15 * b);   // chaque octet commence sur un multiple de 15
});

test("LECTURE : après chaque image l'écran = agrandissement de l'image attendue (N = 1, 2, 5, 12 ; boucles ; couleurs)", { skip }, () => {
  const r = rng(11);
  for (const [nFrames, loops] of [[1, 3], [2, 2], [5, 3], [12, 2]] as const) {
    const frames = Array.from({ length: nFrames }, () => randFrame(r, 0.12));
    const input = mk(frames, { loops, delaysMs: frames.map(() => 50 + Math.floor(r() * 20) * 10), fg: 0xf81f, bg: 0x0842 });
    const clip = encodeClip(input);
    const dec = decodeClip(clip);
    const res = play(clip);
    assert.equal(res.overflow, 0, `N=${nFrames} : pixel hors fenêtre`);
    assert.equal(res.underfill, 0, `N=${nFrames} : fenêtre à moitié remplie`);
    assert.equal(res.shown, nFrames * loops, `N=${nFrames} : nombre d'images affichées`);
    const size = 240 * 320 * 2;
    for (let k = 0; k < res.shown; k++) {
      const idx = k % nFrames;
      const expected = expectedScreen(dec.frames[idx], dec.fg, dec.bg);
      const got = res.screens.subarray(k * size, (k + 1) * size);
      assert.ok(Buffer.compare(got, expected) === 0, `N=${nFrames} image affichée n°${k} (image ${idx}) ≠ référence`);
    }
  }
});

test("MINIMAL : une image qui ne change presque pas ne repeint presque rien (pas de repeinte plein cadre)", { skip }, () => {
  const a = new Uint8Array(CLIP.FRAME_BYTES), b = Uint8Array.from(a); b[16 * 30 + 7] = 0xff;   // un seul octet change
  const res = play(encodeClip(mk([a, b], { loops: 1 })));
  const fullFrame = 240 * 120;
  // image 0 : plein cadre ; transition vers l'image 1 : 1 octet = 15 px × 2 lignes au plus
  assert.ok(res.pixels <= fullFrame + 15 * 2, `${res.pixels} pixels poussés (plein cadre = ${fullFrame})`);
  const res2 = play(encodeClip(mk([a, Uint8Array.from(a)], { loops: 4 })));
  assert.equal(res2.pixels, fullFrame, "images identiques : rien n'est repeint après la première");
});

test("PIRE CAS : tout change à chaque image (bruit) — correct quand même", { skip }, () => {
  const r = rng(5);
  const frames = [randFrame(r, 1), randFrame(r, 1), randFrame(r, 1)];
  const clip = encodeClip(mk(frames, { loops: 2 }));
  const dec = decodeClip(clip);
  const res = play(clip);
  assert.equal(res.overflow, 0); assert.equal(res.underfill, 0);
  const size = 240 * 320 * 2;
  for (let k = 0; k < res.shown; k++)
    assert.ok(Buffer.compare(res.screens.subarray(k * size, (k + 1) * size), expectedScreen(dec.frames[k % 3], dec.fg, dec.bg)) === 0, `image ${k}`);
});

test("PARSE : le firmware relit l'en-tête (images, boucles, couleurs) et refuse un clip altéré ou tronqué", { skip }, () => {
  const r = rng(2);
  const clip = encodeClip(mk([randFrame(r, 0.2), randFrame(r, 0.2), randFrame(r, 0.2)], { loops: 7, fg: 0xffe0, bg: 0x001f }));
  assert.equal(execFileSync(exe, ["parse", hexFile(clip)], { encoding: "utf8" }).trim(), `OK 3 7 ${0xffe0} ${0x001f}`);
  for (const i of [0, 4, 5, 10, 16, 18, 30, 500, clip.length - 1]) {
    const bad = Uint8Array.from(clip); bad[i] ^= 0x55;
    assert.match(execFileSync(exe, ["parse", hexFile(bad)], { encoding: "utf8" }), /^ERR/, `octet ${i}`);
  }
  assert.match(execFileSync(exe, ["parse", hexFile(clip.subarray(0, clip.length - 3))], { encoding: "utf8" }), /^ERR/);
});

function resign(c: Uint8Array): Uint8Array {
  const out = Uint8Array.from(c);
  if (out.length >= 4) new DataView(out.buffer).setUint32(out.length - 4, crc32(out.subarray(0, out.length - 4)), true);
  return out;
}

test("DIFFÉRENTIEL : sur ~2 000 clips mutés (CRC re-signé), le firmware accepte et refuse exactement comme le décodeur TS", { skip }, () => {
  const r = rng(77);
  const bases = [
    encodeClip(mk([randFrame(r, 0.1), randFrame(r, 0.1)], { loops: 1 })),
    encodeClip(mk([randFrame(r, 0.05), randFrame(r, 0.05), randFrame(r, 0.05), randFrame(r, 0.05)], { loops: 3 })),
    encodeClip(mk([randFrame(r, 0.2)], { loops: 2 })),
  ];
  const lines: string[] = [], expected: boolean[] = [];
  for (const base of bases) {
    for (let k = 0; k < 700; k++) {
      let m: Uint8Array = Uint8Array.from(base);
      const flips = 1 + Math.floor(r() * 3);
      for (let f = 0; f < flips; f++) {
        // les mutations visent surtout l'en-tête et les en-têtes de transition/run (zone « structure »), pas le contenu des images
        const pos = r() < 0.5 ? Math.floor(r() * (CLIP.HEADER_BYTES + 4)) : CLIP.HEADER_BYTES + 1 + CLIP.FRAME_BYTES + Math.floor(r() * Math.max(1, m.length - CLIP.HEADER_BYTES - 1 - CLIP.FRAME_BYTES - 4));
        m[Math.min(pos, m.length - 5)] = Math.floor(r() * 256);
      }
      if (r() < 0.15) m = m.slice(0, Math.max(1, m.length - 1 - Math.floor(r() * 12)));
      m = resign(m);
      lines.push(Buffer.from(m).toString("hex"));
      let ok = true;
      try { decodeClip(m); } catch { ok = false; }
      expected.push(ok);
    }
  }
  const f = path.join(tmp, "batch.txt");
  fs.writeFileSync(f, lines.join("\n") + "\n");
  const out = execFileSync(exe, ["validate_batch", f], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split("\n");
  assert.equal(out.length, lines.length);
  let accepted = 0;
  for (let i = 0; i < out.length; i++) {
    const fwOk = out[i] === "OK";
    if (fwOk) accepted++;
    assert.equal(fwOk, expected[i], `clip muté n°${i} : firmware=${out[i]} décodeur TS=${expected[i] ? "OK" : "refus"}`);
  }
  assert.ok(accepted > 20 && accepted < out.length - 20, `jeu de mutations peu discriminant (${accepted} acceptés sur ${out.length})`);
});

test("TRANSACTIONS : une seule transaction SPI par image affichée (et non une par fenêtre) — c'était un coût majeur sur la R4", { skip }, () => {
  const r = rng(21);
  const frames = Array.from({ length: 6 }, () => randFrame(r, 0.15));
  const res = play(encodeClip(mk(frames, { loops: 2 })));
  assert.equal(res.begins, res.shown, `${res.begins} transactions pour ${res.shown} images`);
  assert.ok(res.windows > res.shown * 4, "alors qu'il y a bien beaucoup plus de fenêtres d'adressage que d'images");
});

test("EN BOUCLE (loops = 0) : le clip tourne sans fin jusqu'à l'arrêt du hook ; chaque image affichée reste correcte, retour à l'image 0 compris", { skip }, () => {
  const r = rng(33);
  for (const nFrames of [1, 3, 5]) {
    const frames = Array.from({ length: nFrames }, () => randFrame(r, 0.1));
    const clip = encodeClip(mk(frames, { loops: 0 }));
    const dec = decodeClip(clip);
    assert.equal(dec.loops, 0);
    const wanted = nFrames * 3 + 2;                         // plus de deux tours complets : le retour à l'image 0 est exercé plusieurs fois
    const res = play(clip, wanted);
    assert.equal(res.shown, wanted, `N=${nFrames} : le hook arrête la lecture`);
    assert.equal(res.overflow, 0); assert.equal(res.underfill, 0);
    const size = 240 * 320 * 2;
    for (let k = 0; k < res.shown; k++)
      assert.ok(Buffer.compare(res.screens.subarray(k * size, (k + 1) * size), expectedScreen(dec.frames[k % nFrames], dec.fg, dec.bg)) === 0, `N=${nFrames} image affichée n°${k}`);
  }
});
