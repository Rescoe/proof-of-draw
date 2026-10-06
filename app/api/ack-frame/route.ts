// app/api/ack-frame/route.ts
// L'ESP confirme qu'il a bien affiché la frame → on la supprime de Redis, et on ENREGISTRE ce qui est maintenant affiché
// sur cet écran (lib/displayState.ts) pour la vue réseau « en direct ».
//
// COÛT REDIS : 1 MGET (blacklists, appareil, frames, frame personnelle) + 1 DEL (frame du consensus) + 1 SET (appareil : lastFrameReceivedAt)
// + 1 à 2 SET (affichage) ≈ 4 à 5 commandes. ≈ 11 avant le 05/10/2026 (3 lectures de blacklist, appareil ×2, une lecture par écran, saveDevice = 3 SET, frame personnelle).

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { writeDeviceKey, type Device } from "@/lib/deviceStore";
import { frameKey, parseStoredFrame, type StoredFrame } from "@/lib/queue";
import { getIP, forbidden } from "@/lib/rateLimit";
import { redis } from "@/lib/redis";
import { SCREEN_IDS } from "@/lib/screenProfiles";
import { recordDisplayed, DISPLAYS_CACHE_TAG, type DisplayKV } from "@/lib/displayState";

const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  try {
    const body = await req.json();
    const { deviceId, frameId } = body;
    // `screen` (facultatif, firmware multiscreen-2.3+) : sur un appareil multi-écran, une même frameId peut être en attente sur deux écrans
    // (conversion d'un dessin) → on n'acquitte que l'écran qui l'a réellement affichée.
    const ackScreen: string | null = typeof body.screen === "string" ? body.screen : null;

    if (!deviceId || !frameId)
      return NextResponse.json({ error: "deviceId et frameId requis" }, { status: 400 });

    // UN MGET : blacklists, appareil, frames de TOUS les types d'écran (on n'a plus à lire l'appareil d'abord), frame personnelle
    const FRAME_IDS = SCREEN_IDS as readonly string[];
    const raws = await redis.mget<unknown[]>(
      `bl:ip:${ip}`, `bl:dev:${deviceId}`, `device:${deviceId}`,
      ...FRAME_IDS.map((s) => frameKey(deviceId, s)), personalKey(deviceId),
    );
    if (raws[0] !== null || raws[1] !== null) return forbidden("Accès refusé");

    let device: Device | null = null;
    try { device = raws[2] ? (typeof raws[2] === "string" ? JSON.parse(raws[2] as string) : (raws[2] as Device)) : null; } catch { device = null; }
    if (!device)
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });

    // La frame du consensus dont l'id correspond (parmi les écrans de CET appareil)
    let taken: { frame: StoredFrame; screen: string } | null = null;
    FRAME_IDS.forEach((s, i) => {
      if (taken || !device!.screens.includes(s) || (ackScreen && s !== ackScreen)) return;
      const f = parseStoredFrame(raws[3 + i]);
      if (f && f.frameId === frameId) taken = { frame: f, screen: s };
    });
    const t = taken as { frame: StoredFrame; screen: string } | null;
    const cleared = t !== null;

    // Accusé de réception : 1 DEL (la frame) + 1 SET (la clé appareil seulement, pas mac/pair)
    device.lastFrameReceivedAt = Date.now();
    await Promise.all([
      t ? redis.del(frameKey(deviceId, t.screen)) : Promise.resolve(0),
      writeDeviceKey(device),
    ]);

    // Ce que l'écran affiche maintenant. Jamais bloquant : l'ACK du firmware réussit quoi qu'il arrive.
    // `mode` (facultatif, firmware scene-v1) : "scene" si l'appareil a joué l'animation plutôt que la frame fixe.
    const mode = body.mode === "scene" ? "scene" : undefined;
    let shown = null;
    if (t) {
      shown = await recordDisplayed(redis as unknown as DisplayKV, deviceId, t.screen, t.frame, "consensus", mode);
    } else {
      // Frame personnelle (dessin privé du propriétaire) : non supprimée par l'ACK, mais bien affichée.
      try {
        const pf = typeof raws[3 + FRAME_IDS.length] === "string" ? JSON.parse(raws[3 + FRAME_IDS.length] as string) : raws[3 + FRAME_IDS.length];
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
