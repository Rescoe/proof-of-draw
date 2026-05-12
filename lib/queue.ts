// lib/queue.ts
// Frame store via Upstash Redis
// Une seule frame par device (la dernière) — pas de queue longue
// TTL 15min : si l'ESP ne pull pas dans ce délai, la frame expire seule

import { redis } from "@/lib/redis";

export interface StoredFrame {
  screen:    string;
  payload:   FramePayload;
  storedAt:  number;
  deviceId?: string;
  frameId:   string;
}

export type FramePayload =
  | { screen: "oled096";   buffer: string }
  | { screen: "eink27bw";  buffer: string }
  | { screen: "eink29bwr"; black: string; red: string }
  | { screen: string; buffer?: string; black?: string; red?: string };

const FRAME_TTL = 15 * 60; // 15 minutes — cohérent avec rotation des œuvres

function frameKey(deviceId: string) { return `frame:${deviceId}`; }

// Stocke la frame pour un device (écrase la précédente)
export function storeFrame(
  screenId: string,
  payload: FramePayload,
  deviceId?: string
): void {
  const frame: StoredFrame = {
    screen:   screenId,
    payload,
    storedAt: Date.now(),
    deviceId,
    frameId:  Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  };

  if (deviceId) {
    // Frame ciblée : stockée par deviceId avec TTL 15min
    redis.set(frameKey(deviceId), JSON.stringify(frame), { ex: FRAME_TTL });
    console.log(`[queue] frame stockée device=${deviceId} screen=${screenId}`);
  }
}

// Récupère la frame d'un device (sans la supprimer — l'ack s'en charge)
export async function getFrameForDevice(
  deviceId: string,
  _screens: string[]
): Promise<StoredFrame | null> {
  const raw = await redis.get<string>(frameKey(deviceId));
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw as StoredFrame;
  } catch {
    return null;
  }
}

// Supprime la frame après ack de l'ESP
export async function clearFrameForDeviceAck(
  deviceId: string,
  _screens: string[],
  frameId: string
): Promise<boolean> {
  const raw = await redis.get<string>(frameKey(deviceId));
  if (!raw) return false;
  try {
    const frame: StoredFrame = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (frame.frameId !== frameId) return false;
    await redis.del(frameKey(deviceId));
    return true;
  } catch {
    return false;
  }
}

// Compat legacy — non utilisé en prod Redis mais garde la signature
export function getFrameForScreen(_screenId: string): StoredFrame | null { return null; }
export function clearFrame(_screenId: string): void {}
export function clearFrameForDevice(_deviceId: string, _screens: string[]): void {}
export function listFrames(): StoredFrame[] { return []; }