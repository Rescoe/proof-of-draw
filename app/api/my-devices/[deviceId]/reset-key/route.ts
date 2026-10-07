// app/api/my-devices/[deviceId]/reset-key/route.ts
// Réinitialisation de la CLÉ PUBLIQUE d'un de MES appareils (Lot 2, chantier « validation réelle » P0, menace T2).
//
// Pourquoi : avec PIN_DEVICE_KEY=true, la première clé enregistrée est épinglée et une autre clé est refusée au re-register. Un propriétaire qui efface l'EEPROM de sa carte (ou qui téléverse
// sur une R4 : l'EEPROM est effacée) génère une NOUVELLE clé et serait bloqué. Cette route est le seul chemin de récupération : la SESSION du profil propriétaire autorise l'appareil à
// enregistrer une nouvelle clé au prochain /api/register. Aucun vote n'est possible avec une clé effacée tant que la carte n'a pas re-enregistré la sienne.
//
// POST { confirm: true } — requiert d'être le propriétaire (session). Réponse : { ok: true, hadKey }
// COÛT REDIS : 1 lecture + 1 écriture de la fiche de l'appareil, uniquement sur action du propriétaire (jamais de polling).

import { NextRequest, NextResponse } from "next/server";
import { resetDeviceKey } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  if (await isBlacklisted(getIP(req))) return forbidden("Accès refusé");
  const { deviceId } = await params;
  if (!deviceId) return NextResponse.json({ error: "deviceId requis" }, { status: 400 });
  // Droits d'abord, avant toute lecture de la fiche
  if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });

  let body: { confirm?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (body.confirm !== true) return NextResponse.json({ error: "confirm: true requis" }, { status: 400 });

  const result = await resetDeviceKey(deviceId);
  if (!result) return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
  console.warn(`[reset-key] clé publique effacée device=${deviceId} hadKey=${result.hadKey} (le prochain /api/register en enregistrera une nouvelle)`);
  return NextResponse.json({ ok: true, hadKey: result.hadKey }, { headers: { "Cache-Control": "private, no-store" } });
}
