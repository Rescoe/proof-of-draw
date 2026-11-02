// app/api/my-devices/[deviceId]/measures-public/route.ts
// Rend les mesures d'un capteur publiques (vue réseau + historique) ou privées. Requiert d'être le propriétaire de l'ESP.
//   POST { enabled: boolean }        interrupteur GÉNÉRAL (faux = aucune grandeur publique)
//   POST { kinds: ["temp","hum"] }   liste BLANCHE des grandeurs publiques (02/11/2026) ; une grandeur inconnue ou « jamais publique » est refusée (400). Les deux champs peuvent être envoyés ensemble.
// Miroir de accepts-ana-art. Coût Redis : une lecture + une écriture de la fiche (réglage manuel, rare).

import { NextRequest, NextResponse } from "next/server";
import { setMeasuresPublic, setMeasuresPublicKinds } from "@/lib/deviceStore";
import { chosenPublicKinds, sanitizePublicKinds } from "@/lib/measurePrivacy";
import { invalidateNetworkSnapshot } from "@/lib/networkSnapshot";
import { sessionOwnsDevice } from "@/lib/session";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const { deviceId } = await params;
  if (!deviceId) return NextResponse.json({ error: "deviceId requis" }, { status: 400 });

  if (!(await sessionOwnsDevice(deviceId))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  let body: { enabled?: boolean; kinds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean" && body.kinds === undefined) {
    return NextResponse.json({ error: "enabled (boolean) ou kinds (tableau) requis" }, { status: 400 });
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled doit être un booléen" }, { status: 400 });

  let device = null;
  if (body.kinds !== undefined) {
    const clean = sanitizePublicKinds(body.kinds);
    if (!clean || !Array.isArray(body.kinds) || clean.length !== new Set(body.kinds).size) return NextResponse.json({ error: "kinds : tableau de grandeurs publiables connues requis" }, { status: 400 });
    device = await setMeasuresPublicKinds(deviceId, clean);
  }
  if (typeof body.enabled === "boolean") device = await setMeasuresPublic(deviceId, body.enabled);
  if (!device) return NextResponse.json({ error: "Device introuvable" }, { status: 404 });

  invalidateNetworkSnapshot();   // la vue réseau cesse d'exposer une grandeur dès le prochain rendu (le cache du CDN de /api/sensor?public=1 expire en 2 min au plus)
  return NextResponse.json({ ok: true, measuresPublic: device.measuresPublic !== false, kinds: chosenPublicKinds(device) });
}
