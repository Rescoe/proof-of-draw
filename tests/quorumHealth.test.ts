// tests/quorumHealth.test.ts — quorum vivant (25/10/2026) : un appareil actif qui ne vote jamais sort du quorum, et y revient dès qu'il vote.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isResponsiveVoter, maxMissedFromEnv } from "../lib/quorumResponsive";
import { silentDevices } from "../lib/quorumHealth";
import type { Device } from "../lib/deviceStore";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const NOW = Date.UTC(2026, 9, 25, 20, 0);
const dev = (id: string, over: Partial<Device> = {}): Device => ({ deviceId: id, artistName: "x", lastPing: NOW - 60_000, screens: ["eink29bwr"], firmware: "eink29bwr-2.12", pairCode: "", ...over } as unknown as Device);

test("seuil : par défaut un seul manque exclut l'appareil du quorum ; QUORUM_MAX_MISSED le relève ; un appareil sain ou réhabilité compte", () => {
  assert.equal(maxMissedFromEnv({} as NodeJS.ProcessEnv), 1);
  assert.equal(maxMissedFromEnv({ QUORUM_MAX_MISSED: "3" } as unknown as NodeJS.ProcessEnv), 3);
  assert.equal(maxMissedFromEnv({ QUORUM_MAX_MISSED: "0" } as unknown as NodeJS.ProcessEnv), 1, "0 refusé : le quorum ne peut pas exclure tout le monde d'office");
  assert.equal(isResponsiveVoter({}), true); assert.equal(isResponsiveVoter({ missedVotes: 0 }), true);
  assert.equal(isResponsiveVoter({ missedVotes: 1 }), false);
  assert.equal(isResponsiveVoter({ missedVotes: 1 }, 2), true);
  assert.equal(isResponsiveVoter(null), true);
});

test("candidat expiré : seuls les appareils appairés, ACTIFS et sans vote sont pénalisés (ni les votants, ni les hors ligne, ni les non appairés)", () => {
  const w = 45 * 60_000;
  const devices = [dev("dev_AAAAAAAA"), dev("dev_BBBBBBBB"), dev("dev_CCCCCCCC", { lastPing: NOW - 5 * 3600_000 }), dev("dev_DDDDDDDD", { artistName: undefined, artistId: undefined }), dev("dev_EEEEEEEE")];
  const silent = silentDevices(devices, new Set(["dev_AAAAAAAA"]), NOW, w).map((d) => d.deviceId);
  assert.deepEqual(silent, ["dev_BBBBBBBB", "dev_EEEEEEEE"]);
});

test("câblage : le quorum ignore les appareils muets (getGlobalActiveCount ET getPoolSnapshot), mais l'ADMISSION au vote ne dépend pas du compteur (un exclu peut revoter)", () => {
  const store = read("lib", "deviceStore.ts");
  assert.equal((store.match(/isResponsiveVoter\(d\)/g) ?? []).length, 2);
  assert.match(store, /missedVotes\?: number/);
  const cap = read("lib", "voteCapability.ts");
  assert.doesNotMatch(cap, /missedVotes|isResponsiveVoter/, "voteAdmission / participatesInVoteNetwork inchangés");
  const vr = read("app", "api", "validation-result", "route.ts");
  assert.match(vr, /if \(cast\.added\) await noteVote\(candidate\.candidateId, device\)/);
  const sc = read("app", "api", "submit-candidate", "route.ts");
  assert.ok(sc.indexOf("await settleLostPrevious()") > 0 && sc.indexOf("await settleLostPrevious()") < sc.indexOf("poolSize = await getGlobalActiveCount()"), "règlement du candidat précédent AVANT le calcul de la taille du réseau");
  assert.match(read("app", "api", "rejected-draws", "route.ts"), /settleExpired\(lost\.candidateId\)/);
  const qh = read("lib", "quorumHealth.ts");
  assert.match(qh, /final === "mined" \|\| final === "rejected"/, "un candidat miné ou refusé par décision ne pénalise personne");
  assert.match(qh, /settledKey\(candidateId\), "1", \{ nx: true/, "règlement une seule fois");
});
