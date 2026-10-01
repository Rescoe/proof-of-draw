// app/api/artist/devices/route.ts
// POST /api/artist/devices { deviceId, action: "attach" | "detach" }
//      POST /api/artist/devices { action: "attach-all" }
// Rattache un de MES appareils à MON profil artiste (plusieurs ESP = un seul artiste),
// ou le détache (il redevient un artiste à part). "attach-all" rattache d'un coup tous les
// appareils de ma session qui ne sont encore rattachés à aucun profil. Un appareil déjà
// rattaché à un autre profil n'est jamais repris.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getDevice, unlinkDeviceFromArtist } from "@/lib/deviceStore";
import { getArtistDeviceIds, resolveSessionArtist, attachDeviceToProfile } from "@/lib/artistDirectory";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(req: NextRequest) {
  try {
    if (await isBlacklisted(getIP(req))) return forbidden("Accès refusé");

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const action = body.action;
    if (action !== "attach" && action !== "detach" && action !== "attach-all") return json({ error: "action invalide" }, 400);

    const session = await getSession();

    // Mon profil : cookie d'abord, sinon celui d'un appareil de la session
    const profile = await resolveSessionArtist(session);
    if (!profile) return json({ error: "Créez d'abord votre profil artiste" }, 409);
    const artistId = profile.artistId;

    if (action === "attach-all") {
      const attached: string[] = [];
      for (const id of session.deviceIds) {
        const d = await getDevice(id);
        if (!d || d.artistId) continue;               // déjà rattaché (à moi ou à un autre) : on n'y touche pas
        if (await attachDeviceToProfile(id, profile, d)) attached.push(id);
      }
      return json({ ok: true, attached, artistId });
    }

    const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
    if (!DEVICE_ID_REGEX.test(deviceId)) return json({ error: "deviceId invalide" }, 400);

    // Cet appareil doit m'appartenir : dans ma session OU déjà rattaché à mon profil
    const mine = session.deviceIds.includes(deviceId) || (await getArtistDeviceIds(artistId)).has(deviceId);
    if (!mine) return json({ error: "Cet appareil ne vous appartient pas" }, 403);

    const device = await getDevice(deviceId);
    if (!device) return json({ error: "Appareil ou profil introuvable" }, 404);

    if (action === "attach") {
      await attachDeviceToProfile(deviceId, profile, device, { force: true });   // clic explicite
    } else {
      if (device.artistId !== artistId) return json({ error: "Cet appareil n'est pas rattaché à votre profil" }, 409);
      await unlinkDeviceFromArtist(deviceId);
    }

    return json({ ok: true, deviceId, artistId: action === "attach" ? artistId : null });
  } catch (err) {
    console.error("[/api/artist/devices POST]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
}
