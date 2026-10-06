import test from "node:test";
import assert from "node:assert/strict";
import { candidateFrameResponse, CANDIDATE_FRAME_CACHE_ERROR, CANDIDATE_FRAME_CACHE_OK } from "../lib/candidateFrameResponse";
import { buildCandidateV2 } from "../lib/podVote";
import { METRIC_GRID } from "../lib/podMetrics";
import type { Candidate } from "../lib/chain";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "123e4567-e89b-42d3-a456-426614174999";

function oledCandidate(over: Partial<Candidate> = {}): Candidate {
  const buf = Buffer.alloc(METRIC_GRID.oled096.rawBytes);
  for (let i = 0; i < buf.length; i += 3) buf[i] = 0xa5;
  const payload = { screen: "oled096", buffer: buf.toString("base64") };
  return { candidateId: ID, poolScreen: "oled096", payload, v2: buildCandidateV2("oled096", payload), ...over } as unknown as Candidate;
}
const never = async () => { throw new Error("aucune lecture Redis attendue"); };

test("200 : contenu brut, en-têtes de preuve, cache IMMUABLE conservé", async () => {
  const c = oledCandidate();
  const r = await candidateFrameResponse(ID, async () => c);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), CANDIDATE_FRAME_CACHE_OK);
  assert.match(r.headers.get("Cache-Control") ?? "", /immutable/);
  assert.equal(r.headers.get("Content-Type"), "application/octet-stream");
  assert.equal(r.headers.get("X-Raw-Hash"), c.v2!.rawHash);
  assert.equal(r.headers.get("X-Screen-Type"), "oled096");
  assert.equal((await r.arrayBuffer()).byteLength, METRIC_GRID.oled096.rawBytes);
});

test("404 (aucun candidat, autre candidat, candidat sans spécification v2) : JAMAIS mis en cache", async () => {
  const cases: Array<[string, () => Promise<Candidate | null>]> = [
    ["aucun candidat", async () => null],
    ["autre candidat courant", async () => oledCandidate({ candidateId: OTHER })],
    ["sans v2 (animation)", async () => oledCandidate({ v2: undefined })],
  ];
  for (const [name, load] of cases) {
    const r = await candidateFrameResponse(ID, load);
    assert.equal(r.status, 404, name);
    assert.equal(r.headers.get("Cache-Control"), CANDIDATE_FRAME_CACHE_ERROR, name);
    assert.doesNotMatch(r.headers.get("Cache-Control") ?? "", /s-maxage|max-age|immutable|public/, name);
  }
});

test("400 (identifiant invalide) : no-store ET aucune lecture Redis", async () => {
  for (const bad of ["", "x", "123e4567", `${ID}'; DROP`]) {
    const r = await candidateFrameResponse(bad, never);
    assert.equal(r.status, 400);
    assert.equal(r.headers.get("Cache-Control"), "no-store");
  }
});

test("500 (contenu illisible) et écran non géré : no-store", async () => {
  const broken = oledCandidate({ payload: { screen: "oled096", buffer: "AAAA" } as Candidate["payload"] });
  const r500 = await candidateFrameResponse(ID, async () => broken);
  assert.equal(r500.status, 500);
  assert.equal(r500.headers.get("Cache-Control"), "no-store");
  const odd = oledCandidate();
  (odd.v2 as { screen: string }).screen = "hologramme";
  const r404 = await candidateFrameResponse(ID, async () => odd);
  assert.equal(r404.status, 404);
  assert.equal(r404.headers.get("Cache-Control"), "no-store");
});
