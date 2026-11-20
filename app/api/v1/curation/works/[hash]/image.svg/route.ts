// GET /api/v1/curation/works/{hash}/image.svg[?scale=1..8] — image pixel-art du bloc, servie EN LIGNE (sans téléchargement forcé).
// Même rendu que /api/block-svg ; immuable, donc cache d'un an.

import { NextRequest, NextResponse } from "next/server";
import { getBlockByHash, getBlockImage } from "@/lib/chain";
import { generatePixelSVGFromBuffer } from "@/lib/svgExport";
import { toCurationWork } from "@/lib/curationFeed";

export async function GET(req: NextRequest, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  if (!/^[0-9a-f]{64}$/i.test(hash)) return NextResponse.json({ error: "hash invalide" }, { status: 400 });
  const scale = Math.max(1, Math.min(8, parseInt(req.nextUrl.searchParams.get("scale") ?? "4", 10) || 4));

  const [block, payload] = await Promise.all([getBlockByHash(hash), getBlockImage(hash)]);
  if (!block || !payload || !toCurationWork(block)) return NextResponse.json({ error: "Image introuvable" }, { status: 404 });

  const svg = generatePixelSVGFromBuffer(payload.screen, payload.black, payload.red, payload.buffer, scale);
  if (!svg) return NextResponse.json({ error: "Génération SVG impossible" }, { status: 500 });

  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
