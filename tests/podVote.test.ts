// tests/podVote.test.ts — vote v2 : hash + métriques recalculés, verdict signé ; accept exact, reject recevable, forgeries refusées.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { buildCandidateV2, checkVoteV2, parseVoteV2, voteMessageV2, sha256Raw, type CandidateV2, type VoteV2Body } from "../lib/podVote";
import { METRIC_GRID, POD_SCREENS, rawContent, type PodScreen } from "../lib/podMetrics";
import { verifyEd25519 } from "../lib/ed25519";

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); }
function payloadFor(screen: PodScreen, seed: number) {
  const r = rng(seed), mk = (n: number) => Buffer.from(Uint8Array.from({ length: n }, () => (r() < 0.6 ? 0xff : Math.floor(r() * 256)))).toString("base64");
  return screen === "eink29bwr" ? { black: mk(4736), red: mk(4736) } : { buffer: mk(METRIC_GRID[screen].rawBytes) };
}
const NID = "11111111-2222-4333-8444-555555555555";
const honest = (c: CandidateV2): VoteV2Body => ({ deviceId: "dev_ABCDEFGH", candidateId: NID, rawHash: c.rawHash, e: c.e, t: c.t, r: c.r, verdict: "accept" });

test("buildCandidateV2 : 5 écrans, hash = SHA-256 du contenu brut, tailles exactes", () => {
  for (const screen of POD_SCREENS) {
    const p = payloadFor(screen, 3), c = buildCandidateV2(screen, p)!;
    assert.ok(c, screen);
    assert.equal(c.rawBytes, METRIC_GRID[screen].rawBytes);
    assert.equal(c.rawHash, sha256Raw(rawContent(screen, p)));
    assert.ok(c.s >= 0 && c.s <= 1_000_000);
  }
  assert.equal(buildCandidateV2("inconnu", { buffer: "AA==" }), null);
  assert.equal(buildCandidateV2("oled096", { buffer: "AA==" }), null);   // taille invalide
});

test("accept exact accepté ; hash ou métriques différents refusés (tolérance zéro)", () => {
  const c = buildCandidateV2("eink27bw", payloadFor("eink27bw", 9))!, v = honest(c);
  assert.deepEqual(checkVoteV2(c, v), { ok: true, verdict: "accept", suspect: false });
  assert.deepEqual(checkVoteV2(c, { ...v, rawHash: "0".repeat(64) }), { ok: false, reason: "hash" });
  for (const k of ["e", "t", "r"] as const) assert.deepEqual(checkVoteV2(c, { ...v, [k]: v[k] + 1 }), { ok: false, reason: "metrics" });
});

test("un refus signé est recevable ; suspect s'il invoque une divergence inexistante", () => {
  const c = buildCandidateV2("oled096", payloadFor("oled096", 5))!, v = honest(c);
  assert.deepEqual(checkVoteV2(c, { ...v, verdict: "reject", reason: "blank" }), { ok: true, verdict: "reject", suspect: false });
  assert.deepEqual(checkVoteV2(c, { ...v, verdict: "reject", reason: "hash" }), { ok: true, verdict: "reject", suspect: true });
  assert.deepEqual(checkVoteV2(c, { ...v, rawHash: "f".repeat(64), verdict: "reject", reason: "hash" }), { ok: true, verdict: "reject", suspect: false });
});

test("parseVoteV2 : lecture défensive", () => {
  const base = { deviceId: "dev_ABCDEFGH", candidateId: NID, rawHash: "a".repeat(64), e: 1, t: 2, r: 3, verdict: "accept" };
  assert.ok(parseVoteV2(base));
  for (const bad of [{ ...base, rawHash: "xyz" }, { ...base, e: 1.5 }, { ...base, t: -1 }, { ...base, r: 2_000_000 }, { ...base, verdict: "maybe" }, { ...base, reason: "caprice" }, { ...base, deviceId: 5 }]) assert.equal(parseVoteV2(bad as never), null);
});

test("signature : le message lie appareil, candidat, hash, métriques et verdict (toute modification invalide)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex");
  const c = buildCandidateV2("tft18", payloadFor("tft18", 11))!, v = honest(c);
  const sig = sign(null, Buffer.from(voteMessageV2(v)), privateKey).toString("hex");
  assert.equal(verifyEd25519(pub, voteMessageV2(v), sig), true);
  for (const tampered of [{ ...v, verdict: "reject" as const }, { ...v, candidateId: NID.replace("1", "2") }, { ...v, rawHash: "b".repeat(64) }, { ...v, e: v.e + 1 }, { ...v, deviceId: "dev_ZZZZZZZZ" }]) {
    assert.equal(verifyEd25519(pub, voteMessageV2(tampered), sig), false);
  }
});
