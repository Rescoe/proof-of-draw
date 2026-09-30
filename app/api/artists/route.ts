// app/api/artists/route.ts
// GET /api/artists — liste publique des artistes enregistrés
// Retourne les profils avec nombre de devices et nombre de blocs.
// Pas de données sensibles (pas de MAC, pas de pairCode).

import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import {
  getArtist, getAllDevices, ArtistProfile,
  IMPLICIT_ARTIST_PREFIX, isImplicitArtistDevice, implicitArtistProfile,
} from "@/lib/deviceStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Lire tous les artistIds
    const artistIds = ((await redis.smembers("artists:all")) as string[]) ?? [];

    // Charger tous les devices pour compter ceux liés à chaque artiste
    const allDevices = await getAllDevices();
    const devicesByArtist: Record<string, number> = {};
    for (const d of allDevices) {
      if (d.artistId) {
        devicesByArtist[d.artistId] = (devicesByArtist[d.artistId] ?? 0) + 1;
      }
    }

    // Charger les profils artistes
    const profiles = await Promise.all(artistIds.map((id) => getArtist(id)));

    // Artistes implicites : ESP appairés (nom choisi) pas encore rattachés à un profil
    const implicit = allDevices.filter(isImplicitArtistDevice).map(implicitArtistProfile);

    const artists = [...profiles.filter((p): p is ArtistProfile => p !== null), ...implicit]
      .map((p) => ({
        artistId:    p.artistId,
        slug:        p.slug,
        displayName: p.displayName,
        bio:         p.bio,
        profileImageBlockHash: p.profileImageBlockHash,
        profileImageCrop: p.profileImageCrop,
        createdAt:   p.createdAt,
        deviceCount: p.artistId.startsWith(IMPLICIT_ARTIST_PREFIX) ? 1 : (devicesByArtist[p.artistId] ?? 0),
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json(
      { artists },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    console.error("[/api/artists GET]", err);
    return NextResponse.json({ artists: [] }, { status: 500 });
  }
}
