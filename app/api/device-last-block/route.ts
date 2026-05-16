// app/api/device-last-block/route.ts
// Retourne le dernier bloc validé par un device donné.
// Scanne les 20 blocs les plus récents de chain:recent.
// Appelé à la demande depuis le SidePanel quand un device est sélectionné.

import { NextRequest, NextResponse } from "next/server";
import { getBlockByHash, getBlockImage } from "@/lib/chain";
import { redis } from "@/lib/redis";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");

    const deviceId = new URL(req.url).searchParams.get("deviceId");
    if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
      return json({ error: "deviceId invalide", block: null, imagePayload: null }, 400);
    }

    // Scan les 20 derniers blocs pour trouver le plus récent de ce device
    const hashes = await redis.lrange<string>("chain:recent", 0, 19);
    if (!hashes || hashes.length === 0) {
      return json({ block: null, imagePayload: null });
    }

    // Fetch en parallèle puis filtre par deviceId
    const blocks = await Promise.all(hashes.map((h) => getBlockByHash(h)));
    const lastBlock = blocks.find((b) => b?.deviceId === deviceId) ?? null;

    if (!lastBlock) {
      return json({ block: null, imagePayload: null });
    }

    const imagePayload = await getBlockImage(lastBlock.blockHash);
    return json({ block: lastBlock, imagePayload });
  } catch (err) {
    console.error("[device-last-block] error:", err);
    return json({ error: "Erreur interne", block: null, imagePayload: null }, 500);
  }
}
