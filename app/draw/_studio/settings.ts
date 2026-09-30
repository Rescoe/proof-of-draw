// app/draw/_studio/settings.ts — passage des réglages d'interface aux réglages du moteur

import type { FillSettings, GradientSettings, ShapeSettings, StrokeSettings, TextSettings } from "@/lib/drawEngine";
import type { SymCfg } from "@/lib/drawEngine";
import type { ToolSettings } from "./types";

export function symOf(cfg: ToolSettings, W: number, H: number): SymCfg | null {
  if (!cfg.sym) return null;
  return { m: cfg.sym, cx: cfg.symCx || W / 2, cy: cfg.symCy || H / 2 };
}

export function strokeSettings(cfg: ToolSettings, erase: boolean, W: number, H: number): StrokeSettings {
  return {
    erase,
    brush: erase ? "square" : cfg.brush,
    size: erase ? cfg.eraserSize : cfg.size,
    color: cfg.color,
    opacity: cfg.opacity,
    texture: erase ? "solid" : cfg.texture,
    sym: symOf(cfg, W, H),
    pixelPerfect: !erase && cfg.pixelPerfect,
  };
}

export function shapeSettings(cfg: ToolSettings, W: number, H: number): ShapeSettings {
  return {
    shape: cfg.shape,
    brush: cfg.brush === "square" ? "square" : "round",
    size: cfg.shapeSize,
    color: cfg.color,
    opacity: cfg.opacity,
    texture: cfg.texture,
    fill: cfg.shapeFill && cfg.shape !== "line",
    fromCenter: cfg.fromCenter && (cfg.shape === "rect" || cfg.shape === "ellipse"),
    sym: symOf(cfg, W, H),
  };
}

export function fillSettings(cfg: ToolSettings): FillSettings {
  return { color: cfg.color, opacity: cfg.opacity, texture: cfg.texture, global: cfg.fillGlobal };
}

export function gradientSettings(cfg: ToolSettings): GradientSettings {
  return { color: cfg.color, color2: cfg.color2, global: cfg.fillGlobal };
}

export function textSettings(cfg: ToolSettings): TextSettings {
  return { color: cfg.color, scale: cfg.textScale, opacity: cfg.opacity, texture: cfg.texture };
}

/** Contraint le point d'arrivée d'une forme (angles de 45° pour une ligne, carré/cercle pour rect/ellipse). */
export function constrainPoint(kind: string, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (kind === "line") {
    if (ady < adx * 0.4142) return { x: b.x, y: a.y };
    if (adx < ady * 0.4142) return { x: a.x, y: b.y };
    const m = Math.max(adx, ady);
    return { x: a.x + Math.sign(dx || 1) * m, y: a.y + Math.sign(dy || 1) * m };
  }
  const m = Math.max(adx, ady);
  return { x: a.x + Math.sign(dx || 1) * m, y: a.y + Math.sign(dy || 1) * m };
}
