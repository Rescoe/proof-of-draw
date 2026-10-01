// lib/anaFeed.ts
// Pulls already-moderated drawings from ANA (GET /api/ana-art/feed) and
// ingests each new one: encodes it per opted-in screen (lib/screenEncode.ts),
// pushes it live to acceptsAnaArt devices (lib/broadcast.ts), and persists it
// as a tagged, permanent block for the "Dessins d'agent IA" gallery
// (lib/anaChain.ts). Deduplicated via a Redis set so re-checking never
// re-ingests the same ANA work/drawing twice.
//
// Deliberately NOT a cron: maybeCheckAnaFeed() is debounced (at most one real
// outbound fetch per ANA_FEED_CHECK_DEBOUNCE_SEC) and called opportunistically
// from app/api/pull/route.ts when an opted-in device pulls — matching this
// project's "no cron, opportunistic checks on read/write" pattern (see
// CLAUDE.md). checkAnaFeedNow() is the same logic without the debounce, for
// an explicit manual trigger (POST /api/ana-art/check).

import { redis } from "@/lib/redis";
import { getAnaArtDevices } from "@/lib/deviceStore";
import { broadcastToDevices } from "@/lib/broadcast";
import { encodeForScreen } from "@/lib/screenEncode";
import { createAnaBlock, saveAnaWorkMeta, type AnaWorkMeta } from "@/lib/anaChain";
import { SCREEN_IDS } from "@/lib/screenProfiles";
import { renderPoem, AVATAR_SIZE } from "@/lib/poemRender";

const ANA_API_URL      = process.env.ANA_API_URL;
const ANA_FEED_SECRET  = process.env.ANA_ART_FEED_SECRET;
const CHECK_DEBOUNCE_SEC = parseInt(process.env.ANA_FEED_CHECK_DEBOUNCE_SEC ?? "60");
const FETCH_TIMEOUT_MS = 5000;

const KEY_INGESTED   = "chain:ana:ingested";     // Set<itemId> — permanent, dedup only
const KEY_META_SYNCED = "chain:ana:meta-synced"; // Set<itemId> — contexte de l'œuvre déjà écrit
const KEY_CHECK_LOCK = "chain:ana:last-checked"; // TTL gate

// Every registered screen type is encodable for ANA art (screenEncode.ts's
// encodeForScreen handles all of them, including tft18 — rendered as plain
// black-ink-on-white RGB565 since ANA line art carries no color channel).
const ANA_ENCODABLE_SCREENS = SCREEN_IDS;

interface AnaArtFeedItem {
  id:           string;
  kind:         "celebration" | "spontaneous" | "poem";
  // celebration / spontaneous : pixels bruts (base64, 1 octet par pixel, 0 = encre)
  pixels?:      string;
  canvasW?:     number;
  canvasH?:     number;
  // poem : texte + (facultatif) portrait 40×40 du Normie auteur, base64, 1 octet par pixel, 0 = encre
  text?:        string;
  artForm?:     string;
  avatar?:      string;
  title:        string;
  agentTokenId: number;
  agentName?:   string;
  publishedAt:  number;
  // Contexte de l'œuvre (optionnel, voir ANA /api/ana-art/feed) → AnaWorkMeta
  cartelText?: string; brief?: string; proposal?: string;
  memorialKind?: "batch" | "requested" | "milestone";
  burnedTokenIds?: number[]; totalBurnedHonored?: number;
  voteResult?: "passed" | "rejected"; yesCount?: number; noCount?: number; absCount?: number;
  revisionCount?: number; onChainWorkId?: number; txHash?: string; collectionAddress?: string;
  decisionNote?: string;
}

// ─── Visage du Normie auteur (40×40) ─────────────────────────────────────────
// API publique des Normies : GET /normie/{id}/pixels → chaîne de 1600 caractères « 0101… » (1 = encre).
const NORMIES_API = process.env.NORMIES_API_BASE_URL ?? "https://api.normies.art";

async function fetchNormieBits(tokenId: number): Promise<string | null> {
  try {
    const res = await fetch(`${NORMIES_API}/normie/${tokenId}/pixels`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const bits = (await res.text()).replace(/[^01]/g, "");
    return bits.length === AVATAR_SIZE * AVATAR_SIZE ? bits : null;
  } catch { return null; }
}

/** 1600 bits → 200 octets MSB-first (même format que le certificat ANA), en base64. */
function packBits(bits: string): string {
  const bytes = Buffer.alloc(bits.length / 8);
  for (let i = 0; i < bytes.length; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i * 8 + j] === "1" ? 1 : 0);
    bytes[i] = b;
  }
  return bytes.toString("base64");
}

/** 1600 bits → bitmap 40×40 niveaux de gris (0 = encre). */
function bitsToGray(bits: string): Uint8Array {
  const g = new Uint8Array(bits.length);
  for (let i = 0; i < bits.length; i++) g[i] = bits[i] === "1" ? 0 : 255;
  return g;
}

const avatarCache = new Map<number, Promise<string | null>>();
function normieBits(tokenId: number): Promise<string | null> {
  let p = avatarCache.get(tokenId);
  if (!p) {
    p = fetchNormieBits(tokenId).then((v) => { if (!v) avatarCache.delete(tokenId); return v; });
    avatarCache.set(tokenId, p);
  }
  return p;
}

function toWorkMeta(item: AnaArtFeedItem, avatarBits?: string | null): AnaWorkMeta {
  return {
    avatar: avatarBits ? packBits(avatarBits) : undefined,
    text: item.text, artForm: item.artForm,
    sourceId: item.id, kind: item.kind, agentTokenId: item.agentTokenId, agentName: item.agentName,
    title: item.title, publishedAt: item.publishedAt,
    cartelText: item.cartelText, brief: item.brief, proposal: item.proposal,
    memorialKind: item.memorialKind, burnedTokenIds: item.burnedTokenIds, totalBurnedHonored: item.totalBurnedHonored,
    voteResult: item.voteResult, yesCount: item.yesCount, noCount: item.noCount, absCount: item.absCount,
    revisionCount: item.revisionCount, onChainWorkId: item.onChainWorkId, txHash: item.txHash,
    collectionAddress: item.collectionAddress, decisionNote: item.decisionNote,
  };
}

async function fetchAnaFeed(): Promise<AnaArtFeedItem[]> {
  if (!ANA_API_URL || !ANA_FEED_SECRET) return [];
  try {
    const res = await fetch(`${ANA_API_URL.replace(/\/$/, "")}/api/ana-art/feed?limit=50`, {
      headers: { "x-feed-secret": ANA_FEED_SECRET },
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[anaFeed] ANA feed returned ${res.status}`);
      return [];
    }
    const data = await res.json().catch(() => null) as { items?: AnaArtFeedItem[] } | null;
    const items = Array.isArray(data?.items) ? data.items : [];
    // Visible dans les logs Vercel : un feed vide ou mal formé n'est plus silencieux
    console.log(`[anaFeed] HTTP ${res.status} — ${items.length} item(s)${data?.items ? "" : " (réponse sans champ items)"}`);
    return items;
  } catch (e) {
    console.error("[anaFeed] fetch failed:", e);
    return [];
  }
}

async function ingestItem(item: AnaArtFeedItem): Promise<void> {
  const isPoem = item.kind === "poem";
  let rawPixels: Buffer = Buffer.alloc(0);
  if (!isPoem) {
    try { rawPixels = Buffer.from(item.pixels ?? "", "base64"); }
    catch { console.error(`[anaFeed] item ${item.id}: invalid pixels encoding`); return; }
    const cw = item.canvasW ?? 0, ch = item.canvasH ?? 0;
    if (rawPixels.length !== cw * ch) {
      console.error(`[anaFeed] item ${item.id}: pixels length ${rawPixels.length} != canvasW*canvasH ${cw * ch}`);
      return;
    }
  } else if (!item.text?.trim()) {
    console.error(`[anaFeed] item ${item.id}: poem without text`);
    return;
  }
  // Portrait du Normie auteur : fourni par le feed (1 octet/pixel) sinon récupéré sur l'API des Normies
  let avatar: Uint8Array | undefined;
  if (isPoem) {
    if (item.avatar) avatar = new Uint8Array(Buffer.from(item.avatar, "base64"));
    if (!avatar || avatar.length !== AVATAR_SIZE * AVATAR_SIZE) {
      const bits = await normieBits(item.agentTokenId);
      avatar = bits ? bitsToGray(bits) : undefined;
    }
  }

  const agentName = item.agentName ?? `Normie #${item.agentTokenId}`;

  // Une œuvre = un bloc PAR type d'écran, que des devices l'aient activé ou non
  // (la galerie montre la conversion de chaque œuvre sur tous les écrans) ; seule
  // la diffusion live est réservée aux devices opt-in.
  for (const screen of ANA_ENCODABLE_SCREENS) {
    const devices = await getAnaArtDevices(screen);

    let encoded: ReturnType<typeof encodeForScreen>;
    try {
      if (isPoem) {
        // Texte rendu directement à la taille de l'écran (cadre Normie 40×40 + texte condensé)
        const r = renderPoem({ text: item.text!, title: item.title, avatar: avatar?.length === AVATAR_SIZE * AVATAR_SIZE ? avatar : undefined }, screen);
        encoded = encodeForScreen(r.pixels, r.w, r.h, screen);
      } else {
        encoded = encodeForScreen(new Uint8Array(rawPixels), item.canvasW!, item.canvasH!, screen);
      }
    } catch (e) {
      console.error(`[anaFeed] encodeForScreen(${screen}) failed for ${item.id}:`, e);
      continue;
    }
    const payload = encoded as Record<string, string>;

    await Promise.all([
      broadcastToDevices(devices.map((d) => d.deviceId), screen, payload, {
        workTitle: item.title, drawArtistName: agentName,
      }),
      createAnaBlock({
        sourceId:     `${item.id}:${screen}`,
        agentTokenId: item.agentTokenId,
        agentName,
        title:        item.title,
        poolScreen:   screen,
        payload,
        publishedAt:  item.publishedAt,
      }),
    ]);
  }
}

/** Runs an ingestion pass unconditionally — for an explicit manual trigger. */
export async function checkAnaFeedNow(): Promise<{ checked: number; ingested: number }> {
  const items = await fetchAnaFeed();
  let ingested = 0;
  for (const item of items) {
    // Contexte de l'œuvre (cartel, vote…) : écrit une fois par œuvre, y compris
    // pour celles ingérées avant l'existence de ces champs (rattrapage).
    if (await redis.sadd(KEY_META_SYNCED, item.id)) {
      await saveAnaWorkMeta(toWorkMeta(item, await normieBits(item.agentTokenId))).catch((e) => console.error("[anaFeed] saveAnaWorkMeta:", e));
    }
    const isNew = await redis.sadd(KEY_INGESTED, item.id);
    if (!isNew) continue; // already ingested on a previous check
    await ingestItem(item);
    ingested++;
  }
  return { checked: items.length, ingested };
}

/**
 * Same as checkAnaFeedNow(), but debounced globally — at most one real ANA
 * fetch per ANA_FEED_CHECK_DEBOUNCE_SEC, no matter how many devices/pulls
 * call this concurrently. Safe to call on every /api/pull from an opted-in
 * device: it's a no-op Redis check the rest of the time.
 */
export async function maybeCheckAnaFeed(): Promise<void> {
  if (!ANA_API_URL || !ANA_FEED_SECRET) return;
  const acquired = await redis.set(KEY_CHECK_LOCK, "1", { nx: true, ex: CHECK_DEBOUNCE_SEC });
  if (!acquired) return;
  await checkAnaFeedNow().catch((e) => console.error("[anaFeed] maybeCheckAnaFeed error:", e));
}
