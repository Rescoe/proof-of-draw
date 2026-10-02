// tests/sceneV1Delivery.test.ts — capacité appareil, choix frame|scene, artefact Redis unique, budget de commandes.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSceneCapability, selectDelivery, withoutScenePointer, artifactIdFor, buildScenePointer, capabilityClassOf,
  scenePullMeta, sceneRetryAfterSec, isSceneScreen, SCENE_CAPABILITY_CLASSES, effectiveFps, playMsFor,
} from "../lib/scene/delivery";
import { compileSceneArtifacts, getScenePackage, putScenePackage, packageKey, type SceneKV } from "../lib/scene/store";
import { unpackScene, packScene } from "../lib/scene/package";
import { validateScene } from "../lib/scene/validate";
import { hashSceneJson } from "../lib/scene/hash";
import { ALL_SCENES } from "./sceneFixtures";
import type { SceneCapability } from "../lib/scene/spec";

const CAP: SceneCapability = { sceneV1: true, maxPackageBytes: 4096, maxEntities: 24, maxFps: 5, dirtyRectangles: false, firmwareVersion: "oled-1" };
const CONTENT_HASH = "sha256:" + "ab".repeat(32);

/** Faux Redis : compte chaque commande — les budgets du contrat sont des assertions, pas des promesses. */
function fakeKV() {
  const data = new Map<string, string>();
  const log: string[] = [];
  const kv: SceneKV = {
    async set(key, value, opts) {
      log.push(`SET ${key}${opts?.nx ? " NX" : ""}`);
      if (opts?.nx && data.has(key)) return null;
      data.set(key, value);
      return "OK";
    },
    async get(key) { log.push(`GET ${key}`); return data.get(key) ?? null; },
  };
  return { kv, data, log };
}

async function compiled(name = "static", kv: SceneKV = fakeKV().kv) {
  const scene = ALL_SCENES[name];
  const sceneHash = hashSceneJson(validateScene(scene).canonicalJson!);
  const pointers = await compileSceneArtifacts(kv, { scene, sceneHash, contentHash: CONTENT_HASH });
  return { scene, sceneHash, pointers };
}

test("capacité appareil : n'accepte QUE la forme exacte ; tout le reste = pas de scene-v1 (jamais d'erreur)", () => {
  assert.deepEqual(parseSceneCapability(CAP), CAP);
  for (const bad of [null, undefined, 1, "x", [], {}, { ...CAP, sceneV1: false }, { ...CAP, sceneV1: "true" }, { ...CAP, maxPackageBytes: 8192 },
    { ...CAP, maxEntities: 48 }, { ...CAP, maxFps: 10 }, { ...CAP, maxFps: 3 }, { ...CAP, dirtyRectangles: "oui" }]) {
    assert.equal(parseSceneCapability(bad), undefined, JSON.stringify(bad));
  }
  assert.equal(parseSceneCapability({ ...CAP, firmwareVersion: "x".repeat(200) })!.firmwareVersion.length, 32, "version tronquée");
});

test("écrans : seuls oled096 et tft18 savent animer ; les e-ink n'en reçoivent jamais", () => {
  assert.ok(isSceneScreen("oled096") && isSceneScreen("tft18"));
  assert.ok(!isSceneScreen("eink27bw") && !isSceneScreen("eink29bwr") && !isSceneScreen("x"));
});

test("choix frame|scene : appareil sans capability, e-ink, capability insuffisante, pointeur absent → toujours frame", async () => {
  const { pointers } = await compiled();
  const payloadOled = { screen: "oled096", buffer: "AAAA", scene: pointers.oled096 };
  const payloadTft = { screen: "tft18", buffer: "AAAA", scene: pointers.tft18 };

  assert.equal(selectDelivery({}, "oled096", payloadOled).kind, "frame", "firmware sans scene-v1");
  assert.equal(selectDelivery({ sceneCapability: { ...CAP, sceneV1: false } }, "oled096", payloadOled).kind, "frame");
  assert.equal(selectDelivery({ sceneCapability: CAP }, "eink27bw", { ...payloadOled, screen: "eink27bw" }).kind, "frame", "e-ink : jamais de scène");
  assert.equal(selectDelivery({ sceneCapability: CAP }, "eink29bwr", payloadOled).kind, "frame");
  assert.equal(selectDelivery({ sceneCapability: CAP }, "oled096", { screen: "oled096", buffer: "AAAA" }).kind, "frame", "aucun pointeur (scène invalide / absente)");
  assert.equal(selectDelivery({ sceneCapability: CAP }, null, payloadOled).kind, "frame");

  const oled = selectDelivery({ sceneCapability: CAP }, "oled096", payloadOled);
  assert.equal(oled.kind, "scene");
  if (oled.kind === "scene") assert.equal(oled.artifactId, artifactIdFor(CONTENT_HASH, "oled096", 1, "f5"));

  // TFT compilé en classe f2 : un appareil f5 n'y est pas éligible (aucun artefact de sa classe) → frame ; un f2 l'est
  assert.equal(selectDelivery({ sceneCapability: CAP }, "tft18", payloadTft).kind, "frame");
  assert.equal(selectDelivery({ sceneCapability: { ...CAP, maxFps: 2 } }, "tft18", payloadTft).kind, "scene");
});

test("capacité insuffisante : trop d'entités ou paquet trop gros pour l'appareil → frame", async () => {
  const { pointers } = await compiled("full24");           // 24 entités
  const payload = { screen: "oled096", scene: pointers.oled096 };
  assert.equal(selectDelivery({ sceneCapability: CAP }, "oled096", payload).kind, "scene");
  assert.equal(selectDelivery({ sceneCapability: { ...CAP, maxEntities: 12 } as unknown as SceneCapability }, "oled096", payload).kind, "frame");
  assert.equal(selectDelivery({ sceneCapability: { ...CAP, maxPackageBytes: 200 } as unknown as SceneCapability }, "oled096", payload).kind, "frame");
});

test("cadence : l'appareil joue à min(tickRate, maxFps), SANS sauter de tick — durée et retryAfter en tiennent compte", async () => {
  const { pointers } = await compiled("static");           // tickRate 5, 10 ticks, 1 boucle
  const tftPayload = { screen: "tft18", scene: pointers.tft18 };
  const slow = selectDelivery({ sceneCapability: { ...CAP, maxFps: 2 } }, "tft18", tftPayload);
  assert.equal(slow.kind, "scene");
  if (slow.kind !== "scene") return;
  assert.equal(slow.fps, 2, "TFT 2 FPS sur scène 5 ticks/s");
  assert.equal(slow.playMs, 5000, "10 ticks à 2 FPS = 5 s (pas 2 s)");
  assert.equal(scenePullMeta(slow).fps, 2);
  assert.equal(sceneRetryAfterSec(slow), 35, "5 s + 30 s de marge — aucun poll pendant PLAY");

  const fast = selectDelivery({ sceneCapability: CAP }, "oled096", { screen: "oled096", scene: pointers.oled096 });
  assert.equal(fast.kind === "scene" && fast.fps, 5);
  assert.equal(fast.kind === "scene" && fast.playMs, 2000);

  // scène plus lente que l'appareil : on ne l'accélère jamais
  assert.equal(effectiveFps({ tickRate: 1 }, { maxFps: 5 }), 1);
  assert.equal(playMsFor({ durationTicks: 50, loopCount: 3, tickRate: 3 }, { maxFps: 5 }), 50000);
  assert.equal(playMsFor({ durationTicks: 50, loopCount: 3, tickRate: 5 }, { maxFps: 2 }), 75000);
});

test("pointeur : ≤ 400 octets, aucun pixel ni paquet ; le JSON léger de /api/pull ne contient JAMAIS le pointeur", async () => {
  const { pointers } = await compiled("full24");
  const pointer = pointers.oled096;
  assert.ok(JSON.stringify(pointer).length < 400, `pointeur ${JSON.stringify(pointer).length} o`);
  const stripped = withoutScenePointer({ screen: "oled096", workTitle: "T", scene: pointer });
  assert.deepEqual(Object.keys(stripped).sort(), ["screen", "workTitle"]);

  const sel = selectDelivery({ sceneCapability: CAP }, "oled096", { screen: "oled096", scene: pointer });
  assert.equal(sel.kind, "scene");
  if (sel.kind !== "scene") return;
  const meta = scenePullMeta(sel);
  assert.ok(JSON.stringify(meta).length < 280, `bloc scene de /api/pull : ${JSON.stringify(meta).length} o`);
  assert.deepEqual(Object.keys(meta).sort(), ["artifactId", "bytes", "durationTicks", "fps", "hash", "loopCount", "playMs", "tickRate"]);
  assert.equal(sceneRetryAfterSec(sel), Math.ceil(sel.playMs / 1000) + 30, "retryAfter = durée complète + marge");
});

test("artifactId déterministe : (contentHash, profil, rendererVersion, classe) — change si l'un d'eux change", () => {
  const id = artifactIdFor(CONTENT_HASH, "oled096", 1, "f5");
  assert.equal(id, artifactIdFor(CONTENT_HASH, "oled096", 1, "f5"));
  for (const other of [artifactIdFor("sha256:" + "cd".repeat(32), "oled096", 1, "f5"), artifactIdFor(CONTENT_HASH, "tft18", 1, "f5"),
    artifactIdFor(CONTENT_HASH, "oled096", 2, "f5"), artifactIdFor(CONTENT_HASH, "oled096", 1, "f4")]) assert.notEqual(other, id);
  assert.equal(capabilityClassOf({ maxFps: 4 }), "f4");
});

test("COMPILATION UNIQUE : 1 écriture SET NX par (profil, classe) ; relancer ne réécrit rien", async () => {
  const { kv, data, log } = fakeKV();
  await compiled("full24", kv);
  const expectedKeys = Object.entries(SCENE_CAPABILITY_CLASSES).flatMap(([p, classes]) => classes.map((c) => packageKey(artifactIdFor(CONTENT_HASH, p as "oled096" | "tft18", 1, c))));
  assert.equal(data.size, expectedKeys.length);
  assert.deepEqual([...data.keys()].sort(), expectedKeys.sort());
  assert.equal(log.length, expectedKeys.length, "une commande par artefact, aucune lecture");
  assert.ok(log.every((l) => l.includes("NX")));

  const first = new Map(data);
  await compiled("full24", kv);                      // second passage (reprise d'ingestion)
  assert.deepEqual([...data.entries()], [...first.entries()], "rien n'est écrasé");
});

test("paquet stocké : un seul par artefact, ≤ 4 Ko, relu en UNE commande GET et décodable", async () => {
  const { kv, data, log } = fakeKV();
  const { scene, sceneHash } = await compiled("polyline", kv);
  const id = artifactIdFor(CONTENT_HASH, "oled096", 1, "f5");
  assert.ok(Buffer.from(data.get(packageKey(id))!, "base64").length <= 4096);

  log.length = 0;
  const pkg = await getScenePackage(kv, id);
  assert.deepEqual(log, [`GET ${packageKey(id)}`], "une seule commande pour télécharger le paquet");
  const r = unpackScene(pkg!);
  assert.ok(r.ok);
  assert.deepEqual(Array.from(pkg!), Array.from(packScene(scene, "oled096", sceneHash)));
  assert.equal(await getScenePackage(kv, "sc:absent"), null);
});

test("nouvel appareil compatible : réutilise le MÊME artefact, zéro recompilation, zéro écriture", async () => {
  const { kv, log } = fakeKV();
  const { pointers } = await compiled("orbit", kv);
  log.length = 0;
  const a = selectDelivery({ sceneCapability: CAP }, "oled096", { screen: "oled096", scene: pointers.oled096 });
  const b = selectDelivery({ sceneCapability: { ...CAP, firmwareVersion: "autre" } }, "oled096", { screen: "oled096", scene: pointers.oled096 });
  assert.equal(a.kind, "scene"); assert.equal(b.kind, "scene");
  if (a.kind === "scene" && b.kind === "scene") assert.equal(a.artifactId, b.artifactId);
  assert.deepEqual(log, [], "le choix de livraison ne touche pas Redis (la frame et le device sont déjà lus par /api/pull)");
});

test("putScenePackage : idempotent (SET NX) et signale written / exists", async () => {
  const { kv } = fakeKV();
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(await putScenePackage(kv, "sc:x", bytes), "written");
  assert.equal(await putScenePackage(kv, "sc:x", new Uint8Array([9, 9, 9])), "exists");
  assert.deepEqual(Array.from((await getScenePackage(kv, "sc:x"))!), [1, 2, 3]);
});

test("buildScenePointer : toutes les classes du profil, sans octet de paquet", async () => {
  const scene = ALL_SCENES.linearWrap;
  const p = buildScenePointer(scene, "sha256:" + "11".repeat(32), CONTENT_HASH, "tft18", 300);
  assert.deepEqual(Object.keys(p.artifactIds), [...SCENE_CAPABILITY_CLASSES.tft18]);
  assert.equal(p.playMs, Math.ceil((scene.durationTicks * scene.loopCount * 1000) / scene.tickRate));
  assert.equal(p.entityCount, scene.entities.length);
});
