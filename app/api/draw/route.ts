// app/api/draw/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDevice, incrementFramesSent } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { storeFrame, FramePayload } from "@/lib/queue";
import {
  checkRateLimit, isBlacklisted,
  getIP, tooManyRequests, forbidden,
} from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const rl = await checkRateLimit({
    route: "draw", id: ip,
    limit: parseInt(process.env.DRAW_LIMIT_PER_MINUTE ?? "10"),
    windowSec: 60, strikeId: ip, strikeType: "ip",
  });
  if (!rl.allowed) return tooManyRequests(rl.retryAfter);

  try {
    const body = await req.json();
    const { deviceId, screen, black, red, buffer } = body;

    if (!deviceId)
      return NextResponse.json({ error: "deviceId requis" }, { status: 400 });

    const hasPayload = black !== undefined || red !== undefined || buffer !== undefined;
    if (!hasPayload)
      return NextResponse.json({ error: "frame requise (black/red ou buffer)" }, { status: 400 });

    const device = await getDevice(deviceId);
    if (!device)
      return NextResponse.json({ error: "Device introuvable" }, { status: 404 });

    if (screen && !device.screens.includes(screen))
      return NextResponse.json({ error: `Screen "${screen}" non supporté` }, { status: 400 });

    if (!(await sessionOwnsDevice(deviceId)))
      return NextResponse.json({ error: "Non autorisé" }, { status: 403 });

    const payload: FramePayload =
      screen === "eink29bwr"
        ? { screen: "eink29bwr", black, red }
        : { screen, buffer };

    storeFrame(screen, payload, deviceId);
    await incrementFramesSent(deviceId);

    console.log(`[/api/draw] frame queued → device=${deviceId} screen=${screen}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/draw]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}