// app/api/pull/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { getFrameForDevice } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { getChainSummary, getCurrentCandidate } from "@/lib/chain";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const PULL_WINDOW_SEC = parseInt(process.env.PULL_WINDOW_SEC ?? "900");
const PULL_MAX = parseInt(process.env.PULL_LIMIT_PER_WINDOW ?? "2");
const BLACKLIST_TTL = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");

const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;
const rlKey = (deviceId: string) => `rl:pull:${deviceId}`;
const blDevKey = (deviceId: string) => `bl:dev:${deviceId}`;

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
  try {
    const ip = getIP(req);
    const deviceId = new URL(req.url).searchParams.get("deviceId");

    if (!deviceId || !DEVICE_ID_REGEX.test(deviceId)) {
      return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
    }

    if (await isBlacklisted(ip, deviceId)) {
      return forbidden("Accès refusé");
    }

    const count = await redis.incr(rlKey(deviceId));
    if (count === 1) await redis.expire(rlKey(deviceId), PULL_WINDOW_SEC);

    if (count > PULL_MAX) {
      const ttl = await redis.ttl(rlKey(deviceId));

      if (count >= PULL_MAX * 10) {
        await redis.set(blDevKey(deviceId), "1", { ex: BLACKLIST_TTL });
        console.warn(`[pull] auto-blacklist device=${deviceId}`);
      }

      return NextResponse.json(
        {
          error: "Trop de requêtes",
          retryAfter: Math.max(ttl, 0),
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(ttl, 0)),
          },
        },
      );
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

    await redis.set(
      `device:${deviceId}`,
      JSON.stringify({
        ...device,
        lastSeen: Date.now(),
        lastPing: Date.now(),
      }),
      { ex: 48 * 3600 },
    );

    let frameToSend: any = null;
    let frameSource: "consensus" | "personal" | "none" = "none";

    if (consensusFrame?.payload) {
      frameToSend = {
        ...consensusFrame.payload,
        frameId: consensusFrame.frameId,
      };
      frameSource = "consensus";
    } else if (personalFrame?.payload) {
      frameToSend = {
        ...personalFrame.payload,
        frameId: personalFrame.frameId,
      };
      frameSource = "personal";
    }

    let pendingValidation: any = null;

    if (candidate) {
      const isInPool = await redis.sismember(`pool:screen:${candidate.poolScreen}`, deviceId);

      const votesRaw = await redis.get("candidate:votes");
      let alreadyVoted = false;

      if (votesRaw) {
        try {
          const voteMap = typeof votesRaw === "string" ? JSON.parse(votesRaw) : votesRaw;
          alreadyVoted = !!voteMap?.votes?.[deviceId];
        } catch {
          alreadyVoted = false;
        }
      }

      if (isInPool && !alreadyVoted) {
        pendingValidation = {
          candidateId: candidate.candidateId,
          poolScreen: candidate.poolScreen,
          expiresIn: Math.max(Math.ceil((candidate.expiresAt - Date.now()) / 1000), 0),
          warning: candidate.warning ?? null,
        };
      }

      console.log(
        `[pull] device=${deviceId} frame=${frameSource} candidate=${candidate.candidateId} inPool=${isInPool} alreadyVoted=${alreadyVoted}`,
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
  } catch (err) {
    console.error("[pull] fatal error:", err);
    return NextResponse.json(
      { error: "Erreur interne" },
      { status: 500 },
    );
  }
}