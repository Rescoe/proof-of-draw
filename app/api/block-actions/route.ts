// app/api/block-actions/route.ts
// Retourne la séquence d'actions d'un bloc (pour le tab "Actions" dans BlockDetail).

import { NextRequest, NextResponse } from "next/server";
import { getBlockActions, getBlockByHash } from "@/lib/chain";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const hash = new URL(req.url).searchParams.get("hash");
  if (!hash || hash.length < 10) {
    return NextResponse.json({ error: "hash invalide" }, { status: 400 });
  }

  const [block, actions] = await Promise.all([
    getBlockByHash(hash),
    getBlockActions(hash),
  ]);

  if (!block) return NextResponse.json({ error: "Bloc introuvable" }, { status: 404 });

  return NextResponse.json({ actions: actions ?? [], actionsHash: block.actionsHash });
}
