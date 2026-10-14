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

// ── VOTE-NETWORK-GATE-FIX1 : admission d'un VOTE (audit GPT du 14/10/2026) ───────────────────────────────────────────────────────
import { voteAdmission } from "../lib/voteCapability";
const NOW = 1_800_000_000_000, MIN = 60_000;
const dev = (over: Record<string, unknown> = {}) => ({ screens: ["tft28"], firmware: "r4tft28-2.5", artistId: "a1", artistName: "Roubzi", lastPing: NOW - 5 * MIN, lastSeen: NOW - 5 * MIN, ...over });
const on = {} as unknown as NodeJS.ProcessEnv, off = { VOTE_ONLY_NETWORK: "false" } as unknown as NodeJS.ProcessEnv;
const reason = (r: ReturnType<typeof voteAdmission>) => (r.ok ? "ok" : r.reason);

test("version de firmware ANCRÉE : suffixes, préfixes et espaces parasites refusés ; patch accepté", () => {
  for (const f of ["r4tft28-2.5abc", "r4tft28-2.5-evil", "r4tft28-2.5 x", "r4tft28-2.5.1.2", "xr4tft28-2.5", "r4tft28-2.", "r4tft28-2.5\n9"]) assert.equal(voteV2Capable(f), false, JSON.stringify(f));
  for (const f of ["r4tft28-2.5.1", "  r4tft28-2.5  ", "r4tft28-2.5"]) assert.equal(voteV2Capable(f), true, JSON.stringify(f));
});
test("admission : vote v2 valide d'un appareil appairé, actif, au firmware capable", () => {
  assert.equal(reason(voteAdmission(dev(), true, NOW, on)), "ok");
});
test("admission : vote v1 (écho) REFUSÉ, même sans clé publique, même pour un firmware capable", () => {
  assert.equal(reason(voteAdmission(dev(), false, NOW, on)), "v1-vote-refused");
  assert.equal(reason(voteAdmission(dev({ publicKey: undefined }), false, NOW, on)), "v1-vote-refused");
});
test("admission : appareil non appairé refusé ; appairé par artistId OU artistName accepté", () => {
  assert.equal(reason(voteAdmission(dev({ artistId: undefined, artistName: undefined }), true, NOW, on)), "device-not-paired");
  assert.equal(reason(voteAdmission(dev({ artistId: undefined }), true, NOW, on)), "ok");
  assert.equal(reason(voteAdmission(dev({ artistName: undefined }), true, NOW, on)), "ok");
});
test("admission : appareil inactif refusé (ping et présence anciens) ; une présence récente suffit", () => {
  assert.equal(reason(voteAdmission(dev({ lastPing: NOW - 46 * MIN, lastSeen: NOW - 46 * MIN }), true, NOW, on)), "device-inactive");
  assert.equal(reason(voteAdmission(dev({ lastPing: NOW - 44 * MIN, lastSeen: NOW - 44 * MIN }), true, NOW, on)), "ok");
  assert.equal(reason(voteAdmission(dev({ lastPing: NOW - 600 * MIN, lastSeen: NOW - 2 * MIN }), true, NOW, on)), "ok");
  assert.equal(reason(voteAdmission(dev({ lastPing: undefined, lastSeen: undefined }), true, NOW, on)), "device-inactive");
});
test("admission : capteur seul refusé (avant tout autre contrôle) ; firmware ancien, usurpé (suffixe), vide ou inconnu refusé ; appareil absent = 404", () => {
  assert.equal(reason(voteAdmission(dev({ screens: ["sensor"], firmware: "r4tft28-2.5" }), true, NOW, on)), "sensor-cannot-vote");
  assert.equal(reason(voteAdmission(dev({ screens: ["sensor"], firmware: "r4dht22-1.3" }), true, NOW, on)), "sensor-cannot-vote");
  for (const f of ["multiscreen-2.2", "2.2", "r4tft28-2.5abc", "", undefined, "inconnu-9.9"]) assert.equal(reason(voteAdmission(dev({ firmware: f }), true, NOW, on)), "firmware-not-vote-capable", String(f));
  const unknown = voteAdmission(null, true, NOW, on); assert.equal(unknown.ok, false); if (!unknown.ok) assert.equal(unknown.status, 404);
});
test("admission : ordre des contrôles (capteur, firmware, v1, appairage, activité) et statut 403", () => {
  const r = voteAdmission(dev({ firmware: "multiscreen-2.2", artistId: undefined, artistName: undefined }), false, NOW, on);
  assert.equal(r.ok, false); if (!r.ok) { assert.equal(r.status, 403); assert.equal(r.reason, "firmware-not-vote-capable"); }
  assert.equal(reason(voteAdmission(dev({ artistId: undefined, artistName: undefined, lastPing: 0, lastSeen: 0 }), false, NOW, on)), "v1-vote-refused");
});
test("rollback VOTE_ONLY_NETWORK=false : comportement HISTORIQUE (tout est admis ici, v1, non appairé, ancien firmware, capteur) — seul l'appareil absent reste refusé", () => {
  for (const d of [dev({ firmware: "multiscreen-2.2" }), dev({ artistId: undefined, artistName: undefined }), dev({ screens: ["sensor"] }), dev({ lastPing: 0, lastSeen: 0 })]) assert.equal(reason(voteAdmission(d, false, NOW, off)), "ok");
  assert.equal(voteAdmission(null, false, NOW, off).ok, false);
});
