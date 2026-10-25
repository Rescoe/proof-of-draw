// app/api/my-devices/[deviceId]/logs/route.ts
// GET    → journal des échanges de l'appareil avec le serveur (7 derniers jours, 400 lignes au plus, la plus récente d'abord) — PROPRIÉTAIRE seulement.
// DELETE → efface ce journal. Écriture : lib/deviceLog.ts (enrobage des routes appelées par les cartes).
// Coût Redis : 1 LRANGE (lecture) ou 1 DEL (effacement), à la demande du propriétaire.

import { NextRequest, NextResponse } from "next/server";
import { sessionOwnsDevice } from "@/lib/session";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";
import { clearDevLog, readDevLog, DEVLOG_TTL_SEC } from "@/lib/deviceLog";

const ID_RE = /^dev_[A-Z0-9]{8}$/;

async function guard(req: NextRequest, params: Promise<{ deviceId: string }>): Promise<{ deviceId: string } | NextResponse> {
  if (await isBlacklisted(getIP(req))) return forbidden("Accès refusé");
  const { deviceId } = await params;
  if (!deviceId || !ID_RE.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  return { deviceId };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  const g = await guard(req, params);
  if (g instanceof NextResponse) return g;
  try {
    const entries = await readDevLog(g.deviceId);
    return NextResponse.json({ deviceId: g.deviceId, retentionDays: DEVLOG_TTL_SEC / 86400, entries }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[/api/my-devices/logs GET]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  const g = await guard(req, params);
  if (g instanceof NextResponse) return g;
  try {
    await clearDevLog(g.deviceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/my-devices/logs DELETE]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
