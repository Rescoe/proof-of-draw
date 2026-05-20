// app/api/artist/route.ts
// GET  /api/artist  → retourne le profil artiste de la session courante
// POST /api/artist  → crée ou met à jour le profil artiste, lie tous les devices de session

import { NextRequest, NextResponse } from "next/server";
import {
  getArtistByDevice,
  createOrUpdateArtist,
  linkDeviceToArtist,
  setArtistName,
} from "@/lib/deviceStore";
import { getSession } from "@/lib/session";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET() {
  try {
    const session = await getSession();
    if (session.deviceIds.length === 0) return json({ profile: null });

    // Cherche le profil depuis le premier device de la session
    const profile = await getArtistByDevice(session.deviceIds[0]);
    return json({ profile });
  } catch (err) {
    console.error("[/api/artist GET]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");

    const session = await getSession();
    if (session.deviceIds.length === 0)
      return json({ error: "Aucun device en session" }, 401);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const bio         = typeof body.bio         === "string" ? body.bio.trim()         : undefined;

    if (!displayName)
      return json({ error: "displayName requis" }, 400);

    // Résoudre l'artistId existant (depuis n'importe quel device de la session)
    let existingArtistId: string | undefined;
    for (const deviceId of session.deviceIds) {
      const existing = await getArtistByDevice(deviceId);
      if (existing) { existingArtistId = existing.artistId; break; }
    }

    const profile = await createOrUpdateArtist(displayName, bio, existingArtistId);

    // Lier tous les devices de la session à ce profil + mettre à jour artistName (rétrocompat)
    await Promise.all(
      session.deviceIds.map(async (deviceId) => {
        await linkDeviceToArtist(deviceId, profile.artistId);
        await setArtistName(deviceId, displayName);
      })
    );

    console.log(`[/api/artist] profil upsert artistId=${profile.artistId} devices=${session.deviceIds.length}`);
    return json({ ok: true, profile });
  } catch (err) {
    console.error("[/api/artist POST]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
}
