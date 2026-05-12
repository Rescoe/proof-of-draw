// app/api/pull/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDevice, pingDevice } from "@/lib/deviceStore";
import { getFrameForDevice } from "@/lib/queue";
import {
  checkRateLimit, isBlacklisted,
  getIP, tooManyRequests, forbidden,
} from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  const { searchParams } = new URL(req.url);
  const deviceId = searchParams.get("deviceId");

  if (!deviceId)
    return NextResponse.json({ error: "deviceId requis" }, { status: 400 });

  if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

  const rl = await checkRateLimit({
    route: "pull", id: deviceId,
    limit: parseInt(process.env.PULL_LIMIT_PER_WINDOW ?? "6"),
    windowSec: 600,
    strikeId: deviceId, strikeType: "device",
  });
  if (!rl.allowed) return tooManyRequests(rl.retryAfter);

  try {
    const device = await getDevice(deviceId);
    if (!device) {
      console.warn(`[/api/pull] device inconnu: ${deviceId}`);
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });
    }

    await pingDevice(deviceId);

    const stored = await getFrameForDevice(deviceId, device.screens);
    if (!stored) {
      return NextResponse.json({ frame: null });
    }

    // Construit la réponse à plat pour l'ESP
    const frameResponse = {
      ...stored.payload,
      frameId: stored.frameId,
    };

    console.log(`[/api/pull] frame → device=${deviceId} screen=${stored.screen} frameId=${stored.frameId}`);
    console.log(`[/api/pull] payload keys: ${Object.keys(frameResponse).join(", ")}`);

    return NextResponse.json({ frame: frameResponse });
  } catch (err) {
    console.error("[/api/pull]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}