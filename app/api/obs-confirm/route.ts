// app/api/obs-confirm/route.ts
// Un ESP idle confirme qu'il a re-vérifié un ensemble de blocs antérieurs.
// Met à jour le tableau `revalidated` du bloc qui avait émis la tâche.
//
// Le corps attend :
// {
//   deviceId:        "dev_XXXXXXXX",
//   blockHashes:     ["abc123...", "def456..."],   // hashes des blocs vérifiés
//   targetBlockHash: "ghi789..."                   // hash du bloc qui contient les entrées
// }

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getBlockByHash, getChainHead } from "@/lib/chain";
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

  const { deviceId, blockHashes, targetBlockHash } = body as {
    deviceId:        string;
    blockHashes:     unknown;
    targetBlockHash: unknown;
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

  // ── Résoudre le bloc cible ───────────────────────────────────────────────────
  // Priorité :
  //   1. targetBlockHash fourni par le client (bloc qui a émis la tâche d'obs)
  //   2. chain:head courant
  //   3. Recherche dans les 10 derniers blocs (fallback si nouveau bloc miné entre-temps)

  let targetBlock = null;

  if (typeof targetBlockHash === "string" && /^[0-9a-f]{64}$/.test(targetBlockHash)) {
    targetBlock = await getBlockByHash(targetBlockHash);
  }

  if (!targetBlock) {
    targetBlock = await getChainHead();
  }

  // Si le bloc trouvé n'a pas de revalidated correspondant, chercher dans les récents
  if (targetBlock && (!targetBlock.revalidated?.length ||
      !targetBlock.revalidated.some(r => validHashes.includes(r.blockHash)))) {
    const recentHashes = await redis.lrange<string>("chain:recent", 0, 9);
    for (const bHash of recentHashes) {
      if (bHash === targetBlock.blockHash) continue;  // déjà essayé
      const block = await getBlockByHash(bHash);
      if (!block?.revalidated?.length) continue;
      if (block.revalidated.some(r => validHashes.includes(r.blockHash))) {
        targetBlock = block;
        break;
      }
    }
  }

  if (!targetBlock) return json({ ok: true, confirmed: 0, note: "Chaîne vide" });

  if (!targetBlock.revalidated?.length)
    return json({ ok: true, confirmed: 0, note: "Pas de tâche de revalidation" });

  // ── Mise à jour des entrées correspondantes ──────────────────────────────────
  const now = Date.now();
  let changed = 0;

  const newRevalidated = targetBlock.revalidated.map((r) => {
    if (!validHashes.includes(r.blockHash)) return r;
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
      ...targetBlock,
      revalidated:  newRevalidated,
      obsConfirmed: allConfirmed,
    };

    // Mettre à jour le bloc dans Redis
    await redis.set(`chain:block:${targetBlock.blockHash}`, JSON.stringify(updatedBlock));

    // Mettre à jour chain:head si c'est lui
    const head = await getChainHead();
    if (head?.blockHash === targetBlock.blockHash) {
      await redis.set("chain:head", JSON.stringify(updatedBlock));
    }

    console.log(
      `[obs-confirm] device=${deviceId} block=#${targetBlock.blockIndex}` +
      ` confirmed=${changed}/${validHashes.length} allDone=${allConfirmed}`,
    );
  } else {
    console.log(
      `[obs-confirm] device=${deviceId} block=#${targetBlock.blockIndex}` +
      ` no new confirmations (already confirmed or no match)`,
    );
  }

  return json({ ok: true, confirmed: changed });
}
