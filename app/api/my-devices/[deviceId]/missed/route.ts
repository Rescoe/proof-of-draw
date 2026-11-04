// app/api/my-devices/[deviceId]/missed/route.ts
// GET /api/my-devices/{deviceId}/missed — œuvres récentes que les écrans de CET appareil auraient dû recevoir et n'ont pas affichées
// (hors ligne pendant la validité de la frame, ~42 min). Propriétaire seulement. Le bouton « Rattraper » du profil réaffiche ensuite l'une d'elles
// par /api/send-to-screen. Coût : 1 GET appareil + 1 MGET des affichages + 1 LRANGE + 1 MGET des blocs = 4 commandes, à la demande de l'utilisateur
// (jamais en arrière-plan).

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { sessionOwnsDevice } from "@/lib/session";
import { convertedScreensOf, getDevice } from "@/lib/deviceStore";
import { getBlocksAligned } from "@/lib/chain";
import { readShownRecords, type DisplayKV } from "@/lib/displayState";
import { animCapable } from "@/lib/anim/pointer";
import { showsFixedWorks } from "@/lib/fixedWorks";
import { pickMissedWorks, type MissedWork } from "@/lib/missedWorks";
import { getIP, isBlacklisted, forbidden, checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
const RECENT_SCAN = 25;   // 25 derniers blocs du réseau : au rythme actuel, plusieurs jours

export async function GET(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");
    const { deviceId } = await params;
    if (!/^dev_[A-Z0-9]{8}$/.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
    if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });

    const rl = await checkRateLimit({ route: "missed", id: deviceId, limit: 12, windowSec: 600 });
    if (!rl.allowed) return tooManyRequests(rl.retryAfter);

    const device = await getDevice(deviceId);
    if (!device) return NextResponse.json({ error: "Appareil introuvable" }, { status: 404 });
    const screens = device.screens.filter((s) => s !== "sensor");
    if (screens.length === 0) return NextResponse.json({ screens: {} }, { headers: { "Cache-Control": "private, no-store" } });

    const [shown, hashes] = await Promise.all([
      readShownRecords(redis as unknown as DisplayKV, screens.map((screen) => ({ deviceId, screen }))),
      redis.lrange<string>("chain:recent", 0, RECENT_SCAN - 1),
    ]);
    const blocks = await getBlocksAligned(hashes ?? []);
    const flat = blocks.map((b) => (b ? { blockHash: b.blockHash, blockIndex: b.blockIndex, poolScreen: b.poolScreen, kind: b.kind, workTitle: b.workTitle, minedAt: b.minedAt, drawArtistName: b.drawArtistName, artistName: b.artistName } : null));
    const converted = convertedScreensOf(device);

    const result: Record<string, { lastShownIndex: number | null; missed: MissedWork[] }> = {};
    for (const screen of screens) {
      const rec = shown[deviceId]?.[screen];
      const lastShownIndex = typeof rec?.blockIndex === "number" ? rec.blockIndex : null;
      result[screen] = {
        lastShownIndex,
        missed: pickMissedWorks(flat, {
          screen, lastShownIndex,
          animCapable: animCapable(device, screen),
          showsFixed: showsFixedWorks(device, screen),
          acceptsConverted: converted.includes(screen),
        }),
      };
    }
    return NextResponse.json({ screens: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[my-devices/missed]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
