import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, createHash, sign } from "node:crypto";
import { analyzeClip, animVoteMessage, type AnimVote } from "../lib/animV3";
import { buildAnimSubmissionFromClip } from "../lib/anim/block";
import { receiptsRoot, validatorKeysOf, type Receipt, type ReceiptsDoc } from "../lib/blockReceipts";
import { animValidatorDevices, animValidatorKeys } from "../lib/podVerifyAnim";
import type { Block } from "../lib/chain";
import { blockHashV2, committeeRoot, minerRoot, quorumCommitteeRoot, type BlockCanonicalV2 } from "../lib/podProtocolV3";
import { blockHashV1, levelLabel, toProofBlock, verifyBlock, type ProofBlock } from "../lib/podVerify";
import { blankFrame, enc } from "./helpers/animV3Vectors";

// Lot 6B-2 — vérificateur d'un bloc ANIMATION v3 (rulesVersion 2) : vraies signatures Ed25519 (clés de TEST), vrais messages `pod-vote-v3-anim`, vrai clip PBC1 ; puis FALSIFICATIONS.
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
function keypair(seedByte: number) {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.alloc(32, seedByte)]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(priv).export({ format: "der", type: "spki" }) as Buffer;
  return { priv, pub: spki.subarray(spki.length - 32).toString("hex") };
}
const sig = (kp: ReturnType<typeof keypair>, msg: string) => sign(null, Buffer.from(msg, "utf8"), kp.priv).toString("hex");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const CAND = "123e4567-e89b-42d3-a456-426614174000", PARENT = sha("parent-anim"), MINED = 1_791_300_000_000;
const scene = (k: number) => { const f = blankFrame(); for (let y = 0; y < 12; y++) for (let x = 0; x < 8 + 5 * k; x++) f[(y + 2 * k) * 16 + (x >> 3)] |= 0x80 >> (x & 7); return f; };
const clip = enc([scene(0), scene(1), scene(2), scene(3)], [100, 120, 140, 160], 0xf800, 0x07e0);
const A = analyzeClip(clip);
/** ancienne racine v1 (JSON de flottants) : conservée dans imageHash par compatibilité (A3) */
const v1Root = (bin: Uint8Array) => { try { return buildAnimSubmissionFromClip(bin, "oled096").part.root; } catch { return sha("image-v1-root"); } };
const KP = [keypair(11), keypair(12), keypair(13)];
const DEVS = ["dev_AAAA0001", "dev_BBBB0002", "dev_CCCC0003"];

interface Opts {
  clipBin?: Uint8Array; K?: number; parent?: string; scoreOverride?: number; committee?: boolean; withMiner?: boolean; rulesVersion?: number; contentOverride?: string; imageHash?: string; includeEchoValidators?: boolean;
  votes?: Array<Partial<AnimVote> & { dev?: number; echo?: boolean; tamper?: (m: string) => string; v?: 1 | 2 | 3 }>;
}
function build(o: Opts = {}) {
  const a = analyzeClip(o.clipBin ?? clip);
  const content = o.contentOverride ?? a.animRoot;
  const votes = o.votes ?? [{ dev: 0 }, { dev: 1 }, { dev: 2 }];
  const receipts: Receipt[] = votes.map((x, i) => {
    const di = x.dev ?? i, deviceId = DEVS[di];
    if (x.echo) { const m = `${deviceId}:${CAND}:0.500`; return { v: x.v ?? 1, deviceId, publicKey: KP[di].pub, verdict: "accept", message: m, signature: sig(KP[di], m) } as Receipt; }
    const v: AnimVote = {
      deviceId, candidateId: CAND, parentHash: o.parent ?? PARENT, metricsVersion: 2, rulesVersion: 2, clipHash: a.clipHash, animRoot: content, saltedHash: sha(`salt${di}`),
      frames: a.N, E: a.E, T: a.T, R: a.R, S: a.S, verdict: "accept", ruleCode: "ok", vclass: "C0", ...x,
    };
    delete (v as Partial<typeof x>).dev; delete (v as Partial<typeof x>).tamper; delete (v as Partial<typeof x>).echo; delete (v as Partial<typeof x>).v;
    const msg = animVoteMessage(v);
    return { v: x.v ?? 3, deviceId, publicKey: KP[di].pub, verdict: v.verdict, message: msg, signature: sig(KP[di], x.tamper ? x.tamper(msg) : msg) } as Receipt;
  });
  const doc: ReceiptsDoc = { v: 1, candidateId: CAND, poolSize: o.K ?? 3, receipts };
  const K = o.K ?? 3;
  const canonical: BlockCanonicalV2 = {
    parentHash: PARENT, imageHash: o.imageHash ?? v1Root(o.clipBin ?? clip), actionsHash: sha("actions"), contentHash: content, deviceId: "dev_AUTHOR01", poolScreen: "oled096", validatorProfileIds: o.includeEchoValidators ? validatorKeysOf(doc) : animValidatorKeys(doc),
    scorePpm: o.scoreOverride ?? a.S, minedAt: MINED, animRoot: content, votesRoot: receiptsRoot(doc),
    committeeMode: o.committee ? "committee" : "quorum", committeeK: K,
    committeeRoot: o.committee ? committeeRoot({ mode: "committee", K, threshold: 2, wave: 1, ranked: ["art_a", "art_b"] }) : quorumCommitteeRoot(K),
    minerRoot: minerRoot(o.withMiner ? { profileId: DEVS[0], accepted: [{ profileId: DEVS[0], minedBlocks: 0 }] } : null), rulesVersion: o.rulesVersion ?? 2,
  };
  const block: ProofBlock = {
    blockHash: blockHashV2(canonical), parentHash: PARENT, imageHash: canonical.imageHash, actionsHash: canonical.actionsHash, deviceId: "dev_AUTHOR01", poolScreen: "oled096",
    validatorIds: o.includeEchoValidators ? [...new Set(receipts.filter((r) => r.verdict === "accept").map((r) => r.deviceId))].sort() : animValidatorDevices(doc), score: canonical.scorePpm / 1e6, minedAt: MINED,
    blockVersion: 2, contentHash: content, scorePpm: canonical.scorePpm, votesRoot: canonical.votesRoot, committeeMode: canonical.committeeMode as "quorum", committeeK: K, receiptsCount: receipts.length,
    committeeRoot: canonical.committeeRoot, minerRoot: canonical.minerRoot, rulesVersion: o.rulesVersion ?? 2, ...(o.withMiner ? { miner: { profileId: DEVS[0], accepted: [{ profileId: DEVS[0], minedBlocks: 0 }] } } : {}),
  };
  return { block, doc, a };
}
const st = (r: ReturnType<typeof verifyBlock>, id: string) => r.checks.find((c) => c.id === id)?.status;
const failing = (r: ReturnType<typeof verifyBlock>) => r.checks.filter((c) => c.status === "fail").map((c) => c.id);

test("bloc animation v3 HONNÊTE (3 votes pod-vote-v3-anim signés) : tout passe ; sans le clip niveau « reçus » ; avec le clip niveau « contenu » ; la POSITION (parentHash) est vérifiée", () => {
  const { block, doc, a } = build();
  assert.equal(a.formatOk, true);
  const r = verifyBlock({ block, receipts: doc, parent: { blockHash: PARENT } });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.status === "fail")));
  assert.equal(r.level, "receipts"); assert.equal(r.chainLinked, true);
  for (const id of ["hash", "chain", "receipts-count", "votes-root", "binding", "signatures-v3-anim", "anim-receipts-class", "position", "committee-commit", "miner-commit", "quorum", "validators", "anim-rules"]) assert.equal(st(r, id), "ok", id);
  assert.equal(st(r, "identity"), "na"); assert.equal(st(r, "anim-clip"), "na");
  assert.deepEqual([r.stats.v2Accepts, r.stats.v1Echoes, r.stats.rejects, r.stats.invalidSignatures], [3, 0, 0, 0]);
  const full = verifyBlock({ block, receipts: doc, parent: { blockHash: PARENT }, clip: clip, posterIndex: a.posterIndex });
  assert.equal(full.ok, true, JSON.stringify(full.checks.filter((c) => c.status === "fail")));
  assert.equal(full.level, "content");
  for (const id of ["anim-clip", "anim-frames", "anim-root", "anim-metrics", "anim-rule", "anim-poster"]) assert.equal(st(full, id), "ok", id);
  assert.match(levelLabel(full), /Contenu recalculé/);
  assert.equal(st(verifyBlock({ block, receipts: doc, clip, posterIndex: (a.posterIndex + 1) % a.N }), "anim-poster"), "fail", "mauvais indice d'affiche");
  assert.equal(verifyBlock({ block, receipts: doc }).chainLinked, false);
});

test("jeu de règles ENGAGÉ : un bloc sans rulesVersion est lu comme une image fixe (échec) ; une valeur inconnue est un échec explicite ; le hash change avec le jeu de règles", () => {
  const { block, doc } = build();
  const asStill = verifyBlock({ block: { ...block, rulesVersion: undefined }, receipts: doc });
  assert.equal(asStill.ok, false, "interprété comme rulesVersion 1 : le hash recalculé ne correspond plus");
  const unknown = verifyBlock({ block: { ...block, rulesVersion: 3 }, receipts: doc });
  assert.equal(unknown.ok, false); assert.equal(unknown.level, "none"); assert.equal(st(unknown, "rules"), "fail");
  assert.equal(verifyBlock({ block: { ...block, rulesVersion: 0 }, receipts: doc }).ok, false);
  const forged = build({ rulesVersion: 1 });
  assert.equal(verifyBlock({ block: { ...forged.block, rulesVersion: 2 }, receipts: forged.doc }).ok, false, "hash construit avec rulesVersion 1 mais annoncé 2");
});

test("FALSIFICATIONS : reçu modifié, signature invalide, racine d'animation signée ≠ bloc, autre parentHash signé, métriques signées fausses, score du bloc faux, clip différent, clip statique", () => {
  const h = build();
  // 1. message modifié sans re-signer
  const t = build({ votes: [{ dev: 0 }, { dev: 1, tamper: (m) => m.replace("|C0", "|C1") }, { dev: 2 }] });
  const rt = verifyBlock({ block: t.block, receipts: t.doc }); assert.equal(st(rt, "signatures-v3-anim"), "fail"); assert.equal(rt.stats.invalidSignatures, 1); assert.equal(rt.ok, false);
  // 2. racine d'animation signée ≠ celle du bloc (reçu cohérent mais pour une autre animation)
  const other = build({ votes: [{ dev: 0 }, { dev: 1, animRoot: sha("autre-animation") }, { dev: 2 }] });
  assert.equal(st(verifyBlock({ block: other.block, receipts: other.doc }), "binding"), "fail");
  // 3. position : un vote signé pour un AUTRE parentHash (rejeu d'un vote d'une autre position de la chaîne)
  const pos = build({ votes: [{ dev: 0 }, { dev: 1, parentHash: sha("autre-parent") }, { dev: 2 }] });
  const rp = verifyBlock({ block: pos.block, receipts: pos.doc }); assert.equal(st(rp, "position"), "fail"); assert.equal(rp.ok, false);
  // 4. métriques signées fausses (signature honnête sur de fausses valeurs) : détectées dès que le clip est fourni
  const badE = build({ votes: [{ dev: 0 }, { dev: 1, E: (h.a.E + 1) % 1_000_001 }, { dev: 2 }] });
  assert.equal(verifyBlock({ block: badE.block, receipts: badE.doc }).ok, true, "sans le clip, rien ne contredit les signatures");
  const rE = verifyBlock({ block: badE.block, receipts: badE.doc, clip }); assert.equal(st(rE, "anim-metrics"), "fail"); assert.notEqual(rE.level, "content");
  const badS = build({ votes: [{ dev: 0 }, { dev: 1, S: (h.a.S + 1) % 1_000_001 }, { dev: 2 }] });
  assert.equal(st(verifyBlock({ block: badS.block, receipts: badS.doc, clip }), "anim-metrics"), "fail", "S est signé : une moyenne fausse est détectée");
  const badN = build({ votes: [{ dev: 0 }, { dev: 1, frames: h.a.N + 1 }, { dev: 2 }] });
  assert.equal(st(verifyBlock({ block: badN.block, receipts: badN.doc, clip }), "anim-metrics"), "fail");
  // 5. score du bloc ≠ S recalculé
  const sc = build({ scoreOverride: h.a.S + 1 }); assert.equal(st(verifyBlock({ block: sc.block, receipts: sc.doc, clip }), "anim-metrics"), "fail");
  // 6. un autre clip : la racine recalculée diffère
  const diff = enc([scene(0), scene(1), scene(2), scene(4)], [100, 120, 140, 160], 0xf800, 0x07e0);
  const rc = verifyBlock({ block: h.block, receipts: h.doc, clip: diff }); assert.equal(st(rc, "anim-root"), "fail"); assert.notEqual(rc.level, "content");
  assert.equal(st(verifyBlock({ block: h.block, receipts: h.doc, clip: clip.slice(0, 200) }), "anim-clip"), "fail");
  // 7. clip STATIQUE présenté comme accepté (reçus « ok » honnêtement signés sur les valeurs recalculées) : la règle A1 calculée refuse
  const stat = enc([scene(1), scene(1), scene(1)], [100, 100, 100], 0xf800, 0x07e0), sb = build({ clipBin: stat });
  assert.equal(analyzeClip(stat).ruleCode, "static");
  const rs = verifyBlock({ block: sb.block, receipts: sb.doc, clip: stat }); assert.equal(st(rs, "anim-rule"), "fail"); assert.equal(rs.ok, false);
  // 8. reçus supprimés / racine
  const few = build(); few.doc.receipts.splice(2);
  assert.equal(verifyBlock({ block: few.block, receipts: few.doc }).ok, false);
});

test("AUCUN vote hérité ne valide une animation v3 : les échos v1 (et les reçus d'une autre classe) sont EXCLUS du quorum ; un bloc dont le quorum n'est atteint qu'avec eux est REFUSÉ", () => {
  // K = 3 ⇒ quorum 2 : 1 vote d'animation + 2 échos du score serveur
  const mix = build({ votes: [{ dev: 0 }, { dev: 1, echo: true }, { dev: 2, echo: true }] });
  const r = verifyBlock({ block: mix.block, receipts: mix.doc });
  assert.equal(st(r, "anim-receipts-class"), "warn"); assert.equal(st(r, "quorum"), "fail"); assert.equal(r.ok, false); assert.equal(r.stats.v1Echoes, 2);
  // trois échos seulement
  const echoes = build({ votes: [{ dev: 0, echo: true }, { dev: 1, echo: true }, { dev: 2, echo: true }] });
  const re = verifyBlock({ block: echoes.block, receipts: echoes.doc }); assert.equal(re.ok, false); assert.equal(st(re, "quorum"), "fail"); assert.ok(failing(re).includes("signatures-v3-anim"));
  assert.notEqual(re.level, "receipts"); assert.notEqual(re.level, "content");
  // un vote v2 d'image déguisé : la version déclarée 2 pour un message d'animation est refusée
  const disguised = build({ votes: [{ dev: 0 }, { dev: 1, v: 2 }, { dev: 2 }] });
  assert.equal(st(verifyBlock({ block: disguised.block, receipts: disguised.doc }), "binding"), "fail");
  // 2 votes d'animation + 1 écho (K = 3, quorum 2) : le quorum est atteint SANS l'écho (qui reste signalé)
  const ok2 = build({ votes: [{ dev: 0 }, { dev: 1 }, { dev: 2, echo: true }] });
  const r2 = verifyBlock({ block: ok2.block, receipts: ok2.doc, clip });
  assert.equal(r2.ok, true, JSON.stringify(r2.checks.filter((c) => c.status === "fail"))); assert.equal(st(r2, "anim-receipts-class"), "warn"); assert.equal(st(r2, "quorum"), "ok");
  // des votes d'un profil qui se contredisent : le profil s'abstient
  const contradict = build({ votes: [{ dev: 0 }, { dev: 0, verdict: "reject", ruleCode: "static", E: 0, T: 0, R: 0, S: 0 }, { dev: 1 }] , K: 3 });
  assert.equal(st(verifyBlock({ block: contradict.block, receipts: contradict.doc }), "quorum"), "fail", "1 seul profil non contradictoire < 2");
});

test("AUCUN comité ni tirage de mineur déterministe pour une animation (grinding non traité) : mode « committee » ou minerRoot ≠ « aucun » = échec", () => {
  const c = build({ committee: true });
  assert.equal(st(verifyBlock({ block: { ...c.block, committeeMode: "committee" }, receipts: c.doc }), "committee-commit"), "fail");
  const m = build({ withMiner: true });
  assert.equal(st(verifyBlock({ block: m.block, receipts: m.doc }), "miner-commit"), "fail");
  const h = build();
  assert.equal(st(verifyBlock({ block: { ...h.block, committeeRoot: "0".repeat(64) }, receipts: h.doc }), "hash"), "fail", "committeeRoot est dans le hash");
  assert.equal(st(verifyBlock({ block: { ...h.block, committeeK: 4 }, receipts: h.doc }), "hash"), "fail");
});

test("6B2-FIX1 (1) — les échos restent dans votesRoot (audit) mais ne sont JAMAIS validateurs d'une animation : 2 votes animation + 1 écho ⇒ bloc recevable, avertissement, écho absent de validatorIds ET de validatorProfileIds", () => {
  const b = build({ votes: [{ dev: 0 }, { dev: 1 }, { dev: 2, echo: true }] });
  assert.deepEqual(b.block.validatorIds, [DEVS[0], DEVS[1]], "l'écho n'est pas un validateur");
  assert.equal(b.block.receiptsCount, 3, "mais le reçu de l'écho reste dans le document de reçus");
  assert.ok(b.doc.receipts.some((r) => r.deviceId === DEVS[2] && r.v === 1), "écho conservé pour l'audit");
  const r = verifyBlock({ block: b.block, receipts: b.doc, parent: { blockHash: PARENT }, clip });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.status === "fail")));
  assert.equal(st(r, "anim-receipts-class"), "warn"); assert.equal(st(r, "validators"), "ok"); assert.equal(st(r, "votes-root"), "ok"); assert.equal(r.level, "content");
  assert.deepEqual(animValidatorDevices(b.doc), [DEVS[0], DEVS[1]]); assert.deepEqual(animValidatorKeys(b.doc), [DEVS[0], DEVS[1]]);
  // un producteur fautif qui présente l'écho comme validateur (hash construit AVEC lui) est REFUSÉ
  const wrong = build({ votes: [{ dev: 0 }, { dev: 1 }, { dev: 2, echo: true }], includeEchoValidators: true });
  assert.deepEqual(wrong.block.validatorIds, DEVS, "bloc fautif : trois validateurs");
  const rw = verifyBlock({ block: wrong.block, receipts: wrong.doc });
  assert.equal(rw.ok, false); assert.equal(st(rw, "validators"), "fail"); assert.equal(st(rw, "hash"), "fail", "validatorProfileIds du hash ≠ approbations d'animation");
  // l'écho retiré des validateurs annoncés mais gardé dans le hash fautif : toujours refusé
  assert.equal(verifyBlock({ block: { ...b.block, validatorIds: DEVS }, receipts: b.doc }).ok, false);
});

test("6B2-FIX1 (2) — `toProofBlock` d'un VRAI objet Block : rulesVersion 2 ⇒ animRoot = contentHash (racine v3), la racine v1 reste dans imageHash ; comportement historique v1 préservé", () => {
  const h = build({ votes: [{ dev: 0 }, { dev: 1 }, { dev: 2 }] });
  const v1 = v1Root(clip);
  assert.equal(h.block.imageHash, v1); assert.notEqual(v1, h.a.animRoot, "deux racines différentes");
  const real = {
    blockIndex: 7, blockHash: h.block.blockHash, parentHash: PARENT, imageHash: v1, actionsHash: h.block.actionsHash, drawScore: 3, deviceId: h.block.deviceId, minerDeviceId: DEVS[0], ownerDeviceId: DEVS[0],
    artistName: "x", poolScreen: "oled096", validatorIds: h.block.validatorIds, score: h.block.score, displayTime: 60, minedAt: MINED, frameId: "f", revalidated: [], obsConfirmed: false, kind: "animation",
    anim: { frames: h.a.N, loops: 0, playMs: 1, bytes: clip.length, root: v1 },   // `anim.root` = racine v1 historique
    blockVersion: 2, contentHash: h.a.animRoot, scorePpm: h.block.scorePpm, votesRoot: h.block.votesRoot, committeeMode: "quorum", committeeK: 3, committeeRoot: h.block.committeeRoot, minerRoot: h.block.minerRoot, receiptsCount: 3, rulesVersion: 2,
  } as unknown as Block;
  const proof = toProofBlock(real);
  assert.equal(proof.animRoot, h.a.animRoot, "animRoot du hash = contentHash (et NON anim.root v1)"); assert.equal(proof.rulesVersion, 2); assert.equal(proof.imageHash, v1);
  const r = verifyBlock({ block: proof, receipts: h.doc, parent: { blockHash: PARENT }, clip });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.status === "fail"))); assert.equal(r.level, "content");
  // v1 historique : un bloc d'animation SANS rulesVersion garde animRoot = anim.root et son hash v1
  const legacy = { blockHash: "", parentHash: PARENT, imageHash: v1, actionsHash: sha("a"), deviceId: "dev_AUTHOR01", poolScreen: "oled096", validatorIds: ["dev_X0000001"], score: 0.37254901960784315, minedAt: MINED, anim: { frames: 4, loops: 0, playMs: 1, bytes: 1, root: v1 } } as unknown as Block;
  const lp = toProofBlock(legacy); assert.equal(lp.animRoot, v1, "bloc v1 : racine v1 inchangée");
  lp.blockHash = blockHashV1(lp);
  assert.equal(verifyBlock({ block: lp, receipts: null }).ok, true, "le hash v1 d'un bloc d'animation existant se vérifie toujours");
  // v2 « image fixe » avec une animation v1 (rulesVersion absent) : racine v1
  assert.equal(toProofBlock({ ...legacy, blockVersion: 2, contentHash: sha("c") } as unknown as Block).animRoot, v1);
  // rulesVersion 2 sans contentHash : pas de racine inventée
  assert.equal(toProofBlock({ ...real, contentHash: undefined } as unknown as Block).animRoot, undefined);
});

test("6B2-FIX1 (3) — avec le clip, imageHash est comparé à la racine v1 RECALCULÉE (conformément à la spec A3) ; sans clip : non vérifiable, jamais « ok » implicite", () => {
  const h = build();
  const withClip = verifyBlock({ block: h.block, receipts: h.doc, clip });
  assert.equal(st(withClip, "anim-image-hash"), "ok"); assert.equal(withClip.level, "content");
  assert.equal(verifyBlock({ block: h.block, receipts: h.doc }).checks.find((c) => c.id === "anim-image-hash"), undefined, "sans clip : aucun contrôle annoncé");
  const bad = build({ imageHash: sha("racine-v1-inventée") });
  assert.equal(verifyBlock({ block: bad.block, receipts: bad.doc }).ok, true, "sans clip rien ne contredit imageHash");
  const rb = verifyBlock({ block: bad.block, receipts: bad.doc, clip });
  assert.equal(st(rb, "anim-image-hash"), "fail"); assert.equal(rb.ok, false); assert.notEqual(rb.level, "content");
  // l'image d'une AUTRE animation
  const other = enc([scene(0), scene(1), scene(2), scene(4)], [100, 120, 140, 160], 0xf800, 0x07e0);
  const wrongImg = build({ imageHash: v1Root(other) });
  assert.equal(st(verifyBlock({ block: wrongImg.block, receipts: wrongImg.doc, clip }), "anim-image-hash"), "fail");
});

test("les blocs d'IMAGES FIXES ne sont pas affectés : un bloc sans rulesVersion passe toujours par le vérificateur historique (aucune régression)", () => {
  const src = (p: string) => require("node:fs").readFileSync(require("node:path").join(__dirname, "..", p), "utf8") as string;
  const v = src("lib/podVerify.ts");
  assert.match(v, /if \(input\.block\.rulesVersion === 2\) return verifyAnimBlock\(input\);/);
  assert.ok(v.indexOf("verifyAnimBlock(input)") < v.indexOf("const { block, receipts } = input;"), "aiguillage AVANT tout calcul du chemin historique");
  assert.equal(levelLabel({ level: "none", chainLinked: false }).length > 0, true);
});
