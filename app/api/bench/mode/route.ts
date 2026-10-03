// POST /api/bench/mode — { deviceId, on } : active le « mode banc d'essai » (poll rapide ≈ 3 s pendant 30 min, extinction automatique).
// L'appareil le découvre à son prochain pull normal (≤ 60 s) : /api/pull ajoute { benchMode: true } pour un TFT 2.8" quand il est actif.

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { benchScreenOf } from "@/lib/bench/screens";
import { benchLog, clearBenchHistory, DEVICE_ID_REGEX, MODE_TTL_SEC, setBenchMode } from "@/lib/bench/store";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const deviceId = String(body.deviceId ?? "");
  if (!DEVICE_ID_REGEX.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  const device = await getDevice(deviceId);
  if (!benchScreenOf(device?.screens)) return NextResponse.json({ error: "Le banc d'essai ne concerne que les écrans TFT 2.8\", TFT 1.8\" et OLED" }, { status: 400 });
  const on = body.on === true;
  if (on) await clearBenchHistory(deviceId);   // chaque session de test repart d'un historique vide (1 commande)
  await setBenchMode(deviceId, on);
  await benchLog(deviceId, on ? "mode banc d'essai ACTIVÉ (30 min) — l'écran le lira à son prochain contrôle (≤ 1 min)" : "mode banc d'essai désactivé");
  return NextResponse.json({ ok: true, mode: on, expiresInSec: on ? MODE_TTL_SEC : 0 });
}
