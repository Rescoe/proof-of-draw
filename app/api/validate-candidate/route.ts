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

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { getCurrentCandidate, getVotes } from "@/lib/chain";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

export async function GET(req: NextRequest) {
  const ip       = getIP(req);
  const deviceId = new URL(req.url).searchParams.get("deviceId");

  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }

  // ── 1. Blacklist ───────────────────────────────────────────────────────────
  if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

  // ── 2. Rate limit : 1/min par device ──────────────────────────────────────
  const rlKey = `rl:validate-candidate:${deviceId}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, 60);
  if (count > 4) { // 4 requêtes/min max
    return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
  }

  // ── 3. Device valide et actif ──────────────────────────────────────────────
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

  // ── 4. Candidat courant ────────────────────────────────────────────────────
  const candidate = await getCurrentCandidate();
  if (!candidate) {
    return NextResponse.json({ candidate: null });
  }

  // ── 5. Vérifier pool + vote en parallèle (O(1) chacun) ───────────────────
  const [isInPool, voteMap] = await Promise.all([
    redis.sismember(`pool:screen:${candidate.poolScreen}`, deviceId),
    getVotes(),
  ]);

  // ── 6. Déjà voté ? ────────────────────────────────────────────────────────
  if (voteMap && voteMap.candidateId === candidate.candidateId && voteMap.votes[deviceId]) {
    return NextResponse.json({
      candidate: null,
      alreadyVoted: true,
      candidateId: candidate.candidateId,
    });
  }

  // ── 7. Retourner le candidat ───────────────────────────────────────────────
  // Payload complet uniquement pour les membres de la pool.
  // Les non-membres ne reçoivent jamais pendingValidation via /api/pull,
  // donc ce cas ne devrait pas se produire en pratique (garde-fou).

  const expiresIn = Math.ceil((candidate.expiresAt - Date.now()) / 1000);

  return NextResponse.json({
    candidate: {
      candidateId:  candidate.candidateId,
      poolScreen:   candidate.poolScreen,
      score_server: candidate.score,
      expiresIn,
      payload:      isInPool ? candidate.payload : null,
    },
  });
}