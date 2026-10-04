// lib/anim/deliver.ts — fait JOUER une animation validée sur les écrans du réseau qui savent lire un clip.
//
// Aucun changement de firmware : on réutilise le canal du banc d'essai (lib/bench/store.ts). Quand un bloc d'animation est miné :
//   • tous les écrans de la pool reçoivent l'AFFICHE (image fixe) par le chemin normal (broadcast / pull-frame) — repli universel ;
//   • les écrans à firmware compatible reçoivent EN PLUS le clip (bench:clip / bench:ptr) et un « mode rapide » de durée limitée :
//     /api/pull leur annonce benchMode, ils interrogent /api/bench/poll, téléchargent le clip et le jouent (en boucle si loops = 0).
//
// Les écrans à lecteur sur microSD (lib/anim/pointer.ts, r4tft28-2.4+) NE passent PAS par ici : ils reçoivent un pointeur dans /api/pull et jouent en
// boucle sans plus rien demander. Ce canal ne sert plus qu'aux firmwares ESP8266 (TFT 1.8", OLED) et aux anciennes versions du R4.
//
// COÛT REDIS (règle primordiale du dépôt) : par bloc d'animation, 2 lectures groupées (membres de la pool, bannis) + 1 MGET (appareils)
// + 3 écritures par écran récepteur. Côté écran : 1 commande par contrôle rapide (≈ toutes les 3 s) pendant la durée du mode, plafonnée par
// ANIM_PLAY_MAX_SEC (10 min par défaut) → ≈ 200 commandes par écran et par animation. Extinction automatique (TTL).
// LIMITE ASSUMÉE : le mode s'éteint au bout de ANIM_PLAY_MAX_SEC, l'écran revient alors à l'affiche. Une lecture pendant TOUT le temps
// d'affichage du bloc demandera un pointeur d'animation dans /api/pull côté firmware (non fait : firmwares non modifiés).

import { redis } from "@/lib/redis";
import { benchFirmwareOk, benchScreenOf, BENCH_SCREENS } from "@/lib/bench/screens";
import { CLIP_TTL_SEC, storeClip, setBenchMode, type ClipPointer } from "@/lib/bench/store";
import type { AnimCandidatePart } from "@/lib/anim/block";
import { supportsAnimPointer } from "@/lib/anim/pointer";

export const ANIM_PLAY_MAX_SEC = parseInt(process.env.ANIM_PLAY_MAX_SEC ?? "600");

interface DeviceLite { deviceId?: string; screens?: string[]; firmware?: string }
const parse = (raw: unknown): DeviceLite | null => {
  if (!raw) return null;
  try { return (typeof raw === "string" ? JSON.parse(raw) : raw) as DeviceLite; } catch { return null; }
};

/** Un écran de la pool peut-il jouer ce clip ? (écran du banc d'essai + firmware assez récent ou inconnu) */
export function canPlay(device: DeviceLite | null, poolScreen: string): boolean {
  if (!device || !device.screens?.includes(poolScreen)) return false;
  // Firmware à lecteur sur carte SD (pointeur `anim` dans /api/pull) : il télécharge le clip lui-même, sans mode rapide ni poll → rien à poser ici.
  if (supportsAnimPointer(device.screens, device.firmware)) return false;
  if (!(BENCH_SCREENS as string[]).includes(poolScreen) || benchScreenOf([poolScreen]) !== poolScreen) return false;
  return benchFirmwareOk(poolScreen as (typeof BENCH_SCREENS)[number], device.firmware) !== false;
}

/** Pose le clip et le mode rapide sur les écrans récepteurs. Retourne le nombre d'écrans servis. Ne lève jamais : l'affiche suffit. */
export async function deliverAnimation(poolScreen: string, bin: Uint8Array, part: AnimCandidatePart, displayTimeSec: number): Promise<number> {
  try {
    const members = (await redis.smembers(`pool:screen:${poolScreen}`)) as string[];
    if (!members || members.length === 0) return 0;
    const [bans, devs] = await Promise.all([
      redis.mget<(string | null)[]>(...members.map((id) => `bl:dev:${id}`)),
      redis.mget<unknown[]>(...members.map((id) => `device:${id}`)),
    ]);
    const targets = members.filter((id, i) => !bans[i] && canPlay(parse(devs[i]), poolScreen));
    if (targets.length === 0) return 0;
    const ttl = Math.max(60, Math.min(displayTimeSec, ANIM_PLAY_MAX_SEC, CLIP_TTL_SEC));
    const ptr: ClipPointer = { clipId: part.root.slice(0, 8), bytes: part.bytes, frames: part.frames, loops: part.loops, playMs: part.playMs, createdAt: Date.now() };
    await Promise.all(targets.map(async (id) => { await storeClip(id, bin, ptr); await setBenchMode(id, true, ttl); }));
    return targets.length;
  } catch (e) {
    console.error("[anim] livraison du clip impossible (l'affiche reste diffusée):", e);
    return 0;
  }
}
