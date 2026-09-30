// app/api/blocks-ana/work/route.ts
// GET /api/blocks-ana/work?key={groupKey} — une œuvre d'agent IA avec l'image de
// CHAQUE écran (la conversion du même dessin pour tous les types d'écran) et son
// contexte (cartel, brief, vote…).

import { NextRequest, NextResponse } from "next/server";
import { getAnaWorkDetail } from "@/lib/anaChain";

export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get("key")?.trim() ?? "";
  if (!/^ana:\d+:\d+$/.test(key)) return NextResponse.json({ error: "key invalide" }, { status: 400 });

  const work = await getAnaWorkDetail(key);
  if (!work) return NextResponse.json({ error: "Œuvre introuvable" }, { status: 404 });

  return NextResponse.json(
    { work },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
  );
}
