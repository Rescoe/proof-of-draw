// app/api/observer-result/route.ts
// L'ESP soumet le résultat de sa validation d'observer (re-validation d'un bloc antérieur).

import { NextRequest, NextResponse } from "next/server";
import { confirmBlockObservation } from "@/lib/chain";
import { getDevice } from "@/lib/deviceStore";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;

export async function POST(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  let body: {
    deviceId?: string;
    blockHash?: string;
    actionsHash?: string; // hash recalculé par l'ESP
    confirmed?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { deviceId, blockHash, actionsHash, confirmed } = body;

  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }
  if (!blockHash || !actionsHash) {
    return NextResponse.json({ error: "blockHash et actionsHash requis" }, { status: 400 });
  }

  const device = await getDevice(deviceId);
  if (!device) return NextResponse.json({ error: "Device inconnu" }, { status: 404 });

  if (confirmed) {
    await confirmBlockObservation(blockHash, [deviceId]);
    console.log(`[observer-result] blockHash=${blockHash.slice(0, 12)} confirmed by ${deviceId}`);
  } else {
    console.warn(`[observer-result] DISPUTE blockHash=${blockHash.slice(0, 12)} by ${deviceId} actionsHash=${actionsHash.slice(0, 12)}`);
  }

  return NextResponse.json({ ok: true });
}
