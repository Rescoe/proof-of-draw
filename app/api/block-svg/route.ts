// app/api/block-svg/route.ts
// Sert le SVG pixel-art d'un bloc validé, téléchargeable directement.
// GET /api/block-svg?hash=<blockHash>[&scale=2]

import { NextRequest, NextResponse } from "next/server";
import { getBlockByHash, getBlockImage } from "@/lib/chain";
import { generatePixelSVGFromBuffer } from "@/lib/svgExport";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const url   = new URL(req.url);
  const hash  = url.searchParams.get("hash");
  const scale = Math.max(1, Math.min(8, parseInt(url.searchParams.get("scale") ?? "2")));

  if (!hash || hash.length < 10) {
    return NextResponse.json({ error: "hash invalide" }, { status: 400 });
  }

  const [block, imagePayload] = await Promise.all([
    getBlockByHash(hash),
    getBlockImage(hash),
  ]);

  if (!block || !imagePayload) {
    return NextResponse.json({ error: "Bloc introuvable" }, { status: 404 });
  }

  const svg = generatePixelSVGFromBuffer(
    imagePayload.screen,
    imagePayload.black,
    imagePayload.red,
    imagePayload.buffer,
    scale,
  );

  if (!svg) {
    return NextResponse.json({ error: "Génération SVG impossible" }, { status: 500 });
  }

  const filename = `pod-bloc-${block.blockIndex}-${hash.slice(0, 8)}.svg`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=31536000, immutable", // SVG permanent = cacheable 1 an
    },
  });
}
