// app/api/my-devices/[deviceId]/availability/route.ts
// Toggle manuel du mode prêt public d'un ESP.
// POST { enabled: boolean } — requiert d'être le propriétaire de l'ESP.

import { NextRequest, NextResponse } from "next/server";
import { setPublicMode } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export async function POST(
  req: NextRequest,
  { params }: { params: { deviceId: string } },
) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const { deviceId } = params;
  if (!deviceId) return NextResponse.json({ error: "deviceId requis" }, { status: 400 });

  if (!(await sessionOwnsDevice(deviceId))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) requis" }, { status: 400 });
  }

  const device = await setPublicMode(deviceId, body.enabled);
  if (!device) return NextResponse.json({ error: "Device introuvable" }, { status: 404 });

  return NextResponse.json({ ok: true, publicMode: device.publicMode });
}
