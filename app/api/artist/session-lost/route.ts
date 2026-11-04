// app/api/artist/session-lost/route.ts
// POST /api/artist/session-lost  — télémétrie MINIMALE d'une perte de liaison (04/11/2026) : un navigateur qui se souvenait avoir été appairé
// (marqueur local) revient sans cookie de session. Sert à PROUVER la cause (famille de navigateur : iOS ancien, navigateur intégré, navigation privée…)
// au lieu de la deviner. Ne stocke que « iOS 12 · Safari »-style (lib/uaFamily.ts) : aucune IP, aucun identifiant, aucun appareil.
// Coût : ≤ 6 commandes par événement, 1 événement / heure / IP au plus.
//   stat:sesslost:{AAAAMMJJ}  compteur (TTL 40 j) ; stat:sesslost:ua  liste des 60 dernières familles.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { uaFamily } from "@/lib/uaFamily";
import { getIP, checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    const rl = await checkRateLimit({ route: "sesslost", id: ip, limit: 1, windowSec: 3600 });
    if (!rl.allowed) return NextResponse.json({ ok: true, sampled: false });
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const family = `${uaFamily(req.headers.get("user-agent"))} · ${day}`;
    const dayKey = `stat:sesslost:${day}`;
    const p = redis.pipeline();
    p.incr(dayKey); p.expire(dayKey, 40 * 86400);
    p.lpush("stat:sesslost:ua", family); p.ltrim("stat:sesslost:ua", 0, 59);
    await p.exec();
    return NextResponse.json({ ok: true, sampled: true });
  } catch {
    return NextResponse.json({ ok: true, sampled: false });   // télémétrie : n'échoue jamais pour l'utilisateur
  }
}
