// app/api/validate-candidate/route.ts
// Les ESP validateurs viennent chercher ici les métadonnées du candidat.
//
// Flux ESP (V1) :
//   GET /api/validate-candidate?deviceId=dev_XXXXXXXX
//     → reçoit { candidate: { candidateId, score_server, expiresIn } }
//     → vote avec score_server comme valeur de référence
//     → POST /api/validation-result
//
// Pas de payload dans la réponse (V1) : l'ESP vote sur présence dans la pool.
// V2 ajoutera /api/candidate-payload (binaire, sans overhead base64+JSON)
// pour que l'ESP puisse calculer ses propres métriques indépendamment.
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

  // ── 7. Retourner les métadonnées du candidat (sans payload) ──────────────
  // Le payload n'est pas envoyé : 13KB de base64 épuiserait le heap TLS de
  // l'ESP8266. En V1, l'ESP vote avec score_server comme référence.
  // En V2 : endpoint /api/candidate-payload (binaire) pour les métriques réelles.

  if (!isInPool) {
    // Ne devrait pas arriver (pull envoie pendingValidation seulement aux membres)
    return NextResponse.json({ candidate: null });
  }

  const expiresIn = Math.ceil((candidate.expiresAt - Date.now()) / 1000);

  return NextResponse.json({
    candidate: {
      candidateId:  candidate.candidateId,
      score_server: candidate.score,
      expiresIn,
    },
  });
}