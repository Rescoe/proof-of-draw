// app/api/pull-frame/route.ts
// Sert le frame binaire stocké pour un device — appelé par les ESP après /api/pull.
//
// Protocole binaire :
//   screen=eink29bwr : black[4736] + red[4736] = 9472 bytes concaténés
//   screen=eink27bw  : buffer[5808] bytes
//   screen=oled096   : buffer[1024] bytes
//
// Le param &screen= est optionnel (le serveur lit le screen depuis la frame Redis).
// &fmt=bin retourne les octets bruts ; sans ou &fmt=json retourne JSON.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;

// Taille attendue par screen — pour validation côté serveur
const EXPECTED_SIZES: Record<string, number> = {
  eink29bwr: 4736,  // par canal (black = 4736, red = 4736)
  eink27bw:  5808,
  oled096:   1024,
};

export const runtime = "nodejs"; // Buffer.from(b64) nécessite Node

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const url      = new URL(req.url);
  const deviceId = url.searchParams.get("deviceId") ?? "";
  const screenQ  = url.searchParams.get("screen")   ?? "";
  const fmt      = url.searchParams.get("fmt")       ?? "json";

  if (!DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }

  // ── Lecture frame depuis Redis ──────────────────────────────────────────────
  const raw = await redis.get(`frame:${deviceId}`);
  if (!raw) {
    return new Response(null, { status: 404, headers: { "X-Reason": "no-frame" } });
  }

  let frame: Record<string, unknown>;
  try {
    frame = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>);
  } catch {
    return NextResponse.json({ error: "Frame corrompue" }, { status: 500 });
  }

  const payload = frame["payload"] as Record<string, string> | undefined;
  if (!payload) {
    return new Response(null, { status: 404, headers: { "X-Reason": "no-payload" } });
  }

  const screen  = payload["screen"] ?? screenQ;
  const frameId = (frame["frameId"] as string) ?? "";

  // Vérification optionnelle : le device demande le bon écran
  if (screenQ && screen !== screenQ) {
    // Frame disponible mais pour un autre écran → 404 propre
    return new Response(null, {
      status: 404,
      headers: { "X-Reason": `screen-mismatch:stored=${screen},requested=${screenQ}` },
    });
  }

  if (fmt !== "bin") {
    // Mode JSON : retourne les métadonnées sans payload binaire
    return NextResponse.json({ frameId, screen, createdAt: frame["createdAt"] ?? null });
  }

  // ── Construction du buffer binaire ─────────────────────────────────────────
  let data: Buffer;
  try {
    if (screen === "eink29bwr") {
      if (!payload["black"] || !payload["red"]) {
        return NextResponse.json({ error: "Payload BWR incomplet" }, { status: 500 });
      }
      const black = Buffer.from(payload["black"], "base64");
      const red   = Buffer.from(payload["red"],   "base64");
      // Validation taille
      if (black.length !== EXPECTED_SIZES["eink29bwr"] || red.length !== EXPECTED_SIZES["eink29bwr"]) {
        console.warn(`[pull-frame] size mismatch device=${deviceId} black=${black.length} red=${red.length}`);
      }
      data = Buffer.concat([black, red]); // 9472 bytes
    } else {
      if (!payload["buffer"]) {
        return NextResponse.json({ error: "Payload buffer absent" }, { status: 500 });
      }
      data = Buffer.from(payload["buffer"], "base64");
      const expected = EXPECTED_SIZES[screen];
      if (expected && data.length !== expected) {
        console.warn(`[pull-frame] size mismatch device=${deviceId} screen=${screen} got=${data.length} expected=${expected}`);
      }
    }
  } catch (err) {
    console.error("[pull-frame] decode error:", err);
    return NextResponse.json({ error: "Décodage base64 impossible" }, { status: 500 });
  }

  console.log(`[pull-frame] device=${deviceId} screen=${screen} size=${data.length} frameId=${frameId.slice(0, 8)}`);

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type":   "application/octet-stream",
      "Content-Length": String(data.length),
      "X-Frame-Id":     frameId,
      "X-Screen":       screen,
      "Cache-Control":  "no-store, no-cache",
    },
  });
}
