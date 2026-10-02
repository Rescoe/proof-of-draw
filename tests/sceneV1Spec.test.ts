// tests/sceneV1Spec.test.ts — contrat scene-v1 : constantes normatives, canonisation, hashes, validation stricte.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SIN_Q15_256, SIN_Q15_HASH, XORSHIFT32_SEED1_FIRST10, xorshift32, type AnaScene } from "../lib/scene/spec";
import { validateScene, canonicalizeScene, motionOffset } from "../lib/scene/validate";
import { hashSceneJson, hashSinTable, hashArtworkSource, hashGenerativeBundle } from "../lib/scene/hash";
import { ALL_SCENES, SCENES } from "./sceneFixtures";

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "scene-v1-golden.json"), "utf8"));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const base = (): AnaScene => clone(SCENES.static);
const reject = (mut: (s: Record<string, any>) => void, needle: string) => {
  const s = clone(SCENES.static) as unknown as Record<string, any>;
  mut(s);
  const r = validateScene(s);
  assert.equal(r.valid, false, `devrait être refusé : ${needle}`);
  assert.ok(r.errors.some((e) => e.includes(needle)), `erreur « ${needle} » attendue, reçu : ${r.errors.join(" | ")}`);
};

test("xorshift32 : graine 1, dix sorties exactes du contrat", () => {
  let x = 1;
  const out: number[] = [];
  for (let i = 0; i < 10; i++) { x = xorshift32(x); out.push(x); }
  assert.deepEqual(out, [...XORSHIFT32_SEED1_FIRST10]);
  assert.deepEqual(golden.xorshift32Seed1, out);
});

test("table sinus Q15 : 256 valeurs littérales, hash du contrat, == round(32767·sin(2πi/256))", () => {
  assert.equal(SIN_Q15_256.length, 256);
  assert.equal(hashSinTable(), SIN_Q15_HASH);
  assert.equal(golden.sinTable.sha256, SIN_Q15_HASH);
  for (let i = 0; i < 256; i++) assert.equal(SIN_Q15_256[i], Math.round(32767 * Math.sin((2 * Math.PI * i) / 256)), `index ${i}`);
});

test("toutes les scènes de référence sont valides et ≤ 4096 octets canoniques", () => {
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    const r = validateScene(scene);
    assert.ok(r.valid, `${name}: ${r.errors.join(" | ")}`);
    assert.ok(r.bytes! <= 4096, `${name}: ${r.bytes} octets`);
  }
  assert.equal(ALL_SCENES.full24.entities.length, 24);
});

test("interop ANA ↔ PoD : forme canonique et sceneHash identiques à ceux calculés par le code ANA (golden)", () => {
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    const g = golden.scenes[name];
    const r = validateScene(scene);
    assert.equal(r.canonicalJson, g.canonicalJson, `${name}: canonique`);
    assert.equal(hashSceneJson(r.canonicalJson!), g.sceneHash, `${name}: sceneHash`);
    assert.equal(r.bytes, g.canonicalBytes, `${name}: bytes`);
  }
});

test("interop ANA ↔ PoD : sourceHash et contentHash du bundle (avec / sans capture) identiques à ANA", () => {
  const b = golden.bundleExample;
  const sceneHash = golden.scenes.static.sceneHash;
  assert.equal(hashArtworkSource(b.artworkText), b.sourceHash);
  assert.equal(hashGenerativeBundle(b.sourceId, b.revision, b.sourceHash, sceneHash, b.captureHash), b.contentHashSceneAndCapture);
  assert.equal(hashGenerativeBundle(b.sourceId, b.revision, b.sourceHash, sceneHash, undefined), b.contentHashSceneOnly);
  assert.notEqual(b.contentHashSceneAndCapture, b.contentHashSceneOnly);
});

test("canonisation : indépendante de l'ordre des clés d'entrée, jamais d'espaces, ordre des entités/points conservé", () => {
  const scene = base();
  const shuffled = JSON.parse(JSON.stringify(scene, (_k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
  const r = validateScene(shuffled);
  assert.ok(r.valid);
  assert.equal(r.canonicalJson, canonicalizeScene(scene));
  assert.ok(!/\s/.test(r.canonicalJson!.replace(/"[^"]*"/g, "")));
  const reversed = { ...scene, entities: [...scene.entities].reverse() };
  assert.notEqual(canonicalizeScene(reversed), canonicalizeScene(scene), "l'ordre des entités est sémantique (z-order)");
});

test("rejets : clés inconnues à chaque niveau, clés manquantes", () => {
  reject((s) => { s.extra = 1; }, "unknown key extra");
  reject((s) => { s.entities[0].extra = 1; }, "unknown key extra");
  reject((s) => { s.entities[0].geometry.extra = 1; }, "unknown key extra");
  reject((s) => { s.entities[0].motion.extra = 1; }, "unknown key extra");
  reject((s) => { delete s.clear; }, "missing key clear");
  reject((s) => { delete s.entities[0].geometry.fill; }, "missing key fill");
});

test("rejets : flottants, NaN, chaînes numériques — jamais corrigés silencieusement", () => {
  reject((s) => { s.seed = 1.5; }, "scene.seed");
  reject((s) => { s.tickRate = 2.5; }, "scene.tickRate");
  reject((s) => { s.entities[0].geometry.x0 = 100.5; }, "x0");
  reject((s) => { s.entities[0].geometry.x0 = "100"; }, "x0");
  reject((s) => { s.palette[0] = NaN; }, "scene.palette[0]");
  reject((s) => { s.palette[1] = 65535.5; }, "scene.palette[1]");
});

test("rejets : bornes de l'en-tête (graine, cadence, durée, boucles, fond, schéma, clear)", () => {
  reject((s) => { s.seed = 0; }, "scene.seed");
  reject((s) => { s.seed = 0x1_0000_0000; }, "scene.seed");
  reject((s) => { s.tickRate = 0; }, "scene.tickRate");
  reject((s) => { s.tickRate = 6; }, "scene.tickRate");
  reject((s) => { s.durationTicks = 51; }, "scene.durationTicks");
  reject((s) => { s.loopCount = 4; }, "scene.loopCount");
  reject((s) => { s.backgroundIndex = 99; }, "scene.backgroundIndex");
  reject((s) => { s.clear = "gradient"; }, "scene.clear");
  reject((s) => { s.schema = "ana-scene-v2"; }, "scene.schema");
  reject((s) => { s.rendererVersion = 2; }, "rendererVersion");
});

test("rejets : palette (vide, > 8, hors RGB565), index de couleur", () => {
  reject((s) => { s.palette = []; }, "scene.palette");
  reject((s) => { s.palette = Array(9).fill(0); }, "scene.palette");
  reject((s) => { s.palette[0] = 70000; }, "scene.palette[0]");
  reject((s) => { s.entities[0].colorIndex = 99; }, "colorIndex");
});

test("rejets : entités (0, 25, ids dupliqués ou hors 0..23, primitive inconnue, type ≠ primitive)", () => {
  reject((s) => { s.entities = []; }, "scene.entities");
  reject((s) => { s.entities = Array.from({ length: 25 }, (_, i) => ({ ...clone(SCENES.static.entities[2]), id: i % 24 })); }, "scene.entities");
  reject((s) => { s.entities[1].id = s.entities[0].id; }, "duplicate id");
  reject((s) => { s.entities[0].id = 24; }, ".id");
  reject((s) => { s.entities[0].primitive = "star"; }, "unsupported primitive");
  reject((s) => { s.entities[0].geometry.type = "circle"; }, "must equal primitive");
});

test("rejets : géométries (rect inversé, cercle hors canevas, polyline 1 ou 17 points, largeur, taille)", () => {
  reject((s) => { s.entities[0].geometry.x0 = 40000; }, "rect bounds are reversed");
  reject((s) => { s.entities[1].geometry.cx = 60000; }, "circle exceeds normalized canvas");   // 60000 + 12000 > 65535
  reject((s) => { s.entities[2].geometry.size = 5; }, "size");
  reject((s) => { s.entities[3].geometry.width = 0; }, "width");
  const poly = (n: number) => (s: Record<string, any>) => {
    s.entities[0] = { id: 0, primitive: "polyline", colorIndex: 1, motion: { type: "static" },
      geometry: { type: "polyline", closed: false, width: 1, points: Array.from({ length: n }, (_, i) => ({ x: i * 100, y: i * 100 })) } };
  };
  reject(poly(1), "expected 2..16 points");
  reject(poly(17), "expected 2..16 points");
});

test("rejets : mouvements (période hors 2..durée, phase ≥ période, débordement du canevas, type inconnu, edge)", () => {
  const osc = (m: Record<string, unknown>) => (s: Record<string, any>) => { s.entities[0].motion = { type: "oscillate-x", amplitude: 100, period: 4, phase: 0, ...m }; };
  reject(osc({ period: 1 }), "period");
  reject(osc({ period: 11 }), "period");            // durationTicks = 10
  reject(osc({ phase: 4 }), "phase");
  reject(osc({ amplitude: 9000 }), "oscillation exceeds horizontal canvas");   // rect x0 = 8000
  reject((s) => { s.entities[0].motion = { type: "wobble" }; }, "unsupported motion");
  reject((s) => { s.entities[0].motion = { type: "linear", dx: 1, dy: 1, edge: "clamp" }; }, "edge");
  reject((s) => { s.entities[0].motion = { type: "linear", dx: 40000, dy: 0, edge: "wrap" }; }, "dx");
  reject((s) => { s.entities[1].motion = { type: "orbit", radiusX: 30000, radiusY: 10, period: 4, phase: 0 }; }, "orbit exceeds");
});

test("rejets : budget de 256 opérations logiques par tick", () => {
  reject((s) => {
    s.entities = Array.from({ length: 24 }, (_, i) => ({ id: i, primitive: "polyline", colorIndex: 1, motion: { type: "static" },
      geometry: { type: "polyline", closed: true, width: 1, points: Array.from({ length: 16 }, (_, k) => ({ x: 100 + k, y: 100 + k })) } }));
  }, "logical operations per tick exceeds 256");
});

test("rejet : JSON canonique > 4096 octets (budget d'opérations respecté)", () => {
  const s = clone(SCENES.oscillate) as unknown as Record<string, any>;
  s.durationTicks = 16;
  s.entities = Array.from({ length: 24 }, (_, i) => ({ id: i, primitive: "rect", colorIndex: 1,
    geometry: { type: "rect", x0: 20000 + i, y0: 20000 + i, x1: 21000 + i, y1: 21000 + i, fill: true },
    motion: { type: "oscillate-x", amplitude: 10000, period: 8, phase: i % 8 } }));
  const r = validateScene(s);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("canonical JSON is") && e.includes("maximum is 4096")), r.errors.join(" | "));
});

test("entrées absurdes : jamais d'exception", () => {
  for (const x of [null, undefined, 3, "x", [], {}, { schema: "ana-scene-v1" }, { entities: "x" }]) assert.doesNotThrow(() => validateScene(x));
  assert.equal(validateScene(null).valid, false);
});

test("mouvements entiers : oscillation, orbite, troncature vers zéro, linear non borné", () => {
  const ox = (period: number, phase: number, tick: number, amp = 32767) => motionOffset({ type: "oscillate-x", amplitude: amp, period, phase }, tick).x;
  assert.deepEqual([0, 1, 2, 3].map((t) => ox(4, 0, t)), [0, 32767, 0, -32767]);
  assert.equal(ox(4, 1, 0), 32767, "phase décale le tick");
  assert.equal(ox(2, 0, 1), 0, "période 2 : index 128 → sin = 0");
  assert.ok(motionOffset({ type: "oscillate-x", amplitude: 3, period: 256, phase: 0 }, 1).x === 0, "trunc(3·804/32767) = 0");
  // négatif : trunc(−3·804/32767) = 0 (vers zéro) et surtout PAS −1 (floor) — `=== 0` accepte −0
  assert.ok(motionOffset({ type: "oscillate-x", amplitude: 3, period: 256, phase: 0 }, 129).x === 0, "trunc vers zéro, pas floor");
  assert.equal(motionOffset({ type: "oscillate-x", amplitude: 32767, period: 256, phase: 0 }, 129).x, -804, "valeur négative exacte");
  const orbit = motionOffset({ type: "orbit", radiusX: 1000, radiusY: 500, period: 4, phase: 0 }, 0);
  assert.deepEqual(orbit, { x: 1000, y: 0 }, "tick 0 : cos = max, sin = 0");
  assert.deepEqual(motionOffset({ type: "orbit", radiusX: 1000, radiusY: 500, period: 4, phase: 0 }, 1), { x: 0, y: 500 });
  assert.deepEqual(motionOffset({ type: "linear", dx: -300, dy: 40, edge: "wrap" }, 7), { x: -2100, y: 280 });
  assert.deepEqual(motionOffset({ type: "static" }, 9), { x: 0, y: 0 });
});
