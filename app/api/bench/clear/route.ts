// POST /api/bench/clear — { deviceId } : efface les mesures et le journal du banc d'essai de cet écran (réservé au propriétaire). 1 commande Redis.

import { NextRequest, NextResponse } from "next/server";
import { sessionOwnsDevice } from "@/lib/session";
import { clearBenchHistory, DEVICE_ID_REGEX } from "@/lib/bench/store";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const deviceId = String(body.deviceId ?? "");
  if (!DEVICE_ID_REGEX.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  await clearBenchHistory(deviceId);
  return NextResponse.json({ ok: true });
}
