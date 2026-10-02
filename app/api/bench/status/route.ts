// GET /api/bench/status?deviceId=… — pour l'interface du propriétaire : mode, clip en attente, dernier poll de l'appareil, mesures.

import { NextRequest, NextResponse } from "next/server";
import { sessionOwnsDevice } from "@/lib/session";
import { benchStatus, DEVICE_ID_REGEX } from "@/lib/bench/store";

export async function GET(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("deviceId") ?? "";
  if (!DEVICE_ID_REGEX.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  return NextResponse.json(await benchStatus(deviceId), { headers: { "Cache-Control": "no-store" } });
}
