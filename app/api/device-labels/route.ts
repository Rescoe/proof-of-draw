// app/api/device-labels/route.ts
// GET /api/device-labels?ids=dev_AAAAAAAA,dev_BBBBBBBB  → { labels: { [deviceId]: { name, artistName, screens } } }
// Libellés LISIBLES d'appareils pour l'explorateur de blocs (« Mineur » / « Propriétaire » n'affichaient qu'un identifiant).
// Public mais minimal : nom de l'appareil, nom d'artiste et types d'écrans — rien d'autre (jamais code de jumelage, clés, propriétaire interne).
// Coût : au plus 4 GET Redis, uniquement quand quelqu'un ouvre le détail d'un bloc ; mis en cache 60 s côté CDN.

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const MAX_IDS = 4;

export async function GET(req: NextRequest) {
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => DEVICE_ID_REGEX.test(s)))].slice(0, MAX_IDS);
  if (ids.length === 0) return NextResponse.json({ labels: {} });

  const devices = await Promise.all(ids.map((id) => getDevice(id).catch(() => null)));
  const labels: Record<string, { name: string | null; artistName: string | null; screens: string[] }> = {};
  ids.forEach((id, i) => {
    const d = devices[i];
    if (!d) return;   // appareil supprimé ou expiré : le client garde l'identifiant seul
    labels[id] = {
      name: d.deviceName?.trim() || null,
      artistName: d.artistName?.trim() || null,
      screens: Array.isArray(d.screens) ? d.screens : [],
    };
  });
  return NextResponse.json({ labels }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
