import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { getFrameForDevice, clearFrameForDeviceAck } from "@/lib/queue";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const deviceId = body?.deviceId as string | undefined;
    const frameId = body?.frameId as string | undefined;

    if (!deviceId || !frameId) {
      return NextResponse.json({ error: "deviceId et frameId requis" }, { status: 400 });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });
    }

    const current = getFrameForDevice(deviceId, device.screens);
    if (!current) {
      return NextResponse.json({ ok: true, cleared: false, reason: "no-frame" });
    }

    if (current.frameId !== frameId) {
      return NextResponse.json({
        ok: true,
        cleared: false,
        reason: "frame-mismatch",
        expected: current.frameId,
        received: frameId,
      });
    }

    const cleared = clearFrameForDeviceAck(deviceId, device.screens, frameId);

    console.log(`[/api/ack-frame] device=${deviceId} frameId=${frameId} cleared=${cleared}`);
    return NextResponse.json({ ok: true, cleared });
  } catch (err) {
    console.error("[/api/ack-frame] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}