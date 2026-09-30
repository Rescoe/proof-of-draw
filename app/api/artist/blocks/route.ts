// app/api/artist/blocks/route.ts
// GET /api/artist/blocks — blocs de "mon profil".
// MÊME définition que la fiche publique (/api/artists/[id]) : appareils du profil
// (vivants ∪ ids historiques) via lib/artistDirectory.ts. Sans profil, on retombe
// sur les appareils de la session.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAllDevices } from "@/lib/deviceStore";
import {
  getArtistDeviceIds, getArtistBlocks, resolveArtistIdForDevices, getProfileImagePayload,
} from "@/lib/artistDirectory";
import { getArtist } from "@/lib/deviceStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    const headers = { "Cache-Control": "private, no-store, max-age=0" };
    const devices = await getAllDevices();

    // Profil : cookie d'abord, sinon celui d'un des appareils de la session
    let artistId: string | null = null;
    if (session.artistId && (await getArtist(session.artistId))) artistId = session.artistId;
    if (!artistId) artistId = await resolveArtistIdForDevices(session.deviceIds, devices);

    const deviceIds = artistId
      ? await getArtistDeviceIds(artistId, devices)
      : new Set(session.deviceIds);

    const [blocks, profile] = await Promise.all([
      getArtistBlocks(deviceIds),
      artistId ? getArtist(artistId) : Promise.resolve(null),
    ]);
    const profileImage = profile ? await getProfileImagePayload(profile) : null;

    return NextResponse.json({ blocks, profileImage }, { headers });
  } catch (err) {
    console.error("[/api/artist/blocks]", err);
    return NextResponse.json({ blocks: [] }, { status: 500 });
  }
}
