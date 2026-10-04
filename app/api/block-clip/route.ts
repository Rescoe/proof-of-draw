// app/api/block-clip/route.ts
// GET /api/block-clip?hash={blockHash} — le clip binaire PBC1 (≤ 9 Ko) d'un bloc d'animation, pour les écrans qui le rangent sur leur carte microSD
// et le jouent en boucle (pointeur `anim` de /api/pull). Donnée PUBLIQUE et IMMUABLE (le bloc ne change jamais) : aucune identité d'appareil
// requise, réponse mise en cache un an par le CDN → un même clip demandé par N écrans ne coûte qu'UNE lecture Redis (1 GET, zéro ensuite).

import { NextRequest, NextResponse } from "next/server";
import { getBlockAnim } from "@/lib/chain";

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return NextResponse.json({ error: "hash invalide" }, { status: 400 });
  const doc = await getBlockAnim(hash);
  if (!doc) return NextResponse.json({ error: "Ce bloc n'est pas une animation" }, { status: 404 });
  const bin = Buffer.from(doc.clip, "base64");
  return new NextResponse(new Uint8Array(bin), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bin.length),
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });
}
