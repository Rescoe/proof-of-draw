// app/api/devices/timezone/route.ts
// POST /api/devices/timezone  { deviceId, timezone }  — fuseau horaire IANA de l'appareil (heure du cartel et des mesures sur l'écran). Défaut : Europe/Paris.
// Requiert que l'appareil appartienne à la session (même règle que /api/devices/rename). Coût Redis : une lecture + une écriture de la fiche (rare : réglage manuel).

import { NextRequest, NextResponse } from "next/server";
import { setDeviceTimezone } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { isValidTimezone } from "@/lib/deviceTime";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";

    if (!deviceId) return json({ error: "deviceId requis" }, 400);
    if (!isValidTimezone(timezone)) return json({ error: "Fuseau horaire inconnu (exemple : Europe/Paris, America/New_York)" }, 400);

    if (!(await sessionOwnsDevice(deviceId)))
      return json({ error: "Non autorisé" }, 403);

    const updated = await setDeviceTimezone(deviceId, timezone);
    if (!updated) return json({ error: "Device introuvable" }, 404);

    return json({ ok: true, deviceId, timezone: updated.timezone });
  } catch (err) {
    console.error("[/api/devices/timezone]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
}
