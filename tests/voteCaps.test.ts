// LOT 5 (28/10/2026) — capacités de vote DÉCLARÉES : affichage, mesure, vote et OTA sont indépendants ; un validateur sans écran passe par une capacité explicite ET une famille de firmware autorisée par le serveur.
// Aucun firmware de ce type n'existe aujourd'hui : la table VALIDATOR_NODE_FIRMWARE est vide, donc RIEN ne change pour les appareils existants (testé ici).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { VALIDATOR_NODE_FIRMWARE, VOTE_ANIM_V3_FIRMWARE, VOTE_CAPS, isValidatorNode, parseVoteCaps, voteAdmission, voteV2Capable, votesAnimV3 } from "../lib/voteCapability";
import { exclusionReason, summarizePool } from "../lib/electorate";

const NOW = Date.UTC(2026, 9, 28, 12, 0);
const MIN = 60_000, W = 45 * MIN, ON = {} as unknown as NodeJS.ProcessEnv;
const node = (over: Record<string, unknown> = {}) => ({ screens: ["sensor"], firmware: "r4sensorval-1.0", caps: ["vote-static-v2"], artistName: "x", lastPing: NOW - 5 * MIN, missedVotes: 0, ...over });
const withFamily = (fn: () => void) => { VALIDATOR_NODE_FIRMWARE["r4sensorval"] = [1, 0]; try { fn(); } finally { delete VALIDATOR_NODE_FIRMWARE["r4sensorval"]; } };

test("parseVoteCaps : liste fermée, bornée, sans doublon, sans texte libre ; toute autre forme = aucune capacité", () => {
  assert.deepEqual([...VOTE_CAPS], ["vote-static-v2", "vote-anim-v3"]);
  assert.deepEqual(parseVoteCaps(["vote-static-v2"]), ["vote-static-v2"]);
  assert.deepEqual(parseVoteCaps(["vote-static-v2", "vote-anim-v3", "vote-static-v2"]), ["vote-static-v2", "vote-anim-v3"]);
  for (const bad of [undefined, null, "vote-static-v2", [], {}, 3, ["vote-static-v2", "autre"], ["VOTE-STATIC-V2"], [1], [null], ["vote-static-v2", "vote-anim-v3", "a", "b", "c"], ["<script>"], ["x".repeat(500)]]) assert.equal(parseVoteCaps(bad), undefined, JSON.stringify(bad));
});

test("AUJOURD'HUI (table vide) : aucun appareil existant ne change — un capteur seul reste exclu et ne vote pas, même s'il déclare une capacité", () => {
  assert.deepEqual(VALIDATOR_NODE_FIRMWARE, {});
  assert.deepEqual(VOTE_ANIM_V3_FIRMWARE, {});
  const dht = node({ firmware: "r4dht22-1.3" });
  assert.equal(isValidatorNode(dht), false);
  assert.equal(exclusionReason(dht, NOW, W, ON), "sensor-only");
  const adm = voteAdmission(dht, true, NOW, ON);
  assert.equal(adm.ok, false); assert.equal(adm.ok ? "" : adm.reason, "sensor-cannot-vote");
  assert.equal(voteV2Capable("r4dht22-1.3"), false, "l'ancien firmware capteur reste NON votant");
  assert.equal(isValidatorNode(node()), false, "famille inconnue : la déclaration seule ne suffit pas");
  assert.equal(votesAnimV3({ firmware: "r4tft18-2.3", caps: ["vote-anim-v3"] }), false, "l'animation v3 n'est active sur aucune carte");
});

test("validateur sans écran : déclaration ET famille autorisée => compté, admis au vote ; sans capacité, ou famille non autorisée, ou ancien firmware => jamais", () => {
  withFamily(() => {
    const v = node();
    assert.equal(isValidatorNode(v), true);
    assert.equal(voteV2Capable("r4sensorval-1.0"), true);
    assert.equal(exclusionReason(v, NOW, W, ON), null, "compté dans le quorum");
    assert.equal(voteAdmission(v, true, NOW, ON).ok, true);
    assert.equal(voteAdmission(v, false, NOW, ON).ok, false, "un vote v1 reste refusé");
    // sans capacité déclarée
    assert.equal(isValidatorNode(node({ caps: undefined })), false);
    assert.equal(exclusionReason(node({ caps: [] }), NOW, W, ON), "sensor-only");
    // famille non autorisée malgré la déclaration
    assert.equal(isValidatorNode(node({ firmware: "r4dht22-1.3" })), false);
    // version trop ancienne
    assert.equal(isValidatorNode(node({ firmware: "r4sensorval-0.9" })), false);
    // les autres portes restent : non appairé, inactif, trop de manques
    assert.equal(exclusionReason(node({ artistName: undefined }), NOW, W, ON), "not-paired");
    assert.equal(exclusionReason(node({ lastPing: NOW - 600 * MIN }), NOW, W, ON), "inactive");
    assert.equal(exclusionReason(node({ missedVotes: 3 }), NOW, W, ON), "missed-votes");
    assert.equal(voteAdmission(node({ lastPing: NOW - 600 * MIN }), true, NOW, ON).ok, false);
    // le décompte du quorum
    const pool = summarizePool([node(), node({ firmware: "r4dht22-1.3", caps: undefined }), { screens: ["tft18"], firmware: "r4tft18-2.3", artistName: "x", lastPing: NOW - MIN }], NOW, W, ON);
    assert.equal(pool.summary.counted, 2);
    assert.deepEqual(pool.summary.excluded, { "sensor-only": 1 });
  });
  assert.deepEqual(VALIDATOR_NODE_FIRMWARE, {}, "la table est restaurée");
});

test("un appareil À ÉCRAN n'est pas affecté par `caps` ; l'animation v3 exige sa propre famille", () => {
  const tft = { screens: ["tft18"], firmware: "r4tft18-2.3", caps: ["vote-static-v2", "vote-anim-v3"], artistName: "x", lastPing: NOW - MIN };
  assert.equal(isValidatorNode(tft), false, "un appareil à écran n'est jamais un « validateur sans écran »");
  assert.equal(exclusionReason(tft, NOW, W, ON), null);
  assert.equal(votesAnimV3(tft), false);
  VOTE_ANIM_V3_FIRMWARE["r4tft18"] = [3, 0];
  try { assert.equal(votesAnimV3({ ...tft, firmware: "r4tft18-3.0" }), true); assert.equal(votesAnimV3({ ...tft, firmware: "r4tft18-2.9" }), false); assert.equal(votesAnimV3({ ...tft, firmware: "r4tft18-3.0", caps: ["vote-static-v2"] }), false); } finally { delete VOTE_ANIM_V3_FIRMWARE["r4tft18"]; }
});

test("câblage : /api/register lit `caps` avec parseVoteCaps, registerDevice les persiste, l'index électoral accepte un validateur sans jamais l'ajouter à une pool d'écran", () => {
  const root = path.join(__dirname, "..");
  const reg = fs.readFileSync(path.join(root, "app/api/register/route.ts"), "utf8");
  assert.match(reg, /parseVoteCaps\(body\.caps\)/);
  const ds = fs.readFileSync(path.join(root, "lib/deviceStore.ts"), "utf8");
  assert.match(ds, /if \(caps\) existing\.caps = caps; else delete existing\.caps;/);
  assert.equal((ds.match(/isValidatorNode\(\{ screens, firmware, caps \}\)/g) ?? []).length, 2, "deux sadd devices:all (appareil existant et nouveau)");
  assert.match(ds, /\(!isSensorScreens\(d\.screens\) \|\| isValidatorNode\(d\)\) && participatesInVoteNetwork\(d\)/);
  // les pools d'écran ne sont jamais alimentées par un capteur seul (inchangé)
  assert.match(reg, /const sensor = isSensorScreens\(screens\);/);
});
