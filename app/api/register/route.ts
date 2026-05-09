// app/api/register/route.ts
// ESP appelle au boot → reçoit deviceId, pairCode, canvasUrl (avec screen)
// Idempotent par MAC : même deviceId si l'ESP reboot

import { NextRequest, NextResponse } from "next/server";
import { registerDevice } from "@/lib/deviceStore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mac, screens, firmware } = body;

    if (!mac || typeof mac !== "string") {
      return NextResponse.json({ error: "mac requis" }, { status: 400 });
    }
    if (!Array.isArray(screens) || screens.length === 0) {
      return NextResponse.json({ error: "screens[] requis" }, { status: 400 });
    }

    const device = registerDevice(
      mac.toLowerCase().trim(),
      screens,
      firmware ?? "unknown"
    );

    // Base URL : NEXT_PUBLIC_BASE_URL en prod, sinon déduit des headers
    const host =
      process.env.NEXT_PUBLIC_BASE_URL ??
      (req.headers.get("x-forwarded-proto") && req.headers.get("x-forwarded-host")
        ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("x-forwarded-host")}`
        : `http://${req.headers.get("host")}`);

    // ✅ canvasUrl inclut le premier screen → /draw/deviceId/screenId
    // C'est l'URL que l'artiste utilisera pour dessiner sur cet écran précis
    const primaryScreen = screens[0];
    const canvasUrl = `${host}/draw/${device.deviceId}/${primaryScreen}`;

    console.log(`[/api/register] ${device.deviceId} mac=${mac} screen=${primaryScreen} url=${canvasUrl}`);

    return NextResponse.json({
      deviceId:  device.deviceId,
      pairCode:  device.pairCode,   // 8 chars sans tirets (ex: "ABCD1234")
      canvasUrl,                     // ex: http://192.168.1.13:3000/draw/dev_XXXX/eink29bwr
    });
  } catch (err) {
    console.error("[/api/register] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}