// app/RecentArtists.tsx
// Bandeau "Derniers artistes inscrits" — Server Component, affiché sous la
// galerie des blocs minés sur la page d'accueil. Donne de la visibilité aux
// artistes récemment enregistrés (10 plus récents) + lien vers l'annuaire complet.

import { redis } from "@/lib/redis";
import { getArtist, ArtistProfile } from "@/lib/deviceStore";
import { getBlockImage, BlockImagePayload } from "@/lib/chain";
import { RecentArtistsClient } from "./RecentArtistsClient";

export interface RecentArtistSummary {
  artistId:    string;
  displayName: string;
  profileImageBlockHash?: string;
  profileImageCrop?: { cx: number; cy: number; zoom: number };
  imagePayload: BlockImagePayload | null;
  createdAt:   number;
}

export async function RecentArtists() {
  let artists: RecentArtistSummary[] = [];
  try {
    const artistIds = (await redis.smembers("artists:all")) as string[];
    if (!artistIds || artistIds.length === 0) return null;

    const profiles = await Promise.all(artistIds.map((id) => getArtist(id)));
    const top = profiles
      .filter((p): p is ArtistProfile => p !== null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10);

    artists = await Promise.all(top.map(async (p) => ({
      artistId:              p.artistId,
      displayName:           p.displayName,
      profileImageBlockHash: p.profileImageBlockHash,
      profileImageCrop:      p.profileImageCrop,
      imagePayload:          p.profileImageBlockHash
        ? (await getBlockImage(p.profileImageBlockHash)) ?? null
        : null,
      createdAt:             p.createdAt,
    })));
  } catch {
    return null;
  }

  if (artists.length === 0) return null;

  return <RecentArtistsClient artists={artists} />;
}
