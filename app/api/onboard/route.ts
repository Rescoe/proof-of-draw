// app/api/onboard/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDeviceByMac, getDeviceByPairCode, setArtistName } from "@/lib/deviceStore";
import { addDeviceToSession } from "@/lib/session";
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
    const { pairCode, mac, artistName } = body;

    if (!artistName?.trim())
      return NextResponse.json({ error: "artistName requis" }, { status: 400 });

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

    const updated = await setArtistName(device.deviceId, artistName.trim());
    if (!updated)
      return NextResponse.json({ error: "Erreur mise à jour device" }, { status: 500 });

    const primaryScreen = device.screens[0];
    const canvasUrl = `/draw/${device.deviceId}/${primaryScreen}`;

    const res = NextResponse.json({
      ok: true,
      deviceId: device.deviceId,
      screen:   primaryScreen,
      canvasUrl,
    });

    await addDeviceToSession(res, device.deviceId);
    return res;
  } catch (err) {
    console.error("[/api/onboard]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}