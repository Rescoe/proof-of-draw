// lib/chain.ts
// Chaîne de blocs légère Proof-of-Draw
// Stockée entièrement dans Redis — les ESP ne stockent que le hash courant.
//
// Structure d'un bloc :
//   blockIndex    : numéro séquentiel
//   blockHash     : SHA-256 du contenu canonique du bloc
//   parentHash    : hash du bloc précédent (genesis = "0000...0000")
//   drawingHash   : hash du dessin validé
//   deviceId      : device de l'artiste auteur
//   artistName    : nom de l'artiste (snapshot au moment du minage)
//   poolScreen    : type d'écran de la pool qui a validé
//   validatorIds  : deviceIds des ESP ayant signé
//   score         : score de complexité composite [0,1]
//   displayTime   : durée d'affichage en secondes
//   minedAt       : timestamp Unix ms
//   frameId       : identifiant de la frame broadcastée
//
// Clés Redis :
//   chain:head          → JSON(Block)          dernier bloc validé
//   chain:block:{hash}  → JSON(Block)          bloc par son hash (archive)
//   chain:index:{n}     → blockHash            bloc par index
//   chain:length        → number               nombre total de blocs
//   candidate:current   → JSON(Candidate)      dessin en cours de validation
//   candidate:votes     → JSON(VoteMap)        votes reçus pour le candidat

// lib/chain.ts
// Chaîne de blocs légère Proof-of-Draw
// Stockée entièrement dans Redis — les ESP ne stockent que le hash courant.

import { redis } from "@/lib/redis";
import { sha256Hex, computeDisplayTime } from "@/lib/crypto";
import { FramePayload } from "@/lib/queue";

export interface Block {
  blockIndex: number;
  blockHash: string;
  parentHash: string;
  drawingHash: string;
  deviceId: string;
  artistName: string;
  poolScreen: string;
  validatorIds: string[];
  score: number;
  displayTime: number;
  minedAt: number;
  frameId: string;
}

export interface Candidate {
  candidateId: string;
  deviceId: string;
  artistName: string;
  poolScreen: string;
  payload: FramePayload;
  drawingHash: string;
  score: number;
  submittedAt: number;
  expiresAt: number;
  poolSize: number;
  warning?: string | null;
}

export interface ValidationVote {
  deviceId: string;
  entropy: number;
  transitions: number;
  rle: number;
  score: number;
  signature: string;
  votedAt: number;
}

export interface VoteMap {
  candidateId: string;
  votes: Record<string, ValidationVote>;
}

const KEY_HEAD = "chain:head";
const KEY_LENGTH = "chain:length";
const KEY_CANDIDATE = "candidate:current";
const KEY_VOTES = "candidate:votes";
const blockKey = (hash: string) => `chain:block:${hash}`;
const indexKey = (n: number) => `chain:index:${n}`;

const GENESIS_HASH = "0".repeat(64);
const CANDIDATE_TTL_SEC = parseInt(process.env.CANDIDATE_TTL_SEC ?? "600");
const QUORUM_RATIO = parseFloat(process.env.QUORUM_RATIO ?? "0.51");

export async function getChainHead(): Promise<Block | null> {
  const raw = await redis.get(KEY_HEAD);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as Block);
  } catch {
    return null;
  }
}

export async function getChainLength(): Promise<number> {
  const v = await redis.get<string>(KEY_LENGTH);
  return v ? parseInt(v) : 0;
}

export async function getBlockByHash(hash: string): Promise<Block | null> {
  const raw = await redis.get(blockKey(hash));
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as Block);
  } catch {
    return null;
  }
}

export async function getCurrentCandidate(): Promise<Candidate | null> {
  const raw = await redis.get(KEY_CANDIDATE);
  if (!raw) return null;
  try {
    const c: Candidate = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Date.now() > c.expiresAt) {
      await redis.del(KEY_CANDIDATE);
      await redis.del(KEY_VOTES);
      return null;
    }
    return c;
  } catch {
    return null;
  }
}

export async function setCandidate(candidate: Candidate): Promise<void> {
  await Promise.all([
    redis.set(KEY_CANDIDATE, JSON.stringify(candidate), { ex: CANDIDATE_TTL_SEC }),
    redis.set(KEY_VOTES, JSON.stringify({ candidateId: candidate.candidateId, votes: {} }), { ex: CANDIDATE_TTL_SEC }),
  ]);
}

export async function clearCandidate(): Promise<void> {
  await Promise.all([redis.del(KEY_CANDIDATE), redis.del(KEY_VOTES)]);
}

export async function getVotes(): Promise<VoteMap | null> {
  const raw = await redis.get(KEY_VOTES);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as VoteMap);
  } catch {
    return null;
  }
}

export async function castVote(
  vote: ValidationVote,
  candidate: Candidate,
): Promise<{ quorumReached: boolean; voteCount: number; needed: number }> {
  const voteMap = await getVotes();
  if (!voteMap || voteMap.candidateId !== candidate.candidateId) {
    return { quorumReached: false, voteCount: 0, needed: 0 };
  }

  if (voteMap.votes[vote.deviceId]) {
    return {
      quorumReached: false,
      voteCount: Object.keys(voteMap.votes).length,
      needed: Math.ceil(candidate.poolSize * QUORUM_RATIO),
    };
  }

  voteMap.votes[vote.deviceId] = vote;
  await redis.set(KEY_VOTES, JSON.stringify(voteMap), { ex: CANDIDATE_TTL_SEC });

  const voteCount = Object.keys(voteMap.votes).length;
  const needed = Math.ceil(candidate.poolSize * QUORUM_RATIO);
  const quorumReached = voteCount >= Math.max(1, needed);

  return { quorumReached, voteCount, needed };
}

export async function finalizeBlock(
  candidate: Candidate,
  votes: ValidationVote[],
  frameId: string,
): Promise<Block> {
  const head = await getChainHead();
  const length = await getChainLength();
  const parentHash = head?.blockHash ?? GENESIS_HASH;

  const avgScore = votes.reduce((s, v) => s + v.score, 0) / votes.length;
  const finalScore = (candidate.score + avgScore) / 2;
  const displayTime = computeDisplayTime(finalScore, parentHash);

  const canonical = JSON.stringify({
    parentHash,
    drawingHash: candidate.drawingHash,
    deviceId: candidate.deviceId,
    poolScreen: candidate.poolScreen,
    validatorIds: votes.map((v) => v.deviceId).sort(),
    score: finalScore,
    minedAt: Date.now(),
  });

  const blockHash = await sha256Hex(canonical);

  const block: Block = {
    blockIndex: length,
    blockHash,
    parentHash,
    drawingHash: candidate.drawingHash,
    deviceId: candidate.deviceId,
    artistName: candidate.artistName,
    poolScreen: candidate.poolScreen,
    validatorIds: votes.map((v) => v.deviceId).sort(),
    score: finalScore,
    displayTime,
    minedAt: Date.now(),
    frameId,
  };

  await Promise.all([
    redis.set(KEY_HEAD, JSON.stringify(block)),
    redis.set(blockKey(blockHash), JSON.stringify(block), { ex: 30 * 24 * 3600 }),
    redis.set(indexKey(length), blockHash, { ex: 30 * 24 * 3600 }),
    redis.set(KEY_LENGTH, String(length + 1)),
  ]);

  console.log(
    `[chain] BLOC #${length} hash=${blockHash.slice(0, 12)}... score=${finalScore.toFixed(3)} display=${displayTime}s`,
  );

  return block;
}

export interface ChainSummary {
  blockIndex: number;
  blockHash: string;
  displayTime: number;
  artistName: string;
  poolScreen: string;
  minedAt: number;
}

export async function getChainSummary(): Promise<ChainSummary | null> {
  const head = await getChainHead();
  if (!head) return null;
  return {
    blockIndex: head.blockIndex,
    blockHash: head.blockHash,
    displayTime: head.displayTime,
    artistName: head.artistName,
    poolScreen: head.poolScreen,
    minedAt: head.minedAt,
  };
}