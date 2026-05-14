// app/api/pull/route.ts
// Inchangé fonctionnellement — le pull lit frame:{deviceId} comme avant.
// Le broadcast depuis draw/route.ts garantit que frame:{deviceId} existe pour
// tous les ESPs de la pool quand un dessin est soumis.
//
// Rate limit strict côté serveur — ne pas faire confiance au firmware
// Fenêtre : 15 minutes, max 2 pulls autorisés
// = cohérent avec rotation des œuvres toutes les 15min
// Un ESP qui pull plus souvent est ignoré jusqu'à la prochaine fenêtre

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { getFrameForDevice } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";

const PULL_WINDOW_SEC = parseInt(process.env.PULL_WINDOW_SEC        ?? "900");
const PULL_MAX        = parseInt(process.env.PULL_LIMIT_PER_WINDOW  ?? "2");

export async function GET(req: NextRequest) {
  const ip       = getIP(req);
  const deviceId = new URL(req.url).searchParams.get("deviceId");

  if (!deviceId)
    return NextResponse.json({ error: "deviceId requis" }, { status: 400 });

  // ── 1. Blacklist (1 read Redis) ───────────────────────────────────────────
  if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

  // ── 2. Rate limit fenêtre glissante (1 write Redis) ──────────────────────
  const rlKey = `rl:pull:${deviceId}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, PULL_WINDOW_SEC);

  if (count > PULL_MAX) {
    const ttl = await redis.ttl(rlKey);

    // Auto-blacklist si vraiment abusif (10× la limite)
    if (count >= PULL_MAX * 10) {
      await redis.set(`bl:dev:${deviceId}`, "1", {
        ex: parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800"),
      });
      console.warn(`[/api/pull] auto-blacklist device=${deviceId}`);
    }

    return NextResponse.json(
      { error: "Trop de requêtes", retryAfter: ttl },
      { status: 429, headers: { "Retry-After": String(ttl) } }
    );
  }

  // ── 3. Device + frame en parallèle (2 reads Redis simultanés) ────────────
  const [device, stored] = await Promise.all([
    getDevice(deviceId),
    getFrameForDevice(deviceId, []),
  ]);

  if (!device) {
    console.warn(`[/api/pull] device inconnu: ${deviceId}`);
    return NextResponse.json({ error: "device inconnu" }, { status: 404 });
  }

  // Mise à jour lastPing fire-and-forget (1 write async, ne bloque pas)
  redis.set(
    `device:${deviceId}`,
    JSON.stringify({ ...device, lastSeen: Date.now(), lastPing: Date.now() }),
    { ex: 48 * 3600 }
  );

  if (!stored) {
    return NextResponse.json({ frame: null });
  }

  console.log(`[/api/pull] frame → device=${deviceId} frameId=${stored.frameId}`);

  return NextResponse.json({
    frame: { ...stored.payload, frameId: stored.frameId },
  });
}