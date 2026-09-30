// app/api/draw-status/route.ts
// GET /api/draw-status?deviceId=dev_XXXXXXXX → { nextDrawIn }
//
// Temps restant avant le prochain dessin d'un appareil (verrou `draw:lock:{deviceId}`
// posé par /api/draw). L'éditeur l'interroge à l'ouverture et avant chaque envoi :
// il n'envoie ainsi jamais un dessin qui serait refusé (429), et un utilisateur
// légitime dont le stockage local a été vidé — ou qui dessine sur l'autre écran
// d'un ESP à deux écrans — ne se retrouve plus compté comme abusif.
//
// Lecture seule : ne touche ni au verrou, ni aux strikes, ni à la blacklist.

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { getIP, isBlacklisted, forbidden, checkRateLimit } from "@/lib/rateLimit";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const DRAW_WINDOW_SEC = parseInt(process.env.DRAW_WINDOW_SEC ?? "900");
const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const deviceId = req.nextUrl.searchParams.get("deviceId") ?? "";
  if (!DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400, headers: NO_STORE });
  }

  const rl = await checkRateLimit({ route: "draw-status", id: ip, limit: 30, windowSec: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes", retryAfter: rl.retryAfter },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(rl.retryAfter) } },
    );
  }

  const device = await getDevice(deviceId);
  if (!device) return NextResponse.json({ error: "Device introuvable" }, { status: 404, headers: NO_STORE });

  // Même règle d'accès que /api/draw : propriétaire, ou ESP en mode public (invité)
  if (device.publicMode !== true && !(await sessionOwnsDevice(deviceId))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403, headers: NO_STORE });
  }

  const ttl = await redis.ttl(`draw:lock:${deviceId}`);
  return NextResponse.json(
    { nextDrawIn: ttl > 0 ? ttl : 0, windowSec: DRAW_WINDOW_SEC },
    { headers: NO_STORE },
  );
}
