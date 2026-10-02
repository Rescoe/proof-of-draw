// tests/sceneV1Feed.test.ts — lecture du bundle générative ANA (scène ± capture) et revalidation stricte côté PoD.
import test from "node:test";
import assert from "node:assert/strict";
import { parseFeedItem } from "../lib/anaFeedItem";
import { validateScene } from "../lib/scene/validate";
import { hashSceneJson, hashArtworkSource, hashGenerativeBundle } from "../lib/scene/hash";
import { SCENES } from "./sceneFixtures";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const ARTWORK = "<!DOCTYPE html><html><body><canvas></canvas></body></html>";

interface Opts { scene?: boolean; capture?: boolean; kind?: string; revision?: number; sceneName?: keyof typeof SCENES }

/** Construit un item exactement comme le feed ANA le fait (mêmes formules de hash que ANA — voir golden). */
function bundle(o: Opts = {}): Record<string, any> {
  const withScene = o.scene ?? true, withCapture = o.capture ?? true, revision = o.revision ?? 1;
  const manifest = SCENES[o.sceneName ?? "static"];
  const v = validateScene(manifest);
  const sceneHash = hashSceneJson(v.canonicalJson!);
  const sourceHash = hashArtworkSource(ARTWORK);
  const captureHash = "sha256:capture-a";
  const contentHash = hashGenerativeBundle("work_1", revision, sourceHash, withScene ? sceneHash : undefined, withCapture ? captureHash : undefined);
  const item: Record<string, any> = {
    schemaVersion: 2, id: `ana-work:work_1:generative:${contentHash.slice(7)}`, sourceId: "work_1", revision,
    kind: o.kind ?? (withCapture ? "generative-capture" : "generative-scene"), artForm: "html-canvas",
    sourceHash, contentHash, title: "Pulse", agentTokenId: 7, agentName: "Kori", publishedAt: 1234,
  };
  if (withCapture) item.capture = {
    type: "raw-grayscale", pixelEncoding: "gray8", pixels: b64(new Uint8Array(128 * 160).fill(200)), width: 128, height: 160,
    captureHash, capturedAt: 1, viewport: { width: 128, height: 160 }, seed: sourceHash, timeMs: 500, rendererVersion: "ana-browser-capture-v1",
  };
  if (withScene) item.scene = { schema: "ana-scene-v1", encoding: "json", manifest: JSON.parse(v.canonicalJson!), sceneHash, sourceHash, bytes: v.bytes, rendererVersion: 1 };
  return item;
}

test("bundle scène + capture : kind generative-capture, capture décodée ET scène revalidée (ok)", () => {
  const r = parseFeedItem(bundle());
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.item.kind, "generative-capture");
  assert.equal(r.item.image!.w, 128);
  assert.equal(r.item.scene?.status, "ok");
  assert.equal(r.item.revision, 1);
  assert.equal(r.item.sourceId, "work_1");
  assert.equal(r.item.contentHash, bundle().contentHash);
  if (r.item.scene?.status === "ok") assert.equal(r.item.scene.scene.entities.length, SCENES.static.entities.length);
});

test("bundle scène seule (kind generative-scene) : accepté, sans image — plus ignoré comme avant", () => {
  const r = parseFeedItem(bundle({ capture: false }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.item.kind, "generative-capture", "normalisé : une œuvre générative");
  assert.equal(r.item.image, undefined);
  assert.equal(r.item.scene?.status, "ok");
});

test("capture seule (ancien format, sans scène) : comportement inchangé", () => {
  const r = parseFeedItem(bundle({ scene: false }));
  assert.ok(r.ok);
  if (r.ok) { assert.ok(r.item.image); assert.equal(r.item.scene, undefined); }
});

test("scène invalide + capture : la capture sert, l'erreur est visible (item.scene.status = invalid)", () => {
  const raw = bundle();
  raw.scene.manifest.surprise = 1;                       // clé inconnue
  const r = parseFeedItem(raw);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.item.image, "capture de repli conservée");
  assert.equal(r.item.scene?.status, "invalid");
  if (r.item.scene?.status === "invalid") assert.ok(r.item.scene.errors.some((e) => e.includes("unknown key surprise")));
});

test("scène invalide SANS capture : refus définitif avec le motif (item content-addressed, jamais réessayé)", () => {
  const raw = bundle({ capture: false });
  raw.scene.manifest.seed = 0;
  const r = parseFeedItem(raw);
  assert.ok(!r.ok && r.permanent);
  if (!r.ok) assert.ok(r.reason.includes("aucune capture de repli"), r.reason);
});

test("falsifications : sceneHash, bytes, sourceHash, contentHash et suffixe d'id sont recalculés et vérifiés", () => {
  const cases: Array<[string, (raw: Record<string, any>) => void, string]> = [
    ["sceneHash", (raw) => { raw.scene.sceneHash = "sha256:" + "0".repeat(64); }, "sceneHash annoncé"],
    ["bytes", (raw) => { raw.scene.bytes = 123; }, "bytes annoncé"],
    ["scene.sourceHash", (raw) => { raw.scene.sourceHash = "sha256:" + "1".repeat(64); }, "scene.sourceHash"],
    ["contentHash", (raw) => { raw.contentHash = "sha256:" + "2".repeat(64); }, "contentHash du bundle"],
    ["id", (raw) => { raw.id = "ana-work:work_1:generative:" + "3".repeat(64); }, "id du bundle"],
    ["revision", (raw) => { raw.revision = 2; }, "contentHash du bundle"],
    ["encoding", (raw) => { raw.scene.encoding = "cbor"; }, "scene.encoding"],
    ["schema", (raw) => { raw.scene.schema = "ana-scene-v2"; }, "scene.schema"],
  ];
  for (const [name, mutate, needle] of cases) {
    const raw = bundle();
    mutate(raw);
    const r = parseFeedItem(raw);
    assert.ok(r.ok, `${name}: la capture doit rester utilisable`);
    if (!r.ok) continue;
    assert.equal(r.item.scene?.status, "invalid", name);
    if (r.item.scene?.status === "invalid") assert.ok(r.item.scene.errors.some((e) => e.includes(needle)), `${name}: ${r.item.scene.errors.join(" | ")}`);
  }
});

test("upgrade : ajouter une scène à une capture change contentHash ET id (PoD ne perd jamais la mise à niveau)", () => {
  const captureOnly = bundle({ scene: false }), withScene = bundle();
  assert.notEqual(captureOnly.id, withScene.id);
  assert.notEqual(captureOnly.contentHash, withScene.contentHash);
  const a = parseFeedItem(captureOnly), b = parseFeedItem(withScene);
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) assert.equal(a.item.sourceId, b.item.sourceId, "même œuvre : regroupées par sourceId dans la galerie");
});

test("toutes les scènes de référence passent la revalidation du bundle", () => {
  for (const name of Object.keys(SCENES) as Array<keyof typeof SCENES>) {
    const r = parseFeedItem(bundle({ sceneName: name }));
    assert.ok(r.ok && r.item.scene?.status === "ok", String(name));
  }
});

test("scene hors bundle V2 (pas de sourceId/revision) : scène refusée mais capture gardée, sans exception", () => {
  const raw = bundle();
  delete raw.sourceId; delete raw.revision;
  assert.doesNotThrow(() => parseFeedItem(raw));
  const r = parseFeedItem(raw);
  assert.ok(r.ok && r.item.scene?.status === "invalid");
});
