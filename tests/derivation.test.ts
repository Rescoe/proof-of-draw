import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPrivateKey, createPublicKey, createHash, sign } from "node:crypto";
import { buildBlockV2, type ReceiptsDoc } from "../lib/blockReceipts";
import { blockCanonicalV2, blockHashV2, type BlockCanonicalV2 } from "../lib/podProtocolV3";
import { blockHashV1, verifyBlock, toProofBlock, type ProofBlock } from "../lib/podVerify";
import { buildCandidateV2, voteMessageV2 } from "../lib/podVote";
import { METRIC_GRID, PPM } from "../lib/podMetrics";
import { checkDerivation, parseDerivedFrom } from "../lib/derivation";
import { gateDerivation } from "../lib/derivationGate";
import type { Block, Candidate, ValidationVote } from "../lib/chain";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const H = (s: string) => createHash("sha256").update(s).digest("hex");
const SRC = H("source-block"), PARENT = H("parent"), CID = "123e4567-e89b-42d3-a456-426614174000";

// ── règles pures ─────────────────────────────────────────────────────────────
test("parseDerivedFrom : 64 hex strict (casse ignorée), tout le reste est refusé", () => {
  assert.equal(parseDerivedFrom(SRC), SRC);
  assert.equal(parseDerivedFrom(SRC.toUpperCase()), SRC);
  for (const bad of ["", "abc", SRC + "0", SRC.slice(1), "g".repeat(64), null, undefined, 12, {}, [SRC]]) assert.equal(parseDerivedFrom(bad), null);
});

test("checkDerivation : source inconnue, animation, autre écran, œuvre identique refusées ; une vraie modification passe", () => {
  const src = { blockHash: SRC, poolScreen: "tft28", imageHash: "aa" };
  assert.equal(checkDerivation(null, { poolScreen: "tft28", imageHash: "bb" }).ok, false);
  assert.deepEqual(checkDerivation(src, { poolScreen: "tft28", imageHash: "bb" }), { ok: true });
  const code = (r: ReturnType<typeof checkDerivation>) => (r.ok ? "ok" : r.code);
  assert.equal(code(checkDerivation(src, { poolScreen: "tft28", imageHash: "aa" })), "identical");
  assert.equal(code(checkDerivation(src, { poolScreen: "tft18", imageHash: "bb" })), "screen_mismatch");
  assert.equal(code(checkDerivation(src, { poolScreen: "tft28", imageHash: "bb", kind: "animation" })), "animation_unsupported");
  assert.equal(code(checkDerivation({ ...src, kind: "animation" }, { poolScreen: "tft28", imageHash: "bb" })), "source_animation");
});

test("gateDerivation : sans filiation déclarée → aucune lecture ; hash invalide → 400 ; source réelle → hash normalisé ; refus → 400 avec raison", async () => {
  let reads = 0;
  const load = async (h: string) => { reads++; return h === SRC ? ({ blockHash: SRC, poolScreen: "tft28", imageHash: "aa" } as Block) : null; };
  assert.deepEqual(await gateDerivation(undefined, { poolScreen: "tft28", imageHash: "bb" }, load), { ok: true });
  assert.deepEqual(await gateDerivation("", { poolScreen: "tft28", imageHash: "bb" }, load), { ok: true });
  assert.equal(reads, 0, "aucune lecture Redis pour un dessin ordinaire");
  const bad = await gateDerivation("pas-un-hash", { poolScreen: "tft28", imageHash: "bb" }, load);
  assert.equal(bad.ok === false && bad.status, 400); assert.equal(reads, 0);
  const ok = await gateDerivation(SRC.toUpperCase(), { poolScreen: "tft28", imageHash: "bb" }, load);
  assert.deepEqual(ok, { ok: true, derivedFromBlockHash: SRC }); assert.equal(reads, 1);
  const same = await gateDerivation(SRC, { poolScreen: "tft28", imageHash: "aa" }, load);
  assert.equal(same.ok === false && same.reason, "derivation_identical");
  const unknown = await gateDerivation(H("autre"), { poolScreen: "tft28", imageHash: "bb" }, load);
  assert.equal(unknown.ok === false && unknown.reason, "derivation_unknown_source");
});

// ── hash v1 ──────────────────────────────────────────────────────────────────
const v1: ProofBlock = { blockHash: "", parentHash: PARENT, imageHash: H("img"), actionsHash: H("act"), deviceId: "dev_AAAA0001", poolScreen: "oled096", validatorIds: ["dev_B", "dev_A"], score: 0.4321, minedAt: 1_791_300_000_000 };
const OLD_V1 = (b: ProofBlock) => createHash("sha256").update(JSON.stringify({ parentHash: b.parentHash, imageHash: b.imageHash, actionsHash: b.actionsHash, deviceId: b.deviceId, poolScreen: b.poolScreen, validatorIds: [...b.validatorIds].sort(), score: b.score, minedAt: b.minedAt, animRoot: b.animRoot })).digest("hex");

test("COMPATIBILITÉ v1 : un bloc sans filiation garde EXACTEMENT son hash historique ; avec filiation le hash change ; la modifier ou la retirer l'invalide", () => {
  assert.equal(blockHashV1(v1), OLD_V1(v1), "le hash d'un bloc non dérivé n'a pas bougé");
  const derived = { ...v1, derivedFromBlockHash: SRC };
  const h = blockHashV1(derived);
  assert.notEqual(h, blockHashV1(v1));
  const sealed = { ...derived, blockHash: h };
  assert.equal(verifyBlock({ block: sealed, receipts: null, parent: { blockHash: PARENT }, derivedFrom: { blockHash: SRC, minedAt: 1 } }).checks.find((c) => c.id === "hash")?.status, "ok");
  const altered = { ...sealed, derivedFromBlockHash: H("autre") };
  assert.equal(verifyBlock({ block: altered, receipts: null }).checks.find((c) => c.id === "hash")?.status, "fail", "filiation modifiée");
  const { derivedFromBlockHash: _drop, ...stripped } = sealed; void _drop;
  assert.equal(verifyBlock({ block: stripped as ProofBlock, receipts: null }).checks.find((c) => c.id === "hash")?.status, "fail", "filiation retirée");
});

// ── hash v2 ──────────────────────────────────────────────────────────────────
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
function keypair(seedByte: number) {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.alloc(32, seedByte)]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(priv).export({ format: "der", type: "spki" }) as Buffer;
  return { priv, pub: spki.subarray(spki.length - 32).toString("hex") };
}
const oled = (() => { const b = Buffer.alloc(METRIC_GRID.oled096.rawBytes); for (let i = 0; i < b.length; i += 3) b[i] = 0xa5 ^ (i & 0xff); return b; })();
const v2spec = buildCandidateV2("oled096", { screen: "oled096", buffer: oled.toString("base64") })!;
function vote(deviceId: string, seed: number): ValidationVote {
  const kp = keypair(seed);
  const msg = voteMessageV2({ deviceId, candidateId: CID, rawHash: v2spec.rawHash, e: v2spec.e, t: v2spec.t, r: v2spec.r, verdict: "accept" });
  return { deviceId, entropy: v2spec.e / PPM, transitions: v2spec.t / PPM, rle: v2spec.r / PPM, score: v2spec.s / PPM, signature: sign(null, Buffer.from(msg, "utf8"), kp.priv).toString("hex"), votedAt: 1, v: 2, verdict: "accept", pk: kp.pub, rawHash: v2spec.rawHash } as ValidationVote;
}
const votes = [vote("dev_AAAA0001", 1), vote("dev_BBBB0002", 2), vote("dev_CCCC0003", 3)];
const candBase = { candidateId: CID, poolSize: 3, v2: v2spec, anim: undefined, imageHash: H("img2"), actionsHash: H("act2"), deviceId: "dev_AUTHOR01", poolScreen: "oled096" } as unknown as Candidate;
function mk(extra: Partial<Candidate> = {}) {
  const built = buildBlockV2({ candidate: { ...candBase, ...extra }, allVotes: votes, parentHash: PARENT, finalScore: 0.4321, minedAt: 1_791_300_000_000 });
  const block: ProofBlock = { blockHash: built.blockHash, parentHash: PARENT, imageHash: candBase.imageHash, actionsHash: candBase.actionsHash, deviceId: candBase.deviceId, poolScreen: "oled096", validatorIds: votes.map((v) => v.deviceId).sort(), score: 0.4321, minedAt: 1_791_300_000_000, ...built.fields, ...(extra.derivedFromBlockHash ? { derivedFromBlockHash: extra.derivedFromBlockHash } : {}) };
  return { block, doc: built.doc as ReceiptsDoc };
}
const st = (r: ReturnType<typeof verifyBlock>, id: string) => r.checks.find((c) => c.id === id)?.status;

test("COMPATIBILITÉ v2 : le texte canonique d'un bloc non dérivé ne contient aucune clé de filiation et son hash est celui du format historique", () => {
  const plain = mk();
  const canon: BlockCanonicalV2 = { parentHash: PARENT, imageHash: candBase.imageHash, actionsHash: candBase.actionsHash, contentHash: plain.block.contentHash!, deviceId: candBase.deviceId, poolScreen: "oled096", validatorProfileIds: ["dev_AAAA0001", "dev_BBBB0002", "dev_CCCC0003"], scorePpm: plain.block.scorePpm!, minedAt: 1_791_300_000_000, votesRoot: plain.block.votesRoot!, committeeMode: "quorum", committeeK: 3, committeeRoot: plain.block.committeeRoot!, minerRoot: plain.block.minerRoot! };
  assert.doesNotMatch(blockCanonicalV2(canon), /derivedFrom/);
  assert.equal(blockHashV2(canon), plain.block.blockHash);
  const withKey = blockCanonicalV2({ ...canon, derivedFromBlockHash: SRC });
  assert.match(withKey, /"derivedFromBlockHash":"[0-9a-f]{64}"/);
  assert.notEqual(blockHashV2({ ...canon, derivedFromBlockHash: SRC }), blockHashV2(canon));
});

test("bloc v2 dérivé honnête : tous les contrôles passent, la filiation est exposée (forme + bloc d'origine retrouvé)", () => {
  const { block, doc } = mk({ derivedFromBlockHash: SRC });
  const r = verifyBlock({ block, receipts: doc, parent: { blockHash: PARENT }, derivedFrom: { blockHash: SRC, minedAt: 1_700_000_000_000 } });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.status === "fail")));
  assert.equal(st(r, "hash"), "ok"); assert.equal(st(r, "derivation"), "ok"); assert.equal(st(r, "derivation-source"), "ok");
  assert.equal(st(verifyBlock({ block, receipts: doc, parent: { blockHash: PARENT } }), "derivation-source"), "na", "bloc d'origine non fourni");
});

test("FALSIFICATION v2 — filiation retirée, modifiée ou ajoutée après coup : le hash échoue ; bloc d'origine faux, postérieur ou introuvable : détecté", () => {
  const { block, doc } = mk({ derivedFromBlockHash: SRC });
  const { derivedFromBlockHash: _x, ...stripped } = block; void _x;
  assert.equal(st(verifyBlock({ block: stripped as ProofBlock, receipts: doc }), "hash"), "fail", "retirée");
  assert.equal(st(verifyBlock({ block: { ...block, derivedFromBlockHash: H("x") }, receipts: doc }), "hash"), "fail", "modifiée");
  const plain = mk();
  assert.equal(st(verifyBlock({ block: { ...plain.block, derivedFromBlockHash: SRC }, receipts: plain.doc }), "hash"), "fail", "ajoutée a posteriori à un bloc historique");
  assert.equal(st(verifyBlock({ block, receipts: doc, derivedFrom: { blockHash: H("autre"), minedAt: 1 } }), "derivation-source"), "fail");
  assert.equal(st(verifyBlock({ block, receipts: doc, derivedFrom: { blockHash: SRC, minedAt: block.minedAt + 1 } }), "derivation-source"), "fail", "origine postérieure");
  assert.equal(st(verifyBlock({ block, receipts: doc, derivedFrom: null }), "derivation-source"), "fail", "origine introuvable");
  assert.equal(st(verifyBlock({ block: { ...block, derivedFromBlockHash: block.blockHash }, receipts: doc }), "derivation"), "fail", "un bloc ne peut pas dériver de lui-même");
});

test("un bloc d'animation (rulesVersion 2) ne peut pas déclarer de filiation", () => {
  const { block, doc } = mk();
  const r = verifyBlock({ block: { ...block, rulesVersion: 2, derivedFromBlockHash: SRC }, receipts: doc });
  assert.equal(st(r, "derivation"), "fail");
});

test("toProofBlock : la filiation figure dans la preuve publique seulement quand elle existe", () => {
  const base = { blockIndex: 1, blockHash: H("b"), parentHash: PARENT, imageHash: H("i"), actionsHash: H("a"), drawScore: 1, deviceId: "dev_A", artistName: "x", poolScreen: "oled096", validatorIds: [], score: 0.5, displayTime: 1, minedAt: 1, frameId: "f" } as Block;
  assert.equal("derivedFromBlockHash" in toProofBlock(base), false);
  assert.equal(toProofBlock({ ...base, derivedFromBlockHash: SRC }).derivedFromBlockHash, SRC);
});

// ── câblage serveur (texte source : ordre des opérations) ────────────────────
test("finalizeBlock engage la filiation dans le hash v1 ET dans le hash v2 ; le bloc la porte ; aucune clé Redis de provenance", () => {
  const chain = read("lib/chain.ts");
  assert.match(chain, /animRoot:\s+candidate\.anim\?\.root,\s*\n\s*\/\/[^\n]*\n\s*derivedFromBlockHash: candidate\.derivedFromBlockHash,/);
  assert.match(chain, /\.\.\.\(candidate\.derivedFromBlockHash \? \{ derivedFromBlockHash: candidate\.derivedFromBlockHash \} : \{\}\)/);
  assert.match(read("lib/blockReceipts.ts"), /derivedFromBlockHash: i\.candidate\.derivedFromBlockHash/);
  assert.doesNotMatch(chain + read("lib/derivationGate.ts") + read("app/api/draw/route.ts"), /redis\.(set|lpush|sadd)\([^)]*(deriv|remix|provenance)/i);
});

test("/api/draw vérifie la filiation AVANT le verrou de dépôt et la transmet (file d'attente comprise) ; submit-candidate la re-vérifie et la pose sur le candidat", () => {
  const draw = read("app/api/draw/route.ts");
  assert.ok(draw.indexOf("gateDerivation(") < draw.indexOf("redis.set(lockKey(deviceId)"), "avant le verrou");
  assert.ok(draw.indexOf("gateDerivation(") > draw.indexOf("sessionOwnsDevice(deviceId)"), "après l'authentification");
  assert.equal((draw.match(/derivedFromBlockHash/g) ?? []).length >= 4, true);
  const sub = read("app/api/submit-candidate/route.ts");
  assert.match(sub, /gateDerivation\(body\.derivedFromBlockHash/);
  assert.match(sub, /\.\.\.\(gate\.derivedFromBlockHash \? \{ derivedFromBlockHash: gate\.derivedFromBlockHash \} : \{\}\)/);
  assert.ok(sub.indexOf("gateDerivation(") > sub.indexOf("hashDrawing(screen"), "après le calcul de l'empreinte de l'image");
});
