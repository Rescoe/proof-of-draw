// app/api/draw/route.ts
// Reçoit le frame dessiné depuis l'UI web et le stocke en mémoire serveur.
// L'ESP le récupère ensuite via GET /api/pull.
// ⚠ MODIFIÉ : suppression COMPLÈTE de l'envoi HTTP vers device.ip/device.port

import { NextRequest, NextResponse } from "next/server";
import { storeFrame, FramePayload } from "@/lib/queue";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Payload attendu depuis canvasToScreen.ts :
    // { screen: "eink29bwr", black: "...", red: "..." }
    // { screen: "oled096",   buffer: "..." }
    // { screen: "eink27bw",  buffer: "..." }
    // Optionnel : deviceId pour ciblage précis d'un device

    const { screen, deviceId, ...rest } = body;


if (deviceId) {
  const { getDevice } = await import("@/lib/deviceStore");
  const device = getDevice(deviceId);
  if (!device) {
    return NextResponse.json({ error: "device inconnu" }, { status: 404 });
  }
  if (!device.screens.includes(screen)) {
    return NextResponse.json(
      { error: `Ce device ne supporte pas l'écran ${screen}` },
      { status: 400 }
    );
  }
}


    if (!screen || typeof screen !== "string") {
      return NextResponse.json({ error: "screen requis" }, { status: 400 });
    }

    // Validation basique du payload selon le type d'écran
    if (screen === "eink29bwr") {
      if (!rest.black || !rest.red) {
        return NextResponse.json(
          { error: "eink29bwr requiert black + red (base64)" },
          { status: 400 }
        );
      }
    } else {
      if (!rest.buffer) {
        return NextResponse.json(
          { error: `${screen} requiert buffer (base64)` },
          { status: 400 }
        );
      }
    }

    const payload: FramePayload = { screen, ...rest } as FramePayload;

    // Stocker le frame — l'ESP viendra le puller
    storeFrame(screen, payload, deviceId ?? undefined);

    console.log(`[/api/draw] frame stockée screen=${screen}${deviceId ? ` → device=${deviceId}` : " (broadcast)"}`);

    return NextResponse.json({ ok: true, screen, stored: true });
  } catch (err) {
    console.error("[/api/draw] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}