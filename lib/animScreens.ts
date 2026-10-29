// lib/animScreens.ts — écrans d'un appareil sur lesquels une ANIMATION peut être jouée (UX jalon 3, 29/10/2026) : liste calculée côté SERVEUR avec la même règle que la diffusion réelle
// (`animCapable` : écran dynamique + firmware déclaré ≥ seuil de `ANIM_POINTER_FIRMWARE`). La page /draw n'a aucune table de versions : elle affiche « Animer » seulement pour ces écrans,
// et l'atelier /animer + POST /api/draw { anim } revalident (l'interface n'est jamais une autorisation). Pur, sans Redis.
import { animCapable } from "./anim/pointer";

export function animScreensOf(device: { screens?: readonly string[] | null; firmware?: string | null } | null | undefined): string[] {
  if (!device?.screens) return [];
  const view = { screens: device.screens, firmware: device.firmware ?? null };
  const out: string[] = [];
  for (const s of device.screens) if (typeof s === "string" && !out.includes(s) && animCapable(view, s)) out.push(s);
  return out;
}
