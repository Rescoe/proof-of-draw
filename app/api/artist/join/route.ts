// app/api/artist/join/route.ts
// POST /api/artist/join  { code: "XXXX-XXXX" }
// Valide le code de liaison, lie tous les devices de la session au profil artiste
// cible, et met à jour le cookie de session avec l'artistId ET tous les deviceIds
// liés à ce profil (devices de l'appareil A + devices de l'appareil B).
//
// Retour : { ok: true, profile: ArtistProfile }

import { NextRequest, NextResponse } from "next/server";
import {
  consumeLinkCode,
  getArtist,
  getDeviceIdsByArtist,
  linkDeviceToArtist,
  setArtistName,
} from "@/lib/deviceStore";
import { getSession, setSession } from "@/lib/session";
import { getIP, isBlacklisted, forbidden, checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { normalizeLinkCode } from "@/lib/linkCode";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");

    // Anti-devinette : 10 tentatives / 10 min / IP (le code a 32^8 combinaisons et vit 10 min, mais jamais sans limite).
    const rl = await checkRateLimit({ route: "artist-join", id: ip, limit: 10, windowSec: 600, strikeId: ip, strikeType: "ip" });
    if (!rl.allowed) return tooManyRequests(rl.retryAfter);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

    const code = normalizeLinkCode(body.code);
    if (!code) {
      return NextResponse.json({ error: "Code invalide (format XXXX-XXXX)" }, { status: 400 });
    }

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

    // 1. Lier tous les devices de CETTE session au profil artiste trouvé
    await Promise.all(
      session.deviceIds.map(async (deviceId) => {
        await linkDeviceToArtist(deviceId, artistId);
        await setArtistName(deviceId, profile.displayName);
      }),
    );

    // 2. Récupérer TOUS les devices déjà liés à ce profil (device A + device B)
    //    pour les inclure dans le cookie de session — l'interface verra tout.
    const allLinkedDeviceIds = await getDeviceIdsByArtist(artistId);
    const mergedDeviceIds = Array.from(
      new Set([...session.deviceIds, ...allLinkedDeviceIds]),
    );

    console.log(
      `[/api/artist/join] fusion artistId=${artistId} ` +
      `session(${session.deviceIds.length}) + liés(${allLinkedDeviceIds.length}) ` +
      `= total(${mergedDeviceIds.length})`,
    );

    // 3. Mettre à jour le cookie : artistId + TOUS les deviceIds fusionnés
    const res = NextResponse.json(
      { ok: true, profile },
      { headers: { "Cache-Control": "no-store" } },
    );
    await setSession(res, { deviceIds: mergedDeviceIds, artistId });
    return res;
  } catch (err) {
    console.error("[/api/artist/join POST]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
