// app/api/pull/route.ts — v2 avec personal frame + chain summary
//
// Priorité d'affichage pour un ESP :
//   1. Frame validée par le consensus (frame:{deviceId}) — priorité absolue
//   2. Personal frame (personal:frame:{deviceId}) — si pas de frame consensus
//   3. null — rien à afficher
//
// La réponse inclut aussi un chain_summary pour que l'ESP puisse
// synchroniser son état de chaîne (hash courant, displayTime, etc.)
// et savoir s'il doit valider un candidat.

// app/api/pull/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { getFrameForDevice } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { getChainSummary, getCurrentCandidate } from "@/lib/chain";

const PULL_WINDOW_SEC = parseInt(process.env.PULL_WINDOW_SEC ?? "900");
const PULL_MAX = parseInt(process.env.PULL_LIMIT_PER_WINDOW ?? "2");
const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;

const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;

async function getPersonalFrame(deviceId: string): Promise<any | null> {
  const raw = await redis.get(personalKey(deviceId));
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  const deviceId = new URL(req.url).searchParams.get("deviceId");

  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  }

  if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

  const rlKey = `rl:pull:${deviceId}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, PULL_WINDOW_SEC);

  if (count > PULL_MAX) {
    const ttl = await redis.ttl(rlKey);
    if (count >= PULL_MAX * 10) {
      await redis.set(`bl:dev:${deviceId}`, "1", {
        ex: parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800"),
      });
      console.warn(`[pull] auto-blacklist device=${deviceId}`);
    }
    return NextResponse.json({ error: "Trop de requêtes", retryAfter: ttl }, {
      status: 429,
      headers: { "Retry-After": String(ttl) },
    });
  }

  const [device, consensusFrame, personalFrame, chainSummary, candidate] = await Promise.all([
    getDevice(deviceId),
    getFrameForDevice(deviceId, []),
    getPersonalFrame(deviceId),
    getChainSummary(),
    getCurrentCandidate(),
  ]);

  if (!device) {
    return NextResponse.json({ error: "device inconnu" }, { status: 404 });
  }

  redis.set(
    `device:${deviceId}`,
    JSON.stringify({ ...device, lastSeen: Date.now(), lastPing: Date.now() }),
    { ex: 48 * 3600 },
  );

  let frameToSend: any = null;
  let frameSource = "none";

  if (consensusFrame) {
    frameToSend = { ...consensusFrame.payload, frameId: consensusFrame.frameId };
    frameSource = "consensus";
  } else if (personalFrame) {
    frameToSend = { ...personalFrame.payload, frameId: personalFrame.frameId };
    frameSource = "personal";
  }

  let pendingValidation: any = null;
  if (candidate) {
    const isInPool = await redis.sismember(`pool:screen:${candidate.poolScreen}`, deviceId);
    const votes = await redis.get("candidate:votes");
    let alreadyVoted = false;
    if (votes) {
      try {
        const vMap = typeof votes === "string" ? JSON.parse(votes) : votes;
        alreadyVoted = !!vMap.votes?.[deviceId];
      } catch {}
    }

    if (isInPool && !alreadyVoted) {
      pendingValidation = {
        candidateId: candidate.candidateId,
        poolScreen: candidate.poolScreen,
        expiresIn: Math.ceil((candidate.expiresAt - Date.now()) / 1000),
        warning: candidate.warning ?? null,
      };
    }

    console.log(
      `[pull] device=${deviceId} frame=${frameSource} candidate=${candidate.candidateId} inPool=${isInPool} alreadyVoted=${alreadyVoted}`
    );
  } else {
    console.log(`[pull] device=${deviceId} frame=${frameSource} no_candidate`);
  }

  return NextResponse.json({
    frame: frameToSend,
    frameSource,
    chain: chainSummary,
    pendingValidation,
  });
}