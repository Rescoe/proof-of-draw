import { NextRequest, NextResponse } from "next/server";
import { getDevice, incrementFrameCount } from "@/lib/deviceStore";
import { checkAuth, rateLimit, quotaDaily } from "@/lib/security";
import { sendFrameNow } from "@/lib/queue";

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await req.json();

  const { deviceId, payload } = body;

  if (!deviceId || !payload) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  if (!(await rateLimit(`draw:${deviceId}`))) {
    return NextResponse.json(
      { error: "Rate limit exceeded (15 min)" },
      { status: 429 }
    );
  }

  if (!(await quotaDaily("default-user"))) {
    return NextResponse.json(
      { error: "Daily quota exceeded" },
      { status: 429 }
    );
  }

  const device = getDevice(deviceId);

  if (!device) {
    return NextResponse.json(
      { error: "Device not found" },
      { status: 404 }
    );
  }

  try {
const result = await sendFrameNow(
  device.ip,
  device.port,
  payload
);

    if (result.ok) {
      incrementFrameCount(deviceId);

      return NextResponse.json({
        ok: true,
        message: "Frame sent",
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: result.error || `HTTP ${result.status}`,
      },
      { status: 502 }
    );

  } catch (error: any) {
    console.error("[DRAW ROUTE ERROR]", error);

    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}