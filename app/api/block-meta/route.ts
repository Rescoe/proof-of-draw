// app/api/block-meta/route.ts — résumé PUBLIC d'un bloc par son hash : numéro, titre, artiste, écran, nature, filiation éventuelle.
// Sert au Remix : afficher « Remix du bloc #N » avec un lien vers l'original, et savoir sur quel type d'écran reprendre une œuvre. Champs immuables seulement (le hash les couvre) → cache CDN 1 jour.
// Coût Redis : 1 GET à la première lecture de chaque bloc, puis le CDN. Aucune écriture.
import { NextRequest, NextResponse } from "next/server";
import { getBlockByHash } from "@/lib/chain";
import { DERIVED_HASH_RE } from "@/lib/derivation";

export async function GET(req: NextRequest) {
  const hash = (req.nextUrl.searchParams.get("hash") ?? "").trim().toLowerCase();
  if (!DERIVED_HASH_RE.test(hash)) return NextResponse.json({ error: "hash invalide" }, { status: 400 });
  const b = await getBlockByHash(hash);
  if (!b) return NextResponse.json({ error: "bloc introuvable" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=30" } });
  return NextResponse.json({
    blockHash: b.blockHash, blockIndex: b.blockIndex, workTitle: b.workTitle ?? null, artist: b.drawArtistName || b.artistName || null,
    poolScreen: b.poolScreen, kind: b.kind ?? "draw", minedAt: b.minedAt, ...(b.derivedFromBlockHash ? { derivedFromBlockHash: b.derivedFromBlockHash } : {}),
  }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600" } });
}
