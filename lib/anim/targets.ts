// lib/anim/targets.ts — à QUI diffuser une animation validée (pur, sans Redis).
//
// Le clip PBC1 (128×64, 1 bit) est le même pour tous les écrans « dynamiques » (tft28, tft18, oled096) : chacun le joue à sa géométrie. Une animation
// validée est donc diffusée AUTOMATIQUEMENT à tous les écrans dynamiques du réseau — quel que soit l'écran pour lequel elle a été faite, sans opt-in de
// conversion — à une seule condition : le firmware déclaré de l'appareil la joue réellement (animCapable). Jamais d'e-ink, jamais de firmware ancien ou inconnu.

import { BENCH_SCREENS } from "@/lib/bench/screens";
import { animCapable, animOledAuxCapable } from "@/lib/anim/pointer";

import { acceptsAnimationFrom } from "@/lib/fixedWorks";

export interface TargetDevice { screens?: string[]; firmware?: string | null; caps?: string[]; acceptsConvertedScreens?: string[] }
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
  origin?: string | null,   // écran pour lequel l'animation a été faite : un autre type d'écran la reçoit seulement s'il accepte les conversions (lib/fixedWorks.ts)
): AnimTarget[] {
  const out: AnimTarget[] = [];
  const seen = new Set<string>();
  for (const screen of ANIM_SCREENS) {
    for (const deviceId of pools[screen] ?? []) {
      const key = `${deviceId}|${screen}`;
      if (seen.has(key) || banned(deviceId)) continue;
      seen.add(key);
      const dev = device(deviceId);
      if (animCapable(dev, screen) && acceptsAnimationFrom(dev, screen, origin)) out.push({ deviceId, screen });
    }
  }
  return out;
}

/**
 * Cartes e-ink BWR 2,9″ à OLED AUXILIAIRE (29/10/2026) : membres de `pool:screen:eink29bwr` qui déclarent « anim-oled » avec un firmware qui sait lire le clip. Elles reçoivent l'affiche BWR + le pointeur
 * (leur frame `eink29bwr`, un seul ACK) ; l'OLED joue le clip. Aucun e-ink sans OLED déclaré n'en fait partie.
 */
export function animOledAuxTargets(
  ids: readonly string[],
  banned: (deviceId: string) => boolean,
  device: (deviceId: string) => TargetDevice | null,
): AnimTarget[] {
  const out: AnimTarget[] = [];
  const seen = new Set<string>();
  for (const deviceId of ids) {
    if (seen.has(deviceId) || banned(deviceId)) continue;
    seen.add(deviceId);
    if (animOledAuxCapable(device(deviceId))) out.push({ deviceId, screen: "eink29bwr" });
  }
  return out;
}
