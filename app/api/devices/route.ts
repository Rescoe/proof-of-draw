// app/api/devices/route.ts
// GET /api/devices        → vue publique (artistName, isOnline) — sans données sensibles
// GET /api/devices?mine=1 → vue privée scoped à la session

import { NextRequest, NextResponse } from "next/server";

import { getAllDevices, getDevice, toPublicDevice, toOwnedDevice } from "@/lib/deviceStore";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const mine = req.nextUrl.searchParams.get("mine");

    if (mine === "1") {
      const session = await getSession();

      if (session.deviceIds.length === 0) {
        return NextResponse.json(
          { devices: [] },
          {
            headers: {
              "Cache-Control": "private, no-store, max-age=0",
            },
          }
        );
      }

      const owned = (
        await Promise.all(session.deviceIds.map((id) => getDevice(id)))
      )
        .filter(Boolean)
        .map((d) => toOwnedDevice(d!));

      return NextResponse.json(
        { devices: owned },
        {
          headers: {
            "Cache-Control": "private, no-store, max-age=0",
          },
        }
      );
    }

    const all = await getAllDevices();
    const publicList = all
      .filter((d) => d.artistName)
      .map((d) => toPublicDevice(d));

    return NextResponse.json(
      { devices: publicList },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
        },
      }
    );
  } catch (err) {
    console.error("[/api/devices]", err);
    return NextResponse.json(
      { error: "Erreur serveur" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }
}