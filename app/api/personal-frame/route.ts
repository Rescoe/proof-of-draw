// app/api/personal-frame/route.ts
// Permet au propriétaire d'un ESP d'afficher un dessin personnel
// indépendamment du réseau de validation.
//
// Ce dessin est affiché sur son ESP uniquement.
// Il est effacé automatiquement quand le prochain bloc est validé par sa pool.
//
// Route : POST /api/personal-frame
// Auth  : session cookie (même logique que /api/draw)
// Rate  : pas de lock 15min — le propriétaire peut changer son dessin quand il veut
//         mais rate limit à 10/heure pour éviter les abus

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { getIP, forbidden } from "@/lib/rateLimit";
import { redis } from "@/lib/redis";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const VALID_SCREENS   = new Set(["eink29bwr", "eink27bw", "oled096"]);
const MAX_BODY_BYTES  = 20_000;
const PERSONAL_TTL    = 7 * 24 * 3600; // 7 jours — s'efface quand le bloc est miné
const BLACKLIST_TTL   = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");

const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  // ── 1. Taille body ─────────────────────────────────────────────────────────
  const cl = parseInt(req.headers.get("content-length") ?? "0");
  if (cl > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload trop large" }, { status: 413 });
  }

  // ── 2. Parse ───────────────────────────────────────────────────────────────
  let body: Record<string, string>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload trop large" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { deviceId, screen, black, red, buffer } = body;

  // ── 3. Validation format ───────────────────────────────────────────────────
  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }
  if (!screen || !VALID_SCREENS.has(screen)) {
    return NextResponse.json({ error: "Screen invalide" }, { status: 400 });
  }

  // ── 4. Blacklist ───────────────────────────────────────────────────────────
  const [ipBanned, devBanned] = await Promise.all([
    redis.get(`bl:ip:${ip}`),
    redis.get(`bl:dev:${deviceId}`),
  ]);
  if (ipBanned)  return forbidden("IP bannie");
  if (devBanned) return forbidden("Device banni");

  // ── 5. Session ─────────────────────────────────────────────────────────────
  if (!(await sessionOwnsDevice(deviceId))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  // ── 6. Rate limit : 10 personal frames / heure ────────────────────────────
  const rlKey = `rl:personal:${deviceId}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, 3600);
  if (count > 10) {
    return NextResponse.json({ error: "Trop de personal frames (10/heure max)" }, { status: 429 });
  }

  // ── 7. Device valide ───────────────────────────────────────────────────────
  const device = await getDevice(deviceId);
  if (!device || !device.screens.includes(screen)) {
    return NextResponse.json({ error: "Device ou screen invalide" }, { status: 404 });
  }

  // ── 8. Stocker la personal frame ───────────────────────────────────────────
  const payload = screen === "eink29bwr"
    ? { screen, black, red }
    : { screen, buffer };

  const stored = JSON.stringify({
    payload,
    frameId:   crypto.randomUUID(),
    createdAt: Date.now(),
    personal:  true,
  });

  await redis.set(personalKey(deviceId), stored, { ex: PERSONAL_TTL });

  console.log(`[personal-frame] device=${deviceId} screen=${screen}`);

  return NextResponse.json({ ok: true });
}

// GET : vérifier si une personal frame existe pour ce device
export async function GET(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("deviceId");
  if (!deviceId) return NextResponse.json({ exists: false });

  const raw = await redis.get(personalKey(deviceId));
  return NextResponse.json({ exists: !!raw });
}