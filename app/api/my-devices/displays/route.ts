// app/api/my-devices/displays/route.ts
// GET /api/my-devices/displays — détail COMPLET de ce que mes écrans affichent (debug « Mon profil »).
// Réservé au propriétaire : appareils de la session (cookie) ∪ appareils liés à son profil artiste. Contrairement à la
// vue publique, inclut les affichages personnels et tous les champs (frameId, bloc, mode…). 1 MGET, jamais mis en cache.

import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getSession } from "@/lib/session";
import { getDevicesByIds } from "@/lib/deviceStore";
import { getArtistDeviceIds } from "@/lib/artistDirectory";
import { readShownRecords, type DisplayKV } from "@/lib/displayState";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    const ids = new Set<string>(session.deviceIds);
    if (session.artistId) for (const id of await getArtistDeviceIds(session.artistId)) ids.add(id);
    if (ids.size === 0) return NextResponse.json({ displays: {} }, { headers: { "Cache-Control": "private, no-store" } });

    const devices = (await getDevicesByIds([...ids])).filter((d): d is NonNullable<typeof d> => !!d);
    const pairs = devices.flatMap((d) => d.screens.map((screen) => ({ deviceId: d.deviceId, screen })));
    const displays = await readShownRecords(redis as unknown as DisplayKV, pairs);
    return NextResponse.json({ displays }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[my-devices/displays]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
