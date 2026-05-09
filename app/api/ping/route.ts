// app/api/ping/route.ts
// ESP envoie { deviceId: "xxx" } toutes les ~30s.
// Serveur met à jour lastSeen et répond { ok: true }.
// ⚠ MODIFIÉ : suppression de l'ancien flow où le serveur pingait l'ESP par IP.

import { NextRequest, NextResponse } from "next/server";
import { pingDevice } from "@/lib/deviceStore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { deviceId } = body;

    if (!deviceId || typeof deviceId !== "string") {
      return NextResponse.json({ error: "deviceId requis" }, { status: 400 });
    }

    const device = pingDevice(deviceId);
    if (!device) {
      // Device inconnu → demander re-register
      return NextResponse.json({ ok: false, reregister: true }, { status: 200 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/ping] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}