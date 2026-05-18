// app/api/draw-queue/route.ts
// Retourne l'état de la file d'attente et du candidat courant.

import { NextResponse } from "next/server";
import { getQueueLength, peekQueue, DRAW_QUEUE_MAX } from "@/lib/drawQueue";
import { getCurrentCandidate } from "@/lib/chain";

export async function GET() {
  const [queueLen, candidate, preview] = await Promise.all([
    getQueueLength(),
    getCurrentCandidate(),
    peekQueue(3),
  ]);

  const expiresIn = candidate
    ? Math.max(0, Math.ceil((candidate.expiresAt - Date.now()) / 1000))
    : null;

  return NextResponse.json({
    queueLen,
    queueMax: DRAW_QUEUE_MAX,
    queueFull: queueLen >= DRAW_QUEUE_MAX,
    candidate: candidate
      ? {
          candidateId: candidate.candidateId,
          deviceId:    candidate.deviceId,
          screen:      candidate.poolScreen,
          expiresIn,
          poolSize:    candidate.poolSize,
        }
      : null,
    preview: preview.map((e) => ({
      deviceId:    e["deviceId"],
      screen:      e["screen"],
      workTitle:   e["workTitle"] ?? null,
      submittedAt: e["submittedAt"] ?? null,
    })),
  });
}
