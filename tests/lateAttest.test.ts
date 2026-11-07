// tests/lateAttest.test.ts — attestations tardives (ATTESTATIONS_MODE, éteint par défaut). Prouvé : mode off == avant (listes de clés des MGET, chemin de vote), copie légère du candidat clos, TTL, refus d'un doublon,
// image lue seulement par candidate-frame, aucune écriture dans candidate:current / candidate:votes. NON prouvé : le comportement des firmwares sur la carte (une carte reçoit une réponse « vote tardif » ordinaire).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { attestationsEnabled, closedMeta, saveClosedCandidate, readClosedFor, castLateVote, loadCandidateForFrame, parseClosed, KEY_CLOSED, KEY_CLOSED_VOTES, KEY_CLOSED_PAYLOAD, CLOSED_TTL_SEC, attestKey, type LateRedis } from "../lib/lateAttest";
import { parseCandidateRaw, VOTE_SCRIPT, type Candidate, type ValidationVote } from "../lib/chain";
import { buildCandidateV2 } from "../lib/podVote";
import { METRIC_GRID } from "../lib/podMetrics";

const ID = "123e4567-e89b-42d3-a456-426614174000";
// la copie close est écrite JUSTE AVANT l'effacement du candidat du minage (la première occurrence de clearCandidate() peut être un autre chemin)
const savedJustBeforeClear = (t: string) => { const i = t.indexOf("saveClosedCandidate(candidate, voteMap"); const j = i < 0 ? -1 : t.indexOf("await clearCandidate();", i); return i >= 0 && j > i && j - i < 400; };
const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

function candidate(over: Partial<Candidate> = {}): Candidate {
  const buf = Buffer.alloc(METRIC_GRID.oled096.rawBytes);
  for (let i = 0; i < buf.length; i += 3) buf[i] = 0xa5;
  const payload = { screen: "oled096", buffer: buf.toString("base64") };
  return {
    candidateId: ID, deviceId: "dev_AAAAAAAA", artistName: "A", poolScreen: "oled096", payload, imageHash: "h", actionsHash: "a", drawScore: 1,
    actionSequence: [{ type: "stroke" } as never], score: 0.5, submittedAt: 1000, expiresAt: 2000, poolSize: 3, v2: buildCandidateV2("oled096", payload),
    replayEvents: [{ big: "x".repeat(5000) } as never], ...over,
  } as unknown as Candidate;
}
type Call = { op: string; args: unknown[] };
function fakeRedis(store: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const r: Record<string, unknown> = {};
  r.set = async (k: string, v: unknown, o: unknown) => { calls.push({ op: "set", args: [k, v, o] }); store[k] = v; return "OK"; };
  r.mget = async (...keys: string[]) => { calls.push({ op: "mget", args: keys }); return keys.map((k) => store[k] ?? null); };
  r.hset = async (k: string, v: unknown) => { calls.push({ op: "hset", args: [k, v] }); return 1; };
  r.expire = async (k: string, s: number) => { calls.push({ op: "expire", args: [k, s] }); return 1; };
  r.eval = async (script: string, keys: string[], args: string[]) => {
    calls.push({ op: "eval", args: [script, keys, args] });
    const cur = (store[keys[0]] ? JSON.parse(store[keys[0]] as string) : { candidateId: args[0], votes: {} }) as { candidateId: string; votes: Record<string, unknown> };
    if (cur.candidateId !== args[0]) return [-1, JSON.stringify(cur)];
    if (cur.votes[args[1]]) return [0, JSON.stringify(cur)];
    cur.votes[args[1]] = JSON.parse(args[2]);
    store[keys[0]] = JSON.stringify(cur);
    return [1, JSON.stringify(cur)];
  };
  return { calls, store, r: r as unknown as LateRedis, restore: () => {} };
}

test("interrupteur : éteint par défaut, allumé seulement par « on »", () => {
  assert.equal(attestationsEnabled({} as unknown as NodeJS.ProcessEnv), false);
  for (const v of ["", "off", "shadow", "true", "1", "ON "]) assert.equal(attestationsEnabled({ ATTESTATIONS_MODE: v } as unknown as NodeJS.ProcessEnv), v.trim().toLowerCase() === "on");
});

test("copie légère : sans image ni séquence d'actions ni replay, expiration prolongée, v2 et bloc conservés, relisible par parseCandidateRaw", () => {
  const m = closedMeta(candidate(), "blockhash", 5_000);
  assert.equal(m.expiresAt, 5_000 + CLOSED_TTL_SEC * 1000);
  assert.deepEqual(m.actionSequence, []);
  assert.equal((m as unknown as { replayEvents?: unknown }).replayEvents, undefined);
  assert.equal(m.blockHash, "blockhash");
  assert.ok(m.v2 && m.v2.rawHash.length === 64);
  assert.ok(JSON.stringify(m).length < 2500, "méta trop grosse : " + JSON.stringify(m).length);
  assert.ok(!JSON.stringify(m).includes((candidate().payload as { buffer?: string }).buffer ?? "zzz"));
  const back = parseCandidateRaw(JSON.stringify({ ...m, expiresAt: Date.now() + 10_000 }));
  assert.equal(back?.candidateId, ID);
});

test("minage : 3 écritures avec TTL, aucune dans candidate:current / candidate:votes ; animation et candidat sans v2 : rien", async () => {
  const f = fakeRedis();
  try {
    await saveClosedCandidate(candidate(), { candidateId: ID, votes: { dev_BBBBBBBB: { deviceId: "dev_BBBBBBBB" } as ValidationVote } }, "bh", 10_000, f.r);
    const sets = f.calls.filter((c) => c.op === "set");
    assert.deepEqual(sets.map((c) => c.args[0]).sort(), [KEY_CLOSED, KEY_CLOSED_PAYLOAD, KEY_CLOSED_VOTES].sort());
    for (const c of sets) assert.deepEqual(c.args[2], { ex: CLOSED_TTL_SEC });
    assert.ok(!sets.some((c) => String(c.args[0]) === "candidate:current" || String(c.args[0]) === "candidate:votes"));
    assert.ok(JSON.parse(f.store[KEY_CLOSED_VOTES] as string).votes.dev_BBBBBBBB, "les votes déjà reçus sont conservés");
    f.calls.length = 0;
    await saveClosedCandidate(candidate({ kind: "animation" }), null, "bh", Date.now(), f.r);
    await saveClosedCandidate(candidate({ v2: undefined }), null, "bh", Date.now(), f.r);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test("lecture : seulement le candidat demandé ; vote déjà présent visible ; copie expirée ignorée", async () => {
  const f = fakeRedis();
  try {
    await saveClosedCandidate(candidate(), null, "bh", Date.now(), f.r);
    const ok = await readClosedFor(ID, f.r);
    assert.equal(ok?.candidate.candidateId, ID);
    assert.equal(await readClosedFor("123e4567-e89b-42d3-a456-426614174999", f.r), null);
    const exp = closedMeta(candidate(), "bh", Date.now() - 2 * CLOSED_TTL_SEC * 1000);
    assert.equal(parseClosed(JSON.stringify(exp), null), null);
  } finally { f.restore(); }
});

test("attestation : ajoutée une fois, doublon refusé, trace durable au nom du bloc, jamais dans les votes du candidat courant", async () => {
  const f = fakeRedis();
  try {
    await saveClosedCandidate(candidate(), null, "bh", Date.now(), f.r);
    const c = (await readClosedFor(ID, f.r))!.candidate;
    const v = { deviceId: "dev_CCCCCCCC", entropy: 0, transitions: 0, rle: 0, score: 1, signature: "s", votedAt: 1, v: 2, verdict: "accept" } as unknown as ValidationVote;
    const a = await castLateVote(v, c, f.r);
    assert.equal(a.added, true); assert.equal(a.voteCount, 1);
    const b = await castLateVote(v, c, f.r);
    assert.equal(b.added, false);
    const ev = f.calls.filter((x) => x.op === "eval");
    assert.ok(ev.every((x) => (x.args[1] as string[])[0] === KEY_CLOSED_VOTES && x.args[0] === VOTE_SCRIPT));
    assert.equal(f.calls.filter((x) => x.op === "hset").length, 1);
    assert.equal(f.calls.find((x) => x.op === "hset")!.args[0], attestKey("bh"));
    assert.ok(!f.calls.some((x) => x.op === "eval" && (x.args[1] as string[]).includes("candidate:votes")));
  } finally { f.restore(); }
});

test("image : le candidat courant gagne ; sinon la copie close (méta + image) ; mode off : exactement le chargeur d'avant", async () => {
  const f = fakeRedis();
  try {
    const c = candidate();
    await saveClosedCandidate(c, null, "bh", Date.now(), f.r);
    const cur = candidate({ candidateId: "123e4567-e89b-42d3-a456-426614174111" });
    assert.equal((await loadCandidateForFrame(cur.candidateId, async () => cur, { ATTESTATIONS_MODE: "on" } as unknown as NodeJS.ProcessEnv, f.r))?.candidateId, cur.candidateId);
    const closed = await loadCandidateForFrame(ID, async () => cur, { ATTESTATIONS_MODE: "on" } as unknown as NodeJS.ProcessEnv, f.r);
    assert.equal(closed?.candidateId, ID);
    assert.equal(closed?.payload && (closed.payload as { buffer?: string }).buffer, c.payload && (c.payload as { buffer?: string }).buffer);
    f.calls.length = 0;
    const off = await loadCandidateForFrame(ID, async () => cur, {} as unknown as NodeJS.ProcessEnv, f.r);
    assert.equal(off?.candidateId, cur.candidateId, "mode off : renvoie le courant (404 habituel de candidateFrameResponse)");
    assert.equal(f.calls.length, 0, "mode off : aucune lecture Redis de plus");
  } finally { f.restore(); }
});

test("MODE OFF == AVANT (structure) : listes de clés des MGET conditionnelles, chemin de vote gardé, copie au minage gardée", () => {
  const pull = read("app/api/pull/route.ts"), val = read("app/api/validate-candidate/route.ts"), res = read("app/api/validation-result/route.ts"), fr = read("app/api/candidate-frame/route.ts");
  assert.match(pull, /\.\.\.\(attOn \? \[KEY_CLOSED, KEY_CLOSED_VOTES\] : \[\]\)/);
  assert.match(pull, /if \(attOn && !pendingValidation && mayVote\)/);
  assert.match(val, /\.\.\.\(attOn \? \[KEY_CLOSED, KEY_CLOSED_VOTES\] : \[\]\)/);
  assert.match(val, /if \(attOn && \(!candidate \|\|/);
  assert.match(res, /if \(attestationsEnabled\(\) && \(!candidateSel \|\| candidateSel\.candidateId !== String\(candidateId\)\)\)/);
  assert.match(res, /if \(attestationsEnabled\(\)\) await saveClosedCandidate\(candidate, voteMap, block\.blockHash\)/);
  assert.match(res, /const committeeEnforced = !late && /);
  assert.match(res, /if \(late && !isV2\) return json/);
  assert.match(res, /if \(late\) \{[\s\S]{0,400}castLateVote\(vote, candidate\)[\s\S]{0,400}return json\(\{ ok: true, blockMined: false, alreadyFinalized: true, attestation: true/);
  assert.match(fr, /loadCandidateForFrame\(id, getCurrentCandidate\)/);
  // la copie close est écrite AVANT l'effacement du candidat
  assert.ok(savedJustBeforeClear(res));
  // le chemin d'attestation ne touche ni au quorum ni au minage
  const lateBlock = res.slice(res.indexOf("if (late) {"), res.indexOf("const cast = await castVote"));
  assert.ok(!/finalizeBlock|claimFinalization|castVote\(|quorum/i.test(lateBlock.replace("alreadyFinalized", "")));
});

test("MUTANTS : copie close sans garde de mode, attestation comptée dans le comité/quorum, copie après l'effacement ⇒ détectés par les gardes de structure", () => {
  const res = read("app/api/validation-result/route.ts");
  const m1 = res.replace("if (attestationsEnabled()) await saveClosedCandidate", "await saveClosedCandidate");
  const m2 = res.replace("const committeeEnforced = !late && ", "const committeeEnforced = ");
  const m3 = res.replace("      if (attestationsEnabled()) await saveClosedCandidate(candidate, voteMap, block.blockHash).catch((e) => console.error(\"[validation-result] copie du candidat clos impossible (le minage continue) :\", e));   // ATTESTATIONS_MODE=on seulement\n      await clearCandidate();", "      await clearCandidate();\n      if (attestationsEnabled()) await saveClosedCandidate(candidate, voteMap, block.blockHash);");
  for (const [n, m] of [["sans garde", m1], ["comité actif en attestation", m2], ["copie après effacement", m3]] as const) {
    assert.notEqual(m, res, "mutant sans effet : " + n);
    const ok = /if \(attestationsEnabled\(\)\) await saveClosedCandidate\(candidate, voteMap, block\.blockHash\)/.test(m) && /const committeeEnforced = !late && /.test(m) && savedJustBeforeClear(m);
    assert.equal(ok, false, "mutant survivant : " + n);
  }
});
