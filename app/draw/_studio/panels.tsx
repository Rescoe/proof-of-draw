"use client";
// app/draw/_studio/panels.tsx
// Sections d'interface (couleurs, brosses, textures, symétrie, modèle, score, aide, menu).
// Chaque section est un composant autonome : il s'affiche dans une feuille sur
// téléphone et directement dans le panneau latéral sur grand écran.

import { useEffect, useRef, useState } from "react";
import {
  Check, Eye, EyeOff, Grid3x3, HelpCircle, ImagePlus, Keyboard, Lock, Maximize, Move, Plus,
  Rotate3d, ScanLine, Smartphone, Star, Trash2, Sparkles, ImageOff, ArrowLeftRight, Pipette, Trophy,
  FilePlus2, Eraser, Fingerprint,
} from "lucide-react";
import {
  ACHIEVEMENTS, BRUSH_TYPES, ColorMode, DENSITY_TEXTURES, PodHints, SYMMETRY_MODES, TEXTURES,
  colorToHsv, customTextureId, encodeCustomBrush, fromHex, hsvToColor, isCustomBrush, quantize565, toHex,
  POD_MIN_COVERAGE, POD_MIN_SESSION_MS, POD_MIN_STROKES, textureLabel,
} from "@/lib/drawEngine";
import { TOOLBOXES, Toolbox, ModelImage, GridSettings } from "./types";
import { BrushPreview, TexturePreview } from "./previews";
import { Modal, Slider, formatTime } from "./ui";

// ─── Couleurs ────────────────────────────────────────────────────────────────

const hexOf = (h: number, s: number, v: number) => toHex(hsvToColor(h, s, v));

function HsvPicker({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const sv = colorToHsv(fromHex(color));
  const [hue, setHue] = useState({ h: sv.h, hex: color });
  let h = hue.h;
  // Resynchronise la teinte quand la couleur change de l'extérieur (pipette, palette…)
  if (color.toLowerCase() !== hue.hex.toLowerCase()) {
    h = sv.s > 0.02 && sv.v > 0.02 ? sv.h : hue.h;
    setHue({ h, hex: color });
  }
  const box = useRef<HTMLDivElement>(null);
  const pick = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const hex = hexOf(h, s, v);
    setHue({ h, hex });
    onChange(hex);
  };
  return (
    <div className="st-hsv">
      <div
        ref={box} className="st-sv"
        style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${h} 100% 50%))` }}
        onPointerDown={e => { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ } pick(e); }}
        onPointerMove={e => { if (e.buttons) pick(e); }}
      >
        <span className="st-sv__thumb" style={{ left: `${sv.s * 100}%`, top: `${(1 - sv.v) * 100}%`, background: color }} />
      </div>
      <input
        className="st-range st-hue" type="range" min={0} max={359} value={Math.round(h)} aria-label="Teinte"
        style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)", borderRadius: 8, height: 30 }}
        onChange={e => { const nh = Number(e.target.value); const hex = hexOf(nh, sv.s || 1, sv.v || 1); setHue({ h: nh, hex }); onChange(hex); }}
      />
    </div>
  );
}

export function ColorSection(props: {
  mode: ColorMode; palette: string[]; color: string; color2: string;
  recents: string[]; favorites: string[];
  onColor: (hex: string) => void; onColor2: (hex: string) => void; onSwap: () => void;
  onFav: (hex: string) => void; onEyedropper?: () => void;
}) {
  const [target, setTarget] = useState<"a" | "b">("a");
  const cur = target === "a" ? props.color : props.color2;
  const set = (hex: string) => (target === "a" ? props.onColor(hex) : props.onColor2(hex));
  const [hexState, setHexState] = useState({ text: cur, seen: cur });
  if (hexState.seen !== cur) setHexState({ text: cur, seen: cur });
  const hexText = hexState.text;
  const setHexText = (text: string) => setHexState(s => ({ ...s, text }));
  const isFav = props.favorites.map(f => f.toLowerCase()).includes(cur.toLowerCase());
  const tft = props.mode === "rgb565";
  return (
    <div>
      <div className="st-row st-row--between" style={{ marginBottom: 10 }}>
        <div className="st-seg" role="tablist" aria-label="Couleur à modifier">
          <button type="button" className={target === "a" ? "on" : ""} onClick={() => setTarget("a")}>Couleur A</button>
          <button type="button" className={target === "b" ? "on" : ""} onClick={() => setTarget("b")}>Couleur B</button>
        </div>
        <button type="button" className="st-chip st-chip--icon" onClick={props.onSwap} aria-label="Échanger A et B" title="Échanger A et B (X)"><ArrowLeftRight size={18} /></button>
      </div>

      {tft ? (
        <>
          <HsvPicker color={cur} onChange={set} />
          <div className="st-row" style={{ marginTop: 10 }}>
            <input
              className="st-hex" value={hexText} maxLength={7} aria-label="Code couleur hexadécimal"
              onChange={e => { setHexText(e.target.value); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) set(e.target.value.toLowerCase()); }}
            />
            <button type="button" className="st-chip st-chip--icon" onClick={() => props.onFav(cur)} aria-label={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}>
              <Star size={18} fill={isFav ? "currentColor" : "none"} />
            </button>
            {props.onEyedropper && <button type="button" className="st-chip st-chip--icon" onClick={props.onEyedropper} aria-label="Pipette"><Pipette size={18} /></button>}
            <div className="st-real" title="Le TFT affiche 65 536 couleurs : voici celle que verra l'écran">
              <i style={{ background: toHex(quantize565(fromHex(cur))) }} /> affichée
            </div>
          </div>
        </>
      ) : null}

      <div className="st-h">{tft ? "Palette" : "Couleurs de l'écran"}</div>
      <div className={"st-grid " + (tft ? "st-grid--pal" : "")} style={tft ? undefined : { gridTemplateColumns: `repeat(${props.palette.length}, 1fr)` }}>
        {props.palette.map(c => (
          <button
            key={c} type="button" aria-label={`Couleur ${c}`} title={c}
            className={"st-swatch" + (c.toLowerCase() === cur.toLowerCase() ? " st-swatch--on" : "") + (tft ? "" : " st-swatch--lg")}
            style={{ background: c, width: tft ? "100%" : undefined, aspectRatio: tft ? "1" : undefined, height: tft ? "auto" : 56 }}
            onClick={() => set(c)}
          />
        ))}
      </div>

      {tft && props.recents.length > 0 && (
        <>
          <div className="st-h">Récentes</div>
          <div className="st-grid st-grid--pal">
            {props.recents.map(c => (
              <button key={c} type="button" aria-label={`Couleur récente ${c}`} className={"st-swatch" + (c.toLowerCase() === cur.toLowerCase() ? " st-swatch--on" : "")}
                style={{ background: c, width: "100%", aspectRatio: "1", height: "auto" }} onClick={() => set(c)} />
            ))}
          </div>
        </>
      )}
      {tft && props.favorites.length > 0 && (
        <>
          <div className="st-h">Favorites</div>
          <div className="st-grid st-grid--pal">
            {props.favorites.map(c => (
              <button key={c} type="button" aria-label={`Couleur favorite ${c}`} className={"st-swatch" + (c.toLowerCase() === cur.toLowerCase() ? " st-swatch--on" : "")}
                style={{ background: c, width: "100%", aspectRatio: "1", height: "auto" }} onClick={() => set(c)} />
            ))}
          </div>
        </>
      )}
      {!tft && (
        <p className="st-note" style={{ marginTop: 12 }}>
          {props.mode === "bwr" ? "Cet écran affiche du noir, du blanc et du rouge : c'est tout ce que tu peux poser." : "Cet écran affiche du noir et du blanc : les nuances se font avec les textures."}
        </p>
      )}
    </div>
  );
}

// ─── Brosses ─────────────────────────────────────────────────────────────────

const BRUSHES_BY_BOX: Record<Toolbox, string[]> = {
  essential: ["round", "square"],
  studio: ["round", "square", "pixel", "diamond", "hbar", "vbar", "slash", "bslash"],
  pro: ["round", "square", "pixel", "diamond", "hbar", "vbar", "slash", "bslash", "spray"],
};

export function BrushSection(props: {
  toolbox: Toolbox; brush: string; size: number; texture: string; customBrushes: string[];
  onBrush: (id: string) => void; onAtelier: () => void; onDeleteCustom: (id: string) => void;
}) {
  const ids = BRUSHES_BY_BOX[props.toolbox];
  const label = (id: string) => BRUSH_TYPES.find(b => b.id === id)?.label ?? "Perso";
  const size = Math.max(2, Math.min(props.size, 9));
  return (
    <div>
      <div className="st-grid st-grid--brush">
        {ids.map(id => (
          <button key={id} type="button" className={"st-card" + (props.brush === id ? " st-card--on" : "")} onClick={() => props.onBrush(id)} title={BRUSH_TYPES.find(b => b.id === id)?.hint}>
            <BrushPreview brush={id} size={id === "spray" ? 9 : size} texture={props.texture} w={40} h={20} scale={2} />
            {label(id)}
          </button>
        ))}
        {props.toolbox === "pro" && props.customBrushes.map(id => (
          <div key={id} style={{ position: "relative" }}>
            <button type="button" className={"st-card" + (props.brush === id ? " st-card--on" : "")} onClick={() => props.onBrush(id)} style={{ width: "100%" }}>
              <BrushPreview brush={id} size={9} w={40} h={20} scale={2} />
              Perso
            </button>
            <button type="button" aria-label="Supprimer cette brosse" onClick={() => props.onDeleteCustom(id)}
              style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: 8, border: 0, background: "rgba(0,0,0,0.5)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {props.toolbox === "pro" && (
          <button type="button" className="st-card" onClick={props.onAtelier} style={{ justifyContent: "center", minHeight: 76 }}>
            <Plus size={22} /> Créer une brosse
          </button>
        )}
      </div>
      {props.toolbox !== "pro" && (
        <p className="st-note" style={{ marginTop: 12 }}>
          {props.toolbox === "essential"
            ? "Passe en Studio pour plus de pinceaux, ou en Pro pour créer les tiens."
            : "Passe en Pro pour le spray et pour créer tes propres brosses."}
        </p>
      )}
    </div>
  );
}

// ─── Textures ────────────────────────────────────────────────────────────────

export function TextureSection(props: {
  mode: ColorMode; toolbox: Toolbox; texture: string; opacity: number; customTextures: string[];
  onTexture: (id: string) => void; onOpacity: (v: number) => void; onEditor: () => void; onDeleteCustom: (id: string) => void;
}) {
  const tft = props.mode === "rgb565";
  const densities = TEXTURES.filter(t => DENSITY_TEXTURES.includes(t.id));
  const patterns = TEXTURES.filter(t => !DENSITY_TEXTURES.includes(t.id));
  return (
    <div>
      {tft && (
        <>
          <div className="st-h">Opacité</div>
          <Slider value={props.opacity} min={5} max={100} step={5} label="Opacité" onChange={props.onOpacity} format={v => v + " %"} />
          <p className="st-note">L&apos;écran couleur affiche de vrais mélanges : ce que tu vois est ce qui sera affiché.</p>
        </>
      )}
      <div className="st-h">{tft ? "Textures" : "Densité — les tons de gris de l'écran"}</div>
      <div className="st-grid st-grid--tex">
        {densities.map(t => (
          <button key={t.id} type="button" className={"st-card" + (props.texture === t.id ? " st-card--on" : "")} onClick={() => props.onTexture(t.id)}>
            <TexturePreview texture={t.id} w={26} h={14} scale={2} />
            {t.label}
          </button>
        ))}
      </div>
      {!tft && <p className="st-note" style={{ marginTop: 8 }}>Un écran e-ink/OLED n&apos;a pas de gris : une densité est un motif de points, identique à l&apos;écran physique.</p>}
      <div className="st-h">Motifs</div>
      <div className="st-grid st-grid--tex">
        {patterns.map(t => (
          <button key={t.id} type="button" className={"st-card" + (props.texture === t.id ? " st-card--on" : "")} onClick={() => props.onTexture(t.id)}>
            <TexturePreview texture={t.id} w={26} h={14} scale={2} />
            {t.label}
          </button>
        ))}
        {props.toolbox === "pro" && props.customTextures.map(id => (
          <div key={id} style={{ position: "relative" }}>
            <button type="button" className={"st-card" + (props.texture === id ? " st-card--on" : "")} onClick={() => props.onTexture(id)} style={{ width: "100%" }}>
              <TexturePreview texture={id} w={26} h={14} scale={2} />
              Perso
            </button>
            <button type="button" aria-label="Supprimer ce motif" onClick={() => props.onDeleteCustom(id)}
              style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: 8, border: 0, background: "rgba(0,0,0,0.5)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {props.toolbox === "pro" && (
          <button type="button" className="st-card" onClick={props.onEditor} style={{ justifyContent: "center", minHeight: 62 }}>
            <Plus size={20} /> Créer un motif
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Symétrie ────────────────────────────────────────────────────────────────

export function SymmetrySection(props: {
  toolbox: Toolbox; sym: string; cx: number; cy: number; W: number; H: number;
  onSym: (m: string) => void; onCenter: (cx: number, cy: number) => void;
}) {
  const modes = SYMMETRY_MODES.filter(m => props.toolbox === "pro" || !m.id.startsWith("r"));
  return (
    <div>
      <div className="st-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        {modes.map(m => (
          <button key={m.id || "none"} type="button" className={"st-card" + (props.sym === m.id ? " st-card--on" : "")} onClick={() => props.onSym(m.id)} style={{ flexDirection: "row", justifyContent: "center", minHeight: 48 }}>
            {m.label}
          </button>
        ))}
      </div>
      {props.sym && props.toolbox === "pro" && (
        <>
          <div className="st-h">Position du centre</div>
          {(props.sym === "v" || props.sym === "vh" || props.sym[0] === "r") && (
            <Slider value={props.cx} min={0} max={props.W} step={0.5} label="Centre horizontal" onChange={v => props.onCenter(v, props.cy)} format={v => "x " + v} />
          )}
          {(props.sym === "h" || props.sym === "vh" || props.sym[0] === "r") && (
            <Slider value={props.cy} min={0} max={props.H} step={0.5} label="Centre vertical" onChange={v => props.onCenter(props.cx, v)} format={v => "y " + v} />
          )}
          <button type="button" className="st-chip" style={{ marginTop: 6 }} onClick={() => props.onCenter(props.W / 2, props.H / 2)}>Recentrer</button>
        </>
      )}
      <p className="st-note" style={{ marginTop: 12 }}>Chaque trait est reproduit automatiquement : parfait pour les visages, les motifs, les mandalas.</p>
    </div>
  );
}

// ─── Modèle (image de référence, jamais envoyée) ─────────────────────────────

export function ModelSection(props: {
  model: ModelImage | null; editing: boolean;
  onLoad: () => void; onChange: (m: ModelImage) => void; onRemove: () => void; onEdit: (v: boolean) => void;
}) {
  const m = props.model;
  return (
    <div>
      <div className="st-callout st-callout--info" style={{ marginBottom: 12 }}>
        <Lock size={18} style={{ marginTop: 2 }} />
        <span>Le modèle est un <b>guide pour dessiner par-dessus</b>. Il n&apos;est jamais envoyé, ni inclus dans le dessin ou son replay.</span>
      </div>
      {!m ? (
        <button type="button" className="st-btn st-btn--solid st-btn--big st-btn--block" onClick={props.onLoad}><ImagePlus size={20} /> Choisir une image modèle</button>
      ) : (
        <>
          <div className="st-row" style={{ marginBottom: 10 }}>
            <button type="button" className={"st-chip" + (props.editing ? " st-chip--ok" : "")} onClick={() => props.onEdit(!props.editing)}>
              <Move size={16} /> {props.editing ? "Terminer le placement" : "Placer / redimensionner"}
            </button>
            <button type="button" className="st-chip st-chip--icon" onClick={() => props.onChange({ ...m, visible: !m.visible })} aria-label={m.visible ? "Masquer le modèle" : "Afficher le modèle"}>
              {m.visible ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
            <button type="button" className={"st-chip" + (m.gray ? " st-chip--on" : "")} onClick={() => props.onChange({ ...m, gray: !m.gray })}>Gris</button>
          </div>
          {props.editing && <p className="st-note" style={{ marginBottom: 10 }}>Glisse sur le dessin pour déplacer le modèle, pince avec deux doigts (ou molette) pour l&apos;agrandir.</p>}
          <div className="st-h">Opacité du modèle</div>
          <Slider value={Math.round(m.opacity * 100)} min={10} max={90} step={5} label="Opacité du modèle" onChange={v => props.onChange({ ...m, opacity: v / 100 })} format={v => v + " %"} />
          <div className="st-row" style={{ marginTop: 10 }}>
            <button type="button" className="st-chip" onClick={props.onLoad}><ImagePlus size={16} /> Changer</button>
            <button type="button" className="st-chip st-chip--danger" onClick={props.onRemove}><ImageOff size={16} /> Retirer</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Score ───────────────────────────────────────────────────────────────────

function CheckRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className={"st-check " + (ok ? "st-check--ok" : "st-check--warn")}>
      <span className="st-check__dot">{ok ? <Check size={13} /> : "·"}</span>
      {label}
      <small>{value}</small>
    </div>
  );
}

export function ScoreSection(props: {
  score: number; hints: PodHints; achievements: string[]; toolbox: Toolbox;
  transforms: number; credited: number;
}) {
  const h = props.hints;
  return (
    <div>
      <div className="st-row" style={{ alignItems: "flex-end", gap: 12, marginBottom: 6 }}>
        <div className="st-bignum">{props.score}</div>
        <div className="st-note" style={{ paddingBottom: 6 }}>points de dessin (PoD)</div>
      </div>
      <p className="st-note">
        Chaque geste qui change vraiment l&apos;image rapporte 1 point : trait, remplissage, forme, texte. La gomme et les gestes sans effet valent 0. Déplacer une sélection compte, avec un plafond pour éviter les allers-retours.
        {props.transforms > props.credited ? ` (${props.transforms - props.credited} déplacement(s) non crédités.)` : ""}
      </p>
      <div className="st-h">Preuve de dessin — indicatif</div>
      <CheckRow ok={h.okSession} label="Temps de dessin ≥ 15 s" value={formatTime(Math.floor(h.sessionMs / 1000))} />
      <CheckRow ok={h.okStrokes} label="Au moins 3 traits" value={`${h.strokes}`} />
      <CheckRow ok={h.okCoverage} label="Le dessin occupe l'écran" value={`${Math.round(h.coverage * 100)} %`} />
      <p className="st-note" style={{ marginTop: 6 }}>Ces repères aident le réseau à valider ton dessin. Rien ne t&apos;empêche d&apos;envoyer.</p>
      <div className="st-h"><Trophy size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -1 }} />Techniques débloquées</div>
      <div className="st-badges">
        {ACHIEVEMENTS.map(a => {
          const on = props.achievements.includes(a.id);
          return (
            <div key={a.id} className={"st-badge" + (on ? " st-badge--on" : "")} title={a.hint}>
              {on ? <Sparkles size={15} /> : <Lock size={14} />} {a.label}
            </div>
          );
        })}
      </div>
      {props.toolbox !== "pro" && <p className="st-note" style={{ marginTop: 10 }}>Certaines techniques (dégradé, brosse perso…) se débloquent en boîte à outils Pro.</p>}
    </div>
  );
}

// ─── Aide ────────────────────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="st-kbd">{children}</span>;
}

export function HelpSection() {
  return (
    <div>
      <div className="st-h">Gestes</div>
      <div className="st-helpgrid">
        <div className="st-helprow"><b>1 doigt</b> dessine (hors du cadre : déplace la vue)</div>
        <div className="st-helprow"><b>2 doigts</b> pincer = zoom, glisser = déplacer</div>
        <div className="st-helprow"><b>Stylet</b> dessine ; les doigts ne font que naviguer</div>
        <div className="st-helprow"><b>Précision</b> un curseur décalé + loupe pour viser au pixel</div>
      </div>
      <div className="st-h">Clavier</div>
      <div className="st-helpgrid">
        <div className="st-helprow"><Kbd>B</Kbd><Kbd>E</Kbd><Kbd>F</Kbd><Kbd>U</Kbd><Kbd>I</Kbd><Kbd>M</Kbd><Kbd>T</Kbd> pinceau · gomme · remplir · formes · pipette · sélection · texte</div>
        <div className="st-helprow"><Kbd>L</Kbd><Kbd>R</Kbd><Kbd>O</Kbd> ligne · rectangle · ellipse · <Kbd>Alt</Kbd>+clic pipette</div>
        <div className="st-helprow"><Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> / <Kbd>Y</Kbd> annuler / rétablir</div>
        <div className="st-helprow"><Kbd>[</Kbd><Kbd>]</Kbd> taille · <Kbd>X</Kbd> échanger les couleurs</div>
        <div className="st-helprow"><Kbd>Maj</Kbd> formes contraintes (carré, cercle, 45°)</div>
        <div className="st-helprow"><Kbd>Espace</Kbd> + glisser : déplacer la vue · molette : zoom</div>
        <div className="st-helprow"><Kbd>Entrée</Kbd> valider · <Kbd>Échap</Kbd> annuler · <Kbd>Suppr</Kbd> supprimer la sélection</div>
        <div className="st-helprow"><Kbd>H</Kbd> grille · <Kbd>0</Kbd> ajuster la vue</div>
      </div>
    </div>
  );
}

// ─── Menu ────────────────────────────────────────────────────────────────────

function MenuItem({ icon, label, hint, onClick, danger, toggle }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void; danger?: boolean; toggle?: boolean }) {
  return (
    <button type="button" className={"st-menuitem" + (danger ? " st-menuitem--danger" : "")} onClick={onClick}>
      {icon}
      <span>{label}{hint && <small>{hint}</small>}</span>
      {toggle !== undefined && <span className={"st-switch" + (toggle ? " st-switch--on" : "")} />}
    </button>
  );
}

export function MenuSection(props: {
  toolbox: Toolbox; onToolbox: (t: Toolbox) => void;
  grid: GridSettings; onGrid: (g: GridSettings) => void;
  precision: boolean; onPrecision: (v: boolean) => void;
  penOnly: boolean; onPenOnly: (v: boolean) => void;
  canFullscreen: boolean; isFullscreen: boolean; onFullscreen: () => void;
  onFit: () => void; onRotate: () => void;
  onClear: () => void; onNew: () => void; onModel: () => void; onHelp: () => void; onScore: () => void;
  onExit: () => void; hasContent: boolean; draftSaved: "idle" | "saved" | "error";
  showTexture: boolean; onTexture: () => void; showSym: boolean; onSym: () => void;
}) {
  return (
    <div>
      <div className="st-h">Boîte à outils</div>
      {TOOLBOXES.map(t => (
        <button key={t.id} type="button" className={"st-boxcard" + (props.toolbox === t.id ? " st-boxcard--on" : "")} onClick={() => props.onToolbox(t.id)}>
          <span style={{ display: "inline-block", flex: "none", width: 22, height: 20, color: "var(--st-accent-hi)" }}>{props.toolbox === t.id ? <Check size={20} /> : null}</span>
          <div><b>{t.label}</b><span>{t.tagline}</span></div>
        </button>
      ))}
      <div className="st-h">Affichage</div>
      <div className="st-menu">
        <MenuItem icon={<ScanLine size={20} />} label="Ajuster la vue" hint="Tout le dessin dans l'écran (0)" onClick={props.onFit} />
        <MenuItem icon={<Rotate3d size={20} />} label="Pivoter la vue" hint="Tourner le papier d'un quart de tour" onClick={props.onRotate} />
        <MenuItem icon={<Grid3x3 size={20} />} label="Grille" hint={`Repères tous les ${props.grid.step} px (H)`} toggle={props.grid.show} onClick={() => props.onGrid({ ...props.grid, show: !props.grid.show })} />
        {props.grid.show && (
          <div className="st-row" style={{ padding: "0 12px 8px 44px" }}>
            {[2, 4, 8, 16].map(n => (
              <button key={n} type="button" className={"st-chip" + (props.grid.step === n ? " st-chip--on" : "")} onClick={() => props.onGrid({ ...props.grid, step: n })}>{n} px</button>
            ))}
          </div>
        )}
        {props.canFullscreen && <MenuItem icon={<Maximize size={20} />} label={props.isFullscreen ? "Quitter le plein écran" : "Plein écran"} onClick={props.onFullscreen} />}
      </div>
      <div className="st-h">Précision</div>
      <div className="st-menu">
        <MenuItem icon={<Fingerprint size={20} />} label="Curseur décalé + loupe" hint="Le point de dessin se place au-dessus du doigt" toggle={props.precision} onClick={() => props.onPrecision(!props.precision)} />
        <MenuItem icon={<Smartphone size={20} />} label="Stylet : ignorer les doigts" hint="Dès qu'un stylet est détecté, la paume ne dessine plus" toggle={props.penOnly} onClick={() => props.onPenOnly(!props.penOnly)} />
      </div>
      <div className="st-h">Dessin</div>
      <div className="st-menu">
        <MenuItem icon={<Trophy size={20} />} label="Points & techniques" onClick={props.onScore} />
        <MenuItem icon={<ImagePlus size={20} />} label="Image modèle" hint="Un guide sous ton dessin, jamais envoyé" onClick={props.onModel} />
        <MenuItem icon={<Eraser size={20} />} label="Effacer tout" danger onClick={props.onClear} />
        <MenuItem icon={<FilePlus2 size={20} />} label="Nouveau dessin" danger onClick={props.onNew} />
      </div>
      <div className="st-h">Aide</div>
      <div className="st-menu">
        <MenuItem icon={<Keyboard size={20} />} label="Gestes et raccourcis" onClick={props.onHelp} />
      </div>
      <p className="st-note" style={{ marginTop: 14 }}>
        {props.draftSaved === "saved" ? "✓ Brouillon sauvegardé automatiquement sur cet appareil." : props.draftSaved === "error" ? "⚠ Sauvegarde du brouillon indisponible sur ce navigateur." : "Le brouillon est sauvegardé automatiquement."}
      </p>
    </div>
  );
}

// ─── Atelier de brosses (Pro) ────────────────────────────────────────────────

export function BrushAtelier({ onSave, onClose, capture }: {
  onSave: (id: string) => void; onClose: () => void;
  capture: () => { w: number; h: number; bits: Uint8Array } | null;
}) {
  const [n, setN] = useState(7);
  const [bits, setBits] = useState<Uint8Array>(() => { const b = new Uint8Array(7 * 7); b[24] = 1; return b; });
  const paint = useRef<0 | 1 | null>(null);
  const cell = Math.floor(Math.min(320, typeof window !== "undefined" ? window.innerWidth - 80 : 320) / n);
  const resize = (nn: number) => {
    const nb = new Uint8Array(nn * nn);
    for (let y = 0; y < Math.min(n, nn); y++) for (let x = 0; x < Math.min(n, nn); x++) nb[y * nn + x] = bits[y * n + x];
    setN(nn); setBits(nb);
  };
  const at = (e: React.PointerEvent, root: HTMLElement) => {
    const r = root.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * n), y = Math.floor(((e.clientY - r.top) / r.height) * n);
    return x >= 0 && y >= 0 && x < n && y < n ? y * n + x : -1;
  };
  const apply = (i: number) => {
    const v = paint.current;
    if (i < 0 || v === null) return;
    setBits(b => { if (b[i] === v) return b; const c = b.slice(); c[i] = v; return c; });
  };
  const count = bits.reduce((a, v) => a + v, 0);
  const id = encodeCustomBrush(n, n, bits);
  const cap = capture();
  return (
    <Modal label="Créer une brosse" onClose={onClose}>
      <h3>Créer une brosse</h3>
      <p>Dessine l&apos;empreinte de ta brosse : elle sera posée à chaque pas du trait. Elle est enregistrée dans ton navigateur.</p>
      <div className="st-row st-row--between" style={{ marginBottom: 10 }}>
        <div className="st-seg">
          {[5, 7, 9, 12].map(s => <button key={s} type="button" className={n === s ? "on" : ""} onClick={() => resize(s)}>{s}×{s}</button>)}
        </div>
      </div>
      <div
        className="st-editor" style={{ gridTemplateColumns: `repeat(${n}, ${cell}px)` }}
        onPointerDown={e => { const i = at(e, e.currentTarget); if (i < 0) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ } paint.current = bits[i] ? 0 : 1; apply(i); }}
        onPointerMove={e => { if (paint.current !== null) apply(at(e, e.currentTarget)); }}
        onPointerUp={() => { paint.current = null; }}
        onPointerCancel={() => { paint.current = null; }}
      >
        {Array.from(bits).map((v, i) => <i key={i} className={v ? "on" : ""} style={{ width: cell, height: cell }} />)}
      </div>
      <div className="st-row" style={{ margin: "12px 0", justifyContent: "center" }}>
        <BrushPreview brush={id} size={n} w={70} h={28} scale={2} />
      </div>
      <div className="st-row" style={{ marginBottom: 14 }}>
        <button type="button" className="st-chip" onClick={() => setBits(new Uint8Array(n * n))}>Vider</button>
        <button type="button" className="st-chip" onClick={() => setBits(b => b.map(v => 1 - v) as Uint8Array)}>Inverser</button>
        {cap && <button type="button" className="st-chip" onClick={() => { const nn = Math.max(cap.w, cap.h); if (nn <= 32) { setN(nn); const nb = new Uint8Array(nn * nn); for (let y = 0; y < cap.h; y++) for (let x = 0; x < cap.w; x++) nb[y * nn + x] = cap.bits[y * cap.w + x]; setBits(nb); } }}>Depuis la sélection</button>}
      </div>
      <div className="st-dialog__actions">
        <button type="button" className="st-btn st-btn--solid" onClick={onClose}>Annuler</button>
        <button type="button" className="st-btn st-btn--accent" disabled={count === 0} onClick={() => onSave(id)}>Enregistrer la brosse</button>
      </div>
    </Modal>
  );
}

// ─── Éditeur de motif 8×8 (Pro) ──────────────────────────────────────────────

export function TextureEditor({ initial, onSave, onClose }: { initial: string; onSave: (id: string) => void; onClose: () => void }) {
  const [tile, setTile] = useState<Uint8Array>(() => {
    const t = new Uint8Array(64);
    for (let i = 0; i < 64; i += 3) t[i] = 1;
    return t;
  });
  useEffect(() => { void initial; }, [initial]);
  const paint = useRef<0 | 1 | null>(null);
  const cell = 34;
  const at = (e: React.PointerEvent, root: HTMLElement) => {
    const r = root.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * 8), y = Math.floor(((e.clientY - r.top) / r.height) * 8);
    return x >= 0 && y >= 0 && x < 8 && y < 8 ? y * 8 + x : -1;
  };
  const apply = (i: number) => {
    const v = paint.current;
    if (i < 0 || v === null) return;
    setTile(b => { if (b[i] === v) return b; const c = b.slice(); c[i] = v; return c; });
  };
  const id = customTextureId(tile);
  return (
    <Modal label="Créer un motif" onClose={onClose}>
      <h3>Créer un motif</h3>
      <p>Un carré de 8×8 pixels répété pour remplir : une trame sur mesure. Les pixels noirs seront peints.</p>
      <div
        className="st-editor" style={{ gridTemplateColumns: `repeat(8, ${cell}px)` }}
        onPointerDown={e => { const i = at(e, e.currentTarget); if (i < 0) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ } paint.current = tile[i] ? 0 : 1; apply(i); }}
        onPointerMove={e => { if (paint.current !== null) apply(at(e, e.currentTarget)); }}
        onPointerUp={() => { paint.current = null; }}
        onPointerCancel={() => { paint.current = null; }}
      >
        {Array.from(tile).map((v, i) => <i key={i} className={v ? "on" : ""} style={{ width: cell, height: cell }} />)}
      </div>
      <div className="st-row" style={{ margin: "12px 0", justifyContent: "center" }}>
        <TexturePreview texture={id} w={48} h={20} scale={3} />
      </div>
      <div className="st-row" style={{ marginBottom: 14 }}>
        <button type="button" className="st-chip" onClick={() => setTile(new Uint8Array(64))}>Vider</button>
        <button type="button" className="st-chip" onClick={() => setTile(b => b.map(v => 1 - v) as Uint8Array)}>Inverser</button>
      </div>
      <div className="st-dialog__actions">
        <button type="button" className="st-btn st-btn--solid" onClick={onClose}>Annuler</button>
        <button type="button" className="st-btn st-btn--accent" onClick={() => onSave(id)}>Enregistrer le motif</button>
      </div>
    </Modal>
  );
}

export { isCustomBrush, textureLabel, POD_MIN_COVERAGE, POD_MIN_SESSION_MS, POD_MIN_STROKES };
