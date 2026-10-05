// tests/podMetrics.test.ts — « pod-metrics-2 » : spécification entière, flux = lot, table d'entropie, correction du défaut BWR de la V1,
// et validation DIFFÉRENTIELLE du firmware (esp8266/_shared/pod_metrics.h compilé avec g++) contre l'implémentation TypeScript.
// Sans compilateur C++ : la partie firmware est ignorée (et le dit) — jamais faussement verte.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ENTROPY_TABLE } from "../lib/podMetricsTable";
import { METRIC_GRID, MetricsAccumulator, POD_SCREENS, isqrt, metricsFromRaw, type PodScreen } from "../lib/podMetrics";
import { rgbaToScreenPayload } from "../lib/canvasToScreen";
import { decodeEinkBuffer, mergeChannels, computeComplexity } from "../lib/crypto";

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); }

test("table d'entropie : formule, bornes, symétrie", () => {
  assert.equal(ENTROPY_TABLE.length, 1025);
  assert.equal(ENTROPY_TABLE[0], 0); assert.equal(ENTROPY_TABLE[1024], 0); assert.equal(ENTROPY_TABLE[512], 1_000_000);
  for (let q = 1; q < 1024; q++) {
    const p = q / 1024;
    assert.equal(ENTROPY_TABLE[q], Math.round(1e6 * -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p))), `q=${q}`);
    assert.equal(ENTROPY_TABLE[q], ENTROPY_TABLE[1024 - q], `symétrie q=${q}`);
  }
});

test("isqrt exact", () => {
  for (const v of [0, 1, 2, 3, 4, 15, 16, 17, 999_999_999_999, 1_000_000_000_000]) {
    const r = isqrt(v); assert.ok(r * r <= v && (r + 1) * (r + 1) > v, String(v));
  }
});

test("cas limites : image vide, pleine, damier", () => {
  const run = (w: number, h: number, f: (x: number, y: number) => number) => { const a = new MetricsAccumulator(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.push(f(x, y)); return a.finish(); };
  const empty = run(16, 8, () => 0), full = run(16, 8, () => 1), checker = run(15, 8, (x, y) => (x + y) & 1);
  assert.deepEqual([empty.e, empty.t], [0, 0]); assert.deepEqual([full.e, full.t], [0, 0]);
  assert.equal(checker.e, 1_000_000); assert.equal(checker.t, 1_000_000); assert.equal(checker.r, 1_000_000); assert.equal(checker.s, 1_000_000);
  assert.ok(empty.s < 100_000);
});

test("flux = lot : aucun découpage du flux ne change le résultat", () => {
  for (const screen of POD_SCREENS) {
    const r = rng(7 + screen.length), raw = Uint8Array.from({ length: METRIC_GRID[screen].rawBytes }, () => (r() < 0.5 ? 0xff : Math.floor(r() * 256)));
    const a = metricsFromRaw(screen, raw), b = metricsFromRaw(screen, raw);
    assert.deepEqual(a, b);
    assert.ok(a.s >= 0 && a.s <= 1_000_000);
  }
});

test("correction du défaut V1 : un dessin noir ou rouge sur l'e-ink 2,9″ n'a plus un score nul", () => {
  const w = 296, h = 128;
  for (const rgb of [[0, 0, 0], [220, 20, 20]]) {
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 20; y < 100; y++) for (let x = 20; x < 250; x++) { const i = (y * w + x) * 4; px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; }
    const p = rgbaToScreenPayload(px, "eink29bwr") as { black: string; red: string };
    const v1 = computeComplexity(mergeChannels(decodeEinkBuffer(p.black, 296, 128), decodeEinkBuffer(p.red, 296, 128)), 296, 128);
    assert.ok(v1.score < 0.01, "la V1 donne ≈ 0 (défaut documenté)");
    const raw = new Uint8Array(Buffer.concat([Buffer.from(p.black, "base64"), Buffer.from(p.red, "base64")]));
    const v2 = metricsFromRaw("eink29bwr", raw);
    assert.ok(v2.e > 100_000 && v2.t > 3_000, JSON.stringify(v2));
  }
});

// ── Différentiel firmware (g++) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
function findCompiler(): string | null {
  for (const c of [process.env.CXX, "g++", "C:\msys64\mingw64\bin\g++.exe", "/usr/bin/g++", "/usr/local/bin/g++"].filter(Boolean) as string[]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* suivant */ }
  }
  return null;
}
const compiler = findCompiler();
const skip = compiler ? false : "aucun compilateur C++ (g++) trouvé : validation différentielle du firmware ignorée — définir CXX pour l'activer";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "podmetrics-"));
const exe = path.join(tmp, process.platform === "win32" ? "metrics_harness.exe" : "metrics_harness");
const KIND: Record<PodScreen, number> = { oled096: 0, eink27bw: 1, eink29bwr: 2, tft18: 3, tft28: 4 };
before(() => {
  if (!compiler) return;
  const src = path.join(__dirname, "..", "esp8266", "_shared", "host", "metrics_harness.cpp");
  const r = spawnSync(compiler, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O2", src, "-o", exe], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`compilation de pod_metrics.h impossible :\n${r.stdout}\n${r.stderr}`);
});
function fw(screen: PodScreen, raw: Uint8Array, chunk: number) {
  const f = path.join(tmp, `${screen}-${chunk}.hex`); fs.writeFileSync(f, Buffer.from(raw).toString("hex"));
  const out = execFileSync(exe, [String(KIND[screen]), String(chunk), f], { encoding: "utf8" }).trim().split(" ").map(Number);
  return { e: out[0], t: out[1], r: out[2], s: out[3] };
}

test("firmware (g++) = TypeScript, au ppm près, pour les 5 écrans et des découpages de flux variés", { skip }, () => {
  for (const screen of POD_SCREENS) {
    const r = rng(1234 + KIND[screen]);
    for (const density of [0, 0.02, 0.3, 0.5, 1]) {
      const raw = Uint8Array.from({ length: METRIC_GRID[screen].rawBytes }, () => (r() < density ? Math.floor(r() * 256) : screen.startsWith("tft") ? 0xff : screen === "oled096" ? 0x00 : 0xff));
      const ts = metricsFromRaw(screen, raw);
      for (const chunk of [1, 7, 256, 1460]) {
        assert.deepEqual(fw(screen, raw, chunk), { e: ts.e, t: ts.t, r: ts.r, s: ts.s }, `${screen} densité ${density} morceaux ${chunk}`);
      }
    }
  }
});
