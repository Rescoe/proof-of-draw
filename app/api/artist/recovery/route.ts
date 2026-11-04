// app/api/artist/recovery/route.ts
// GET  /api/artist/recovery            → { token } : jeton de récupération d'accès du profil de la session (propriétaire seulement)
// POST /api/artist/recovery {action:"rotate"} → révoque tous les jetons émis et renvoie le nouveau
// Coût : GET = 1 MGET ; rotate = 1 MGET + 1 INCR. Le jeton est dérivé (rien n'est stocké) : lib/recoveryToken.ts.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { resolveSessionArtist } from "@/lib/artistDirectory";
import { currentRecoveryToken, rotateRecoveryToken } from "@/lib/recovery";
import { getIP, isBlacklisted, forbidden, checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

/**
 * Le cookie normal porte déjà l'artistId : ne pas relire le profil une première
 * fois avant le MGET profil + epoch de currentRecoveryToken(). Le repli par les
 * appareils ne sert qu'aux anciens cookies qui n'avaient pas encore artistId.
 */
async function recoveryArtistId(): Promise<string | null> {
  const session = await getSession();
  if (session.artistId) return session.artistId;
  return (await resolveSessionArtist(session))?.artistId ?? null;
}

export async function GET() {
  try {
    const artistId = await recoveryArtistId();
    if (!artistId) return NextResponse.json({ error: "Aucun profil dans ce navigateur" }, { status: 401, headers: noStore });
    const token = await currentRecoveryToken(artistId);
    if (!token) return NextResponse.json({ error: "Profil introuvable" }, { status: 404, headers: noStore });
    return NextResponse.json({ token }, { headers: noStore });
  } catch (e) {
    console.error("[artist/recovery GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500, headers: noStore });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
    if (body.action !== "rotate") return NextResponse.json({ error: "action inconnue" }, { status: 400 });

    const artistId = await recoveryArtistId();
    if (!artistId) return NextResponse.json({ error: "Aucun profil dans ce navigateur" }, { status: 401, headers: noStore });

    const rl = await checkRateLimit({ route: "recovery-rotate", id: artistId, limit: 6, windowSec: 3600 });
    if (!rl.allowed) return tooManyRequests(rl.retryAfter);

    const token = await rotateRecoveryToken(artistId);
    if (!token) return NextResponse.json({ error: "Profil introuvable" }, { status: 404, headers: noStore });
    return NextResponse.json({ ok: true, token }, { headers: noStore });
  } catch (e) {
    console.error("[artist/recovery POST]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500, headers: noStore });
  }
}
