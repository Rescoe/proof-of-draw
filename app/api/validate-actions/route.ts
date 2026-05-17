// app/api/validate-actions/route.ts
// Distribue une tâche de validation des actions à un ESP disponible.
// L'ESP appelle cette route pour recevoir un actionsHash à vérifier.
// Utilisé par la ré-validation partielle (Axe 3).

import { NextRequest, NextResponse } from "next/server";
import { popObsTask, getBlockByHash, getBlockActions } from "@/lib/chain";
import { getDevice } from "@/lib/deviceStore";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;

export async function POST(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  let body: { deviceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { deviceId } = body;
  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }

  const device = await getDevice(deviceId);
  if (!device) return NextResponse.json({ error: "Device inconnu" }, { status: 404 });

  // Dépiler une tâche d'observation
  const task = await popObsTask();
  if (!task || !task.blockHashes?.length) {
    return NextResponse.json({ task: null });
  }

  // Trouver un bloc compatible avec les écrans de cet ESP
  for (const hash of task.blockHashes) {
    const block = await getBlockByHash(hash);
    if (!block) continue;
    if (!device.screens.includes(block.poolScreen)) continue;

    const actions = await getBlockActions(hash);
    return NextResponse.json({
      task: {
        type:       "validate-actions",
        blockHash:  hash,
        actionsHash: block.actionsHash,
        actions,        // séquence complète pour que l'ESP recalcule le score
      },
    });
  }

  // Aucun bloc compatible → remettre en queue
  // (Dans une vraie implémentation on remettrait dans la queue, ici on abandonne silencieusement)
  return NextResponse.json({ task: null });
}
