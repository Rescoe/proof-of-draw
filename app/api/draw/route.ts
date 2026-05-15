// app/api/draw/route.ts — v3 validation queue
// Le dessin est soumis au réseau de validation.
// Si BYPASS_VALIDATION=true, broadcast direct.

import { NextRequest, NextResponse } from "next/server";
import { getDevice, incrementFramesSent } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { getIP, forbidden } from "@/lib/rateLimit";
import { redis } from "@/lib/redis";

const DRAW_WINDOW_SEC = parseInt(process.env.DRAW_WINDOW_SEC ?? "900");
const ABUSE_STRIKES = parseInt(process.env.DRAW_LIMIT_PER_ROUND ?? "3");
const BLACKLIST_TTL = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");
const MAX_BODY_BYTES = 20_000;
const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const VALID_SCREENS = new Set(["eink29bwr", "eink27bw", "oled096"]);
const BYPASS_VALIDATION = process.env.BYPASS_VALIDATION === "true";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

const lockKey = (id: string) => `draw:lock:${id}`;
const strikeKey = (id: string) => `draw:strikes:${id}`;
const blDevKey = (id: string) => `bl:dev:${id}`;
const blIpKey = (ip: string) => `bl:ip:${ip}`;

async function strikeDevice(deviceId: string, reason: string): Promise<boolean> {
  const k = strikeKey(deviceId);
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, DRAW_WINDOW_SEC);
  if (count >= ABUSE_STRIKES) {
    await redis.set(blDevKey(deviceId), reason, { ex: BLACKLIST_TTL });
    return true;
  }
  return false;
}

async function strikeIP(ip: string, reason: string): Promise<boolean> {
  const k = `strikes:ip:${ip}`;
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, 3600);
  if (count >= ABUSE_STRIKES * 2) {
    await redis.set(blIpKey(ip), reason, { ex: BLACKLIST_TTL });
    return true;
  }
  return false;
}

function getBaseUrl(req: NextRequest): string {
  const envBase = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (envBase) return envBase.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return host ? `${proto}://${host}` : "https://proof-of-draw.vercel.app";
}

async function broadcastDirect(
  screen: string,
  payload: Record<string, string>,
  deviceId: string,
): Promise<void> {
  const frameId = crypto.randomUUID();
  const stored = JSON.stringify({
    payload: { ...payload, screen },
    frameId,
    createdAt: Date.now(),
    sourceDeviceId: deviceId,
  });

  const members = (await redis.smembers(`pool:screen:${screen}`)) as string[];
  const targets = members.length > 0 ? members : [deviceId];
  await Promise.all(targets.map((dId) => redis.set(`frame:${dId}`, stored, { ex: DRAW_WINDOW_SEC })));
}

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  const cl = parseInt(req.headers.get("content-length") ?? "0");
  if (cl > MAX_BODY_BYTES) {
    await strikeIP(ip, "oversized_payload");
    return NextResponse.json({ error: "Payload trop large" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      await strikeIP(ip, "oversized_payload_actual");
      return NextResponse.json({ error: "Payload trop large" }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { deviceId, screen, black, red, buffer } = body as Record<string, string>;

  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }
  if (!screen || !VALID_SCREENS.has(screen)) {
    return NextResponse.json({ error: "Screen invalide" }, { status: 400 });
  }

  const hasPayload =
    (screen === "eink29bwr" && black && red) ||
    (screen !== "eink29bwr" && buffer);

  if (!hasPayload) {
    return NextResponse.json({ error: "Payload incomplet" }, { status: 400 });
  }

  const [ipBanned, devBanned] = await Promise.all([
    redis.get(blIpKey(ip)),
    redis.get(blDevKey(deviceId)),
  ]);
  if (ipBanned) return forbidden("IP bannie");
  if (devBanned) return forbidden("Device banni");

  if (!(await sessionOwnsDevice(deviceId))) {
    await strikeIP(ip, "unauthorized_draw_attempt");
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const acquired = await redis.set(lockKey(deviceId), "1", { nx: true, ex: DRAW_WINDOW_SEC });
  if (!acquired) {
    const ttl = await redis.ttl(lockKey(deviceId));
    const banned = await strikeDevice(deviceId, "draw_window_violation");
    return NextResponse.json(
      {
        error: banned ? "Device banni pour abus" : `Prochain dessin dans ${ttl}s`,
        retryAfter: ttl,
        nextDrawIn: ttl,
      },
      { status: 429, headers: { "Retry-After": String(ttl) } },
    );
  }

  const device = await getDevice(deviceId);
  if (!device) {
    await Promise.all([redis.del(lockKey(deviceId)), strikeIP(ip, "nonexistent_device")]);
    return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
  }

  if (!device.screens.includes(screen)) {
    await redis.del(lockKey(deviceId));
    return NextResponse.json({ error: "Screen non supporté" }, { status: 400 });
  }

  await Promise.all([incrementFramesSent(deviceId), redis.del(strikeKey(deviceId))]);

  if (BYPASS_VALIDATION) {
    const payload: Record<string, string> =
      screen === "eink29bwr" ? { black: black!, red: red! } : { buffer: buffer! };

    await broadcastDirect(screen, payload, deviceId);

    return NextResponse.json({
      ok: true,
      nextDrawIn: DRAW_WINDOW_SEC,
      validation: "bypassed",
    });
  }

  try {
    const candidateBody = { deviceId, screen, black, red, buffer };
    const submitUrl = new URL("/api/submit-candidate", getBaseUrl(req)).toString();

    const candidateRes = await fetch(submitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify(candidateBody),
    });

    const candidateData = await candidateRes.json().catch(() => ({}));

    if (candidateRes.status === 409) {
      return NextResponse.json({
        ok: true,
        nextDrawIn: DRAW_WINDOW_SEC,
        validation: "queued_behind",
        message: "Un dessin est déjà en cours de validation. Le vôtre sera soumis à la prochaine fenêtre.",
        candidateId: candidateData.candidateId,
      });
    }

    if (!candidateRes.ok) {
      throw new Error(candidateData.error ?? `submit-candidate failed (${candidateRes.status})`);
    }

    return NextResponse.json({
      ok: true,
      nextDrawIn: DRAW_WINDOW_SEC,
      validation: "pending",
      candidateId: candidateData.candidateId,
      score: candidateData.score,
      warning: candidateData.warning ?? null,
      metrics: candidateData.metrics,
      poolSize: candidateData.poolSize,
      message: `Dessin soumis au réseau (score: ${(candidateData.score ?? 0).toFixed(3)}). En attente de validation par ${candidateData.poolSize ?? 0} ESP.`,
    });
  } catch (err) {
    console.error("[draw] submit-candidate error:", err);

    const payload: Record<string, string> =
      screen === "eink29bwr" ? { black: black!, red: red! } : { buffer: buffer! };

    await broadcastDirect(screen, payload, deviceId);

    return NextResponse.json({
      ok: true,
      nextDrawIn: DRAW_WINDOW_SEC,
      validation: "fallback_direct",
    });
  }
}