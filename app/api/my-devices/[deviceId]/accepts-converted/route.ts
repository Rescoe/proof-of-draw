// app/api/my-devices/[deviceId]/accepts-converted/route.ts
// Toggle PAR ÉCRAN de la réception de dessins conçus pour un autre type d'écran
// (convertis à la volée, voir lib/screenConvert.ts). POST { screen, enabled }
// — requiert d'être le propriétaire de l'ESP. Indépendant de publicMode et
// d'acceptsAnaArt.

import { NextRequest, NextResponse } from "next/server";
import { setAcceptsConvertedScreen } from "@/lib/deviceStore";
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

  const device = await setAcceptsConvertedScreen(deviceId, body.screen, body.enabled);
  if (!device) return NextResponse.json({ error: "Device ou écran introuvable" }, { status: 404 });

  return NextResponse.json({ ok: true, acceptsConvertedScreens: device.acceptsConvertedScreens ?? [] });
}
