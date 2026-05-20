// app/api/artist/blocks/route.ts
// GET /api/artist/blocks
// Retourne les blocs liés aux devices de la session (artiste OU mineur).
// Max 12 blocs les plus récents, triés par minedAt DESC.

import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getBlockByHash, getBlockImage } from "@/lib/chain";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (session.deviceIds.length === 0) {
      return NextResponse.json({ blocks: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const deviceSet = new Set(session.deviceIds);

    // Lire les 100 derniers hashes de la chaîne
    const hashes = await redis.lrange<string>("chain:recent", 0, 99);
    if (!hashes || hashes.length === 0) {
      return NextResponse.json({ blocks: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }

    // Charger les blocs, filtrer par deviceId (artiste) OU minerDeviceId (validateur décisif)
    const results = await Promise.all(hashes.map(async (hash: string) => {
      try {
        const b = await getBlockByHash(hash);
        if (!b) return null;

        const isArtist = deviceSet.has(b.deviceId);
        const isMiner  = !!b.minerDeviceId && deviceSet.has(b.minerDeviceId);
        if (!isArtist && !isMiner) return null;

        const img = await getBlockImage(b.imageHash);
        // On inclut le bloc même si l'image est manquante (rare) pour ne pas fausser les stats
        return { ...b, imagePayload: img ?? null };
      } catch { return null; }
    }));

    const blocks = results
      .filter(Boolean)
      .sort((a, b) => (b!.minedAt ?? 0) - (a!.minedAt ?? 0))
      .slice(0, 12);

    return NextResponse.json(
      { blocks },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (err) {
    console.error("[/api/artist/blocks]", err);
    return NextResponse.json({ blocks: [] }, { status: 500 });
  }
}
