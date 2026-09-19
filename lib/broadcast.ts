// lib/broadcast.ts
// Écrit une frame directement dans Redis pour un ou plusieurs devices, sans
// passer par le candidate/vote ESP. broadcastDirect() est extrait de
// app/api/draw/route.ts (BYPASS_VALIDATION / fallback) — comportement
// inchangé, il cible le pool de devices partagé d'un type d'écran.
// broadcastToDevices() cible une liste explicite de devices, pour le pont ANA
// (app/api/ana-art/submit) : un contenu déjà modéré côté ANA ne doit pas
// rejoindre le pool de vote humain, seulement les devices ayant opté in.

import { redis } from "@/lib/redis";

const DRAW_WINDOW_SEC = parseInt(process.env.DRAW_WINDOW_SEC ?? "900");

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
    targets.map((dId) => redis.set(`frame:${dId}`, stored, { ex: DRAW_WINDOW_SEC })),
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
    deviceIds.map((dId) => redis.set(`frame:${dId}`, stored, { ex: DRAW_WINDOW_SEC })),
  );
}
