// app/api/devices/rename/route.ts
// POST /api/devices/rename  { deviceId, deviceName }
// Renomme un appareil (deviceName, distinct du nom d'artiste).
// Requiert que le deviceId soit dans la session courante.

import { NextRequest, NextResponse } from "next/server";
import { setDeviceName } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const deviceId   = typeof body.deviceId   === "string" ? body.deviceId.trim()   : "";
    const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim() : "";

    if (!deviceId)   return json({ error: "deviceId requis" }, 400);
    if (!deviceName) return json({ error: "deviceName requis" }, 400);

    if (!(await sessionOwnsDevice(deviceId)))
      return json({ error: "Non autorisé" }, 403);

    const updated = await setDeviceName(deviceId, deviceName);
    if (!updated) return json({ error: "Device introuvable" }, 404);

    return json({ ok: true, deviceId, deviceName: updated.deviceName });
  } catch (err) {
    console.error("[/api/devices/rename]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
}
