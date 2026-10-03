// GET /api/anim/item?id=… — une animation de la galerie (clip PBC1 en base64).

import { NextRequest, NextResponse } from "next/server";
import { ANIM_ITEM_REGEX, getAnimation } from "@/lib/anim/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!ANIM_ITEM_REGEX.test(id)) return NextResponse.json({ error: "id invalide" }, { status: 400 });
  const item = await getAnimation(id);
  if (!item) return NextResponse.json({ error: "animation introuvable" }, { status: 404 });
  return NextResponse.json(item, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
