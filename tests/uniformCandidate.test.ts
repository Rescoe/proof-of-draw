// 28/10/2026 — un candidat RÉELLEMENT uniforme est refusé dès la soumission ; un fond noir ou coloré avec des traits (cas du 27/10) ne l'est PAS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { METRIC_GRID, metricsFromRaw, rawIsUniform, type PodScreen } from "../lib/podMetrics";

const WHITE = 0xffff, BLACK = 0x0000, GOLD = 0xfea0;
function tft(screen: "tft18" | "tft28", f: (x: number, y: number) => number): Uint8Array {
  const { w, h } = METRIC_GRID[screen];
  const b = new Uint8Array(w * h * 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); b[2 * (y * w + x)] = v & 0xff; b[2 * (y * w + x) + 1] = v >> 8; }
  return b;
}
const strokes = (bg: number, fg: number) => (x: number, y: number) => ((y === 40 && x > 10 && x < 90) || (x === 60 && y > 30 && y < 120) ? fg : bg);

test("écran couleur : blanc, noir et couleur unis sont uniformes ; noir + traits colorés, noir + traits blancs, un seul pixel ne le sont pas", () => {
  for (const s of ["tft18", "tft28"] as const) {
    assert.equal(rawIsUniform(s, tft(s, () => WHITE)), true, `${s} blanc`);
    assert.equal(rawIsUniform(s, tft(s, () => BLACK)), true, `${s} noir`);
    assert.equal(rawIsUniform(s, tft(s, () => GOLD)), true, `${s} doré`);
    assert.equal(rawIsUniform(s, tft(s, strokes(BLACK, GOLD))), false, `${s} noir + traits colorés (le cas du 27/10)`);
    assert.equal(rawIsUniform(s, tft(s, strokes(BLACK, WHITE))), false, `${s} noir + traits blancs`);
    assert.equal(rawIsUniform(s, tft(s, (x, y) => (x === 3 && y === 3 ? GOLD : BLACK))), false, `${s} un seul pixel`);
  }
  // la projection binaire seule se trompe pour ce cas : c'est la raison d'être de la règle
  const case27 = tft("tft18", strokes(BLACK, GOLD));
  const m = metricsFromRaw("tft18", case27);
  assert.deepEqual([m.e, m.t], [0, 0], "la projection « encre = ≠ blanc » donne e = t = 0");
  assert.equal(rawIsUniform("tft18", case27), false, "mais l'image n'est pas uniforme");
});

test("autres écrans : e-ink / OLED vides sont uniformes, avec un trait ils ne le sont plus", () => {
  const eink27 = new Uint8Array(METRIC_GRID.eink27bw.rawBytes).fill(0xff);
  assert.equal(rawIsUniform("eink27bw", eink27), true);
  const withDot = eink27.slice(); withDot[100] = 0x7f;
  assert.equal(rawIsUniform("eink27bw", withDot), false);
  assert.equal(rawIsUniform("oled096", new Uint8Array(1024)), true);
  const o = new Uint8Array(1024); o[10] = 1;
  assert.equal(rawIsUniform("oled096" as PodScreen, o), false);
});

test("câblage : submit-candidate refuse l'image uniforme (400, rejected, uniform_image) AVANT de créer le candidat, sauf animation", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app/api/submit-candidate/route.ts"), "utf8");
  const i = src.indexOf("rawIsUniform("), create = src.indexOf("submittedAt: Date.now()");
  assert.ok(i > 0 && create > i, "la vérification précède la création du candidat");
  assert.match(src, /if \(v2\) \{\s*let uniform = false;/, "ne concerne que les dessins statiques (v2), pas les animations");
  assert.match(src, /rejected: true, reason: "uniform_image"[^}]*\}, \{ status: 400 \}/);
});
