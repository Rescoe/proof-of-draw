// GET /api/network/device-activity?deviceId=dev_xxx
// Retourne l'activité publique on-chain d'un ESP :
//   blocs où il est auteur OU validateur (dans chain:recent)
// Données non-sensibles : pas de MAC, pas de pairCode.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getBlockByHash } from "@/lib/chain";
import type { Block } from "@/lib/chain";

export const dynamic = "force-dynamic";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const MAX_BLOCKS = 20;

type ActivityBlock = {
  blockHash: string;
  blockIndex: number;
  artistName: string;
  poolScreen: string;
  score: number;
  minedAt: number;
  role: "author" | "validator";
  validatorCount: number;
};

export async function GET(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("deviceId");

  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }

  try {
    const hashes = await redis.lrange<string>("chain:recent", 0, 99);

    if (!hashes || hashes.length === 0) {
      return NextResponse.json({
        deviceId, minedCount: 0, validatedCount: 0, totalBlocks: 0, recentActivity: [],
      });
    }

    const blocks = (
      await Promise.all(
        hashes.map(async (hash: string) => {
          try { return await getBlockByHash(hash); } catch { return null; }
        })
      )
    ).filter((b): b is Block => b !== null);

    const relevant = blocks
      .filter((b) => b.deviceId === deviceId || b.validatorIds?.includes(deviceId))
      .sort((a, b) => (b.minedAt ?? 0) - (a.minedAt ?? 0));

    const minedCount     = relevant.filter((b) => b.deviceId === deviceId).length;
    const validatedCount = relevant.filter((b) => b.validatorIds?.includes(deviceId) && b.deviceId !== deviceId).length;

    const recentActivity: ActivityBlock[] = relevant.slice(0, MAX_BLOCKS).map((b) => ({
      blockHash:      b.blockHash,
      blockIndex:     b.blockIndex,
      artistName:     b.artistName,
      poolScreen:     b.poolScreen,
      score:          b.score,
      minedAt:        b.minedAt,
      role:           b.deviceId === deviceId ? "author" : "validator",
      validatorCount: b.validatorIds?.length ?? 0,
    }));

    return NextResponse.json(
      { deviceId, minedCount, validatedCount, totalBlocks: relevant.length, recentActivity },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (err) {
    console.error("[/api/network/device-activity]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
