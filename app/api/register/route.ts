// app/api/register/route.ts
// Ajout : indexation dans pool:screen:{screenId} pour le broadcast inter-devices

import { NextRequest, NextResponse } from "next/server";
import { registerDevice, updateDevicePublicKey } from "@/lib/deviceStore";
import { invalidateNetworkSnapshot } from "@/lib/networkSnapshot";
import { decideKeyUpdate, pinEnabledFromEnv } from "@/lib/keyPinning";
import {
  checkRateLimit, isBlacklisted, isDeviceCapReached,
  getIP, tooManyRequests, forbidden,
} from "@/lib/rateLimit";
import { redis } from "@/lib/redis";
import { parseSceneCapability } from "@/lib/scene/delivery";

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
    const { mac, screens, firmware, publicKey } = body;

    if (!mac || typeof mac !== "string")
      return NextResponse.json({ error: "mac requis" }, { status: 400 });
    if (!Array.isArray(screens) || screens.length === 0)
      return NextResponse.json({ error: "screens[] requis" }, { status: 400 });

    const macNorm = mac.toLowerCase().trim();

    // 3. Device cap — vérifié seulement pour les nouveaux devices
    const capReached = await isDeviceCapReached();
    // scene-v1 : déclaration facultative (firmware OLED/TFT compatibles) ; toute valeur invalide = pas de scene-v1.
    const { device, isNew } = await registerDevice(macNorm, screens, firmware ?? "unknown", parseSceneCapability(body.sceneCapability));

    if (isNew && capReached) {
      return NextResponse.json(
        { error: "Capacité maximale atteinte. Réessayez plus tard." },
        { status: 503 }
      );
    }

    // ── 4. Indexation dans les pools par type d'écran ────────────────────────
    // On met à jour les pools à chaque register (re-register inclus) pour :
    // - gérer les changements de screens (firmware update)
    // - rafraîchir la présence du device dans la pool
    //
    // Stratégie :
    // a) Récupérer les screens précédemment enregistrés pour ce device (depuis l'objet device)
    //    → si les screens ont changé, retirer le deviceId des anciennes pools
    // b) Ajouter le deviceId dans les nouvelles pools
    //
    // Note : on utilise des Redis Sets (SADD/SREM) — idempotent, pas de doublons.

    // Screens précédents stockés dans le device (disponibles après registerDevice)
    // Si le device est nouveau, device.screens === screens (pas de diff à faire)
    const prevScreens: string[] = device.screens ?? [];
    const nextScreens: string[] = screens;

    const removedScreens = prevScreens.filter((s) => !nextScreens.includes(s));
    const addedScreens   = nextScreens.filter((s) => !prevScreens.includes(s));
    // Screens inchangés : on refresh quand même le score pour que le Set reste frais
    const unchangedScreens = nextScreens.filter((s) => prevScreens.includes(s));

    const poolOps: Promise<unknown>[] = [];

    // Retirer des anciennes pools si les screens ont changé
    for (const screenId of removedScreens) {
      poolOps.push(redis.srem(`pool:screen:${screenId}`, device.deviceId));
    }

    // Ajouter dans les nouvelles pools (SADD est idempotent)
    for (const screenId of [...addedScreens, ...unchangedScreens]) {
      poolOps.push(redis.sadd(`pool:screen:${screenId}`, device.deviceId));
    }

    // CRITIQUE : on attend le résultat — si un ESP n'est pas dans pool:screen:*
    // il ne recevra jamais pendingValidation et ne pourra pas participer au minage.
    try {
      await Promise.all(poolOps);
      console.log(`[/api/register] pool ok device=${device.deviceId} screens=${screens.join(",")}`);
    } catch (err) {
      // Non-fatal : le device est enregistré, la pool sera rafraîchie au prochain boot
      console.error("[/api/register] pool update error (non-fatal):", err);
    }

    // Stocker la clé publique ED25519 si fournie (firmware v2+)
    // Validation stricte : exactement 64 chars hex (32 bytes)
    if (typeof publicKey === "string" && /^[a-f0-9]{64}$/i.test(publicKey)) {
      // P0 « validation réelle » : avec PIN_DEVICE_KEY=true, la première clé est fixée (docs/CHANTIER_VALIDATION_REELLE.md § 5.6)
      const decision = decideKeyUpdate(device.publicKey, publicKey.toLowerCase(), pinEnabledFromEnv());
      if (decision === "refuse") {
        console.warn(`[/api/register] clé publique différente refusée device=${device.deviceId} (épinglage actif)`);
        return NextResponse.json({ error: "Clé publique déjà enregistrée pour cet appareil" }, { status: 409 });
      }
      if (decision === "set") await updateDevicePublicKey(device.deviceId, publicKey.toLowerCase());
    }

    const host =
      process.env.NEXT_PUBLIC_BASE_URL ??
      (req.headers.get("x-forwarded-proto") && req.headers.get("x-forwarded-host")
        ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("x-forwarded-host")}`
        : `http://${req.headers.get("host")}`);

    const primaryScreen = screens[0];
    // Nouvel appareil seulement : un ESP non appairé se ré-enregistre chaque minute — invalider à chaque fois ferait reconstruire la vue en boucle
    // (≈ 8 commandes par reconstruction). Un firmware mis à jour se voit au plus tard après le TTL de repli (300 s).
    if (isNew) invalidateNetworkSnapshot();

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