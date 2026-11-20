// tests/curationFeed.test.ts — contrat public « curation » v1 (lib/curationFeed.ts)
import test from "node:test";
import assert from "node:assert/strict";
import { pageWorks, toCurationWork, buildCartel } from "../lib/curationFeed";
import type { Block } from "../lib/chain";

const H = (n: number) => n.toString(16).padStart(64, "0");
const block = (i: number, extra: Partial<Block> = {}): Block => ({
  blockIndex: i, blockHash: H(i), parentHash: H(i - 1), imageHash: H(1000 + i), actionsHash: H(2000 + i),
  drawScore: 1, deviceId: "dev_SECRET", artistName: "Ada", poolScreen: "eink29bwr", validatorIds: ["v_SECRET"],
  score: 1, displayTime: 0, minedAt: Date.UTC(2026, 10, 19, 12), frameId: "f", ...extra,
}) as Block;

test("cartel : date + n° de bloc en haut, artiste — titre en bas", () => {
  assert.deepEqual(buildCartel("Ada", "Fleur", 7, Date.UTC(2026, 10, 19)), { top: "2026-11-19 · bloc #7", bottom: "Ada — Fleur" });
});

test("aucune donnée d'appareil n'est exposée", () => {
  const w = toCurationWork(block(5, { workTitle: "Fleur", votesSummary: { v2: 3, v1: 1, rejects: 0 } }))!;
  const json = JSON.stringify(w);
  assert.ok(!json.includes("SECRET"));
  assert.equal(w.title, "Fleur");
  assert.deepEqual(w.validation, { approvals: 4, rejects: 0 });
});

test("titre par défaut, artiste dessinateur prioritaire, animation reconnue", () => {
  const w = toCurationWork(block(6, { drawArtistName: "Bob", kind: "animation" }))!;
  assert.equal(w.title, "Sans titre");
  assert.equal(w.artist, "Bob");
  assert.equal(w.kind, "animation");
  assert.equal(w.validation, null);
});

test("les blocs ANA et les hashes invalides sont écartés", () => {
  assert.equal(toCurationWork(block(1, { source: "ana-agent" })), null);
  assert.equal(toCurationWork(block(2, { blockHash: "zz" })), null);
});

test("pagination : plus récent d'abord, before exclusif, next jusqu'à la fin", () => {
  const blocks = [1, 2, 3, 4, 5].map((i) => block(i));
  const p1 = pageWorks(blocks, { limit: 2 });
  assert.deepEqual(p1.works.map((w) => w.blockIndex), [5, 4]);
  assert.equal(p1.next, 4);
  const p2 = pageWorks(blocks, { before: p1.next, limit: 2 });
  assert.deepEqual(p2.works.map((w) => w.blockIndex), [3, 2]);
  const p3 = pageWorks(blocks, { before: p2.next, limit: 2 });
  assert.deepEqual(p3.works.map((w) => w.blockIndex), [1]);
  assert.equal(p3.next, null);
});
