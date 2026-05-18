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
  hashPodEnriched,
  computeEnrichment,
  MIN_COMPLEXITY_SCORE,
} from "@/lib/crypto";
import { setCandidate, getCurrentCandidate, Candidate } from "@/lib/chain";
import type { ActionEvent, ReplayEvent } from "@/lib/types/actions";

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
  const actions      = Array.isArray(body.actions)      ? (body.actions      as ActionEvent[])  : [];
  const replayEvents = Array.isArray(body.replayEvents) ? (body.replayEvents as ReplayEvent[])  : [];
  const drawScore    = typeof body.drawScore === "number" ? body.drawScore : 0;
  const workTitle    = typeof body.workTitle      === "string" ? body.workTitle.trim().slice(0, 80)  : undefined;
  const drawArtistName = typeof body.drawArtistName === "string" ? body.drawArtistName.trim().slice(0, 40) : undefined;

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

  // ── Rejet automatique : image chargée non retravaillée ───────────────────────
  // Condition : faible effort créatif (drawScore ≤ 1) ET faible complexité visuelle
  // (score < MIN_COMPLEXITY_SCORE). Les deux conditions ensemble indiquent une image
  // importée affichée telle quelle, sans travail artistique ajouté.
  if (drawScore <= 1 && metrics.score < MIN_COMPLEXITY_SCORE) {
    console.warn(
      `[submit-candidate] REJET automatique device=${deviceId}` +
      ` drawScore=${drawScore} complexity=${metrics.score.toFixed(4)}` +
      ` — image chargée non retravaillée`,
    );
    // Stocker en Redis pour l'audit (sans TTL — blocs rejetés conservés)
    const rejectedEntry = JSON.stringify({
      deviceId, screen, drawScore,
      score: metrics.score,
      reason: "low_quality_imported_image",
      rejectedAt: Date.now(),
      workTitle: workTitle ?? null,
      drawArtistName: drawArtistName ?? null,
    });
    await redis.lpush("rejected:draws", rejectedEntry);
    await redis.ltrim("rejected:draws", 0, 199);  // garder les 200 derniers

    return NextResponse.json({
      rejected:  true,
      reason:    "low_quality_imported_image",
      message:   `Dessin rejeté : image chargée non retravaillée (Score PoD=${drawScore}, complexité=${(metrics.score * 100).toFixed(2)}%). Dessinez davantage pour enrichir l'œuvre.`,
      drawScore,
      score:     metrics.score,
    }, { status: 400 });
  }

  const existing = await getCurrentCandidate();
  if (existing) {
    return NextResponse.json({
      error: "Un dessin est déjà en cours de validation",
      candidateId: existing.candidateId,
      expiresIn: Math.ceil((existing.expiresAt - Date.now()) / 1000),
    }, { status: 409 });
  }

  // Calculer les hashes (actions + enrichissement replay)
  const [imageHash, actionsHash] = await Promise.all([
    hashDrawing(screen, black, red, buffer),
    hashActions(actions),
  ]);

  // Axe 4 : calcul du hash enrichi si des events de replay sont fournis
  const enrichment = replayEvents.length > 0
    ? computeEnrichment(replayEvents, actions)
    : null;
  const podEnrichedHash = enrichment
    ? await hashPodEnriched(actionsHash, enrichment)
    : undefined;

  // Axe 2 : si drawArtistName est fourni, vérifier que l'ESP est bien en mode public
  const deviceOwnerName = device.artistName ?? "Artiste inconnu";
  const effectiveArtistName = drawArtistName || deviceOwnerName;

  const poolSize = await getActivePoolSize(screen);
  const CANDIDATE_TTL_SEC = parseInt(process.env.CANDIDATE_TTL_SEC ?? "600");

  const candidate: Candidate = {
    candidateId: crypto.randomUUID(),
    deviceId,
    artistName:      deviceOwnerName,         // propriétaire de l'ESP
    drawArtistName:  drawArtistName,           // artiste dessinateur (si ESP en prêt)
    deviceOwnerName: deviceOwnerName,
    workTitle:       workTitle || "Sans titre",
    poolScreen: screen,
    payload: screen === "eink29bwr"
      ? { screen: "eink29bwr", black: black!, red: red! }
      : { screen: screen as any, buffer: buffer! },
    imageHash,
    actionsHash,
    drawScore,
    actionSequence: actions,
    replayEvents:   replayEvents.length > 0 ? replayEvents : undefined,
    podHashEnriched: podEnrichedHash,
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
