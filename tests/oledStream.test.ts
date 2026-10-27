// tests/oledStream.test.ts — OLED AUXILIAIRE du BWR 2,9″ (29/10/2026) : lecteur de clips PBC1 EN FLUX qui écrit DIRECTEMENT dans le tampon de l'OLED (esp8266/esp_eink_2.9BWR/pod_oled_stream.h),
// compilé avec g++ et comparé au décodeur TypeScript (lib/bench/clip.ts) : après chaque image, le tampon page-major de l'OLED == l'image attendue (octet par octet, empreinte CRC-32).
// Prouve : l'ordre des images (boucles, retour à l'image 0, boucles finies), l'indépendance vis-à-vis du découpage en tranches (source ROUVERTE à chaque appel), la RAM de lecture (un tampon de 256 octets),
// les pannes de lecture (T_IO, jamais de boucle). NE PROUVE PAS : le débit de LittleFS, l'I2C réel, le tas réel (canari de banc).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { CLIP, encodeClip, decodeClip, type ClipInput } from "../lib/bench/clip";
import { crc32 } from "../lib/scene/package";

const FW = path.join(__dirname, "..", "esp8266", "esp_eink_2.9BWR");
const fwd = (p: string) => p.replace(/\\/g, "/");
function findCompiler(): string | null {
  for (const c of [process.env.CXX, "g++", "C:\\msys64\\mingw64\\bin\\g++.exe", "/usr/bin/g++", "/usr/local/bin/g++"].filter(Boolean) as string[]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* suivant */ }
  }
  return null;
}
const compiler = findCompiler();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oledstream-"));
const exe = path.join(tmp, process.platform === "win32" ? "oled_stream_harness.exe" : "oled_stream_harness");
const skip = compiler ? false : "aucun compilateur C++ (g++) trouvé : tests du lecteur OLED en flux ignorés — définir CXX pour les activer";

before(() => {
  if (!compiler) return;
  const r = spawnSync(compiler, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O2", `-I${fwd(FW)}`, fwd(path.join(__dirname, "..", "consensus-pod", "host", "oled_stream_harness.cpp")), "-o", fwd(exe)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`compilation du lecteur OLED en flux impossible :\n${r.stdout}\n${r.stderr}`);
});

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); }
const randFrame = (r: () => number, density: number) => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => (r() < density ? Math.floor(r() * 256) : 0));
const mk = (frames: Uint8Array[], extra: Partial<ClipInput> = {}): ClipInput => ({ frames, delaysMs: frames.map(() => 100), loops: 2, fg: 0xffff, bg: 0, ...extra });
let n = 0;
const hexFile = (bytes: Uint8Array) => { const f = path.join(tmp, `c${n++}.hex`); fs.writeFileSync(f, Buffer.from(bytes).toString("hex")); return f; };
const run = (args: string[]) => spawnSync(exe, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** Image PBC1 (lignes de 16 octets, MSB à gauche) → tampon SSD1306 page-major (octet = x + 128·(y/8), bit = y%8). */
function ssdFrom(frame: Uint8Array): Buffer {
  const out = Buffer.alloc(1024);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if ((frame[y * 16 + (x >> 3)] >> (7 - (x & 7))) & 1) out[(y >> 3) * 128 + x] |= 1 << (y & 7);
  return out;
}
const crcHex = (b: Uint8Array) => (crc32(b) >>> 0).toString(16).padStart(8, "0");
/** Suite attendue : f0, f1…f(F-1), puis (f0, f1…f(F-1)) à chaque boucle suivante. */
function expectedSeq(frames: Uint8Array[], loops: number, count: number): string[] {
  const out: string[] = [];
  const F = frames.length;
  if (F === 1) return [crcHex(ssdFrom(frames[0]))];
  for (let l = 0; (loops === 0 ? out.length < count : l < loops); l++) for (let i = 0; i < F; i++) out.push(crcHex(ssdFrom(frames[i])));
  return out.slice(0, loops === 0 ? count : F * loops);
}
const shownList = (stdout: string) => stdout.split(/\r?\n/).filter((l) => l.startsWith("SHOWN ")).map((l) => l.split(" ")[2]);
const shownTimes = (stdout: string) => stdout.split(/\r?\n/).filter((l) => l.startsWith("SHOWN ")).map((l) => Number(l.split(" ")[3]));

test("OLED EN FLUX : après chaque image le tampon de l'OLED == l'image attendue (N = 1, 2, 3, 5, 12 ; boucles finies et infinie ; écran initial quelconque)", { skip }, () => {
  const r = rng(29);
  for (const [nFrames, loops] of [[1, 3], [2, 2], [3, 3], [5, 2], [12, 3], [5, 0], [2, 0]] as const) {
    const frames = Array.from({ length: nFrames }, () => randFrame(r, 0.12));
    const delays = frames.map(() => 50 + Math.floor(r() * 20) * 10);
    const clip = encodeClip(mk(frames, { loops, delaysMs: delays }));
    decodeClip(clip);                                                                    // le décodeur de référence l'accepte
    const count = loops === 0 ? nFrames * 3 + 2 : nFrames * loops;
    const res = run(["play", hexFile(clip), String(count), "10", "0"]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const got = shownList(res.stdout);
    const want = expectedSeq(frames, loops, count);
    assert.deepEqual(got.slice(0, want.length), want, `N=${nFrames} boucles=${loops}`);
    // le délai de CHAQUE image est respecté : image k affichée à 1000 + somme des délais des images précédentes (le délai suit l'image affichée)
    const times = shownTimes(res.stdout); let tt = 1000;
    for (let k = 0; k < Math.min(times.length, want.length); k++) { assert.equal(times[k], tt, `N=${nFrames} image ${k} : heure d'affichage`); tt += delays[k % nFrames]; }
    if (loops !== 0) assert.equal(got.length, want.length, "nombre d'images affichées = F × boucles (arrêt sur la dernière)");
  }
});

test("TRANCHES : la suite d'images est IDENTIQUE quel que soit le pas d'horloge et même si la source est ROUVERTE (position oubliée) à chaque appel", { skip }, () => {
  const r = rng(30);
  const frames = Array.from({ length: 6 }, () => randFrame(r, 0.2));
  const clip = hexFile(encodeClip(mk(frames, { loops: 3, delaysMs: [50, 80, 120, 50, 200, 90] })));
  const base = shownList(run(["play", clip, "18", "10", "0"]).stdout);
  assert.equal(base.length, 18);
  for (const [step, reopen] of [["1", "0"], ["1", "1"], ["37", "1"], ["150", "1"], ["999", "0"]] as const) {
    assert.deepEqual(shownList(run(["play", clip, "18", step, reopen]).stdout), base, `pas ${step} ms, réouverture ${reopen}`);
  }
  assert.deepEqual(base, expectedSeq(frames, 3, 18));
});

test("RAM : un seul tampon de lecture de 256 octets (aucune lecture plus grosse pendant la lecture) et un lecteur de moins de 64 octets ; le clip n'est jamais chargé", { skip }, () => {
  const r = rng(31);
  const frames = Array.from({ length: 12 }, () => randFrame(r, 0.3));
  const res = run(["play", hexFile(encodeClip(mk(frames, { loops: 2 }))), "24", "10", "1"]);
  assert.equal(res.status, 0);
  const max = Number(/MAXREAD (\d+)/.exec(res.stdout)?.[1]), ram = Number(/RAM (\d+)/.exec(res.stdout)?.[1]);
  assert.ok(max <= 256, `plus gros read pendant la lecture : ${max}`);
  assert.ok(ram <= 256 + 64, `RAM de lecture (tampon + état) : ${ram}`);
});

test("VALIDATION : un clip altéré est refusé avant toute lecture (mêmes codes que le décodeur) ; un clip valide donne 0", { skip }, () => {
  const r = rng(32);
  const frames = Array.from({ length: 4 }, () => randFrame(r, 0.15));
  const good = encodeClip(mk(frames));
  assert.match(run(["validate", hexFile(good)]).stdout, /VALID 0/);
  let refused = 0;
  for (let i = 0; i < 40; i++) {
    const bad = Uint8Array.from(good); bad[20 + Math.floor(r() * (bad.length - 24))] ^= 1 << Math.floor(r() * 8);
    let tsRefuses = false; try { decodeClip(bad); } catch { tsRefuses = true; }
    const code = Number(/VALID (\d+)/.exec(run(["validate", hexFile(bad)]).stdout)?.[1]);
    assert.equal(code !== 0, tsRefuses, `mutation ${i} : le lecteur en flux et le décodeur TypeScript doivent s'accorder`);
    if (tsRefuses) refused++;
  }
  assert.ok(refused >= 35, "la plupart des mutations sont détectées");
  assert.match(run(["validate", hexFile(good.slice(0, good.length - 7))]).stdout, /VALID [1-9]/, "clip tronqué");
});

test("PANNE DE LECTURE : la source qui échoue en cours de route donne T_IO (arrêt propre, aucune boucle sans fin)", { skip }, () => {
  const r = rng(33);
  const frames = Array.from({ length: 5 }, () => randFrame(r, 0.2));
  const clip = hexFile(encodeClip(mk(frames, { loops: 0 })));
  for (const after of [0, 100, 1024, 1500, 3000]) {
    const res = run(["fail", clip, String(after)]);
    assert.equal(res.status, 0, `échec après ${after} octets : ${res.stdout}`);
    assert.match(res.stdout, /FAIL tick=3/);
  }
});

test("BORNES : un run corrompu APRÈS validation (il sort de l'image) donne T_IO et n'écrit JAMAIS hors du tampon de l'OLED (64 sentinelles intactes)", { skip }, () => {
  const r = rng(34);
  const frames = Array.from({ length: 4 }, () => randFrame(r, 0.2));
  const res = run(["oob", hexFile(encodeClip(mk(frames, { loops: 0 })))]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /OOB tick=3 canary=1/);
});

test("portabilité : pod_oled_stream.h n'a ni Arduino.h, ni String, ni malloc, ni printf, ni Serial, ni delay ; seuls pod_bench.h et pod_bench_stream.h sont inclus", () => {
  const src = fs.readFileSync(path.join(FW, "pod_oled_stream.h"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const bad of [/Arduino\.h/, /\bString\b/, /\bmalloc\b|\bfree\(|\bnew\b/, /\bprintf\b/, /\bSerial\b/, /\bdelay\(/, /\bmillis\(/, /std::/]) assert.doesNotMatch(src, bad, String(bad));
  assert.deepEqual([...src.matchAll(/#include\s+"([^"]+)"/g)].map((m) => m[1]), ["pod_bench.h", "pod_bench_stream.h"]);
});
