// app/animer/model.ts — types, modes, outils et brouillon de l'atelier d'animation (pas de React ici : tout est testable).
import { CLIP } from "@/lib/bench/clip";
import { blank, line, type Frame, W, H } from "@/lib/bench/draw";
import type { BrushKind } from "@/lib/anim/brushes";

// ── Modes (même principe que Pod Studio : Essentiel / Studio / Pro) ─────────────────────────────────────
export type Mode = "essential" | "studio" | "pro";
export const MODES: { id: Mode; label: string; tagline: string }[] = [
  { id: "essential", label: "Essentiel", tagline: "Dessiner, ajouter des images, jouer. Tout de suite prêt." },
  { id: "studio",    label: "Studio",    tagline: "+ formes, toutes les brosses, fantômes avant/après, retournements, aller-retour." },
  { id: "pro",       label: "Pro",       tagline: "+ délai par image, budget d'octets, génération de mouvement, texte défilant, export." },
];
export const isMode = (v: unknown): v is Mode => v === "essential" || v === "studio" || v === "pro";

// ── Outils ──────────────────────────────────────────────────────────────────────────────────────────────
export type Tool = "pencil" | "eraser" | "line" | "rect" | "ellipse" | "fill";
export const TOOL_LABEL: Record<Tool, string> = { pencil: "Brosse", eraser: "Gomme", line: "Ligne", rect: "Rectangle", ellipse: "Ellipse", fill: "Remplir" };
export const TOOL_KEY: Record<Tool, string> = { pencil: "P", eraser: "E", line: "L", rect: "R", ellipse: "O", fill: "G" };
export const TOOLS_BY_MODE: Record<Mode, Tool[]> = {
  essential: ["pencil", "eraser", "fill"],
  studio: ["pencil", "eraser", "fill", "line", "rect", "ellipse"],
  pro: ["pencil", "eraser", "fill", "line", "rect", "ellipse"],
};
export const BRUSHES_BY_MODE: Record<Mode, BrushKind[]> = {
  essential: ["round", "square", "spray"],
  studio: ["round", "square", "spray", "texture", "dotted", "nib", "hatch"],
  pro: ["round", "square", "spray", "texture", "dotted", "nib", "hatch"],
};
/** Si le mode change, l'outil / la brosse courants restent valides. */
export const validTool = (tool: Tool, mode: Mode): Tool => (TOOLS_BY_MODE[mode].includes(tool) ? tool : "pencil");
export const validBrush = (kind: BrushKind, mode: Mode): BrushKind => (BRUSHES_BY_MODE[mode].includes(kind) ? kind : "round");

// ── Couleurs (le clip porte une couleur de tracé et une couleur de fond, en RVB565 côté appareil) ───────
export const FG_SWATCHES = ["#00ff88", "#ffffff", "#ff6b9d", "#fbbf24", "#60a5fa", "#a78bfa", "#f87171", "#2dd4bf"];
export const BG_SWATCHES = ["#000000", "#0a1030", "#1a0a2a", "#10260f", "#2a1208", "#ffffff"];

// ── Brouillon local (même clé et même format qu'avant : les brouillons existants se rouvrent) ───────────
export const DRAFT_KEY = "pod-anim-studio-draft-v1";
export interface Draft {
  frames: string[]; delays: number[]; loops: number; fg: string; bg: string; handmade?: boolean; title?: string; v?: number;
  /** Ajouts du 06/10/2026 (facultatifs : un ancien brouillon n'en a pas). */
  mode?: Mode; brush?: BrushKind; brushSize?: number;
}
export const toB64 = (u: Uint8Array): string => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!Array.isArray(d.frames) || d.frames.some((f) => typeof f !== "string")) return null;
    return d.v === 2 ? d : { ...d, loops: 0 };   // brouillons d'avant le 03/10 : leur « 3 boucles » n'était pas un choix
  } catch { return null; }
}
export function saveDraft(d: Draft): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* stockage indisponible : l'atelier fonctionne sans brouillon */ }
}

// ── Vitesse : un seul réglage pour tout (Essentiel) ─────────────────────────────────────────────────────
export const fpsToDelay = (fps: number): number => Math.max(CLIP.MIN_DELAY_MS, Math.min(CLIP.MAX_DELAY_MS, Math.round(1000 / Math.max(1, fps))));
export const delayToFps = (ms: number): number => Math.max(1, Math.min(25, Math.round(1000 / Math.max(CLIP.MIN_DELAY_MS, ms))));

// ── Modèles de départ (jamais soumis au réseau tant qu'on n'y a pas touché : `handmade` = faux) ──────────
export interface Anim { frames: Frame[]; delays: number[] }
const mset = (f: Frame, x: number, y: number) => { if (x >= 0 && y >= 0 && x < W && y < H) f[y * 16 + (x >> 3)] |= 0x80 >> (x & 7); };

export function templateBall(): Anim {
  const frames: Frame[] = [];
  for (let k = 0; k < 20; k++) {
    const f = blank(), t = k / 20;
    const cx = Math.round(10 + Math.abs(((t * 2) % 2) - 1) * 107), cy = Math.round(32 + Math.sin(t * Math.PI * 4) * 20);
    for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) if (x * x + y * y <= 25) mset(f, cx + x, cy + y);
    frames.push(f);
  }
  return { frames, delays: frames.map(() => 60) };
}
export function templateWave(): Anim {
  const frames: Frame[] = [];
  for (let k = 0; k < 12; k++) {
    let f = blank(), py = 0;
    for (let x = 0; x < W; x++) {
      const y = Math.round(32 + Math.sin((x / W) * Math.PI * 4 + (k / 12) * Math.PI * 2) * 11);
      if (x > 0) f = line(f, x - 1, py, x, y, true);
      py = y;
    }
    frames.push(f);
  }
  return { frames, delays: frames.map(() => 80) };
}
