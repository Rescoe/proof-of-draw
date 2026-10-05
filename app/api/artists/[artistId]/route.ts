// app/api/artists/[artistId]/route.ts
// GET /api/artists/:artistId
// Profil public d'un artiste, ses appareils (sans données sensibles), ses blocs
// (dessinés / minés / possédés) et son image de profil. Résolution slug | UUID |
// "esp_{deviceId}" (artiste implicite). Sources : lib/artistDirectory.ts — les mêmes
// que "mon profil" (/api/artist/blocks) et l'annuaire.

import { NextRequest, NextResponse } from "next/server";
import {
  getArtist, getArtistBySlug, getAllDevices, implicitArtistId,
  isImplicitArtistDevice, implicitArtistProfile, type ArtistProfile,
} from "@/lib/deviceStore";
import {
  IMPLICIT_ARTIST_PREFIX, getArtistDeviceIds, getArtistBlocks, getProfileImagePayload,
} from "@/lib/artistDirectory";

export const dynamic = "force-dynamic";

import { ONLINE_MS } from "@/lib/pullBudget";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ artistId: string }> },
) {
  try {
    const { artistId: rawParam } = await params;
    if (!rawParam) {
      return NextResponse.json({ error: "artistId requis" }, { status: 400 });
    }

    const allDevices = await getAllDevices();

    // Artiste implicite : `esp_{deviceId}` = ESP appairé sans profil artiste
    let profile: ArtistProfile | null = null;
    let implicit = false;
    if (rawParam.startsWith(IMPLICIT_ARTIST_PREFIX)) {
      const dev = allDevices.find((d) => implicitArtistId(d.deviceId) === rawParam);
      if (dev && isImplicitArtistDevice(dev)) {
        profile = implicitArtistProfile(dev);
        implicit = true;
      } else if (dev?.artistId) {
        // L'ESP a rejoint un profil entre-temps : rediriger vers celui-ci
        profile = await getArtist(dev.artistId);
      }
    }

    // Résoudre slug OU UUID : essaie le slug d'abord, puis l'UUID
    if (!profile) profile = await getArtistBySlug(rawParam);
    if (!profile) profile = await getArtist(rawParam);
    if (!profile) {
      return NextResponse.json({ error: "Artiste introuvable" }, { status: 404 });
    }

    // Appartenance : profil → appareils vivants + ids historiques ; implicite → l'ESP seul
    const deviceIdSet = implicit
      ? new Set(allDevices.filter((d) => implicitArtistId(d.deviceId) === profile!.artistId).map((d) => d.deviceId))
      : await getArtistDeviceIds(profile.artistId, allDevices);

    const artistDevices = allDevices
      .filter((d) => deviceIdSet.has(d.deviceId))
      .map((d) => ({
        deviceId:   d.deviceId,
        deviceName: d.deviceName,
        screens:    d.screens,
        firmware:   d.firmware,
        isOnline:   Date.now() - d.lastPing < ONLINE_MS,
        framesSent: d.framesSent,
        publicMode: d.publicMode ?? false,
        lastSeen:   d.lastSeen,
      }));

    const [blocks, profileImage] = await Promise.all([
      getArtistBlocks(deviceIdSet, undefined, implicit ? undefined : profile.artistId),
      getProfileImagePayload(profile),
    ]);

    return NextResponse.json(
      {
        profile: {
          artistId:    profile.artistId,
          slug:        profile.slug,
          displayName: profile.displayName,
          bio:         profile.bio,
          profileImageBlockHash: profile.profileImageBlockHash,
          profileImageCrop:      profile.profileImageCrop,
          createdAt:   profile.createdAt,
        },
        profileImage,   // résolu par hash : ne dépend plus de la fenêtre de blocs
        devices: artistDevices,
        blocks,
      },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
    );
  } catch (err) {
    console.error("[/api/artists/:artistId GET]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
