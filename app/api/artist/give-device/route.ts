// app/api/artist/give-device/route.ts
// Don / remise à zéro d'un de MES ESP.
//   GET  ?deviceId=dev_X                     → œuvres liées à cet ESP (aperçu pour choisir)
//   POST { deviceId, bequeath: string[] }    → les hashes listés sont légués (suivent l'ESP) ; toutes les
//        autres œuvres liées à l'ESP sont CONSERVÉES par mon profil. L'ESP est ensuite libéré :
//        hors du profil, noms effacés, nouveau code d'appairage (retourné) pour le nouveau propriétaire.
// Seul le propriétaire (session / profil) peut le faire : un voleur ne peut pas déclencher un don.

import { NextRequest, NextResponse } from "next/server";
import { getSession, removeDeviceFromSession } from "@/lib/session";
import { getAllDevices, getDevice, releaseDevice } from "@/lib/deviceStore";
import { getArtistBlocks, getArtistDeviceIds, relatedBlockHashes, resolveSessionArtist } from "@/lib/artistDirectory";
import { transferBlockOwnership, getBlockByHash } from "@/lib/chain";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function authorize(deviceId: string) {
  if (!DEVICE_ID_REGEX.test(deviceId)) return { error: json({ error: "deviceId invalide" }, 400) };
  const session = await getSession();
  const profile = await resolveSessionArtist(session);
  if (!profile) return { error: json({ error: "Aucun profil artiste pour cette session" }, 409) };
  const mine = session.deviceIds.includes(deviceId) || (await getArtistDeviceIds(profile.artistId)).has(deviceId);
  if (!mine) return { error: json({ error: "Cet appareil ne vous appartient pas" }, 403) };
  const device = await getDevice(deviceId);
  if (!device || device.artistId !== profile.artistId) {
    return { error: json({ error: "Cet appareil n'est pas rattaché à votre profil" }, 409) };
  }
  return { profile };
}

export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId") ?? "";
    const auth = await authorize(deviceId);
    if ("error" in auth) return auth.error;
    const blocks = await getArtistBlocks(new Set([deviceId]), 80, auth.profile.artistId);
    const related = await relatedBlockHashes(deviceId);
    return json({ blocks: blocks.filter((b) => related.has(b.blockHash)), total: related.size });
  } catch (err) {
    console.error("[/api/artist/give-device GET]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (await isBlacklisted(getIP(req))) return forbidden("Accès refusé");
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
    const auth = await authorize(deviceId);
    if ("error" in auth) return auth.error;
    const { profile } = auth;

    const related  = await relatedBlockHashes(deviceId);
    const asked    = Array.isArray(body.bequeath) ? body.bequeath.filter((h): h is string => typeof h === "string") : [];
    const bequeath = new Set(asked.filter((h) => related.has(h)));
    const keep     = [...related].filter((h) => !bequeath.has(h));

    // Autre appareil à moi : reçoit la propriété des œuvres conservées qui appartenaient à l'ESP donné
    const others = (await getAllDevices()).filter((d) => d.artistId === profile.artistId && d.deviceId !== deviceId);

    const ops = redis.pipeline();
    for (const h of keep) {
      ops.set(`chain:retained:${h}`, profile.artistId);
      ops.sadd(`artist:retained:${profile.artistId}`, h);
    }
    for (const h of bequeath) {
      ops.del(`chain:retained:${h}`);
      ops.srem(`artist:retained:${profile.artistId}`, h);
    }
    if (keep.length + bequeath.size > 0) await ops.exec();

    if (others[0]) {
      for (const h of keep) {
        const b = await getBlockByHash(h);
        if (b && (b.ownerDeviceId ?? b.minerDeviceId ?? b.deviceId) === deviceId) {
          await transferBlockOwnership(h, deviceId, others[0].deviceId);
        }
      }
    }

    const pairCode = await releaseDevice(deviceId);
    const res = json({ ok: true, pairCode, kept: keep.length, bequeathed: bequeath.size });
    await removeDeviceFromSession(res, deviceId);
    return res;
  } catch (err) {
    console.error("[/api/artist/give-device POST]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
}
