// app/api/onboard/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getArtist, getDeviceByMac, getDeviceByPairCode, setArtistName } from "@/lib/deviceStore";
import { getSession, setSession } from "@/lib/session";
import { ensureSessionProfile, resolveSessionArtist } from "@/lib/artistDirectory";
import {
  checkRateLimit, isBlacklisted,
  getIP, tooManyRequests, forbidden,
} from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const rl = await checkRateLimit({
    route: "onboard", id: ip,
    limit: parseInt(process.env.ONBOARD_LIMIT_PER_MINUTE ?? "10"),
    windowSec: 60, strikeId: ip, strikeType: "ip",
  });
  if (!rl.allowed) return tooManyRequests(rl.retryAfter);

  try {
    const body = await req.json();
    const { pairCode, mac } = body;
    const name = typeof body.artistName === "string" ? body.artistName.trim() : "";

    const session = await getSession();

    let device = null;

    if (pairCode) {
      const code = pairCode.replace(/-/g, "").toUpperCase().trim();
      // Lookup direct par clé pair: — une seule lecture Redis
      device = await getDeviceByPairCode(code);
      if (!device)
        return NextResponse.json(
          { error: `Aucun device avec le code "${code}".` },
          { status: 404 }
        );
    } else if (mac) {
      device = await getDeviceByMac(mac.toLowerCase().trim());
      if (!device)
        return NextResponse.json(
          { error: "Aucun device avec cette adresse MAC." },
          { status: 404 }
        );
    } else {
      return NextResponse.json({ error: "pairCode ou mac requis" }, { status: 400 });
    }

    // Cet ESP a déjà un profil (lien permanent) : jamais reprendre ni renommer — on retrouve ce profil
    // si la session n'en a pas (récupération après perte du cookie / nouveau téléphone).
    const owner = device.artistId ? await getArtist(device.artistId) : null;
    let profile = null;
    if (owner) {
      profile = (await resolveSessionArtist(session)) ?? owner;
    } else {
      // Un ESP en session = un artiste : profil existant rejoint, sinon créé avec le nom saisi.
      if (!name && !device.artistName?.trim())
        return NextResponse.json({ error: "artistName requis" }, { status: 400 });
      if (name) {
        const updated = await setArtistName(device.deviceId, name);
        if (!updated)
          return NextResponse.json({ error: "Erreur mise à jour device" }, { status: 500 });
      }
      profile = await ensureSessionProfile({
        deviceIds: Array.from(new Set([...session.deviceIds, device.deviceId])),
        artistId:  session.artistId,
      });
    }

    const primaryScreen = device.screens[0];
    const canvasUrl = `/draw/${device.deviceId}/${primaryScreen}`;

    const res = NextResponse.json({
      ok: true,
      deviceId: device.deviceId,
      screen:   primaryScreen,
      canvasUrl,
      profile:  profile ? { displayName: profile.displayName, slug: profile.slug } : null,
    });

    await setSession(res, {
      deviceIds: Array.from(new Set([...session.deviceIds, device.deviceId])),
      artistId:  profile?.artistId ?? session.artistId,
    });
    return res;
  } catch (err) {
    console.error("[/api/onboard]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
