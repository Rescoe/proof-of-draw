// app/api/artist/route.ts
// GET  /api/artist  → retourne le profil artiste de la session courante
// POST /api/artist  → crée ou met à jour le profil artiste, lie tous les devices de session

import { NextRequest, NextResponse } from "next/server";
import {
  getArtist,
  getArtistByDevice,
  createOrUpdateArtist,
  deleteArtist,
  linkDeviceToArtist,
  setArtistName,
  getDevice,
  normalizeSlug,
  isSlugAvailable,
} from "@/lib/deviceStore";
import { getSession, setSession, setArtistIdInSession } from "@/lib/session";
import { getArtistDeviceIds, ensureSessionProfile } from "@/lib/artistDirectory";
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
    if (session.deviceIds.length === 0 && !session.artistId) return json({ profile: null });

    // Session avec des ESP = artiste : profil créé / ESP rattachés automatiquement (aucune saisie).
    // Le cookie est renouvelé au passage (400 j glissants).
    const profile = session.deviceIds.length > 0
      ? await ensureSessionProfile(session)
      : (session.artistId ? await getArtist(session.artistId) : null);
    const res = NextResponse.json({ profile }, { headers: { "Cache-Control": "private, no-store" } });
    if (profile) await setSession(res, { deviceIds: session.deviceIds, artistId: profile.artistId });
    return res;
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

    // Rattachement des appareils :
    //  • CRÉATION du profil : on rattache les appareils de la session encore libres
    //    (jamais ceux déjà rattachés à un autre profil) — le regroupement se corrige
    //    ensuite appareil par appareil via POST /api/artist/devices.
    //  • MISE À JOUR : aucun (re)rattachement — sinon chaque modification du profil
    //    réabsorberait des appareils que l'utilisateur a volontairement séparés
    //    (ex. l'ESP d'un autre artiste). On ne propage que le nom aux appareils du profil.
    if (!existingArtistId) {
      await Promise.all(
        session.deviceIds.map(async (deviceId) => {
          const d = await getDevice(deviceId);
          if (!d || d.artistId) return;
          await linkDeviceToArtist(deviceId, profile.artistId);
          await setArtistName(deviceId, displayName);
        })
      );
    } else {
      const linked = await getArtistDeviceIds(profile.artistId);
      await Promise.all([...linked].map((deviceId) => setArtistName(deviceId, displayName)));
    }

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

export async function DELETE() {
  try {
    const session = await getSession();

    // Résoudre l'artistId : cookie > device lookup
    let artistId = session.artistId;
    if (!artistId) {
      for (const deviceId of session.deviceIds) {
        const p = await getArtistByDevice(deviceId);
        if (p) { artistId = p.artistId; break; }
      }
    }

    if (!artistId) {
      return NextResponse.json({ error: "Aucun profil artiste associé à cette session" }, { status: 404 });
    }

    await deleteArtist(artistId);
    console.log(`[/api/artist DELETE] profil supprimé artistId=${artistId}`);

    // Effacer artistId du cookie de session
    const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    await setSession(res, { deviceIds: session.deviceIds, artistId: undefined });
    return res;
  } catch (err) {
    console.error("[/api/artist DELETE]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
