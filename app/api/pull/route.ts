// app/api/pull/route.ts
// ESP appelle GET /api/pull?deviceId=xxx pour récupérer son prochain frame.
//
// ✅ Structure JSON renvoyée :
//   { "frame": { "screen": "eink29bwr", "black": "...", "red": "..." } }
//   { "frame": { "screen": "oled096",   "buffer": "..." } }
//   { "frame": null }   — si rien en attente
//
// L'ESP lit directement frame["black"] et frame["red"] — pas de niveau intermédiaire.

import { NextRequest, NextResponse } from "next/server";
import { getDevice, pingDevice, incrementFramesSent } from "@/lib/deviceStore";
import { getFrameForDevice, clearFrameForDevice } from "@/lib/queue";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get("deviceId");

    if (!deviceId) {
      return NextResponse.json({ error: "deviceId requis" }, { status: 400 });
    }

    const device = getDevice(deviceId);
    if (!device) {
      console.warn(`[/api/pull] device inconnu: ${deviceId}`);
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });
    }

    // Mise à jour lastSeen à chaque pull (l'ESP est vivant)
    pingDevice(deviceId);

    const stored = getFrameForDevice(deviceId, device.screens);

    if (!stored) {
      return NextResponse.json({ frame: null });
    }

    // ✅ On renvoie payload directement sous "frame"
    // stored.payload = { screen, black, red }  ou  { screen, buffer }
    // L'ESP accède à frame["black"], frame["red"], frame["buffer"] directement.

incrementFramesSent(deviceId);
clearFrameForDevice(deviceId, device.screens); // ← AJOUT : consomme la frame
console.log(`[/api/pull] ✅ device=${deviceId} screen=${stored.screen}`);
return NextResponse.json({
  frame: {
    ...stored.payload,
    frameId: stored.frameId,
  }
});
  } catch (err) {
    console.error("[/api/pull] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}