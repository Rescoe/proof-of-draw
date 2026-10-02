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
import type { Device } from "@/lib/deviceStore";
import { broadcastToDevices } from "@/lib/broadcast";
import { encodeForScreen } from "@/lib/screenEncode";
import { createAnaBlock, saveAnaWorkMeta, type AnaWorkMeta, type AnaWorkSceneMeta } from "@/lib/anaChain";
import { SCREEN_IDS, SCREEN_PROFILES } from "@/lib/screenProfiles";
import { renderPoem, AVATAR_SIZE } from "@/lib/poemRender";
import { parseFeedItem, type ParsedItem } from "@/lib/anaFeedItem";
import { compileSceneArtifacts } from "@/lib/scene/store";
import { isSceneScreen, type ScenePointer } from "@/lib/scene/delivery";
import { renderPosterGray } from "@/lib/scene/engine";
import type { ScenePackageProfile } from "@/lib/scene/package";

const ANA_API_URL      = process.env.ANA_API_URL;
const ANA_FEED_SECRET  = process.env.ANA_ART_FEED_SECRET;
const CHECK_DEBOUNCE_SEC = parseInt(process.env.ANA_FEED_CHECK_DEBOUNCE_SEC ?? "60");
const FETCH_TIMEOUT_MS = 5000;

const KEY_INGESTED   = "chain:ana:ingested";     // Set<itemId> — permanent, dedup only
const KEY_META_SYNCED = "chain:ana:meta-synced"; // Set<itemId> — contexte de l'œuvre déjà écrit
const KEY_SCREEN_DONE = "chain:ana:screen-done"; // Set<`${itemId}:${screen}`> — écrans déjà ingérés (reprise sans doublon)
const KEY_CHECK_LOCK = "chain:ana:last-checked"; // TTL gate

// Every registered screen type is encodable for ANA art (screenEncode.ts's
// encodeForScreen handles all of them, including tft18 — rendered as plain
// black-ink-on-white RGB565 since ANA line art carries no color channel).
const ANA_ENCODABLE_SCREENS = SCREEN_IDS;

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

/** État scene-v1 pour la galerie : manifeste rejouable si valide, motifs sinon, et le repli reçu par les appareils sans scene-v1. */
function toSceneMeta(item: ParsedItem): AnaWorkSceneMeta | undefined {
  if (!item.scene) return undefined;
  const fallback: AnaWorkSceneMeta["fallback"] = item.image ? "capture" : item.scene.status === "ok" ? "poster" : "none";
  return item.scene.status === "ok"
    ? { status: "ok", manifest: item.scene.scene, sceneHash: item.scene.sceneHash, fallback }
    : { status: "invalid", errors: item.scene.errors, fallback };
}

function toWorkMeta(item: ParsedItem, avatarBits?: string | null): AnaWorkMeta {
  return {
    ...(item.context as Partial<AnaWorkMeta>),
    avatar: avatarBits ? packBits(avatarBits) : undefined,
    text: item.poem?.text, artForm: item.poem?.artForm,
    sourceId: item.id, kind: item.kind, agentTokenId: item.agentTokenId, agentName: item.agentName,
    title: item.title, publishedAt: item.publishedAt,
    scene: toSceneMeta(item),
  };
}

// Les e-ink ne reçoivent jamais de scène : poster frame calculée par le moteur de référence (contrat note 37 §1).
const EINK_SCREENS = new Set<string>(["eink27bw", "eink29bwr"]);

async function fetchAnaFeed(): Promise<unknown[]> {
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
    const data = await res.json().catch(() => null) as { items?: unknown[] } | null;
    const items = Array.isArray(data?.items) ? data.items : [];
    // Visible dans les logs Vercel : un feed vide ou mal formé n'est plus silencieux
    console.log(`[anaFeed] HTTP ${res.status} — ${items.length} item(s)${data?.items ? "" : " (réponse sans champ items)"}`);
    return items;
  } catch (e) {
    console.error("[anaFeed] fetch failed:", e);
    return [];
  }
}

/**
 * Encode l'œuvre pour chaque type d'écran, diffuse aux appareils opt-in et archive un bloc par écran.
 * Reprise sans doublon : chaque écran terminé est noté (KEY_SCREEN_DONE) ; en cas d'échec en cours de route,
 * l'exception remonte et l'item sera retenté au prochain contrôle sans re-créer les blocs déjà écrits.
 */
async function ingestItem(item: ParsedItem, optIn: Device[]): Promise<void> {
  // Portrait du Normie auteur (poèmes) : API des Normies, repli = pas de cadre
  let avatar: Uint8Array | undefined;
  if (item.poem) {
    const bits = await normieBits(item.agentTokenId);
    avatar = bits ? bitsToGray(bits) : undefined;
  }

  const agentName = item.agentName ?? `Normie #${item.agentTokenId}`;
  const done = (await redis.smismember(KEY_SCREEN_DONE, ANA_ENCODABLE_SCREENS.map((sc) => `${item.id}:${sc}`))) as number[];

  // scene-v1 : paquets compilés UNE fois par (contentHash, profil, classe) — SET NX, idempotent à la reprise.
  // Un échec Redis remonte : l'item sera retenté, jamais marqué ingéré à moitié.
  const sceneOk = item.scene?.status === "ok" ? item.scene : null;
  const pointers: Record<ScenePackageProfile, ScenePointer> | null = sceneOk && item.contentHash
    ? await compileSceneArtifacts(redis, { scene: sceneOk.scene, sceneHash: sceneOk.sceneHash, contentHash: item.contentHash })
    : null;
  // Remplacement par sourceId : une révision (capture puis scène ajoutée) réécrit les blocs au lieu de les dupliquer.
  const generative = item.kind === "generative-capture";

  // Une œuvre = un bloc PAR type d'écran, que des devices l'aient activé ou non
  // (la galerie montre la conversion de chaque œuvre sur tous les écrans) ; seule
  // la diffusion live est réservée aux devices opt-in.
  for (let i = 0; i < ANA_ENCODABLE_SCREENS.length; i++) {
    const screen = ANA_ENCODABLE_SCREENS[i];
    if (done[i]) continue;
    const devices = optIn.filter((d) => d.screens.includes(screen));

    let encoded: ReturnType<typeof encodeForScreen>;
    if (item.poem) {
      // Texte rendu directement à la taille de l'écran (cadre Normie 40×40 + texte condensé)
      const r = renderPoem({ text: item.poem.displayText ?? item.poem.text, title: item.title, avatar }, screen);
      encoded = encodeForScreen(r.pixels, r.w, r.h, screen);
    } else if (sceneOk && (EINK_SCREENS.has(screen) || !item.image)) {
      // e-ink (toujours), ou œuvre sans capture : poster frame du moteur de référence, à la résolution native de l'écran
      const p = SCREEN_PROFILES[screen];
      encoded = encodeForScreen(renderPosterGray(sceneOk.scene, p.width, p.height), p.width, p.height, screen);
    } else {
      const img = item.image!;
      encoded = encodeForScreen(img.gray, img.w, img.h, screen);
    }
    const payload = encoded as Record<string, string>;
    const scenePointer = pointers && isSceneScreen(screen) ? pointers[screen] : undefined;

    await Promise.all([
      broadcastToDevices(devices.map((d) => d.deviceId), screen, payload, {
        workTitle: item.title, drawArtistName: agentName, ...(scenePointer ? { scene: scenePointer } : {}),
      }),
      createAnaBlock({
        sourceId:     `${generative ? item.sourceId : item.id}:${screen}`,
        agentTokenId: item.agentTokenId,
        agentName,
        title:        item.title,
        poolScreen:   screen,
        payload,
        publishedAt:  item.publishedAt,
        upsert:       generative,
      }),
    ]);
    await redis.sadd(KEY_SCREEN_DONE, `${item.id}:${screen}`);
  }
}

/** Runs an ingestion pass unconditionally — for an explicit manual trigger. */
export async function checkAnaFeedNow(): Promise<{ checked: number; ingested: number }> {
  const raw = await fetchAnaFeed();
  const items: ParsedItem[] = [];
  const invalid: string[] = [];
  for (const r of raw) {
    const p = parseFeedItem(r);
    if (p.ok) items.push(p.item);
    else {
      console.warn(`[anaFeed] item ignoré — ${p.reason}`);
      if (p.permanent && r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string") invalid.push((r as { id: string }).id);
    }
  }
  // Items définitivement invalides : marqués pour ne pas être relus à chaque contrôle
  if (invalid.length) await redis.sadd(KEY_INGESTED, invalid[0], ...invalid.slice(1)).catch(() => {});
  if (items.length === 0) return { checked: raw.length, ingested: 0 };

  // Deux commandes pour tout le lot (et non une par item)
  const ids = items.map((it) => it.id);
  const [metaDone, ingestedDone] = await Promise.all([
    redis.smismember(KEY_META_SYNCED, ids) as Promise<number[]>,
    redis.smismember(KEY_INGESTED, ids) as Promise<number[]>,
  ]);

  // Appareils opt-in : lus UNE fois pour toute la passe (2 commandes), jamais par item ni par profil d'écran
  const pending = items.some((_, i) => !ingestedDone[i]);
  const optIn = pending ? await getAnaArtDevices() : [];

  let ingested = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Contexte de l'œuvre (cartel, vote…) : écrit une fois par œuvre — marqué SEULEMENT après réussite,
    // y compris pour celles ingérées avant l'existence de ces champs (rattrapage).
    if (!metaDone[i]) {
      try {
        await saveAnaWorkMeta(toWorkMeta(item, await normieBits(item.agentTokenId)));
        await redis.sadd(KEY_META_SYNCED, item.id);
      } catch (e) { console.error(`[anaFeed] saveAnaWorkMeta ${item.id}:`, e); }
    }
    if (ingestedDone[i]) continue;
    try {
      await ingestItem(item, optIn);
      await redis.sadd(KEY_INGESTED, item.id);   // jamais avant la fin réussie
      ingested++;
      console.log(`[anaFeed] ingéré ${item.kind} « ${item.title}» (${item.id})`);
    } catch (e) {
      console.error(`[anaFeed] ingestion échouée ${item.id} — sera retentée:`, e);
    }
  }
  return { checked: raw.length, ingested };
}

/**
 * Same as checkAnaFeedNow(), but debounced globally — at most one real ANA
 * fetch per ANA_FEED_CHECK_DEBOUNCE_SEC, no matter how many devices/pulls
 * call this concurrently. Safe to call on every /api/pull from an opted-in
 * device: it's a no-op Redis check the rest of the time.
 */
let lastLocalCheck = 0;   // debounce par instance : évite un SET NX Redis à chaque pull d'un appareil opt-in
export async function maybeCheckAnaFeed(): Promise<void> {
  if (!ANA_API_URL || !ANA_FEED_SECRET) return;
  if (Date.now() - lastLocalCheck < CHECK_DEBOUNCE_SEC * 1000) return;
  lastLocalCheck = Date.now();
  const acquired = await redis.set(KEY_CHECK_LOCK, "1", { nx: true, ex: CHECK_DEBOUNCE_SEC });
  if (!acquired) return;
  await checkAnaFeedNow().catch((e) => console.error("[anaFeed] maybeCheckAnaFeed error:", e));
}
