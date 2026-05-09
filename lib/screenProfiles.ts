export type ScreenId = "eink29bwr" | "oled096" | "eink27bw";

export interface ScreenProfile {
  id: ScreenId;
  name: string;
  width: number;
  height: number;
  colors: string[];
  colorLabels: string[];
  dithering: boolean;
  grayscale: boolean;
  description: string;
  pixelRatio: number; // canvas display scale
}

export const SCREEN_PROFILES: Record<ScreenId, ScreenProfile> = {
  eink29bwr: {
    id: "eink29bwr",
    name: "E-Ink 2.9\" BWR",
    width: 296,
    height: 128,
    colors: ["#000000", "#FFFFFF", "#CC0000"],
    colorLabels: ["Noir", "Blanc", "Rouge"],
    dithering: true,
    grayscale: false,
    description: "296×128px — Noir / Blanc / Rouge",
    pixelRatio: 2,
  },
  oled096: {
    id: "oled096",
    name: "OLED 0.96\"",
    width: 128,
    height: 64,
    colors: ["#000000", "#FFFFFF"],
    colorLabels: ["Noir", "Blanc"],
    dithering: false,
    grayscale: false,
    description: "128×64px — Noir / Blanc",
    pixelRatio: 4,
  },
  eink27bw: {
    id: "eink27bw",
    name: "E-Ink 2.7\" BW",
    width: 264,
    height: 176,
    colors: ["#000000", "#FFFFFF"],
    colorLabels: ["Noir", "Blanc"],
    dithering: false,
    grayscale: true,
    description: "264×176px — NOIR / Blanc",
    pixelRatio: 2,
  },
};

export const SCREEN_IDS = Object.keys(SCREEN_PROFILES) as ScreenId[];
