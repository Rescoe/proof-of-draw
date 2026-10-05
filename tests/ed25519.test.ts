// tests/ed25519.test.ts — la vérification serveur accepte une signature valide et refuse tout le reste (elle refusait TOUT avant le 05/10/2026).
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyEd25519 } from "../lib/ed25519";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pub = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex");
const sig = (m: string) => sign(null, Buffer.from(m), privateKey).toString("hex");

test("signature valide acceptée", () => assert.equal(verifyEd25519(pub, "dev_ABCDEFGH:uuid:0.540", sig("dev_ABCDEFGH:uuid:0.540")), true));
test("message modifié refusé", () => assert.equal(verifyEd25519(pub, "dev_ABCDEFGH:uuid:0.541", sig("dev_ABCDEFGH:uuid:0.540")), false));
test("autre clé refusée", () => {
  const other = (generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex");
  assert.equal(verifyEd25519(other, "m", sig("m")), false);
});
test("formats invalides refusés", () => {
  assert.equal(verifyEd25519(pub.slice(2), "m", sig("m")), false);
  assert.equal(verifyEd25519(pub, "m", sig("m").slice(2)), false);
  assert.equal(verifyEd25519(pub, "m", "zz".repeat(64)), false);
});
