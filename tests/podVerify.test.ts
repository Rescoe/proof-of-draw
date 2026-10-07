import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPrivateKey, createPublicKey, createHash, sign } from "node:crypto";
import { buildBlockV2, blockReceiptsEnabled, receiptMessage, receiptsRoot, validatorKeysOf, type ReceiptsDoc } from "../lib/blockReceipts";
import { blockHashV2, type BlockCanonicalV2 } from "../lib/podProtocolV3";
import { blockHashV1, verifyBlock, type ProofBlock } from "../lib/podVerify";
import { buildCandidateV2, voteMessageV2 } from "../lib/podVote";
import { METRIC_GRID, metricsFromRaw, PPM, rawContent } from "../lib/podMetrics";
import { finalizeBlock, type Candidate, type ValidationVote } from "../lib/chain";

// Lot 3 — reçus signés et vérificateur public. Vraies signatures Ed25519 (clés de TEST), vrais messages v2, vrai contenu OLED ; puis FALSIFICATIONS.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
function keypair(seedByte: number) {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.alloc(32, seedByte)]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(priv).export({ format: "der", type: "spki" }) as Buffer;
  return { priv, pub: spki.subarray(spki.length - 32).toString("hex") };
}
const sig = (kp: ReturnType<typeof keypair>, msg: string) => sign(null, Buffer.from(msg, "utf8"), kp.priv).toString("hex");

const CANDIDATE_ID = "123e4567-e89b-42d3-a456-426614174000";
const PARENT = createHash("sha256").update("parent").digest("hex");
const oled = (() => { const b = Buffer.alloc(METRIC_GRID.oled096.rawBytes); for (let i = 0; i < b.length; i += 3) b[i] = 0xa5 ^ (i & 0xff); return b; })();
const payload = { screen: "oled096", buffer: oled.toString("base64") };
const v2spec = buildCandidateV2("oled096", payload)!;
const candidate = { candidateId: CANDIDATE_ID, poolSize: 3, v2: v2spec, anim: undefined, imageHash: "i".repeat(64).replace(/i/g, "a"), actionsHash: "b".repeat(64), deviceId: "dev_AUTHOR01", poolScreen: "oled096" } as unknown as Candidate;

const kA = keypair(1), kB = keypair(2), kC = keypair(3), kD = keypair(4);
function v2vote(deviceId: string, kp: ReturnType<typeof keypair>, over: Partial<ValidationVote> = {}, tamper?: (m: string) => string): ValidationVote {
  const msg = voteMessageV2({ deviceId, candidateId: CANDIDATE_ID, rawHash: v2spec.rawHash, e: v2spec.e, t: v2spec.t, r: v2spec.r, verdict: "accept" });
  return { deviceId, entropy: v2spec.e / PPM, transitions: v2spec.t / PPM, rle: v2spec.r / PPM, score: v2spec.s / PPM, signature: sig(kp, tamper ? tamper(msg) : msg), votedAt: 1, v: 2, verdict: "accept", pk: kp.pub, rawHash: v2spec.rawHash, ...over } as ValidationVote;
}
function v1vote(deviceId: string, kp: ReturnType<typeof keypair> | null, score = 0.5): ValidationVote {
  const msg = `${deviceId}:${CANDIDATE_ID}:${score.toFixed(3)}`;
  return { deviceId, entropy: score, transitions: score, rle: score, score, signature: kp ? sig(kp, msg) : "", votedAt: 1, ...(kp ? { pk: kp.pub } : {}) } as ValidationVote;
}

function makeBlock(votes: ValidationVote[], over: Partial<ProofBlock> = {}) {
  const built = buildBlockV2({ candidate, allVotes: votes, parentHash: PARENT, finalScore: 0.4321, minedAt: 1_791_300_000_000 });
  const accepted = votes.filter((v) => v.verdict !== "reject");
  const block: ProofBlock = {
    blockHash: built.blockHash, parentHash: PARENT, imageHash: candidate.imageHash, actionsHash: candidate.actionsHash, deviceId: candidate.deviceId, poolScreen: "oled096",
    validatorIds: accepted.map((v) => v.deviceId).sort(), score: 0.4321, minedAt: 1_791_300_000_000, ...built.fields, ...over,
  };
  return { block, doc: built.doc };
}
const statusOf = (r: ReturnType<typeof verifyBlock>, id: string) => r.checks.find((c) => c.id === id)?.status;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

test("bloc v2 honnête (3 votes v2 signés) : toutes les vérifications passent, niveau « reçus » ; avec le contenu : niveau « contenu »", () => {
  const { block, doc } = makeBlock([v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB), v2vote("dev_CCCC0003", kC)]);
  const r = verifyBlock({ block, receipts: doc, parent: { blockHash: PARENT } });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.status === "fail")));
  assert.equal(r.level, "receipts");
  assert.deepEqual([r.stats.v2Accepts, r.stats.v1Echoes, r.stats.rejects, r.stats.invalidSignatures], [3, 0, 0, 0]);
  for (const id of ["hash", "chain", "receipts-count", "votes-root", "binding", "signatures-v2", "quorum", "validators"]) assert.equal(statusOf(r, id), "ok", id);
  assert.equal(statusOf(r, "identity"), "na", "l'identité d'un appareil n'est JAMAIS présentée comme vérifiée");
  assert.equal(statusOf(r, "position"), "warn", "la position dans la chaîne n'est pas signée par les votes v2");
  const full = verifyBlock({ block, receipts: doc, parent: { blockHash: PARENT }, content: { screen: "oled096", raw: rawContent("oled096", payload) } });
  assert.equal(full.level, "content");
  assert.equal(statusOf(full, "content-metrics"), "ok");
});

test("reçus des refus conservés : un refus signé figure dans les reçus et la racine, mais pas dans les validateurs ; le quorum reste atteint", () => {
  const rejectMsg = voteMessageV2({ deviceId: "dev_DDDD0004", candidateId: CANDIDATE_ID, rawHash: v2spec.rawHash, e: 0, t: 0, r: 0, verdict: "reject" });
  const rej = { ...v2vote("dev_DDDD0004", kD), entropy: 0, transitions: 0, rle: 0, verdict: "reject", signature: sig(kD, rejectMsg) } as ValidationVote;
  const { block, doc } = makeBlock([v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB), rej]);
  assert.equal(doc.receipts.length, 3);
  const r = verifyBlock({ block, receipts: doc, parent: { blockHash: PARENT } });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.status === "fail")));
  assert.equal(r.stats.rejects, 1);
  assert.deepEqual(block.validatorIds, ["dev_AAAA0001", "dev_BBBB0002"]);
});

test("votes hérités (écho) : visibles et signalés « warn » — la signature ne couvre aucun contenu ; un mélange v2 + v1 vérifie mais n'est JAMAIS présenté comme entièrement recalculé", () => {
  const { block, doc } = makeBlock([v2vote("dev_AAAA0001", kA), v1vote("dev_BBBB0002", kB), v1vote("dev_CCCC0003", null)]);
  const r = verifyBlock({ block, receipts: doc, parent: { blockHash: PARENT } });
  assert.equal(r.stats.v1Echoes, 2); assert.equal(r.stats.v2Accepts, 1);
  assert.equal(statusOf(r, "signatures-v1"), "warn");
  assert.match(r.checks.find((c) => c.id === "signatures-v1")!.detail!, /AUCUN contenu/);
  assert.equal(r.stats.invalidSignatures, 1, "le vote hérité sans clé ni signature est compté");
  assert.equal(r.ok, true);
});

test("FALSIFICATION — le serveur change un reçu : racine, hash et vérification échouent", () => {
  const { block, doc } = makeBlock([v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB), v2vote("dev_CCCC0003", kC)]);
  const bad = clone(doc); bad.receipts[0].message = bad.receipts[0].message.replace("|accept", "|reject");
  const r = verifyBlock({ block, receipts: bad, parent: { blockHash: PARENT } });
  assert.equal(r.ok, false); assert.equal(r.level, "none");
  assert.equal(statusOf(r, "votes-root"), "fail"); assert.equal(statusOf(r, "hash"), "fail");
});

test("FALSIFICATION — signature d'un autre appareil, clé remplacée, reçu supprimé ou ajouté : détecté", () => {
  const votes = [v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB), v2vote("dev_CCCC0003", kC)];
  const { block, doc } = makeBlock(votes);
  const swapKey = clone(doc); swapKey.receipts[0].publicKey = kD.pub;
  assert.equal(verifyBlock({ block, receipts: swapKey }).ok, false);
  const dropped = clone(doc); dropped.receipts.pop();
  const rd = verifyBlock({ block, receipts: dropped });
  assert.equal(rd.ok, false); assert.equal(statusOf(rd, "receipts-count"), "fail");
  const extra = clone(doc); extra.receipts.push({ ...extra.receipts[0], deviceId: "dev_EEEE0005" });
  assert.equal(verifyBlock({ block, receipts: extra }).ok, false);
  // signature VALIDE en soi mais produite par une autre clé que celle déclarée : les racines concordent (le serveur a tout recalculé) mais la signature échoue
  const forged = [v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kD /* clé ≠ celle déclarée ci-dessous */, { pk: kB.pub }), v2vote("dev_CCCC0003", kC)];
  const f = makeBlock(forged);
  const rf = verifyBlock({ block: f.block, receipts: f.doc });
  assert.equal(statusOf(rf, "signatures-v2"), "fail", "un serveur qui fabrique un reçu avec une fausse clé est pris");
  assert.equal(rf.level, "none");
});

/** Un serveur MALHONNÊTE et COHÉRENT : il modifie un reçu puis recalcule racine et hash du bloc (seules les signatures et les liaisons peuvent encore le trahir). */
function consistentForgery(honest: ReturnType<typeof makeBlock>, mutate: (doc: ReceiptsDoc) => void) {
  const doc = clone(honest.doc); mutate(doc);
  const votesRoot = receiptsRoot(doc);
  const canonical: BlockCanonicalV2 = { parentHash: PARENT, imageHash: honest.block.imageHash, actionsHash: honest.block.actionsHash, contentHash: honest.block.contentHash!, deviceId: honest.block.deviceId, poolScreen: honest.block.poolScreen,
    validatorProfileIds: validatorKeysOf(doc), scorePpm: honest.block.scorePpm!, minedAt: honest.block.minedAt, votesRoot, committeeMode: "quorum", committeeK: honest.block.committeeK! };
  return { block: { ...honest.block, votesRoot, blockHash: blockHashV2(canonical), receiptsCount: doc.receipts.length, validatorIds: doc.receipts.filter((r) => r.verdict === "accept").map((r) => r.deviceId).sort() }, doc };
}

test("FALSIFICATION COHÉRENTE — le serveur recalcule tout mais un reçu est rejoué : candidat différent, contenu différent, mauvais appareil, verdict retourné", () => {
  const honest = makeBlock([v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB), v2vote("dev_CCCC0003", kC)]);
  const OTHER = "223e4567-e89b-42d3-a456-426614174999";
  const cases: Array<[string, (d: ReceiptsDoc) => void]> = [
    ["autre candidat", (d) => { const m = d.receipts[1].message.replace(CANDIDATE_ID, OTHER); d.receipts[1].message = m; d.receipts[1].signature = sig(kB, m); }],
    ["autre contenu", (d) => { const m = d.receipts[2].message.replace(v2spec.rawHash, "0".repeat(64)); d.receipts[2].message = m; d.receipts[2].signature = sig(kC, m); }],
    ["autre appareil", (d) => { const m = d.receipts[1].message.replace("dev_BBBB0002", "dev_ZZZZ0009"); d.receipts[1].message = m; d.receipts[1].signature = sig(kB, m); }],
    ["verdict retourné", (d) => { d.receipts[1].verdict = "reject"; }],
    ["signature copiée d'un autre reçu", (d) => { d.receipts[1].signature = d.receipts[0].signature; }],
  ];
  for (const [name, mutate] of cases) {
    const f = consistentForgery(honest, mutate);
    const r = verifyBlock({ block: f.block, receipts: f.doc, parent: { blockHash: PARENT } });
    assert.equal(statusOf(r, "hash"), "ok", name + " : le hash est cohérent (le serveur a tout recalculé)");
    assert.equal(r.ok, false, name + " : mais la falsification est détectée");
    assert.equal(r.level, "none", name);
  }
});

test("FALSIFICATION — champs du bloc : hash, score, minedAt, parent, validateurs, quorum", () => {
  const { block, doc } = makeBlock([v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB), v2vote("dev_CCCC0003", kC)]);
  for (const patch of [{ scorePpm: block.scorePpm! + 1 }, { minedAt: block.minedAt + 1 }, { actionsHash: "c".repeat(64) }, { parentHash: "d".repeat(64) }, { imageHash: "e".repeat(64) }]) {
    assert.equal(verifyBlock({ block: { ...block, ...patch }, receipts: doc }).ok, false, JSON.stringify(patch));
  }
  assert.equal(statusOf(verifyBlock({ block, receipts: doc, parent: { blockHash: "f".repeat(64) } }), "chain"), "fail");
  assert.equal(statusOf(verifyBlock({ block: { ...block, validatorIds: ["dev_AAAA0001"] }, receipts: doc }), "validators"), "fail");
  // quorum : électorat annoncé 10 → ⌈5,1⌉ = 6 approbations requises, il n'y en a que 3 (mais le hash dépend de committeeK : recalculé par le serveur)
  const big = makeBlock([v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB), v2vote("dev_CCCC0003", kC)]);
  const built = buildBlockV2({ candidate: { ...candidate, poolSize: 10 } as Candidate, allVotes: [v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB), v2vote("dev_CCCC0003", kC)], parentHash: PARENT, finalScore: 0.4321, minedAt: 1_791_300_000_000 });
  const rq = verifyBlock({ block: { ...big.block, blockHash: built.blockHash, ...built.fields }, receipts: built.doc });
  assert.equal(statusOf(rq, "quorum"), "fail", "3 approbations sur un électorat de 10 : quorum NON atteint, même avec un hash cohérent");
});

test("FALSIFICATION — contenu : une autre image, ou un octet changé, est refusé au niveau « contenu »", () => {
  const { block, doc } = makeBlock([v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB)]);
  const other = Buffer.from(oled); other[10] ^= 0x01;
  const r = verifyBlock({ block, receipts: doc, content: { screen: "oled096", raw: new Uint8Array(other) } });
  assert.equal(statusOf(r, "content-hash"), "fail"); assert.equal(r.ok, false);
  // métriques signées fausses (appareil qui accepte avec des e/t/r différents mais le bon hash) : le serveur les refuse (422) ; si un bloc en portait, le vérificateur le voit
  const badMetrics = { ...v2vote("dev_CCCC0003", kC, { entropy: 0.123456 }) } as ValidationVote;
  const msg = voteMessageV2({ deviceId: "dev_CCCC0003", candidateId: CANDIDATE_ID, rawHash: v2spec.rawHash, e: 123456, t: v2spec.t, r: v2spec.r, verdict: "accept" });
  badMetrics.signature = sig(kC, msg);
  const b2 = makeBlock([v2vote("dev_AAAA0001", kA), badMetrics]);
  const r2 = verifyBlock({ block: b2.block, receipts: b2.doc, content: { screen: "oled096", raw: rawContent("oled096", payload) } });
  assert.equal(statusOf(r2, "content-metrics"), "fail");
  assert.ok(metricsFromRaw("oled096", rawContent("oled096", payload)).e !== 123456);
});

test("bloc v1 (historique) : le hash se recalcule, aucun reçu (« na »), niveau « chain » seulement ; un champ modifié l'invalide", () => {
  const v1: ProofBlock = { blockHash: "", parentHash: PARENT, imageHash: "a".repeat(64), actionsHash: "b".repeat(64), deviceId: "dev_AUTHOR01", poolScreen: "oled096", validatorIds: ["dev_BBBB0002", "dev_AAAA0001"], score: 0.37254901960784315, minedAt: 1_790_000_000_000 };
  v1.blockHash = blockHashV1(v1);
  const r = verifyBlock({ block: v1, receipts: null, parent: { blockHash: PARENT } });
  assert.equal(r.ok, true); assert.equal(r.level, "chain"); assert.equal(r.blockVersion, 1);
  assert.equal(statusOf(r, "receipts"), "na");
  assert.equal(verifyBlock({ block: { ...v1, score: 0.38 }, receipts: null }).ok, false);
  assert.equal(verifyBlock({ block: { ...v1, animRoot: "z".repeat(64) }, receipts: null }).ok, false);
});

test("le hash v1 du vérificateur == celui de finalizeBlock (même canonique) ; sans BLOCK_RECEIPTS, finalizeBlock n'écrit AUCUN reçu et garde le hash v1", () => {
  const src = read("lib/chain.ts");
  assert.match(src, /validatorIds: votes\.map\(\(v\) => v\.deviceId\)\.sort\(\),\s+score:\s+finalScore,\s+minedAt,/);
  assert.match(src, /const v2 = blockReceiptsEnabled\(\) && allVotes && allVotes\.length > 0 \? buildBlockV2/);
  assert.match(src, /if \(v2\) writes\.push\(redis\.set\(receiptsKey\(blockHash\)/);
  assert.equal(blockReceiptsEnabled({} as unknown as NodeJS.ProcessEnv), false);
  assert.equal(blockReceiptsEnabled({ BLOCK_RECEIPTS: "true" } as unknown as NodeJS.ProcessEnv), true);
  assert.equal(blockReceiptsEnabled({ BLOCK_RECEIPTS: "1" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(typeof finalizeBlock, "function");
});

test("messages de reçu : un vote v2 se reconstruit à l'identique de ce que signe le firmware ; un vote hérité = « appareil:candidat:score » à 3 décimales", () => {
  const v = v2vote("dev_AAAA0001", kA);
  assert.equal(receiptMessage(v, candidate), voteMessageV2({ deviceId: "dev_AAAA0001", candidateId: CANDIDATE_ID, rawHash: v2spec.rawHash, e: v2spec.e, t: v2spec.t, r: v2spec.r, verdict: "accept" }));
  assert.equal(receiptMessage(v1vote("dev_BBBB0002", null, 0.5), candidate), `dev_BBBB0002:${CANDIDATE_ID}:0.500`);
  // aller-retour flottant : e/PPM·PPM redonne l'entier exact pour toutes les valeurs ppm du protocole
  for (const e of [0, 1, 7, 523_000, 523_001, 999_999, 1_000_000]) assert.equal(Math.round((e / PPM) * PPM), e);
});

test("reçus : documents stockables (≤ 4 Ko pour 7 votes), ordre canonique indépendant de l'ordre d'arrivée", () => {
  const votes = [v2vote("dev_CCCC0003", kC), v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB)];
  const a = buildBlockV2({ candidate, allVotes: votes, parentHash: PARENT, finalScore: 0.5, minedAt: 1 });
  const b = buildBlockV2({ candidate, allVotes: [...votes].reverse(), parentHash: PARENT, finalScore: 0.5, minedAt: 1 });
  assert.equal(a.blockHash, b.blockHash); assert.deepEqual(a.doc, b.doc);
  const seven = buildBlockV2({ candidate, allVotes: Array.from({ length: 7 }, (_, i) => v2vote(`dev_${String(i).padStart(4, "0")}${String(i).padStart(4, "0")}`, keypair(i + 10))), parentHash: PARENT, finalScore: 0.5, minedAt: 1 });
  assert.ok(JSON.stringify(seven.doc).length < 4500, String(JSON.stringify(seven.doc).length));
  const doc: ReceiptsDoc = a.doc;
  assert.equal(doc.receipts.length, 3);
});

test("câblage : la route publique des preuves n'expose que des champs immuables, en cache CDN, sans polling ; le vérificateur ne touche ni Redis ni le réseau", () => {
  const route = read("app/api/block-proof/route.ts");
  assert.match(route, /immutable/); assert.doesNotMatch(route, /setInterval|\.scan\(|redis\.keys/);
  assert.doesNotMatch(route, /ownerDeviceId|minerDeviceId|revalidated|obsConfirmed/, "aucun champ modifiable (propriété, observation) dans une réponse immuable");
  const lib = read("lib/podVerify.ts").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(lib, /redis|fetch\(|Math\.random|Date\.now/);
});

test("CLI scripts/verify-block.ts (hors ligne) : code 0 et niveau « contenu » pour un bloc honnête ; code 1 pour un reçu falsifié ; code 2 sans arguments", async () => {
  const { spawnSync } = await import("node:child_process");
  const os = await import("node:os");
  const { block, doc } = makeBlock([v2vote("dev_AAAA0001", kA), v2vote("dev_BBBB0002", kB), v2vote("dev_CCCC0003", kC)]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-block-"));
  const write = (name: string, obj: unknown) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", path.join(root, "scripts", "verify-block.ts"), ...args], { encoding: "utf8", cwd: root });

  const good = run("--file", write("good.json", { block, receipts: doc, parent: { blockHash: PARENT }, content: { screen: "oled096", rawHex: oled.toString("hex") } }));
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /NIVEAU ATTEINT : Contenu recalculé/);
  assert.match(good.stdout, /Ce vérificateur ne prouve PAS l'identité des appareils/);

  const forged = clone(doc); forged.receipts[0].message = forged.receipts[0].message.replace("|accept", "|reject");
  const bad = run("--file", write("bad.json", { block, receipts: forged, parent: { blockHash: PARENT } }));
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /✘/); assert.match(bad.stdout, /NIVEAU ATTEINT : Rien de vérifié/);

  assert.equal(run().status, 2);
});
