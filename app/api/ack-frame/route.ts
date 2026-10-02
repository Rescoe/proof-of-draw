// app/api/ack-frame/route.ts
// L'ESP confirme qu'il a bien affiché la frame → on la supprime de Redis, et on ENREGISTRE ce qui est maintenant affiché
// sur cet écran (lib/displayState.ts) pour la vue réseau « en direct ».

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getDevice, ackFrameReceived } from "@/lib/deviceStore";
import { takeFrameForDeviceAck } from "@/lib/queue";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { redis } from "@/lib/redis";
import { recordDisplayed, DISPLAYS_CACHE_TAG, type DisplayKV } from "@/lib/displayState";

export async function POST(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  try {
    const body = await req.json();
    const { deviceId, frameId } = body;

    if (!deviceId || !frameId)
      return NextResponse.json({ error: "deviceId et frameId requis" }, { status: 400 });

    if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

    const device = await getDevice(deviceId);
    if (!device)
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });

    const [taken] = await Promise.all([
      takeFrameForDeviceAck(deviceId, device.screens, frameId),
      ackFrameReceived(deviceId), // Axe 2 : met à jour lastFrameReceivedAt
    ]);
    const cleared = taken !== null;

    // Ce que l'écran affiche maintenant. Jamais bloquant : l'ACK du firmware réussit quoi qu'il arrive.
    // `mode` (facultatif, firmware scene-v1) : "scene" si l'appareil a joué l'animation plutôt que la frame fixe.
    const mode = body.mode === "scene" ? "scene" : undefined;
    let shown = null;
    if (taken) {
      shown = await recordDisplayed(redis as unknown as DisplayKV, deviceId, taken.screen, taken.frame, "consensus", mode);
    } else {
      // Frame personnelle (dessin privé du propriétaire) : non supprimée par l'ACK, mais bien affichée.
      const raw = await redis.get(`personal:frame:${deviceId}`).catch(() => null);
      try {
        const pf = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (pf && pf.frameId === frameId && typeof pf.payload?.screen === "string" && device.screens.includes(pf.payload.screen)) {
          shown = await recordDisplayed(redis as unknown as DisplayKV, deviceId, pf.payload.screen, pf, "personal");
        }
      } catch { /* personal frame illisible : rien à enregistrer */ }
    }
    if (shown) revalidateTag(DISPLAYS_CACHE_TAG, { expire: 0 });

    console.log(`[/api/ack-frame] device=${deviceId} frameId=${frameId} cleared=${cleared} shown=${shown ? shown.kind : "-"}`);
    return NextResponse.json({ ok: true, cleared });
  } catch (err) {
    console.error("[/api/ack-frame]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
