import test from "node:test";
import assert from "node:assert/strict";
import { quorumNeeded } from "../lib/quorumNeeded";

test("quorum adaptatif : sous 10 appareils la moitié suffit (4 -> 2, avant 3)", () => {
  assert.equal(quorumNeeded(1, {} as NodeJS.ProcessEnv), 1);
  assert.equal(quorumNeeded(2, {} as NodeJS.ProcessEnv), 1);
  assert.equal(quorumNeeded(3, {} as NodeJS.ProcessEnv), 2);
  assert.equal(quorumNeeded(4, {} as NodeJS.ProcessEnv), 2);
  assert.equal(quorumNeeded(5, {} as NodeJS.ProcessEnv), 3);
  assert.equal(quorumNeeded(6, {} as NodeJS.ProcessEnv), 3);
  assert.equal(quorumNeeded(9, {} as NodeJS.ProcessEnv), 5);
});

test("quorum : à partir de 10 appareils, ratio historique 0,51", () => {
  assert.equal(quorumNeeded(10, {} as NodeJS.ProcessEnv), 6);
  assert.equal(quorumNeeded(20, {} as NodeJS.ProcessEnv), 11);
});

test("quorum : QUORUM_ADAPTIVE_BELOW=0 rétablit la règle historique ; entrées dégénérées sûres", () => {
  assert.equal(quorumNeeded(4, { QUORUM_ADAPTIVE_BELOW: "0" } as unknown as NodeJS.ProcessEnv), 3);
  assert.equal(quorumNeeded(0, {} as NodeJS.ProcessEnv), 1);
  assert.equal(quorumNeeded(NaN, {} as NodeJS.ProcessEnv), 1);
  assert.equal(quorumNeeded(-3, {} as NodeJS.ProcessEnv), 1);
});
