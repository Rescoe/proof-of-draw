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

type FrameMeta = { workTitle?: string; drawArtistName?: string; displayTs?: string };

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
