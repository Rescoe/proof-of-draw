// app/api/draw/route.ts — v3 pool broadcast
// Ordre : validation locale → blacklist → session → lock NX → logique métier → broadcast pool
//
// CHANGEMENT PRINCIPAL v2→v3 :
// Au lieu de stocker la frame uniquement pour le device source, on récupère tous les
// deviceIds de la même pool (même type d'écran) et on broadcast la frame à tous.
// Le lock 15min reste par device — seul l'artiste "gagnant" peut soumettre un dessin
// dans sa fenêtre. Mais son dessin est affiché sur tous les écrans du même type.

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
const FRAME_TTL_SEC    = DRAW_WINDOW_SEC; // les frames expirent avec la fenêtre

const MAX_BODY_BYTES   = 20_000;
const DEVICE_ID_REGEX  = /^dev_[A-Z0-9]{8}$/;
const VALID_SCREENS    = new Set(["eink29bwr", "eink27bw", "oled096"]);

// ─── Clés Redis ───────────────────────────────────────────────────────────────
const lockKey    = (id: string) => `draw:lock:${id}`;
const strikeKey  = (id: string) => `draw:strikes:${id}`;
const blDevKey   = (id: string) => `bl:dev:${id}`;
const blIpKey    = (ip: string) => `bl:ip:${ip}`;
const poolKey    = (screenId: string) => `pool:screen:${screenId}`;

// ─── Strike + ban device ──────────────────────────────────────────────────────
async function strikeDevice(deviceId: string, reason: string): Promise<boolean> {
  const k     = strikeKey(deviceId);
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, DRAW_WINDOW_SEC);
  if (count >= ABUSE_STRIKES) {
    await redis.set(blDevKey(deviceId), reason, { ex: BLACKLIST_TTL });
    console.warn(`[/api/draw] BAN device=${deviceId} reason=${reason} strikes=${count}`);
    return true;
  }
  return false;
}

// ─── Strike + ban IP ──────────────────────────────────────────────────────────
async function strikeIP(ip: string, reason: string): Promise<boolean> {
  const k     = `strikes:ip:${ip}`;
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, 3600);
  if (count >= ABUSE_STRIKES * 2) {
    await redis.set(blIpKey(ip), reason, { ex: BLACKLIST_TTL });
    console.warn(`[/api/draw] BAN ip=${ip} reason=${reason} strikes=${count}`);
    return true;
  }
  return false;
}

// ─── Broadcast frame vers toute la pool d'un screen ──────────────────────────
// Récupère tous les deviceIds enregistrés pour ce type d'écran,
// puis stocke la même frame pour chacun d'eux.
//
// Coût Redis : 1 SMEMBERS + N SET (N = taille de la pool)
// Avec 50 devices max et pools typiquement <20 devices → coût raisonnable.
//
// On exclut les devices bannis de la réception (lecture bl:dev en parallèle)
// pour ne pas gaspiller des writes Redis sur des devices qui ne pourront pas pull.
//
// Fire-and-forget : ne bloque pas la réponse HTTP au client.
async function broadcastToPool(
  screenId: string,
  payload: FramePayload,
  sourceDeviceId: string,
): Promise<void> {
  // 1. Récupérer tous les membres de la pool
  const poolMembers = await redis.smembers(poolKey(screenId)) as string[];

  if (!poolMembers || poolMembers.length === 0) {
    // Fallback : stocker au moins pour le device source
    // (ne devrait pas arriver si register a bien indexé, mais défense en profondeur)
    storeFrame(screenId, payload, sourceDeviceId);
    console.warn(`[/api/draw] pool vide pour screen=${screenId}, fallback device source`);
    return;
  }

  // 2. Générer un frameId unique partagé par toute la pool
  //    → permet au frontend de détecter les doublons et à l'ack de confirmer
  const frameId = crypto.randomUUID();
  const stored  = JSON.stringify({
    payload,
    frameId,
    createdAt: Date.now(),
    sourceDeviceId, // traçabilité : qui a soumis ce dessin
  });

  console.log(
    `[/api/draw] broadcast → screen=${screenId} pool=${poolMembers.length} devices frameId=${frameId} source=${sourceDeviceId}`
  );

  // 3. Écrire la frame pour chaque device de la pool
  //    On filtre d'abord les devices bannis pour économiser des writes inutiles
  const banChecks = await Promise.all(
    poolMembers.map((deviceId) =>
      redis.get(blDevKey(deviceId)).then((banned) => ({ deviceId, banned }))
    )
  );

  const eligibleDevices = banChecks
    .filter(({ banned }) => !banned)
    .map(({ deviceId }) => deviceId);

  if (eligibleDevices.length === 0) {
    console.warn(`[/api/draw] tous les devices de la pool sont bannis, screen=${screenId}`);
    return;
  }

  // Pipeline d'écritures : un SET par device éligible
  await Promise.all(
    eligibleDevices.map((deviceId) =>
      redis.set(`frame:${deviceId}`, stored, { ex: FRAME_TTL_SEC })
    )
  );

  console.log(
    `[/api/draw] broadcast terminé → ${eligibleDevices.length}/${poolMembers.length} devices`
  );
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ip = getIP(req);

  // ── ÉTAPE 1 : Taille body (zéro Redis) ────────────────────────────────────
  const contentLength = parseInt(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    await strikeIP(ip, "oversized_payload");
    return NextResponse.json({ error: "Payload trop large" }, { status: 413 });
  }

  // ── ÉTAPE 2 : Parse JSON + validation locale (zéro Redis) ─────────────────
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

  // ── ÉTAPE 3 : Validation format (zéro Redis) ──────────────────────────────
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
    await strikeIP(ip, "unauthorized_draw_attempt");
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  // ── ÉTAPE 6 : Lock 15min atomique SET NX (1 write Redis) ──────────────────
  const acquired = await redis.set(lockKey(deviceId), "1", {
    nx: true,
    ex: DRAW_WINDOW_SEC,
  });

  if (!acquired) {
    const ttl    = await redis.ttl(lockKey(deviceId));
    const banned = await strikeDevice(deviceId, "draw_window_violation");
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
    await Promise.all([
      redis.del(lockKey(deviceId)),
      strikeIP(ip, "nonexistent_device"),
    ]);
    return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
  }

  if (!device.screens.includes(screen)) {
    await redis.del(lockKey(deviceId));
    return NextResponse.json({ error: `Screen "${screen}" non supporté par ce device` }, { status: 400 });
  }

  // ── ÉTAPE 8 : Broadcast vers toute la pool + reset strikes ────────────────
  // Construire le payload
  const payload: FramePayload =
    screen === "eink29bwr"
      ? { screen: "eink29bwr", black: black!, red: red! }
      : { screen, buffer: buffer! };

  // Broadcast fire-and-forget — ne bloque pas la réponse HTTP
  // Si Redis est down ici, la frame est perdue silencieusement (comportement identique à v2)
  broadcastToPool(screen, payload, deviceId).catch((err) =>
    console.error("[/api/draw] broadcastToPool error:", err)
  );

  // Reset strikes + compteur frames en parallèle
  await Promise.all([
    incrementFramesSent(deviceId),
    redis.del(strikeKey(deviceId)),
  ]);

  console.log(
    `[/api/draw] accepted → device=${deviceId} screen=${screen} lock=${DRAW_WINDOW_SEC}s`
  );

  return NextResponse.json({
    ok: true,
    nextDrawIn: DRAW_WINDOW_SEC,
  });
}