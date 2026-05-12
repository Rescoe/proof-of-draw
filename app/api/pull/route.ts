// app/api/pull/route.ts
// Appelé par l'ESP pour récupérer sa prochaine frame
// Rate limit strict : 6 pulls par 10min par deviceId (cohérent avec rotation 15min)
// Le pull met aussi à jour lastPing → /api/ping devient optionnel

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

  // Blacklist par IP et par deviceId
  if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

  // Rate limit par deviceId — fenêtre 10min, 6 pulls max
  const rl = await checkRateLimit({
    route: "pull", id: deviceId,
    limit: parseInt(process.env.PULL_LIMIT_PER_WINDOW ?? "6"),
    windowSec: 600, // 10 minutes
    strikeId: deviceId, strikeType: "device",
  });
  if (!rl.allowed) return tooManyRequests(rl.retryAfter);

  try {
    const device = await getDevice(deviceId);
    if (!device) {
      console.warn(`[/api/pull] device inconnu: ${deviceId}`);
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });
    }

    // Pull = ping implicite → pas besoin de /api/ping fréquent
    await pingDevice(deviceId);

    const stored = await getFrameForDevice(deviceId, device.screens);
    if (!stored) return NextResponse.json({ frame: null });

    console.log(`[/api/pull] frame → device=${deviceId} screen=${stored.screen} frameId=${stored.frameId}`);
    return NextResponse.json({
      frame: { ...stored.payload, frameId: stored.frameId },
    });
  } catch (err) {
    console.error("[/api/pull]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}