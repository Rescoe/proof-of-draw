// app/api/public-screens/route.ts
// Retourne la liste des devices en mode prêt public.
// Utilisé par /draw (page de choix) et le profil pour afficher les ESP disponibles à d'autres artistes.

import { NextRequest, NextResponse } from "next/server";
import { getPublicDevices } from "@/lib/deviceStore";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";
import { ONLINE_MS } from "@/lib/pullBudget";

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  try {
    const devices = await getPublicDevices();
    return NextResponse.json({
      devices: devices.map((d) => ({
        deviceId:   d.deviceId,
        artistName: d.artistName ?? "Artiste inconnu",
        screens:    d.screens,
        isOnline:   Date.now() - d.lastPing < ONLINE_MS,
      })),
    });
  } catch {
    // Un échec n'est JAMAIS présenté comme une liste vide : le client distingue « aucun écran partagé » d'une erreur.
    return NextResponse.json({ error: "Liste des écrans partagés indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
