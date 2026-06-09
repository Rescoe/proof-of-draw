// app/api/artist/join/route.ts
// POST /api/artist/join  { code: "XXXX-XXXX" }
// Valide le code de liaison, lie tous les devices de la session au profil artiste
// cible, et met à jour le cookie de session avec l'artistId.
//
// Retour : { ok: true, profile: ArtistProfile }

import { NextRequest, NextResponse } from "next/server";
import {
  consumeLinkCode,
  getArtist,
  linkDeviceToArtist,
  setArtistName,
} from "@/lib/deviceStore";
import { getSession, setArtistIdInSession } from "@/lib/session";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

    const raw = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!raw) {
      return NextResponse.json({ error: "Code requis" }, { status: 400 });
    }

    // Normaliser le code : ajouter le tiret si l'utilisateur l'a omis (XXXXXXXX → XXXX-XXXX)
    const code = raw.includes("-") ? raw : `${raw.slice(0, 4)}-${raw.slice(4)}`;

    const artistId = await consumeLinkCode(code);
    if (!artistId) {
      return NextResponse.json(
        { error: "Code invalide ou expiré" },
        { status: 400 },
      );
    }

    const profile = await getArtist(artistId);
    if (!profile) {
      return NextResponse.json({ error: "Profil artiste introuvable" }, { status: 404 });
    }

    const session = await getSession();

    // Lier tous les devices de cette session au profil artiste trouvé
    await Promise.all(
      session.deviceIds.map(async (deviceId) => {
        await linkDeviceToArtist(deviceId, artistId);
        await setArtistName(deviceId, profile.displayName);
      }),
    );

    console.log(
      `[/api/artist/join] fusion session devices=${session.deviceIds.length} → artistId=${artistId}`,
    );

    // Mettre à jour le cookie de session avec l'artistId
    const res = NextResponse.json(
      { ok: true, profile },
      { headers: { "Cache-Control": "no-store" } },
    );
    await setArtistIdInSession(res, artistId);
    return res;
  } catch (err) {
    console.error("[/api/artist/join POST]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
