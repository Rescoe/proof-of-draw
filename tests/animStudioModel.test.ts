import test from "node:test";
import assert from "node:assert/strict";
import { BRUSHES } from "../lib/anim/brushes";
import { CLIP, validateClipInput } from "../lib/bench/clip";
import { BRUSHES_BY_MODE, MODES, TOOLS_BY_MODE, delayToFps, fpsToDelay, isMode, templateBall, templateWave, validBrush, validTool, type Mode } from "../app/animer/model";

const MODE_IDS = MODES.map((m) => m.id) as Mode[];

test("trois modes : Essentiel ⊂ Studio ⊆ Pro pour les outils et les brosses", () => {
  assert.deepEqual(MODE_IDS, ["essential", "studio", "pro"]);
  for (const t of TOOLS_BY_MODE.essential) assert.ok(TOOLS_BY_MODE.studio.includes(t));
  for (const t of TOOLS_BY_MODE.studio) assert.ok(TOOLS_BY_MODE.pro.includes(t));
  for (const b of BRUSHES_BY_MODE.essential) assert.ok(BRUSHES_BY_MODE.studio.includes(b));
  assert.ok(TOOLS_BY_MODE.essential.includes("pencil") && TOOLS_BY_MODE.essential.includes("eraser") && TOOLS_BY_MODE.essential.includes("fill"));
});

test("toutes les brosses déclarées existent, et Studio / Pro les offrent toutes", () => {
  const known = new Set(BRUSHES.map((b) => b.id));
  for (const m of MODE_IDS) for (const b of BRUSHES_BY_MODE[m]) assert.ok(known.has(b), `${m}/${b}`);
  assert.equal(BRUSHES_BY_MODE.studio.length, BRUSHES.length);
});

test("changer de mode ne laisse jamais un outil ou une brosse invalide", () => {
  assert.equal(validTool("ellipse", "essential"), "pencil", "l'ellipse n'existe pas en Essentiel : retour au crayon");
  assert.equal(validTool("ellipse", "studio"), "ellipse");
  assert.equal(validBrush("hatch", "essential"), "round");
  assert.equal(validBrush("hatch", "pro"), "hatch");
});

test("isMode refuse tout ce qui n'est pas un mode (brouillon ancien ou corrompu)", () => {
  assert.ok(isMode("pro"));
  for (const v of [undefined, null, "", "expert", 3, {}]) assert.equal(isMode(v), false);
});

test("vitesse : images/s ↔ délai, borné aux limites du clip", () => {
  assert.equal(fpsToDelay(10), 100);
  assert.equal(fpsToDelay(25), 40);
  assert.equal(fpsToDelay(1000), CLIP.MIN_DELAY_MS, "jamais sous le délai minimal du clip");
  assert.ok(fpsToDelay(1) <= CLIP.MAX_DELAY_MS);
  assert.equal(delayToFps(100), 10);
  assert.equal(delayToFps(5), 25, "borné à 25 i/s");
  for (let fps = 1; fps <= 25; fps++) assert.equal(delayToFps(fpsToDelay(fps)), fps, `aller-retour ${fps} i/s`);
});

test("modèles de départ : valides pour le codeur de clips (nombre d'images, taille d'image, délais)", () => {
  for (const make of [templateBall, templateWave]) {
    const a = make();
    assert.ok(a.frames.length >= 2 && a.frames.length <= CLIP.MAX_FRAMES);
    assert.equal(a.delays.length, a.frames.length);
    for (const f of a.frames) assert.equal(f.length, CLIP.FRAME_BYTES);
    assert.equal(validateClipInput({ frames: a.frames, delaysMs: a.delays, loops: 0, fg: 0x07e0, bg: 0 }), null);
  }
});
