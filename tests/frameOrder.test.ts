import test from "node:test";
import assert from "node:assert/strict";
import { frameStoredAt, oldestFrame } from "../lib/queue";

// Les frames du consensus (validation-result, lib/broadcast.ts, lib/anim/broadcast.ts) portent `createdAt`, jamais `storedAt`.
const f = (frameId: string, createdAt?: number, storedAt?: number) => ({ frameId, createdAt, storedAt });

test("la plus ancienne frame gagne même sans `storedAt` (createdAt)", () => {
  const oled = f("oled-recent", 2_000);          // OLED listé AVANT l'e-ink dans SCREEN_IDS
  const eink = f("eink-ancienne", 1_000);
  assert.equal(oldestFrame([oled, eink])?.frameId, "eink-ancienne");
  assert.equal(oldestFrame([eink, oled])?.frameId, "eink-ancienne");
});

test("`storedAt` reste prioritaire quand il existe (storeFrame)", () => {
  assert.equal(frameStoredAt(f("a", 5, 9)), 9);
  assert.equal(frameStoredAt(f("b", 5)), 5);
});

test("une frame sans aucune date ne masque jamais une frame datée", () => {
  const nue = f("sans-date");
  const datee = f("datee", 3_000);
  assert.equal(oldestFrame([nue, datee])?.frameId, "datee");
  assert.equal(oldestFrame([datee, nue])?.frameId, "datee");
});

test("liste vide ou seulement des null : aucune frame ; égalité : la première", () => {
  assert.equal(oldestFrame([]), null);
  assert.equal(oldestFrame([null, null]), null);
  assert.equal(oldestFrame([f("x", 1), f("y", 1)])?.frameId, "x");
});
