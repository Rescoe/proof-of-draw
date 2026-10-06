// app/api/my-devices/merge/route.ts
// « Ancien ➜ Nouveau » : fusionne un de MES appareils dans un autre (blocs, historique, pools) puis supprime l'ancien. Voir lib/deviceMerge.ts.
//
// POST { fromDeviceId, toDeviceId, confirm }   confirm = le nom de l'ANCIEN appareil, retapé (même garde-fou que la suppression)
// Réponse : { ok: true, blocksTotal, blocksTransferred, blocksFailed, historyMoved }
// Autorisation : la session doit posséder les DEUX appareils (un voleur de deviceId ne peut ni voler ni détruire).

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { mergeDevices, planMerge } from "@/lib/deviceMerge";
import { removeDeviceFromSession, sessionOwnsDevice } from "@/lib/session";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(req: NextRequest) {
  try {
    if (await isBlacklisted(getIP(req))) return forbidden("Accès refusé");
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const fromId = body.fromDeviceId, toId = body.toDeviceId;
    // Droits d'abord, sur les deux appareils (avant toute lecture de leurs fiches)
    if (typeof fromId !== "string" || typeof toId !== "string") return json({ error: "fromDeviceId et toDeviceId requis" }, 400);
    if (!(await sessionOwnsDevice(fromId)) || !(await sessionOwnsDevice(toId))) return json({ error: "Non autorisé — les deux appareils doivent vous appartenir" }, 403);

    const [from, to] = await Promise.all([getDevice(fromId), getDevice(toId)]);
    const plan = planMerge(fromId, toId, body.confirm, from, to);
    if (!plan.ok) return json({ error: plan.error }, plan.status);

    const result = await mergeDevices(fromId, toId);
    const res = json({ ok: true, ...result });
    await removeDeviceFromSession(res, fromId);
    return res;
  } catch (err) {
    console.error("[/api/my-devices/merge]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
}
