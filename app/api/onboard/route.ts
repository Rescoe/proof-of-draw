// app/api/onboard/route.ts
// Lie un pairCode (ou MAC) à un artistName
// → met à jour le device dans le store
// → renvoie canvasUrl = /draw/deviceId/screenId

import { NextRequest, NextResponse } from "next/server";
import {
  getAllDevices,
  getDeviceByMac,
  setArtistName,
} from "@/lib/deviceStore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pairCode, mac, artistName } = body;

    if (!artistName?.trim()) {
      return NextResponse.json({ error: "artistName requis" }, { status: 400 });
    }

    let device = null;

    if (pairCode) {
      // Mode QR : on cherche par pairCode (sans tirets, insensible à la casse)
      const code = pairCode.replace(/-/g, "").toUpperCase().trim();
      const all = getAllDevices();
      device = all.find(
        (d) => d.pairCode.replace(/-/g, "").toUpperCase() === code
      ) ?? null;

      if (!device) {
        return NextResponse.json(
          { error: `Aucun device avec le code "${code}". Vérifiez le code affiché sur l'écran.` },
          { status: 404 }
        );
      }
    } else if (mac) {
      // Mode fallback MAC
      device = getDeviceByMac(mac.toLowerCase().trim()) ?? null;
      if (!device) {
        return NextResponse.json(
          { error: "Aucun device avec cette adresse MAC. L'ESP est-il allumé et connecté ?" },
          { status: 404 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "pairCode ou mac requis" },
        { status: 400 }
      );
    }

    // Associe l'artistName au device
    const updated = setArtistName(device.deviceId, artistName.trim());
    if (!updated) {
      return NextResponse.json({ error: "Erreur mise à jour device" }, { status: 500 });
    }

    // ✅ canvasUrl = /draw/deviceId/screenId (premier écran du device)
    const primaryScreen = device.screens[0];
    const canvasUrl = `/draw/${device.deviceId}/${primaryScreen}`;

    console.log(`[/api/onboard] device=${device.deviceId} artist="${artistName}" → ${canvasUrl}`);

    return NextResponse.json({
      ok: true,
      deviceId: device.deviceId,
      screen: primaryScreen,
      canvasUrl,
    });
  } catch (err) {
    console.error("[/api/onboard] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}