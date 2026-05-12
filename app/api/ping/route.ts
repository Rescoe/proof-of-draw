// app/api/ping/route.ts
// Le ping est quasi optionnel : /api/pull met déjà à jour lastPing.
// Garder cette route pour compatibilité firmware, mais très limitée.
// Recommandé côté ESP : supprimer le ping ou l'espacer à 30min+.

import { NextRequest, NextResponse } from "next/server";
import { pingDevice } from "@/lib/deviceStore";
import {
  checkRateLimit, isBlacklisted,
  getIP, tooManyRequests, forbidden,
} from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  try {
    const body = await req.json();
    const { deviceId } = body;
    if (!deviceId)
      return NextResponse.json({ error: "deviceId requis" }, { status: 400 });

    if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

    // 6 pings max par heure par deviceId
    const rl = await checkRateLimit({
      route: "ping", id: deviceId,
      limit: parseInt(process.env.PING_LIMIT_PER_HOUR ?? "6"),
      windowSec: 3600,
      strikeId: deviceId, strikeType: "device",
    });
    if (!rl.allowed) return tooManyRequests(rl.retryAfter);

    const device = await pingDevice(deviceId);
    if (!device)
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/ping]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}