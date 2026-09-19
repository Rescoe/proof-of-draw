// app/api/blocks-ana/route.ts
// Même principe que app/api/blocks/route.ts (recherche texte + pagination),
// mais lit chain:ana:recent au lieu de chain:recent — les dessins d'agent IA
// (célébrations de burn, dessins normies spontanés) vivent dans un index
// entièrement séparé, voir lib/anaChain.ts.

import { NextRequest, NextResponse } from "next/server";
import { getRecentAnaBlocks, type AnaBlockWithImage } from "@/lib/anaChain";

const ANA_RECENT_MAX = 200;

function matchesQuery(block: AnaBlockWithImage, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    block.blockHash.toLowerCase().startsWith(ql) ||
    block.artistName?.toLowerCase().includes(ql) ||
    (block.drawArtistName ?? "").toLowerCase().includes(ql) ||
    (block.workTitle ?? "").toLowerCase().includes(ql) ||
    String(block.blockIndex) === q.trim()
  );
}

export async function GET(req: NextRequest) {
  const url    = new URL(req.url);
  const q      = url.searchParams.get("q")?.trim() ?? "";
  const screen = url.searchParams.get("screen")?.trim() ?? "";
  const page   = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));

  let blocks = await getRecentAnaBlocks(ANA_RECENT_MAX);
  if (q)      blocks = blocks.filter((b) => matchesQuery(b, q));
  if (screen) blocks = blocks.filter((b) => b.poolScreen === screen);

  blocks.sort((a, b) => b.blockIndex - a.blockIndex);

  const total    = blocks.length;
  const pages    = Math.ceil(total / limit) || 1;
  const safePage = Math.min(page, pages);
  const paged    = blocks.slice((safePage - 1) * limit, safePage * limit);

  return NextResponse.json(
    { blocks: paged, total, page: safePage, limit, pages },
    { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=60" } },
  );
}
