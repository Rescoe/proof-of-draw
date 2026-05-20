// app/api/artists/[artistId]/route.ts
// GET /api/artists/:artistId
// Retourne le profil public d'un artiste, ses devices (sans données sensibles),
// et ses blocs minés (artiste OU mineur) avec images.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getArtist, getAllDevices } from "@/lib/deviceStore";
import { getBlockByHash, getBlockImage } from "@/lib/chain";

export const dynamic = "force-dynamic";

const BLOCKS_MAX = 24;
const ONLINE_MS  = 10 * 60 * 1000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ artistId: string }> },
) {
  try {
    const { artistId } = await params;
    if (!artistId) {
      return NextResponse.json({ error: "artistId requis" }, { status: 400 });
    }

    const profile = await getArtist(artistId);
    if (!profile) {
      return NextResponse.json({ error: "Artiste introuvable" }, { status: 404 });
    }

    // Devices liés à cet artiste (vue publique sans MAC ni pairCode)
    const allDevices = await getAllDevices();
    const artistDevices = allDevices
      .filter((d) => d.artistId === artistId)
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

    const deviceSet = new Set(artistDevices.map((d) => d.deviceId));

    // Blocs liés à cet artiste depuis chain:recent
    const hashes = await redis.lrange<string>("chain:recent", 0, 99);
    let blocks: unknown[] = [];

    if (hashes && hashes.length > 0) {
      const results = await Promise.all(
        hashes.map(async (hash: string) => {
          try {
            const b = await getBlockByHash(hash);
            if (!b) return null;

            const isArtist = deviceSet.has(b.deviceId);
            const isMiner  = !!b.minerDeviceId && deviceSet.has(b.minerDeviceId);
            if (!isArtist && !isMiner) return null;

            const img = await getBlockImage(b.blockHash);
            return {
              blockHash:      b.blockHash,
              blockIndex:     b.blockIndex,
              imageHash:      b.imageHash,
              workTitle:      b.workTitle,
              artistName:     b.artistName,
              drawArtistName: b.drawArtistName,
              poolScreen:     b.poolScreen,
              score:          b.score,
              drawScore:      b.drawScore,
              minedAt:        b.minedAt,
              displayTime:    b.displayTime,
              validatorIds:   b.validatorIds,
              isArtist,
              isMiner,
              imagePayload:   img ?? null,
            };
          } catch {
            return null;
          }
        }),
      );

      blocks = results
        .filter(Boolean)
        .sort((a: any, b: any) => (b.minedAt ?? 0) - (a.minedAt ?? 0))
        .slice(0, BLOCKS_MAX);
    }

    return NextResponse.json(
      {
        profile: {
          artistId:    profile.artistId,
          displayName: profile.displayName,
          bio:         profile.bio,
          profileImageBlockHash: profile.profileImageBlockHash,
          profileImageCrop:      profile.profileImageCrop,
          createdAt:   profile.createdAt,
        },
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
