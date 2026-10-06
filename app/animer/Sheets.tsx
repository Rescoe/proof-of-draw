"use client";
// app/animer/Sheets.tsx — feuilles de l'atelier : brosses, couleurs, modes, actions sur l'animation.

import { useMemo, useState } from "react";
import { FlipHorizontal2, FlipVertical2, Film, Repeat, Replace, Sparkles, StepBack, Wand2 } from "lucide-react";
import { BRUSHES, MAX_BRUSH_SIZE, paintSegment, type BrushKind, type BrushSpec } from "@/lib/anim/brushes";
import { blank, H, W } from "@/lib/bench/draw";
import { clipPixel } from "@/lib/bench/clip";
import { Sheet, Slider } from "../draw/_studio/ui";
import { BG_SWATCHES, BRUSHES_BY_MODE, FG_SWATCHES, MODES, type Mode } from "./model";

// ── Aperçu d'une brosse : une vague tracée avec cette brosse ───────────────────────────────────────────
function strokeSample(spec: BrushSpec): Uint8Array {
  let f = blank(), carry = 0, px = 14, py = 40;
  for (let i = 1; i <= 24; i++) {
    const x = 14 + i * 4, y = Math.round(32 + Math.sin(i / 3.2) * 14);
    const r = paintSegment(f, px, py, x, y, true, spec, carry, i);
    f = r.frame; carry = r.carry; px = x; py = y;
  }
  return f;
}

export function BrushSample({ spec, width = 96 }: { spec: BrushSpec; width?: number }) {
  const sample = useMemo(() => strokeSample(spec), [spec]);
  return (
    <canvas width={W} height={H} style={{ width, height: width / 2, background: "#0a0a10", borderRadius: 6, imageRendering: "pixelated" }}
      ref={(cv) => {
        const ctx = cv?.getContext("2d"); if (!ctx) return;
        const img = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const on = clipPixel(sample, x, y), i = (y * W + x) * 4, v = on ? 235 : 10; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = on ? 255 : 16; img.data[i + 3] = 255; }
        ctx.putImageData(img, 0, 0);
      }} />
  );
}

export function BrushSheet({ mode, brush, onBrush, onClose }: { mode: Mode; brush: BrushSpec; onBrush: (b: BrushSpec) => void; onClose: () => void }) {
  const kinds = BRUSHES.filter((b) => BRUSHES_BY_MODE[mode].includes(b.id));
  return (
    <Sheet title="Brosses" onClose={onClose}>
      <div className="st-grid st-grid--brush">
        {kinds.map((b) => (
          <button key={b.id} type="button" className={"st-card" + (brush.kind === b.id ? " st-card--on" : "")} onClick={() => onBrush({ ...brush, kind: b.id })} title={b.hint}>
            <BrushSample spec={{ ...brush, kind: b.id, size: Math.max(brush.size, 3) }} width={88} />
            {b.label}
          </button>
        ))}
      </div>
      <p className="st-note" style={{ marginTop: 10 }}>{BRUSHES.find((b) => b.id === brush.kind)?.hint}</p>
      <div className="st-h">Taille</div>
      <Slider label="Taille de la brosse" value={brush.size} min={1} max={MAX_BRUSH_SIZE} onChange={(size) => onBrush({ ...brush, size })} format={(v) => `${v} px`} />
      {brush.kind === "texture" && (
        <>
          <div className="st-h">Densité de la trame</div>
          <div className="st-seg">
            {([1, 2, 3] as const).map((t) => <button key={t} type="button" className={(brush.tone ?? 2) === t ? "on" : ""} onClick={() => onBrush({ ...brush, tone: t })}>{t * 25} %</button>)}
          </div>
        </>
      )}
    </Sheet>
  );
}

// ── Couleurs : tracé (avant-plan) et fond. Elles s'appliquent à toute l'animation (le clip n'a qu'une couleur de tracé et une de fond). ──
export function ColorSheet({ fg, bg, onFg, onBg, onClose }: { fg: string; bg: string; onFg: (c: string) => void; onBg: (c: string) => void; onClose: () => void }) {
  return (
    <Sheet title="Couleurs" onClose={onClose}>
      <p className="st-note">Une animation a <b>une couleur de tracé</b> et <b>une couleur de fond</b> (écrans couleur) ; sur l&apos;OLED, tout est blanc sur noir.</p>
      <div className="st-h">Tracé</div>
      <div className="st-grid st-grid--pal">
        {FG_SWATCHES.map((c) => <button key={c} type="button" aria-label={`Tracé ${c}`} className={"st-swatch" + (c === fg ? " st-swatch--on" : "")} style={{ background: c }} onClick={() => onFg(c)} />)}
        <label className="st-swatch" style={{ background: "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)", display: "grid", placeItems: "center" }} title="Autre couleur">
          <input type="color" value={fg} onChange={(e) => onFg(e.target.value)} aria-label="Couleur de tracé personnalisée" style={{ opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
        </label>
      </div>
      <div className="st-h">Fond</div>
      <div className="st-grid st-grid--pal">
        {BG_SWATCHES.map((c) => <button key={c} type="button" aria-label={`Fond ${c}`} className={"st-swatch" + (c === bg ? " st-swatch--on" : "")} style={{ background: c }} onClick={() => onBg(c)} />)}
        <label className="st-swatch" style={{ background: "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)", display: "grid", placeItems: "center" }} title="Autre couleur">
          <input type="color" value={bg} onChange={(e) => onBg(e.target.value)} aria-label="Couleur de fond personnalisée" style={{ opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
        </label>
      </div>
    </Sheet>
  );
}

// ── Modes ──────────────────────────────────────────────────────────────────────────────────────────────
export function ModeSheet({ mode, onMode, onClose }: { mode: Mode; onMode: (m: Mode) => void; onClose: () => void }) {
  return (
    <Sheet title="Mode de l'atelier" onClose={onClose}>
      <div className="st-menu">
        {MODES.map((m) => (
          <button key={m.id} type="button" className={"st-boxcard" + (m.id === mode ? " st-boxcard--on" : "")} onClick={() => { onMode(m.id); onClose(); }}>
            <div><b>{m.label}</b><span>{m.tagline}</span></div>
          </button>
        ))}
      </div>
      <p className="st-note" style={{ marginTop: 10 }}>Changer de mode ne perd rien : votre animation, vos couleurs et l&apos;historique restent.</p>
    </Sheet>
  );
}

// ── Actions sur l'animation ───────────────────────────────────────────────────────────────────────────
export interface AnimActions {
  flipH: () => void; flipV: () => void; invert: () => void; shift: (dx: number, dy: number, wrap: boolean) => void;
  reverse: () => void; pingPong: () => void; motion: (n: number, dx: number, dy: number, wrap: boolean) => void; textScroll: (text: string) => void;
  template: (kind: "ball" | "wave") => void; newAnim: () => void; canPingPong: boolean;
}

export function ActionsSheet({ mode, actions, onClose }: { mode: Mode; actions: AnimActions; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [wrap, setWrap] = useState(true);
  const [mvN, setMvN] = useState(8);
  const [mvDx, setMvDx] = useState(4);
  const [mvDy, setMvDy] = useState(0);
  const [text, setText] = useState("PoD");
  const run = (fn: () => void) => () => { fn(); };
  return (
    <Sheet title="Actions" onClose={onClose}>
      {mode !== "essential" && (
        <>
          <div className="st-h">Image courante</div>
          <div className="st-row">
            <button type="button" className="st-chip" onClick={run(actions.flipH)}><FlipHorizontal2 size={18} /> Retourner ↔</button>
            <button type="button" className="st-chip" onClick={run(actions.flipV)}><FlipVertical2 size={18} /> Retourner ↕</button>
            <button type="button" className="st-chip" onClick={run(actions.invert)}><Replace size={18} /> Inverser</button>
          </div>
          <div className="st-h">Décaler l&apos;image</div>
          <div className="st-row">
            {([["◀", -1, 0], ["▲", 0, -1], ["▼", 0, 1], ["▶", 1, 0]] as const).map(([label, dx, dy]) => (
              <button key={label} type="button" className="st-chip st-chip--icon" aria-label={`Décaler ${label}`} onClick={() => actions.shift(dx * step, dy * step, wrap)}>{label}</button>
            ))}
            <div className="st-seg">{[1, 4, 8].map((s) => <button key={s} type="button" className={step === s ? "on" : ""} onClick={() => setStep(s)}>{s} px</button>)}</div>
            <button type="button" className={"st-chip" + (wrap ? " st-chip--on" : "")} onClick={() => setWrap((w) => !w)} aria-pressed={wrap}>Reboucler</button>
          </div>
          <div className="st-h">Toute l&apos;animation</div>
          <div className="st-row">
            <button type="button" className="st-chip" onClick={run(actions.reverse)}><StepBack size={18} /> Inverser l&apos;ordre</button>
            <button type="button" className="st-chip" onClick={run(actions.pingPong)} disabled={!actions.canPingPong}><Repeat size={18} /> Aller-retour</button>
          </div>
        </>
      )}
      {mode === "pro" && (
        <>
          <div className="st-h">Générer un mouvement à partir de l&apos;image courante</div>
          <p className="st-note">Remplace l&apos;animation par N copies de l&apos;image, chacune décalée de (dx, dy) : défilement, vague, rotation lente…</p>
          <div className="st-row">
            <Slider label="Nombre d'images" value={mvN} min={2} max={40} onChange={setMvN} format={(v) => `${v} images`} />
            <Slider label="Décalage horizontal par image" value={mvDx} min={-16} max={16} onChange={setMvDx} format={(v) => `dx ${v}`} />
            <Slider label="Décalage vertical par image" value={mvDy} min={-16} max={16} onChange={setMvDy} format={(v) => `dy ${v}`} />
          </div>
          <div className="st-row" style={{ marginTop: 6 }}>
            <button type="button" className="st-chip st-chip--ok" onClick={() => actions.motion(mvN, mvDx, mvDy, wrap)}><Wand2 size={18} /> Générer le mouvement</button>
          </div>
          <div className="st-h">Texte défilant</div>
          <div className="st-row">
            <input className="st-input" style={{ flex: 1, minWidth: 140, height: 44 }} value={text} maxLength={24} onChange={(e) => setText(e.target.value)} aria-label="Texte à faire défiler" />
            <button type="button" className="st-chip st-chip--ok" onClick={() => actions.textScroll(text)}><Sparkles size={18} /> Créer</button>
          </div>
        </>
      )}
      <div className="st-h">Modèles et nouvelle animation</div>
      <div className="st-row">
        <button type="button" className="st-chip" onClick={() => actions.template("ball")}><Film size={18} /> Balle qui rebondit</button>
        <button type="button" className="st-chip" onClick={() => actions.template("wave")}><Film size={18} /> Vague</button>
        <button type="button" className="st-chip st-chip--danger" onClick={actions.newAnim}>Nouvelle animation vide</button>
      </div>
      <p className="st-note" style={{ marginTop: 8 }}>Un modèle de départ n&apos;est jamais soumis au réseau tel quel : dessinez dessus pour en faire votre œuvre.</p>
    </Sheet>
  );
}

export type { BrushKind };
