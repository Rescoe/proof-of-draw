// app/api/obs-confirm/route.ts
// Un ESP idle envoie la confirmation qu'il a "observé" (re-vérifié) un ensemble
// de blocs antérieurs. Met à jour le tableau `revalidated` du bloc head courant.
// Aucun changement d'affichage côté ESP — confirmation purement réseau.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getChainHead } from "@/lib/chain";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { getDevice } from "@/lib/deviceStore";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON invalide" }, 400);
  }

  const { deviceId, blockHashes } = body as {
    deviceId:    string;
    blockHashes: unknown;
  };

  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId))
    return json({ error: "deviceId invalide" }, 400);

  if (!Array.isArray(blockHashes) || blockHashes.length === 0)
    return json({ error: "blockHashes requis (array non vide)" }, 400);

  // Valider chaque hash (64 chars hex)
  const validHashes = (blockHashes as unknown[])
    .filter((h): h is string => typeof h === "string" && /^[0-9a-f]{64}$/.test(h));

  if (validHashes.length === 0)
    return json({ error: "Aucun hash valide" }, 400);

  if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

  const device = await getDevice(deviceId);
  if (!device) return json({ error: "device inconnu" }, 404);

  // ── Lecture du bloc head ────────────────────────────────────────────────────
  const head = await getChainHead();
  if (!head) return json({ ok: true, confirmed: 0, note: "Chaîne vide" });

  // Si le bloc head n'a pas de tableau revalidated, rien à faire
  if (!head.revalidated || head.revalidated.length === 0)
    return json({ ok: true, confirmed: 0, note: "Pas de tâche de revalidation" });

  // ── Mise à jour des entrées correspondantes ─────────────────────────────────
  let changed = 0;
  const now = Date.now();

  const newRevalidated = head.revalidated.map((r) => {
    if (!validHashes.includes(r.blockHash)) return r;
    // Ajouter deviceId aux observers si pas déjà présent
    if (r.observerIds.includes(deviceId)) return r;
    changed++;
    return {
      ...r,
      observerIds: [...r.observerIds, deviceId],
      confirmedAt: r.confirmedAt > 0 ? r.confirmedAt : now,
    };
  });

  if (changed > 0) {
    const allConfirmed = newRevalidated.every((r) => r.confirmedAt > 0);
    const updatedBlock = {
      ...head,
      revalidated:  newRevalidated,
      obsConfirmed: allConfirmed,
    };

    await Promise.all([
      redis.set("chain:head",                          JSON.stringify(updatedBlock)),
      redis.set(`chain:block:${head.blockHash}`,       JSON.stringify(updatedBlock)),
    ]);

    console.log(
      `[obs-confirm] device=${deviceId} confirmed=${changed}/${validHashes.length}` +
      ` block=#${head.blockIndex} allDone=${allConfirmed}`,
    );
  }

  return json({ ok: true, confirmed: changed });
}
