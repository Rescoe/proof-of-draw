import { NextRequest, NextResponse } from "next/server";
import { getDevice, updateDevicePing } from "@/lib/deviceStore";
import { checkAuth } from "@/lib/security";

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deviceId } = await req.json();
  const device = getDevice(deviceId);
  if (!device) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const res = await fetch(`http://${device.ip}:${device.port}/ping`, {
      signal: AbortSignal.timeout(3000),
    });
    updateDevicePing(deviceId);
    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch {
    return NextResponse.json({ ok: false, error: "unreachable" });
  }
}
