// app/api/draw/route.ts — v2 durcie
// Ordre : validation locale → blacklist → session → lock NX → logique métier

import { NextRequest, NextResponse } from "next/server";
import { getDevice, incrementFramesSent } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { storeFrame, FramePayload } from "@/lib/queue";
import { getIP, forbidden } from "@/lib/rateLimit";
import { redis } from "@/lib/redis";

// ─── Config ──────────────────────────────────────────────────────────────────
const DRAW_WINDOW_SEC  = parseInt(process.env.DRAW_WINDOW_SEC      ?? "900");
const ABUSE_STRIKES    = parseInt(process.env.DRAW_LIMIT_PER_ROUND ?? "3");
const BLACKLIST_TTL    = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");

// Taille max body : ~15KB suffit pour deux buffers eink29bwr base64 (2×4736 bytes → ~6400 chars chacun = ~13KB)
// On accepte jusqu'à 20KB pour marge, au-delà c'est suspect
const MAX_BODY_BYTES   = 20_000;

// Format deviceId attendu : "dev_" suivi de 8 chars alphanumériques majuscules
const DEVICE_ID_REGEX  = /^dev_[A-Z0-9]{8}$/;

// Screens acceptés — liste fermée, pas de valeur arbitraire
const VALID_SCREENS    = new Set(["eink29bwr", "eink27bw", "oled096"]);

// ─── Clés Redis ───────────────────────────────────────────────────────────────
const lockKey   = (id: string) => `draw:lock:${id}`;
const strikeKey = (id: string) => `draw:strikes:${id}`;
const blDevKey  = (id: string) => `bl:dev:${id}`;
const blIpKey   = (ip: string) => `bl:ip:${ip}`;

// ─── Strike + ban device ──────────────────────────────────────────────────────
async function strikeDevice(deviceId: string, reason: string): Promise<boolean> {
  const k     = strikeKey(deviceId);
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, DRAW_WINDOW_SEC);
  if (count >= ABUSE_STRIKES) {
    await redis.set(blDevKey(deviceId), reason, { ex: BLACKLIST_TTL });
    console.warn(`[/api/draw] BAN device=${deviceId} reason=${reason} strikes=${count}`);
    return true; // banni
  }
  return false;
}

// ─── Strike + ban IP ──────────────────────────────────────────────────────────
async function strikeIP(ip: string, reason: string): Promise<boolean> {
  const k     = `strikes:ip:${ip}`;
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, 3600); // fenêtre 1h pour les IPs
  if (count >= ABUSE_STRIKES * 2) { // seuil plus haut pour l'IP (multi-devices légitimes)
    await redis.set(blIpKey(ip), reason, { ex: BLACKLIST_TTL });
    console.warn(`[/api/draw] BAN ip=${ip} reason=${reason} strikes=${count}`);
    return true;
  }
  return false;
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ip = getIP(req);

  // ── ÉTAPE 1 : Taille body (zéro Redis) ────────────────────────────────────
  const contentLength = parseInt(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    // Payload surdimensionné → ban IP immédiat, pas de lecture Redis supplémentaire
    await strikeIP(ip, "oversized_payload");
    return NextResponse.json({ error: "Payload trop large" }, { status: 413 });
  }

  // ── ÉTAPE 2 : Parse JSON + validation locale (zéro Redis) ─────────────────
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    // Double vérification taille réelle (content-length peut être absent ou truqué)
    if (text.length > MAX_BODY_BYTES) {
      await strikeIP(ip, "oversized_payload_actual");
      return NextResponse.json({ error: "Payload trop large" }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { deviceId, screen, black, red, buffer } = body as Record<string, string>;

  // ── ÉTAPE 3 : Validation format (zéro Redis) ──────────────────────────────
  // deviceId format strict — stoppe l'énumération aléatoire très tôt
  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }

  // Screen dans liste fermée — refuse toute valeur arbitraire
  if (!screen || !VALID_SCREENS.has(screen)) {
    return NextResponse.json({ error: "Screen invalide" }, { status: 400 });
  }

  // Payload présent selon le screen
  const hasPayload =
    (screen === "eink29bwr" && black && red) ||
    (screen !== "eink29bwr" && buffer);

  if (!hasPayload) {
    return NextResponse.json({ error: "Payload incomplet pour ce screen" }, { status: 400 });
  }

  // ── ÉTAPE 4 : Blacklist IP + device en parallèle (2 reads Redis) ──────────
  const [ipBanned, devBanned] = await Promise.all([
    redis.get(blIpKey(ip)),
    redis.get(blDevKey(deviceId)),
  ]);
  if (ipBanned)  return forbidden("IP bannie");
  if (devBanned) return forbidden("Device banni");

  // ── ÉTAPE 5 : Session cookie (zéro Redis — HMAC local) ────────────────────
  if (!(await sessionOwnsDevice(deviceId))) {
    // Tentative d'accès sans session valide → strike IP (pas device, le device peut être légitime)
    await strikeIP(ip, "unauthorized_draw_attempt");
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  // ── ÉTAPE 6 : Lock 15min atomique SET NX (1 write Redis) ──────────────────
  // SET NX est atomique — impossible d'avoir deux locks simultanés (anti race condition)
  const acquired = await redis.set(lockKey(deviceId), "1", {
    nx: true,
    ex: DRAW_WINDOW_SEC,
  });

  if (!acquired) {
    // Fenêtre active — l'utilisateur insiste
    const ttl     = await redis.ttl(lockKey(deviceId));
    const banned  = await strikeDevice(deviceId, "draw_window_violation");
    return NextResponse.json(
      {
        error: banned
          ? "Device banni pour abus répétés"
          : `Un dessin est déjà en file. Prochain dans ${ttl}s`,
        retryAfter: ttl,
        nextDrawIn: ttl,
      },
      { status: 429, headers: { "Retry-After": String(ttl) } }
    );
  }

  // ── ÉTAPE 7 : Device valide + screen supporté (1 read Redis) ──────────────
  const device = await getDevice(deviceId);
  if (!device) {
    // deviceId au bon format mais inexistant → rollback lock + strike IP
    await Promise.all([
      redis.del(lockKey(deviceId)),
      strikeIP(ip, "nonexistent_device"),
    ]);
    return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
  }

  if (!device.screens.includes(screen)) {
    await redis.del(lockKey(deviceId)); // rollback lock
    return NextResponse.json({ error: `Screen "${screen}" non supporté par ce device` }, { status: 400 });
  }

  // ── ÉTAPE 8 : Stocker la frame + reset strikes (1 write + 1 del Redis) ────
  const payload: FramePayload =
    screen === "eink29bwr"
      ? { screen: "eink29bwr", black: black!, red: red! }
      : { screen, buffer: buffer! };

  storeFrame(screen, payload, deviceId);

  await Promise.all([
    incrementFramesSent(deviceId),
    redis.del(strikeKey(deviceId)), // comportement normal → reset strikes device
  ]);

  console.log(`[/api/draw] accepted → device=${deviceId} screen=${screen} lock=${DRAW_WINDOW_SEC}s`);

  return NextResponse.json({
    ok: true,
    nextDrawIn: DRAW_WINDOW_SEC,
  });
}