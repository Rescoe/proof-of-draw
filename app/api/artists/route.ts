// app/api/artists/route.ts
// GET /api/artists — liste publique des artistes (profils + ESP appairés sans profil).
// Source unique : lib/artistDirectory.ts (listArtists). Pas de données sensibles.

import { NextResponse } from "next/server";
import { listArtists } from "@/lib/artistDirectory";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const artists = (await listArtists()).map(({ profile: p, deviceCount, implicit }) => ({
      artistId:    p.artistId,
      implicit,                      // true = ESP sans profil artiste (pas encore de fiche créée)
      slug:        p.slug,
      displayName: p.displayName,
      bio:         p.bio,
      profileImageBlockHash: p.profileImageBlockHash,
      profileImageCrop: p.profileImageCrop,
      createdAt:   p.createdAt,
      deviceCount,
    }));

    return NextResponse.json(
      { artists },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    console.error("[/api/artists GET]", err);
    return NextResponse.json({ artists: [] }, { status: 500 });
  }
}
