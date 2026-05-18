// lib/drawQueue.ts
// File d'attente persistante pour les dessins (Redis list : draw:queue).
// FIFO : LPUSH pour enqueuer, RPOP pour déqueuer.
//
// Chaque entrée est le corps brut du dessin (deviceId, screen, buffers,
// actions, drawScore, workTitle, drawArtistName, importWarning).
// La frame est traitée par submit-candidate dès que le candidat courant est validé.

import { redis } from "@/lib/redis";

export const DRAW_QUEUE_KEY = "draw:queue";
export const DRAW_QUEUE_MAX = 50;

export async function getQueueLength(): Promise<number> {
  return (await redis.llen(DRAW_QUEUE_KEY)) as number;
}

export async function enqueueDraw(entry: Record<string, unknown>): Promise<number> {
  await redis.lpush(DRAW_QUEUE_KEY, JSON.stringify(entry));
  const len = (await redis.llen(DRAW_QUEUE_KEY)) as number;
  return len;
}

export async function dequeueNextDraw(): Promise<Record<string, unknown> | null> {
  const raw = await redis.rpop<string>(DRAW_QUEUE_KEY);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Retourne la liste des entrées sans les dépiler (peek), max n items. */
export async function peekQueue(n = 5): Promise<Record<string, unknown>[]> {
  const raw = await redis.lrange<string>(DRAW_QUEUE_KEY, 0, n - 1);
  return (raw ?? []).map((item) => {
    try { return typeof item === "string" ? JSON.parse(item) : item; } catch { return null; }
  }).filter(Boolean) as Record<string, unknown>[];
}
