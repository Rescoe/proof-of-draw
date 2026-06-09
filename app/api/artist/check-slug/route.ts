// app/api/artist/check-slug/route.ts
// GET /api/artist/check-slug?slug=mon-nom&artistId=xxx
// Retourne la disponibilité d'un slug (utilisé par le formulaire de profil en temps réel).

import { NextRequest, NextResponse } from "next/server";
import { normalizeSlug, isSlugAvailable } from "@/lib/deviceStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw      = searchParams.get("slug") ?? "";
  const artistId = searchParams.get("artistId") ?? undefined;

  const normalized = normalizeSlug(raw);

  if (normalized.length < 3) {
    return NextResponse.json(
      { available: false, normalized, reason: "Trop court (3 caractères min)" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const available = await isSlugAvailable(normalized, artistId);
  return NextResponse.json(
    { available, normalized },
    { headers: { "Cache-Control": "no-store" } },
  );
}
