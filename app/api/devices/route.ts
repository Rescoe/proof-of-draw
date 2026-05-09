// app/api/devices/route.ts
// GET /api/devices → liste tous les devices enregistrés
// Utilisé par le panel utilisateur ET par la page draw pour trouver le device

import { NextResponse } from "next/server";
import { getAllDevices } from "@/lib/deviceStore";

export async function GET() {
  try {
    const all = getAllDevices();

    // ✅ On renvoie { devices: [...] } pour être cohérent avec ce que
    // draw/page.tsx attend : data.devices?.find(...)
    return NextResponse.json({ devices: all });
  } catch (err) {
    console.error("[/api/devices] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}