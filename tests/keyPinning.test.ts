import test from "node:test";
import assert from "node:assert/strict";
import { decideKeyUpdate } from "../lib/keyPinning";

const A = "a".repeat(64), B = "b".repeat(64);

test("première clé : enregistrée", () => {
  assert.equal(decideKeyUpdate(undefined, A, true), "set");
  assert.equal(decideKeyUpdate(undefined, A, false), "set");
});
test("même clé : rien à faire", () => {
  assert.equal(decideKeyUpdate(A, A, true), "same");
});
test("clé différente : refusée si l'épinglage est actif, sinon comportement historique", () => {
  assert.equal(decideKeyUpdate(A, B, true), "refuse");
  assert.equal(decideKeyUpdate(A, B, false), "set");
});
