// app/api/network/display-image/route.ts
// GET /api/network/display-image?frameId=…&screen=… — buffers de la frame affichée (copie écrite à l'ACK).
// Une frame ne change jamais pour un frameId donné : réponse immuable, mise en cache par le navigateur et le CDN.
// Les frames personnelles n'ont aucune copie : 404.

import { NextRequest, NextResponse } from "next/server";
import { fixtureCount, fixtureImage } from "@/lib/network/fixtures";
import { redis } from "@/lib/redis";
import { isValidScreenId } from "@/lib/screenProfiles";
import { readShownImage, FRAME_ID_RE, type DisplayKV } from "@/lib/displayState";

export async function GET(req: NextRequest) {
  const frameId = req.nextUrl.searchParams.get("frameId") ?? "";
  const screen = req.nextUrl.searchParams.get("screen") ?? "";
  if (!FRAME_ID_RE.test(frameId) || !isValidScreenId(screen)) {
    return NextResponse.json({ error: "paramètres invalides" }, { status: 400 });
  }
  // DÉVELOPPEMENT SEULEMENT : frameId « fixture-… » → vignette synthétique (fixtureCount ≠ null seulement hors production)
  if (frameId.startsWith("fixture-") && fixtureCount("0") !== null) {
    const img = fixtureImage(frameId, screen);
    return img ? NextResponse.json({ imagePayload: img }) : NextResponse.json({ error: "image indisponible" }, { status: 404 });
  }
  const imagePayload = await readShownImage(redis as unknown as DisplayKV, frameId, screen);
  if (!imagePayload) {
    return NextResponse.json({ error: "image indisponible" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } });
  }
  return NextResponse.json({ imagePayload }, { headers: { "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable" } });
}
