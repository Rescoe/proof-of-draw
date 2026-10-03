// GET /api/bench/status?deviceId=… — pour l'interface du propriétaire : mode, clip en attente, dernier poll de l'appareil, mesures.

import { NextRequest, NextResponse } from "next/server";
import { sessionOwnsDevice } from "@/lib/session";
import { getDevice } from "@/lib/deviceStore";
import { benchStatus, DEVICE_ID_REGEX } from "@/lib/bench/store";

export async function GET(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("deviceId") ?? "";
  if (!DEVICE_ID_REGEX.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  const [status, device] = await Promise.all([benchStatus(deviceId), getDevice(deviceId)]);
  // La version du firmware ENREGISTRÉE : le banc d'essai exige r4tft28-2.1 ou plus (une 2.0 ignore le mode et ne fait jamais de poll rapide).
  return NextResponse.json({ ...status, firmware: device?.firmware ?? null, lastPingAgoMs: device?.lastPing ? Math.max(0, Date.now() - device.lastPing) : null }, { headers: { "Cache-Control": "no-store" } });
}
