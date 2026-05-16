// app/api/pull-frame/route.ts
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { getFrameForDevice } from "@/lib/queue";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;

export async function GET(req: NextRequest) {
  try {
    const url      = new URL(req.url);
    const deviceId = url.searchParams.get("deviceId");
    const fmt      = url.searchParams.get("fmt");    // "bin" ou null
    const screen   = url.searchParams.get("screen"); // "eink29bwr" | "eink27bw" | "oled096" | null

    if (!deviceId || !DEVICE_ID_REGEX.test(deviceId))
      return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });

    const device = await getDevice(deviceId);
    if (!device)
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });

    // Cherche consensus puis personal
    let payload: any = null;
    let frameId: string | undefined;

    const consensusFrame = await getFrameForDevice(deviceId, []);
    if (consensusFrame?.payload) {
      payload = consensusFrame.payload;
      frameId = consensusFrame.frameId;
    } else {
      const personalRaw = await redis.get(personalKey(deviceId));
      if (personalRaw) {
        const pf = typeof personalRaw === "string" ? JSON.parse(personalRaw) : personalRaw;
        if (pf?.payload) {
          payload = pf.payload;
          frameId = pf.frameId;
        }
      }
    }

    if (!payload) {
      return NextResponse.json({ error: "no frame" }, { status: 404 });
    }

    // ── Détermine le screen cible ──────────────────────────────────────────
    // Priorité : paramètre &screen= > payload.screen > premier screen du device
    const targetScreen = screen
      ?? payload.screen
      ?? (device.screens?.[0] as string | undefined);

    if (!targetScreen) {
      return NextResponse.json({ error: "screen indéterminable" }, { status: 400 });
    }

    // ── eink29bwr : black + red ────────────────────────────────────────────
    if (targetScreen === "eink29bwr") {
      const { black, red } = payload as { black?: string; red?: string };
      if (!black || !red) {
        console.error(`[pull-frame] payload manquant black/red pour ${deviceId}`);
        return NextResponse.json({ error: "payload incomplet pour eink29bwr" }, { status: 404 });
      }

      if (fmt === "bin") {
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
      return NextResponse.json({ frameId, ...payload });
    }

    // ── eink27bw : buffer unique ───────────────────────────────────────────
    if (targetScreen === "eink27bw") {
      const { buffer } = payload as { buffer?: string };
      if (!buffer) {
        console.error(`[pull-frame] payload manquant buffer pour ${deviceId} (eink27bw)`);
        return NextResponse.json({ error: "payload incomplet pour eink27bw" }, { status: 404 });
      }

      if (fmt === "bin") {
        const bytes = Buffer.from(buffer, "base64");

        return new NextResponse(bytes, {
          status: 200,
          headers: {
            "Content-Type":   "application/octet-stream",
            "Content-Length": String(bytes.length),
          },
        });
      }
      return NextResponse.json({ frameId, ...payload });
    }

    // ── oled096 : buffer unique ────────────────────────────────────────────
    if (targetScreen === "oled096") {
      const { buffer } = payload as { buffer?: string };
      if (!buffer) {
        console.error(`[pull-frame] payload manquant buffer pour ${deviceId} (oled096)`);
        return NextResponse.json({ error: "payload incomplet pour oled096" }, { status: 404 });
      }

      if (fmt === "bin") {
        const bytes = Buffer.from(buffer, "base64");

        return new NextResponse(bytes, {
          status: 200,
          headers: {
            "Content-Type":   "application/octet-stream",
            "Content-Length": String(bytes.length),
          },
        });
      }
      return NextResponse.json({ frameId, ...payload });
    }

    // ── Screen inconnu ─────────────────────────────────────────────────────
    console.error(`[pull-frame] screen inconnu: ${targetScreen} pour ${deviceId}`);
    return NextResponse.json({ error: `screen inconnu: ${targetScreen}` }, { status: 400 });

  } catch (err) {
    console.error("[pull-frame] error:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}