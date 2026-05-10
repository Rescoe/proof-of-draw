// app/api/register/route.ts
// Appelé par l'ESP au boot — idempotent par MAC
// Renvoie aussi "paired: true" si le device a déjà un artistName
// → l'ESP peut éviter d'afficher le QR si déjà appairé

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

    const host =
      process.env.NEXT_PUBLIC_BASE_URL ??
      (req.headers.get("x-forwarded-proto") && req.headers.get("x-forwarded-host")
        ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("x-forwarded-host")}`
        : `http://${req.headers.get("host")}`);

    const primaryScreen = screens[0];
    const canvasUrl = `${host}/draw/${device.deviceId}/${primaryScreen}`;

    console.log(
      `[/api/register] ${device.deviceId} mac=${mac} screen=${primaryScreen} paired=${!!device.artistName}`
    );

    return NextResponse.json({
      deviceId:  device.deviceId,
      pairCode:  device.pairCode,
      canvasUrl,
      paired: !!device.artistName,   // ← nouveau : true si déjà onboardé
      artistName: device.artistName ?? null,
    });
  } catch (err) {
    console.error("[/api/register] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}