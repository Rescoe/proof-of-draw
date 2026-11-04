// app/api/devices/pair-code/route.ts
// GET /api/devices/pair-code?deviceId=dev_XXXXXXXX — réaffiche le code d'appairage d'un ESP à son PROPRIÉTAIRE (04/11/2026).
// Avant : le code n'était visible que sur l'écran de l'ESP tant qu'il n'était pas appairé ; une fois appairé, plus aucun moyen de le retrouver
// (cause de « aucun écran » chez un utilisateur qui avait perdu son cookie). Le code reste sensible : réservé à la session propriétaire,
// jamais dans une liste, jamais en cache. Coût : 1 GET.

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { getIP, isBlacklisted, forbidden, checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");
    const deviceId = req.nextUrl.searchParams.get("deviceId") ?? "";
    if (!/^dev_[A-Z0-9]{8}$/.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400, headers: noStore });
    if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Non autorisé" }, { status: 403, headers: noStore });
    const rl = await checkRateLimit({ route: "pair-code", id: deviceId, limit: 20, windowSec: 3600 });
    if (!rl.allowed) return tooManyRequests(rl.retryAfter);

    const device = await getDevice(deviceId);
    if (!device?.pairCode) return NextResponse.json({ error: "Appareil introuvable" }, { status: 404, headers: noStore });
    return NextResponse.json({ pairCode: device.pairCode }, { headers: noStore });
  } catch (e) {
    console.error("[devices/pair-code]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500, headers: noStore });
  }
}
