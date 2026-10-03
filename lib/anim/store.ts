// lib/anim/store.ts — galerie des ANIMATIONS faites à la main (banc d'essai du TFT 2.8" tactile).
//
//   anim:item:{id}   JSON   { id, title, author, createdAt, frames, bytes, loops, playMs, fg, bg, clip(base64 PBC1), deviceId? } — permanent
//   anim:recent      list   identifiants, le plus récent en tête, 200 au plus (les plus anciens sont supprimés)
// L'identifiant est l'empreinte du clip : la même animation envoyée deux fois n'est enregistrée qu'une fois.
// Seules les animations dessinées à la main y entrent (jamais les modèles de test : balle, vague, bruit…) — contrôlé par l'interface ET ici
// (≥ 2 images différentes, de l'encre).

import { createHash } from "node:crypto";
import { redis } from "@/lib/redis";
import { CLIP, clipPlayMs, encodeClip, type ClipInput } from "@/lib/bench/clip";

export const ANIM_KEEP = 200;
export const ANIM_ITEM_REGEX = /^[a-f0-9]{12}$/;

export interface AnimItem {
  id: string;
  title: string;
  author: string;
  createdAt: number;
  frames: number;
  bytes: number;
  loops: number;
  playMs: number;
  fg: number;
  bg: number;
  clip: string;            // PBC1 en base64 (≤ 12,3 k caractères)
  deviceId?: string;
}

export const animId = (bin: Uint8Array): string => createHash("sha256").update(bin).digest("hex").slice(0, 12);

export const cleanTitle = (t: unknown): string =>
  String(t ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Sans titre";

/** Refus d'une animation sans intérêt : une seule image, images toutes identiques, ou rien de dessiné. */
export function galleryRefusal(input: ClipInput): string | null {
  if (input.frames.length < 2) return "une animation a au moins 2 images";
  const first = input.frames[0];
  if (input.frames.every((f) => f.every((v, i) => v === first[i]))) return "toutes les images sont identiques";
  if (input.frames.every((f) => f.every((v) => v === 0))) return "rien n'est dessiné";
  return null;
}

/** Construit la fiche (sans toucher Redis) : testable. */
export function buildAnimItem(input: ClipInput, meta: { title?: unknown; author?: unknown; deviceId?: string; now?: number }): AnimItem {
  const bin = encodeClip(input);
  return {
    id: animId(bin),
    title: cleanTitle(meta.title),
    author: String(meta.author ?? "").trim().slice(0, 40) || "Anonyme",
    createdAt: meta.now ?? Date.now(),
    frames: input.frames.length,
    bytes: bin.length,
    loops: input.loops,
    playMs: clipPlayMs(input.delaysMs, input.loops),
    fg: input.fg,
    bg: input.bg,
    clip: Buffer.from(bin).toString("base64"),
    ...(meta.deviceId ? { deviceId: meta.deviceId } : {}),
  };
}

const parse = <T,>(raw: unknown): T | null => {
  if (!raw) return null;
  try { return (typeof raw === "string" ? JSON.parse(raw) : raw) as T; } catch { return null; }
};

/** Enregistre (une seule fois par empreinte). Retourne l'id et si l'animation existait déjà. */
export async function saveAnimation(item: AnimItem): Promise<{ id: string; duplicate: boolean }> {
  const created = await redis.set(`anim:item:${item.id}`, JSON.stringify(item), { nx: true });
  if (!created) return { id: item.id, duplicate: true };
  await redis.lpush("anim:recent", item.id);
  const evicted = (await redis.lrange("anim:recent", ANIM_KEEP, -1)) as string[];
  if (evicted.length) {
    await redis.ltrim("anim:recent", 0, ANIM_KEEP - 1);
    await redis.del(...evicted.map((id) => `anim:item:${id}`));
  }
  return { id: item.id, duplicate: false };
}

export async function listAnimations(limit: number, offset: number): Promise<{ items: AnimItem[]; total: number }> {
  const total = await redis.llen("anim:recent");
  const ids = (await redis.lrange("anim:recent", offset, offset + limit - 1)) as string[];
  if (ids.length === 0) return { items: [], total };
  const raws = await redis.mget(...ids.map((id) => `anim:item:${id}`));
  return { items: raws.map((r) => parse<AnimItem>(r)).filter((x): x is AnimItem => !!x), total };
}

export async function getAnimation(id: string): Promise<AnimItem | null> {
  return parse<AnimItem>(await redis.get(`anim:item:${id}`));
}

/** Pour le journal global de l'accueil : les dernières animations, sans les images. */
export async function recentAnimationEvents(n: number): Promise<{ id: string; title: string; author: string; createdAt: number; frames: number }[]> {
  const ids = (await redis.lrange("anim:recent", 0, n - 1)) as string[];
  if (ids.length === 0) return [];
  const raws = await redis.mget(...ids.map((id) => `anim:item:${id}`));
  return raws.map((r) => parse<AnimItem>(r)).filter((x): x is AnimItem => !!x).map((x) => ({ id: x.id, title: x.title, author: x.author, createdAt: x.createdAt, frames: x.frames }));
}

export const MAX_GALLERY_FRAMES = CLIP.MAX_FRAMES;
