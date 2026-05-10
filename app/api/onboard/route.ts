// app/api/onboard/route.ts
// Lie un pairCode (ou MAC) à un artistName
// → met à jour le device dans le store
// → pose un cookie de session pour autoriser ce client sur ce device
// → renvoie canvasUrl
//
// Transfert d'appareil : repasser par ici avec le même pairCode depuis un autre navigateur
// suffit pour transférer le contrôle (le cookie est posé sur le nouvel appareil).

import { NextRequest, NextResponse } from "next/server";
import { getAllDevices, getDeviceByMac, setArtistName } from "@/lib/deviceStore";
import { addDeviceToSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pairCode, mac, artistName } = body;

    if (!artistName?.trim()) {
      return NextResponse.json({ error: "artistName requis" }, { status: 400 });
    }

    let device = null;

    if (pairCode) {
      const code = pairCode.replace(/-/g, "").toUpperCase().trim();
      const all = getAllDevices();
      device =
        all.find(
          (d) => d.pairCode.replace(/-/g, "").toUpperCase() === code
        ) ?? null;

      if (!device) {
        return NextResponse.json(
          {
            error: `Aucun device avec le code "${code}". Vérifiez le code affiché sur l'écran.`,
          },
          { status: 404 }
        );
      }
    } else if (mac) {
      device = getDeviceByMac(mac.toLowerCase().trim()) ?? null;
      if (!device) {
        return NextResponse.json(
          {
            error:
              "Aucun device avec cette adresse MAC. L'ESP est-il allumé et connecté ?",
          },
          { status: 404 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "pairCode ou mac requis" },
        { status: 400 }
      );
    }

    // Associe l'artistName
    const updated = setArtistName(device.deviceId, artistName.trim());
    if (!updated) {
      return NextResponse.json(
        { error: "Erreur mise à jour device" },
        { status: 500 }
      );
    }

    const primaryScreen = device.screens[0];
    const canvasUrl = `/draw/${device.deviceId}/${primaryScreen}`;

    console.log(
      `[/api/onboard] device=${device.deviceId} artist="${artistName}" → ${canvasUrl}`
    );

    // Prépare la réponse
    const res = NextResponse.json({
      ok: true,
      // On renvoie deviceId au frontend pour qu'il puisse construire les URLs
      // mais on ne renvoie PAS le pairCode ni la MAC
      deviceId: device.deviceId,
      screen: primaryScreen,
      canvasUrl,
    });

    // Pose le cookie de session — ajoute ce deviceId aux devices autorisés
    await addDeviceToSession(res, device.deviceId);

    return res;
  } catch (err) {
    console.error("[/api/onboard] erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}