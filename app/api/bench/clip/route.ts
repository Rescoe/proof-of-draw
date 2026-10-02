// GET /api/bench/clip?deviceId=…&clipId=… — le clip binaire PBC1 (≤ 9 Ko). Même confiance que /api/pull-frame (l'identifiant d'appareil).

import { NextRequest, NextResponse } from "next/server";
import { CLIP_ID_REGEX, DEVICE_ID_REGEX, loadClip } from "@/lib/bench/store";

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const deviceId = u.searchParams.get("deviceId") ?? "", clipId = u.searchParams.get("clipId") ?? "";
  if (!DEVICE_ID_REGEX.test(deviceId) || !CLIP_ID_REGEX.test(clipId)) return NextResponse.json({ error: "paramètres invalides" }, { status: 400 });
  const bin = await loadClip(deviceId, clipId);
  if (!bin) return NextResponse.json({ error: "clip absent ou expiré" }, { status: 404 });
  return new NextResponse(new Uint8Array(bin), {
    status: 200,
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bin.length), "Cache-Control": "no-store" },
  });
}
