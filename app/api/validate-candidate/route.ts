// app/api/validate-candidate/route.ts
// Les ESP validateurs viennent chercher ici le dessin candidat à valider.
//
// Flux ESP :
//   GET /api/validate-candidate?deviceId=dev_XXXXXXXX
//     → reçoit { candidate: { candidateId, payload, score_server } }
//     → calcule localement entropie + transitions + RLE
//     → POST /api/validation-result avec les métriques signées
//
// Rate limit : 1 requête par minute par device (les ESP ne doivent pas poller
// trop souvent — ils sont notifiés via le pull classique qu'un candidat existe)
//
// Un ESP ne peut valider que si :
//   1. Il est enregistré et actif (lastPing < 30min)
//   2. Il fait partie de la pool du screen candidat
//   3. Il n'a pas déjà voté pour ce candidat
// app/api/validate-candidate/route.ts

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { getCurrentCandidate, getVotes } from "@/lib/chain";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  const deviceId = new URL(req.url).searchParams.get("deviceId");

  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }

  if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

  const rlKey = `rl:validate-candidate:${deviceId}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, 60);
  if (count > 4) {
    return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
  }

  const device = await getDevice(deviceId);
  if (!device) {
    return NextResponse.json({ error: "Device inconnu" }, { status: 404 });
  }

  const isActive = Date.now() - device.lastPing < ACTIVE_WINDOW_MS;
  if (!isActive) {
    return NextResponse.json({
      error: "Device inactif depuis plus de 30min",
      candidate: null,
    });
  }

  const candidate = await getCurrentCandidate();
  if (!candidate) {
    console.log(`[validate-candidate] device=${deviceId} no_active_candidate`);
    return NextResponse.json({ candidate: null });
  }

  const poolMembers = (await redis.smembers(`pool:screen:${candidate.poolScreen}`)) as string[];
  const isInPool = poolMembers.includes(deviceId);

  const voteMap = await getVotes();
  const alreadyVoted = !!(voteMap && voteMap.candidateId === candidate.candidateId && voteMap.votes[deviceId]);

  console.log(
    `[validate-candidate] device=${deviceId} candidate=${candidate.candidateId} inPool=${isInPool} alreadyVoted=${alreadyVoted} poolSize=${candidate.poolSize} warning=${candidate.warning ?? "none"}`
  );

  if (alreadyVoted) {
    return NextResponse.json({
      candidate: null,
      alreadyVoted: true,
      candidateId: candidate.candidateId,
    });
  }

  const expiresIn = Math.ceil((candidate.expiresAt - Date.now()) / 1000);

  return NextResponse.json({
    candidate: {
      candidateId: candidate.candidateId,
      poolScreen: candidate.poolScreen,
      drawingHash: candidate.drawingHash,
      score_server: candidate.score,
      submittedAt: candidate.submittedAt,
      expiresIn,
      warning: candidate.warning ?? null,
      payload: isInPool ? candidate.payload : null,
      isPoolMember: isInPool,
    },
  });
}