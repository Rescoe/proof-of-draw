import { NextRequest, NextResponse } from "next/server";
import { upsertDevice } from "@/lib/deviceStore";
import { checkAuth, generateDeviceId } from "@/lib/security";
import { SCREEN_IDS, ScreenId } from "@/lib/screenProfiles";

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, ip, port, screens } = body;

  if (!name || !ip || !port || !screens?.length) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Validate IP format
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) {
    return NextResponse.json({ error: "Invalid IP format" }, { status: 400 });
  }

  // Validate screens
  const validScreens = screens.filter((s: string) => SCREEN_IDS.includes(s as ScreenId));
  if (!validScreens.length) {
    return NextResponse.json({ error: "No valid screen profiles" }, { status: 400 });
  }

  const id = generateDeviceId(name, ip);
  const device = {
    id,
    name,
    ip,
    port: Number(port),
    screens: validScreens as ScreenId[],
    framesSent: 0,
    lastPing: undefined,
    lastDraw: undefined,
  };

  upsertDevice(device);
  return NextResponse.json({ ok: true, device });
}
