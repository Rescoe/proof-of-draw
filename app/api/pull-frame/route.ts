// app/api/pull-frame/route.ts
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { getFrameForDevice } from "@/lib/queue";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;

function json(body: any, status = 200) { return NextResponse.json(body, { status }); }

export async function GET(req: NextRequest) {
  try {
    const ip = getIP(req);
    const deviceId = new URL(req.url).searchParams.get("deviceId");

    if (!deviceId || !DEVICE_ID_REGEX.test(deviceId))
      return json({ error: "deviceId invalide" }, 400);
    if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

    const device = await getDevice(deviceId);
    if (!device) return json({ error: "device inconnu" }, 404);

    // Consensus frame
    const consensusFrame = await getFrameForDevice(deviceId, []);
    if (consensusFrame?.payload) {
      return json({
        frameId: consensusFrame.frameId,
        source: "consensus",
        ...consensusFrame.payload,  // contient black, red, screen, etc.
      });
    }

    // Personal frame
    const personalRaw = await redis.get(personalKey(deviceId));
    if (personalRaw) {
      const personalFrame = typeof personalRaw === "string"
        ? JSON.parse(personalRaw)
        : personalRaw;
      if (personalFrame?.payload) {
        return json({
          frameId: personalFrame.frameId,
          source: "personal",
          ...personalFrame.payload,
        });
      }
    }

    return json({ error: "no frame" }, 404);
  } catch (err) {
    console.error("[pull-frame] error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
}