// lib/chain.ts
// Chaîne de blocs légère Proof-of-Draw
// Stockée entièrement dans Redis — les ESP ne stockent que le hash courant.
//
// Structure d'un bloc :
//   blockIndex    : numéro séquentiel
//   blockHash     : SHA-256 du contenu canonique du bloc
//   parentHash    : hash du bloc précédent (genesis = "0000...0000")
//   imageHash     : hash du dessin validé (pixels finaux)
//   actionsHash   : hash de la séquence d'actions (processus de création)
//   drawScore     : Proof-of-Draw score (nb actions - nb undos)
//   deviceId      : device de l'artiste auteur
//   artistName    : nom de l'artiste (snapshot au moment du minage)
//   poolScreen    : type d'écran de la pool qui a validé
//   validatorIds  : deviceIds des ESP ayant signé
//   score         : score de complexité composite [0,1]
//   displayTime   : durée d'affichage en secondes
//   minedAt       : timestamp Unix ms
//   frameId       : identifiant de la frame broadcastée
//
// Clés Redis (SANS TTL — les blocs ne disparaissent jamais) :
//   chain:head              → JSON(Block)         dernier bloc validé
//   chain:block:{hash}      → JSON(Block)         bloc par son hash (archive permanente)
//   chain:recent            → List<blockHash>     100 derniers hashes (LPUSH + LTRIM)
//   chain:length            → number              nombre total de blocs
//   chain:image:{hash}      → JSON(ImagePayload)  image du dessin (permanente)
//   chain:actions:{hash}    → JSON(ActionEvent[]) séquence d'actions (permanente)
//   candidate:current       → JSON(Candidate)     dessin en cours de validation (TTL)
//   candidate:votes         → JSON(VoteMap)        votes reçus pour le candidat (TTL)
//
// NOTE : chain:index:{n} est abandonné — remplacé par chain:recent + chain-walk.

import { unstable_cache } from "next/cache";
import { redis } from "@/lib/redis";
import { sha256Hex, computeDisplayTime } from "@/lib/crypto";
import { FramePayload } from "@/lib/queue";
import type { ActionEvent } from "@/lib/types/actions";

export interface Block {
  blockIndex: number;
  blockHash: string;
  parentHash: string;
  imageHash: string;    // hash des pixels finaux (était drawingHash)
  actionsHash: string;  // hash de la séquence d'actions
  drawScore: number;    // Proof-of-Draw score
  deviceId: string;
  artistName: string;
  poolScreen: string;
  validatorIds: string[];
  score: number;
  displayTime: number;
  minedAt: number;
  frameId: string;
}

export interface BlockImagePayload {
  screen: string;
  black?: string;
  red?: string;
  buffer?: string;
}

export interface Candidate {
  candidateId: string;
  deviceId: string;
  artistName: string;
  poolScreen: string;
  payload: FramePayload;
  imageHash: string;         // hash des pixels finaux (était drawingHash)
  actionsHash: string;       // hash de la séquence d'actions
  drawScore: number;         // Proof-of-Draw score
  actionSequence: ActionEvent[]; // séquence complète pour replay + validation
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

// ─── Clés Redis ───────────────────────────────────────────────────────────────

const KEY_HEAD      = "chain:head";
const KEY_LENGTH    = "chain:length";
const KEY_RECENT    = "chain:recent";   // List — 100 derniers hashes (newest first)
const KEY_CANDIDATE = "candidate:current";
const KEY_VOTES     = "candidate:votes";

const blockKey   = (hash: string) => `chain:block:${hash}`;
const imageKey   = (hash: string) => `chain:image:${hash}`;
const actionsKey = (hash: string) => `chain:actions:${hash}`;

const GENESIS_HASH      = "0".repeat(64);
const CANDIDATE_TTL_SEC = parseInt(process.env.CANDIDATE_TTL_SEC ?? "600");
const QUORUM_RATIO      = parseFloat(process.env.QUORUM_RATIO ?? "0.51");
const RECENT_MAX        = 100; // blocs dans chain:recent

// ─── Helpers de migration ─────────────────────────────────────────────────────

/** Corrige les anciens blocs qui ont drawingHash au lieu de imageHash. */
function migrateBlock(raw: any): Block {
  if (raw.drawingHash && !raw.imageHash) {
    raw.imageHash   = raw.drawingHash;
    raw.actionsHash = raw.actionsHash ?? "";
    raw.drawScore   = raw.drawScore   ?? 0;
  }
  return raw as Block;
}

/** Corrige les anciens candidats qui ont drawingHash au lieu de imageHash. */
function migrateCandidate(raw: any): Candidate {
  if (raw.drawingHash && !raw.imageHash) {
    raw.imageHash      = raw.drawingHash;
    raw.actionsHash    = raw.actionsHash    ?? "";
    raw.drawScore      = raw.drawScore      ?? 0;
    raw.actionSequence = raw.actionSequence ?? [];
  }
  return raw as Candidate;
}

// ─── Lecture de la chaîne ────────────────────────────────────────────────────

export async function getChainHead(): Promise<Block | null> {
  const raw = await redis.get(KEY_HEAD);
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return migrateBlock(parsed);
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
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return migrateBlock(parsed);
  } catch {
    return null;
  }
}

export async function getBlockImage(hash: string): Promise<BlockImagePayload | null> {
  const raw = await redis.get(imageKey(hash));
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as BlockImagePayload);
  } catch {
    return null;
  }
}

// ─── Candidat ────────────────────────────────────────────────────────────────

export async function getCurrentCandidate(): Promise<Candidate | null> {
  const raw = await redis.get(KEY_CANDIDATE);
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const c = migrateCandidate(parsed);
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

// ─── Votes ────────────────────────────────────────────────────────────────────

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
  const needed    = Math.ceil(candidate.poolSize * QUORUM_RATIO);
  const quorumReached = voteCount >= Math.max(1, needed);

  return { quorumReached, voteCount, needed };
}

// ─── Finalisation du bloc ────────────────────────────────────────────────────

export async function finalizeBlock(
  candidate: Candidate,
  votes: ValidationVote[],
  frameId: string,
): Promise<Block> {
  const head     = await getChainHead();
  const length   = await getChainLength();
  const parentHash = head?.blockHash ?? GENESIS_HASH;

  const avgScore  = votes.reduce((s, v) => s + v.score, 0) / votes.length;
  const finalScore = (candidate.score + avgScore) / 2;
  const displayTime = computeDisplayTime(finalScore, parentHash);

  const canonical = JSON.stringify({
    parentHash,
    imageHash:   candidate.imageHash,
    actionsHash: candidate.actionsHash,
    deviceId:    candidate.deviceId,
    poolScreen:  candidate.poolScreen,
    validatorIds: votes.map((v) => v.deviceId).sort(),
    score:       finalScore,
    minedAt:     Date.now(),
  });

  const blockHash = await sha256Hex(canonical);

  const block: Block = {
    blockIndex:   length,
    blockHash,
    parentHash,
    imageHash:    candidate.imageHash,
    actionsHash:  candidate.actionsHash,
    drawScore:    candidate.drawScore,
    deviceId:     candidate.deviceId,
    artistName:   candidate.artistName,
    poolScreen:   candidate.poolScreen,
    validatorIds: votes.map((v) => v.deviceId).sort(),
    score:        finalScore,
    displayTime,
    minedAt:      Date.now(),
    frameId,
  };

  // Image à conserver de manière permanente
  const payload = candidate.payload as Record<string, string>;
  const imagePayload: BlockImagePayload = {
    screen: candidate.poolScreen,
    ...(candidate.poolScreen === "eink29bwr"
      ? { black: payload.black, red: payload.red }
      : { buffer: payload.buffer }
    ),
  };

  // Stockage Redis — SANS TTL pour les données de blockchain (permanentes)
  await Promise.all([
    redis.set(KEY_HEAD,           JSON.stringify(block)),          // pas de TTL
    redis.set(blockKey(blockHash), JSON.stringify(block)),         // pas de TTL
    redis.set(imageKey(blockHash), JSON.stringify(imagePayload)),  // pas de TTL
    redis.set(actionsKey(blockHash), JSON.stringify(candidate.actionSequence ?? [])), // pas de TTL
    redis.lpush(KEY_RECENT, blockHash),      // push en tête de liste
    redis.ltrim(KEY_RECENT, 0, RECENT_MAX - 1), // garder les 100 derniers
    redis.set(KEY_LENGTH, String(length + 1)), // pas de TTL
  ]);

  console.log(
    `[chain] BLOC #${length} hash=${blockHash.slice(0, 12)}... score=${finalScore.toFixed(3)} display=${displayTime}s drawScore=${candidate.drawScore}`,
  );

  return block;
}

// ─── Résumé de la chaîne (pour /api/pull) ────────────────────────────────────

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
    blockIndex:  head.blockIndex,
    blockHash:   head.blockHash,
    displayTime: head.displayTime,
    artistName:  head.artistName,
    poolScreen:  head.poolScreen,
    minedAt:     head.minedAt,
  };
}

// ─── Blocs récents pour la home page ─────────────────────────────────────────

export type BlockWithImage = Block & { imagePayload: BlockImagePayload | null };

async function _getRecentBlocks(n: number): Promise<BlockWithImage[]> {
  // Essai 1 : lire la liste chain:recent (blocs minés après la migration)
  const hashes = await redis.lrange<string>(KEY_RECENT, 0, n - 1);

  let blocks: Block[] = [];

  if (hashes && hashes.length > 0) {
    blocks = (
      await Promise.all(hashes.map((h) => getBlockByHash(h)))
    ).filter(Boolean) as Block[];
  }

  // Fallback : chain-walk depuis la tête (pour les blocs antérieurs à la migration)
  if (blocks.length < n) {
    const visited = new Set(blocks.map((b) => b.blockHash));
    let current = blocks.length === 0 ? await getChainHead() : await getBlockByHash(blocks[blocks.length - 1].parentHash);

    while (current && blocks.length < n) {
      if (!visited.has(current.blockHash)) {
        blocks.push(current);
        visited.add(current.blockHash);
      }
      if (current.parentHash === GENESIS_HASH) break;
      current = await getBlockByHash(current.parentHash);
    }
  }

  // Charger les images en parallèle
  const withImages = await Promise.all(
    blocks.map(async (block): Promise<BlockWithImage> => {
      const imagePayload = await getBlockImage(block.blockHash);
      return { ...block, imagePayload };
    }),
  );

  return withImages;
}

/** Version mise en cache pour la home page — revalidée à chaque nouveau bloc. */
export const getRecentBlocksCached = unstable_cache(
  () => _getRecentBlocks(10),
  ["recent-blocks"],
  { revalidate: 60, tags: ["recent-blocks"] },
);
