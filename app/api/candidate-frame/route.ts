// app/api/candidate-frame/route.ts
// Sert le payload binaire du candidat courant pour validation locale côté ESP (V2).
//
// GET /api/candidate-frame?candidateId=<uuid>&fmt=bin[&screen=eink29bwr][&deviceId=dev_XXX]
//
// Réponse (fmt=bin) :
//   eink29bwr : black[4736] + red[4736] = 9472 bytes concat
//   eink27bw  : buffer[5808] bytes
//   oled096   : buffer[1024] bytes
//
// Header X-Score-Server = score serveur de référence (pour détecter drift côté ESP).
// 404 si le candidat est expiré ou remplacé → l'ESP bascule en V1 (fallback).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentCandidate } from "@/lib/chain";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const url         = new URL(req.url);
  const candidateId = url.searchParams.get("candidateId") ?? "";
  const deviceId    = url.searchParams.get("deviceId")    ?? "";
  const fmt         = url.searchParams.get("fmt")         ?? "json";

  if (!candidateId) {
    return NextResponse.json({ error: "candidateId requis" }, { status: 400 });
  }

  // Rate limit léger par device (6 req/min) — évite les boucles rapides en cas de bug firmware
  if (deviceId && DEVICE_ID_REGEX.test(deviceId)) {
    const rlKey = `rl:cand-frame:${deviceId}`;
    const count = await redis.incr(rlKey);
    if (count === 1) await redis.expire(rlKey, 60);
    if (count > 6) {
      return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
    }
  }

  const candidate = await getCurrentCandidate();

  if (!candidate) {
    return new Response(null, { status: 404, headers: { "X-Reason": "no-candidate" } });
  }
  if (candidate.candidateId !== candidateId) {
    // Le candidat a expiré ou a été remplacé entre le pull et la validation
    return new Response(null, {
      status: 404,
      headers: {
        "X-Reason":     "candidate-expired-or-replaced",
        "X-Current-Id": candidate.candidateId,
      },
    });
  }

  if (fmt !== "bin") {
    return NextResponse.json({
      candidateId,
      screen:    candidate.poolScreen,
      score:     candidate.score,
      expiresIn: Math.ceil((candidate.expiresAt - Date.now()) / 1000),
    });
  }

  const payload = candidate.payload as Record<string, string>;
  const screen  = candidate.poolScreen;

  let data: Buffer;
  try {
    if (screen === "eink29bwr") {
      if (!payload["black"] || !payload["red"]) {
        return NextResponse.json({ error: "Payload BWR incomplet" }, { status: 500 });
      }
      const black = Buffer.from(payload["black"], "base64");
      const red   = Buffer.from(payload["red"],   "base64");
      data = Buffer.concat([black, red]); // 9472 bytes : black first, then red
    } else {
      if (!payload["buffer"]) {
        return NextResponse.json({ error: "Payload buffer absent" }, { status: 500 });
      }
      data = Buffer.from(payload["buffer"], "base64");
    }
  } catch (err) {
    console.error("[candidate-frame] decode error:", err);
    return NextResponse.json({ error: "Décodage impossible" }, { status: 500 });
  }

  console.log(
    `[candidate-frame] candidateId=${candidateId.slice(0, 8)} screen=${screen} size=${data.length} device=${deviceId || "?"}`
  );

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type":   "application/octet-stream",
      "Content-Length": String(data.length),
      "X-Candidate-Id": candidateId,
      "X-Screen":       screen,
      "X-Score-Server": candidate.score.toFixed(4),
      "X-Expires-In":   String(Math.ceil((candidate.expiresAt - Date.now()) / 1000)),
      "Cache-Control":  "no-store",
    },
  });
}
