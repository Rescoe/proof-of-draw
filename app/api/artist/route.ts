// app/api/artist/route.ts
// GET  /api/artist  → retourne le profil artiste de la session courante
// POST /api/artist  → crée ou met à jour le profil artiste, lie tous les devices de session

import { NextRequest, NextResponse } from "next/server";
import {
  getArtist,
  getArtistByDevice,
  createOrUpdateArtist,
  linkDeviceToArtist,
  setArtistName,
  normalizeSlug,
  isSlugAvailable,
} from "@/lib/deviceStore";
import { getSession, setArtistIdInSession } from "@/lib/session";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET() {
  try {
    const session = await getSession();

    // Lookup prioritaire : artistId stocké dans le cookie de session
    if (session.artistId) {
      const profile = await getArtist(session.artistId);
      if (profile) return json({ profile });
      // artistId périmé → continuer sur le fallback device
    }

    // Fallback : cherche depuis le premier device de la session
    if (session.deviceIds.length === 0) return json({ profile: null });
    const profile = await getArtistByDevice(session.deviceIds[0]);
    return json({ profile });
  } catch (err) {
    console.error("[/api/artist GET]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");

    const session = await getSession();
    if (session.deviceIds.length === 0)
      return json({ error: "Aucun device en session" }, 401);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const displayName         = typeof body.displayName         === "string" ? body.displayName.trim()         : "";
    const bio                 = typeof body.bio                 === "string" ? body.bio.trim()                 : undefined;
    const profileImageBlockHash = typeof body.profileImageBlockHash === "string" ? body.profileImageBlockHash : undefined;
    const profileImageCrop = (() => {
      const c = body.profileImageCrop;
      if (c && typeof c === "object" && !Array.isArray(c)) {
        const { cx, cy, zoom } = c as Record<string, unknown>;
        if (typeof cx === "number" && typeof cy === "number" && typeof zoom === "number") {
          return { cx, cy, zoom };
        }
      }
      return undefined;
    })();

    // Slug optionnel : normalisé + vérifié unique
    let slug: string | undefined;
    if (typeof body.slug === "string" && body.slug.trim()) {
      slug = normalizeSlug(body.slug);
      if (slug.length < 3) return json({ error: "Slug trop court (3 caractères min)" }, 400);

      // Résoudre l'artistId existant pour la vérification d'unicité
      let checkArtistId = session.artistId;
      if (!checkArtistId) {
        for (const did of session.deviceIds) {
          const a = await getArtistByDevice(did);
          if (a) { checkArtistId = a.artistId; break; }
        }
      }
      const available = await isSlugAvailable(slug, checkArtistId);
      if (!available) return json({ error: "Ce nom est déjà utilisé par un autre artiste" }, 409);
    }

    if (!displayName)
      return json({ error: "displayName requis" }, 400);

    // Résoudre l'artistId existant : cookie > device lookup
    let existingArtistId = session.artistId;
    if (!existingArtistId) {
      for (const deviceId of session.deviceIds) {
        const existing = await getArtistByDevice(deviceId);
        if (existing) { existingArtistId = existing.artistId; break; }
      }
    }

    const profile = await createOrUpdateArtist(
      displayName,
      bio,
      existingArtistId,
      profileImageBlockHash,
      profileImageCrop,
      slug,
    );

    // Lier tous les devices de la session à ce profil + mettre à jour artistName (rétrocompat)
    await Promise.all(
      session.deviceIds.map(async (deviceId) => {
        await linkDeviceToArtist(deviceId, profile.artistId);
        await setArtistName(deviceId, displayName);
      })
    );

    console.log(`[/api/artist] profil upsert artistId=${profile.artistId} devices=${session.deviceIds.length}`);

    // Stocker l'artistId dans le cookie de session pour le lookup rapide futur
    const res = NextResponse.json({ ok: true, profile }, {
      headers: { "Cache-Control": "private, no-store" },
    });
    await setArtistIdInSession(res, profile.artistId);
    return res;
  } catch (err) {
    console.error("[/api/artist POST]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
}
