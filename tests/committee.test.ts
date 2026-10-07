import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  committeeEnforceBlockedByGuard, committeeGate, committeeModeFromEnv, committeeModeRequested, committeeOutcome, currentWave, planCandidateCommittee, rejectIsObjective, toCommittee, waveDelayMsFromEnv, type CandidateCommittee,
} from "../lib/committee";
import type { PoolPlan } from "../lib/eligibility";
import { REP_KEY, REPUTATION_SCRIPT, applyReputation, reputationArgs, reputationEntries, reputationOf, type RepEntry } from "../lib/reputation";
import { buildBlockV2, prepareBlockV2, sealBlockV2 } from "../lib/blockReceipts";
import { verifyBlock, type ProofBlock } from "../lib/podVerify";
import { buildCandidateV2, voteMessageV2 } from "../lib/podVote";
import { METRIC_GRID, PPM } from "../lib/podMetrics";
import { committeeWindow, drawMiner, minerDeviceFor, selectCommittee } from "../lib/podProtocolV3";
import type { Candidate, ValidationVote, VoteMap } from "../lib/chain";

// Lot 4 — comité, mineur déterministe, réputation. Vraies signatures Ed25519 pour le vérificateur ; scénarios hostiles pour la décision.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const PARENT = sha("parent-lot4");
const CANDIDATE_ID = "123e4567-e89b-42d3-a456-426614174000";

// contenu OLED non uniforme, spécification v2 du candidat
const oled = (() => { const b = Buffer.alloc(METRIC_GRID.oled096.rawBytes); for (let i = 0; i < b.length; i += 3) b[i] = 0xa5 ^ (i & 0xff); return b; })();
const v2spec = buildCandidateV2("oled096", { buffer: oled.toString("base64") })!;

const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const keypair = (n: number) => { const priv = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.alloc(32, n)]), format: "der", type: "pkcs8" }); const spki = createPublicKey(priv).export({ format: "der", type: "spki" }) as Buffer; return { priv, pub: spki.subarray(spki.length - 32).toString("hex") }; };
const PROFILES = ["art_p1", "art_p2", "art_p3", "art_p4", "art_p5", "art_p6", "art_p7", "art_p8", "art_p9"];
const KEYS = Object.fromEntries(PROFILES.map((p, i) => [p, keypair(i + 1)]));
const deviceOf = (p: string) => `dev_${p.slice(-1).padStart(4, "0")}${p.slice(-1).padStart(4, "0")}`;

function plan(profiles: string[], kind: PoolPlan["kind"] = "independent"): PoolPlan { return { kind, profiles, independentProfiles: profiles.length, poolSize: profiles.length, authorProfiles: [] }; }
const committeeFor = (profiles: string[], kind: PoolPlan["kind"] = "independent", state: "shadow" | "enforce" = "enforce") =>
  planCandidateCommittee({ state, plan: plan(profiles, kind), parentHash: PARENT, contentHash: v2spec.rawHash, waveDelayMs: 600_000 })!;

function v2vote(profile: string, verdict: "accept" | "reject" = "accept", over: Partial<ValidationVote> = {}): ValidationVote {
  const e = verdict === "reject" ? 0 : v2spec.e, t = verdict === "reject" ? 0 : v2spec.t, r = verdict === "reject" ? 0 : v2spec.r;
  const msg = voteMessageV2({ deviceId: deviceOf(profile), candidateId: CANDIDATE_ID, rawHash: v2spec.rawHash, e, t, r, verdict });
  return { deviceId: deviceOf(profile), profileId: profile, entropy: e / PPM, transitions: t / PPM, rle: r / PPM, score: v2spec.s / PPM, signature: sign(null, Buffer.from(msg), KEYS[profile].priv).toString("hex"), votedAt: 1, v: 2, verdict, pk: KEYS[profile].pub, rawHash: v2spec.rawHash, ...(verdict === "reject" ? { reason: "blank" } : {}), ...over } as ValidationVote;
}
const mapOf = (...votes: ValidationVote[]): VoteMap => ({ candidateId: CANDIDATE_ID, votes: Object.fromEntries(votes.map((v) => [v.deviceId, v])) });

test("modes et délai : COMMITTEE_MODE absent/invalide = off ; vague 2 : 10 min par défaut, réglable", () => {
  assert.equal(committeeModeFromEnv(env({})), "off");
  for (const v of ["", "on", "true", "strict"]) assert.equal(committeeModeFromEnv(env({ COMMITTEE_MODE: v })), "off", v);
  assert.equal(committeeModeFromEnv(env({ COMMITTEE_MODE: "Shadow" })), "shadow");
  // GARDE contre le grinding (audit GPT) : « enforce » n'est effectif qu'avec l'accusé explicite COMMITTEE_GRINDING_ACK=true
  assert.equal(committeeModeRequested(env({ COMMITTEE_MODE: "enforce" })), "enforce");
  assert.equal(committeeModeFromEnv(env({ COMMITTEE_MODE: "enforce" })), "shadow", "sans accusé : ramené à « shadow »");
  assert.equal(committeeEnforceBlockedByGuard(env({ COMMITTEE_MODE: "enforce" })), true);
  for (const ack of ["", "1", "yes", "TRUE", "false"]) assert.equal(committeeModeFromEnv(env({ COMMITTEE_MODE: "enforce", COMMITTEE_GRINDING_ACK: ack })), "shadow", `accusé « ${ack} » invalide`);
  assert.equal(committeeModeFromEnv(env({ COMMITTEE_MODE: "enforce", COMMITTEE_GRINDING_ACK: "true" })), "enforce");
  assert.equal(committeeEnforceBlockedByGuard(env({ COMMITTEE_MODE: "enforce", COMMITTEE_GRINDING_ACK: "true" })), false);
  assert.equal(committeeEnforceBlockedByGuard(env({ COMMITTEE_MODE: "shadow" })), false);
  assert.equal(committeeModeFromEnv(env({ COMMITTEE_GRINDING_ACK: "true" })), "off", "l'accusé seul n'active rien");
  assert.equal(waveDelayMsFromEnv(env({})), 600_000);
  assert.equal(waveDelayMsFromEnv(env({ COMMITTEE_WAVE2_MINUTES: "3" })), 180_000);
  for (const v of ["0", "-5", "abc", ""]) assert.equal(waveDelayMsFromEnv(env({ COMMITTEE_WAVE2_MINUTES: v })), 600_000, v);
  const c = committeeFor(PROFILES);
  assert.equal(currentWave(c, 1000, 1000 + 599_999), 1); assert.equal(currentWave(c, 1000, 1000 + 600_000), 2);
});

test("plan du comité : K ≤ 7, seuil ⌈2K/3⌉, au plus 2K profils mémorisés (500 profils → 14), bootstrap forcé même avec ≥ 3 profils, aucun profil → pas de comité", () => {
  const c = committeeFor(PROFILES);   // 9 profils
  assert.deepEqual([c.mode, c.K, c.threshold, c.ranked.length], ["committee", 7, 5, 9]);
  assert.deepEqual(c.ranked, selectCommittee({ eligibleProfiles: PROFILES, authorProfileId: null, contentHash: v2spec.rawHash, parentHash: PARENT }).ranked, "identique à la référence du protocole");
  const big = committeeFor(Array.from({ length: 500 }, (_, i) => `art_${i}`));
  assert.equal(big.ranked.length, 14); assert.ok(JSON.stringify(big).length < 1200, "stockage borné dans le candidat");
  const boot = committeeFor(PROFILES.slice(0, 4), "bootstrap");
  assert.deepEqual([boot.mode, boot.K, boot.threshold], ["bootstrap", 4, 4], "bootstrap : TOUS les membres doivent approuver");
  assert.equal(planCandidateCommittee({ state: "enforce", plan: { kind: "none", profiles: [], independentProfiles: 0, poolSize: 1, authorProfiles: [] }, parentHash: PARENT, contentHash: "x", waveDelayMs: 1 }), null);
  const other = planCandidateCommittee({ state: "enforce", plan: plan(PROFILES), parentHash: sha("autre-bloc"), contentHash: v2spec.rawHash, waveDelayMs: 1 })!;
  assert.notDeepEqual(other.ranked, c.ranked, "le tirage dépend du bloc précédent");
});

test("porte du comité : non-membre 403, vague 2 non ouverte 403, vote v1 409 ; off/sans comité autorisés ; shadow ne refuse jamais", () => {
  const c = committeeFor(PROFILES);
  const members1 = committeeWindow(toCommittee(c), 1), alt = c.ranked.slice(7);
  const g = (mode: "off" | "shadow" | "enforce", profileId: string | null, wave: 1 | 2, isV2 = true, cc: CandidateCommittee | null = c) => committeeGate({ mode, committee: cc ?? undefined, profileId, wave, isV2 });
  assert.deepEqual(g("enforce", members1[0], 1), { action: "allow" });
  assert.deepEqual(g("enforce", "art_inconnu", 1), { action: "refuse", status: 403, reason: "not-in-committee" });
  assert.deepEqual(g("enforce", null, 1), { action: "refuse", status: 403, reason: "not-in-committee" });
  assert.deepEqual(g("enforce", alt[0], 1), { action: "refuse", status: 403, reason: "wave-not-open" });
  assert.deepEqual(g("enforce", alt[0], 2), { action: "allow" });
  assert.deepEqual(g("enforce", members1[0], 1, false), { action: "refuse", status: 409, reason: "v1-not-admitted" });
  assert.deepEqual(g("off", "art_inconnu", 1), { action: "allow" });
  assert.deepEqual(g("enforce", "art_inconnu", 1, true, null), { action: "allow" });
  assert.deepEqual(g("shadow", "art_inconnu", 1), { action: "shadow-refuse", reason: "not-in-committee" });
  assert.deepEqual(g("enforce", "art_inconnu", 1, true, { ...c, state: "shadow" }), { action: "shadow-refuse", reason: "not-in-committee" }, "candidat déposé en shadow : non contraignant");
});

test("refus objectif : seul « uniforme/bruit » avec les MÊMES mesures que la référence compte ; tout le reste est un « dispute »", () => {
  const uniform = { e: 0, t: 0, r: 0 }, noisy = { e: 990_000, t: 950_000, r: 900_000 }, normal = { e: v2spec.e, t: v2spec.t, r: v2spec.r };
  assert.equal(rejectIsObjective({ reason: "blank", ...uniform }, uniform), true);
  assert.equal(rejectIsObjective({ reason: "blank", ...normal }, normal), false, "image non uniforme : refus « blank » faux");
  assert.equal(rejectIsObjective({ reason: "blank", e: 1, t: 0, r: 0 }, uniform), false, "mesures différentes de la référence");
  assert.equal(rejectIsObjective({ reason: "noise", ...noisy }, noisy), true);
  assert.equal(rejectIsObjective({ reason: "noise", ...normal }, normal), false);
  for (const reason of ["hash", "metrics", "format", "rules", undefined]) assert.equal(rejectIsObjective({ reason, ...uniform }, uniform), false, String(reason));
});

test("décision du comité : accepté dès ⌈2K/3⌉ approbations ; refusé dès K−T+1 refus ; cartes contradictoires = abstention ; vote hérité, hors comité et « dispute » ne comptent pas", () => {
  const c = committeeFor(PROFILES);   // K = 7, T = 5, tolérance 2
  const win = committeeWindow(toCommittee(c), 1);
  const acc = (n: number) => win.slice(0, n).map((p) => v2vote(p));
  assert.equal(committeeOutcome(c, 1, mapOf(...acc(4))).decision.state, "pending");
  assert.equal(committeeOutcome(c, 1, mapOf(...acc(5))).decision.state, "accept");
  const rej = (from: number, n: number) => win.slice(from, from + n).map((p) => v2vote(p, "reject"));
  assert.equal(committeeOutcome(c, 1, mapOf(...acc(4), ...rej(4, 3))).decision.state, "reject");
  assert.equal(committeeOutcome(c, 1, mapOf(...acc(5), ...rej(5, 2))).decision.state, "accept");
  // votes qui ne comptent pas
  const dispute = win.slice(0, 5).map((p, i) => (i < 3 ? v2vote(p, "reject", { disputed: true }) : v2vote(p)));
  assert.equal(committeeOutcome(c, 1, mapOf(...dispute)).decision.accepts, 2, "3 refus « dispute » = abstentions : ils ne bloquent pas");
  const legacy = { ...v2vote(win[0]), v: undefined, verdict: undefined } as unknown as ValidationVote;
  assert.equal(committeeOutcome(c, 1, mapOf(legacy)).effective.length, 0, "vote hérité : ne siège pas");
  const outside = { ...v2vote("art_p9"), profileId: "art_inconnu", deviceId: "dev_ZZZZ0001" };
  assert.equal(committeeOutcome(c, 1, mapOf(outside)).effective.length, 0);
  // deux cartes d'un même profil qui se contredisent
  const twin = { ...v2vote(win[0], "reject"), deviceId: "dev_TWIN0001" };
  assert.equal(committeeOutcome(c, 1, mapOf(v2vote(win[0]), twin)).effective.length, 0, "contradiction : le profil s'abstient");
  // plusieurs cartes d'accord : UNE voix, représentant = plus petit deviceId
  const twinAgree = { ...v2vote(win[0]), deviceId: "dev_0000AAAA" };
  const o = committeeOutcome(c, 1, mapOf(v2vote(win[0]), twinAgree));
  assert.deepEqual([o.effective.length, o.votes[0].deviceId], [1, "dev_0000AAAA"]);
});

test("vague 2 : les suppléants remplacent les silencieux dans l'ordre des rangs ; l'électorat effectif ne dépasse jamais K ; les silencieux de la vague 1 sont listés", () => {
  const c = committeeFor(PROFILES);
  const w1 = committeeWindow(toCommittee(c), 1), alt = c.ranked.slice(7);
  const votes = [...w1.slice(0, 3), ...alt].map((p) => v2vote(p));   // 3 titulaires + 2 suppléants répondent ; 4 titulaires se taisent
  const w1only = committeeOutcome(c, 1, mapOf(...votes));
  assert.equal(w1only.effective.length, 3); assert.equal(w1only.decision.state, "pending");
  const w2 = committeeOutcome(c, 2, mapOf(...votes));
  assert.equal(w2.decision.state, "accept", "3 titulaires + 2 suppléants = 5 ≥ T");
  assert.ok(w2.effective.length <= c.K);
  assert.deepEqual(w2.silent, w1.slice(3), "les 4 titulaires silencieux sont les « timeout »");
});

test("HOSTILE — 3 profils malhonnêtes du comité refusent à tort : leurs refus ne comptent pas (non objectifs) ; le bon dessin est accepté", () => {
  const c = committeeFor(PROFILES);
  const win = committeeWindow(toCommittee(c), 1);
  // refus « blank » alors que l'image n'est pas uniforme, avec LES MESURES RÉELLES de l'image → motif faux ⇒ marqués disputed par le serveur
  const liar = (p: string) => v2vote(p, "reject", { entropy: v2spec.e / PPM, transitions: v2spec.t / PPM, rle: v2spec.r / PPM, disputed: rejectIsObjective({ reason: "blank", e: v2spec.e, t: v2spec.t, r: v2spec.r }, v2spec) ? undefined : true });
  const votes = [...win.slice(0, 4).map((p) => v2vote(p)), ...win.slice(4, 7).map(liar)];
  assert.ok(votes.slice(4).every((v) => v.disputed === true));
  const o = committeeOutcome(c, 1, mapOf(...votes));
  assert.equal(o.decision.state, "pending", "4 approbations sur 5 requises : en attente, JAMAIS refusé par des menteurs");
  const done = committeeOutcome(c, 2, mapOf(...votes, ...c.ranked.slice(7).map((p) => v2vote(p))));
  assert.equal(done.decision.state, "accept");
});

// ── réputation ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("réputation : événements démontrables seulement ; « dispute » neutre ; « timeout » à part ; agrégation en UNE commande ; jamais d'effet bloquant", async () => {
  const c = committeeFor(PROFILES);
  const win = committeeWindow(toCommittee(c), 1);
  const wrongMetrics = v2vote(win[1], "accept", { entropy: 0.123456 });   // accepte avec des mesures fausses (le serveur le refuserait en 422 ; ici pour tester le classement)
  const votes = [v2vote(win[0]), wrongMetrics, v2vote(win[2], "reject", { disputed: true }), v2vote(win[3])];
  const o = committeeOutcome(c, 1, mapOf(...votes));
  const entries = reputationEntries({ v2: v2spec }, o);
  const ev = (p: string) => entries.filter((e) => e.profileId === p).map((e) => e.event);
  assert.deepEqual(ev(win[0]), ["validAccept"]); assert.deepEqual(ev(win[1]), ["falseAccept"]); assert.deepEqual(ev(win[2]), ["dispute"], "refus non objectif : « dispute », neutre");
  assert.ok(entries.filter((e) => e.event === "timeout").length === 3, "les 3 titulaires silencieux (win[4..6]) ; win[2] a répondu (refus « dispute ») donc n'est pas silencieux");
  assert.ok(!entries.some((e) => e.event === "falseReject"));
  assert.deepEqual(reputationEntries({ v2: undefined }, o), [], "candidat sans v2 : aucun événement");

  const calls: Array<{ script: string; keys: string[]; args: string[] }> = [];
  const r = { async eval(script: string, keys: string[], args: string[]) { calls.push({ script, keys, args }); return args.length / 2; } };
  const n = await applyReputation(r, entries);
  assert.equal(calls.length, 1, "UNE seule commande Redis pour tous les événements");
  assert.equal(calls[0].script, REPUTATION_SCRIPT); assert.deepEqual(calls[0].keys, [REP_KEY]);
  assert.equal(n, new Set(entries.map((e) => `${e.profileId}|${e.event}`)).size);
  assert.equal(await applyReputation(r, []), 0); assert.equal(calls.length, 1, "aucun événement : aucune commande");
  const boom = await applyReputation({ async eval() { throw new Error("EVAL indisponible"); } }, entries);
  assert.equal(boom, 0, "une panne de la réputation ne doit JAMAIS empêcher de miner");
  assert.deepEqual(reputationArgs([{ profileId: "a", event: "validAccept" }, { profileId: "a", event: "validAccept" }] as RepEntry[]), ["a|validAccept", "2"]);
});

test("réputation : taux de faux seulement après un échantillon minimal ; les « dispute » et « timeout » ne comptent pas comme des faux", () => {
  const hash = { "p|validAccept": "6", "p|falseAccept": "1", "p|dispute": "30", "p|timeout": "50" };
  const small = reputationOf(hash, "p"); assert.equal(small.judged, 7); assert.equal(small.falseRate, null, "échantillon insuffisant : aucun taux affiché");
  const big = reputationOf({ ...hash, "p|validReject": "4" }, "p"); assert.equal(big.judged, 11); assert.ok(Math.abs(big.falseRate! - 1 / 11) < 1e-9);
  assert.equal(reputationOf(null, "inconnu").judged, 0);
});

// ── bloc de comité vérifiable, mineur rejouable ─────────────────────────────────────────────────────────────────────────────────────────────────
function committeeBlock(profiles = PROFILES, nVotes = 5) {
  const c = committeeFor(profiles);
  const win = committeeWindow(toCommittee(c), 1);
  const out = committeeOutcome(c, 1, mapOf(...win.slice(0, nVotes).map((p) => v2vote(p))));
  assert.equal(out.decision.state, "accept");
  const candidate = { candidateId: CANDIDATE_ID, poolSize: profiles.length, v2: v2spec, anim: undefined, imageHash: "a".repeat(64), actionsHash: "b".repeat(64), deviceId: "dev_AUTHOR01", poolScreen: "oled096", committee: c } as unknown as Candidate;
  const prep = prepareBlockV2({ candidate, allVotes: out.votes, parentHash: PARENT, finalScore: 0.4, minedAt: 1_791_300_000_000, wave: 1 });
  const accepted = out.votes.map((v) => ({ profileId: v.profileId!, minedBlocks: v.profileId!.length % 3 }));
  const winner = drawMiner({ parentHash: PARENT, contentHash: v2spec.rawHash, votesRoot: prep.votesRoot, accepted })!;
  const built = sealBlockV2(prep, { profileId: winner, accepted });   // le hash ENGAGE le comité (rangs, seuil, vague) ET le tirage du mineur (résultat + entrées)
  const block: ProofBlock = {
    blockHash: built.blockHash, parentHash: PARENT, imageHash: candidate.imageHash, actionsHash: candidate.actionsHash, deviceId: candidate.deviceId, poolScreen: "oled096",
    validatorIds: out.votes.map((v) => v.deviceId).sort(), score: 0.4, minedAt: 1_791_300_000_000, ...built.fields, miner: { profileId: winner, accepted },
    minerDeviceId: minerDeviceFor(winner, out.votes)!,   // même règle que finalizeBlock : appareil désigné par les reçus du profil tiré
  };
  return { block, doc: built.doc, c, out };
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const status = (r: ReturnType<typeof verifyBlock>, id: string) => r.checks.find((c) => c.id === id)?.status;

test("bloc « comité » honnête : hash, reçus dans l'ORDRE DES RANGS, comité rejoué, décision rejouée, mineur rejoué — niveau « reçus » ; le mode et K sont dans le hash", () => {
  const { block, doc, c } = committeeBlock();
  assert.equal(block.committeeMode, "committee"); assert.equal(block.committeeK, 7);
  assert.deepEqual(doc.receipts.map((r) => r.profileId), c.ranked.filter((p) => doc.receipts.some((r) => r.profileId === p)), "reçus triés par rang");
  const r = verifyBlock({ block, receipts: doc, parent: { blockHash: PARENT } });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((x) => x.status === "fail")));
  for (const id of ["hash", "committee-commit", "miner-commit", "committee-ranks", "committee-members", "committee-decision", "miner", "signatures-v2"]) assert.equal(status(r, id), "ok", id);
  assert.match(block.committeeRoot!, /^[0-9a-f]{64}$/); assert.match(block.minerRoot!, /^[0-9a-f]{64}$/);
  assert.equal(doc.committee!.wave, 1);
  assert.equal(r.checks.find((x) => x.id === "quorum"), undefined, "pas de quorum historique en mode comité");
  assert.equal(r.level, "receipts");
  assert.notEqual(buildBlockV2({ candidate: { candidateId: CANDIDATE_ID, poolSize: 9, v2: v2spec, imageHash: "a".repeat(64), actionsHash: "b".repeat(64), deviceId: "dev_AUTHOR01", poolScreen: "oled096" } as unknown as Candidate, allVotes: [], parentHash: PARENT, finalScore: 0.4, minedAt: 1_791_300_000_000 }).blockHash, block.blockHash);
});

test("FALSIFICATION du comité : le comité et le mineur sont ENGAGÉS dans le hash — liste remplacée, vague changée, K ou seuil changés, mineur truqué, entrées du tirage truquées", () => {
  const { block, doc } = committeeBlock();
  // le serveur remplace la liste du comité par une autre liste COHÉRENTE (autres profils, même ordre de rangs recalculé) sans toucher au bloc : audit GPT, bloquant 1
  const swapped = clone(doc); swapped.committee!.ranked = [...swapped.committee!.ranked.slice(0, 6), "art_complice1", "art_complice2"];
  const rs = verifyBlock({ block, receipts: swapped });
  assert.equal(status(rs, "committee-commit"), "fail", "le hash du bloc contient committeeRoot : une autre liste est détectée");
  assert.equal(rs.ok, false);
  const wave = clone(doc); wave.committee!.wave = 2;
  assert.equal(status(verifyBlock({ block, receipts: wave }), "committee-commit"), "fail", "la vague est engagée");
  const reordered = clone(doc); reordered.committee!.ranked = [...reordered.committee!.ranked].reverse();
  const rr = verifyBlock({ block, receipts: reordered });
  assert.equal(status(rr, "committee-commit"), "fail"); assert.equal(status(rr, "committee-ranks"), "fail");
  const k = clone(doc); k.committee!.K = 5;
  assert.equal(status(verifyBlock({ block, receipts: k }), "committee-commit"), "fail");
  const thr = clone(doc); thr.committee!.threshold = 2;
  assert.equal(status(verifyBlock({ block, receipts: thr }), "committee-commit"), "fail");
  // le serveur change AUSSI committeeRoot dans le bloc pour rester cohérent : alors c'est le HASH du bloc qui ne correspond plus
  const both = verifyBlock({ block: { ...block, committeeRoot: "0".repeat(64) }, receipts: swapped });
  assert.equal(status(both, "hash"), "fail", "committeeRoot fait partie du hash canonique");
  const stranger = clone(doc); stranger.receipts[0].profileId = "art_etranger";
  assert.equal(status(verifyBlock({ block, receipts: stranger }), "committee-members"), "fail");
  // mineur : résultat ET entrées engagés
  const truqueur = { ...block, miner: { ...block.miner!, profileId: block.miner!.accepted.find((x) => x.profileId !== block.miner!.profileId)!.profileId } };
  const rt = verifyBlock({ block: truqueur, receipts: doc });
  assert.equal(status(rt, "miner-commit"), "fail", "un autre profil désigné : minerRoot ne correspond plus"); assert.equal(status(rt, "miner"), "fail");
  const rigged = { ...block, miner: { ...block.miner!, accepted: block.miner!.accepted.map((x) => ({ ...x, minedBlocks: x.profileId === block.miner!.profileId ? 99 : 0 })) } };
  assert.equal(status(verifyBlock({ block: rigged, receipts: doc }), "miner-commit"), "fail", "nombres de blocs minés truqués : les ENTRÉES du tirage sont engagées");
  const noMiner = { ...block, miner: undefined };
  assert.equal(status(verifyBlock({ block: noMiner, receipts: doc }), "miner-commit"), "fail", "effacer le tirage ne passe pas : minerRoot l'engage");
  // APPAREIL mineur (audit GPT FIX2) : seul le profil était engagé ; l'appareil qui reçoit le bloc doit être celui que les reçus du profil tiré désignent
  assert.equal(status(verifyBlock({ block, receipts: doc }), "miner-device"), "ok");
  const otherDevice = doc.receipts.find((x) => x.profileId !== block.miner!.profileId)!.deviceId;
  const wrongDev = verifyBlock({ block: { ...block, minerDeviceId: otherDevice }, receipts: doc });
  assert.equal(status(wrongDev, "miner-device"), "fail", "le bloc est attribué à l'appareil d'un AUTRE profil : détecté"); assert.equal(wrongDev.ok, false);
  assert.equal(status(verifyBlock({ block: { ...block, minerDeviceId: "dev_INCONNU" }, receipts: doc }), "miner-device"), "fail", "appareil sans reçu : détecté");
  assert.equal(status(verifyBlock({ block: { ...block, minerDeviceId: undefined }, receipts: doc }), "miner-device"), "fail", "appareil absent : détecté");
  const few = committeeBlock(PROFILES, 5); few.doc.receipts.splice(4);
  assert.equal(verifyBlock({ block: few.block, receipts: few.doc }).ok, false, "reçus supprimés : racine/hash/décision échouent");
});

test("un comité « shadow » n'a PAS siégé : ni dans les reçus ni dans le hash (mode « quorum », racine du quorum historique)", () => {
  const c = committeeFor(PROFILES, "independent", "shadow");
  const win = committeeWindow(toCommittee(c), 1);
  const candidate = { candidateId: CANDIDATE_ID, poolSize: 9, v2: v2spec, imageHash: "a".repeat(64), actionsHash: "b".repeat(64), deviceId: "dev_AUTHOR01", poolScreen: "oled096", committee: c } as unknown as Candidate;
  const built = buildBlockV2({ candidate, allVotes: win.slice(0, 5).map((p) => v2vote(p)), parentHash: PARENT, finalScore: 0.4, minedAt: 1 });
  assert.equal(built.doc.committee, undefined); assert.equal(built.fields.committeeMode, "quorum"); assert.equal(built.fields.committeeK, 9);
});

test("mineur déterministe : même bloc, même résultat ; sans reçus (BLOCK_RECEIPTS) ou sans comité « enforce », l'ancien tirage est conservé ; aucun Math.random dans le chemin déterministe", () => {
  const a = committeeBlock(), b = committeeBlock();
  assert.equal(a.block.miner!.profileId, b.block.miner!.profileId);
  const src = read("lib/chain.ts");
  assert.match(src, /if \(prep && candidate\.committee\?\.state === "enforce"\)/);
  assert.ok(src.indexOf("const v2 = prep ? sealBlockV2(prep") < src.indexOf("targetBlockHash: blockHash"), "le hash FINAL (mineur engagé) existe avant la tâche d'observation qui le cite");
  assert.ok(src.indexOf("prepareBlockV2({") < src.indexOf("drawMiner({") && src.indexOf("drawMiner({") < src.indexOf("sealBlockV2(prep"), "préparer → tirer le mineur → sceller");
  assert.match(src, /const effectiveMiner = deterministicMiner\s+\?\? await selectEquitableMiner/);
  const detBlock = src.slice(src.indexOf("let minerInfo"), src.indexOf("const effectiveMiner"));
  assert.doesNotMatch(detBlock, /Math\.random/);
  assert.match(detBlock, /redis\.llen/, "même coût qu'avant : un LLEN par approbateur");
});

test("appareil mineur : règle DÉTERMINISTE (plus petit appareil approuvant du profil tiré), indépendante de l'ordre d'arrivée ; un refus ne désigne jamais un appareil", () => {
  const rs = [{ deviceId: "dev_C", profileId: "art_p", verdict: "accept" }, { deviceId: "dev_A", profileId: "art_p", verdict: "reject" }, { deviceId: "dev_B", profileId: "art_p", verdict: "accept" }, { deviceId: "dev_Z", profileId: "art_q", verdict: "accept" }];
  assert.equal(minerDeviceFor("art_p", rs), "dev_B", "dev_A refuse : exclu ; dev_B < dev_C");
  assert.equal(minerDeviceFor("art_p", [...rs].reverse()), "dev_B", "ordre d'arrivée sans effet");
  assert.equal(minerDeviceFor("art_q", rs), "dev_Z");
  assert.equal(minerDeviceFor("art_absent", rs), null);
  assert.equal(minerDeviceFor("dev_X", [{ deviceId: "dev_X", verdict: "accept" }]), "dev_X", "sans profil : la clé de vote est l'appareil");
  assert.match(read("lib/chain.ts"), /deterministicMiner = minerDeviceFor\(winner, votes\)/, "finalizeBlock utilise la même règle que le vérificateur");
});

// ── câblage et budget ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("câblage : off = comportement historique ; le comité exige éligibilité « enforce » ET reçus ; aucune commande Redis de plus hors +1 lecture de tête au dépôt et +1 EVAL de réputation", () => {
  const sub = read("app/api/submit-candidate/route.ts");
  assert.match(sub, /commMode !== "off" && v2/);
  assert.match(sub, /commMode === "enforce" && eligMode === "enforce" && blockReceiptsEnabled\(\) \? "enforce" : "shadow"/);
  assert.equal((sub.match(/getChainHead\(\)/g) ?? []).length, 1, "une seule lecture de plus par candidat");
  const val = read("app/api/validation-result/route.ts");
  assert.match(val, /committeeEnforced = commMode === "enforce" && candidate\.committee\?\.state === "enforce"/);
  assert.match(val, /rejectionsWouldBlock = !committeeEnforced && /);
  assert.match(val, /cast\.added === true/);
  assert.equal((val.match(/applyReputation\(/g) ?? []).length, 2, "une agrégation au refus, une à la finalisation");
  assert.doesNotMatch(val, /redis\.(get|mget|smembers|scan|keys)\(/.source === "" ? /$^/ : /redis\.(scan|keys)\(/);
  const pull = read("app/api/pull/route.ts"), vc = read("app/api/validate-candidate/route.ts");
  assert.match(pull, /candidate\.committee\?\.state === "enforce" && committeeModeFromEnv\(\) === "enforce"/);
  assert.match(vc, /committeeGate\(/);
  const rep = read("lib/reputation.ts");
  assert.match(rep, /try \{ return Number\(await r\.eval/, "la réputation ne lève jamais");
});
