// lib/lateAttest.ts — ATTESTATIONS TARDIVES (07/11/2026). Interrupteur ATTESTATIONS_MODE = « on » ; ÉTEINT par défaut : tout le reste du dépôt se comporte alors EXACTEMENT comme avant.
//
// Problème : le bloc est miné par le vote qui atteint le quorum, puis le candidat est effacé (et la file d'attente met le dessin suivant à sa place) : un appareil qui tire plus tard ne voit plus rien à voter.
// Ici, le quorum, le comité, les reçus et le minage ne changent PAS. Au minage, une copie LÉGÈRE du candidat reste lisible 10 minutes (métadonnées + votes déjà reçus ; l'image à part, lue seulement par
// /api/candidate-frame). Un appareil qui n'a pas voté en est informé par /api/pull (une clé de plus dans le MGET existant : 0 commande de plus), le vérifie comme d'habitude, et son vote v2 signé est
// enregistré comme ATTESTATION TARDIVE : jamais dans les reçus du bloc, jamais dans le comité, jamais de nouveau minage.
//
// COÛT REDIS (mode « on » seulement) : minage +3 écritures (méta, votes, image) ; pull et validate-candidate +2 clés dans leur MGET (aucune commande de plus) ; chaque attestation 1 MGET (méta + votes)
// + 1 script de vote + 1 HSET durable (trace pour le bloc, 30 jours). Mode « off » : zéro.
import { redis } from "@/lib/redis";
import { VOTE_SCRIPT, parseCandidateRaw, parseVotesRaw, type Candidate, type ValidationVote, type VoteMap } from "@/lib/chain";

/** Sous-ensemble de Redis utilisé ici (injectable pour les tests, comme VoteRedis). */
export interface LateRedis {
  set(key: string, value: string, opts: { ex: number }): Promise<unknown>;
  mget(...keys: string[]): Promise<unknown[]>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  hset(key: string, v: Record<string, string>): Promise<unknown>;
  expire(key: string, s: number): Promise<unknown>;
}
const real = (): LateRedis => redis as unknown as LateRedis;

export const KEY_CLOSED = "candidate:closed";                 // métadonnées du candidat clos (JSON, sans image ni séquence d'actions)
export const KEY_CLOSED_VOTES = "candidate:closed:votes";     // votes reçus avant le minage + attestations tardives (même forme que candidate:votes)
export const KEY_CLOSED_PAYLOAD = "candidate:closed:payload"; // image du candidat (lue seulement par /api/candidate-frame)
export const CLOSED_TTL_SEC = 600;
export const ATTEST_TRACE_TTL_SEC = 30 * 24 * 3600;
export const attestKey = (blockHash: string) => `chain:attest:${blockHash}`;

export function attestationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ATTESTATIONS_MODE ?? "off").trim().toLowerCase() === "on";
}

/** Candidat clos → métadonnées légères (sans image, sans séquence d'actions) ; `expiresAt` est prolongé jusqu'à la fin de la fenêtre. Fonction pure. */
export function closedMeta(c: Candidate, blockHash: string, now: number, ttlSec = CLOSED_TTL_SEC): Candidate & { blockHash: string } {
  return {
    candidateId: c.candidateId, deviceId: c.deviceId, artistName: c.artistName, poolScreen: c.poolScreen,
    payload: { screen: c.poolScreen } as Candidate["payload"],
    imageHash: c.imageHash, actionsHash: c.actionsHash, drawScore: c.drawScore, actionSequence: [],
    score: c.score, submittedAt: c.submittedAt, expiresAt: now + ttlSec * 1000, poolSize: c.poolSize,
    ...(c.pool ? { pool: c.pool } : {}), ...(c.workTitle ? { workTitle: c.workTitle } : {}),
    ...(c.v2 ? { v2: c.v2 } : {}), ...(c.eligibility ? { eligibility: c.eligibility } : {}),
    blockHash,
  };
}

/** Appelé au minage, AVANT l'effacement du candidat. Dessins v2 seulement (une animation n'a pas de spécification v2). N'échoue jamais bruyamment : le minage ne dépend pas de cette copie. */
export async function saveClosedCandidate(candidate: Candidate, voteMap: VoteMap | null, blockHash: string, now = Date.now(), r: LateRedis = real()): Promise<void> {
  if (!candidate.v2 || candidate.kind === "animation") return;
  const meta = closedMeta(candidate, blockHash, now);
  const votes: VoteMap = { candidateId: candidate.candidateId, votes: voteMap?.candidateId === candidate.candidateId ? voteMap.votes : {} };
  const payload = JSON.stringify(candidate.payload);
  await Promise.all([
    r.set(KEY_CLOSED, JSON.stringify(meta), { ex: CLOSED_TTL_SEC }),
    r.set(KEY_CLOSED_VOTES, JSON.stringify(votes), { ex: CLOSED_TTL_SEC }),
    r.set(KEY_CLOSED_PAYLOAD, payload, { ex: CLOSED_TTL_SEC }),
  ]);
}

export type ClosedState = { candidate: Candidate & { blockHash?: string }; votes: VoteMap | null };

/** Depuis les valeurs brutes déjà lues (MGET d'une route) : zéro commande. Vote déjà présent ou candidat expiré : géré par l'appelant. */
export function parseClosed(rawMeta: unknown, rawVotes: unknown): ClosedState | null {
  const candidate = parseCandidateRaw(rawMeta);
  if (!candidate || !candidate.v2) return null;
  const votes = parseVotesRaw(rawVotes);
  return { candidate: candidate as Candidate & { blockHash?: string }, votes: votes && votes.candidateId === candidate.candidateId ? votes : null };
}

/** Lecture isolée (1 commande) : seulement quand un vote arrive pour un candidat qui n'est plus le courant. */
export async function readClosedFor(candidateId: string, r: LateRedis = real()): Promise<ClosedState | null> {
  const raws = await r.mget(KEY_CLOSED, KEY_CLOSED_VOTES);
  const s = parseClosed(raws[0], raws[1]);
  return s && s.candidate.candidateId === candidateId ? s : null;
}

/** Chargeur de /api/candidate-frame : le candidat courant s'il correspond, sinon la copie close (méta + image) ; sinon le courant (réponse 404 habituelle). */
export async function loadCandidateForFrame(candidateId: string, loadCurrent: () => Promise<Candidate | null>, env: NodeJS.ProcessEnv = process.env, r: LateRedis = real()): Promise<Candidate | null> {
  const current = await loadCurrent();
  if (current && current.candidateId === candidateId) return current;
  if (!attestationsEnabled(env)) return current;
  const raws = await r.mget(KEY_CLOSED, KEY_CLOSED_PAYLOAD);
  const meta = parseCandidateRaw(raws[0]);
  if (!meta || meta.candidateId !== candidateId || !raws[1]) return current;
  try {
    const payload = typeof raws[1] === "string" ? JSON.parse(raws[1] as string) : raws[1];
    return { ...meta, payload } as Candidate;
  } catch { return current; }
}

export type AttestResult = { added: boolean; voteCount: number; rejectCount: number };

/** Enregistre l'attestation (même script atomique que le vote ; refuse un doublon) + trace durable pour le bloc. Ne touche JAMAIS aux votes du candidat courant ni au minage. */
export async function castLateVote(vote: ValidationVote, candidate: Candidate & { blockHash?: string }, r: LateRedis = real()): Promise<AttestResult> {
  const res = await r.eval(VOTE_SCRIPT, [KEY_CLOSED_VOTES], [candidate.candidateId, vote.deviceId, JSON.stringify(vote), String(CLOSED_TTL_SEC)]) as unknown;
  if (!Array.isArray(res) || typeof res[0] !== "number") throw new Error("réponse du script de vote inattendue");
  if (res[0] === -1) return { added: false, voteCount: 0, rejectCount: 0 };
  const map = parseVotesRaw(res[1]);
  const all = map ? Object.values(map.votes) : [];
  const added = res[0] === 1;
  if (added && candidate.blockHash) {
    const trace = JSON.stringify({ d: vote.deviceId, v: vote.verdict ?? "accept", t: vote.votedAt, ...(vote.v === 2 ? { v2: 1 } : {}) });
    await r.hset(attestKey(candidate.blockHash), { [vote.deviceId]: trace }).catch(() => {});
    await r.expire(attestKey(candidate.blockHash), ATTEST_TRACE_TTL_SEC).catch(() => {});
  }
  return { added, voteCount: all.length, rejectCount: all.filter((x) => x.verdict === "reject").length };
}
