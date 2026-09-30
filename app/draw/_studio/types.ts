// app/draw/_studio/types.ts — types partagés de l'interface de dessin (Pod Studio)

export type ToolId = "brush" | "eraser" | "fill" | "shape" | "eyedropper" | "select" | "text";
export type Toolbox = "essential" | "studio" | "pro";
export type ShapeKind = "line" | "rect" | "ellipse" | "poly";
export type SelectKind = "rect" | "wand" | "lasso";
export type PanelId = null | "color" | "brush" | "texture" | "sym" | "model" | "score" | "menu" | "help";

/** Réglages d'outils courants — lus par le stage à chaque geste (via ref). */
export interface ToolSettings {
  brush: string;
  size: number;
  eraserSize: number;
  color: string;
  color2: string;
  texture: string;
  opacity: number;          // 1..100, écrans RGB565
  shape: ShapeKind;
  shapeFill: boolean;
  shapeSize: number;
  fromCenter: boolean;
  constrain: boolean;
  fillGlobal: boolean;
  fillGradient: boolean;
  selectKind: SelectKind;
  selectGlobal: boolean;
  textScale: number;
  sym: string;              // "", "v", "h", "vh", "r3"…
  symCx: number;
  symCy: number;
  pixelPerfect: boolean;
  stabilizer: number;       // 0..6
  precision: boolean;       // curseur déporté + loupe (tactile)
}

export interface GridSettings { show: boolean; step: number }

export interface ModelImage {
  url: string;              // object URL
  x: number; y: number;     // position (px canvas)
  w: number; h: number;     // taille affichée (px canvas)
  opacity: number;          // 0.1..0.9
  gray: boolean;
  visible: boolean;
}

export interface ToolboxInfo {
  id: Toolbox;
  label: string;
  tagline: string;
}

export const TOOLBOXES: ToolboxInfo[] = [
  { id: "essential", label: "Essentiel", tagline: "Pinceau, gomme, pot de peinture et formes. Tout de suite prêt." },
  { id: "studio",    label: "Studio",    tagline: "+ pipette, sélection, texte, textures, symétrie et grille." },
  { id: "pro",       label: "Pro",       tagline: "+ dégradés, polygones, lasso, brosses perso, stabilisateur…" },
];

export const TOOLS_BY_BOX: Record<Toolbox, ToolId[]> = {
  essential: ["brush", "eraser", "fill", "shape"],
  studio:    ["brush", "eraser", "fill", "shape", "eyedropper", "select", "text"],
  pro:       ["brush", "eraser", "fill", "shape", "eyedropper", "select", "text"],
};

export const TOOL_LABEL: Record<ToolId, string> = {
  brush: "Pinceau", eraser: "Gomme", fill: "Remplir", shape: "Formes",
  eyedropper: "Pipette", select: "Sélection", text: "Texte",
};

export const TOOL_KEY: Record<ToolId, string> = {
  brush: "B", eraser: "E", fill: "G", shape: "U", eyedropper: "I", select: "M", text: "T",
};

export const DEFAULT_SETTINGS: ToolSettings = {
  brush: "round", size: 3, eraserSize: 6,
  color: "#000000", color2: "#FFFFFF",
  texture: "solid", opacity: 100,
  shape: "line", shapeFill: false, shapeSize: 1, fromCenter: false, constrain: false,
  fillGlobal: false, fillGradient: false,
  selectKind: "rect", selectGlobal: false,
  textScale: 1,
  sym: "", symCx: 0, symCy: 0,
  pixelPerfect: false, stabilizer: 0, precision: false,
};

// ─── Envoi ───────────────────────────────────────────────────────────────────

import type { ScreenPayload } from "@/lib/canvasToScreen";
import type { ActionEvent, ReplayEvent } from "@/lib/types/actions";

export interface StudioSendInput {
  workTitle: string;
  drawArtistName?: string;
  payload: ScreenPayload;
  actions: ActionEvent[];
  replayEvents: ReplayEvent[];
  drawScore: number;
}

/** Résultat d'un envoi, déjà interprété : l'interface n'a pas à connaître les codes HTTP. */
export type StudioSendResult =
  | { status: "ok"; nextDrawIn: number; validation?: string; queuePosition?: number; poolSize?: number; warning?: string | null; message?: string }
  | { status: "cooldown"; nextDrawIn: number }
  | { status: "rejected"; message: string }
  | { status: "queue_full"; message: string }
  | { status: "error"; message: string };
