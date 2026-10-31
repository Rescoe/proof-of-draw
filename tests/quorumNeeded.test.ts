import test from "node:test";
import assert from "node:assert/strict";
import { quorumNeeded } from "../lib/quorumNeeded";

test("quorum adaptatif : sous 10 appareils la moitié suffit (4 -> 2, avant 3)", () => {
  assert.equal(quorumNeeded(1, {}), 1);
  assert.equal(quorumNeeded(2, {}), 1);
  assert.equal(quorumNeeded(3, {}), 2);
  assert.equal(quorumNeeded(4, {}), 2);
  assert.equal(quorumNeeded(5, {}), 3);
  assert.equal(quorumNeeded(6, {}), 3);
  assert.equal(quorumNeeded(9, {}), 5);
});

test("quorum : à partir de 10 appareils, ratio historique 0,51", () => {
  assert.equal(quorumNeeded(10, {}), 6);
  assert.equal(quorumNeeded(20, {}), 11);
});

test("quorum : QUORUM_ADAPTIVE_BELOW=0 rétablit la règle historique ; entrées dégénérées sûres", () => {
  assert.equal(quorumNeeded(4, { QUORUM_ADAPTIVE_BELOW: "0" } as NodeJS.ProcessEnv), 3);
  assert.equal(quorumNeeded(0, {}), 1);
  assert.equal(quorumNeeded(NaN, {}), 1);
  assert.equal(quorumNeeded(-3, {}), 1);
});
