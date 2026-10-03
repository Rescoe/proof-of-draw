// lib/bench/store.ts — état Redis du banc d'essai d'animation (TFT 2.8" tactile). Clés petites, TTL courts, coût minimal.
//
//   bench:mode:{deviceId}            "1"        mode « poll rapide » demandé par le propriétaire (30 min, s'éteint seul)
//   bench:ptr:{deviceId}             JSON       pointeur du clip en attente (id, taille, images, boucles, durée)
//   bench:clip:{deviceId}:{clipId}   base64     le clip binaire PBC1 (≤ 9 Ko → ≤ 12,3 k caractères)
//   bench:seen:{deviceId}            ms         dernier poll de l'appareil (pour dire « connecté » dans l'interface)
//   bench:results:{deviceId}         liste JSON mesures renvoyées par l'appareil (10 dernières, 24 h)

import { redis } from "@/lib/redis";

export const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
export const CLIP_ID_REGEX = /^[a-f0-9]{8,16}$/;
export const MODE_TTL_SEC = 30 * 60;
export const CLIP_TTL_SEC = 60 * 60;
export const RESULT_TTL_SEC = 24 * 3600;
export const RESULTS_KEPT = 10;

export const benchKeys = {
  mode: (id: string) => `bench:mode:${id}`,
  ptr: (id: string) => `bench:ptr:${id}`,
  clip: (id: string, clipId: string) => `bench:clip:${id}:${clipId}`,
  seen: (id: string) => `bench:seen:${id}`,
  results: (id: string) => `bench:results:${id}`,
  log: (id: string) => `bench:log:${id}`,
  lock: (kind: string, id: string) => `bench:lock:${kind}:${id}`,
};

export interface ClipPointer {
  clipId: string;
  bytes: number;
  frames: number;
  loops: number;
  playMs: number;
  createdAt: number;
}

export interface BenchLogLine { t: number; text: string }

/** Journal du banc d'essai (30 lignes, 24 h) : envoi, présence de l'écran, téléchargement, lecture… affiché dans la page /bench. */
export async function benchLog(deviceId: string, text: string): Promise<void> {
  try {
    const key = benchKeys.log(deviceId);
    await redis.lpush(key, JSON.stringify({ t: Date.now(), text: text.slice(0, 160) } satisfies BenchLogLine));
    await Promise.all([redis.ltrim(key, 0, 29), redis.expire(key, RESULT_TTL_SEC)]);
  } catch { /* le journal ne doit jamais casser une route */ }
}

export interface BenchResult {
  clipId: string;
  at: number;
  frames: number;          // images réellement affichées
  expectedMs: number;      // durée prévue (somme des délais)
  elapsedMs: number;       // durée mesurée
  avgWorkUs: number;       // temps moyen pour appliquer + peindre une image
  maxWorkUs: number;
  overruns: number;        // images arrivées en retard sur l'horloge prévue
  maxLateMs: number;
  downloadMs: number;
  bytes: number;
  heapFree: number;
  stopped: boolean;        // interrompu par un toucher
  error?: string;
}

const parse = <T,>(raw: unknown): T | null => {
  if (!raw) return null;
  try { return (typeof raw === "string" ? JSON.parse(raw) : raw) as T; } catch { return null; }
};

/** Verrou anti-rafale : true si l'appel est autorisé (SET NX EX). */
export async function benchLock(kind: string, deviceId: string, sec: number): Promise<boolean> {
  return !!(await redis.set(benchKeys.lock(kind, deviceId), "1", { nx: true, ex: sec }));
}

export async function setBenchMode(deviceId: string, on: boolean): Promise<void> {
  if (on) await redis.set(benchKeys.mode(deviceId), "1", { ex: MODE_TTL_SEC });
  else await redis.del(benchKeys.mode(deviceId));
}

/** 1 MGET (mode + pointeur) + 1 SET (présence) : le coût d'un poll. */
export async function benchPoll(deviceId: string): Promise<{ mode: boolean; clip: ClipPointer | null }> {
  const [mode, ptr, seen] = await redis.mget<(string | ClipPointer | null)[]>(benchKeys.mode(deviceId), benchKeys.ptr(deviceId), benchKeys.seen(deviceId));
  await redis.set(benchKeys.seen(deviceId), String(Date.now()), { ex: 120 });
  if ((seen === null || seen === undefined) && mode !== null && mode !== undefined) await benchLog(deviceId, "écran connecté : premier contrôle rapide reçu");
  return { mode: mode !== null && mode !== undefined, clip: parse<ClipPointer>(ptr) };
}

export async function storeClip(deviceId: string, bin: Uint8Array, ptr: ClipPointer): Promise<void> {
  await Promise.all([
    redis.set(benchKeys.clip(deviceId, ptr.clipId), Buffer.from(bin).toString("base64"), { ex: CLIP_TTL_SEC }),
    redis.set(benchKeys.ptr(deviceId), JSON.stringify(ptr), { ex: CLIP_TTL_SEC }),
  ]);
}

export async function loadClip(deviceId: string, clipId: string): Promise<Buffer | null> {
  const raw = await redis.get<string>(benchKeys.clip(deviceId, clipId));
  return raw ? Buffer.from(String(raw), "base64") : null;
}

export async function pushResult(deviceId: string, r: BenchResult): Promise<void> {
  const key = benchKeys.results(deviceId);
  await redis.lpush(key, JSON.stringify(r));
  await Promise.all([redis.ltrim(key, 0, RESULTS_KEPT - 1), redis.expire(key, RESULT_TTL_SEC)]);
}

export async function benchStatus(deviceId: string): Promise<{ mode: boolean; clip: ClipPointer | null; seenAgoMs: number | null; results: BenchResult[]; log: BenchLogLine[] }> {
  const [mode, ptr, seen, results, log] = await Promise.all([
    redis.get(benchKeys.mode(deviceId)),
    redis.get(benchKeys.ptr(deviceId)),
    redis.get(benchKeys.seen(deviceId)),
    redis.lrange(benchKeys.results(deviceId), 0, RESULTS_KEPT - 1),
    redis.lrange(benchKeys.log(deviceId), 0, 29),
  ]);
  const seenAt = seen ? Number(seen) : NaN;
  return {
    mode: mode !== null && mode !== undefined,
    clip: parse<ClipPointer>(ptr),
    seenAgoMs: Number.isFinite(seenAt) ? Math.max(0, Date.now() - seenAt) : null,
    results: (results as unknown[]).map((x) => parse<BenchResult>(x)).filter((x): x is BenchResult => !!x),
    log: (log as unknown[]).map((x) => parse<BenchLogLine>(x)).filter((x): x is BenchLogLine => !!x),
  };
}

const clamp = (v: unknown, lo: number, hi: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo;
};

/** Mesures renvoyées par l'appareil : jamais de confiance aveugle (bornes, types). */
export function sanitizeResult(b: Record<string, unknown>): BenchResult | null {
  const clipId = String(b.clipId ?? "");
  if (!CLIP_ID_REGEX.test(clipId)) return null;
  return {
    clipId, at: Date.now(),
    frames: clamp(b.frames, 0, 100_000), expectedMs: clamp(b.expectedMs, 0, 3_600_000), elapsedMs: clamp(b.elapsedMs, 0, 3_600_000),
    avgWorkUs: clamp(b.avgWorkUs, 0, 60_000_000), maxWorkUs: clamp(b.maxWorkUs, 0, 60_000_000), overruns: clamp(b.overruns, 0, 100_000),
    maxLateMs: clamp(b.maxLateMs, 0, 3_600_000), downloadMs: clamp(b.downloadMs, 0, 3_600_000), bytes: clamp(b.bytes, 0, 70_000),
    heapFree: clamp(b.heapFree, 0, 40_000), stopped: b.stopped === true,
    ...(typeof b.error === "string" ? { error: b.error.slice(0, 80) } : {}),
  };
}
