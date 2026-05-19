// app/api/blocks-by-device/route.ts
// Expose les blocs détenus ou dessinés par un device.
// Base du futur système d'échange/transaction de dessins.
//
// GET /api/blocks-by-device?deviceId=dev_XXXXXXXX[&limit=50]
//
// Réponse :
// {
//   deviceId: "dev_XXXXXXXX",
//   mined:  [{ blockHash, block }],  // blocs minés (ESP dont le vote a déclenché quorum)
//   drawn:  [{ blockHash, block }],  // blocs dessinés mais minés par un autre ESP
//   total:  { mined: N, drawn: N }
// }
//
// Les deux listes sont distinctes :
//   mined → chain:device:{id}:blocks  (minerDeviceId === deviceId)
//   drawn → chain:device:{id}:drawn   (artiste ≠ mineur)

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import type { Block } from "@/lib/chain";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const MAX_BLOCKS = 50;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

async function resolveHashes(hashes: string[]): Promise<{ blockHash: string; block: Block | null }[]> {
  if (hashes.length === 0) return [];
  return Promise.all(
    hashes.map(async (hash) => {
      const raw = await redis.get(`chain:block:${hash}`);
      if (!raw) return { blockHash: hash, block: null };
      try {
        const block: Block = typeof raw === "string" ? JSON.parse(raw) : raw;
        return { blockHash: hash, block };
      } catch {
        return { blockHash: hash, block: null };
      }
    })
  );
}

export async function GET(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");

    const url      = new URL(req.url);
    const deviceId = url.searchParams.get("deviceId") ?? "";
    const limit    = Math.min(
      parseInt(url.searchParams.get("limit") ?? String(MAX_BLOCKS)),
      MAX_BLOCKS
    );

    if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
      return json({ error: "deviceId invalide" }, 400);
    }

    const [minedHashes, drawnHashes, ownedHashesRaw] = await Promise.all([
      redis.lrange(`chain:device:${deviceId}:blocks`, 0, limit - 1) as Promise<string[]>,
      redis.lrange(`chain:device:${deviceId}:drawn`,  0, limit - 1) as Promise<string[]>,
      redis.smembers(`chain:device:${deviceId}:owned`) as Promise<string[]>,
    ]);

    const ownedHashes = (ownedHashesRaw ?? []).slice(0, limit);

    const [mined, drawn, owned] = await Promise.all([
      resolveHashes(minedHashes),
      resolveHashes(drawnHashes),
      resolveHashes(ownedHashes),
    ]);

    return json({
      deviceId,
      // mined  : historique permanent (ESP qui a déclenché le quorum)
      mined,
      // drawn  : blocs dessinés par cet ESP mais minés par un autre
      drawn,
      // owned  : blocs actuellement possédés (peut changer via transfer-block)
      owned,
      total: { mined: mined.length, drawn: drawn.length, owned: owned.length },
    });
  } catch (err) {
    console.error("[blocks-by-device] error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
}
