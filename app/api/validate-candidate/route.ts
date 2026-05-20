// app/api/validate-candidate/route.ts
// Les ESP validateurs viennent chercher ici les métadonnées du candidat.
//
// Flux ESP (V1) :
//   GET /api/validate-candidate?deviceId=dev_XXXXXXXX
//     → reçoit { candidate: { candidateId, score_server, expiresIn } }
//     → vote avec score_server comme valeur de référence
//     → POST /api/validation-result
//
// Design : VALIDATION GLOBALE, AFFICHAGE PAR ÉCRAN
//   Tout ESP actif du réseau peut voter, peu importe son type d'écran.
//   Seul le broadcast d'affichage reste filtré (pool:screen:{id}).
//   Un ESP OLED peut valider un bloc TFT — il ne l'affichera pas, mais sa
//   présence et son vote comptent pour le quorum du réseau.
//
//   Avantage : inclusif pour les petits réseaux multi-écrans. Un seul ESP
//   par type d'écran ne bloque plus le consensus.
//
// Un ESP ne peut valider que si :
//   1. Il est enregistré et actif (lastPing < 30min)
//   2. Il n'a pas déjà voté pour ce candidat

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

  // ── 5. Vérifier si déjà voté ─────────────────────────────────────────────
  // Validation globale : tout ESP actif peut voter, peu importe son écran.
  const voteMap = await getVotes();

  if (voteMap && voteMap.candidateId === candidate.candidateId && voteMap.votes[deviceId]) {
    return NextResponse.json({
      candidate: null,
      alreadyVoted: true,
      candidateId: candidate.candidateId,
    });
  }

  // ── 6. Retourner les métadonnées du candidat (sans payload) ──────────────
  // Le payload n'est pas envoyé : 40Ko de base64 épuiserait le heap TLS de
  // l'ESP8266. En V1, l'ESP vote avec score_server comme valeur de référence.
  // En V2 : endpoint /api/candidate-payload (binaire) pour métriques réelles.
  // poolScreen est fourni pour info — l'ESP peut l'afficher si son écran correspond.

  const expiresIn = Math.ceil((candidate.expiresAt - Date.now()) / 1000);

  return NextResponse.json({
    candidate: {
      candidateId:  candidate.candidateId,
      score_server: candidate.score,
      poolScreen:   candidate.poolScreen, // info : type d'écran du dessin candidat
      expiresIn,
    },
  });
}