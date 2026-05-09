import { NextResponse } from "next/server";
import { getDevices } from "@/lib/deviceStore";
import { checkAuth } from "@/lib/security";

export async function GET() {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const devices = getDevices();
  return NextResponse.json(devices);
}
