import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { getCurrentCandidate, getVotes } from "@/lib/chain";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;
const RL_WINDOW_SEC = 60;
const RL_MAX = 4;

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  try {
    const ip = getIP(req);
    const deviceId = new URL(req.url).searchParams.get("deviceId");

    if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
      return json({ error: "deviceId invalide", candidate: null }, 400);
    }

    if (await isBlacklisted(ip, deviceId)) {
      return forbidden("Accès refusé");
    }

    const rlKey = `rl:validate-candidate:${deviceId}`;
    const count = await redis.incr(rlKey);
    if (count === 1) await redis.expire(rlKey, RL_WINDOW_SEC);

    if (count > RL_MAX) {
      const ttl = await redis.ttl(rlKey);
      return json({ error: "Trop de requêtes", retryAfter: Math.max(ttl, 0), candidate: null }, 429);
    }

    const device = await getDevice(deviceId);
    if (!device) {
      return json({ error: "Device inconnu", candidate: null }, 404);
    }

    const isActive = Date.now() - device.lastPing < ACTIVE_WINDOW_MS;
    if (!isActive) {
      return json({ error: "Device inactif depuis plus de 30min", candidate: null }, 200);
    }

    const candidate = await getCurrentCandidate();
    if (!candidate) {
      console.log(`[validate-candidate] device=${deviceId} no_active_candidate`);
      return json({ candidate: null }, 200);
    }

    const poolMembers = (await redis.smembers(`pool:screen:${candidate.poolScreen}`)) as string[];
    const isInPool = poolMembers.includes(deviceId);

    const voteMap = await getVotes();
    const alreadyVoted = !!(voteMap && voteMap.candidateId === candidate.candidateId && voteMap.votes?.[deviceId]);

    console.log(`[validate-candidate] device=${deviceId} candidate=${candidate.candidateId} inPool=${isInPool} alreadyVoted=${alreadyVoted} poolSize=${candidate.poolSize} warning=${candidate.warning ?? "none"}`);

    if (!isInPool) {
      return json({ candidate: null, inPool: false, candidateId: candidate.candidateId }, 200);
    }

    if (alreadyVoted) {
      return json({ candidate: null, alreadyVoted: true, candidateId: candidate.candidateId }, 200);
    }

    const expiresIn = Math.max(Math.ceil((candidate.expiresAt - Date.now()) / 1000), 0);

    return json({
      candidate: {
        candidateId: candidate.candidateId,
        poolScreen: candidate.poolScreen,
        drawingHash: candidate.drawingHash,
        score_server: candidate.score,
        submittedAt: candidate.submittedAt,
        expiresIn,
        warning: candidate.warning ?? null,
        payload: candidate.payload ?? null,
        isPoolMember: isInPool,
      },
    }, 200);
  } catch (err) {
    console.error("[validate-candidate] fatal error:", err);
    return json({ error: "Erreur interne", candidate: null }, 500);
  }
}
