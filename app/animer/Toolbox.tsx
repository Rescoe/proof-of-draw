"use client";
// app/animer/Toolbox.tsx — la boîte à outils : rail d'outils (toujours visible, jamais sous le canvas) et options contextuelles selon le mode.

import { Brush, Circle, Eraser, Grid3x3, Layers, MoreHorizontal, PaintBucket, Slash, Square } from "lucide-react";
import { BRUSHES, type BrushSpec } from "@/lib/anim/brushes";
import { BrushSample } from "./Sheets";
import { TOOL_KEY, TOOL_LABEL, type Mode, type Tool } from "./model";

export const TOOL_ICON: Record<Tool, React.ReactNode> = {
  pencil: <Brush size={22} />, eraser: <Eraser size={22} />, line: <Slash size={22} />, rect: <Square size={22} />, ellipse: <Circle size={22} />, fill: <PaintBucket size={22} />,
};

export function ToolRail({ tools, tool, onTool }: { tools: Tool[]; tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <nav className="st-toolsrow" role="toolbar" aria-label="Outils de dessin">
      {tools.map((t) => (
        <button key={t} type="button" className={"st-tool" + (tool === t ? " st-tool--on" : "")} onClick={() => onTool(t)} aria-pressed={tool === t} aria-label={TOOL_LABEL[t]} title={`${TOOL_LABEL[t]} (${TOOL_KEY[t]})`}>
          {TOOL_ICON[t]}
          {TOOL_LABEL[t]}
        </button>
      ))}
    </nav>
  );
}

const PRESET_SIZES = [1, 2, 4, 6, 9];

export interface OptionsProps {
  mode: Mode; tool: Tool; brush: BrushSpec; filled: boolean;
  fg: string; bg: string; onionPrev: boolean; onionNext: boolean; grid: boolean;
  onBrushSheet: () => void; onSize: (n: number) => void; onFilled: () => void; onColors: () => void;
  onOnionPrev: () => void; onOnionNext: () => void; onGrid: () => void; onActions: () => void;
}

export function Options(p: OptionsProps) {
  const isShape = p.tool === "rect" || p.tool === "ellipse";
  const usesBrush = p.tool === "pencil" || p.tool === "eraser" || p.tool === "line" || (isShape && !p.filled);
  const brushLabel = BRUSHES.find((b) => b.id === p.brush.kind)?.label ?? "Brosse";
  return (
    <>
      {(p.tool === "pencil" || p.tool === "eraser") && (
        <button type="button" className="st-chip" onClick={p.onBrushSheet} aria-label={`Brosse : ${brushLabel}. Changer`}>
          <BrushSample spec={{ ...p.brush, size: Math.max(2, p.brush.size) }} width={44} /> {brushLabel}
        </button>
      )}
      {usesBrush && (
        <div className="st-sizes" role="group" aria-label="Taille">
          {PRESET_SIZES.map((s) => (
            <button key={s} type="button" className={"st-size" + (p.brush.size === s ? " st-size--on" : "")} onClick={() => p.onSize(s)} aria-label={`Taille ${s}`} aria-pressed={p.brush.size === s}>
              <i style={{ width: Math.min(24, 3 + s * 2), height: Math.min(24, 3 + s * 2), borderRadius: p.brush.kind === "square" ? 2 : "50%" }} />
            </button>
          ))}
        </div>
      )}
      {isShape && <button type="button" className={"st-chip" + (p.filled ? " st-chip--on" : "")} onClick={p.onFilled} aria-pressed={p.filled}>{p.filled ? "Plein" : "Contour"}</button>}
      <span className="st-sep" />
      <button type="button" className="st-primary" onClick={p.onColors} aria-label="Couleurs de l'animation">
        <span className="st-primary__b" style={{ background: p.bg }} /><span className="st-primary__a" style={{ background: p.fg }} />
      </button>
      <span className="st-sep" />
      {p.mode === "essential" ? (
        <button type="button" className={"st-chip" + (p.onionPrev ? " st-chip--on" : "")} onClick={p.onOnionPrev} aria-pressed={p.onionPrev} title="Montre l'image précédente en transparence pour animer sans tâtonner">
          <Layers size={18} /> Fantôme
        </button>
      ) : (
        <>
          <button type="button" className={"st-chip" + (p.onionPrev ? " st-chip--on" : "")} onClick={p.onOnionPrev} aria-pressed={p.onionPrev} title="Image précédente en transparence (orange)"><Layers size={18} /> Avant</button>
          <button type="button" className={"st-chip" + (p.onionNext ? " st-chip--on" : "")} onClick={p.onOnionNext} aria-pressed={p.onionNext} title="Image suivante en transparence (bleu)"><Layers size={18} /> Après</button>
        </>
      )}
      {p.mode === "pro" && <button type="button" className={"st-chip" + (p.grid ? " st-chip--on" : "")} onClick={p.onGrid} aria-pressed={p.grid} title="Colonnes de 8 pixels : l'unité de coût d'une différence entre images"><Grid3x3 size={18} /> Octets</button>}
      <button type="button" className="st-chip" onClick={p.onActions}><MoreHorizontal size={18} /> Actions</button>
    </>
  );
}
