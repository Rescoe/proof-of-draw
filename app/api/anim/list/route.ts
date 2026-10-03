// GET /api/anim/list?limit=24&offset=0 — galerie publique des animations (clip PBC1 en base64 : l'interface le décode et le joue).

import { NextRequest, NextResponse } from "next/server";
import { listAnimations } from "@/lib/anim/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const limit = Math.max(1, Math.min(30, parseInt(u.searchParams.get("limit") ?? "24") || 24));
  const offset = Math.max(0, parseInt(u.searchParams.get("offset") ?? "0") || 0);
  const { items, total } = await listAnimations(limit, offset);
  return NextResponse.json({ items, total, limit, offset }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}
