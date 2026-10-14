// tests/voteCapability.test.ts — réseau de vote réel (14/10/2026) : capacité de vote par version de firmware, interrupteur, capteurs ; rapide, sans Redis.
import test from "node:test";
import assert from "node:assert/strict";
import { VOTE_V2_FIRMWARE, participatesInVoteNetwork, voteOnlyNetwork, voteV2Capable } from "../lib/voteCapability";

test("firmwares du dépôt (versions actuelles) : capables de voter en v2", () => {
  for (const f of ["r4tft28-2.5", "r4eink29-1.1", "r4eink27-1.1", "r4multiscreen-1.1", "r4tft18-1.1", "multiscreen-2.5", "eink27bw-2.1", "eink29bwr-2.3", "tft18-2.4", "r4tft28-2.10", "R4TFT28-3.0"]) assert.equal(voteV2Capable(f), true, f);
});
test("anciens firmwares, versions inconnues, chaînes vides : exclus", () => {
  for (const f of ["r4tft28-2.4", "multiscreen-2.2", "tft18-2.3", "eink27bw-2.0", "eink29bwr-2.2", "2.2", "2.0", "", null, undefined, "r4dht22-1.3", "inconnu-9.9", "multiscreen", "r4tft28-x.y"]) assert.equal(voteV2Capable(f as string), false, String(f));
});
test("chaque entrée de la liste exige bien sa version minimale (et pas moins)", () => {
  for (const [prefix, [maj, min]] of Object.entries(VOTE_V2_FIRMWARE)) {
    assert.equal(voteV2Capable(`${prefix}-${maj}.${min}`), true, prefix);
    if (min > 0) assert.equal(voteV2Capable(`${prefix}-${maj}.${min - 1}`), false, prefix);
    assert.equal(voteV2Capable(`${prefix}-${maj - 1}.9`), false, prefix);
  }
});
test("VOTE_ONLY_NETWORK : actif par défaut ; false / 0 / off / non le désactive", () => {
  assert.equal(voteOnlyNetwork({} as unknown as NodeJS.ProcessEnv), true);
  for (const v of ["true", "1", "on", "oui", ""]) assert.equal(voteOnlyNetwork({ VOTE_ONLY_NETWORK: v } as unknown as NodeJS.ProcessEnv), true, v);
  for (const v of ["false", "FALSE", "0", "off", "non", " no "]) assert.equal(voteOnlyNetwork({ VOTE_ONLY_NETWORK: v } as unknown as NodeJS.ProcessEnv), false, v);
});
test("participation : firmware capable oui ; ancien non ; réseau ouvert oui ; capteur seul toujours hors mécanisme ; appareil absent non", () => {
  const on = {} as unknown as NodeJS.ProcessEnv, off = { VOTE_ONLY_NETWORK: "false" } as unknown as NodeJS.ProcessEnv;
  assert.equal(participatesInVoteNetwork({ screens: ["tft28"], firmware: "r4tft28-2.5" }, on), true);
  assert.equal(participatesInVoteNetwork({ screens: ["oled096", "eink27bw"], firmware: "multiscreen-2.2" }, on), false);
  assert.equal(participatesInVoteNetwork({ screens: ["oled096", "eink27bw"], firmware: "multiscreen-2.2" }, off), true);
  assert.equal(participatesInVoteNetwork({ screens: ["sensor"], firmware: "r4dht22-1.3" }, on), true);
  assert.equal(participatesInVoteNetwork(null, on), false);
});
