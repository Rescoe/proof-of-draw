// app/api/draw/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDevice, incrementFramesSent } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { storeFrame, FramePayload } from "@/lib/queue";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { deviceId, screen, black, red, buffer } = body;

    if (!deviceId) {
      return NextResponse.json({ error: "deviceId requis" }, { status: 400 });
    }

    const hasPayload =
      black !== undefined || red !== undefined || buffer !== undefined;
    if (!hasPayload) {
      return NextResponse.json(
        { error: "frame requis (black/red pour eink29bwr, buffer sinon)" },
        { status: 400 }
      );
    }

    // 1. Device existe ?
    const device = getDevice(deviceId);
    if (!device) {
      return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
    }

    // 2. Screen supporté ?
    if (screen && !device.screens.includes(screen)) {
      return NextResponse.json(
        { error: `Screen "${screen}" non supporté par ce device` },
        { status: 400 }
      );
    }

    // 3. Session autorisée ?
    const authorized = await sessionOwnsDevice(deviceId);
    if (!authorized) {
      return NextResponse.json(
        { error: "Non autorisé — veuillez onboarder ce device d'abord" },
        { status: 403 }
      );
    }

    // 4. Stocker via storeFrame existant, ciblé sur ce deviceId
    const payload: FramePayload =
      screen === "eink29bwr"
        ? { screen: "eink29bwr", black, red }
        : { screen, buffer };

    storeFrame(screen, payload, deviceId);
    incrementFramesSent(deviceId);

    console.log(`[/api/draw] frame queued → device=${deviceId} screen=${screen}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/draw] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}