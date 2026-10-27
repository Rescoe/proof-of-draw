// LOT 3 (28/10/2026) — le rejet « blank » du candidat TFT 1,8″ du 27/10 (« Les animations ne sont pas encore v2!!! »).
// Constat serveur (archive Redis lue en lecture seule) : la spécification v2 du serveur pour ce candidat est e = 0, t = 0, r = 6987 — IDENTIQUE à ce que la R4 a calculé : il n'y a PAS de divergence
// TypeScript / C++. La « projection » d'un écran couleur est binaire (pixel ≠ blanc pur = encre) : un fond noir ou coloré avec des traits colorés (aucun pixel blanc) devient « tout encre » => e = t = 0.
// Les firmwares ESP décidaient déjà « blank » par l'uniformité RÉELLE des pixels (`uniformTft`) ; les six en-têtes R4 (`pod_vote_r4.h`) utilisaient la projection seule => faux refus. Ce test fige les deux faits.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { metricsFromRaw } from "../lib/podMetrics";

const root = path.join(__dirname, "..");
const W = 128, H = 160;
const BLACK = 0x0000, WHITE = 0xffff, GOLD = 0xfea0, RED = 0xf800, BLUE = 0x001f;

/** RGB565 petit-boutiste, 128×160. */
function image(f: (x: number, y: number) => number): Uint8Array {
  const b = new Uint8Array(W * H * 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f(x, y); const i = 2 * (y * W + x); b[i] = v & 0xff; b[i + 1] = v >> 8; }
  return b;
}
const strokes = (bg: number, fg: number) => image((x, y) => ((x >= 20 && x < 90 && y === 40) || (x === 60 && y >= 30 && y < 120) ? fg : bg));
const CASES: { name: string; raw: Uint8Array; uniform: boolean; projectionBlank: boolean }[] = [
  { name: "fond blanc vide", raw: image(() => WHITE), uniform: true, projectionBlank: true },
  { name: "fond noir vide", raw: image(() => BLACK), uniform: true, projectionBlank: true },
  { name: "fond doré uni", raw: image(() => GOLD), uniform: true, projectionBlank: true },
  { name: "noir + traits blancs", raw: strokes(BLACK, WHITE), uniform: false, projectionBlank: false },
  { name: "blanc + traits noirs", raw: strokes(WHITE, BLACK), uniform: false, projectionBlank: false },
  { name: "NOIR + TRAITS COLORÉS (aucun pixel blanc) — la classe du rejet du 27/10", raw: strokes(BLACK, GOLD), uniform: false, projectionBlank: true },
  { name: "bleu + traits rouges", raw: strokes(BLUE, RED), uniform: false, projectionBlank: true },
  { name: "un seul pixel noir sur blanc", raw: image((x, y) => (x === 5 && y === 5 ? BLACK : WHITE)), uniform: false, projectionBlank: false },
  { name: "un seul pixel doré sur noir", raw: image((x, y) => (x === 5 && y === 5 ? GOLD : BLACK)), uniform: false, projectionBlank: true },
  { name: "dessin dense aléatoire", raw: (() => { let s = 12345; return image(() => ((s = (s * 1664525 + 1013904223) >>> 0) >>> 16) & 0xffff); })(), uniform: false, projectionBlank: false },
];

const cc = findCompiler();
test("TFT 1,8″ : métriques TypeScript = C++ (pod_metrics.h réel) sur dix contenus, et la règle « blank » par uniformité réelle", { skip: cc.path ? false : describeChoice(cc) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tftblank-"));
  const exe = path.join(dir, "h");
  const r0 = runProcess(cc.path as string, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-o", exe, path.join(root, "consensus-pod/host/tft_blank_harness.cpp")], 60000);
  assert.equal(r0.status, 0, `${r0.stdout}\n${r0.stderr}`);
  const files = CASES.map((c, i) => { const f = path.join(dir, `c${i}.hex`); fs.writeFileSync(f, Buffer.from(c.raw).toString("hex")); return f; });
  const r = runProcess(exe, ["3", ...files], 60000);
  assert.equal(r.status, 0, r.stdout);
  const out = r.stdout.trim().split(/\r?\n/);
  assert.equal(out.length, CASES.length);
  CASES.forEach((c, i) => {
    const [e, t, rr, s, uni] = out[i].split(" ").map(Number);
    const ts = metricsFromRaw("tft18", c.raw);
    assert.deepEqual([e, t, rr, s], [ts.e, ts.t, ts.r, ts.s], `${c.name} : C++ = TypeScript`);
    assert.equal(uni === 1, c.uniform, `${c.name} : uniformité réelle des pixels`);
    const projectionBlank = ts.e === 0 && ts.t === 0;
    assert.equal(projectionBlank, c.projectionBlank, `${c.name} : projection « encre = ≠ blanc »`);
    const blankNew = c.uniform;                                                   // règle des firmwares corrigés : écran couleur => pixels tous identiques
    if (c.name.startsWith("NOIR + TRAITS COLORÉS")) {
      assert.equal(projectionBlank, true, "l'ancienne règle R4 (e = t = 0) rejetait ce dessin");
      assert.equal(blankNew, false, "la règle corrigée l'accepte : ce n'est pas une image vide");
      assert.deepEqual([e, t], [0, 0]);
    }
  });
});

test("verdict « blank » : la même expression dans les six en-têtes R4 ET dans les cinq en-têtes ESP (écran couleur = uniformité réelle des pixels)", () => {
  const RULE = 'if (c.tft ? c.uniformTft : (c.m.e == 0 && c.m.t == 0)) return "blank";';
  const files = [
    "arduino_uno_r4/pod_uno_r4/pod_vote_r4.h", "arduino_uno_r4/pod_uno_r4_eink27/pod_vote_r4.h", "arduino_uno_r4/pod_uno_r4_eink27_oled/pod_vote_r4.h", "arduino_uno_r4/pod_uno_r4_eink29/pod_vote_r4.h",
    "arduino_uno_r4/pod_uno_r4_tft18/pod_vote_r4.h", "arduino_uno_r4/pod_uno_r4_tft18_env/pod_vote_r4.h",
    "esp8266/_shared/pod_vote_esp.h", "esp8266/esp_eink_2.7BW/pod_vote_esp.h", "esp8266/esp_eink_2.7BW_OLED/pod_vote_esp.h", "esp8266/esp_eink_2.9BWR/pod_vote_esp.h", "esp8266/esp_tft1.8/pod_vote_esp.h",
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
    assert.ok(src.includes(RULE), `${f} : règle blank`);
    assert.match(src, /out->uniformTft = feeder\.isUniformTft\(\);/, `${f} : uniformTft renseigné`);
    assert.match(src, /out->tft = kind == POD_TFT18 \|\| kind == POD_TFT28;/, `${f} : tft renseigné`);
  }
});
