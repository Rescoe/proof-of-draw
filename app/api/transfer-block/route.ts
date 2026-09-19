// app/api/transfer-block/route.ts
// Transfert de propriété d'un bloc entre deux devices.
// Proto-blockchain V1 : pas de signature cryptographique (sera remplacé par ED25519 en V2).
//
// POST /api/transfer-block
// {
//   blockHash:    "abc123...",     // hash complet du bloc à transférer
//   fromDeviceId: "dev_XXXXXXXX",  // propriétaire actuel
//   toDeviceId:   "dev_YYYYYYYY",  // nouveau propriétaire
// }
//
// Réponse :
// { ok: true, blockHash, fromDeviceId, toDeviceId, transferredAt }
//
// Ce que le serveur fait :
//   1. Vérifie que block.ownerDeviceId === fromDeviceId
//   2. SMOVE chain:device:{from}:owned → chain:device:{to}:owned
//   3. Met à jour block.ownerDeviceId dans Redis (chain:block:{hash})
//   4. Met à jour chain:head si c'est le bloc de tête
//   5. Pose une notification chain:notify:{to} pour le prochain pull du receveur
//
// NOTE SÉCURITÉ V1 : n'importe qui connaissant les deux deviceIds peut transférer.
// V2 : ajouter signature ED25519 du fromDevice sur le message de transfert.

import { NextRequest, NextResponse } from "next/server";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { sessionOwnsDevice } from "@/lib/session";
import { transferBlockOwnership } from "@/lib/chain";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const BLOCK_HASH_REGEX = /^[a-f0-9]{64}$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");

    let body: Record<string, string>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const { blockHash, fromDeviceId, toDeviceId } = body;

    if (!blockHash || !BLOCK_HASH_REGEX.test(blockHash))
      return json({ error: "blockHash invalide (64 hex chars requis)" }, 400);
    if (!fromDeviceId || !DEVICE_ID_REGEX.test(fromDeviceId))
      return json({ error: "fromDeviceId invalide" }, 400);
    if (!toDeviceId || !DEVICE_ID_REGEX.test(toDeviceId))
      return json({ error: "toDeviceId invalide" }, 400);
    if (fromDeviceId === toDeviceId)
      return json({ error: "fromDeviceId et toDeviceId identiques" }, 400);

    // Vérification session : seul le propriétaire du device peut transférer
    if (!(await sessionOwnsDevice(fromDeviceId))) {
      return json({ error: "Non autorisé — ce device n'appartient pas à votre session" }, 403);
    }

    const result = await transferBlockOwnership(blockHash, fromDeviceId, toDeviceId);
    if (!result.ok) return json({ error: result.error }, result.error === "Bloc introuvable" ? 404 : 403);

    console.log(
      `[transfer-block] hash=${blockHash.slice(0, 12)} from=${fromDeviceId} to=${toDeviceId}`
    );

    return json({
      ok:           true,
      blockHash,
      blockIndex:   result.blockIndex,
      fromDeviceId,
      toDeviceId,
      transferredAt: Date.now(),
    });

  } catch (err) {
    console.error("[transfer-block] error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
}
