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
import { redis } from "@/lib/redis";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import type { Block } from "@/lib/chain";

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

    // 1. Charger le bloc
    const rawBlock = await redis.get(`chain:block:${blockHash}`);
    if (!rawBlock) return json({ error: "Bloc introuvable" }, 404);

    const block: Block = typeof rawBlock === "string" ? JSON.parse(rawBlock) : rawBlock;

    // 2. Vérifier la propriété
    const currentOwner = block.ownerDeviceId ?? block.minerDeviceId ?? block.deviceId;
    if (currentOwner !== fromDeviceId) {
      return json({
        error:         "fromDeviceId n'est pas le propriétaire actuel",
        currentOwner,
      }, 403);
    }

    // 3. Transfert atomique de la propriété Redis
    // SMOVE : retire du Set source et ajoute au Set destination atomiquement
    const moved = await redis.smove(
      `chain:device:${fromDeviceId}:owned`,
      `chain:device:${toDeviceId}:owned`,
      blockHash,
    );

    if (!moved) {
      // Le hash n'était pas dans :owned du fromDevice (désynchronisation possible)
      // On force l'ajout côté destination quand même
      await redis.sadd(`chain:device:${toDeviceId}:owned`, blockHash);
      console.warn(`[transfer-block] smove miss — forcé sadd to=${toDeviceId} hash=${blockHash.slice(0, 12)}`);
    }

    // 4. Mettre à jour ownerDeviceId dans le bloc stocké
    const transferredAt = Date.now();
    const updatedBlock: Block = { ...block, ownerDeviceId: toDeviceId };
    const writes: Promise<unknown>[] = [
      redis.set(`chain:block:${blockHash}`, JSON.stringify(updatedBlock)),
      // Notification au nouveau propriétaire (TTL 24h — couvrira son prochain pull)
      redis.set(`chain:notify:${toDeviceId}`, blockHash, { ex: 86400 }),
    ];

    // Mettre à jour chain:head si c'est le bloc de tête
    const headRaw = await redis.get("chain:head");
    if (headRaw) {
      const head: Block = typeof headRaw === "string" ? JSON.parse(headRaw) : headRaw;
      if (head.blockHash === blockHash) {
        writes.push(redis.set("chain:head", JSON.stringify(updatedBlock)));
      }
    }

    await Promise.all(writes);

    console.log(
      `[transfer-block] hash=${blockHash.slice(0, 12)} from=${fromDeviceId} to=${toDeviceId}`
    );

    return json({
      ok:           true,
      blockHash,
      blockIndex:   block.blockIndex,
      fromDeviceId,
      toDeviceId,
      transferredAt,
    });

  } catch (err) {
    console.error("[transfer-block] error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
}
