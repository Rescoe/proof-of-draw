// app/api/validation-result/route.ts
// Les ESP soumettent ici leurs métriques calculées localement.
//
// Corps attendu :
// {
//   deviceId:    "dev_XXXXXXXX",
//   candidateId: "uuid",
//   entropy:     0.72,
//   transitions: 0.41,
//   rle:         0.38,
//   score:       0.54,
//   signature:   "dev_XXXXXXXX:uuid:0.54"   // simplifié V1 — pas de crypto asymétrique côté ESP encore
// }
//
// Quand le quorum est atteint :
//   → finalise le bloc
//   → broadcast la frame validée à toute la pool
//   → supprime le candidat de Redis
//   → les ESP recevront la frame au prochain pull

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import {
  getCurrentCandidate, getVotes, castVote,
  finalizeBlock, clearCandidate, ValidationVote,
} from "@/lib/chain";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { storeFrame } from "@/lib/queue";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const BLACKLIST_TTL   = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");
const FRAME_TTL_SEC   = parseInt(process.env.DRAW_WINDOW_SEC ?? "900");

// ─── Broadcast vers toute la pool ────────────────────────────────────────────

async function broadcastValidatedFrame(
  poolScreen: string,
  payload: any,
  frameId: string,
  displayTime: number,
  blockIndex: number,
  artistName: string,
): Promise<void> {
  const members = await redis.smembers(`pool:screen:${poolScreen}`) as string[];
  if (!members || members.length === 0) return;

  // Filtre les bannis
  const banChecks = await Promise.all(
    members.map(async (dId) => {
      const banned = await redis.get(`bl:dev:${dId}`);
      return { deviceId: dId, banned: !!banned };
    })
  );
  const eligible = banChecks.filter(x => !x.banned).map(x => x.deviceId);

  // La frame broadcastée inclut les métadonnées du bloc
  const enrichedPayload = {
    ...payload,
    _block: {
      index:       blockIndex,
      artistName,
      displayTime,
      frameId,
      minedAt: Date.now(),
    },
  };

  const stored = JSON.stringify({
    payload:   enrichedPayload,
    frameId,
    createdAt: Date.now(),
    sourceDeviceId: "consensus",
  });

  // TTL = displayTime du bloc (pas le TTL fixe de 15min)
  const ttl = Math.max(900, Math.min(displayTime, 7200));

  await Promise.all(
    eligible.map(dId =>
      redis.set(`frame:${dId}`, stored, { ex: ttl })
    )
  );

  console.log(`[validation-result] broadcast → ${eligible.length} devices pool=${poolScreen} ttl=${ttl}s`);
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  // ── 1. Blacklist ───────────────────────────────────────────────────────────
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const {
    deviceId, candidateId,
    entropy, transitions, rle, score,
    signature,
  } = body as Record<string, string | number>;

  if (!deviceId || !DEVICE_ID_REGEX.test(String(deviceId))) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }

  if (!candidateId || !entropy || !transitions || !rle || !score) {
    return NextResponse.json({ error: "Métriques manquantes" }, { status: 400 });
  }

  // ── 3. Device valide ───────────────────────────────────────────────────────
  const device = await getDevice(String(deviceId));
  if (!device) {
    return NextResponse.json({ error: "Device inconnu" }, { status: 404 });
  }

  // ── 4. Candidat courant correspondant ──────────────────────────────────────
  const candidate = await getCurrentCandidate();
  if (!candidate) {
    return NextResponse.json({ error: "Aucun candidat actif" }, { status: 409 });
  }

  if (candidate.candidateId !== String(candidateId)) {
    return NextResponse.json({
      error: "candidateId ne correspond pas au candidat actif",
      current: candidate.candidateId,
    }, { status: 409 });
  }

  // ── 5. Vérification de cohérence des métriques ────────────────────────────
  // Anti-triche basique : le score soumis par l'ESP doit être proche
  // du score calculé côté serveur (±30% de tolérance pour les arrondis ESP)
  const espScore    = Number(score);
  const serverScore = candidate.score;
  const drift       = Math.abs(espScore - serverScore);

  if (drift > 0.4) {
    // Score très divergent → strike
    const strikeKey = `strikes:ip:${ip}`;
    const strikes   = await redis.incr(strikeKey);
    if (strikes === 1) await redis.expire(strikeKey, 3600);

    if (strikes >= 5) {
      await redis.set(`bl:ip:${ip}`, "score_drift", { ex: BLACKLIST_TTL });
      console.warn(`[validation-result] BAN ip=${ip} score drift trop grand esp=${espScore} server=${serverScore}`);
    }

    console.warn(`[validation-result] score drift device=${deviceId} esp=${espScore} server=${serverScore}`);
    return NextResponse.json({
      error: `Score trop divergent (esp=${espScore.toFixed(3)}, server=${serverScore.toFixed(3)})`,
    }, { status: 422 });
  }

  // ── 6. Vérification signature simplifiée (V1) ─────────────────────────────
  // V1 : signature = "deviceId:candidateId:score" — pas de crypto asymétrique
  // V2 : remplacer par ED25519 verify avec la pubkey stockée sur le device
  const expectedSig = `${deviceId}:${candidateId}:${espScore.toFixed(3)}`;
  if (signature && String(signature) !== expectedSig) {
    console.warn(`[validation-result] signature invalide device=${deviceId}`);
    // En V1 on logge mais on ne rejette pas — crypto complète en V2
  }

  // ── 7. Enregistrer le vote ─────────────────────────────────────────────────
  const vote: ValidationVote = {
    deviceId:    String(deviceId),
    entropy:     Number(entropy),
    transitions: Number(transitions),
    rle:         Number(rle),
    score:       espScore,
    signature:   String(signature ?? ""),
    votedAt:     Date.now(),
  };

  const { quorumReached, voteCount, needed } = await castVote(vote, candidate);

  console.log(`[validation-result] vote device=${deviceId} score=${espScore.toFixed(3)} votes=${voteCount}/${needed} quorum=${quorumReached}`);

  // ── 8. Quorum atteint → finaliser le bloc ─────────────────────────────────
  if (quorumReached) {
    const voteMap = await getVotes();
    const allVotes = voteMap ? Object.values(voteMap.votes) : [vote];

    const frameId = crypto.randomUUID();

    const block = await finalizeBlock(candidate, allVotes, frameId);

    // Broadcast la frame validée à toute la pool
    broadcastValidatedFrame(
      candidate.poolScreen,
      candidate.payload,
      frameId,
      block.displayTime,
      block.blockIndex,
      candidate.artistName,
    ).catch(err => console.error("[validation-result] broadcast error:", err));

    // Nettoie le candidat
    await clearCandidate();

    // Efface les personal frames de la pool (le bloc validé prend le dessus)
    const poolMembers = await redis.smembers(`pool:screen:${candidate.poolScreen}`) as string[];
    Promise.all(
      poolMembers.map(dId => redis.del(`personal:frame:${dId}`))
    ).catch(err => console.error("[validation-result] clear personal frames error:", err));

    console.log(`[validation-result] BLOC #${block.blockIndex} finalisé hash=${block.blockHash.slice(0, 12)}... display=${block.displayTime}s`);

    return NextResponse.json({
      ok:           true,
      blockMined:   true,
      blockIndex:   block.blockIndex,
      blockHash:    block.blockHash,
      displayTime:  block.displayTime,
      score:        block.score,
      artistName:   block.artistName,
      voteCount,
    });
  }

  // ── 9. Quorum pas encore atteint ──────────────────────────────────────────
  return NextResponse.json({
    ok:          true,
    blockMined:  false,
    voteCount,
    needed,
    candidateId: candidate.candidateId,
    expiresIn:   Math.ceil((candidate.expiresAt - Date.now()) / 1000),
  });
}