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
  | { screen: "tft18";     buffer: string }
  | { screen: "eink29bwr"; black: string; red: string }
  | { screen: string; buffer?: string; black?: string; red?: string };

const FRAME_TTL = 15 * 60;

function frameKey(deviceId: string) { return `frame:${deviceId}`; }

// Upstash peut retourner un objet déjà parsé OU une string JSON — on gère les deux
function parseFrame(raw: unknown): StoredFrame | null {
  try {
    if (!raw) return null;
    if (typeof raw === "string") return JSON.parse(raw) as StoredFrame;
    if (typeof raw === "object") return raw as StoredFrame;
    return null;
  } catch {
    return null;
  }
}

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
    redis.set(frameKey(deviceId), JSON.stringify(frame), { ex: FRAME_TTL });
    console.log(`[queue] frame stockée device=${deviceId} screen=${screenId}`);
  }
}

export async function getFrameForDevice(
  deviceId: string,
  _screens: string[]
): Promise<StoredFrame | null> {
  const raw = await redis.get(frameKey(deviceId));
  return parseFrame(raw);
}

export async function clearFrameForDeviceAck(
  deviceId: string,
  _screens: string[],
  frameId: string
): Promise<boolean> {
  const raw = await redis.get(frameKey(deviceId));
  const frame = parseFrame(raw);
  if (!frame) return false;
  if (frame.frameId !== frameId) return false;
  await redis.del(frameKey(deviceId));
  return true;
}

// Compat legacy
export function getFrameForScreen(_screenId: string): StoredFrame | null { return null; }
export function clearFrame(_screenId: string): void {}
export function clearFrameForDevice(_deviceId: string, _screens: string[]): void {}
export function listFrames(): StoredFrame[] { return []; }