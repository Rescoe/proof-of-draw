// app/api/block-anim/route.ts
// GET /api/block-anim?hash={blockHash}
// Animation d'un bloc miné : clip PBC1 (base64), empreinte et score de CHAQUE image, racine. Stocké sous chain:anim:{blockHash}
// (permanent, écrit par finalizeBlock). Les blocs sont immuables : cache CDN long. 1 GET Redis par défaut-de-cache.

import { NextRequest, NextResponse } from "next/server";
import { getBlockAnim } from "@/lib/chain";

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return NextResponse.json({ error: "hash invalide" }, { status: 400 });
  const anim = await getBlockAnim(hash);
  if (!anim) return NextResponse.json({ error: "Ce bloc n'est pas une animation" }, { status: 404 });
  return NextResponse.json({ anim }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600" } });
}
