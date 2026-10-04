// lib/anim/targets.ts — à QUI diffuser une animation validée (pur, sans Redis).
//
// Le clip PBC1 (128×64, 1 bit) est le même pour tous les écrans « dynamiques » (tft28, tft18, oled096) : chacun le joue à sa géométrie. Une animation
// validée est donc diffusée AUTOMATIQUEMENT à tous les écrans dynamiques du réseau — quel que soit l'écran pour lequel elle a été faite, sans opt-in de
// conversion — à une seule condition : le firmware déclaré de l'appareil la joue réellement (animCapable). Jamais d'e-ink, jamais de firmware ancien ou inconnu.

import { BENCH_SCREENS } from "@/lib/bench/screens";
import { animCapable } from "@/lib/anim/pointer";

export interface TargetDevice { screens?: string[]; firmware?: string | null }
export interface AnimTarget { deviceId: string; screen: string }

/** Les écrans qui peuvent jouer un clip. */
export const ANIM_SCREENS: readonly string[] = BENCH_SCREENS;
export const isAnimScreen = (s: string): boolean => ANIM_SCREENS.includes(s);

/**
 * pools : screen → deviceIds membres de `pool:screen:{screen}` ; banned / device : accès aux données déjà lues (1 MGET chacun).
 * Retourne une cible par (appareil, écran) capable. Un appareil multi-écrans n'est cible que pour l'écran qui anime (l'OLED, pas son e-ink).
 */
export function animTargets(
  pools: Record<string, string[]>,
  banned: (deviceId: string) => boolean,
  device: (deviceId: string) => TargetDevice | null,
): AnimTarget[] {
  const out: AnimTarget[] = [];
  const seen = new Set<string>();
  for (const screen of ANIM_SCREENS) {
    for (const deviceId of pools[screen] ?? []) {
      const key = `${deviceId}|${screen}`;
      if (seen.has(key) || banned(deviceId)) continue;
      seen.add(key);
      if (animCapable(device(deviceId), screen)) out.push({ deviceId, screen });
    }
  }
  return out;
}
