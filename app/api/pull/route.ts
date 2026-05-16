// app/api/pull/route.ts
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { getFrameForDevice, FramePayload } from "@/lib/queue";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { getChainSummary, getCurrentCandidate } from "@/lib/chain";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const PULL_WINDOW_SEC = parseInt(process.env.PULL_WINDOW_SEC ?? "900");
const PULL_MAX = parseInt(process.env.PULL_LIMIT_PER_WINDOW ?? "2");
const BLACKLIST_TTL = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");

const rlKey      = (deviceId: string) => `rl:pull:${deviceId}`;
const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;
const blDevKey   = (deviceId: string) => `bl:dev:${deviceId}`;

async function getPersonalFrame(deviceId: string) {
  const raw = await redis.get(personalKey(deviceId));
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

function json(body: any, status = 200) { return NextResponse.json(body, { status }); }

/** Retourne le payload sans les buffers image (black/red/buffer) */
function payloadMeta(payload: FramePayload): Record<string, unknown> {
  const { ...rest } = payload as Record<string, unknown>;
  delete rest["black"];
  delete rest["red"];
  delete rest["buffer"];
  return rest;
}

export async function GET(req: NextRequest) {
  try {
    const ip = getIP(req);
    const deviceId = new URL(req.url).searchParams.get("deviceId");

    if (!deviceId || !DEVICE_ID_REGEX.test(deviceId))
      return json({ error: "deviceId invalide", frame: null, frameSource: "none", chain: null, pendingValidation: null }, 400);
    if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

    const count = await redis.incr(rlKey(deviceId));
    if (count === 1) await redis.expire(rlKey(deviceId), PULL_WINDOW_SEC);

    if (count > PULL_MAX) {
      const ttl = await redis.ttl(rlKey(deviceId));
      if (count >= PULL_MAX * 10) {
        await redis.set(blDevKey(deviceId), "1", { ex: BLACKLIST_TTL });
        console.warn(`[pull] auto-blacklist device=${deviceId}`);
      }
      return json({ error: "Trop de requêtes", retryAfter: Math.max(ttl, 0), frame: null, frameSource: "none", chain: null, pendingValidation: null }, 429);
    }

    const [device, consensusFrame, personalFrame, chainSummary, candidate] = await Promise.all([
      getDevice(deviceId),
      getFrameForDevice(deviceId, []),
      getPersonalFrame(deviceId),
      getChainSummary(),
      getCurrentCandidate(),
    ]);

    if (!device)
      return json({ error: "device inconnu", frame: null, frameSource: "none", chain: null, pendingValidation: null }, 404);

    await redis.set(
      `device:${deviceId}`,
      JSON.stringify({ ...device, lastSeen: Date.now(), lastPing: Date.now() }),
      { ex: 48 * 3600 }
    );

    let frame: any = null;
    let frameSource: "consensus" | "personal" | "none" = "none";

    if (consensusFrame?.payload) {
      frame = { frameId: consensusFrame.frameId, ...payloadMeta(consensusFrame.payload) };
      frameSource = "consensus";
    } else if (personalFrame?.payload) {
      frame = { frameId: personalFrame.frameId, ...payloadMeta(personalFrame.payload) };
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
        } catch {}
      }
      if (isInPool && !alreadyVoted) {
        pendingValidation = {
          candidateId: candidate.candidateId,
          poolScreen:  candidate.poolScreen,
          expiresIn:   Math.max(Math.ceil((candidate.expiresAt - Date.now()) / 1000), 0),
          warning:     candidate.warning ?? null,
        };
      }
      console.log(`[pull] device=${deviceId} frame=${frameSource} candidate=${candidate.candidateId} inPool=${isInPool} alreadyVoted=${alreadyVoted}`);
    } else {
      console.log(`[pull] device=${deviceId} frame=${frameSource} no_candidate`);
    }

    return json({ frame, frameSource, chain: chainSummary, pendingValidation }, 200);
  } catch (err) {
    console.error("[pull] fatal error:", err);
    return json({ error: "Erreur interne", frame: null, frameSource: "none", chain: null, pendingValidation: null }, 500);
  }
}