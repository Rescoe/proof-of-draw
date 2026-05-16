// app/api/pull-frame/route.ts
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { getFrameForDevice } from "@/lib/queue";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;

export async function GET(req: NextRequest) {
  try {
    const deviceId = new URL(req.url).searchParams.get("deviceId");
    const fmt      = new URL(req.url).searchParams.get("fmt"); // "bin" ou null

    if (!deviceId || !DEVICE_ID_REGEX.test(deviceId))
      return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });

    const device = await getDevice(deviceId);
    if (!device)
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });

    // Cherche consensus puis personal
    let payload: any = null;
    const consensusFrame = await getFrameForDevice(deviceId, []);
    if (consensusFrame?.payload) {
      payload = consensusFrame.payload;
    } else {
      const personalRaw = await redis.get(personalKey(deviceId));
      if (personalRaw) {
        const pf = typeof personalRaw === "string" ? JSON.parse(personalRaw) : personalRaw;
        if (pf?.payload) payload = pf.payload;
      }
    }

    if (!payload) {
      return NextResponse.json({ error: "no frame" }, { status: 404 });
    }

    const { black, red } = payload as { black?: string; red?: string };
    if (!black || !red) {
      return NextResponse.json({ error: "payload incompatible (pas eink29bwr)" }, { status: 404 });
    }

    if (fmt === "bin") {
      // Retourne les deux buffers concaténés en binaire : blackBuf (4736) + redBuf (4736)
      const blackBytes = Buffer.from(black, "base64");
      const redBytes   = Buffer.from(red,   "base64");
      const combined   = Buffer.concat([blackBytes, redBytes]); // 9472 bytes

      return new NextResponse(combined, {
        status: 200,
        headers: {
          "Content-Type":   "application/octet-stream",
          "Content-Length": String(combined.length),
        },
      });
    }

    // Fallback JSON (pour debug depuis navigateur)
    return NextResponse.json({ frameId: consensusFrame?.frameId, ...payload });

  } catch (err) {
    console.error("[pull-frame] error:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}