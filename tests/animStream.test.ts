// tests/animStream.test.ts — LOT8B2E ANIM-STREAM-FIX1 : lecteur de clips PBC1 EN FLUX (arduino_uno_r4/pod_uno_r4/pod_bench_stream.h) compilé avec g++ et comparé
//   • au lecteur en RAM de référence (podbench::parse / podbench::play, pod_bench.h) : mêmes codes d'erreur sur des milliers de clips mutés (CRC re-signé ou non), mêmes fenêtres,
//     mêmes pixels, mêmes délais d'images (hôte, faux TFT) ;
//   • au décodeur TypeScript (lib/bench/clip.ts) : l'écran après chaque image = agrandissement ×15/8 ;
//   • discipline du bus SPI partagé : AUCUNE lecture de la source pendant une transaction TFT ; pannes de lecture : arrêt propre, jamais de dépassement.
// Sans compilateur C++ : ignoré (et le dit). NE PROUVE PAS : le débit de la carte SD, le tas réel, la pile réelle (voir docs/LOT_8B2E_ANIM_STREAM_FIX1_2026_10_13.md).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { CLIP, encodeClip, decodeClip, type ClipInput } from "../lib/bench/clip";
import { crc32 } from "../lib/scene/package";

const FW_DIR = path.join(__dirname, "..", "arduino_uno_r4", "pod_uno_r4");
const fwd = (p: string) => p.replace(/\\/g, "/");
function findCompiler(): string | null {
  for (const c of [process.env.CXX, "g++", "C:\\msys64\\mingw64\\bin\\g++.exe", "/usr/bin/g++", "/usr/local/bin/g++"].filter(Boolean) as string[]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* suivant */ }
  }
  return null;
}
const compiler = findCompiler();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "animstream-"));
const exe = path.join(tmp, process.platform === "win32" ? "bench_stream_harness.exe" : "bench_stream_harness");
const skip = compiler ? false : "aucun compilateur C++ (g++) trouvé : tests du lecteur de clips en flux ignorés — définir CXX pour les activer";

before(() => {
  if (!compiler) return;
  const r = spawnSync(compiler, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O2", fwd(path.join(FW_DIR, "host", "bench_stream_harness.cpp")), "-o", fwd(exe)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`compilation du lecteur en flux impossible :\n${r.stdout}\n${r.stderr}`);
});

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); }
const randFrame = (r: () => number, density: number) => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => (r() < density ? Math.floor(r() * 256) : 0));
const mk = (frames: Uint8Array[], extra: Partial<ClipInput> = {}): ClipInput => ({ frames, delaysMs: frames.map(() => 100), loops: 2, fg: 0x07e0, bg: 0x0842, ...extra });
let n = 0;
const hexFile = (bytes: Uint8Array) => { const f = path.join(tmp, `c${n++}.hex`); fs.writeFileSync(f, Buffer.from(bytes).toString("hex")); return f; };
const run = (args: string[]) => execFileSync(exe, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();

function expectedScreen(frame: Uint8Array, fg: number, bg: number): Buffer {
  const out = Buffer.alloc(240 * 320 * 2);
  for (let i = 0; i < 240 * 320; i++) { out[2 * i] = bg & 0xff; out[2 * i + 1] = bg >> 8; }
  for (let sy = 0; sy < 64; sy++) for (let sx = 0; sx < 128; sx++) {
    const on = (frame[sy * 16 + (sx >> 3)] >> (7 - (sx & 7))) & 1;
    const c = on ? fg : bg;
    for (let dy = Math.floor((sy * 15) / 8); dy < Math.floor(((sy + 1) * 15) / 8); dy++)
      for (let dx = Math.floor((sx * 15) / 8); dx < Math.floor(((sx + 1) * 15) / 8); dx++) { const o = ((100 + dy) * 240 + dx) * 2; out[o] = c & 0xff; out[o + 1] = c >> 8; }
  }
  return out;
}
function resign(c: Uint8Array): Uint8Array {
  const out = Uint8Array.from(c);
  if (out.length >= 4) new DataView(out.buffer).setUint32(out.length - 4, crc32(out.subarray(0, out.length - 4)), true);
  return out;
}

test("LECTURE EN FLUX : après chaque image l'écran = agrandissement de l'image attendue (N = 1, 2, 5, 12 ; boucles ; couleurs) ; aucune lecture de la carte pendant une transaction TFT", { skip }, () => {
  const r = rng(11);
  for (const [nFrames, loops] of [[1, 3], [2, 2], [5, 3], [12, 2]] as const) {
    const frames = Array.from({ length: nFrames }, () => randFrame(r, 0.12));
    const clip = encodeClip(mk(frames, { loops, delaysMs: frames.map(() => 50 + Math.floor(r() * 20) * 10), fg: 0xf81f, bg: 0x0842 }));
    const dec = decodeClip(clip);
    const res = spawnSync(exe, ["play", hexFile(clip)], { maxBuffer: 512 * 1024 * 1024 });
    assert.equal(res.status, 0, res.stderr?.toString());
    const m = /shown=(\d+) windows=(\d+) overflow=(\d+) underfill=(\d+) pixels=(\d+) begins=(\d+) readsInTxn=(\d+)/.exec(res.stderr.toString());
    assert.ok(m, "statistiques absentes");
    assert.equal(+m[3], 0, "pixel hors fenêtre ou hors transaction"); assert.equal(+m[4], 0, "fenêtre à moitié remplie");
    assert.equal(+m[1], nFrames * loops, "nombre d'images affichées");
    assert.equal(+m[7], 0, `N=${nFrames} : la carte a été lue pendant une transaction TFT (bus SPI partagé)`);
    const size = 240 * 320 * 2;
    for (let k = 0; k < +m[1]; k++)
      assert.ok(Buffer.compare(res.stdout.subarray(k * size, (k + 1) * size), expectedScreen(dec.frames[k % nFrames], dec.fg, dec.bg)) === 0, `N=${nFrames} image n°${k}`);
  }
});

test("EN BOUCLE (loops = 0) : le clip tourne sans fin jusqu'à l'arrêt du hook, retour à l'image 0 compris (plus de deux tours)", { skip }, () => {
  const r = rng(33);
  for (const nFrames of [1, 3, 5]) {
    const frames = Array.from({ length: nFrames }, () => randFrame(r, 0.1));
    const clip = encodeClip(mk(frames, { loops: 0 }));
    const dec = decodeClip(clip);
    const wanted = nFrames * 3 + 2;
    const res = spawnSync(exe, ["play", hexFile(clip), String(wanted)], { maxBuffer: 512 * 1024 * 1024 });
    assert.equal(res.status, 0);
    const shown = +/shown=(\d+)/.exec(res.stderr.toString())![1];
    assert.equal(shown, wanted);
    const size = 240 * 320 * 2;
    for (let k = 0; k < shown; k++) assert.ok(Buffer.compare(res.stdout.subarray(k * size, (k + 1) * size), expectedScreen(dec.frames[k % nFrames], dec.fg, dec.bg)) === 0, `N=${nFrames} image n°${k}`);
  }
});

test("ÉQUIVALENCE avec le lecteur en RAM (podbench::play) : mêmes fenêtres, mêmes pixels, mêmes délais — clips épars, denses, 64 images, bruit", { skip }, () => {
  const r = rng(5);
  const cases: Uint8Array[] = [];
  cases.push(encodeClip(mk([randFrame(r, 0.05), randFrame(r, 0.05)], { loops: 3 })));
  cases.push(encodeClip(mk(Array.from({ length: 6 }, () => randFrame(r, 1)), { loops: 2 })));                    // bruit : toute l'image change, transitions de plusieurs lots
  cases.push(encodeClip(mk(Array.from({ length: 64 }, () => randFrame(r, 0.03)), { loops: 2 })));                // MAX_FRAMES
  cases.push(encodeClip(mk([randFrame(r, 0.3)], { loops: 4 })));                                                  // image fixe
  cases.push(encodeClip(mk(Array.from({ length: 4 }, () => randFrame(r, 0.5)), { loops: 0 })));                   // infini, borné par le hook
  for (const [i, clip] of cases.entries()) {
    const out = run(["trace", hexFile(clip), "70"]);
    assert.match(out, /^SAME \d+ /, `clip n°${i} : ${out}`);
  }
});

test("TRANSACTIONS : des transitions éparses sont peintes en UNE transaction par image, comme le lecteur en RAM", { skip }, () => {
  const r = rng(21);
  const sparse = encodeClip(mk([randFrame(r, 0.02), randFrame(r, 0.02), randFrame(r, 0.02)], { loops: 1 }));
  const out = run(["trace", hexFile(sparse), "10"]);
  const m = /begins_ref=(\d+) begins_stream=(\d+)/.exec(out);
  assert.ok(m && +m[2] >= +m[1], out);
  assert.equal(+m![1], +m![2], "transitions éparses : même nombre de transactions que le lecteur en RAM (une par image)");
});

test("VALIDATION DIFFÉRENTIELLE : sur ~3 000 clips mutés (CRC re-signé ou non, tronqués), le lecteur en flux rend EXACTEMENT le code d'erreur de podbench::parse", { skip }, () => {
  const r = rng(77);
  const bases = [
    encodeClip(mk([randFrame(r, 0.1), randFrame(r, 0.1)], { loops: 1 })),
    encodeClip(mk([randFrame(r, 0.05), randFrame(r, 0.05), randFrame(r, 0.05), randFrame(r, 0.05)], { loops: 3 })),
    encodeClip(mk([randFrame(r, 0.2)], { loops: 2 })),
  ];
  const lines: string[] = [];
  for (const base of bases) {
    for (let k = 0; k < 1000; k++) {
      let m: Uint8Array = Uint8Array.from(base);
      const flips = 1 + Math.floor(r() * 3);
      for (let f = 0; f < flips; f++) {
        const pos = r() < 0.5 ? Math.floor(r() * (CLIP.HEADER_BYTES + 4)) : CLIP.HEADER_BYTES + 1 + CLIP.FRAME_BYTES + Math.floor(r() * Math.max(1, m.length - CLIP.HEADER_BYTES - 1 - CLIP.FRAME_BYTES - 4));
        m[Math.min(pos, m.length - 1)] = Math.floor(r() * 256);
      }
      if (r() < 0.15) m = m.slice(0, Math.max(1, m.length - 1 - Math.floor(r() * 12)));
      if (r() < 0.7) m = resign(m);                                                                     // 30 % : CRC volontairement faux
      lines.push(Buffer.from(m).toString("hex"));
    }
  }
  lines.push("", "00", "5042433100", Buffer.from(bases[0]).toString("hex"));
  const f = path.join(tmp, "batch.txt");
  fs.writeFileSync(f, lines.join("\n") + "\n");
  const out = execFileSync(exe, ["validate_batch", f], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split(/\r?\n/);
  assert.equal(out.length, lines.length);
  const kinds = new Set<string>();
  let ok = 0;
  for (let i = 0; i < out.length; i++) {
    const [a, b] = out[i].split(" ");
    assert.equal(b, a, `clip n°${i} : parse=${a} flux=${b}`);
    kinds.add(a); if (a === "OK") ok++;
  }
  assert.ok(ok > 30 && ok < out.length - 30, `jeu de mutations peu discriminant (${ok} acceptés sur ${out.length})`);
  for (const k of ["CRC", "BODY", "COUNTS", "SIZE"]) assert.ok(kinds.has(k), `le jeu n'exerce pas le code ${k}`);
});

test("ÉQUIVALENCE TS : le lecteur en flux accepte exactement les clips que decodeClip accepte", { skip }, () => {
  const r = rng(9);
  const base = encodeClip(mk([randFrame(r, 0.1), randFrame(r, 0.1), randFrame(r, 0.1)], { loops: 2 }));
  const lines: string[] = [], expected: boolean[] = [];
  for (let k = 0; k < 600; k++) {
    let m: Uint8Array = Uint8Array.from(base);
    m[Math.min(m.length - 5, CLIP.HEADER_BYTES + 1 + CLIP.FRAME_BYTES + Math.floor(r() * (m.length - CLIP.HEADER_BYTES - CLIP.FRAME_BYTES - 6)))] = Math.floor(r() * 256);
    m = resign(m);
    lines.push(Buffer.from(m).toString("hex"));
    let okTs = true; try { decodeClip(m); } catch { okTs = false; }
    expected.push(okTs);
  }
  const f = path.join(tmp, "batch2.txt"); fs.writeFileSync(f, lines.join("\n") + "\n");
  const out = execFileSync(exe, ["validate_batch", f], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split(/\r?\n/);
  for (let i = 0; i < out.length; i++) assert.equal(out[i].split(" ")[1] === "OK", expected[i], `clip muté n°${i} : ${out[i]}`);
});

test("PANNES DE LECTURE : la source échoue à la k-ième lecture (validation puis lecture) — arrêt propre (IO), jamais de dépassement, jamais de lecture pendant une transaction", { skip }, () => {
  const r = rng(3);
  const clip = encodeClip(mk([randFrame(r, 0.08), randFrame(r, 0.08), randFrame(r, 0.08)], { loops: 2 }));
  const f = hexFile(clip);
  for (const k of [1, 2, 3, 5, 8, 20, 60]) {
    const v = run(["fault", f, String(k), "v"]);
    assert.match(v, /^VALIDATE (IO|OK)$/, `validation, échec à la lecture ${k} : ${v}`);
  }
  let sawIo = 0;
  for (const k of [1, 2, 3, 4, 7, 15, 40, 120, 400]) {
    const p = run(["fault", f, String(k), "p"]);
    const m = /^PLAY (\d) overflow=(\d+) readsInTxn=(\d+)$/.exec(p);
    assert.ok(m, p);
    assert.equal(+m![2], 0, `lecture, échec à ${k} : pixels hors fenêtre`); assert.equal(+m![3], 0, `lecture, échec à ${k} : lecture pendant une transaction`);
    if (+m![1] === 2) sawIo++;
  }
  assert.ok(sawIo >= 3, "les pannes de lecture doivent produire PLAY_IO");
  assert.match(run(["fault", f, "100000", "p"]), /^PLAY 0 /, "sans panne atteinte, la lecture va jusqu'au bout (2 boucles)");
});

test("TAMPON : la lecture en flux ne lit jamais plus loin que la taille du clip et ne dépend pas de sa taille (tampon fixe 2 048 o)", { skip }, () => {
  const r = rng(4);
  const clip = encodeClip(mk(Array.from({ length: 40 }, () => randFrame(r, 0.2)), { loops: 1 }));
  assert.ok(clip.length > 8000, `clip de test trop petit (${clip.length} o)`);
  const res = spawnSync(exe, ["play", hexFile(clip)], { maxBuffer: 512 * 1024 * 1024 });
  assert.equal(res.status, 0);
  const maxPos = +/maxPos=(\d+)/.exec(res.stderr.toString())![1];
  assert.ok(maxPos <= clip.length, `lecture hors du clip (${maxPos} > ${clip.length})`);
  const header = fs.readFileSync(path.join(FW_DIR, "pod_bench_stream.h"), "utf8");
  assert.match(header, /#define PODBENCH_STREAM_BUF 1024u/);
  assert.doesNotMatch(header, /malloc|new \w|std::vector|String/);
});
