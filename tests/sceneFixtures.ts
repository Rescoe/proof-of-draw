// tests/sceneFixtures.ts — scènes de référence scene-v1 partagées par les tests et le générateur de golden vectors.
// Chacune DOIT passer validateScene() (vérifié dans tests/sceneV1Spec.test.ts). Ne pas modifier sans régénérer
// tests/fixtures/scene-v1-golden.json (voir tests/fixtures/scene-v1-golden.generate.ts) ET prévenir le binôme firmware.

import type { AnaScene, SceneEntity } from "../lib/scene/spec";

const BLACK = 0x0000, WHITE = 0xffff, RED = 0xf800, GREEN = 0x07e0, BLUE = 0x001f, YELLOW = 0xffe0;
const PALETTE = [BLACK, WHITE, RED, GREEN, BLUE, YELLOW];

const base = (over: Partial<AnaScene> & Pick<AnaScene, "entities">): AnaScene => ({
  schema: "ana-scene-v1", rendererVersion: 1, seed: 1, tickRate: 5, durationTicks: 10, loopCount: 1,
  backgroundIndex: 0, palette: PALETTE, clear: "solid", ...over,
});

const ent = (id: number, primitive: SceneEntity["primitive"], colorIndex: number, geometry: SceneEntity["geometry"], motion: SceneEntity["motion"] = { type: "static" }): SceneEntity =>
  ({ id, primitive, colorIndex, geometry, motion });

export const SCENES: Record<string, AnaScene> = {
  static: base({
    seed: 0xdeadbeef,
    entities: [
      ent(0, "rect", 1, { type: "rect", x0: 8000, y0: 8000, x1: 30000, y1: 20000, fill: true }),
      ent(1, "circle", 2, { type: "circle", cx: 32768, cy: 32768, r: 12000, fill: false }),
      ent(2, "point", 3, { type: "point", x: 60000, y: 5000, size: 3 }),
      ent(3, "line", 4, { type: "line", x1: 2000, y1: 60000, x2: 63000, y2: 50000, width: 2 }),
      ent(4, "circle", 5, { type: "circle", cx: 50000, cy: 40000, r: 6000, fill: true }),
    ],
  }),

  linearWrap: base({
    seed: 42, durationTicks: 20, tickRate: 4, loopCount: 2,
    entities: [
      ent(0, "point", 1, { type: "point", x: 1000, y: 30000, size: 4 }, { type: "linear", dx: 3000, dy: 1000, edge: "wrap" }),
      ent(1, "rect", 2, { type: "rect", x0: 20000, y0: 20000, x1: 26000, y1: 26000, fill: true }, { type: "linear", dx: -2500, dy: 700, edge: "wrap" }),
      ent(2, "line", 3, { type: "line", x1: 5000, y1: 5000, x2: 12000, y2: 9000, width: 1 }, { type: "linear", dx: 4000, dy: 0, edge: "wrap" }),
    ],
  }),

  oscillate: base({
    seed: 7, durationTicks: 16, tickRate: 5, loopCount: 3,
    entities: [
      ent(0, "rect", 1, { type: "rect", x0: 24000, y0: 10000, x1: 40000, y1: 18000, fill: true }, { type: "oscillate-x", amplitude: 15000, period: 8, phase: 0 }),
      ent(1, "circle", 3, { type: "circle", cx: 32768, cy: 40000, r: 5000, fill: true }, { type: "oscillate-y", amplitude: 12000, period: 16, phase: 5 }),
      ent(2, "point", 5, { type: "point", x: 32768, y: 60000, size: 2 }, { type: "oscillate-x", amplitude: 30000, period: 5, phase: 3 }),
    ],
  }),

  orbit: base({
    seed: 99, durationTicks: 24, tickRate: 5, loopCount: 1, backgroundIndex: 4,
    entities: [
      ent(0, "circle", 5, { type: "circle", cx: 32768, cy: 32768, r: 4000, fill: true }, { type: "orbit", radiusX: 22000, radiusY: 12000, period: 24, phase: 0 }),
      ent(1, "point", 1, { type: "point", x: 32768, y: 32768, size: 3 }, { type: "orbit", radiusX: 9000, radiusY: 9000, period: 12, phase: 4 }),
      ent(2, "circle", 2, { type: "circle", cx: 32768, cy: 32768, r: 2000, fill: false }),
    ],
  }),

  polyline: base({
    seed: 12345, durationTicks: 12, tickRate: 3, loopCount: 2,
    entities: [
      ent(0, "polyline", 5, {
        type: "polyline", closed: true, width: 2,
        points: [{ x: 32768, y: 6000 }, { x: 40000, y: 26000 }, { x: 60000, y: 26000 }, { x: 44000, y: 38000 }, { x: 50000, y: 58000 }],
      }, { type: "oscillate-x", amplitude: 4000, period: 12, phase: 2 }),
      ent(1, "polyline", 3, {
        type: "polyline", closed: false, width: 1,
        points: [{ x: 5000, y: 50000 }, { x: 20000, y: 40000 }, { x: 30000, y: 58000 }],
      }),
    ],
  }),
};

// Scène « pleine charge » : 24 entités, toutes primitives et tous mouvements, budget ≤ 256 opérations logiques.
function fullScene(): AnaScene {
  // 24 entités au plafond ; la limite binding est le JSON canonique ≤ 4 096 octets, d'où des motions parcimonieuses.
  const entities: SceneEntity[] = [];
  let id = 0;
  for (let i = 0; i < 10; i++) {
    entities.push(ent(id++, "point", 1 + (i % 5), { type: "point", x: 4000 + i * 6000, y: 4000 + ((i * 9000) % 50000), size: 1 + (i % 4) },
      i === 1 ? { type: "linear", dx: 500 + i * 100, dy: -300, edge: "wrap" } : { type: "static" }));
  }
  for (let i = 0; i < 5; i++) {
    entities.push(ent(id++, "line", 2 + (i % 4), { type: "line", x1: 3000 + i * 3000, y1: 3000, x2: 62000 - i * 4000, y2: 60000 - i * 2000, width: 1 + (i % 4) },
      i === 0 ? { type: "oscillate-y", amplitude: 2000, period: 10, phase: i } : { type: "static" }));
  }
  for (let i = 0; i < 3; i++) {
    entities.push(ent(id++, "rect", 1 + i, { type: "rect", x0: 10000 + i * 9000, y0: 12000 + i * 6000, x1: 18000 + i * 9000, y1: 20000 + i * 6000, fill: i % 2 === 0 },
      i < 2 ? { type: "oscillate-x", amplitude: 6000, period: 12, phase: i * 3 } : { type: "static" }));
  }
  for (let i = 0; i < 3; i++) {
    entities.push(ent(id++, "circle", 2 + i, { type: "circle", cx: 20000 + i * 12000, cy: 30000, r: 5000 + i * 1500, fill: i === 1 },
      i < 2 ? { type: "orbit", radiusX: 8000, radiusY: 6000, period: 20, phase: i * 6 } : { type: "static" }));
  }
  for (let i = 0; i < 3; i++) {
    entities.push(ent(id++, "polyline", 3 + (i % 3), {
      type: "polyline", closed: i % 2 === 0, width: 1 + i,
      points: [{ x: 8000 + i * 1000, y: 8000 }, { x: 22000, y: 14000 + i * 5000 }, { x: 14000, y: 30000 }],
    }));
  }
  return base({ seed: 20261002, durationTicks: 50, tickRate: 5, loopCount: 3, entities });
}

export const FULL_SCENE = fullScene();
export const ALL_SCENES: Record<string, AnaScene> = { ...SCENES, full24: FULL_SCENE };
