// GET /api/v1/curation/works?before=<blockIndex>&limit=<1..100>
// Contrat public, LECTURE SEULE, pour la curation de Néo-RESCOE (docs/API_CURATION_V1.md).
// Source : les 100 derniers blocs de la chaîne humaine (chain:recent), même base que /api/blocks.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { parseBlocks } from "@/lib/chain";
import { pageWorks } from "@/lib/curationFeed";

const RECENT_MAX = 100;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = parseInt(sp.get("limit") ?? "20", 10);
  const beforeRaw = sp.get("before");
  const before = beforeRaw === null ? null : parseInt(beforeRaw, 10);
  if (before !== null && !Number.isFinite(before)) {
    return NextResponse.json({ error: "before invalide" }, { status: 400 });
  }

  const hashes = await redis.lrange<string>("chain:recent", 0, RECENT_MAX - 1);
  const blocks = hashes && hashes.length ? await parseBlocks(hashes) : [];

  return NextResponse.json(pageWorks(blocks, { before, limit: Number.isFinite(limit) ? limit : 20 }), {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
