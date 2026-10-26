// lib/circlesRedis.ts — adaptateur Upstash de `CircleKV` (lib/circles.ts) + enveloppe commune des routes /api/circles. SEUL fichier (avec ces routes) autorisé à importer lib/circles (testé).
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getSession } from "@/lib/session";
import { resolveSessionArtist } from "@/lib/artistDirectory";
import { getArtist } from "@/lib/deviceStore";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";
import { CircleError, type ArtistLookup, type CircleKV, type Clock, type Me } from "@/lib/circles";

// Upstash désérialise automatiquement les valeurs JSON : on remet toujours une CHAÎNE.
const str = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));

export const upstashKV: CircleKV = {
  async get(k) { return str(await redis.get(k)); },
  async set(k, v, exSec) { if (exSec) await redis.set(k, v, { ex: exSec }); else await redis.set(k, v); },
  async del(...ks) { if (ks.length) await redis.del(...ks); },
  async sadd(k, m) { await redis.sadd(k, m); },
  async srem(k, m) { await redis.srem(k, m); },
  async smembers(k) { return ((await redis.smembers(k)) as unknown[]).map((x) => String(x)); },
  async hset(k, f, v) { await redis.hset(k, { [f]: v }); },
  async hget(k, f) { return str(await redis.hget(k, f)); },
  async hdel(k, f) { await redis.hdel(k, f); },
  async hgetall(k) {
    const raw = (await redis.hgetall(k)) as Record<string, unknown> | null;
    const out: Record<string, string> = {};
    for (const [f, v] of Object.entries(raw ?? {})) { const s = str(v); if (s !== null) out[f] = s; }
    return out;
  },
  async lpush(k, v) { await redis.lpush(k, v); },
  async ltrim(k, a, b) { await redis.ltrim(k, a, b); },
  async lrange(k, a, b) { return ((await redis.lrange(k, a, b)) as unknown[]).map((x) => str(x) ?? ""); },
  async expire(k, sec) { await redis.expire(k, sec); },
  async incr(k, windowSec) {
    const r = await redis.pipeline().incr(k).expire(k, windowSec, "NX").exec();
    return Number(r[0]);
  },
};

export const realClock: Clock = { now: () => Date.now(), newId: () => crypto.randomUUID().replace(/-/g, "").slice(0, 20) };
export const artistLookup: ArtistLookup = async (id) => { const p = await getArtist(id); return p ? { artistId: p.artistId, displayName: p.displayName } : null; };

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/** Lit un corps JSON borné (2 Ko) ; null si absent ; lève 400 si illisible ou trop gros. */
export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 2000) throw new CircleError(413, "too_large", "Requête trop volumineuse.");
  if (!text.trim()) return {};
  try { const b = JSON.parse(text); return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}; }
  catch { throw new CircleError(400, "bad_json", "JSON invalide."); }
}

/** Enveloppe commune : IP bannie → 403 ; pas de profil artiste dans la session → 401 ; CircleError → son statut ; réponses jamais mises en cache. */
export async function circleRoute(req: NextRequest, run: (ctx: { me: Me; kv: CircleKV }) => Promise<unknown>, okStatus = 200): Promise<NextResponse> {
  try {
    if (await isBlacklisted(getIP(req))) return forbidden("Accès refusé");
    const profile = await resolveSessionArtist(await getSession());
    if (!profile) return json({ error: "Les cercles sont réservés aux artistes ayant un profil : connecte un écran d'abord.", code: "no_profile" }, 401);
    const result = await run({ me: { artistId: profile.artistId, displayName: profile.displayName }, kv: upstashKV });
    return json(result === undefined ? { ok: true } : result, okStatus);
  } catch (e) {
    if (e instanceof CircleError) return json({ error: e.message, code: e.code }, e.status);
    console.error("[/api/circles]", e);
    return json({ error: "Erreur serveur", code: "server_error" }, 500);
  }
}
