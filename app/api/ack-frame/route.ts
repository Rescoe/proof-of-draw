// app/api/ack-frame/route.ts
// L'ESP confirme qu'il a bien affiché la frame → on la supprime de Redis

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { clearFrameForDeviceAck } from "@/lib/queue";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  try {
    const body = await req.json();
    const { deviceId, frameId } = body;

    if (!deviceId || !frameId)
      return NextResponse.json({ error: "deviceId et frameId requis" }, { status: 400 });

    if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

    const device = await getDevice(deviceId);
    if (!device)
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });

    const cleared = await clearFrameForDeviceAck(deviceId, device.screens, frameId);
    console.log(`[/api/ack-frame] device=${deviceId} frameId=${frameId} cleared=${cleared}`);
    return NextResponse.json({ ok: true, cleared });
  } catch (err) {
    console.error("[/api/ack-frame]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}