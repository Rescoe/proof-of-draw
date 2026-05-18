// app/api/pull/route.ts
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { getFrameForDevice, FramePayload } from "@/lib/queue";
import { isBlacklisted, getIP, forbidden } from "@/lib/rateLimit";
import { getChainHead, getCurrentCandidate, popObsTask } from "@/lib/chain";
import type { ChainSummary } from "@/lib/chain";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
// Rate limit raisonnablement généreux : 5 pulls/min par device (validation loop ~30s)
const PULL_WINDOW_SEC = parseInt(process.env.PULL_WINDOW_SEC ?? "60");
const PULL_MAX        = parseInt(process.env.PULL_LIMIT_PER_WINDOW ?? "5");
const BLACKLIST_TTL   = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");

const rlKey       = (deviceId: string) => `rl:pull:${deviceId}`;
const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;
const blDevKey    = (deviceId: string) => `bl:dev:${deviceId}`;

async function getPersonalFrame(deviceId: string) {
  const raw = await redis.get(personalKey(deviceId));
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Retourne le payload sans les buffers image (black/red/buffer)
 * mais CONSERVE le champ "screen" — le firmware en a besoin pour
 * router le fetch vers /api/pull-frame?screen=...
 */
function payloadMeta(payload: FramePayload): Record<string, unknown> {
  const { ...rest } = payload as Record<string, unknown>;
  delete rest["black"];
  delete rest["red"];
  delete rest["buffer"];
  // "screen" est intentionnellement conservé
  return rest;
}

export async function GET(req: NextRequest) {
  try {
    const ip       = getIP(req);
    const url      = new URL(req.url);
    const deviceId = url.searchParams.get("deviceId");

    if (!deviceId || !DEVICE_ID_REGEX.test(deviceId))
      return json({
        error: "deviceId invalide",
        frame: null, frameSource: "none",
        frameId: null, screen: null,
        chain: null, pendingValidation: null,
      }, 400);

    if (await isBlacklisted(ip, deviceId)) return forbidden("Accès refusé");

    // ── Rate limit ──────────────────────────────────────────────────────────
    const count = await redis.incr(rlKey(deviceId));
    if (count === 1) await redis.expire(rlKey(deviceId), PULL_WINDOW_SEC);

    if (count > PULL_MAX) {
      const ttl = await redis.ttl(rlKey(deviceId));
      if (count >= PULL_MAX * 10) {
        await redis.set(blDevKey(deviceId), "1", { ex: BLACKLIST_TTL });
        console.warn(`[pull] auto-blacklist device=${deviceId}`);
      }
      return json({
        error: "Trop de requêtes",
        retryAfter: Math.max(ttl, 0),
        frame: null, frameSource: "none",
        frameId: null, screen: null,
        chain: null, pendingValidation: null,
      }, 429);
    }

    // ── Fetch parallèle ─────────────────────────────────────────────────────
    // getChainHead() remplace getChainSummary() pour éviter un double read Redis
    // et accéder aux champs workTitle / drawArtistName du bloc (métadonnées cartel).
    const [device, consensusFrame, personalFrame, chainHead, candidate] =
      await Promise.all([
        getDevice(deviceId),
        getFrameForDevice(deviceId, []),
        getPersonalFrame(deviceId),
        getChainHead(),
        getCurrentCandidate(),
      ]);

    // Résumé chaîne (sous-ensemble de chainHead, rétrocompat réponse JSON)
    const chainSummary: ChainSummary | null = chainHead
      ? {
          blockIndex:  chainHead.blockIndex,
          blockHash:   chainHead.blockHash,
          displayTime: chainHead.displayTime,
          artistName:  chainHead.artistName,
          poolScreen:  chainHead.poolScreen,
          minedAt:     chainHead.minedAt,
        }
      : null;

    if (!device)
      return json({
        error: "device inconnu",
        frame: null, frameSource: "none",
        frameId: null, screen: null,
        chain: null, pendingValidation: null,
      }, 404);

    // ── Ping device (skip si mis à jour il y a moins de 4 min — réduit le quota Redis) ──
    const recentlyUpdated =
      Math.max(device.lastSeen ?? 0, device.lastPing ?? 0) > Date.now() - 4 * 60 * 1000;
    if (!recentlyUpdated) {
      await redis.set(
        `device:${deviceId}`,
        JSON.stringify({ ...device, lastSeen: Date.now(), lastPing: Date.now() }),
        { ex: 48 * 3600 }
      );
    }

    // ── Sélection frame ─────────────────────────────────────────────────────
    let frameMeta: Record<string, unknown> | null = null;
    let frameSource: "consensus" | "personal" | "none" = "none";
    let frameId: string | null = null;
    let screen: string | null = null;

    if (consensusFrame?.payload) {
      frameMeta    = payloadMeta(consensusFrame.payload);
      frameSource  = "consensus";
      frameId      = consensusFrame.frameId ?? null;
      screen       = (consensusFrame.payload as any).screen ?? null;
    } else if (personalFrame?.payload) {
      frameMeta    = payloadMeta(personalFrame.payload);
      frameSource  = "personal";
      frameId      = personalFrame.frameId ?? null;
      screen       = (personalFrame.payload as any).screen ?? null;
    }

    // ── Validation en attente ───────────────────────────────────────────────
    let pendingValidation: any = null;

    if (candidate) {
      const isInPool = await redis.sismember(
        `pool:screen:${candidate.poolScreen}`, deviceId
      );
      const votesRaw = await redis.get("candidate:votes");
      let alreadyVoted = false;
      if (votesRaw) {
        try {
          const voteMap =
            typeof votesRaw === "string" ? JSON.parse(votesRaw) : votesRaw;
          alreadyVoted = !!voteMap?.votes?.[deviceId];
        } catch {}
      }
      if (isInPool && !alreadyVoted) {
        pendingValidation = {
          candidateId: candidate.candidateId,
          poolScreen:  candidate.poolScreen,
          expiresIn:   Math.max(
            Math.ceil((candidate.expiresAt - Date.now()) / 1000), 0
          ),
          warning: candidate.warning ?? null,
        };
      }
      console.log(
        `[pull] device=${deviceId} frame=${frameSource}` +
        ` candidate=${candidate.candidateId}` +
        ` inPool=${isInPool} alreadyVoted=${alreadyVoted}`
      );
    } else {
      console.log(`[pull] device=${deviceId} frame=${frameSource} no_candidate`);
    }

    // ── retryAfter : hint pour les ESP afin de réduire le polling en idle ───
    const isIdle = frameSource === "none" && pendingValidation === null;
    const retryAfter = isIdle ? 300 : 60;

    // ── Métadonnées cartel (lecture à plat, accessible sans parser frame{}) ──
    // Priorité : payload frame Redis → fallback chaîne (chain:head).
    // Le chemin validation ne stocke pas toujours les métadonnées dans le frame Redis,
    // mais elles sont toujours présentes dans le bloc chaîne après minage.
    const fm = frameMeta as Record<string, unknown> | null;

    // Timestamp de minage depuis chain:head (fallback si displayTs absent du frame)
    // Converti en heure de Paris (CET/CEST) — même format que /api/draw
    let fallbackTs: string | null = null;
    if (chainHead?.minedAt) {
      const _md = new Date(chainHead.minedAt);
      const _pp = new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(_md);
      const _pm: Record<string, string> = {};
      _pp.forEach(p => { if (p.type !== "literal") _pm[p.type] = p.value; });
      fallbackTs = `${_pm.day}/${_pm.month}/${_pm.year} ${_pm.hour}:${_pm.minute} (Paris)`;
    }

    const cartelMeta = {
      // Frame payload en priorité ; sinon lecture directe depuis le bloc chaîne
      workTitle:      (fm?.["workTitle"]      as string | undefined)
                      || (chainHead?.workTitle ?? null),
      drawArtistName: (fm?.["drawArtistName"] as string | undefined)
                      || (chainHead?.drawArtistName ?? chainHead?.artistName ?? null),
      displayTs:      (fm?.["displayTs"]      as string | undefined) ?? fallbackTs,
      blockIndex:     chainSummary?.blockIndex ?? -1,
    };

    // ── Tâche d'observation (device idle → revalide des blocs antérieurs) ────
    // L'ESP n'affiche rien de nouveau — il envoie juste une confirmation serveur.
    // La tâche est dépilée de la queue uniquement quand le device est vraiment idle.
    let pendingObservation: { blockHashes: string[]; targetBlockHash?: string; enqueuedAt: number } | null = null;
    if (isIdle) {
      const obsTask = await popObsTask();
      if (obsTask?.blockHashes?.length) {
        pendingObservation = {
          blockHashes:      obsTask.blockHashes,
          targetBlockHash:  obsTask.targetBlockHash,
          enqueuedAt:       obsTask.enqueuedAt,
        };
        console.log(`[pull] obs task → device=${deviceId} hashes=${obsTask.blockHashes.length}`);
      }
    }

    // ── Réponse ─────────────────────────────────────────────────────────────
    return json({
      frameId,
      frameSource,
      screen,

      // Métadonnées lues directement à la racine par le firmware — évite
      // le parsing imbriqué dans frame{} et fonctionne quel que soit le chemin
      // (BYPASS, validation, fallback)
      cartelMeta,

      // frame{} conservé pour compatibilité anciens firmwares
      frame: frameMeta
        ? { frameId, screen, frameSource, ...frameMeta }
        : null,

      chain:              chainSummary,
      pendingValidation,
      pendingObservation,
      retryAfter,
    });

  } catch (err) {
    console.error("[pull] fatal error:", err);
    return json({
      error: "Erreur interne",
      frame: null, frameSource: "none",
      frameId: null, screen: null,
      chain: null, pendingValidation: null,
    }, 500);
  }
}