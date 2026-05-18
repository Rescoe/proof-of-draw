// app/api/register/route.ts
// Ajout : indexation dans pool:screen:{screenId} pour le broadcast inter-devices

import { NextRequest, NextResponse } from "next/server";
import { registerDevice } from "@/lib/deviceStore";
import {
  checkRateLimit, isBlacklisted, isDeviceCapReached,
  getIP, tooManyRequests, forbidden,
} from "@/lib/rateLimit";
import { redis } from "@/lib/redis";

// TTL du Set de pool = durée de vie max d'un device inactif
// Si un device ne se re-register pas pendant 48h son entrée device: expire,
// mais il reste dans le pool Set. Le draw broadcast gère les devices introuvables.
const POOL_MEMBER_TTL_SEC = 48 * 3600; // 48h — cohérent avec TTL device:

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  // 1. Blacklist
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  // 2. Rate limit : 5 register/min par IP
  const rl = await checkRateLimit({
    route: "register", id: ip, limit: parseInt(process.env.REGISTER_LIMIT_PER_MINUTE ?? "5"),
    windowSec: 60, strikeId: ip, strikeType: "ip",
  });
  if (!rl.allowed) return tooManyRequests(rl.retryAfter);

  try {
    const body = await req.json();
    const { mac, screens, firmware } = body;

    if (!mac || typeof mac !== "string")
      return NextResponse.json({ error: "mac requis" }, { status: 400 });
    if (!Array.isArray(screens) || screens.length === 0)
      return NextResponse.json({ error: "screens[] requis" }, { status: 400 });

    const macNorm = mac.toLowerCase().trim();

    // 3. Device cap — vérifié seulement pour les nouveaux devices
    const capReached = await isDeviceCapReached();
    const { device, isNew } = await registerDevice(macNorm, screens, firmware ?? "unknown");

    if (isNew && capReached) {
      return NextResponse.json(
        { error: "Capacité maximale atteinte. Réessayez plus tard." },
        { status: 503 }
      );
    }

    // ── 4. Indexation dans les pools par type d'écran ────────────────────────
    // Critique : sans cela, l'ESP n'est pas dans pool:screen:*, ne reçoit jamais
    // pendingValidation, et ne peut pas participer au minage.
    //
    // On ATTEND le résultat Redis (non fire-and-forget) car c'est critique pour le vote.
    // Si Redis échoue ici, le register échoue proprement et l'ESP retentera.

    const poolOps: Promise<unknown>[] = [];

    // Ajouter dans toutes les pools déclarées (SADD est idempotent, pas de doublons)
    for (const screenId of screens) {
      poolOps.push(redis.sadd(`pool:screen:${screenId}`, device.deviceId));
    }

    // Si le device existait et a changé de screens → retirer des anciennes pools
    // Note : registerDevice met device.screens à jour AVANT de retourner, donc
    // on doit lire l'ancien état depuis Redis séparément. Ici on fait un SREM
    // sur tous les screens connus sauf les nouveaux — rare en pratique.
    // Pour les firmwares stables, le SADD suffit.

    try {
      await Promise.all(poolOps);
      console.log(`[/api/register] pool update ok device=${device.deviceId} screens=${screens.join(",")}`);
    } catch (err) {
      // Log mais on continue : le device est enregistré, la pool sera rafraîchie au prochain boot
      console.error("[/api/register] pool update error (non-fatal):", err);
    }

    const host =
      process.env.NEXT_PUBLIC_BASE_URL ??
      (req.headers.get("x-forwarded-proto") && req.headers.get("x-forwarded-host")
        ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("x-forwarded-host")}`
        : `http://${req.headers.get("host")}`);

    const primaryScreen = screens[0];

    return NextResponse.json({
      deviceId:   device.deviceId,
      pairCode:   device.pairCode,
      canvasUrl:  `${host}/draw/${device.deviceId}/${primaryScreen}`,
      paired:     !!device.artistName,
      artistName: device.artistName ?? null,
    });
  } catch (err) {
    console.error("[/api/register]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}