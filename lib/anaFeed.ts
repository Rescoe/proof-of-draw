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
import { createAnaBlock } from "@/lib/anaChain";
import { SCREEN_IDS, type ScreenId } from "@/lib/screenProfiles";

const ANA_API_URL      = process.env.ANA_API_URL;
const ANA_FEED_SECRET  = process.env.ANA_ART_FEED_SECRET;
const CHECK_DEBOUNCE_SEC = parseInt(process.env.ANA_FEED_CHECK_DEBOUNCE_SEC ?? "60");
const FETCH_TIMEOUT_MS = 5000;

const KEY_INGESTED   = "chain:ana:ingested";     // Set<itemId> — permanent, dedup only
const KEY_CHECK_LOCK = "chain:ana:last-checked"; // TTL gate

// tft18 is full-color RGB565 — not applicable to plain B&W ANA line art.
const ANA_ENCODABLE_SCREENS = SCREEN_IDS.filter((s) => s !== "tft18") as ScreenId[];

interface AnaArtFeedItem {
  id:           string;
  kind:         "celebration" | "spontaneous";
  pixels:       string;
  canvasW:      number;
  canvasH:      number;
  title:        string;
  agentTokenId: number;
  agentName?:   string;
  publishedAt:  number;
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
    return Array.isArray(data?.items) ? data.items : [];
  } catch (e) {
    console.error("[anaFeed] fetch failed:", e);
    return [];
  }
}

async function ingestItem(item: AnaArtFeedItem): Promise<void> {
  let rawPixels: Buffer;
  try { rawPixels = Buffer.from(item.pixels, "base64"); }
  catch { console.error(`[anaFeed] item ${item.id}: invalid pixels encoding`); return; }

  if (rawPixels.length !== item.canvasW * item.canvasH) {
    console.error(`[anaFeed] item ${item.id}: pixels length ${rawPixels.length} != canvasW*canvasH ${item.canvasW * item.canvasH}`);
    return;
  }

  const agentName = item.agentName ?? `Normie #${item.agentTokenId}`;

  for (const screen of ANA_ENCODABLE_SCREENS) {
    const devices = await getAnaArtDevices(screen);
    if (devices.length === 0) continue;

    let encoded: ReturnType<typeof encodeForScreen>;
    try {
      encoded = encodeForScreen(new Uint8Array(rawPixels), item.canvasW, item.canvasH, screen);
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
