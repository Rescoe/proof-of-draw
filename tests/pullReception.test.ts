// tests/pullReception.test.ts — RÉCEPTION MAINTENUE (décision du porteur, 14/10/2026 soir) : un appareil qui ne sait pas voter en v2 continue de RECEVOIR images et blocs de /api/pull ;
// il n'est ni invité à valider, ni compté dans le quorum, ni admis au vote. Test de structure de la route (pas de Redis) + comportement pur de lib/voteCapability.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { participatesInVoteNetwork, voteAdmission } from "../lib/voteCapability";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const pull = read("app/api/pull/route.ts");

test("pull : plus de retour anticipé « à vide » pour un firmware sans vote v2 (la réception est maintenue)", () => {
  assert.doesNotMatch(pull, /firmware sans vote v2 : mise a jour requise/);
  assert.doesNotMatch(pull, /if \(!participatesInVoteNetwork\(device\)\)/);
  assert.match(pull, /const mayVote = participatesInVoteNetwork\(device\);/);
});
test("pull : seul un appareil qui peut voter est invité à valider (pendingValidation)", () => {
  assert.match(pull, /if \(!alreadyVoted && !notEligible && mayVote\) \{/);
  assert.equal((pull.match(/pendingValidation = \{/g) ?? []).length, 1, "un seul endroit crée pendingValidation");
});
test("un ancien firmware n'est pas invité à voter, ne peut pas voter (403) et n'est pas compté ; un firmware capable oui", () => {
  const old = { screens: ["eink29bwr"], firmware: "2.0", artistName: "x", lastPing: Date.now(), lastSeen: Date.now() };
  const good = { screens: ["eink29bwr"], firmware: "eink29bwr-2.3", artistName: "x", lastPing: Date.now(), lastSeen: Date.now() };
  assert.equal(participatesInVoteNetwork(old), false);
  assert.equal(participatesInVoteNetwork(good), true);
  const a = voteAdmission(old, true); assert.equal(a.ok, false); if (!a.ok) assert.equal(a.status, 403);
  assert.equal(voteAdmission(good, true).ok, true);
});
