// app/api/my-devices/[deviceId]/measures-public/route.ts
// Rend les mesures d'un capteur publiques (vue réseau + historique) ou privées. POST { enabled: boolean } — requiert d'être le propriétaire de l'ESP.
// Miroir de accepts-ana-art. Coût Redis : une lecture + une écriture de la fiche (réglage manuel, rare).

import { NextRequest, NextResponse } from "next/server";
import { setMeasuresPublic } from "@/lib/deviceStore";
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

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) requis" }, { status: 400 });
  }

  const device = await setMeasuresPublic(deviceId, body.enabled);
  if (!device) return NextResponse.json({ error: "Device introuvable" }, { status: 404 });

  return NextResponse.json({ ok: true, measuresPublic: device.measuresPublic === true });
}
