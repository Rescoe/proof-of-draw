// GET /api/bench/poll?deviceId=… — appelé par le firmware (≈ toutes les 3 s) tant que le mode banc d'essai est actif.
// Réponse minuscule : { mode, clip: {clipId, bytes, frames, loops, playMs} | null }. Coût : 1 verrou + 1 MGET + 1 SET.

import { NextRequest, NextResponse } from "next/server";
import { benchLock, benchPoll, DEVICE_ID_REGEX } from "@/lib/bench/store";

export async function GET(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("deviceId") ?? "";
  if (!DEVICE_ID_REGEX.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  if (!(await benchLock("poll", deviceId, 2))) return NextResponse.json({ error: "trop rapide", retryAfter: 2 }, { status: 429 });
  const { mode, clip } = await benchPoll(deviceId);
  return NextResponse.json(
    mode
      ? { mode: true, clip: clip ? { clipId: clip.clipId, bytes: clip.bytes, frames: clip.frames, loops: clip.loops, playMs: clip.playMs } : null }
      : { mode: false, clip: null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
