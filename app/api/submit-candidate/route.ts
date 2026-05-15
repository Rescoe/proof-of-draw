// app/api/submit-candidate/route.ts
// Reçoit un dessin validé par /api/draw et le soumet comme candidat au consensus.
//
// Ce endpoint est appelé DEPUIS draw/route.ts (server-side fetch interne),
// pas directement par le client ou l'ESP.
//
// Flux :
//   draw/route.ts valide session + lock + device
//     → appelle submit-candidate avec le payload
//       → calcule la complexité serveur
//       → vérifie seuil minimal (anti-spam)
//       → crée le candidat dans Redis
//       → les ESP viendront chercher le candidat via /api/validate-candidate

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import {
  computeComplexity, isComplexityValid,
  decodeEinkBuffer, mergeChannels,
  hashDrawing, MIN_COMPLEXITY_SCORE,
} from "@/lib/crypto";
import { setCandidate, getCurrentCandidate, Candidate } from "@/lib/chain";

// Seul le serveur lui-même peut appeler ce endpoint (via fetch interne)
// On vérifie un secret partagé dans les headers
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

// Taille de la pool active = nb d'ESP ayant pull dans les dernières 30min
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

async function getActivePoolSize(screenId: string): Promise<number> {
  const members = await redis.smembers(`pool:screen:${screenId}`) as string[];
  if (!members || members.length === 0) return 1;

  // Vérifie lastPing pour chaque membre
  const devices = await Promise.all(
    members.map(async (deviceId) => {
      const raw = await redis.get(`device:${deviceId}`);
      if (!raw) return null;
      try {
        const d = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Date.now() - d.lastPing < ACTIVE_WINDOW_MS ? d : null;
      } catch { return null; }
    })
  );

  const activeCount = devices.filter(Boolean).length;
  return Math.max(1, activeCount);
}

export async function POST(req: NextRequest) {
  // Vérification secret interne
  const secret = req.headers.get("x-internal-secret");
  if (INTERNAL_SECRET && secret !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { deviceId, screen, black, red, buffer } = body as Record<string, string>;

  if (!deviceId || !screen) {
    return NextResponse.json({ error: "deviceId et screen requis" }, { status: 400 });
  }

  // ── 1. Récupérer le device ─────────────────────────────────────────────────
  const device = await getDevice(deviceId);
  if (!device) {
    return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
  }

  // ── 2. Calculer la complexité côté serveur ─────────────────────────────────
  let pixels: Uint8Array;

  if (screen === "eink29bwr" && black && red) {
    const bPx = decodeEinkBuffer(black, 296, 128);
    const rPx = decodeEinkBuffer(red,   296, 128);
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

  console.log(`[submit-candidate] device=${deviceId} screen=${screen} score=${metrics.score.toFixed(3)}`);

  // ── 3. Vérifier seuil minimal ──────────────────────────────────────────────
  if (!isComplexityValid(metrics)) {
    return NextResponse.json({
      error: `Dessin trop simple (score ${metrics.score.toFixed(3)} < ${MIN_COMPLEXITY_SCORE}). Ajoutez du contenu.`,
      score: metrics.score,
      minRequired: MIN_COMPLEXITY_SCORE,
    }, { status: 422 });
  }

  // ── 4. Vérifier qu'il n'y a pas déjà un candidat en cours ─────────────────
  const existing = await getCurrentCandidate();
  if (existing) {
    return NextResponse.json({
      error: "Un dessin est déjà en cours de validation",
      candidateId: existing.candidateId,
      expiresIn: Math.ceil((existing.expiresAt - Date.now()) / 1000),
    }, { status: 409 });
  }

  // ── 5. Hash du dessin ──────────────────────────────────────────────────────
  const drawingHash = await hashDrawing(screen, black, red, buffer);

  // ── 6. Taille de la pool active ────────────────────────────────────────────
  const poolSize = await getActivePoolSize(screen);

  // ── 7. Créer le candidat ───────────────────────────────────────────────────
  const CANDIDATE_TTL_SEC = parseInt(process.env.CANDIDATE_TTL_SEC ?? "600");

  const candidate: Candidate = {
    candidateId:  crypto.randomUUID(),
    deviceId,
    artistName:   device.artistName ?? "Artiste inconnu",
    poolScreen:   screen,
    payload:      screen === "eink29bwr"
                    ? { screen: "eink29bwr", black: black!, red: red! }
                    : { screen: screen as any, buffer: buffer! },
    drawingHash,
    score:        metrics.score,
    submittedAt:  Date.now(),
    expiresAt:    Date.now() + CANDIDATE_TTL_SEC * 1000,
    poolSize,
  };

  await setCandidate(candidate);

  console.log(`[submit-candidate] candidat créé id=${candidate.candidateId} poolSize=${poolSize} score=${metrics.score.toFixed(3)}`);

  return NextResponse.json({
    ok:          true,
    candidateId: candidate.candidateId,
    score:       metrics.score,
    metrics: {
      entropy:     metrics.entropy,
      transitions: metrics.transitions,
      rle:         metrics.rle,
    },
    poolSize,
    expiresIn: CANDIDATE_TTL_SEC,
  });
}