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
// app/api/validation-result/route.ts

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { getCurrentCandidate, getVotes, castVote, finalizeBlock, clearCandidate, ValidationVote } from "@/lib/chain";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const BLACKLIST_TTL = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");
const FRAME_TTL_SEC = parseInt(process.env.DRAW_WINDOW_SEC ?? "900");

async function broadcastValidatedFrame(poolScreen: string, payload: any, frameId: string, displayTime: number, blockIndex: number, artistName: string): Promise<void> {
  const members = (await redis.smembers(`pool:screen:${poolScreen}`)) as string[];
  if (!members || members.length === 0) return;

  const banChecks = await Promise.all(members.map(async (dId) => ({ deviceId: dId, banned: !!(await redis.get(`bl:dev:${dId}`)) })));
  const eligible = banChecks.filter((x) => !x.banned).map((x) => x.deviceId);

  const enrichedPayload = {
    ...payload,
    _block: { index: blockIndex, artistName, displayTime, frameId, minedAt: Date.now() },
  };

  const stored = JSON.stringify({ payload: enrichedPayload, frameId, createdAt: Date.now(), sourceDeviceId: "consensus" });
  const ttl = Math.max(900, Math.min(displayTime, 7200));

  await Promise.all(eligible.map((dId) => redis.set(`frame:${dId}`, stored, { ex: ttl })));
  console.log(`[validation-result] broadcast pool=${poolScreen} devices=${eligible.length} ttl=${ttl}s`);
}

function json(body: any, status = 200) { return NextResponse.json(body, { status }); }

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);
    if (await isBlacklisted(ip)) return forbidden("Accès refusé");

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const { deviceId, candidateId, entropy, transitions, rle, score, signature } = body as Record<string, string | number>;

    if (!deviceId || !DEVICE_ID_REGEX.test(String(deviceId))) return json({ error: "deviceId invalide" }, 400);
    if (!candidateId || entropy == null || transitions == null || rle == null || score == null) return json({ error: "Métriques manquantes" }, 400);

    const device = await getDevice(String(deviceId));
    if (!device) return json({ error: "Device inconnu" }, 404);

    const candidate = await getCurrentCandidate();
    if (!candidate) return json({ error: "Aucun candidat actif" }, 409);
    if (candidate.candidateId !== String(candidateId)) return json({ error: "candidateId ne correspond pas au candidat actif", current: candidate.candidateId }, 409);

    const espScore = Number(score);
    const serverScore = candidate.score;
    const drift = Math.abs(espScore - serverScore);
    console.log(`[validation-result] device=${deviceId} candidate=${candidateId} esp=${espScore.toFixed(3)} server=${serverScore.toFixed(3)} drift=${drift.toFixed(3)}`);
    if (drift > 0.4) console.warn(`[validation-result] drift élevé device=${deviceId} candidate=${candidateId} drift=${drift.toFixed(3)}`);

    const expectedSig = `${deviceId}:${candidateId}:${espScore.toFixed(3)}`;
    if (signature && String(signature) !== expectedSig) console.warn(`[validation-result] signature invalide device=${deviceId}`);

    const vote: ValidationVote = { deviceId: String(deviceId), entropy: Number(entropy), transitions: Number(transitions), rle: Number(rle), score: espScore, signature: String(signature ?? ""), votedAt: Date.now() };
    const { quorumReached, voteCount, needed } = await castVote(vote, candidate);

    console.log(`[validation-result] vote device=${deviceId} votes=${voteCount}/${needed} quorum=${quorumReached}`);

    if (quorumReached) {
      const voteMap = await getVotes();
      const allVotes = voteMap ? Object.values(voteMap.votes) : [vote];
      const frameId = crypto.randomUUID();
      const block = await finalizeBlock(candidate, allVotes, frameId);

      await broadcastValidatedFrame(candidate.poolScreen, candidate.payload, frameId, block.displayTime, block.blockIndex, candidate.artistName);
      await clearCandidate();
      const poolMembers = (await redis.smembers(`pool:screen:${candidate.poolScreen}`)) as string[];
      Promise.all(poolMembers.map((dId) => redis.del(`personal:frame:${dId}`))).catch((err) => console.error("[validation-result] clear personal frames error:", err));

      console.log(`[validation-result] BLOC #${block.blockIndex} finalisé hash=${block.blockHash.slice(0, 12)}... display=${block.displayTime}s`);
      return json({ ok: true, blockMined: true, blockIndex: block.blockIndex, blockHash: block.blockHash, displayTime: block.displayTime, score: block.score, artistName: block.artistName, voteCount }, 200);
    }

    return json({ ok: true, blockMined: false, voteCount, needed, candidateId: candidate.candidateId, expiresIn: Math.ceil((candidate.expiresAt - Date.now()) / 1000) }, 200);
  } catch (err) {
    console.error("[validation-result] fatal error:", err);
    return json({ error: "Erreur interne", blockMined: false }, 500);
  }
}
