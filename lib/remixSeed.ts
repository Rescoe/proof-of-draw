// lib/remixSeed.ts — image d'un bloc (ou d'un rejet) → octets RGBA du CANVAS de l'éditeur, pour un Remix / une reprise. Pur, testé (aller-retour exact pour chaque écran).
//
// Piège : `screenPayloadToCanvas` produit l'IMAGE VUE SUR L'ÉCRAN (OLED : pixel allumé = blanc sur fond noir), alors que le canvas de l'éditeur suit la convention de l'ENCODEUR
// (OLED : trait sombre opaque = allumé, fond blanc). Pour l'OLED il faut donc inverser ; sans cela une œuvre chargée puis envoyée sans retouche serait l'inverse de l'originale.
import { screenPayloadToCanvas, type ScreenPayload } from "./screenToCanvas";
import { SCREEN_PROFILES, isValidScreenId, type ScreenId } from "./screenProfiles";

export type SeedPayload = { screen?: string; buffer?: string; black?: string; red?: string };

/** Valide la forme d'un payload d'image et le typage ScreenPayload ; null si inutilisable ou si l'écran ne correspond pas à `expected`. */
export function toScreenPayload(p: unknown, expected: ScreenId): ScreenPayload | null {
  if (!p || typeof p !== "object") return null;
  const o = p as SeedPayload;
  const screen = typeof o.screen === "string" ? o.screen : expected;   // anciennes archives : l'écran peut manquer au payload
  if (!isValidScreenId(screen) || screen !== expected) return null;
  if (expected === "eink29bwr") return typeof o.black === "string" && typeof o.red === "string" ? { screen: "eink29bwr", black: o.black, red: o.red } : null;
  return typeof o.buffer === "string" ? ({ screen: expected, buffer: o.buffer } as ScreenPayload) : null;
}

/** Octets RGBA (largeur × hauteur du profil) prêts pour `DrawSession.seedFromRGBA`. Lève si le buffer est mal formé. */
export function payloadToStudioRGBA(payload: ScreenPayload): Uint8ClampedArray {
  const img = screenPayloadToCanvas(payload);
  const p = SCREEN_PROFILES[payload.screen];
  if (img.width !== p.width || img.height !== p.height) throw new Error(`dimensions inattendues : ${img.width}×${img.height}`);
  const d = new Uint8ClampedArray(img.data);
  if (payload.screen === "oled096") {
    for (let i = 0; i < d.length; i += 4) {
      const lit = d[i] > 127;               // allumé à l'écran = trait sombre dans l'éditeur
      d[i] = d[i + 1] = d[i + 2] = lit ? 0 : 255; d[i + 3] = 255;
    }
  }
  return d;
}
