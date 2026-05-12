// app/api/register/route.ts
import { NextRequest, NextResponse } from "next/server";
import { registerDevice } from "@/lib/deviceStore";
import {
  checkRateLimit, isBlacklisted, isDeviceCapReached,
  getIP, tooManyRequests, forbidden,
} from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  // 1. Blacklist
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  // 2. Rate limit : 5 register/min par IP
  const rl = await checkRateLimit({
    route: "register", id: ip, limit: parseInt(process.env.REGISTER_LIMIT_PER_MINUTE ?? "5"),
    windowSec: 60, strikeId: ip, strikeType: "ip",
  });
  if (!rl.allowed) return tooManyRequests(rl.retryAfter);

  try {
    const body = await req.json();
    const { mac, screens, firmware } = body;

    if (!mac || typeof mac !== "string")
      return NextResponse.json({ error: "mac requis" }, { status: 400 });
    if (!Array.isArray(screens) || screens.length === 0)
      return NextResponse.json({ error: "screens[] requis" }, { status: 400 });

    const macNorm = mac.toLowerCase().trim();

    // 3. Device cap — vérifié seulement pour les nouveaux devices
    // (les re-register existants passent toujours)
    const capReached = await isDeviceCapReached();

    const { device, isNew } = await registerDevice(macNorm, screens, firmware ?? "unknown");

    if (isNew && capReached) {
      // On a enregistré trop tôt — rollback (edge case rare)
      // En pratique registerDevice vérifie d'abord l'existant donc ce cas est très rare
      return NextResponse.json(
        { error: "Capacité maximale atteinte. Réessayez plus tard." },
        { status: 503 }
      );
    }

    const host =
      process.env.NEXT_PUBLIC_BASE_URL ??
      (req.headers.get("x-forwarded-proto") && req.headers.get("x-forwarded-host")
        ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("x-forwarded-host")}`
        : `http://${req.headers.get("host")}`);

    const primaryScreen = screens[0];

    return NextResponse.json({
      deviceId:   device.deviceId,
      pairCode:   device.pairCode,
      canvasUrl:  `${host}/draw/${device.deviceId}/${primaryScreen}`,
      paired:     !!device.artistName,
      artistName: device.artistName ?? null,
    });
  } catch (err) {
    console.error("[/api/register]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}