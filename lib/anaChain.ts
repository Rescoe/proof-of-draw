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
// Une œuvre = 1 bloc par type d'écran (4 aujourd'hui) → 400 blocs ≈ 100 œuvres.
const ANA_RECENT_MAX = 400;

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

// ─── Œuvres (1 œuvre = N blocs, un par type d'écran) ─────────────────────────
// Les blocs d'une même œuvre partagent `deviceId` (ana:{agentTokenId}) et
// `minedAt` (= publishedAt côté ANA) : c'est la clé de regroupement, valable
// aussi pour les blocs créés avant l'introduction de cette notion. Les données
// de contexte de l'œuvre (cartel, brief, vote…) vivent dans un enregistrement
// séparé, écrit/rafraîchi à chaque lecture du feed ANA (voir lib/anaFeed.ts) —
// ce qui permet aussi de les rattraper pour les œuvres déjà ingérées.

export interface AnaWorkMeta {
  sourceId:      string;
  kind:          "celebration" | "spontaneous" | "poem" | "generative-capture";
  agentTokenId:  number;
  agentName?:    string;
  title:         string;
  publishedAt:   number;
  cartelText?:   string;
  artForm?:      string;   // poèmes : haiku | sonnet | poeme | prose | manifeste
  text?:         string;   // poèmes : texte intégral (affiché dans la galerie)
  avatar?:       string;   // visage 40×40 du Normie auteur : 200 octets MSB-first en base64 (1 = encre)
  brief?:        string;
  proposal?:     string;
  memorialKind?: "batch" | "requested" | "milestone";
  burnedTokenIds?: number[];
  totalBurnedHonored?: number;
  voteResult?:   "passed" | "rejected";
  yesCount?:     number;
  noCount?:      number;
  absCount?:     number;
  revisionCount?: number;
  onChainWorkId?: number;
  txHash?:       string;
  collectionAddress?: string;
  decisionNote?: string;
}

const anaMetaKey = (groupKey: string) => `chain:ana:workmeta:${groupKey}`;

export const anaGroupKey = (b: { deviceId: string; minedAt: number }) => `${b.deviceId}:${b.minedAt}`;

export async function saveAnaWorkMeta(meta: AnaWorkMeta): Promise<void> {
  const key = anaGroupKey({ deviceId: `ana:${meta.agentTokenId}`, minedAt: meta.publishedAt });
  await redis.set(anaMetaKey(key), JSON.stringify(meta));
}

export interface AnaWorkScreen {
  screen:        string;
  blockHash:     string;
  blockIndex:    number;
  imagePayload?: BlockImagePayload | null; // absent dans les listes (chargé pour l'aperçu / le détail seulement)
}

export interface AnaWork {
  groupKey:      string;
  title?:        string;
  agentName:     string;
  agentTokenId:  number;
  publishedAt:   number;
  meta:          AnaWorkMeta | null;
  screens:       AnaWorkScreen[];
  previewScreen: string;
}

// Écran d'aperçu préféré : eink27bw partage le ratio 3:2 du canvas ANA (pas de letterbox).
const PREVIEW_ORDER = ["eink27bw", "eink29bwr", "tft18", "oled096"];

function pickPreview(screens: AnaWorkScreen[]): string {
  for (const s of PREVIEW_ORDER) if (screens.some((x) => x.screen === s)) return s;
  return screens[0]?.screen ?? "";
}

function parseJson<T>(raw: unknown): T | null {
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : (raw as T); } catch { return null; }
}

async function groupBlocks(blocks: Block[]): Promise<AnaWork[]> {
  const groups = new Map<string, Block[]>();
  for (const b of blocks) {
    const k = anaGroupKey(b);
    const g = groups.get(k);
    if (g) g.push(b); else groups.set(k, [b]);
  }
  const keys = [...groups.keys()];
  const metaRaws = keys.length ? await redis.mget<unknown[]>(...keys.map(anaMetaKey)) : [];

  return keys.map((groupKey, i): AnaWork => {
    const bs = groups.get(groupKey)!;
    const meta = parseJson<AnaWorkMeta>(metaRaws[i]);
    const first = bs[0];
    const screens: AnaWorkScreen[] = bs
      .map((b) => ({ screen: b.poolScreen, blockHash: b.blockHash, blockIndex: b.blockIndex }))
      .sort((a, b) => PREVIEW_ORDER.indexOf(a.screen) - PREVIEW_ORDER.indexOf(b.screen));
    return {
      groupKey,
      title:        meta?.title ?? first.workTitle,
      agentName:    meta?.agentName ?? first.drawArtistName ?? first.artistName,
      agentTokenId: meta?.agentTokenId ?? (parseInt(first.deviceId.replace("ana:", "")) || 0),
      publishedAt:  first.minedAt,
      meta,
      screens,
      previewScreen: pickPreview(screens),
    };
  }).sort((a, b) => b.publishedAt - a.publishedAt);
}

/** Œuvres récentes (blocs regroupés), SANS images — voir attachAnaPreviews / getAnaWorkDetail. */
export async function getRecentAnaWorks(): Promise<AnaWork[]> {
  const hashes = await redis.lrange<string>(KEY_ANA_RECENT, 0, ANA_RECENT_MAX - 1);
  if (!hashes || hashes.length === 0) return [];
  const raws = await redis.mget<unknown[]>(...hashes.map(anaBlockKey));
  const blocks = raws.map((r) => parseJson<Block>(r)).filter((b): b is Block => !!b);
  return groupBlocks(blocks);
}

/** Charge l'image de l'écran d'aperçu de chaque œuvre fournie (typiquement une page). */
export async function attachAnaPreviews(works: AnaWork[]): Promise<AnaWork[]> {
  return Promise.all(works.map(async (w) => ({
    ...w,
    screens: await Promise.all(w.screens.map(async (s) =>
      s.screen === w.previewScreen ? { ...s, imagePayload: await getAnaBlockImage(s.blockHash) } : s)),
  })));
}

/** Une œuvre avec les images de TOUS ses écrans (vue détail). */
export async function getAnaWorkDetail(groupKey: string): Promise<AnaWork | null> {
  const work = (await getRecentAnaWorks()).find((w) => w.groupKey === groupKey);
  if (!work) return null;
  return {
    ...work,
    screens: await Promise.all(work.screens.map(async (s) => ({ ...s, imagePayload: await getAnaBlockImage(s.blockHash) }))),
  };
}
