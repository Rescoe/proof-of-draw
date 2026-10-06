import test from "node:test";
import assert from "node:assert/strict";
import { castVoteOn, VOTE_SCRIPT, type VoteRedis, type Candidate, type ValidationVote, type VoteMap } from "../lib/chain";

// Faux Redis monothread : `eval` ÉMULE le script Lua de lib/chain.ts (VOTE_SCRIPT) en JavaScript. Une fonction JS synchrone ne peut pas être
// entrelacée — comme un EVAL Redis. Ce test vérifie le CÂBLAGE (réponses −1/0/1, repli, quorum) ; la sémantique réelle du Lua (cjson) se constate sur Upstash.
function fakeRedis(opts: { evalThrows?: boolean; replyAsObject?: boolean } = {}) {
  const store = new Map<string, string>();
  const calls = { eval: 0, get: 0, set: 0 };
  const r: VoteRedis = {
    async eval(script, keys, args) {
      calls.eval++;
      if (opts.evalThrows) throw new Error("ERR unknown command 'eval'");
      assert.equal(script, VOTE_SCRIPT);
      const raw = store.get(keys[0]);
      if (!raw) return [-1];
      const m = JSON.parse(raw) as VoteMap;
      if (m.candidateId !== args[0]) return [-1];
      if (m.votes[args[1]] !== undefined) return [0, opts.replyAsObject ? m : raw];
      m.votes[args[1]] = JSON.parse(args[2]);
      const enc = JSON.stringify(m);
      store.set(keys[0], enc);
      return [1, opts.replyAsObject ? m : enc];
    },
    async get(key) { calls.get++; return store.get(key) ?? null; },
    async set(key, value) { calls.set++; store.set(key, value); return "OK"; },
  };
  return { r, store, calls };
}

const KEY_VOTES = "candidate:votes";   // même clé que lib/chain.ts
const cand = (id: string, poolSize: number) => ({ candidateId: id, poolSize } as unknown as Candidate);
const vote = (deviceId: string, verdict?: "reject"): ValidationVote => ({ deviceId, entropy: 0.5, transitions: 0.5, rle: 0.5, score: 0.5, signature: "", votedAt: 1, ...(verdict ? { v: 2, verdict } : {}) } as ValidationVote);

test("5 votes simultanés : aucun n'est perdu et le quorum est atteint (chemin atomique)", async () => {
  const k = KEY_VOTES;
  const { r, store } = fakeRedis();
  store.set(k, JSON.stringify({ candidateId: "c1", votes: {} }));
  const res = await Promise.all(["A", "B", "C", "D", "E"].map((d) => castVoteOn(r, vote("dev_" + d), cand("c1", 5), undefined)));
  const map = JSON.parse(store.get(k)!) as VoteMap;
  assert.equal(Object.keys(map.votes).length, 5, "les 5 votes sont enregistrés");
  assert.equal(res.filter((x) => x.quorumReached).length >= 1, true, "au moins un votant voit le quorum (ceil(5×0,51)=3)");
});

test("même appareil deux fois : le second vote est ignoré et ne déclenche pas le quorum", async () => {
  const k = KEY_VOTES;
  const { r, store } = fakeRedis();
  store.set(k, JSON.stringify({ candidateId: "c1", votes: {} }));
  const a = await castVoteOn(r, vote("dev_A"), cand("c1", 1), undefined);
  assert.equal(a.quorumReached, true);
  const b = await castVoteOn(r, vote("dev_A"), cand("c1", 1), undefined);
  assert.equal(b.quorumReached, false, "un double vote ne re-déclenche pas le quorum");
  assert.equal(b.voteCount, 1);
});

test("autre candidat ou aucune carte : rien n'est compté", async () => {
  const k = KEY_VOTES;
  const { r, store } = fakeRedis();
  assert.deepEqual(await castVoteOn(r, vote("dev_A"), cand("c1", 1), undefined), { quorumReached: false, voteCount: 0, needed: 0 });
  store.set(k, JSON.stringify({ candidateId: "autre", votes: {} }));
  assert.deepEqual(await castVoteOn(r, vote("dev_A"), cand("c1", 1), undefined), { quorumReached: false, voteCount: 0, needed: 0 });
});

test("sortie sans commande : carte préchargée du mauvais candidat ou vote déjà présent → aucun eval", async () => {
  const { r, calls } = fakeRedis();
  await castVoteOn(r, vote("dev_A"), cand("c1", 1), { candidateId: "autre", votes: {} });
  await castVoteOn(r, vote("dev_A"), cand("c1", 1), { candidateId: "c1", votes: { dev_A: vote("dev_A") } });
  assert.equal(calls.eval, 0);
});

test("un refus v2 est conservé mais ne compte pas pour le quorum", async () => {
  const k = KEY_VOTES;
  const { r, store } = fakeRedis();
  store.set(k, JSON.stringify({ candidateId: "c1", votes: {} }));
  const rej = await castVoteOn(r, vote("dev_A", "reject"), cand("c1", 2), undefined);
  assert.equal(rej.quorumReached, false);
  assert.equal(rej.voteCount, 0);
  assert.equal(rej.rejectCount, 1);
});

test("la réponse du script peut arriver déjà désérialisée (SDK Upstash) : même résultat", async () => {
  const k = KEY_VOTES;
  const { r, store } = fakeRedis({ replyAsObject: true });
  store.set(k, JSON.stringify({ candidateId: "c1", votes: {} }));
  const res = await castVoteOn(r, vote("dev_A"), cand("c1", 1), undefined);
  assert.equal(res.quorumReached, true);
});

test("script indisponible : repli sur l'ancien chemin (le vote est quand même enregistré)", async () => {
  const k = KEY_VOTES;
  const { r, store } = fakeRedis({ evalThrows: true });
  store.set(k, JSON.stringify({ candidateId: "c1", votes: {} }));
  const res = await castVoteOn(r, vote("dev_A"), cand("c1", 1), undefined);
  assert.equal(res.quorumReached, true);
  assert.equal(Object.keys((JSON.parse(store.get(k)!) as VoteMap).votes).length, 1);
});

test("RÉGRESSION documentée : l'ancien chemin perd un vote quand deux votes partent de la même lecture", async () => {
  const k = KEY_VOTES;
  const { r, store } = fakeRedis({ evalThrows: true });
  store.set(k, JSON.stringify({ candidateId: "c1", votes: {} }));
  const snapshot: VoteMap = { candidateId: "c1", votes: {} };
  // deux routes lisent la MÊME carte (MGET) puis écrivent chacune la leur : la seconde écrase la première
  await castVoteOn(r, vote("dev_A"), cand("c1", 2), JSON.parse(JSON.stringify(snapshot)));
  await castVoteOn(r, vote("dev_B"), cand("c1", 2), JSON.parse(JSON.stringify(snapshot)));
  assert.equal(Object.keys((JSON.parse(store.get(k)!) as VoteMap).votes).length, 1, "un vote perdu : c'est ce que le script Lua évite");
});

// ── MIN_V2_APPROVALS : un bloc ne se mine pas sur de simples échos v1 quand on exige une approbation recalculée ──────────────────────────────
const withV2 = (id: string, poolSize: number) => ({ candidateId: id, poolSize, v2: { screen: "eink29bwr" } } as unknown as Candidate);
const v2accept = (d: string): ValidationVote => ({ ...vote(d), v: 2, verdict: "accept" } as ValidationVote);

test("MIN_V2_APPROVALS=1 : 3 échos v1 n'atteignent pas le quorum ; l'arrivée d'une approbation v2 le déclenche", async () => {
  process.env.MIN_V2_APPROVALS = "1";
  try {
    const { r, store } = fakeRedis();
    store.set(KEY_VOTES, JSON.stringify({ candidateId: "c1", votes: {} }));
    const c = withV2("c1", 5);   // quorum = ceil(5 × 0,51) = 3
    assert.equal((await castVoteOn(r, vote("dev_A"), c, undefined)).quorumReached, false);
    assert.equal((await castVoteOn(r, vote("dev_B"), c, undefined)).quorumReached, false);
    const third = await castVoteOn(r, vote("dev_C"), c, undefined);
    assert.equal(third.voteCount, 3);
    assert.equal(third.quorumReached, false, "3 échos v1 : quorum numérique atteint mais aucune validation recalculée");
    assert.equal((await castVoteOn(r, v2accept("dev_D"), c, undefined)).quorumReached, true, "l'approbation v2 finalise");
  } finally { delete process.env.MIN_V2_APPROVALS; }
});

test("MIN_V2_APPROVALS absent (défaut) ou candidat sans v2 : comportement inchangé", async () => {
  const { r, store } = fakeRedis();
  store.set(KEY_VOTES, JSON.stringify({ candidateId: "c1", votes: {} }));
  process.env.MIN_V2_APPROVALS = "1";
  try {
    // animation / ancien candidat (pas de v2) : aucune exigence
    assert.equal((await castVoteOn(r, vote("dev_A"), cand("c1", 1), undefined)).quorumReached, true);
  } finally { delete process.env.MIN_V2_APPROVALS; }
  store.set(KEY_VOTES, JSON.stringify({ candidateId: "c2", votes: {} }));
  assert.equal((await castVoteOn(r, vote("dev_A"), withV2("c2", 1), undefined)).quorumReached, true, "désactivé par défaut");
});
