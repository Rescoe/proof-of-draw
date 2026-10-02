// lib/broadcast.ts
// Écrit une frame directement dans Redis pour un ou plusieurs devices, sans
// passer par le candidate/vote ESP. broadcastDirect() est extrait de
// app/api/draw/route.ts (BYPASS_VALIDATION / fallback) — comportement
// inchangé, il cible le pool de devices partagé d'un type d'écran.
// broadcastToDevices() cible une liste explicite de devices, pour le pont ANA
// (app/api/ana-art/submit) : un contenu déjà modéré côté ANA ne doit pas
// rejoindre le pool de vote humain, seulement les devices ayant opté in.

import { redis } from "@/lib/redis";
import { frameKey } from "@/lib/queue";
import { getConvertedReceivers } from "@/lib/deviceStore";
import { convertPayload } from "@/lib/screenConvert";
import { SCREEN_IDS } from "@/lib/screenProfiles";
import type { ScenePointer } from "@/lib/scene/delivery";

const DRAW_WINDOW_SEC = parseInt(process.env.DRAW_WINDOW_SEC ?? "900");
// broadcastToDevices() (the ANA bridge) was reusing DRAW_WINDOW_SEC (15 min) —
// a constant meant for the human draw/validate candidate window, not for
// already-moderated, permanent gallery content. A device only pulls at most
// every ~7.5 min (2 pulls/15min rate limit — see CLAUDE.md), so a 15-minute
// frame TTL left almost no margin: any delay in the pipeline, or a device
// slightly out of phase with its poll cycle, and the frame expired from Redis
// before ever being displayed — confirmed live (23/09): "Monument — 200
// Normies" showed correctly in the app (a real, permanent Block record — see
// anaChain.ts) but never reached any of the 3 physical screens, which stayed
// on a much older, unrelated human-drawn block instead. validation-result.ts
// gives validated human content up to 7200s (2h) for exactly this reason —
// ANA content, meant to be a lasting piece, deserves at least the same.
const ANA_FRAME_TTL_SEC = parseInt(process.env.ANA_FRAME_TTL_SEC ?? "7200");

// `scene` : pointeur léger vers le paquet ANAS (scene-v1) — jamais le paquet lui-même ; la frame (buffer) reste le repli.
// `anaKind` / `blockHash` : nature de l'œuvre ANA et son bloc galerie, pour la vue réseau « en direct » (lib/displayState.ts).
type FrameMeta = { workTitle?: string; drawArtistName?: string; displayTs?: string; scene?: ScenePointer; anaKind?: string; blockHash?: string };

function buildFrame(
  screen: string, payload: Record<string, string>, sourceDeviceId: string, meta?: FrameMeta,
): string {
  return JSON.stringify({
    payload: { ...payload, screen, ...meta },
    frameId: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceDeviceId,
  });
}

/**
 * Diffuse un dessin conçu pour `sourceScreen` vers les écrans d'AUTRES types
 * dont le propriétaire a activé la réception de conversions (réglage par écran,
 * voir Device.acceptsConvertedScreens). Le dessin est converti une fois par type
 * d'écran cible (lib/screenConvert.ts) puis écrit dans la clé frame:{device}:{écran}
 * de chaque récepteur. Ne lève jamais : un échec de conversion ne doit pas
 * casser la diffusion native — les erreurs sont loguées.
 *
 * `extra` = champs additionnels du payload (métadonnées cartel, _block…),
 * `frameId` = même id que la frame native pour que le firmware traite les deux
 * de la même façon.
 */
export async function broadcastConverted(
  sourceScreen: string,
  payload: Record<string, unknown>,
  opts: { frameId?: string; extra?: Record<string, unknown>; ttlSec: number; sourceDeviceId: string },
): Promise<void> {
  try {
    for (const target of SCREEN_IDS) {
      if (target === sourceScreen) continue;
      const receivers = (await getConvertedReceivers(target)).map((d) => d.deviceId);
      if (receivers.length === 0) continue;

      const bans = await redis.mget<(string | null)[]>(...receivers.map((dId) => `bl:dev:${dId}`));
      const eligible = receivers.filter((_, i) => !bans[i]);
      if (eligible.length === 0) continue;

      const converted = convertPayload({ ...payload, screen: sourceScreen }, target);
      if (!converted) { console.warn(`[broadcast] conversion ${sourceScreen}→${target} impossible`); continue; }

      const stored = JSON.stringify({
        payload: { ...converted, ...opts.extra },
        frameId: opts.frameId ?? crypto.randomUUID(),
        createdAt: Date.now(),
        sourceDeviceId: opts.sourceDeviceId,
      });
      await Promise.all(eligible.map((dId) => redis.set(frameKey(dId, target), stored, { ex: opts.ttlSec })));
      console.log(`[broadcast] converti ${sourceScreen}→${target} devices=${eligible.length}`);
    }
  } catch (e) {
    console.error("[broadcast] broadcastConverted error:", e);
  }
}

export async function broadcastDirect(
  screen: string,
  payload: Record<string, string>,
  deviceId: string,
  meta?: FrameMeta,
): Promise<void> {
  const stored  = buildFrame(screen, payload, deviceId, meta);
  const members = (await redis.smembers(`pool:screen:${screen}`)) as string[];
  const targets = members.length > 0 ? members : [deviceId];
  await Promise.all(
    targets.map((dId) => redis.set(frameKey(dId, screen), stored, { ex: DRAW_WINDOW_SEC })),
  );
  await broadcastConverted(screen, payload, {
    extra: meta, ttlSec: DRAW_WINDOW_SEC, sourceDeviceId: deviceId,
  });
}

export async function broadcastToDevices(
  deviceIds: string[],
  screen: string,
  payload: Record<string, string>,
  meta?: FrameMeta,
): Promise<void> {
  if (deviceIds.length === 0) return;
  const stored = buildFrame(screen, payload, "ana-bridge", meta);
  await Promise.all(
    deviceIds.map((dId) => redis.set(frameKey(dId, screen), stored, { ex: ANA_FRAME_TTL_SEC })),
  );
}
