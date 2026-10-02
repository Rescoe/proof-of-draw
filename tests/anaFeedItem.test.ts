// tests/anaFeedItem.test.ts — lecture des items du feed ANA (schémas V1 et V2)
import test from "node:test";
import assert from "node:assert/strict";
import { parseFeedItem, rgbaToGray } from "../lib/anaFeedItem";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const base = { id: "w1", title: "T", agentTokenId: 7, publishedAt: 1000 };

test("V1 : ancien memorial (pixels à la racine) toujours accepté", () => {
  const r = parseFeedItem({ ...base, kind: "celebration", pixels: b64(new Uint8Array(6).fill(255)), canvasW: 3, canvasH: 2, cartelText: "c", voteResult: "passed" });
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.item.image!.w, 3); assert.equal(r.item.context.cartelText, "c"); assert.equal(r.item.sourceId, "w1"); }
});

test("V2 : media.pixels lu, sourceId conservé", () => {
  const r = parseFeedItem({ ...base, schemaVersion: 2, sourceId: "S", kind: "spontaneous", media: { type: "raw-grayscale", pixelEncoding: "gray8", pixels: b64(new Uint8Array(4)), canvasW: 2, canvasH: 2 } });
  assert.ok(r.ok && r.item.sourceId === "S" && r.item.image!.gray.length === 4);
});

test("pixels de mauvaise taille : refusé définitivement", () => {
  const r = parseFeedItem({ ...base, kind: "celebration", pixels: b64(new Uint8Array(5)), canvasW: 3, canvasH: 2 });
  assert.ok(!r.ok && r.permanent);
});

test("poème : texte intégral normalisé NFC, extrait éditorial gardé à part", () => {
  const decomposed = "été";                       // « été » en NFD
  const r = parseFeedItem({ ...base, kind: "poem", artForm: "haiku", text: decomposed, display: { mode: "excerpt", text: "été" } });
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.item.poem!.text, "été"); assert.equal(r.item.poem!.displayText, "été"); assert.equal(r.item.poem!.artForm, "haiku"); }
});

test("poème sans texte : refusé ; display « full » ignoré (jamais de réécriture)", () => {
  assert.ok(!parseFeedItem({ ...base, kind: "poem", text: "  " }).ok);
  const r = parseFeedItem({ ...base, kind: "poem", text: "vers", display: { mode: "full", text: "autre" } });
  assert.ok(r.ok && r.item.poem!.displayText === undefined);
});

test("capture générative RGBA : décodée en gris, alpha composé sur blanc", () => {
  const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 255, 0, 0, 255]);   // noir, blanc, transparent, rouge
  const g = rgbaToGray(rgba, 4, 1);
  assert.equal(g[0], 0); assert.equal(g[1], 255); assert.ok(g[2] >= 254); assert.ok(g[3] > 40 && g[3] < 90);
  const r = parseFeedItem({ ...base, kind: "generative-capture", capture: { pixelEncoding: "rgba8888", pixels: b64(rgba), width: 4, height: 1 } });
  assert.ok(r.ok && r.item.image!.w === 4);
});

test("capture : taille incohérente ou encodage inconnu refusés", () => {
  assert.ok(!parseFeedItem({ ...base, kind: "generative-capture", capture: { pixelEncoding: "rgba8888", pixels: b64(new Uint8Array(3)), width: 2, height: 2 } }).ok);
  assert.ok(!parseFeedItem({ ...base, kind: "generative-capture", capture: { pixelEncoding: "png", pixels: b64(new Uint8Array(4)), width: 2, height: 2 } }).ok);
});

test("kinds inconnus : ignorés sans être marqués définitivement invalides (peuvent devenir valides plus tard)", () => {
  const u = parseFeedItem({ ...base, kind: "hologramme" });
  assert.ok(!u.ok && !u.permanent);
});

test("generative-scene sans scène (item mal formé) : refus définitif, plus ignoré silencieusement", () => {
  const s = parseFeedItem({ ...base, kind: "generative-scene" });
  assert.ok(!s.ok && s.permanent);
});

test("entrées absurdes : jamais d'exception", () => {
  for (const x of [null, 3, "x", [], {}, { id: "a" }, { id: "a", kind: "poem" }]) assert.doesNotThrow(() => parseFeedItem(x));
});
