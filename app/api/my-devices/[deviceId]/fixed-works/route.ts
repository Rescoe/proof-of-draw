// app/api/my-devices/[deviceId]/fixed-works/route.ts
// Réglage PAR ÉCRAN « afficher aussi les œuvres fixes » (lib/fixedWorks.ts) : un écran dynamique (TFT, OLED) n'affiche que des animations tant qu'il n'est pas activé. POST { screen, enabled } —
// requiert d'être le propriétaire de l'ESP.


import { NextRequest, NextResponse } from "next/server";
import { setShowsFixedWorks } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const { deviceId } = await params;
  if (!deviceId) return NextResponse.json({ error: "deviceId requis" }, { status: 400 });

  if (!(await sessionOwnsDevice(deviceId))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  let body: { screen?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  if (typeof body.screen !== "string" || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "screen (string) et enabled (boolean) requis" }, { status: 400 });
  }

  const device = await setShowsFixedWorks(deviceId, body.screen, body.enabled);
  if (!device) return NextResponse.json({ error: "Device ou écran introuvable" }, { status: 404 });

  return NextResponse.json({ ok: true, fixedWorksScreens: device.fixedWorksScreens ?? [] });
}
