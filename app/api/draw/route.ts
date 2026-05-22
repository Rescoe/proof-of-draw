// app/api/draw/route.ts — v4 queue
// Le dessin est soumis au réseau de validation.
// Si un candidat est déjà en cours, le dessin entre en file d'attente (max 50).
// Si BYPASS_VALIDATION=true, broadcast direct sans queue.

import { NextRequest, NextResponse } from "next/server";
import { getDevice, incrementFramesSent } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { getIP, forbidden } from "@/lib/rateLimit";
import { redis } from "@/lib/redis";
import { getCurrentCandidate } from "@/lib/chain";
import { enqueueDraw, getQueueLength, DRAW_QUEUE_MAX } from "@/lib/drawQueue";
import { SCREEN_IDS, isDualBuffer } from "@/lib/screenProfiles";

const DRAW_WINDOW_SEC = parseInt(process.env.DRAW_WINDOW_SEC ?? "900");
const ABUSE_STRIKES   = parseInt(process.env.DRAW_LIMIT_PER_ROUND ?? "3");
const BLACKLIST_TTL   = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");
const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const VALID_SCREENS   = new Set<string>(SCREEN_IDS); // dérivé de lib/screenProfiles.ts
const BYPASS_VALIDATION = process.env.BYPASS_VALIDATION === "true";
const INTERNAL_SECRET   = process.env.INTERNAL_API_SECRET ?? "";

const lockKey   = (id: string) => `draw:lock:${id}`;
const strikeKey = (id: string) => `draw:strikes:${id}`;
const blDevKey  = (id: string) => `bl:dev:${id}`;
const blIpKey   = (ip: string) => `bl:ip:${ip}`;

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
  const host  = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return host ? `${proto}://${host}` : "https://proof-of-draw.vercel.app";
}

async function broadcastDirect(
  screen: string,
  payload: Record<string, string>,
  deviceId: string,
  meta?: { workTitle?: string; drawArtistName?: string; displayTs?: string },
): Promise<void> {
  const frameId = crypto.randomUUID();
  const stored  = JSON.stringify({
    payload: { ...payload, screen, ...meta },
    frameId,
    createdAt: Date.now(),
    sourceDeviceId: deviceId,
  });
  const members = (await redis.smembers(`pool:screen:${screen}`)) as string[];
  const targets = members.length > 0 ? members : [deviceId];
  await Promise.all(
    targets.map((dId) => redis.set(`frame:${dId}`, stored, { ex: DRAW_WINDOW_SEC })),
  );
}

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { deviceId, screen, black, red, buffer } = body as Record<string, string>;
  const actions        = Array.isArray(body.actions)      ? body.actions      : [];
  const replayEvents   = Array.isArray(body.replayEvents) ? body.replayEvents : [];
  const drawScore      = typeof body.drawScore      === "number" ? body.drawScore      : null;
  const workTitle      = typeof body.workTitle      === "string" ? body.workTitle.trim().slice(0, 80)  : undefined;
  const drawArtistName = typeof body.drawArtistName === "string" ? body.drawArtistName.trim().slice(0, 40) : undefined;
  const importWarning  = typeof body.importWarning  === "string" ? body.importWarning  : undefined;

  // Timestamp Paris
  const _now = new Date();
  const _parisParts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(_now);
  const _pm: Record<string, string> = {};
  _parisParts.forEach((p) => { if (p.type !== "literal") _pm[p.type] = p.value; });
  const displayTs = `${_pm.day}/${_pm.month}/${_pm.year} ${_pm.hour}:${_pm.minute} (Paris)`;
  const frameMeta = { workTitle, drawArtistName, displayTs };

  // ── Validation des paramètres ───────────────────────────────────────────────
  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }
  if (!screen || !VALID_SCREENS.has(screen)) {
    return NextResponse.json({ error: "Screen invalide" }, { status: 400 });
  }

  const hasPayload =
    (isDualBuffer(screen) && black && red) ||
    (!isDualBuffer(screen) && buffer);
  if (!hasPayload) {
    return NextResponse.json({ error: "Payload incomplet" }, { status: 400 });
  }

  // Limite de taille des buffers base64 (~45KB décodé max)
  const MAX_B64 = 60_000;
  if ((black && black.length > MAX_B64) || (red && red.length > MAX_B64) || (buffer && buffer.length > MAX_B64)) {
    return NextResponse.json({ error: "Buffer trop grand" }, { status: 413 });
  }

  if (drawScore !== null && drawScore <= 0) {
    return NextResponse.json(
      { error: "Dessin vide — score Proof-of-Draw ≤ 0" },
      { status: 400 },
    );
  }

  // ── Blacklist ───────────────────────────────────────────────────────────────
  const [ipBanned, devBanned] = await Promise.all([
    redis.get(blIpKey(ip)),
    redis.get(blDevKey(deviceId)),
  ]);
  if (ipBanned)  return forbidden("IP bannie");
  if (devBanned) return forbidden("Device banni");

  // ── Auth ────────────────────────────────────────────────────────────────────
  const device   = await getDevice(deviceId);
  const isPublic = device?.publicMode === true;
  if (!isPublic && !(await sessionOwnsDevice(deviceId))) {
    await strikeIP(ip, "unauthorized_draw_attempt");
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  // ── Limite de débit (draw:lock par device) ──────────────────────────────────
  const acquired = await redis.set(lockKey(deviceId), "1", { nx: true, ex: DRAW_WINDOW_SEC });
  if (!acquired) {
    const ttl    = await redis.ttl(lockKey(deviceId));
    const banned = await strikeDevice(deviceId, "draw_window_violation");
    return NextResponse.json(
      {
        error:       banned ? "Device banni pour abus" : `Prochain dessin dans ${ttl}s`,
        retryAfter:  ttl,
        nextDrawIn:  ttl,
      },
      { status: 429, headers: { "Retry-After": String(ttl) } },
    );
  }

  if (!device) {
    await Promise.all([redis.del(lockKey(deviceId)), strikeIP(ip, "nonexistent_device")]);
    return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
  }
  if (!device.screens.includes(screen)) {
    await redis.del(lockKey(deviceId));
    return NextResponse.json({ error: "Screen non supporté" }, { status: 400 });
  }

  // Strike reset (non-conditionnel — la tentative était légitime)
  await redis.del(strikeKey(deviceId));

  // ── BYPASS direct ───────────────────────────────────────────────────────────
  if (BYPASS_VALIDATION) {
    const payload: Record<string, string> =
      isDualBuffer(screen) ? { black: black!, red: red! } : { buffer: buffer! };
    await broadcastDirect(screen, payload, deviceId, frameMeta);
    await incrementFramesSent(deviceId); // compte uniquement les envois réels
    return NextResponse.json({ ok: true, nextDrawIn: DRAW_WINDOW_SEC, validation: "bypassed" });
  }

  // ── Vérifier file d'attente avant d'essayer le candidat ────────────────────
  const [existingCandidate, queueLen] = await Promise.all([
    getCurrentCandidate(),
    getQueueLength(),
  ]);

  // Si la file est pleine, bloquer même si le candidat est libre
  if (queueLen >= DRAW_QUEUE_MAX) {
    // Libérer le lock pour que l'utilisateur puisse réessayer
    await redis.del(lockKey(deviceId));
    return NextResponse.json(
      {
        ok:      false,
        error:   `File d'attente pleine (${DRAW_QUEUE_MAX} dessins en attente). Réessayez plus tard.`,
        queueFull: true,
        queueLen,
      },
      { status: 503 },
    );
  }

  // Si un candidat est déjà en cours de validation → mettre en file d'attente
  if (existingCandidate) {
    const queueEntry = {
      deviceId, screen, black, red, buffer,
      actions, replayEvents, drawScore, workTitle, drawArtistName, importWarning,
      submittedAt: Date.now(),
      frameMeta,
    };
    const position = await enqueueDraw(queueEntry);
    const expiresIn = Math.ceil((existingCandidate.expiresAt - Date.now()) / 1000);

    console.log(
      `[draw] device=${deviceId} → file d'attente position=${position}` +
      ` (candidat=${existingCandidate.candidateId.slice(0, 8)} expire dans ${expiresIn}s)`,
    );

    await incrementFramesSent(deviceId); // le dessin est accepté dans la file
    return NextResponse.json({
      ok:           true,
      nextDrawIn:   DRAW_WINDOW_SEC,
      validation:   "queued",
      queuePosition: position,
      queueLen:      position,
      expiresIn,
      message:      `Dessin mis en file d'attente (position ${position}/${DRAW_QUEUE_MAX}). Il sera traité dans ~${expiresIn}s.`,
    });
  }

  // ── Aucun candidat actif → soumettre directement ───────────────────────────
  try {
    const candidateBody = {
      deviceId, screen, black, red, buffer,
      actions, replayEvents, drawScore, workTitle, drawArtistName, importWarning,
    };
    const submitUrl    = new URL("/api/submit-candidate", getBaseUrl(req)).toString();
    const candidateRes = await fetch(submitUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body:    JSON.stringify(candidateBody),
    });

    const candidateData = await candidateRes.json().catch(() => ({}));

    // Rejet explicite (image non retravaillée) — libère le lock immédiatement
    if (candidateRes.status === 400 && candidateData.rejected === true) {
      await redis.del(lockKey(deviceId));
      return NextResponse.json(
        {
          ok:         false,
          validation: "rejected",
          reason:     candidateData.reason,
          message:    candidateData.message,
          drawScore:  candidateData.drawScore,
          score:      candidateData.score,
        },
        { status: 400 },
      );
    }

    if (!candidateRes.ok) {
      throw new Error(candidateData.error ?? `submit-candidate failed (${candidateRes.status})`);
    }

    await incrementFramesSent(deviceId); // soumission acceptée par le réseau
    return NextResponse.json({
      ok:          true,
      nextDrawIn:  DRAW_WINDOW_SEC,
      validation:  "pending",
      candidateId: candidateData.candidateId,
      score:       candidateData.score,
      warning:     candidateData.warning ?? null,
      metrics:     candidateData.metrics,
      poolSize:    candidateData.poolSize,
      queueLen:    0,
      message:     `Dessin soumis au réseau (score: ${(candidateData.score ?? 0).toFixed(3)}). En attente de validation par ${candidateData.poolSize ?? 0} ESP.`,
    });
  } catch (err) {
    console.error("[draw] submit-candidate error:", err);

    // Fallback direct si le serveur interne est indisponible
    const payload: Record<string, string> =
      isDualBuffer(screen) ? { black: black!, red: red! } : { buffer: buffer! };
    await broadcastDirect(screen, payload, deviceId, frameMeta);
    return NextResponse.json({
      ok:         true,
      nextDrawIn: DRAW_WINDOW_SEC,
      validation: "fallback_direct",
    });
  }
}
