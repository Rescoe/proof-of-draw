// lib/bench/screens.ts — écrans qui savent jouer un clip du banc d'essai (PBC1, 128×64 1 bit) et firmware minimal requis.
//
//   tft28   TFT 2.8" tactile (UNO R4 WiFi)  — validé sur le matériel (03/10/2026) ; firmware r4tft28-2.1 ou plus
//   tft18   TFT 1.8" ST7735 (ESP8266)       — ⚠ intégré le 03/10/2026, NON TESTÉ sur le matériel ; firmware tft18-2.1 ou plus
//   oled096 OLED 0,96" SSD1306 (ESP8266)    — ⚠ intégré le 03/10/2026, NON TESTÉ sur le matériel ; firmware multiscreen-2.1 ou plus
//
// Un appareil multi-écrans (ex. e-ink 2.7" + OLED) joue le clip sur son OLED. Le serveur n'a besoin que de savoir QUEL écran joue.

export type BenchScreen = "tft28" | "tft18" | "oled096";

export interface BenchScreenInfo {
  id: BenchScreen;
  label: string;
  /** Rendu du clip 128×64 sur cet écran (texte affiché dans la page). */
  geometry: string;
  /** Préfixe de la version de firmware enregistrée par l'appareil, et version minimale (major.minor). */
  firmware: { prefix: string; min: [number, number] };
  /** true : validé sur le matériel. false : écrit et compilé, jamais essayé sur l'écran réel. */
  tested: boolean;
}

export const BENCH_SCREEN_INFO: Record<BenchScreen, BenchScreenInfo> = {
  tft28: { id: "tft28", label: 'TFT 2.8" tactile (UNO R4 WiFi)', geometry: "agrandie ×1,875 au centre du 240×320", firmware: { prefix: "r4tft28", min: [2, 1] }, tested: true },
  tft18: { id: "tft18", label: 'TFT 1.8" (ESP8266)', geometry: "affichée 1:1 (128×64) au centre du 128×160", firmware: { prefix: "tft18", min: [2, 1] }, tested: false },
  oled096: { id: "oled096", label: 'OLED 0,96" (ESP8266)', geometry: "affichée 1:1 sur l'OLED 128×64", firmware: { prefix: "multiscreen", min: [2, 1] }, tested: false },
};

/** Ordre de préférence quand un appareil a plusieurs écrans compatibles. */
export const BENCH_SCREENS: BenchScreen[] = ["tft28", "tft18", "oled096"];

/** L'écran du banc d'essai d'un appareil, ou null s'il n'en a aucun de compatible. */
export function benchScreenOf(screens: readonly string[] | undefined | null): BenchScreen | null {
  if (!screens) return null;
  for (const s of BENCH_SCREENS) if (screens.includes(s)) return s;
  return null;
}

/** true : firmware assez récent · false : trop ancien (ignore le mode) · null : version inconnue. */
export function benchFirmwareOk(screen: BenchScreen, fw: string | null | undefined): boolean | null {
  if (!fw) return null;
  const { prefix, min } = BENCH_SCREEN_INFO[screen].firmware;
  const m = new RegExp(`^${prefix}-(\\d+)\\.(\\d+)`).exec(fw);
  if (!m) return false;
  const major = Number(m[1]), minor = Number(m[2]);
  return major > min[0] || (major === min[0] && minor >= min[1]);
}
