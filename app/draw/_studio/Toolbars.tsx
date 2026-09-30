"use client";
// app/draw/_studio/Toolbars.tsx — barre du haut, barre d'outils, options contextuelles, dock

import {
  Brush, ChevronLeft, Circle, Copy, Eraser, FlipHorizontal2, FlipVertical2, Grid2x2, Lasso, Menu as MenuIcon,
  Minus, PaintBucket, Pentagon, Pipette, Redo2, RotateCw, Send, Shapes, Slash, Sparkles, Square,
  SquareDashed, Star, Trash2, Type, Undo2, X, Check, WandSparkles, Clock, FlipHorizontal, Blend, ImageOff,
} from "lucide-react";
import type { ColorMode } from "@/lib/drawEngine";
import { textureLabel } from "@/lib/drawEngine";
import {
  PanelId, SelectKind, ShapeKind, TOOLS_BY_BOX, TOOL_KEY, TOOL_LABEL, ToolId, ToolSettings, Toolbox,
} from "./types";
import { BrushPreview, TexturePreview } from "./previews";
import { Slider, formatTime } from "./ui";

export const TOOL_ICON: Record<ToolId, React.ReactNode> = {
  brush: <Brush size={22} />, eraser: <Eraser size={22} />, fill: <PaintBucket size={22} />,
  shape: <Shapes size={22} />, eyedropper: <Pipette size={22} />, select: <SquareDashed size={22} />, text: <Type size={22} />,
};

// ─── Barre du haut ───────────────────────────────────────────────────────────

export interface SendButtonState { kind: "ready" | "wait" | "empty" | "sending"; label: string }

export function TopBar(props: {
  title: string; onTitle: (v: string) => void; titleFlash: boolean;
  score: number; scorePop: number; onScore: () => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  onMenu: () => void; onBack: () => void; onSend: () => void; send: SendButtonState;
}) {
  return (
    <header className="st-top">
      <button type="button" className="st-btn st-btn--icon" onClick={props.onBack} aria-label="Retour"><ChevronLeft size={24} /></button>
      <input
        className={"st-title" + (props.titleFlash ? " st-flash" : "")} value={props.title} maxLength={80}
        placeholder="Titre de l'œuvre" aria-label="Titre de l'œuvre"
        onChange={e => props.onTitle(e.target.value)}
        enterKeyHint="done" onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <span className="st-top__spacer" />
      <span className="st-undo-group">
        <button type="button" className="st-btn st-btn--icon" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Annuler" title="Annuler (Ctrl+Z)"><Undo2 size={21} /></button>
        <button type="button" className="st-btn st-btn--icon" onClick={props.onRedo} disabled={!props.canRedo} aria-label="Rétablir" title="Rétablir (Ctrl+Y)"><Redo2 size={21} /></button>
      </span>
      <button type="button" className="st-score" onClick={props.onScore} aria-label={`${props.score} points de dessin — détails`} title="Points de dessin">
        <Star size={14} fill="currentColor" /> {props.score}
        {props.scorePop > 0 && <span key={props.scorePop} className="st-score__pop">+1</span>}
      </button>
      <button type="button" className="st-btn st-btn--icon" onClick={props.onMenu} aria-label="Menu"><MenuIcon size={22} /></button>
      <button
        type="button"
        className={"st-send" + (props.send.kind === "wait" ? " st-send--wait" : props.send.kind === "empty" ? " st-send--empty" : "")}
        onClick={props.onSend}
        aria-label="Envoyer le dessin"
      >
        {props.send.kind === "wait" ? <Clock size={17} /> : <Send size={17} />}
        {props.send.label}
      </button>
    </header>
  );
}

// ─── Barre d'outils ──────────────────────────────────────────────────────────

export function ToolStrip({ toolbox, tool, onTool }: { toolbox: Toolbox; tool: ToolId; onTool: (t: ToolId) => void }) {
  return (
    <nav className="st-toolsrow" role="toolbar" aria-label="Outils de dessin">
      {TOOLS_BY_BOX[toolbox].map(t => (
        <button
          key={t} type="button" className={"st-tool" + (tool === t ? " st-tool--on" : "")}
          onClick={() => onTool(t)} aria-pressed={tool === t} title={`${TOOL_LABEL[t]} (${TOOL_KEY[t]})`}
        >
          {TOOL_ICON[t]}
          {TOOL_LABEL[t]}
        </button>
      ))}
    </nav>
  );
}

// ─── Options contextuelles ───────────────────────────────────────────────────

const SIZE_PRESETS = [
  { v: 2, dot: 6 }, { v: 4, dot: 11 }, { v: 8, dot: 18 },
];

function SizeChips({ value, onChange, presets = SIZE_PRESETS }: { value: number; onChange: (v: number) => void; presets?: { v: number; dot: number }[] }) {
  return (
    <div className="st-sizes" role="group" aria-label="Taille">
      {presets.map(p => (
        <button key={p.v} type="button" className={"st-size" + (value === p.v ? " st-size--on" : "")} onClick={() => onChange(p.v)} aria-label={`Taille ${p.v}`} aria-pressed={value === p.v}>
          <i style={{ width: p.dot, height: p.dot }} />
        </button>
      ))}
    </div>
  );
}

const SHAPE_ICON: Record<ShapeKind, React.ReactNode> = {
  line: <Slash size={18} />, rect: <Square size={18} />, ellipse: <Circle size={18} />, poly: <Pentagon size={18} />,
};
const SHAPE_LABEL: Record<ShapeKind, string> = { line: "Ligne", rect: "Rectangle", ellipse: "Ellipse", poly: "Polygone" };

export interface SelectionUi {
  has: boolean;             // une sélection existe
  floating: boolean;        // elle a été déplacée/transformée (non validée)
  copy: boolean;
}

export function ToolOptions(props: {
  tool: ToolId; toolbox: Toolbox; mode: ColorMode; cfg: ToolSettings;
  set: (patch: Partial<ToolSettings>) => void; open: (p: PanelId) => void;
  polyCount: number; onPolyDone: () => void; onPolyCancel: () => void;
  sel: SelectionUi;
  onSelCommit: () => void; onSelCancel: () => void; onSelCopy: () => void;
  onSelFlipH: () => void; onSelFlipV: () => void; onSelRot: () => void; onSelDelete: () => void;
  text: { active: boolean; value: string; onChange: (v: string) => void; onOk: () => void; onCancel: () => void };
  hasColorB: boolean;
}) {
  const { tool, toolbox, cfg, set, mode } = props;
  const essential = toolbox === "essential", pro = toolbox === "pro";
  const tft = mode === "rgb565";

  const textureChip = !essential && (
    <button type="button" className={"st-chip" + (cfg.texture !== "solid" || (tft && cfg.opacity < 100) ? " st-chip--on" : "")} onClick={() => props.open("texture")} aria-label="Textures et opacité">
      <TexturePreview texture={cfg.texture} w={12} h={12} scale={2} className="st-chip__thumb" />
      {cfg.texture === "solid" ? (tft && cfg.opacity < 100 ? `${cfg.opacity} %` : "Plein") : textureLabel(cfg.texture)}
    </button>
  );
  const symChip = !essential && (
    <button type="button" className={"st-chip" + (cfg.sym ? " st-chip--on" : "")} onClick={() => props.open("sym")} aria-label="Symétrie">
      <FlipHorizontal2 size={17} /> {cfg.sym ? "Symétrie" : "Symétrie"}
    </button>
  );

  switch (tool) {
    case "brush":
      return (
        <>
          {essential ? (
            <SizeChips value={cfg.size} onChange={v => set({ size: v })} />
          ) : (
            <>
              <button type="button" className="st-chip" onClick={() => props.open("brush")} aria-label="Choisir la brosse">
                <BrushPreview brush={cfg.brush} size={Math.max(2, Math.min(cfg.size, 8))} w={24} h={14} scale={1} className="st-chip__thumb" />
                Brosse
              </button>
              {cfg.brush !== "pixel" && <Slider value={cfg.size} min={1} max={pro ? 32 : 16} label="Taille du pinceau" onChange={v => set({ size: v })} format={v => v + " px"} />}
              {textureChip}
              {tft && cfg.texture === "solid" && <Slider value={cfg.opacity} min={5} max={100} step={5} label="Opacité" onChange={v => set({ opacity: v })} format={v => v + " %"} />}
              {symChip}
              {pro && (cfg.brush === "pixel" || cfg.size === 1) && (
                <button type="button" className={"st-chip" + (cfg.pixelPerfect ? " st-chip--on" : "")} onClick={() => set({ pixelPerfect: !cfg.pixelPerfect })} aria-pressed={cfg.pixelPerfect} title="Supprime les coins en L pour un trait 1 px net">
                  <Sparkles size={16} /> Pixel parfait
                </button>
              )}
              {pro && (
                <div className="st-slider" title="Stabilisateur : lisse le tremblement de la main">
                  <span className="st-optlabel">Lisser</span>
                  <input className="st-range" type="range" min={0} max={6} value={cfg.stabilizer} aria-label="Stabilisateur" onChange={e => set({ stabilizer: Number(e.target.value) })} />
                </div>
              )}
              <button type="button" className={"st-chip" + (cfg.precision ? " st-chip--on" : "")} onClick={() => set({ precision: !cfg.precision })} aria-pressed={cfg.precision} title="Curseur décalé au-dessus du doigt + loupe">
                Précision
              </button>
            </>
          )}
        </>
      );
    case "eraser":
      return essential
        ? <SizeChips value={cfg.eraserSize} onChange={v => set({ eraserSize: v })} presets={[{ v: 4, dot: 8 }, { v: 8, dot: 14 }, { v: 16, dot: 22 }]} />
        : (
          <>
            <Slider value={cfg.eraserSize} min={1} max={pro ? 40 : 24} label="Taille de la gomme" onChange={v => set({ eraserSize: v })} format={v => v + " px"} />
            <button type="button" className={"st-chip" + (cfg.precision ? " st-chip--on" : "")} onClick={() => set({ precision: !cfg.precision })} aria-pressed={cfg.precision}>Précision</button>
          </>
        );
    case "fill":
      return (
        <>
          {!essential && (
            <div className="st-seg" role="group" aria-label="Zone à remplir">
              <button type="button" className={!cfg.fillGlobal ? "on" : ""} onClick={() => set({ fillGlobal: false })}>Zone</button>
              <button type="button" className={cfg.fillGlobal ? "on" : ""} onClick={() => set({ fillGlobal: true })} title="Remplace toutes les zones de cette couleur">Partout</button>
            </div>
          )}
          {pro && (
            <div className="st-seg" role="group" aria-label="Mode de remplissage">
              <button type="button" className={!cfg.fillGradient ? "on" : ""} onClick={() => set({ fillGradient: false })}>Uni</button>
              <button type="button" className={cfg.fillGradient ? "on" : ""} onClick={() => set({ fillGradient: true })}>Dégradé</button>
            </div>
          )}
          {pro && cfg.fillGradient && (
            <button type="button" className="st-chip" onClick={() => props.open("color")} aria-label="Couleurs du dégradé">
              <span style={{ width: 16, height: 16, borderRadius: 5, background: cfg.color, border: "1px solid rgba(255,255,255,.4)" }} />→
              <span style={{ width: 16, height: 16, borderRadius: 5, background: cfg.color2, border: "1px solid rgba(255,255,255,.4)" }} />
            </button>
          )}
          {!cfg.fillGradient && textureChip}
          <span className="st-note">{cfg.fillGradient ? "Glisse pour choisir la direction du dégradé" : "Touche une zone pour la remplir"}</span>
        </>
      );
    case "shape":
      return (
        <>
          <div className="st-seg" role="group" aria-label="Forme">
            {(["line", "rect", "ellipse", ...(pro ? ["poly"] : [])] as ShapeKind[]).map(k => (
              <button key={k} type="button" className={cfg.shape === k ? "on" : ""} onClick={() => set({ shape: k })} aria-label={SHAPE_LABEL[k]} title={SHAPE_LABEL[k]} style={{ padding: "0 11px" }}>
                {SHAPE_ICON[k]}
              </button>
            ))}
          </div>
          {cfg.shape !== "line" && (
            <div className="st-seg" role="group" aria-label="Contour ou plein">
              <button type="button" className={!cfg.shapeFill ? "on" : ""} onClick={() => set({ shapeFill: false })}>Contour</button>
              <button type="button" className={cfg.shapeFill ? "on" : ""} onClick={() => set({ shapeFill: true })}>Plein</button>
            </div>
          )}
          {(!cfg.shapeFill || cfg.shape === "line") && (
            essential
              ? <SizeChips value={cfg.shapeSize} onChange={v => set({ shapeSize: v })} presets={[{ v: 1, dot: 3 }, { v: 3, dot: 8 }, { v: 6, dot: 14 }]} />
              : <Slider value={cfg.shapeSize} min={1} max={12} label="Épaisseur" onChange={v => set({ shapeSize: v })} format={v => v + " px"} />
          )}
          {!essential && cfg.shape !== "poly" && (
            <button type="button" className={"st-chip" + (cfg.constrain ? " st-chip--on" : "")} onClick={() => set({ constrain: !cfg.constrain })} aria-pressed={cfg.constrain} title={cfg.shape === "line" ? "Angles de 45°" : "Carré / cercle parfait"}>
              {cfg.shape === "line" ? "45°" : "1:1"}
            </button>
          )}
          {pro && (cfg.shape === "rect" || cfg.shape === "ellipse") && (
            <button type="button" className={"st-chip" + (cfg.fromCenter ? " st-chip--on" : "")} onClick={() => set({ fromCenter: !cfg.fromCenter })} aria-pressed={cfg.fromCenter}>Depuis le centre</button>
          )}
          {textureChip}
          {symChip}
          {cfg.shape === "poly" && (
            <>
              <span className="st-note">{props.polyCount === 0 ? "Touche pour poser les sommets" : `${props.polyCount} sommet${props.polyCount > 1 ? "s" : ""} — touche le premier pour fermer`}</span>
              {props.polyCount >= 2 && <button type="button" className="st-chip st-chip--ok" onClick={props.onPolyDone}><Check size={16} /> Terminer</button>}
              {props.polyCount >= 1 && <button type="button" className="st-chip" onClick={props.onPolyCancel}><X size={16} /> Annuler</button>}
            </>
          )}
        </>
      );
    case "eyedropper":
      return <span className="st-note">Touche un pixel du dessin pour prendre sa couleur</span>;
    case "select":
      return (
        <>
          <div className="st-seg" role="group" aria-label="Type de sélection">
            {([["rect", <SquareDashed key="r" size={17} />, "Rectangle"], ["wand", <WandSparkles key="w" size={17} />, "Baguette (par couleur)"], ...(pro ? [["lasso", <Lasso key="l" size={17} />, "Lasso"]] : [])] as [SelectKind, React.ReactNode, string][]).map(([k, icon, label]) => (
              <button key={k} type="button" className={cfg.selectKind === k ? "on" : ""} onClick={() => set({ selectKind: k })} aria-label={label} title={label} style={{ padding: "0 11px" }}>{icon}</button>
            ))}
          </div>
          {cfg.selectKind === "wand" && (
            <div className="st-seg" role="group" aria-label="Portée de la baguette">
              <button type="button" className={!cfg.selectGlobal ? "on" : ""} onClick={() => set({ selectGlobal: false })}>Zone</button>
              <button type="button" className={cfg.selectGlobal ? "on" : ""} onClick={() => set({ selectGlobal: true })}>Partout</button>
            </div>
          )}
          {!props.sel.has && <span className="st-note">{cfg.selectKind === "rect" ? "Glisse pour encadrer une zone" : cfg.selectKind === "wand" ? "Touche une couleur pour la sélectionner" : "Dessine le contour à main levée"}</span>}
          {props.sel.has && (
            <>
              <span className="st-sep" />
              <span className="st-note">Glisse dans la sélection pour la déplacer</span>
              <button type="button" className={"st-chip" + (props.sel.copy ? " st-chip--on" : "")} onClick={props.onSelCopy} aria-pressed={props.sel.copy}><Copy size={16} /> Dupliquer</button>
              <button type="button" className="st-chip st-chip--icon" onClick={props.onSelFlipH} aria-label="Miroir horizontal"><FlipHorizontal size={18} /></button>
              <button type="button" className="st-chip st-chip--icon" onClick={props.onSelFlipV} aria-label="Miroir vertical"><FlipVertical2 size={18} /></button>
              <button type="button" className="st-chip st-chip--icon" onClick={props.onSelRot} aria-label="Pivoter de 90°"><RotateCw size={18} /></button>
              <button type="button" className="st-chip st-chip--icon st-chip--danger" onClick={props.onSelDelete} aria-label="Supprimer la sélection"><Trash2 size={18} /></button>
              <button type="button" className="st-chip st-chip--ok" onClick={props.onSelCommit}><Check size={16} /> {props.sel.floating ? "Valider" : "OK"}</button>
              <button type="button" className="st-chip" onClick={props.onSelCancel}><X size={16} /> {props.sel.floating ? "Annuler" : "Désélectionner"}</button>
            </>
          )}
        </>
      );
    case "text":
      return props.text.active ? (
        <div className="st-textbar">
          <input
            className="st-input" autoFocus value={props.text.value} maxLength={120} placeholder="Écris ton texte…"
            aria-label="Texte à écrire" enterKeyHint="done"
            onChange={e => props.text.onChange(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") props.text.onOk(); if (e.key === "Escape") props.text.onCancel(); }}
          />
          <button type="button" className="st-chip st-chip--ok" onClick={props.text.onOk}><Check size={16} /> OK</button>
          <button type="button" className="st-chip st-chip--icon" onClick={props.text.onCancel} aria-label="Annuler le texte"><X size={18} /></button>
        </div>
      ) : (
        <>
          <SizeChips value={cfg.textScale} onChange={v => set({ textScale: v })} presets={[{ v: 1, dot: 6 }, { v: 2, dot: 11 }, { v: 3, dot: 17 }]} />
          {textureChip}
          <span className="st-note">Touche le dessin à l&apos;endroit où écrire</span>
        </>
      );
  }
}

// ─── Dock (téléphone) ────────────────────────────────────────────────────────

export function Dock(props: {
  mode: ColorMode; palette: string[]; recents: string[]; color: string; color2: string;
  onColor: (hex: string) => void; onOpenColors: () => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
}) {
  const tft = props.mode === "rgb565";
  const quick = tft ? props.recents.slice(0, 5) : props.palette;
  return (
    <footer className="st-dock">
      <button type="button" className="st-primary" onClick={props.onOpenColors} aria-label="Ouvrir les couleurs">
        <span className="st-primary__b" style={{ background: props.color2 }} />
        <span className="st-primary__a" style={{ background: props.color }} />
      </button>
      <div className="st-dock__colors" role="group" aria-label="Couleurs rapides">
        {quick.map(c => (
          <button
            key={c} type="button" aria-label={`Couleur ${c}`}
            className={"st-swatch" + (c.toLowerCase() === props.color.toLowerCase() ? " st-swatch--on" : "") + (tft ? "" : " st-swatch--lg")}
            style={{ background: c }} onClick={() => props.onColor(c)}
          />
        ))}
        {tft && <button type="button" className="st-chip st-chip--icon" onClick={props.onOpenColors} aria-label="Toutes les couleurs"><Blend size={18} /></button>}
      </div>
      <button type="button" className="st-btn st-btn--icon st-btn--solid" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Annuler"><Undo2 size={22} /></button>
      <button type="button" className="st-btn st-btn--icon st-btn--solid" onClick={props.onRedo} disabled={!props.canRedo} aria-label="Rétablir"><Redo2 size={22} /></button>
    </footer>
  );
}

export { Grid2x2, ImageOff, Sparkles as SparklesIcon, formatTime as _ft };
