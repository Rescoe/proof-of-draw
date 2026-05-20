// app/api/block-image/route.ts
// GET /api/block-image?hash={blockHash}
// Retourne le payload image d'un bloc miné (stocké sous chain:image:{blockHash}).
// Utilisé pour les avatars de profil et les miniatures publiques.

import { NextRequest, NextResponse } from "next/server";
import { getBlockImage } from "@/lib/chain";

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("hash");
  if (!hash || hash.length !== 64) {
    return NextResponse.json({ error: "hash invalide" }, { status: 400 });
  }

  const imagePayload = await getBlockImage(hash);
  if (!imagePayload) {
    return NextResponse.json({ error: "Image introuvable" }, { status: 404 });
  }

  return NextResponse.json(
    { imagePayload },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600" } },
  );
}
