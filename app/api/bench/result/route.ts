// POST /api/bench/result — mesures renvoyées par le firmware après la lecture d'un clip (bornées et nettoyées avant stockage).

import { NextRequest, NextResponse } from "next/server";
import { benchLock, DEVICE_ID_REGEX, pushResult, sanitizeResult } from "@/lib/bench/store";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const deviceId = String(body.deviceId ?? "");
  if (!DEVICE_ID_REGEX.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  const result = sanitizeResult(body);
  if (!result) return NextResponse.json({ error: "mesures invalides" }, { status: 400 });
  if (!(await benchLock("result", deviceId, 1))) return NextResponse.json({ error: "trop rapide" }, { status: 429 });
  await pushResult(deviceId, result);
  return NextResponse.json({ ok: true });
}
