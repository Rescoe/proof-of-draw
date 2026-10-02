// app/api/artist/link-code/route.ts
// POST /api/artist/link-code
// Génère un code de liaison temporaire (10 min) permettant à un autre navigateur
// de rejoindre le même profil artiste sans avoir à re-onboarder un ESP.
//
// Corps : {} (vide — l'artistId est résolu depuis la session)
// Retour : { code: "XXXX-XXXX", expiresIn: 600, expiresAt: <timestamp ms> }

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getArtist, getArtistByDevice, createLinkCode, peekLinkCode } from "@/lib/deviceStore";
import { getIP, isBlacklisted, forbidden, checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { normalizeLinkCode } from "@/lib/linkCode";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");

    const session = await getSession();

    // Résoudre l'artistId : cookie > device lookup
    let artistId = session.artistId;
    if (!artistId) {
      for (const deviceId of session.deviceIds) {
        const p = await getArtistByDevice(deviceId);
        if (p) { artistId = p.artistId; break; }
      }
    }

    if (!artistId) {
      return NextResponse.json(
        { error: "Aucun profil artiste associé à cette session" },
        { status: 401 },
      );
    }

    // Vérifier que le profil existe encore
    const profile = await getArtist(artistId);
    if (!profile) {
      return NextResponse.json({ error: "Profil artiste introuvable" }, { status: 404 });
    }

    // 8 codes / 10 min / profil : pas d'inondation de codes valides.
    const rl = await checkRateLimit({ route: "artist-link-code", id: artistId, limit: 8, windowSec: 600 });
    if (!rl.allowed) return tooManyRequests(rl.retryAfter);

    const { code, expiresAt } = await createLinkCode(artistId);
    const expiresIn = Math.round((expiresAt - Date.now()) / 1000);

    return NextResponse.json(
      { code, expiresIn, expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[/api/artist/link-code POST]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// GET /api/artist/link-code?code=XXXX-XXXX → { status: "pending" | "used" | "expired" }
// Pour l'appareil qui a généré le code : afficher « ✓ appareil appairé » dès que l'autre a saisi le code.
// Ne consomme jamais le code et ne révèle rien du profil.
export async function GET(req: NextRequest) {
  try {
    const code = normalizeLinkCode(req.nextUrl.searchParams.get("code"));
    if (!code) return NextResponse.json({ error: "Code invalide" }, { status: 400 });
    return NextResponse.json({ status: await peekLinkCode(code) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[/api/artist/link-code GET]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
