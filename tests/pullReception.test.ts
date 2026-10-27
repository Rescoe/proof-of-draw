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

// ── Audit explicite RECEPTION-MAINTENUE (15/10/2026) ─────────────────────────────────────────────────────────────────────────────────────────
test("audit : `mayVote` ne conditionne QUE pendingValidation — images, blocs, animations et observations ne dépendent pas de la capacité de vote", () => {
  assert.equal((pull.match(/\bmayVote\b/g) ?? []).length, 2, "définition + une seule utilisation");
  const use = pull.indexOf("mayVote) {");
  assert.ok(use > 0 && pull.slice(use - 80, use + 12).includes("alreadyVoted"), "l'unique usage est la condition d'invitation à valider");
  assert.equal((pull.match(/participatesInVoteNetwork\(/g) ?? []).length, 1, "aucune autre porte de capacité dans /api/pull");
  assert.doesNotMatch(pull, /voteV2Capable\(/);
});

test("audit : l'appareil non votant n'est jamais compté dans le quorum (deviceStore) et ne peut ni lire un candidat ni voter", () => {
  const store = read("lib/deviceStore.ts"), vc = read("app/api/validate-candidate/route.ts"), vr = read("app/api/validation-result/route.ts");
  assert.ok((store.match(/participatesInVoteNetwork\(/g) ?? []).length >= 1, "getPoolSnapshot filtre");
  assert.match(read("lib/electorate.ts"), /participatesInVoteNetwork\(d, env\)/, "getGlobalActiveCount (via lib/electorate.ts, source unique) filtre aussi");
  assert.match(vc, /participatesInVoteNetwork\(/);
  assert.match(vc, /firmware-not-vote-capable/);
  assert.match(vr, /voteAdmission\(device, isV2,/);   // 28/10/2026 : + exception « candidat animation » (ANIM_V1_VOTE)
});

test("audit : obs-confirm reste autorisé SANS capacité de vote, comme simple confirmation de réception, et n'a aucun effet sur les votes ni le quorum", () => {
  const obs = read("app/api/obs-confirm/route.ts");
  assert.doesNotMatch(obs, /voteAdmission|participatesInVoteNetwork|voteV2Capable/, "pas de porte de capacité : un non-votant peut encore confirmer la réception");
  assert.doesNotMatch(obs, /candidate:votes|getVotes|recordVote|poolSize|quorum|minV2Approvals/i, "aucun accès aux votes ni au quorum");
  assert.match(obs, /observerIds/);   // seul effet : consigner l'appareil comme observateur du bloc
});
