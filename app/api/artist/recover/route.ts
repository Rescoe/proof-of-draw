// app/api/artist/recover/route.ts
// POST /api/artist/recover { token }  — rétablit l'accès à un profil (et donc à TOUS ses ESP) depuis un jeton de récupération (lib/recoveryToken.ts).
// À utiliser quand le cookie de session a disparu (Safari qui purge, navigation privée, navigateur intégré, nouveau téléphone).
// Le cookie reçoit l'artistId : sessionOwnsDevice accepte alors tout ESP lié à ce profil (clé inverse artist:device:*), sans parcourir de liste.
// Les ESP déjà présents dans le cookie du navigateur sont CONSERVÉS (on ajoute, on ne retire jamais).
// Anti-devinette : 10 essais / 10 min / IP, signature HMAC de 22 caractères (≈ 132 bits). Coût : 1 MGET.

import { NextRequest, NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/session";
import { redeemRecoveryToken } from "@/lib/recovery";
import { getIP, isBlacklisted, forbidden, checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");
    const rl = await checkRateLimit({ route: "artist-recover", id: ip, limit: 10, windowSec: 600, strikeId: ip, strikeType: "ip" });
    if (!rl.allowed) return tooManyRequests(rl.retryAfter);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

    const profile = await redeemRecoveryToken(body.token);
    if (!profile) return NextResponse.json({ error: "Lien ou clé de récupération invalide, ou révoqué(e)" }, { status: 400, headers: { "Cache-Control": "no-store" } });

    const session = await getSession();
    const res = NextResponse.json({ ok: true, profile: { displayName: profile.displayName, slug: profile.slug ?? null } }, { headers: { "Cache-Control": "no-store" } });
    await setSession(res, { deviceIds: session.deviceIds, artistId: profile.artistId });
    return res;
  } catch (e) {
    console.error("[artist/recover]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
