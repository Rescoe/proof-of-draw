// app/api/rejected-image/route.ts — image d'un dessin REJETÉ ou EXPIRÉ (copie d'archive `candidate:archive:{id}`, lib/rejectedArchive.ts).
// GET ?id={candidateId} → { payload } au même format que les images de blocs (BlockFrameCanvas). Seuls les candidats finalisés « rejeté » ou « expiré » sont servis : un dessin encore en cours de vote
// ou déjà miné n'est jamais exposé par cette route. 404 identique pour « inconnu », « miné », « encore en cours » et « copie supprimée » (aucune énumération).
// Coût Redis : 2 GET (état final, copie), puis CDN 1 h (l'image d'un candidat finalisé ne change jamais).

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { archiveKey, finalKey } from "@/lib/rejectedArchive";

const ID_RE = /^[0-9A-Za-z-]{8,64}$/;
const notFound = () => NextResponse.json({ error: "introuvable" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=30" } });

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!ID_RE.test(id)) return NextResponse.json({ error: "id invalide" }, { status: 400 });
  try {
    const [final, raw] = await redis.mget<unknown[]>(finalKey(id), archiveKey(id));
    if (final !== "rejected" && final !== "expired") return notFound();
    if (!raw) return notFound();
    const c = (typeof raw === "string" ? JSON.parse(raw) : raw) as { payload?: Record<string, unknown>; poolScreen?: string } | null;
    const payload = c?.payload;
    if (!payload || typeof payload !== "object") return notFound();
    return NextResponse.json({ payload }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (err) {
    console.error("[/api/rejected-image]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
