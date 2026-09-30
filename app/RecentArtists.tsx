// app/RecentArtists.tsx
// Bandeau "Derniers artistes inscrits" — Server Component, affiché sous la
// galerie des blocs minés sur la page d'accueil. Donne de la visibilité aux
// artistes récemment enregistrés (10 plus récents) + lien vers l'annuaire complet.

import { listArtists, getProfileImagePayload } from "@/lib/artistDirectory";
import type { BlockImagePayload } from "@/lib/chain";
import { RecentArtistsClient } from "./RecentArtistsClient";

export interface RecentArtistSummary {
  artistId:    string;
  slug?:       string;
  displayName: string;
  profileImageBlockHash?: string;
  profileImageCrop?: { cx: number; cy: number; zoom: number };
  imagePayload: BlockImagePayload | null;
  createdAt:   number;
}

export async function RecentArtists() {
  let artists: RecentArtistSummary[] = [];
  try {
    // Source unique (lib/artistDirectory) : profils + ESP appairés sans profil,
    // triés du plus récent au plus ancien — même liste que l'annuaire /artists.
    const top = (await listArtists()).map((e) => e.profile).slice(0, 10);
    if (top.length === 0) return null;

    artists = await Promise.all(top.map(async (p) => ({
      artistId:              p.artistId,
      slug:                  p.slug,
      displayName:           p.displayName,
      profileImageBlockHash: p.profileImageBlockHash,
      profileImageCrop:      p.profileImageCrop,
      imagePayload:          await getProfileImagePayload(p),
      createdAt:             p.createdAt,
    })));
  } catch {
    return null;
  }

  if (artists.length === 0) return null;

  return <RecentArtistsClient artists={artists} />;
}
