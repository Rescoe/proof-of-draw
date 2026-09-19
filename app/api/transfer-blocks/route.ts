// app/api/transfer-blocks/route.ts
// Transfère TOUS les blocs minés/possédés par un device vers un autre en un
// seul appel — pour le cas "mon ESP a été ré-appairé sous un nouveau
// deviceId, je veux rapatrier l'historique de l'ancien". Réutilise
// transferBlockOwnership (lib/chain.ts), une transaction bloc par bloc,
// même logique que /api/transfer-block mais boucle sur chain:device:{from}:owned.
//
// POST /api/transfer-blocks { fromDeviceId, toDeviceId }
// Réponse : { ok: true, transferred: number, failed: string[] }

import { NextRequest, NextResponse } from "next/server";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { sessionOwnsDevice } from "@/lib/session";
import { getOwnedBlockHashes, transferBlockOwnership } from "@/lib/chain";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");

    let body: Record<string, string>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const { fromDeviceId, toDeviceId } = body;
    if (!fromDeviceId || !DEVICE_ID_REGEX.test(fromDeviceId))
      return json({ error: "fromDeviceId invalide" }, 400);
    if (!toDeviceId || !DEVICE_ID_REGEX.test(toDeviceId))
      return json({ error: "toDeviceId invalide" }, 400);
    if (fromDeviceId === toDeviceId)
      return json({ error: "fromDeviceId et toDeviceId identiques" }, 400);

    // Seul le propriétaire du device source (même orphelin/désactivé côté
    // Redis-device, tant qu'il est encore dans le cookie de session) peut
    // déclencher le transfert — mêmes règles que le transfert unitaire.
    if (!(await sessionOwnsDevice(fromDeviceId))) {
      return json({ error: "Non autorisé — ce device n'appartient pas à votre session" }, 403);
    }

    const hashes = await getOwnedBlockHashes(fromDeviceId);
    let transferred = 0;
    const failed: string[] = [];

    for (const hash of hashes) {
      const result = await transferBlockOwnership(hash, fromDeviceId, toDeviceId);
      if (result.ok) transferred++;
      else failed.push(hash.slice(0, 12));
    }

    console.log(`[transfer-blocks] from=${fromDeviceId} to=${toDeviceId} transferred=${transferred}/${hashes.length}`);

    return json({ ok: true, total: hashes.length, transferred, failed });
  } catch (err) {
    console.error("[transfer-blocks] error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
}
