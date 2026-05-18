// app/api/blocks/route.ts
// Block explorer : récupère les blocs avec filtre texte + pagination.
// Charge jusqu'à 100 blocs depuis chain:recent, filtre en mémoire.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getBlockByHash, getBlockImage, Block, BlockWithImage } from "@/lib/chain";

const RECENT_MAX = 100;

function matchesQuery(block: Block, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    block.blockHash.toLowerCase().startsWith(ql) ||
    block.imageHash.toLowerCase().startsWith(ql) ||
    (block.actionsHash ?? "").toLowerCase().startsWith(ql) ||
    block.artistName?.toLowerCase().includes(ql) ||
    (block.drawArtistName ?? "").toLowerCase().includes(ql) ||
    (block.deviceOwnerName ?? "").toLowerCase().includes(ql) ||
    (block.workTitle ?? "").toLowerCase().includes(ql) ||
    block.deviceId?.toLowerCase().includes(ql) ||
    String(block.blockIndex) === q.trim()
  );
}

export async function GET(req: NextRequest) {
  const url    = new URL(req.url);
  const q      = url.searchParams.get("q")?.trim() ?? "";
  const screen = url.searchParams.get("screen")?.trim() ?? "";
  const page   = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));

  // 1. Lire tous les hashes récents
  const hashes = await redis.lrange<string>("chain:recent", 0, RECENT_MAX - 1);
  if (!hashes || hashes.length === 0) {
    return NextResponse.json({ blocks: [], total: 0, page, limit, pages: 0 });
  }

  // 2. Charger tous les blocs en parallèle
  const rawBlocks = await Promise.all(hashes.map((h) => getBlockByHash(h)));
  let blocks = rawBlocks.filter(Boolean) as Block[];

  // 3. Filtrer
  if (q)      blocks = blocks.filter((b) => matchesQuery(b, q));
  if (screen) blocks = blocks.filter((b) => b.poolScreen === screen);

  // 4. Trier par blockIndex décroissant (le plus récent en premier)
  blocks.sort((a, b) => b.blockIndex - a.blockIndex);

  const total = blocks.length;
  const pages = Math.ceil(total / limit) || 1;
  const safePage = Math.min(page, pages);
  const paged = blocks.slice((safePage - 1) * limit, safePage * limit);

  // 5. Charger les images uniquement pour la page courante
  const withImages: BlockWithImage[] = await Promise.all(
    paged.map(async (block) => {
      const imagePayload = await getBlockImage(block.blockHash);
      return { ...block, imagePayload };
    }),
  );

  return NextResponse.json(
    { blocks: withImages, total, page: safePage, limit, pages },
    {
      headers: {
        // Cache côté CDN 10s — les blocs sont presque immuables
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=60",
      },
    },
  );
}
