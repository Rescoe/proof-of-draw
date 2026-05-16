// app/api/submit-candidate/route.ts
// Reçoit un dessin validé par /api/draw et le soumet comme candidat au consensus.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import {
  computeComplexity,
  decodeEinkBuffer,
  mergeChannels,
  hashDrawing,
  hashActions,
  MIN_COMPLEXITY_SCORE,
} from "@/lib/crypto";
import { setCandidate, getCurrentCandidate, Candidate } from "@/lib/chain";
import type { ActionEvent } from "@/lib/types/actions";

const INTERNAL_SECRET  = process.env.INTERNAL_API_SECRET ?? "";
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

async function getActivePoolSize(screenId: string): Promise<number> {
  const members = (await redis.smembers(`pool:screen:${screenId}`)) as string[];
  if (!members || members.length === 0) return 1;

  const devices = await Promise.all(
    members.map(async (deviceId) => {
      const raw = await redis.get(`device:${deviceId}`);
      if (!raw) return null;
      try {
        const d = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Date.now() - d.lastPing < ACTIVE_WINDOW_MS ? d : null;
      } catch {
        return null;
      }
    }),
  );

  return Math.max(1, devices.filter(Boolean).length);
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (INTERNAL_SECRET && secret !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { deviceId, screen, black, red, buffer } = body as Record<string, string>;
  const actions   = Array.isArray(body.actions) ? (body.actions as ActionEvent[]) : [];
  const drawScore = typeof body.drawScore === "number" ? body.drawScore : 0;

  if (!deviceId || !screen) {
    return NextResponse.json({ error: "deviceId et screen requis" }, { status: 400 });
  }

  const device = await getDevice(deviceId);
  if (!device) {
    return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
  }

  let pixels: Uint8Array;

  if (screen === "eink29bwr" && black && red) {
    const bPx = decodeEinkBuffer(black, 296, 128);
    const rPx = decodeEinkBuffer(red, 296, 128);
    pixels = mergeChannels(bPx, rPx);
  } else if (screen === "eink27bw" && buffer) {
    pixels = decodeEinkBuffer(buffer, 176, 264);
  } else if (screen === "oled096" && buffer) {
    pixels = decodeEinkBuffer(buffer, 128, 64);
  } else {
    return NextResponse.json({ error: "Payload incomplet" }, { status: 400 });
  }

  const W = screen === "eink29bwr" ? 296 : screen === "eink27bw" ? 176 : 128;
  const H = screen === "eink29bwr" ? 128 : screen === "eink27bw" ? 264 : 64;

  const metrics = computeComplexity(pixels, W, H);
  const warning =
    metrics.score < MIN_COMPLEXITY_SCORE
      ? `Dessin très simple (score ${metrics.score.toFixed(3)} < ${MIN_COMPLEXITY_SCORE}). Le validateur décidera.`
      : null;

  console.log(`[submit-candidate] device=${deviceId} screen=${screen} score=${metrics.score.toFixed(3)} drawScore=${drawScore}${warning ? " warning=low_complexity" : ""}`);

  const existing = await getCurrentCandidate();
  if (existing) {
    return NextResponse.json({
      error: "Un dessin est déjà en cours de validation",
      candidateId: existing.candidateId,
      expiresIn: Math.ceil((existing.expiresAt - Date.now()) / 1000),
    }, { status: 409 });
  }

  // Calculer les deux hashes
  const [imageHash, actionsHash] = await Promise.all([
    hashDrawing(screen, black, red, buffer),
    hashActions(actions),
  ]);

  const poolSize = await getActivePoolSize(screen);
  const CANDIDATE_TTL_SEC = parseInt(process.env.CANDIDATE_TTL_SEC ?? "600");

  const candidate: Candidate = {
    candidateId: crypto.randomUUID(),
    deviceId,
    artistName: device.artistName ?? "Artiste inconnu",
    poolScreen: screen,
    payload: screen === "eink29bwr"
      ? { screen: "eink29bwr", black: black!, red: red! }
      : { screen: screen as any, buffer: buffer! },
    imageHash,
    actionsHash,
    drawScore,
    actionSequence: actions,
    score: metrics.score,
    submittedAt: Date.now(),
    expiresAt: Date.now() + CANDIDATE_TTL_SEC * 1000,
    poolSize,
    warning,
  };

  await setCandidate(candidate);

  console.log(`[submit-candidate] candidat créé id=${candidate.candidateId} poolSize=${poolSize} score=${metrics.score.toFixed(3)} drawScore=${drawScore} actionsHash=${actionsHash.slice(0, 12)}...`);

  return NextResponse.json({
    ok: true,
    candidateId: candidate.candidateId,
    score: metrics.score,
    warning,
    metrics: {
      entropy:     metrics.entropy,
      transitions: metrics.transitions,
      rle:         metrics.rle,
    },
    poolSize,
    expiresIn: CANDIDATE_TTL_SEC,
  });
}
