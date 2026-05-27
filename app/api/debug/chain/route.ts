// app/api/debug/chain/route.ts
// Diagnostic léger : état courant de la chaîne + file d'attente + devices actifs.
// Protégé par INTERNAL_API_SECRET (header x-internal-secret OU query ?secret=...).
// Usage : GET /api/debug/chain?secret=<INTERNAL_API_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getChainHead, getChainLength, getCurrentCandidate, getVotes } from "@/lib/chain";
import { getGlobalActiveCount } from "@/lib/deviceStore";
import { getQueueLength } from "@/lib/drawQueue";

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Auth simple — header ou query param
  const url    = new URL(req.url);
  const secret = req.headers.get("x-internal-secret") ?? url.searchParams.get("secret") ?? "";

  if (!INTERNAL_SECRET) {
    return NextResponse.json(
      { error: "INTERNAL_API_SECRET non configuré — c'est probablement la cause du problème !", secretConfigured: false },
      { status: 500 },
    );
  }
  if (secret !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Non autorisé — passez ?secret=<INTERNAL_API_SECRET> dans l'URL" }, { status: 401 });
  }

  try {
    const [chainHead, chainLength, candidate, voteMap, activeCount, queueLen, recentHashes] =
      await Promise.all([
        getChainHead(),
        getChainLength(),
        getCurrentCandidate(),
        getVotes(),
        getGlobalActiveCount(),
        getQueueLength(),
        redis.lrange<string>("chain:recent", 0, 4),
      ]);

    // Devices actifs (IDs + lastPing)
    const allIds = (await redis.smembers("devices:all")) as string[];
    const devValues = allIds.length > 0
      ? await redis.mget<(string | null)[]>(...allIds.map((id) => `device:${id}`))
      : [];
    const now = Date.now();
    const devSummary = allIds.map((id, i) => {
      const raw = devValues[i];
      if (!raw) return { id, status: "key_expired" };
      try {
        const d = typeof raw === "string" ? JSON.parse(raw) : raw as Record<string, unknown>;
        const ping = (d.lastPing as number) ?? 0;
        const age  = Math.round((now - ping) / 1000);
        return {
          id,
          lastPingAgo: `${age}s`,
          active: age < 1800,
          screen: (d.screens as string[])?.[0] ?? "?",
        };
      } catch {
        return { id, status: "parse_error" };
      }
    });

    return NextResponse.json({
      secretConfigured: true,
      chain: {
        headIndex:  chainHead?.blockIndex ?? null,
        headHash:   chainHead?.blockHash?.slice(0, 12) ?? null,
        chainLength,
        recentHashes: recentHashes.map((h) => h.slice(0, 12)),
      },
      candidate: candidate
        ? {
            candidateId:  candidate.candidateId.slice(0, 8),
            poolSize:     candidate.poolSize,
            expiresIn:    Math.ceil((candidate.expiresAt - now) / 1000),
            voteCount:    voteMap ? Object.keys(voteMap.votes).length : 0,
            needed:       Math.max(1, Math.ceil(candidate.poolSize * 0.51)),
          }
        : null,
      activeDeviceCount: activeCount,
      devices: devSummary,
      drawQueueLength: queueLen,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
