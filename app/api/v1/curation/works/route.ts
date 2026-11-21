// GET /api/v1/curation/works?before=<blockIndex>&limit=<1..100>
// Contrat public, LECTURE SEULE, pour la curation de Néo-RESCOE (docs/API_CURATION_V1.md).
// Source : les 100 derniers blocs de la chaîne humaine (chain:recent), puis, avec `from=<hash>`, la chaîne entière vers le passé (parentHash).

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getBlockByHash, parseBlocks } from "@/lib/chain";
import { pageWorks, walkHistory } from "@/lib/curationFeed";

const RECENT_MAX = 100;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = parseInt(sp.get("limit") ?? "20", 10);
  const beforeRaw = sp.get("before");
  const before = beforeRaw === null ? null : parseInt(beforeRaw, 10);
  if (before !== null && !Number.isFinite(before)) {
    return NextResponse.json({ error: "before invalide" }, { status: 400 });
  }

  const from = sp.get("from");
  if (from !== null) {
    if (!/^[0-9a-f]{64}$/i.test(from)) return NextResponse.json({ error: "from invalide" }, { status: 400 });
    const page = await walkHistory(from.toLowerCase(), Number.isFinite(limit) ? limit : 20, getBlockByHash);
    // Un bloc ancien ne change jamais : cache long.
    return NextResponse.json(page, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400", "Access-Control-Allow-Origin": "*" } });
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
