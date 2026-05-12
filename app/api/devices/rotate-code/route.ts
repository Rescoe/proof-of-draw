// app/api/devices/rotate-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { rotatePairCode } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const { deviceId } = await req.json();
    if (!deviceId)
      return NextResponse.json({ error: "deviceId requis" }, { status: 400 });

    if (!(await sessionOwnsDevice(deviceId)))
      return NextResponse.json({ error: "Non autorisé" }, { status: 403 });

    const newCode = await rotatePairCode(deviceId);
    if (!newCode)
      return NextResponse.json({ error: "Device introuvable" }, { status: 404 });

    return NextResponse.json({ ok: true, pairCode: newCode });
  } catch (err) {
    console.error("[/api/devices/rotate-code]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}