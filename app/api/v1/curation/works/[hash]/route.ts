// GET /api/v1/curation/works/{hash} — une œuvre (bloc) au format du contrat curation v1.

import { NextRequest, NextResponse } from "next/server";
import { getBlockByHash } from "@/lib/chain";
import { toCurationWork, CURATION_API_VERSION } from "@/lib/curationFeed";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  if (!/^[0-9a-f]{64}$/i.test(hash)) return NextResponse.json({ error: "hash invalide" }, { status: 400 });
  const block = await getBlockByHash(hash);
  const work = block ? toCurationWork(block) : null;
  if (!work) return NextResponse.json({ error: "Œuvre introuvable" }, { status: 404 });
  return NextResponse.json({ version: CURATION_API_VERSION, work }, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400", "Access-Control-Allow-Origin": "*" },
  });
}
