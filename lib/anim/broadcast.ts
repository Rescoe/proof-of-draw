// lib/anim/broadcast.ts — diffusion d'une animation VALIDÉE à tous les écrans dynamiques capables du réseau.
//
// Chaque cible reçoit, dans SA frame (frame:{deviceId}:{écran}), l'affiche (image fixe) rendue à la géométrie de son écran + le pointeur `anim`
// vers le clip du bloc : l'écran affiche l'affiche, rapatrie le clip (/api/block-clip) et le joue en boucle. Voir lib/anim/targets.ts pour QUI.
//
// COÛT REDIS par bloc d'animation : 3 SMEMBERS (pools tft28 / tft18 / oled096) + 2 MGET (bannis, appareils) + 1 SET par écran cible. Rien d'autre.

import { redis } from "@/lib/redis";
import { frameKey } from "@/lib/queue";
import { decodeClip } from "@/lib/bench/clip";
import { posterFor, type AnimCandidatePart, type AnimScreen } from "@/lib/anim/block";
import { animTargets, ANIM_SCREENS, type TargetDevice } from "@/lib/anim/targets";
import type { AnimPointer } from "@/lib/anim/pointer";

const parse = (raw: unknown): TargetDevice | null => {
  if (!raw) return null;
  try { return (typeof raw === "string" ? JSON.parse(raw) : raw) as TargetDevice; } catch { return null; }
};

export async function broadcastAnimation(opts: {
  part: AnimCandidatePart; blockHash: string; blockIndex: number; artistName: string; frameId: string; displayTime: number;
}): Promise<number> {
  const { part, blockHash, blockIndex, artistName, frameId, displayTime } = opts;
  const ttl = Math.max(900, Math.min(displayTime, 7200));
  const pointer: AnimPointer = { hash: blockHash, bytes: part.bytes, frames: part.frames };
  const _block = { index: blockIndex, artistName, displayTime, frameId, minedAt: Date.now(), hash: blockHash };

  const pools: Record<string, string[]> = {};
  const lists = await Promise.all(ANIM_SCREENS.map((s) => redis.smembers(`pool:screen:${s}`) as Promise<string[]>));
  ANIM_SCREENS.forEach((s, i) => { pools[s] = lists[i] ?? []; });
  const ids = [...new Set(Object.values(pools).flat())];
  if (ids.length === 0) return 0;

  const [bans, devs] = await Promise.all([
    redis.mget<(string | null)[]>(...ids.map((id) => `bl:dev:${id}`)),
    redis.mget<unknown[]>(...ids.map((id) => `device:${id}`)),
  ]);
  const banned = new Set(ids.filter((_, i) => bans[i]));
  const byId = new Map(ids.map((id, i) => [id, parse(devs[i])] as const));
  const targets = animTargets(pools, (id) => banned.has(id), (id) => byId.get(id) ?? null);
  console.log(`[anim] diffusion bloc #${blockIndex} : ${targets.length} écran(s) capable(s) sur ${ids.length} dans les pools dynamiques`);
  if (targets.length === 0) return 0;

  // Une affiche par type d'écran (rendue depuis l'image choisie du clip), calculée une seule fois
  const clip = decodeClip(new Uint8Array(Buffer.from(part.clip, "base64")));
  const frame = clip.frames[part.posterIndex] ?? clip.frames[0];
  const posters: Record<string, string> = {};
  for (const s of new Set(targets.map((t) => t.screen))) posters[s] = posterFor(frame, s as AnimScreen, clip.fg, clip.bg);

  await Promise.all(targets.map((t) => redis.set(
    frameKey(t.deviceId, t.screen),
    JSON.stringify({ payload: { screen: t.screen, buffer: posters[t.screen], _block, anim: pointer }, frameId, createdAt: Date.now(), sourceDeviceId: "consensus" }),
    { ex: ttl },
  )));
  return targets.length;
}
