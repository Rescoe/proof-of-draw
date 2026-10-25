// app/api/blocks/route.ts
// Block explorer : TOUTE la chaîne canonique (de la tête au bloc #0), filtre texte/écran/nature + pagination.
// La chaîne est parcourue par les `parentHash` depuis chain:head (lib/chainWalk.ts, mise en cache par hash de tête) : ni chain:recent comme source exhaustive, ni SCAN.
// Les images ne sont lues que pour la page demandée (1 MGET).

import { NextRequest, NextResponse } from "next/server";
import { getBlockImages, getCanonicalChain, BlockWithImage } from "@/lib/chain";
import { selectPage } from "@/lib/chainWalk";

export async function GET(req: NextRequest) {
  const url    = new URL(req.url);
  const q      = url.searchParams.get("q")?.trim() ?? "";
  const screen = url.searchParams.get("screen")?.trim() ?? "";
  const kind   = url.searchParams.get("kind")?.trim() ?? "";   // "animation" | "draw" | "" (tout)
  const page   = Math.max(1, parseInt(url.searchParams.get("page") ?? "1") || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20") || 20));

  const chain = await getCanonicalChain();
  if (chain.blocks.length === 0) {
    return NextResponse.json({ blocks: [], total: 0, page, limit, pages: 0 });
  }

  const sel = selectPage(chain.blocks, { q, screen, kind, page, limit });

  // Images uniquement pour la page courante
  const images = await getBlockImages(sel.blocks.map((b) => b.blockHash));   // 1 seul MGET
  const withImages: BlockWithImage[] = sel.blocks.map((block, i) => ({ ...block, imagePayload: images[i] }));

  return NextResponse.json(
    { blocks: withImages, total: sel.total, page: sel.page, limit: sel.limit, pages: sel.pages },
    {
      headers: {
        // Cache côté CDN 30 s — les blocs sont presque immuables
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    },
  );
}
