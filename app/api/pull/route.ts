// app/api/pull/route.ts
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { writeDeviceKey, type Device } from "@/lib/deviceStore";
import { SCREEN_IDS } from "@/lib/screenProfiles";
import { HOT_KEY, idleRetrySec, presenceStale, rlSampled, RL_SAMPLED_BLACKLIST, RL_SAMPLED_MAX } from "@/lib/pullBudget";
import { frameKey, parseStoredFrame, oldestFrame, FramePayload } from "@/lib/queue";
import { getIP, forbidden } from "@/lib/rateLimit";
import { benchScreenOf } from "@/lib/bench/screens";
import { parseChainHeadRaw, parseCandidateRaw, PULL_KEY_HEAD, PULL_KEY_CANDIDATE, PULL_KEY_VOTES, PULL_KEY_OBS_PENDING, popObsTask } from "@/lib/chain";
import type { ChainSummary } from "@/lib/chain";
import { maybeCheckAnaFeed } from "@/lib/anaFeed";
import { selectDelivery, withoutScenePointer, sceneRetryAfterSec, scenePullMeta, type DeliverySelection } from "@/lib/scene/delivery";
import { animPullMeta, withoutAnimPointer } from "@/lib/anim/pointer";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
// Rate-limit ÉCHANTILLONNÉ (lib/pullBudget.ts) : 1 pull sur 8 compte ; > RL_SAMPLED_MAX dans la fenêtre = ≈ 32 pulls/min réels → 429.
const PULL_WINDOW_SEC = parseInt(process.env.PULL_WINDOW_SEC ?? "60");
const BLACKLIST_TTL   = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");

const rlKey       = (deviceId: string) => `rl:pull:${deviceId}`;
const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;
const blDevKey    = (deviceId: string) => `bl:dev:${deviceId}`;

function parsePersonal(raw: unknown) {
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

// QUOTA REDIS : INCR + EXPIRE en UNE commande (EVAL) au lieu de deux.
const RL_SCRIPT = "local c=redis.call('INCR',KEYS[1]); if c==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return c";

function json(body: unknown, status = 200) {
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
  // "screen" est intentionnellement conservé.
  // Le pointeur scene-v1 est retiré : le JSON léger ne doit JAMAIS grossir pour un firmware qui ne l'a pas demandé
  // (DynamicJsonDocument de 512–1024 octets côté ESP) ; un appareil scene-v1 le reçoit dans le bloc `scene` dédié.
  // Pointeur d'animation : retiré de la même façon — il est annoncé dans le bloc `anim` de la réponse, et seulement aux firmwares qui le lisent.
  return withoutAnimPointer(withoutScenePointer(rest));
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

    // ── Rate limit ÉCHANTILLONNÉ ────────────────────────────────────────────
    // Un écran normal tire ≤ 1 fois/min : il ne touche presque jamais Redis ici (1 pull sur 8). Un emballement (≈ 32 pulls/min et plus) est coupé en quelques secondes.
    if (rlSampled(Math.random())) {
      const count = Number(await redis.eval(RL_SCRIPT, [rlKey(deviceId)], [String(PULL_WINDOW_SEC)]));
      if (count > RL_SAMPLED_MAX) {
        const ttl = await redis.ttl(rlKey(deviceId));
        if (count >= RL_SAMPLED_BLACKLIST) {
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
    }

    // ── UN SEUL MGET : appareil + frames + tête de chaîne + candidat + votes + notification + banc d'essai + drapeau d'observation ──
    // Les clés de frame de TOUS les types d'écran sont lues (SCREEN_IDS) : on n'a plus besoin de lire l'appareil d'abord pour connaître ses écrans.
    // Coût d'un pull au repos : 1 commande (+ ≈ 0,125 de rate-limit échantillonné + ≈ 0,3 de présence toutes les 12 min). 5 avant le 05/10/2026.
    const FRAME_IDS = SCREEN_IDS as readonly string[];
    const raws = await redis.mget<unknown[]>(
      `bl:ip:${ip}`, blDevKey(deviceId), `device:${deviceId}`,
      ...FRAME_IDS.map((s) => frameKey(deviceId, s)),
      personalKey(deviceId), PULL_KEY_HEAD, PULL_KEY_CANDIDATE, PULL_KEY_VOTES,
      `chain:notify:${deviceId}`, `bench:mode:${deviceId}`, PULL_KEY_OBS_PENDING, HOT_KEY,
    );
    if (raws[0] !== null || raws[1] !== null) return forbidden("Accès refusé");
    let device: Device | null = null;
    try { device = raws[2] ? (typeof raws[2] === "string" ? JSON.parse(raws[2] as string) : (raws[2] as Device)) : null; } catch { device = null; }
    if (!device)
      return json({
        error: "device inconnu",
        frame: null, frameSource: "none",
        frameId: null, screen: null,
        chain: null, pendingValidation: null,
      }, 404);
    const screens = device.screens ?? [];
    const frameRaws = FRAME_IDS.map((s, i) => (screens.includes(s) ? raws[3 + i] : null));
    const rest = raws.slice(3 + FRAME_IDS.length);
    // La plus ancienne frame gagne (même règle que getFrameForDevice : les écrans d'un appareil multi-écran tournent équitablement)
    const consensusFrame = oldestFrame(frameRaws.map(parseStoredFrame));
    const personalFrame = parsePersonal(rest[0]);
    const chainHead = parseChainHeadRaw(rest[1]);
    const candidate = parseCandidateRaw(rest[2]);
    const votesRawMget = rest[3];
    const ownedNotif = (rest[4] as string | null) ?? null;
    const benchModeRaw = rest[5];
    const obsPending = rest[6] !== null && rest[6] !== undefined;
    const networkHot = rest[7] !== null && rest[7] !== undefined;   // quelqu'un a dessiné / envoyé / ouvert l'atelier depuis < 30 min
    // Mode banc d'essai actif pour un écran compatible (TFT 2.8", TFT 1.8", OLED) : annoncé à l'appareil, qui passe en contrôle rapide.
    const benchMode = benchScreenOf(device.screens) !== null && benchModeRaw !== null && benchModeRaw !== undefined;

    // Consomme la notification (one-shot) — le device la reçoit une seule fois
    if (ownedNotif) {
      await redis.del(`chain:notify:${deviceId}`);
    }

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

    // ── Pont ANA : vérification opportuniste (pas de cron) ──────────────────
    // Débattue à l'échelle du système (voir maybeCheckAnaFeed) — la plupart
    // des pulls ne déclenchent qu'une lecture Redis quasi gratuite, un vrai
    // fetch vers ANA n'a lieu qu'au plus une fois par ANA_FEED_CHECK_DEBOUNCE_SEC.
    if (device.acceptsAnaArt) {
      await maybeCheckAnaFeed();
    }

    // ── Ping device : réécrit seulement si lastSeen/lastPing ont plus de 12 min (en ligne = 20 min) — réduit le quota Redis ──
    if (presenceStale(device, Date.now())) {
      await writeDeviceKey({ ...device, lastSeen: Date.now(), lastPing: Date.now() });   // 1 commande, TTL selon l'appairage
    }

    // ── Sélection frame ─────────────────────────────────────────────────────
    let frameMeta: Record<string, unknown> | null = null;
    let frameSource: "consensus" | "personal" | "none" = "none";
    let frameId: string | null = null;
    let screen: string | null = null;
    // scene-v1 : décidé ici, sans aucune lecture Redis supplémentaire (device + frame déjà lus). `kind: "frame"` par défaut.
    let delivery: DeliverySelection = { kind: "frame" };

    if (consensusFrame?.payload) {
      frameMeta    = payloadMeta(consensusFrame.payload);
      frameSource  = "consensus";
      frameId      = consensusFrame.frameId ?? null;
      screen       = (consensusFrame.payload as Record<string, unknown>).screen as string ?? null;
      delivery     = selectDelivery(device, screen, consensusFrame.payload as Record<string, unknown>);
    } else if (personalFrame?.payload) {
      frameMeta    = payloadMeta(personalFrame.payload);
      frameSource  = "personal";
      frameId      = personalFrame.frameId ?? null;
      screen       = (personalFrame.payload as Record<string, unknown>).screen as string ?? null;
    }

    // ── Validation en attente ───────────────────────────────────────────────
    // Validation globale : tout ESP actif peut voter, peu importe son écran.
    // Le filtre pool:screen ne s'applique plus ici (seulement au broadcast d'affichage).
    let pendingValidation: { candidateId: string; poolScreen: string; expiresIn: number; warning: string | null } | null = null;

    if (candidate) {
      const votesRaw = votesRawMget;   // déjà lu dans le MGET du début : zéro commande de plus
      let alreadyVoted = false;
      if (votesRaw) {
        try {
          const voteMap =
            typeof votesRaw === "string" ? JSON.parse(votesRaw) : votesRaw;
          alreadyVoted = !!voteMap?.votes?.[deviceId];
        } catch {}
      }
      if (!alreadyVoted) {
        pendingValidation = {
          candidateId: candidate.candidateId,
          poolScreen:  candidate.poolScreen, // info seulement — l'ESP peut l'afficher si son écran correspond
          expiresIn:   Math.max(
            Math.ceil((candidate.expiresAt - Date.now()) / 1000), 0
          ),
          warning: candidate.warning ?? null,
        };
      }
    }

    // ── retryAfter : hint pour les ESP afin de réduire le polling en idle ───
    // QUOTA REDIS : une frame PERSONNELLE (« Afficher sur mon écran ») n'est pas supprimée par l'ACK (elle sert à restaurer l'image après un redémarrage).
    // Si l'appareil l'a déjà confirmée (ACK postérieur à sa création), il n'a rien de nouveau : rythme de repos (300 s) au lieu de 60 s — avant, un écran qui
    // affichait une image envoyée depuis la galerie tirait le pull chaque minute, indéfiniment (≈ 240 commandes/heure/écran).
    const personalAlreadyShown = frameSource === "personal" && typeof personalFrame?.createdAt === "number" && (device.lastFrameReceivedAt ?? 0) >= personalFrame.createdAt;
    const isIdle = (frameSource === "none" || personalAlreadyShown) && pendingValidation === null;
    // Appareil scene-v1 : aucun poll pendant l'animation → retryAfter = durée complète des boucles + marge (contrat §6).
    // Mode banc d'essai actif : l'appareil repasse au pull sous 30 s (au lieu de 300 s au repos) pour découvrir le mode rapidement.
    const retryAfterBase = delivery.kind === "scene" ? sceneRetryAfterSec(delivery) : isIdle ? idleRetrySec(networkHot) : 60;   // repos : 5 min si le réseau est chaud, 15 min sinon (lib/pullBudget.ts)
    const retryAfter = benchMode ? Math.min(retryAfterBase, 30) : retryAfterBase;

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
      // Image renvoyée depuis une galerie : le n° du bloc d'origine (send-to-screen) ; sinon la tête de chaîne.
      blockIndex:     typeof fm?.["blockIndex"] === "number" ? (fm["blockIndex"] as number) : (chainSummary?.blockIndex ?? -1),
    };

    // ── Tâche d'observation (device idle → revalide des blocs antérieurs) ────
    // L'ESP n'affiche rien de nouveau — il envoie juste une confirmation serveur.
    // La tâche est dépilée de la queue uniquement quand le device est vraiment idle.
    let pendingObservation: { blockHashes: string[]; targetBlockHash?: string; enqueuedAt: number } | null = null;
    // Le drapeau chain:obs:pending (déjà lu dans le MGET) dit s'il y a quelque chose à dépiler : sinon aucune commande.
    if (isIdle && obsPending) {
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

    // Animation validée (bloc `kind:"animation"`) : pointeur vers le clip, SEULEMENT pour un écran dont le firmware le lit (r4tft28-2.4+).
    // L'écran télécharge le clip une fois (/api/block-clip), le range sur sa carte SD et le joue en boucle : plus aucun poll rapide.
    // (aussi pour une image renvoyée depuis la galerie : « Afficher sur mon écran » sur un bloc d'animation pose le même pointeur)
    const animPointer = animPullMeta(device, screen, (frameSource === "consensus" ? consensusFrame?.payload : frameSource === "personal" ? personalFrame?.payload : undefined) as Record<string, unknown> | undefined);

    // ── Banc d'essai d'animation (TFT 2.8" tactile uniquement) : 1 GET, seulement pour ces appareils ──
    // Quand le propriétaire a activé le mode, on le dit à l'appareil ; il passe alors en poll rapide sur /api/bench/poll.

    // ── Réponse ─────────────────────────────────────────────────────────────
    // Bloc `scene` : métadonnées SEULES — le binaire passe par /api/pull-frame?kind=scene.
    const sceneMeta = delivery.kind === "scene" ? scenePullMeta(delivery) : undefined;

    return json({
      frameId,
      frameSource,
      screen,
      // `kind` ("frame" | "scene") et `scene` : UNIQUEMENT pour un appareil ayant déclaré scene-v1. Un firmware existant
      // reçoit exactement la même réponse qu'avant (zéro octet ajouté — son JSON est dimensionné au plus juste).
      ...(device.sceneCapability?.sceneV1 ? { kind: delivery.kind } : {}),
      ...(sceneMeta ? { scene: sceneMeta } : {}),
      ...(animPointer ? { anim: animPointer } : {}),

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

      // Notification de propriété (one-shot) : présent uniquement le pull qui suit le minage.
      // L'ESP doit sauvegarder ce hash dans ses slots EEPROM "blocs possédés".
      // null si ce device n'a pas miné de nouveau bloc depuis le dernier pull.
      ownedBlock: ownedNotif ?? null,

      // Uniquement pour un TFT 2.8" dont le propriétaire a activé le banc d'essai (zéro octet ajouté sinon).
      ...(benchMode ? { benchMode: true } : {}),
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