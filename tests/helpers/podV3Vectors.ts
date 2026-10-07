// tests/helpers/podV3Vectors.ts — construit les VECTEURS D'OR du protocole v3 à partir de l'implémentation de référence (lib/podProtocolV3.ts).
// `node --import tsx scripts/gen-pod-v3-vectors.ts` écrit tests/fixtures/pod-v3-vectors.json ; tests/podProtocolV3.test.ts exige que le fichier commité == ce que produit le code.
// Toute autre implémentation (vérificateur indépendant, C++ hôte, firmware) doit retrouver CES sorties à l'octet près.
// La clé ci-dessous est une clé de TEST publique (graine 0x01…0x20) : elle ne protège rien et n'est utilisée par aucun appareil.

import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  PROTOCOL, blockCanonicalV2, blockHashV2, classifyVote, committeeRank, committeeWindow, decide, drawMiner, evaluateRules, merkleProof, merkleRoot, minerSeed, parseVoteMessageV3,
  saltNonce, saltedHash, selectCommittee, sha256Hex, voteLeaf, voteMessageV3, type BlockCanonicalV2, type VoteV3, type Verdict,
} from "../../lib/podProtocolV3";

export const TEST_SEED_HEX = Array.from({ length: 32 }, (_, i) => (i + 1).toString(16).padStart(2, "0")).join("");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function testKeypair() {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(TEST_SEED_HEX, "hex")]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(priv).export({ format: "der", type: "spki" }) as Buffer;
  return { priv, pubHex: spki.subarray(spki.length - 32).toString("hex") };
}

export const CANDIDATE_ID = "123e4567-e89b-42d3-a456-426614174000";
export const PARENT_HASH = sha256Hex("pod-test-parent");
export const DEVICE_ID = "dev_AB12CD34";

const pattern = (n: number, mul: number) => Uint8Array.from({ length: n }, (_, i) => (i * mul + 7) & 0xff);

export function buildVectors() {
  const raw16 = Uint8Array.from({ length: 16 }, (_, i) => i);
  const raw1024 = pattern(1024, 31);
  const nonce = saltNonce(CANDIDATE_ID, PARENT_HASH, DEVICE_ID);

  // ── règles ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const ruleInputs = [
    { formatOk: true, hashOk: true, e: 523_000, t: 311_000 }, { formatOk: true, hashOk: true, e: 0, t: 0 }, { formatOk: true, hashOk: true, e: 990_000, t: 950_000 },
    { formatOk: true, hashOk: true, e: 980_000, t: 950_000 }, { formatOk: true, hashOk: true, e: 980_001, t: 900_000 }, { formatOk: true, hashOk: true, e: 980_001, t: 900_001 },
    { formatOk: true, hashOk: false, e: 0, t: 0 }, { formatOk: false, hashOk: false, e: 500_000, t: 500_000 }, { formatOk: true, hashOk: true, e: 0, t: 1 },
  ];
  const rules = ruleInputs.map((input) => ({ input, ...evaluateRules(input) }));

  // ── vote signé ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const { priv, pubHex } = testKeypair();
  const rawHash = sha256Hex(raw1024);
  const vote: VoteV3 = {
    deviceId: DEVICE_ID, candidateId: CANDIDATE_ID, parentHash: PARENT_HASH, metricsVersion: PROTOCOL.metricsVersion, rulesVersion: PROTOCOL.rulesVersion,
    rawHash, saltedHash: saltedHash(nonce, raw1024), e: 523_000, t: 311_000, r: 640_000, verdict: "accept", ruleCode: "ok", vclass: "C0",
  };
  const message = voteMessageV3(vote);
  const signatureHex = sign(null, Buffer.from(message, "utf8"), priv).toString("hex");
  const rejectVote: VoteV3 = { ...vote, e: 0, t: 0, r: 0, verdict: "reject", ruleCode: "uniform" };

  // ── Merkle ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const leaves = (n: number) => Array.from({ length: n }, (_, i) => voteLeaf(`m${i}`, "ab".repeat(64), "cd".repeat(32)));
  const merkle = [0, 1, 2, 3, 5, 7].map((n) => ({ leaves: n, root: merkleRoot(leaves(n)), ...(n >= 3 ? { proofIndex: n - 1, proof: merkleProof(leaves(n), n - 1) } : {}) }));

  // ── comité ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const profiles = ["art_alice", "art_bob", "art_carol", "art_dave", "art_erin", "art_frank", "art_grace", "art_heidi", "art_ivan"];
  const c9 = selectCommittee({ eligibleProfiles: profiles, authorProfileId: "art_carol", candidateId: CANDIDATE_ID, parentHash: PARENT_HASH });
  const c2 = selectCommittee({ eligibleProfiles: ["art_alice", "art_bob", "art_carol"], authorProfileId: "art_carol", candidateId: CANDIDATE_ID, parentHash: PARENT_HASH });
  const c0 = selectCommittee({ eligibleProfiles: ["art_carol"], authorProfileId: "art_carol", candidateId: CANDIDATE_ID, parentHash: PARENT_HASH });
  const voteMap = (acc: number, rej: number, c = c9): Map<string, Verdict> => {
    const m = new Map<string, Verdict>(); const w = committeeWindow(c, 1);
    w.slice(0, acc).forEach((p) => m.set(p, "accept")); w.slice(acc, acc + rej).forEach((p) => m.set(p, "reject")); return m;
  };
  const decisions = [[5, 0], [5, 2], [4, 3], [3, 3], [2, 3], [0, 3]].map(([a, r]) => ({ wave: 1, ...decide(c9, 1, voteMap(a, r)) }));

  // ── mineur ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const accepted = [{ profileId: "art_bob", minedBlocks: 0 }, { profileId: "art_alice", minedBlocks: 3 }, { profileId: "art_dave", minedBlocks: 12 }];
  const miner = { seed: minerSeed(CANDIDATE_ID, PARENT_HASH), accepted, winner: drawMiner({ candidateId: CANDIDATE_ID, parentHash: PARENT_HASH, accepted }) };

  // ── bloc v2 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const block: BlockCanonicalV2 = {
    parentHash: PARENT_HASH, imageHash: rawHash, actionsHash: sha256Hex("pod-test-actions"), deviceId: DEVICE_ID, poolScreen: "oled096",
    validatorProfileIds: ["art_bob", "art_alice"], scorePpm: 587_000, minedAt: 1_791_300_000_000, votesRoot: merkleRoot(leaves(2)), committeeMode: "committee", committeeK: 7,
  };

  // ── réputation ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const ref = { rawHash, e: 523_000, t: 311_000, r: 640_000 };
  const uniformRef = { rawHash: sha256Hex("pod-uniform"), e: 0, t: 0, r: 0 };
  const cases: Array<[string, VoteV3, typeof ref]> = [
    ["accept conforme", vote, ref],
    ["accept avec métriques fausses", { ...vote, e: 1 }, ref],
    ["accept avec hash faux", { ...vote, rawHash: sha256Hex("autre") }, ref],
    ["reject uniform justifié", { ...rejectVote, rawHash: uniformRef.rawHash }, uniformRef],
    ["reject uniform alors que la référence ne l'est pas, mêmes mesures signées", { ...vote, verdict: "reject", ruleCode: "uniform" }, ref],
    ["reject uniform avec mesures différentes de la référence", rejectVote, ref],
    ["reject hash en signant le même hash que la référence", { ...vote, verdict: "reject", ruleCode: "hash" }, ref],
    ["reject hash en signant un autre hash", { ...vote, rawHash: sha256Hex("autre"), verdict: "reject", ruleCode: "hash" }, ref],
  ];
  const reputation = cases.map(([name, v, r]) => ({ name, event: classifyVote(v, r) }));

  return {
    _comment: "Vecteurs d'or du protocole v3 (BROUILLON, à geler par GPT). Généré par tests/helpers/podV3Vectors.ts. Clé de TEST publique, sans valeur.",
    protocol: PROTOCOL,
    testKey: { seedHex: TEST_SEED_HEX, publicKeyHex: pubHex },
    rules,
    salted: { candidateId: CANDIDATE_ID, parentHash: PARENT_HASH, deviceId: DEVICE_ID, nonceHex: nonce.toString("hex"), raw16Hex: Buffer.from(raw16).toString("hex"), saltedHash16: saltedHash(nonce, raw16), raw1024Sha256: rawHash, saltedHash1024: vote.saltedHash },
    vote: { fields: vote, message, signatureHex, publicKeyHex: pubHex, leafHex: voteLeaf(message, signatureHex, pubHex).toString("hex"), rejectMessage: voteMessageV3(rejectVote) },
    merkle,
    committee: {
      profiles, author: "art_carol",
      ranks: Object.fromEntries(profiles.map((p) => [p, committeeRank(CANDIDATE_ID, PARENT_HASH, p)])),
      c9: { ...c9, window1: committeeWindow(c9, 1), window2: committeeWindow(c9, 2) },
      bootstrap2: c2, none: c0, decisions,
    },
    miner,
    block: { fields: block, canonical: blockCanonicalV2(block), hash: blockHashV2(block) },
    reputation,
    parseRoundTrip: parseVoteMessageV3(message) !== null,
  };
}
