// GET /api/v1/curation/works/{hash}/clip — le clip PBC1 (≤ 9 Ko) d'une animation : toutes les images, leurs délais et leurs couleurs.
// Donnée publique et immuable (le bloc ne change jamais) : cache d'un an, donc un même clip lu par N sites ne coûte qu'UNE lecture Redis.

import { NextRequest, NextResponse } from "next/server";
import { getBlockAnim, getBlockByHash } from "@/lib/chain";
import { toCurationWork } from "@/lib/curationFeed";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  if (!/^[0-9a-f]{64}$/i.test(hash)) return NextResponse.json({ error: "hash invalide" }, { status: 400 });
  const block = await getBlockByHash(hash.toLowerCase());
  if (!block || !toCurationWork(block)) return NextResponse.json({ error: "Œuvre introuvable" }, { status: 404 });
  const doc = block.kind === "animation" ? await getBlockAnim(hash.toLowerCase()) : null;
  if (!doc) return NextResponse.json({ error: "Cette œuvre n'est pas une animation" }, { status: 404 });
  const bin = Buffer.from(doc.clip, "base64");
  return new NextResponse(new Uint8Array(bin), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bin.length),
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
