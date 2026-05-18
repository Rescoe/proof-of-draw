// app/api/candidate-frame/route.ts
// Sert le payload binaire du candidat courant pour validation locale côté ESP.
// L'ESP télécharge l'image, calcule ses propres métriques, puis poste vers
// /api/validation-result avec ses scores réels (V2 — vs V1 qui utilisait score_server).
//
// GET /api/candidate-frame?candidateId=<uuid>&fmt=bin
//
// Réponse (fmt=bin) :
//   screen=eink29bwr : black[4736] + red[4736] = 9472 bytes
//   screen=eink27bw  : buffer[5808] bytes
//   screen=oled096   : buffer[1024] bytes
//
// Header X-Score-Server = score de complexité calculé côté serveur (référence).
// L'ESP compare son score local — un drift > 0.4 est suspect.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentCandidate } from "@/lib/chain";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { redis } from "@/lib/redis";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;

export const runtime = "nodejs";

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

  // Rate limit par device (optionnel) — évite les abus
  if (deviceId && DEVICE_ID_REGEX.test(deviceId)) {
    const rlKey = `rl:cand-frame:${deviceId}`;
    const count = await redis.incr(rlKey);
    if (count === 1) await redis.expire(rlKey, 60);
    if (count > 6) { // 6 req/min par device
      return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
    }
  }

  const candidate = await getCurrentCandidate();
  if (!candidate) {
    return new Response(null, { status: 404, headers: { "X-Reason": "no-candidate" } });
  }
  if (candidate.candidateId !== candidateId) {
    return new Response(null, {
      status: 404,
      headers: {
        "X-Reason":       "candidate-expired-or-replaced",
        "X-Current-Id":   candidate.candidateId,
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
      data = Buffer.concat([black, red]);
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

  console.log(`[candidate-frame] candidateId=${candidateId.slice(0, 8)} screen=${screen} size=${data.length}`);

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type":     "application/octet-stream",
      "Content-Length":   String(data.length),
      "X-Candidate-Id":   candidateId,
      "X-Screen":         screen,
      "X-Score-Server":   candidate.score.toFixed(4), // référence serveur
      "X-Expires-In":     String(Math.ceil((candidate.expiresAt - Date.now()) / 1000)),
      "Cache-Control":    "no-store",
    },
  });
}
