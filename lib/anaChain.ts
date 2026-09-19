// lib/anaChain.ts
// Persistence for ANA-sourced drawings (burn celebrations, approved
// spontaneous member drawings) — reuses the Block/BlockImagePayload shape
// from lib/chain.ts for gallery-rendering compatibility (BlockFrameCanvas
// etc. don't need to know the difference), but under an entirely separate
// key namespace. Deliberately NOT touching chain:head/chain:length/
// chain:recent or any mining/quorum primitive: these aren't part of the
// human proof-of-draw consensus chain, just a parallel, permanent gallery of
// already-moderated agent content, tagged source:"ana-agent" and never
// mixed into chain:recent (so the main gallery genuinely never shows them).

import { redis } from "@/lib/redis";
import { sha256Hex } from "@/lib/crypto";
import type { Block, BlockImagePayload } from "@/lib/chain";

const KEY_ANA_RECENT = "chain:ana:recent"; // List<blockHash>, newest first
const KEY_ANA_LENGTH = "chain:ana:length";
const ANA_RECENT_MAX = 200;

const anaBlockKey = (hash: string) => `chain:ana:block:${hash}`;
const anaImageKey = (hash: string) => `chain:ana:image:${hash}`;

export interface CreateAnaBlockParams {
  sourceId:    string; // ANA work/drawing id — used for dedup upstream, not stored as the hash
  agentTokenId: number;
  agentName?:  string;
  title?:      string;
  poolScreen:  string;
  payload:     Record<string, string>; // { buffer } or { black, red } — already screen-encoded
  publishedAt: number;
}

export async function createAnaBlock(params: CreateAnaBlockParams): Promise<Block> {
  const length = parseInt((await redis.get<string>(KEY_ANA_LENGTH)) ?? "0");
  const canonical = JSON.stringify({
    sourceId:    params.sourceId,
    poolScreen:  params.poolScreen,
    agentTokenId: params.agentTokenId,
    publishedAt: params.publishedAt,
  });
  const blockHash = await sha256Hex(canonical);

  const block: Block = {
    blockIndex:   length,
    blockHash,
    parentHash:   "0".repeat(64), // ana blocks aren't chained to one another — provenance is the ANA work, not a parent block
    imageHash:    blockHash,
    actionsHash:  "",
    drawScore:    0,
    deviceId:     `ana:${params.agentTokenId}`,
    artistName:   params.agentName ?? `ANA Normie #${params.agentTokenId}`,
    poolScreen:   params.poolScreen,
    validatorIds: [],
    score:        0,
    displayTime:  0,
    minedAt:      params.publishedAt,
    frameId:      "",
    workTitle:    params.title,
    drawArtistName: params.agentName,
    source:       "ana-agent",
  };

  const imagePayload: BlockImagePayload = { screen: params.poolScreen, ...params.payload };

  await Promise.all([
    redis.set(anaBlockKey(blockHash), JSON.stringify(block)),
    redis.set(anaImageKey(blockHash), JSON.stringify(imagePayload)),
    redis.lpush(KEY_ANA_RECENT, blockHash),
    redis.ltrim(KEY_ANA_RECENT, 0, ANA_RECENT_MAX - 1),
    redis.set(KEY_ANA_LENGTH, String(length + 1)),
  ]);

  return block;
}

export async function getAnaBlockByHash(hash: string): Promise<Block | null> {
  const raw = await redis.get(anaBlockKey(hash));
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : (raw as Block); } catch { return null; }
}

export async function getAnaBlockImage(hash: string): Promise<BlockImagePayload | null> {
  const raw = await redis.get(anaImageKey(hash));
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : (raw as BlockImagePayload); } catch { return null; }
}

export type AnaBlockWithImage = Block & { imagePayload: BlockImagePayload | null };

export async function getRecentAnaBlocks(n: number): Promise<AnaBlockWithImage[]> {
  const hashes = await redis.lrange<string>(KEY_ANA_RECENT, 0, n - 1);
  if (!hashes || hashes.length === 0) return [];
  const blocks = (await Promise.all(hashes.map(getAnaBlockByHash))).filter((b): b is Block => !!b);
  return Promise.all(blocks.map(async (block) => ({
    ...block, imagePayload: await getAnaBlockImage(block.blockHash),
  })));
}
