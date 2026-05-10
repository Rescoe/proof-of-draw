// app/api/devices/rotate-code/route.ts
// POST { deviceId } → génère un nouveau pairCode pour ce device
// Réservé au propriétaire (vérifié via session)
// Utile si le pairCode a fuité

import { NextRequest, NextResponse } from "next/server";
import { rotatePairCode } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const { deviceId } = await req.json();

    if (!deviceId) {
      return NextResponse.json({ error: "deviceId requis" }, { status: 400 });
    }

    const authorized = await sessionOwnsDevice(deviceId);
    if (!authorized) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
    }

    const newCode = rotatePairCode(deviceId);
    if (!newCode) {
      return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
    }

    console.log(`[/api/devices/rotate-code] nouveau code pour ${deviceId}`);

    // On renvoie le nouveau code au propriétaire uniquement
    return NextResponse.json({ ok: true, pairCode: newCode });
  } catch (err) {
    console.error("[/api/devices/rotate-code] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}