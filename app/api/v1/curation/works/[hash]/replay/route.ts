// GET /api/v1/curation/works/{hash}/replay — les événements du dessin (traits, couleurs, rythme), tels que la galerie PoD les rejoue.
// Aucune identité d'appareil : seulement la main qui dessine. Immuable → cache d'un jour (le replay peut être posé après le minage).

import { NextRequest, NextResponse } from "next/server";
import { getBlockByHash, getBlockReplay } from "@/lib/chain";
import { toCurationWork } from "@/lib/curationFeed";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  if (!/^[0-9a-f]{64}$/i.test(hash)) return NextResponse.json({ error: "hash invalide" }, { status: 400 });
  const block = await getBlockByHash(hash.toLowerCase());
  if (!block || !toCurationWork(block)) return NextResponse.json({ error: "Œuvre introuvable" }, { status: 404 });
  const replay = await getBlockReplay(hash.toLowerCase());
  if (!replay || replay.length === 0) return NextResponse.json({ error: "Pas de replay pour cette œuvre" }, { status: 404 });
  return NextResponse.json({ version: 1, events: replay }, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400", "Access-Control-Allow-Origin": "*" },
  });
}
