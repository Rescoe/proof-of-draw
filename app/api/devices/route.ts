// app/api/devices/route.ts
//
// GET /api/devices          → liste PUBLIQUE (artistName, isOnline, screens) — aucune donnée sensible
// GET /api/devices?mine=1   → liste PRIVÉE des devices de la session courante (OwnedDevice)
//
// La séparation public/privé se fait via le query param "mine".
// Les données sensibles (mac, pairCode, deviceId brut) ne sont jamais dans la vue publique.

import { NextRequest, NextResponse } from "next/server";
import { getAllDevices, getDevice, toPublicDevice, toOwnedDevice } from "@/lib/deviceStore";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const mine = req.nextUrl.searchParams.get("mine");

    if (mine === "1") {
      // ── Vue privée : uniquement les devices de la session ──────────────────
      const session = await getSession();

      if (session.deviceIds.length === 0) {
        return NextResponse.json({ devices: [] });
      }

      const owned = session.deviceIds
        .map((id) => getDevice(id))
        .filter(Boolean)
        .map((d) => toOwnedDevice(d!));

      return NextResponse.json({ devices: owned });
    }

    // ── Vue publique : tous les devices, sans données sensibles ───────────────
    const all = getAllDevices();
    const publicList = all
      .filter((d) => d.artistName) // ne lister que les devices onboardés
      .map((d) => toPublicDevice(d));

    return NextResponse.json({ devices: publicList });
  } catch (err) {
    console.error("[/api/devices] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}