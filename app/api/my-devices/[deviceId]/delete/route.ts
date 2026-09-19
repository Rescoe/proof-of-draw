// app/api/my-devices/[deviceId]/delete/route.ts
// Supprime définitivement un device (deviceStore.deleteDevice existait déjà
// mais n'était exposé par aucune route) — pour un ESP dupliqué/orphelin
// (ex. ré-appairé sous un nouveau deviceId après une perte de MAC/pairCode).
// Ne touche PAS aux blocs déjà minés (chain:block:*, permanents) : si des
// blocs doivent rester rattachables, transfère-les d'abord vers un autre
// device via POST /api/transfer-blocks.

import { NextRequest, NextResponse } from "next/server";
import { deleteDevice } from "@/lib/deviceStore";
import { sessionOwnsDevice, removeDeviceFromSession } from "@/lib/session";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const { deviceId } = await params;
  if (!deviceId) return NextResponse.json({ error: "deviceId requis" }, { status: 400 });

  if (!(await sessionOwnsDevice(deviceId))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  await deleteDevice(deviceId);

  const res = NextResponse.json({ ok: true });
  await removeDeviceFromSession(res, deviceId);
  return res;
}
