// app/api/artist/devices/route.ts
// POST /api/artist/devices { deviceId, action: "attach" | "detach" }
// Rattache un de MES appareils à MON profil artiste (plusieurs ESP = un seul artiste),
// ou le détache (il redevient un artiste à part). Le regroupement est toujours un choix
// explicite de l'utilisateur : rien n'est rattaché automatiquement.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getArtist, getDevice, linkDeviceToArtist, unlinkDeviceFromArtist, setArtistName, setDeviceName,
} from "@/lib/deviceStore";
import { getArtistDeviceIds, resolveArtistIdForDevices } from "@/lib/artistDirectory";
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

    const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
    const action   = body.action;
    if (!DEVICE_ID_REGEX.test(deviceId)) return json({ error: "deviceId invalide" }, 400);
    if (action !== "attach" && action !== "detach") return json({ error: "action invalide" }, 400);

    const session = await getSession();

    // Mon profil : cookie d'abord, sinon celui d'un appareil de la session
    let artistId: string | null = session.artistId && (await getArtist(session.artistId)) ? session.artistId : null;
    if (!artistId) artistId = await resolveArtistIdForDevices(session.deviceIds);
    if (!artistId) return json({ error: "Créez d'abord votre profil artiste" }, 409);

    // Cet appareil doit m'appartenir : dans ma session OU déjà rattaché à mon profil
    const mine = session.deviceIds.includes(deviceId) || (await getArtistDeviceIds(artistId)).has(deviceId);
    if (!mine) return json({ error: "Cet appareil ne vous appartient pas" }, 403);

    const device  = await getDevice(deviceId);
    const profile = await getArtist(artistId);
    if (!device || !profile) return json({ error: "Appareil ou profil introuvable" }, 404);

    if (action === "attach") {
      // Conserver le nom d'origine ("Roubzi Tft") comme nom d'appareil avant d'adopter celui du profil
      if (!device.deviceName && device.artistName && device.artistName !== profile.displayName) {
        await setDeviceName(deviceId, device.artistName);
      }
      await linkDeviceToArtist(deviceId, artistId);
      await setArtistName(deviceId, profile.displayName);
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
