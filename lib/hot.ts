// lib/hot.ts — drapeau « réseau chaud » (mode actif des écrans, voir lib/pullBudget.ts). 1 SET avec TTL ; ne lève jamais.
import { redis } from "@/lib/redis";
import { HOT_KEY, HOT_TTL_SEC } from "@/lib/pullBudget";

export async function markHot(): Promise<void> {
  try { await redis.set(HOT_KEY, "1", { ex: HOT_TTL_SEC }); } catch { /* le drapeau est une optimisation : jamais d'échec visible */ }
}
