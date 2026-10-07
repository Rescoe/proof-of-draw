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
//
// Un ESP ne peut valider que si :
//   1. Il est enregistré et actif (lastPing < ACTIVE_WINDOW_MS)
//   2. Il n'a pas déjà voté pour ce candidat
//
// COÛT REDIS : 1 MGET (blacklist IP + appareil + blacklist appareil + candidat + votes) + 1/8 de rate-limit échantillonné ≈ 1,1 commande
// (≈ 7 avant le 05/10/2026 : 2 blacklists, INCR + EXPIRE, appareil, candidat, votes).

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { Device } from "@/lib/deviceStore";
import { parseCandidateRaw, parseVotesRaw, PULL_KEY_CANDIDATE, PULL_KEY_VOTES } from "@/lib/chain";
import { getIP, forbidden } from "@/lib/rateLimit";
import { ACTIVE_WINDOW_MS, rlSampled } from "@/lib/pullBudget";
import { eligibilityConfigFromEnv, eligibilityModeFromEnv, voteGate } from "@/lib/eligibility";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
// Rate-limit échantillonné (1 requête sur 8) : > 2 échantillons dans la minute ≈ 16 requêtes/min (le firmware en fait ≤ 2/min)
const RL_SCRIPT = "local c=redis.call('INCR',KEYS[1]); if c==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return c";
const RL_SAMPLED_MAX = 2;

export async function GET(req: NextRequest) {
  const ip       = getIP(req);
  const deviceId = new URL(req.url).searchParams.get("deviceId");

  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }

  // ── 1. Tout en un MGET : blacklists, appareil, candidat courant, votes ────
  const raws = await redis.mget<unknown[]>(
    `bl:ip:${ip}`, `bl:dev:${deviceId}`, `device:${deviceId}`, PULL_KEY_CANDIDATE, PULL_KEY_VOTES,
  );
  if (raws[0] !== null || raws[1] !== null) return forbidden("Accès refusé");

  // ── 2. Rate limit échantillonné ───────────────────────────────────────────
  if (rlSampled(Math.random())) {
    const count = Number(await redis.eval(RL_SCRIPT, [`rl:validate-candidate:${deviceId}`], ["60"]));
    if (count > RL_SAMPLED_MAX) return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
  }

  // ── 3. Device valide et actif ──────────────────────────────────────────────
  let device: Device | null = null;
  try { device = raws[2] ? (typeof raws[2] === "string" ? JSON.parse(raws[2] as string) : (raws[2] as Device)) : null; } catch { device = null; }
  if (!device) {
    return NextResponse.json({ error: "Device inconnu" }, { status: 404 });
  }
  const isActive = Date.now() - device.lastPing < ACTIVE_WINDOW_MS;
  if (!isActive) {
    return NextResponse.json({
      error: "Device inactif depuis trop longtemps",
      candidate: null,
    });
  }

  // ── 4. Candidat courant ────────────────────────────────────────────────────
  const candidate = parseCandidateRaw(raws[3]);
  if (!candidate) {
    return NextResponse.json({ candidate: null });
  }

  // ── 5. Vérifier si déjà voté ───────────────────────────────────────────────
  const voteMap = parseVotesRaw(raws[4]);
  if (voteMap && voteMap.candidateId === candidate.candidateId && voteMap.votes[deviceId]) {
    return NextResponse.json({
      candidate: null,
      alreadyVoted: true,
      candidateId: candidate.candidateId,
    });
  }

  // ── 5 bis. Éligibilité (Lot 2) : aucune lecture Redis de plus (appareil, candidat et votes déjà lus ci-dessus) ─────────────────────────────────
  const eligMode = eligibilityModeFromEnv();
  if (eligMode !== "off" && candidate.eligibility) {
    const prior = new Set<string>();
    if (voteMap && voteMap.candidateId === candidate.candidateId) for (const v of Object.values(voteMap.votes)) if (v.profileId && v.deviceId !== deviceId) prior.add(v.profileId);
    const gate = voteGate({ mode: eligMode, eligibility: candidate.eligibility, device, now: Date.now(), cfg: eligibilityConfigFromEnv(), priorVoterProfiles: prior });
    if (gate.action === "shadow-refuse") console.warn(`[eligibility] SHADOW refuserait validate-candidate device=${deviceId} raison=${gate.reason} profil=${gate.profileId ?? "?"}`);
    if (gate.action === "refuse") {
      console.warn(`[eligibility] REFUS validate-candidate device=${deviceId} raison=${gate.reason} profil=${gate.profileId ?? "?"}`);
      return NextResponse.json(gate.reason === "profile-already-voted"
        ? { candidate: null, alreadyVoted: true, candidateId: candidate.candidateId, profileRepresented: true }
        : { candidate: null, ineligible: gate.reason, candidateId: candidate.candidateId });
    }
  }

  // ── 6. Retourner les métadonnées du candidat (sans payload) ───────────────
  // Le payload n'est pas envoyé : 40Ko de base64 épuiserait le heap TLS de l'ESP8266. L'ESP vote avec score_server comme valeur de référence.
  // poolScreen est fourni pour info — l'ESP peut l'afficher si son écran correspond.
  const expiresIn = Math.ceil((candidate.expiresAt - Date.now()) / 1000);

  return NextResponse.json({
    candidate: {
      candidateId:  candidate.candidateId,
      score_server: candidate.score,
      poolScreen:   candidate.poolScreen, // info : type d'écran du dessin candidat
      expiresIn,
      // Animation : le score à signer est la moyenne des scores de ses N images (recalculable depuis le bloc). Deux champs de plus
      // seulement pour une animation (≈ 35 octets) : un dessin reçoit exactement la même réponse qu'avant.
      ...(candidate.kind === "animation" && candidate.anim ? { kind: "animation", frames: candidate.anim.frames } : {}),
      // Validation réelle (P2) : ce que l'appareil doit RECALCULER après GET /api/candidate-frame (≈ 110 octets de plus ; absent pour une animation)
      ...(candidate.v2 ? { v2: { screen: candidate.v2.screen, bytes: candidate.v2.rawBytes, hash: candidate.v2.rawHash } } : {}),
    },
  });
}
