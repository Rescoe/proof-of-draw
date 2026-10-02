// tests/sceneV1Engine.test.ts — moteur de référence scene-v1 : golden vectors, déterminisme, primitives, endurance sans E/S.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  toPixel, bresenham, midpointCircle, renderSceneIndices, indicesToRgb565LE, indicesToOledBuffer, indicesToPosterGray,
  indicesToRgba, renderPosterGray, posterTick, playbackMs, dirtyRectBetween, prevTickOf,
} from "../lib/scene/engine";
import { PACKAGE_PROFILE_DIMENSIONS, type ScenePackageProfile } from "../lib/scene/package";
import { encodeForScreen } from "../lib/screenEncode";
import { SCREEN_PROFILES } from "../lib/screenProfiles";
import type { AnaScene } from "../lib/scene/spec";
import { ALL_SCENES } from "./sceneFixtures";

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "scene-v1-golden.json"), "utf8"));
const sha = (b: Uint8Array | string) => createHash("sha256").update(b as never).digest("hex");

const mini = (over: Partial<AnaScene>): AnaScene => ({
  schema: "ana-scene-v1", rendererVersion: 1, seed: 1, tickRate: 5, durationTicks: 10, loopCount: 1, backgroundIndex: 0,
  palette: [0x0000, 0xffff, 0xf800], clear: "solid", entities: [], ...over,
});

function frameHash(scene: AnaScene, profile: ScenePackageProfile, tick: number): string {
  const { width, height } = PACKAGE_PROFILE_DIMENSIONS[profile];
  const idx = renderSceneIndices(scene, width, height, tick);
  return sha(profile === "oled096"
    ? indicesToOledBuffer(idx, width, height, scene.palette, scene.backgroundIndex)
    : indicesToRgb565LE(idx, scene.palette));
}

test("GOLDEN : framebuffers OLED et TFT aux ticks 0, 1, milieu, dernier — identiques aux vecteurs normatifs", () => {
  let checked = 0;
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    for (const profile of ["oled096", "tft18"] as ScenePackageProfile[]) {
      const expected = golden.scenes[name].profiles[profile].frameSha256ByTick as Record<string, string>;
      for (const [tick, hash] of Object.entries(expected)) {
        assert.equal(frameHash(scene, profile, Number(tick)), hash, `${name} ${profile} tick ${tick}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 6 * 2 * 3, `trop peu de vecteurs comparés (${checked})`);
});

test("GOLDEN : poster e-ink (2.7\" et 2.9\") produit par le même moteur puis par le chemin frame existant", () => {
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    for (const screen of ["eink27bw", "eink29bwr"] as const) {
      const p = SCREEN_PROFILES[screen];
      const enc = encodeForScreen(renderPosterGray(scene, p.width, p.height), p.width, p.height, screen) as Record<string, string>;
      assert.equal(sha(Object.values(enc).join("|")), golden.scenes[name].posterFrameSha256[screen], `${name} ${screen}`);
    }
    assert.equal(golden.scenes[name].posterTick, posterTick(scene));
  }
});

test("déterminisme : une frame est une fonction pure de (scène, taille, tick) — ordre d'appel sans effet", () => {
  const scene = ALL_SCENES.full24;
  const forward = Array.from({ length: scene.durationTicks }, (_, t) => sha(renderSceneIndices(scene, 128, 64, t)));
  const backward = Array.from({ length: scene.durationTicks }, (_, i) => sha(renderSceneIndices(scene, 128, 64, scene.durationTicks - 1 - i))).reverse();
  assert.deepEqual(forward, backward);
  const again = renderSceneIndices(scene, 128, 64, 17);
  assert.deepEqual(Array.from(again), Array.from(renderSceneIndices(scene, 128, 64, 17)));
});

test("toPixel : floor(c·(extent−1)/65535), extrémités exactes", () => {
  assert.equal(toPixel(0, 128), 0);
  assert.equal(toPixel(65535, 128), 127);
  assert.equal(toPixel(65535, 160), 159);
  assert.equal(toPixel(32768, 128), 63);   // floor(32768·127/65535) = 63
  assert.equal(toPixel(516, 128), 0);      // 516·127/65535 = 0.99995…
  assert.equal(toPixel(517, 128), 1);
});

test("Bresenham : extrémités incluses, tous octants, un pixel par pas du grand axe", () => {
  const trace = (a: number, b: number, c: number, d: number) => { const p: string[] = []; bresenham(a, b, c, d, (x, y) => p.push(`${x},${y}`)); return p; };
  for (const [x0, y0, x1, y1] of [[0, 0, 7, 3], [0, 0, 3, 7], [7, 3, 0, 0], [0, 7, 7, 0], [5, 5, 5, 5], [9, 2, 2, 9], [0, 0, 10, 0], [4, 0, 4, 10]]) {
    const p = trace(x0, y0, x1, y1);
    assert.equal(p[0], `${x0},${y0}`);
    assert.equal(p[p.length - 1], `${x1},${y1}`);
    assert.equal(p.length, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1, "un pixel par pas du grand axe");
  }
  assert.deepEqual(trace(0, 0, 5, 2), ["0,0", "1,0", "2,1", "3,1", "4,2", "5,2"]);
});

test("midpoint circle : r=0 = un pixel, symétrique aux 8 octants, plein ⊇ contour", () => {
  const collect = (r: number, fill: boolean) => { const s = new Set<string>(); midpointCircle((x, y) => s.add(`${x},${y}`), 0, 0, r, fill); return s; };
  assert.deepEqual([...collect(0, false)], ["0,0"]);
  for (const r of [1, 2, 3, 5, 8, 13]) {
    const outline = collect(r, false), filled = collect(r, true);
    for (const k of outline) {
      const [x, y] = k.split(",").map(Number);
      for (const [a, b] of [[-x, y], [x, -y], [-x, -y], [y, x]]) assert.ok(outline.has(`${a},${b}`), `r=${r} symétrie ${k}`);
      assert.ok(filled.has(k), `r=${r} plein ⊇ contour ${k}`);
    }
    assert.ok(outline.has(`${r},0`) && outline.has(`0,${r}`) && outline.has(`${-r},0`) && outline.has(`0,${-r}`));
  }
  assert.equal(collect(3, true).size, 37, "disque plein r=3 : 37 pixels (rangées 3-5-7-7-7-5-3 — valeur figée de la variante midpoint)");
});

test("z-order : une entité plus tardive recouvre la précédente", () => {
  const s = mini({ entities: [
    { id: 0, primitive: "rect", colorIndex: 1, geometry: { type: "rect", x0: 0, y0: 0, x1: 65535, y1: 65535, fill: true }, motion: { type: "static" } },
    { id: 1, primitive: "point", colorIndex: 2, geometry: { type: "point", x: 32768, y: 32768, size: 1 }, motion: { type: "static" } },
  ] });
  const idx = renderSceneIndices(s, 128, 64, 0);
  assert.equal(idx[toPixel(32768, 64) * 128 + toPixel(32768, 128)], 2);
  assert.equal(idx[0], 1);
  const reversed = mini({ entities: [s.entities[1], { ...s.entities[0], id: 1 }] });
  assert.equal(renderSceneIndices(reversed, 128, 64, 0)[toPixel(32768, 64) * 128 + toPixel(32768, 128)], 1);
});

test("tampon des points et traits : size/width 1 = 1 px, 2 = x−1..x, 3 = x−1..x+1, 4 = x−2..x+1", () => {
  for (const [size, from, to] of [[1, 0, 0], [2, -1, 0], [3, -1, 1], [4, -2, 1]] as const) {
    const s = mini({ entities: [{ id: 0, primitive: "point", colorIndex: 1, geometry: { type: "point", x: 32768, y: 32768, size }, motion: { type: "static" } }] });
    const idx = renderSceneIndices(s, 128, 64, 0);
    const cx = toPixel(32768, 128), cy = toPixel(32768, 64);
    const lit: number[] = [];
    for (let x = 0; x < 128; x++) if (idx[cy * 128 + x] === 1) lit.push(x - cx);
    assert.deepEqual([lit[0], lit[lit.length - 1]], [from, to], `size ${size}`);
    assert.equal(idx.filter((v) => v === 1).length, size * size);
  }
});

test("linear + wrap : le sujet ressort de l'autre côté (tore), jamais rogné", () => {
  const s = mini({ durationTicks: 20, entities: [{ id: 0, primitive: "point", colorIndex: 1, geometry: { type: "point", x: 1000, y: 30000, size: 1 }, motion: { type: "linear", dx: 4000, dy: 0, edge: "wrap" } }] });
  const xAt = (tick: number) => { const idx = renderSceneIndices(s, 128, 64, tick); const i = idx.indexOf(1); return i < 0 ? -1 : i % 128; };
  const xs = Array.from({ length: 20 }, (_, t) => xAt(t));
  assert.ok(xs.every((x) => x >= 0), "toujours visible");
  assert.ok(xs.some((x, i) => i > 0 && x < xs[i - 1]), "retombe à gauche après avoir franchi le bord droit");
  assert.equal(xs[0], toPixel(1000, 128));
});

test("hors canevas sans wrap : rogné sans exception ni écriture hors buffer", () => {
  const s = mini({ entities: [{ id: 0, primitive: "point", colorIndex: 1, geometry: { type: "point", x: 65535, y: 65535, size: 4 }, motion: { type: "static" } }] });
  const idx = renderSceneIndices(s, 128, 64, 0);
  assert.equal(idx.length, 128 * 64);
  assert.equal(idx[63 * 128 + 127], 1);
  assert.equal(idx.filter((v) => v === 1).length, 9, "carré 4×4 décalé de (−2..+1) rogné à 3×3 dans le coin");
});

test("conversions : OLED page-major bit = allumé, poster = encre si ≠ fond, RGB565 little-endian", () => {
  const idx = new Uint8Array(128 * 64);
  idx[9 * 128 + 3] = 1;                       // pixel (3, 9)
  const oled = indicesToOledBuffer(idx, 128, 64, [0x0000, 0xffff], 0);
  assert.equal(oled.length, 1024);
  assert.equal(oled[1 * 128 + 3], 1 << 1, "page 1, bit 1");
  assert.equal(oled.filter((b) => b !== 0).length, 1);

  // « ≠ fond » se juge sur la COULEUR, pas sur l'index : deux entrées de palette identiques = même couleur
  const g = indicesToPosterGray(Uint8Array.from([0, 1, 2]), [0x1234, 0x1234, 0xffff], 0);
  assert.deepEqual(Array.from(g), [255, 255, 0]);

  const rgb = indicesToRgb565LE(Uint8Array.from([0, 1, 2]), [0xffff, 0xf800, 0x001f]);
  assert.deepEqual(Array.from(rgb), [0xff, 0xff, 0x00, 0xf8, 0x1f, 0x00]);   // blanc, rouge = 00 F8, bleu = 1F 00

  const rgba = indicesToRgba(Uint8Array.from([0, 1]), [0xffff, 0x0000]);
  assert.deepEqual(Array.from(rgba), [255, 255, 255, 255, 0, 0, 0, 255]);
});

test("durée de lecture : ticks × boucles / cadence, et poster = milieu de l'animation", () => {
  assert.equal(playbackMs(mini({ durationTicks: 50, loopCount: 3, tickRate: 5 })), 30000);
  assert.equal(playbackMs(mini({ durationTicks: 7, loopCount: 1, tickRate: 3 })), 2334);
  assert.equal(posterTick(mini({ durationTicks: 1 })), 0);
  assert.equal(posterTick(mini({ durationTicks: 11 })), 5);
});

test("ENDURANCE 10 s et 30 min : zéro Redis, zéro HTTP par frame (moteur pur, aucun accès E/S)", () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((...a: unknown[]) => { calls.push(`fetch ${String(a[0])}`); throw new Error("réseau interdit pendant PLAY"); }) as typeof fetch;
  try {
    const scene = ALL_SCENES.full24;
    const play = (fps: number, seconds: number, profile: ScenePackageProfile) => {
      const { width, height } = PACKAGE_PROFILE_DIMENSIONS[profile];
      const frames = fps * seconds;
      let acc = 0;
      for (let f = 0; f < frames; f++) acc ^= renderSceneIndices(scene, width, height, f % scene.durationTicks)[f % (width * height)];
      return { frames, acc };
    };
    assert.equal(play(5, 10, "oled096").frames, 50);
    assert.equal(play(2, 10, "tft18").frames, 20);
    assert.equal(play(5, 1800, "oled096").frames, 9000);   // 30 min OLED
    assert.equal(play(2, 1800, "tft18").frames, 3600);     // 30 min TFT
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(calls, [], "aucun appel réseau pendant la lecture");
});

test("RECTANGLES SALES : redessiner la frame complète puis ne retransmettre que le rectangle = la frame de référence (tous ticks, boucle comprise)", () => {
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    for (const [w, h] of [[128, 64], [128, 160]] as const) {
      // « écran » = ce que le TFT contient : frame du tick 0 entière, puis uniquement les rectangles reçus
      let screen = renderSceneIndices(scene, w, h, 0);
      for (let step = 1; step <= scene.durationTicks * 2; step++) {
        const tick = step % scene.durationTicks, prev = prevTickOf(scene, tick);
        const rect = dirtyRectBetween(scene, w, h, prev, tick);
        const next = renderSceneIndices(scene, w, h, tick);
        const updated = Uint8Array.from(screen);
        if (rect) for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) updated[y * w + x] = next[y * w + x];
        assert.deepEqual(Array.from(updated), Array.from(next), `${name} ${w}x${h} tick ${tick} rect ${JSON.stringify(rect)}`);
        screen = updated;
      }
    }
  }
});

test("rectangles sales : null quand rien ne bouge, bornés au canevas, bien plus petits que l'écran pour un mouvement local", () => {
  assert.equal(dirtyRectBetween(ALL_SCENES.static, 128, 160, 0, 1), null, "scène statique : aucun octet à envoyer");
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    for (let t = 0; t < scene.durationTicks; t++) {
      const r = dirtyRectBetween(scene, 128, 160, prevTickOf(scene, t), t);
      if (r) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 128 && r.y + r.h <= 160 && r.w > 0 && r.h > 0, `${name} ${t}`);
    }
  }
  const osc = dirtyRectBetween(ALL_SCENES.oscillate, 128, 160, 0, 1)!;
  assert.ok(osc.w * osc.h < 128 * 160, "mouvement local : moins que l'écran entier");
});
