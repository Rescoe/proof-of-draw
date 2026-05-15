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

  // ── 5. Vérifier que ce device fait partie de la pool concernée ─────────────
  const poolMembers = await redis.smembers(`pool:screen:${candidate.poolScreen}`) as string[];
  const isInPool = poolMembers.includes(deviceId);

  // Si l'ESP n'est pas dans la pool du candidat, il peut quand même valider
  // en tant que "témoin externe" mais avec un poids réduit (V1 : on les inclut)
  // Note pour V2 : filtrer strictement par pool

  // ── 6. Vérifier que ce device n'a pas déjà voté ───────────────────────────
  const voteMap = await getVotes();
  if (voteMap && voteMap.candidateId === candidate.candidateId && voteMap.votes[deviceId]) {
    return NextResponse.json({
      candidate: null,
      alreadyVoted: true,
      candidateId: candidate.candidateId,
    });
  }

  // ── 7. Retourner le candidat (sans le payload complet si externe à la pool) ─
  // Pour économiser la bande passante, on envoie le payload complet uniquement
  // aux ESP de la pool — les autres reçoivent juste le hash pour vérification.

  const expiresIn = Math.ceil((candidate.expiresAt - Date.now()) / 1000);

  return NextResponse.json({
    candidate: {
      candidateId: candidate.candidateId,
      poolScreen:  candidate.poolScreen,
      drawingHash: candidate.drawingHash,
      score_server: candidate.score,
      submittedAt: candidate.submittedAt,
      expiresIn,
      // Payload complet pour les membres de la pool (ils doivent afficher si validé)
      // Payload null pour les témoins externes (ils valident sur hash uniquement)
      payload: isInPool ? candidate.payload : null,
      isPoolMember: isInPool,
    },
  });
}