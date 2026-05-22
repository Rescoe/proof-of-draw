// app/api/block-replay/route.ts
// Retourne les événements de replay pixel-perfect d'un bloc.

import { NextRequest, NextResponse } from "next/server";
import { getBlockReplay, getBlockByHash } from "@/lib/chain";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const hash = new URL(req.url).searchParams.get("hash");
  const BLOCK_HASH_REGEX = /^[a-f0-9]{64}$/;
  if (!hash || !BLOCK_HASH_REGEX.test(hash)) {
    return NextResponse.json({ error: "hash invalide (64 hex chars requis)" }, { status: 400 });
  }

  const [block, replay] = await Promise.all([
    getBlockByHash(hash),
    getBlockReplay(hash),
  ]);

  if (!block) return NextResponse.json({ error: "Bloc introuvable" }, { status: 404 });

  return NextResponse.json({
    replay: replay ?? [],
    podHashEnriched: block.podHashEnriched ?? null,
  });
}
