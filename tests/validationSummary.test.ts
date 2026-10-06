import test from "node:test";
import assert from "node:assert/strict";
import { describeSummary, describeVote, summarizeVotes } from "../lib/validationSummary";

test("résumé : v2 vérifié, v1 écho et refus sont comptés séparément", () => {
  const s = summarizeVotes([{ v: 2, verdict: "accept" }, { v: 2, verdict: "accept" }, {}, { v: 2, verdict: "reject" }]);
  assert.deepEqual(s, { v2: 2, v1: 1, rejects: 1 });
  assert.equal(describeSummary(s), "v2 vérifié×2 · v1 écho×1 · refus×1");
});

test("résumé : le nombre de refus fourni (carte des votes) prime, sans double compte", () => {
  assert.deepEqual(summarizeVotes([{ v: 2, verdict: "accept" }], 2), { v2: 1, v1: 0, rejects: 2 });
});

test("sans résumé (bloc ancien) : rien n'est affiché", () => {
  assert.equal(describeSummary(undefined), "");
  assert.equal(describeSummary(null), "");
});

test("vote v1 : jamais présenté comme vérifié", () => {
  const d = describeVote({ score: 0.42 });
  assert.equal(d.voteVersion, 1);
  assert.match(d.detail, /v1 écho/);
  assert.match(d.detail, /non vérifié/);
});

test("vote v2 accepté : métriques en ppm et format compatible avec la regex « score NN% » des consommateurs", () => {
  const d = describeVote({ v: 2, verdict: "accept", entropy: 0.123456, transitions: 0.2, rle: 0.3, score: 0.5 });
  assert.equal(d.voteVersion, 2);
  assert.deepEqual(d.metricsPpm, { e: 123456, t: 200000, r: 300000 });
  assert.match(`VOTE · pub_x · ${d.detail}`, /score\s+(\d+)%/);
  assert.match(d.detail, /✓ accepte/);
});

test("vote v2 refusé : motif et signal « suspect » visibles", () => {
  const d = describeVote({ v: 2, verdict: "reject", reason: "hash", suspect: true, score: 0 });
  assert.equal(d.verdict, "reject");
  assert.equal(d.reason, "hash");
  assert.match(d.detail, /✗ refuse \(hash\)/);
  assert.match(d.detail, /suspect/);
});
