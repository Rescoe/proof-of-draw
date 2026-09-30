// lib/drawEngine/session.ts
// Session de dessin : image + historique par deltas + journal d'actions + replay,
// couplés en UNE source de vérité.
//
//   Chaque geste validé est une "entrée" : { action, événements de replay, delta de pixels }.
//   • annuler/rétablir rejouent le delta de l'entrée (jamais de snapshot d'image) ;
//   • le replay envoyé = les événements des entrées actuellement appliquées ;
//   • le journal d'actions = tout ce qui s'est passé (annuler/rétablir compris).
//   Il est donc impossible d'avoir une image que le replay ne sait pas reconstruire.
//
// Aucune dépendance au DOM : la session est pilotée par l'interface (pointer
// events → appels de méthodes) ou par les tests.

import type { ActionEvent, ReplayEvent, SelectionDesc } from "@/lib/types/actions";
import { Bitmap, Delta, Txn, applyDelta, deltaBytes } from "./bitmap";
import { Color, ColorMode, WHITE, fromHex, snapColor } from "./color";
import {
  EngineCfg, ShapeCfg, StrokeRunner, Surface, clearAll, drawShape, fillRegion, gradientRegion,
  makeInk, shapeCfgFromEvent, strokeCfgFromEvent,
} from "./ops";
import { Pt, SymCfg } from "./raster";
import { Mat, MAT_IDENTITY, Sel, resolveSelection, transformSelection, transformedBounds } from "./selection";
import { scoreActions } from "./scoring";
import { drawText } from "./text";

// ─── Réglages transmis par l'interface ───────────────────────────────────────

export interface StrokeSettings {
  erase: boolean;
  brush: string;
  size: number;
  color: string;      // #rrggbb
  opacity: number;    // 1..100 (RGB565 seulement)
  texture: string;
  sym: SymCfg | null;
  pixelPerfect: boolean;
}

export interface ShapeSettings {
  shape: "line" | "rect" | "ellipse" | "poly";
  brush: string;
  size: number;
  color: string;
  opacity: number;
  texture: string;
  fill: boolean;
  fromCenter: boolean;
  sym: SymCfg | null;
}

export interface FillSettings {
  color: string;
  opacity: number;
  texture: string;
  global: boolean;
}

export interface GradientSettings {
  color: string;
  color2: string;
  global: boolean;
}

export interface TextSettings {
  color: string;
  scale: number;
  opacity: number;
  texture: string;
}

// ─── Entrées d'historique ────────────────────────────────────────────────────

export interface HistoryEntry {
  frame: number;
  action: ActionEvent;
  replay: ReplayEvent[];
  delta: Delta | null;   // null = entrée "figée" (delta purgé pour économiser la mémoire)
}

export interface SessionSnapshot {
  version: 1;
  width: number;
  height: number;
  mode: ColorMode;
  background: Color;
  frames: Uint32Array[];
  cursor: number;
  log: ActionEvent[];
  entries: HistoryEntry[];
}

type ActiveOp =
  | { kind: "stroke"; id: number; txn: Txn; runner: StrokeRunner; events: ReplayEvent[]; lastT: number; last: Pt; s: StrokeSettings }
  | { kind: "shape"; txn: Txn; s: ShapeSettings; t0: number; a: Pt; b: Pt; pts?: number[] }
  | { kind: "float"; txn: Txn; sel: Sel; desc: SelectionDesc; state: { m: Mat; dx: number; dy: number; copy: boolean } };

const MAX_HISTORY_BYTES = 24 * 1024 * 1024;
const MAX_ENTRIES = 800;

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export class DrawSession {
  readonly cfg: EngineCfg;
  frames: Bitmap[];
  /** Intervalle minimal entre deux points de trait enregistrés (ms) — voir analyzeReplay/automationRatio. */
  minMoveMs = 16;
  /** Incrémenté à chaque modification visible de l'image (pour rafraîchir l'affichage). */
  revision = 0;

  private entries: HistoryEntry[] = [];
  private cursor = 0;
  private log: ActionEvent[] = [];
  private op: ActiveOp | null = null;
  private sel: { sel: Sel; desc: SelectionDesc } | null = null;
  private listeners = new Set<() => void>();
  private scoreMemo: { len: number; value: number } = { len: -1, value: 0 };

  constructor(cfg: { width: number; height: number; mode: ColorMode; background?: Color }) {
    this.cfg = { width: cfg.width, height: cfg.height, mode: cfg.mode, background: cfg.background ?? WHITE };
    this.frames = [new Bitmap(cfg.width, cfg.height, this.cfg.background)];
  }

  // ── Lecture ────────────────────────────────────────────────────────────────
  get bitmap(): Bitmap { return this.frames[0]; }
  get canUndo(): boolean { return this.cursor > 0 && this.entries[this.cursor - 1].delta !== null; }
  get canRedo(): boolean { return this.cursor < this.entries.length; }
  get busy(): boolean { return this.op !== null; }
  get actionCount(): number { return this.log.length; }
  get appliedCount(): number { return this.cursor; }

  get score(): number {
    if (this.scoreMemo.len !== this.log.length) {
      this.scoreMemo = { len: this.log.length, value: scoreActions(this.getActions()) };
    }
    return this.scoreMemo.value;
  }

  /** Journal d'actions complet, marqué v2 (annuler/rétablir compris). */
  getActions(): ActionEvent[] {
    if (this.log.length === 0) return [];
    const out = this.log.map(a => ({ ...a }));
    out[0] = { ...out[0], v: 2 };
    return out;
  }

  /** Replay : événements des gestes actuellement appliqués, marqué v2. */
  getReplay(): ReplayEvent[] {
    const out: ReplayEvent[] = [];
    for (let i = 0; i < this.cursor; i++) for (const ev of this.entries[i].replay) out.push({ ...ev });
    if (out.length) out[0] = { ...out[0], v: 2 };
    return out;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private notify() { for (const fn of this.listeners) fn(); }

  pick(p: Pt): Color {
    const q = this.clamp(p);
    return this.bitmap.get(q.x, q.y);
  }

  private clamp(p: Pt): Pt {
    return { x: clampInt(p.x, 0, this.cfg.width - 1), y: clampInt(p.y, 0, this.cfg.height - 1) };
  }

  private surface(txn: Txn): Surface {
    return { bmp: this.bitmap, txn, mode: this.cfg.mode };
  }

  // ── Historique ─────────────────────────────────────────────────────────────
  private pushEntry(action: ActionEvent, replay: ReplayEvent[], delta: Delta) {
    this.entries.length = this.cursor;   // un nouveau geste efface la pile "rétablir"
    this.entries.push({ frame: 0, action, replay, delta });
    this.cursor = this.entries.length;
    this.log.push(action);
    this.sel = null;
    this.prune();
    this.revision++;
    this.notify();
  }

  private prune() {
    if (this.entries.length > MAX_ENTRIES) {
      const extra = this.entries.length - MAX_ENTRIES;
      for (let i = 0; i < extra; i++) this.entries[i].delta = null;
    }
    let bytes = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const d = this.entries[i].delta;
      if (!d) break;
      bytes += deltaBytes(d);
      if (bytes > MAX_HISTORY_BYTES) {
        for (let k = i; k >= 0 && this.entries[k].delta; k--) this.entries[k].delta = null;
        break;
      }
    }
  }

  undo(t: number): boolean {
    this.cancelOp();
    if (!this.canUndo) return false;
    const e = this.entries[this.cursor - 1];
    applyDelta(this.frames[e.frame], e.delta!, "undo");
    this.cursor--;
    this.log.push({ kind: "undo", t });
    this.sel = null;
    this.revision++;
    this.notify();
    return true;
  }

  redo(t: number): boolean {
    this.cancelOp();
    if (!this.canRedo) return false;
    const e = this.entries[this.cursor];
    if (!e.delta) return false;
    applyDelta(this.frames[e.frame], e.delta, "redo");
    this.cursor++;
    this.log.push({ kind: "redo", t });
    this.sel = null;
    this.revision++;
    this.notify();
    return true;
  }

  // ── Tracé à main levée ─────────────────────────────────────────────────────
  hasStroke(id: number): boolean { return this.op?.kind === "stroke" && this.op.id === id; }

  beginStroke(id: number, p0: Pt, t: number, s: StrokeSettings) {
    this.cancelOp();
    const p = this.clamp(p0);
    const ev: ReplayEvent = { kind: "down", t, x: p.x, y: p.y, id, tool: s.erase ? "eraser" : "brush", color: s.color, size: s.size };
    if (s.brush !== "round") ev.br = s.brush;
    if (s.texture !== "solid") ev.tx = s.texture;
    if (this.cfg.mode === "rgb565" && s.opacity < 100) ev.op = Math.round(s.opacity);
    if (s.pixelPerfect) ev.pp = 1;
    if (s.brush === "spray") ev.sd = (Math.imul(t | 0, 2654435761) ^ Math.imul(this.entries.length + 1, 40503)) >>> 0;
    this.addSym(ev, s.sym);
    const txn = new Txn(this.bitmap);
    const runner = new StrokeRunner(this.surface(txn), strokeCfgFromEvent(ev, this.cfg));
    runner.down(p);
    this.op = { kind: "stroke", id, txn, runner, events: [ev], lastT: t, last: p, s };
    this.revision++;
  }

  /** Ajoute un point au trait. Retourne false si le point est ignoré (cadence trop rapide / identique). */
  moveStroke(id: number, p0: Pt, t: number): boolean {
    const op = this.op;
    if (!op || op.kind !== "stroke" || op.id !== id) return false;
    const p = this.clamp(p0);
    if (p.x === op.last.x && p.y === op.last.y) return false;
    if (t - op.lastT < this.minMoveMs) return false;
    op.runner.move(p);
    op.events.push({ kind: "move", t, x: p.x, y: p.y, id });
    op.lastT = t;
    op.last = p;
    this.revision++;
    return true;
  }

  /** Clôt le trait. Retourne true si un geste a été enregistré. */
  endStroke(id: number, p0: Pt, t: number): boolean {
    const op = this.op;
    if (!op || op.kind !== "stroke" || op.id !== id) return false;
    const p = this.clamp(p0);
    op.runner.move(p);
    op.runner.finish();
    op.events.push({ kind: "up", t, x: p.x, y: p.y, id });
    this.op = null;
    const delta = op.txn.commit(0);
    this.revision++;
    if (!delta) { this.notify(); return false; }   // trait sans effet : ni entrée, ni point
    const s = op.s;
    const action: ActionEvent = { kind: s.erase ? "erase" : "stroke", t, tool: s.erase ? "eraser" : "brush", color: s.erase ? "#FFFFFF" : s.color, sz: s.size, n: delta.idx.length };
    if (s.brush !== "round") action.br = s.brush;
    if (s.texture !== "solid") action.tx = s.texture;
    if (s.sym && s.sym.m) action.sy = s.sym.m;
    if (this.cfg.mode === "rgb565" && s.opacity < 100) action.op = Math.round(s.opacity);
    this.pushEntry(action, op.events, delta);
    return true;
  }

  cancelStroke(id: number) {
    if (this.op?.kind === "stroke" && this.op.id === id) this.cancelOp();
  }

  // ── Formes (aperçu en direct, puis validation) ──────────────────────────────
  get hasShape(): boolean { return this.op?.kind === "shape"; }

  /** Démarre/actualise l'aperçu d'une forme. L'aperçu est écrit dans l'image (WYSIWYG) et annulable. */
  previewShape(s: ShapeSettings, a0: Pt, b0: Pt, t: number, pts?: number[]) {
    const a = this.clamp(a0), b = this.clamp(b0);
    let op = this.op;
    if (op && op.kind !== "shape") { this.cancelOp(); op = null; }
    if (!op) {
      op = { kind: "shape", txn: new Txn(this.bitmap), s, t0: t, a, b, pts };
      this.op = op;
    } else {
      op.txn.rollback();
    }
    op.s = s; op.a = a; op.b = b; op.pts = pts;
    drawShape(this.surface(op.txn), this.shapeCfg(op));
    this.revision++;
  }

  private shapeCfg(op: Extract<ActiveOp, { kind: "shape" }>): ShapeCfg {
    const ev = this.shapeEvent(op, op.t0);
    return shapeCfgFromEvent(ev, this.cfg);
  }

  private shapeEvent(op: Extract<ActiveOp, { kind: "shape" }>, t: number): ReplayEvent {
    const s = op.s;
    const ev: ReplayEvent = {
      kind: "shape", t, x: op.a.x, y: op.a.y, x2: op.b.x, y2: op.b.y, tool: s.shape, shapeType: s.shape,
      color: s.color, size: s.size,
    };
    if (s.brush !== "round") ev.br = s.brush;
    if (s.texture !== "solid") ev.tx = s.texture;
    if (this.cfg.mode === "rgb565" && s.opacity < 100) ev.op = Math.round(s.opacity);
    if (s.fill) ev.fl = 1;
    if (s.fromCenter) ev.fc = 1;
    if (op.pts && op.pts.length) ev.pts = op.pts.slice();
    this.addSym(ev, s.sym);
    return ev;
  }

  commitShape(t: number): boolean {
    const op = this.op;
    if (!op || op.kind !== "shape") return false;
    this.op = null;
    const delta = op.txn.commit(0);
    if (!delta) { this.revision++; this.notify(); return false; }
    const ev = this.shapeEvent(op, t);
    const s = op.s;
    const action: ActionEvent = { kind: "shape", t, tool: s.shape, color: s.color, sz: s.size, n: delta.idx.length };
    if (s.texture !== "solid") action.tx = s.texture;
    if (s.sym && s.sym.m) action.sy = s.sym.m;
    if (this.cfg.mode === "rgb565" && s.opacity < 100) action.op = Math.round(s.opacity);
    this.pushEntry(action, [ev], delta);
    return true;
  }

  cancelShape() {
    if (this.op?.kind === "shape") this.cancelOp();
  }

  // ── Remplissage, dégradé, effacement, texte ─────────────────────────────────
  fill(p0: Pt, t: number, s: FillSettings): boolean {
    this.cancelOp();
    const p = this.clamp(p0);
    const ev: ReplayEvent = { kind: "fill", t, x: p.x, y: p.y, tool: "fill", color: s.color };
    if (s.texture !== "solid") ev.tx = s.texture;
    if (this.cfg.mode === "rgb565" && s.opacity < 100) ev.op = Math.round(s.opacity);
    if (s.global) ev.gl = 1;
    const txn = new Txn(this.bitmap);
    const ink = makeInk(s.color, this.cfg.mode, s.opacity, s.texture);
    fillRegion(this.surface(txn), ink, p.x, p.y, s.global);
    const delta = txn.commit(0);
    this.revision++;
    if (!delta) { this.notify(); return false; }
    const action: ActionEvent = { kind: "fill", t, tool: "fill", color: s.color, n: delta.idx.length };
    if (s.texture !== "solid") action.tx = s.texture;
    if (this.cfg.mode === "rgb565" && s.opacity < 100) action.op = Math.round(s.opacity);
    this.pushEntry(action, [ev], delta);
    return true;
  }

  gradientFill(a0: Pt, b0: Pt, t: number, s: GradientSettings): boolean {
    this.cancelOp();
    const a = this.clamp(a0), b = this.clamp(b0);
    const ev: ReplayEvent = { kind: "grad", t, x: a.x, y: a.y, x2: b.x, y2: b.y, tool: "gradient", color: s.color, c2: s.color2 };
    if (s.global) ev.gl = 1;
    const txn = new Txn(this.bitmap);
    gradientRegion(this.surface(txn), this.cfg.mode, snapColor(fromHex(s.color), this.cfg.mode), snapColor(fromHex(s.color2), this.cfg.mode), a, b, s.global);
    const delta = txn.commit(0);
    this.revision++;
    if (!delta) { this.notify(); return false; }
    this.pushEntry({ kind: "fill", t, tool: "gradient", color: s.color, n: delta.idx.length }, [ev], delta);
    return true;
  }

  clear(t: number): boolean {
    this.cancelOp();
    const txn = new Txn(this.bitmap);
    clearAll(this.surface(txn), this.cfg.background);
    const delta = txn.commit(0);
    this.revision++;
    if (!delta) { this.notify(); return false; }
    this.pushEntry({ kind: "clear", t, tool: "clear", color: "#FFFFFF", n: delta.idx.length }, [{ kind: "clear", t, x: 0, y: 0, tool: "clear" }], delta);
    return true;
  }

  text(p0: Pt, str: string, t: number, s: TextSettings): boolean {
    this.cancelOp();
    const p = this.clamp(p0);
    const ev: ReplayEvent = { kind: "text", t, x: p.x, y: p.y, tool: "text", color: s.color, s: str.slice(0, 120), sc: s.scale };
    if (s.texture !== "solid") ev.tx = s.texture;
    if (this.cfg.mode === "rgb565" && s.opacity < 100) ev.op = Math.round(s.opacity);
    const txn = new Txn(this.bitmap);
    drawText(this.surface(txn), makeInk(s.color, this.cfg.mode, s.opacity, s.texture), p, ev.s!, s.scale);
    const delta = txn.commit(0);
    this.revision++;
    if (!delta) { this.notify(); return false; }
    const action: ActionEvent = { kind: "text", t, tool: "text", color: s.color, sz: s.scale, n: delta.idx.length };
    if (s.texture !== "solid") action.tx = s.texture;
    this.pushEntry(action, [ev], delta);
    return true;
  }

  // ── Sélection & déplacement ────────────────────────────────────────────────
  /** Sélectionne une région (aucun pixel n'est modifié). Retourne son cadre, ou null si vide. */
  selectRegion(desc: SelectionDesc): { x: number; y: number; w: number; h: number } | null {
    this.cancelOp();
    const sel = resolveSelection(this.bitmap, desc);
    if (!sel) { this.sel = null; this.revision++; this.notify(); return null; }
    this.sel = { sel, desc };
    this.revision++;
    this.notify();
    return { x: sel.x, y: sel.y, w: sel.w, h: sel.h };
  }

  get selection(): { sel: Sel; desc: SelectionDesc } | null { return this.sel; }

  clearSelection() {
    if (this.op?.kind === "float") this.cancelOp();
    if (this.sel) { this.sel = null; this.revision++; this.notify(); }
  }

  get floating(): { m: Mat; dx: number; dy: number; copy: boolean; bounds: { x: number; y: number; w: number; h: number } } | null {
    if (this.op?.kind !== "float") return null;
    const st = this.op.state;
    return { ...st, bounds: transformedBounds(this.op.sel, st) };
  }

  /** Modifie la transformation de la sélection (déplacement, retournement, copie…) avec aperçu en direct. */
  floatUpdate(patch: Partial<{ m: Mat; dx: number; dy: number; copy: boolean }>): boolean {
    if (!this.sel) return false;
    if (!this.op) {
      const fresh = resolveSelection(this.bitmap, this.sel.desc);
      if (!fresh) return false;
      this.op = { kind: "float", txn: new Txn(this.bitmap), sel: fresh, desc: this.sel.desc, state: { m: MAT_IDENTITY, dx: 0, dy: 0, copy: false } };
    }
    const op = this.op;
    if (op.kind !== "float") return false;
    op.state = { ...op.state, ...patch };
    op.txn.rollback();
    transformSelection(this.surface(op.txn), op.sel, this.cfg.background, { ...op.state, del: false });
    this.revision++;
    return true;
  }

  /** Valide la transformation en cours : un seul geste d'historique. */
  floatCommit(t: number): boolean {
    const op = this.op;
    if (!op || op.kind !== "float") return false;
    this.op = null;
    const delta = op.txn.commit(0);
    this.revision++;
    if (!delta) { this.notify(); return false; }
    const ev: ReplayEvent = { kind: "sel", t, x: op.sel.x, y: op.sel.y, tool: "select", sel: op.desc };
    if (op.state.m.some((v, i) => v !== MAT_IDENTITY[i])) ev.m = op.state.m;
    if (op.state.dx) ev.dx = op.state.dx;
    if (op.state.dy) ev.dy = op.state.dy;
    if (op.state.copy) ev.cp = 1;
    this.pushEntry({ kind: "transform", t, tool: "select", n: delta.idx.length }, [ev], delta);
    return true;
  }

  floatCancel() {
    if (this.op?.kind === "float") this.cancelOp();
  }

  /** Supprime le contenu de la sélection (remplace par le fond). */
  deleteSelection(t: number): boolean {
    if (!this.sel) return false;
    this.cancelOp();
    const fresh = resolveSelection(this.bitmap, this.sel.desc);
    if (!fresh) return false;
    const txn = new Txn(this.bitmap);
    transformSelection(this.surface(txn), fresh, this.cfg.background, { m: MAT_IDENTITY, dx: 0, dy: 0, copy: false, del: true });
    const delta = txn.commit(0);
    const desc = this.sel.desc;
    this.revision++;
    if (!delta) { this.notify(); return false; }
    this.pushEntry({ kind: "erase", t, tool: "select", n: delta.idx.length }, [{ kind: "sel", t, x: fresh.x, y: fresh.y, tool: "select", sel: desc, dl: 1 }], delta);
    return true;
  }

  // ── Annulation d'un geste en cours ─────────────────────────────────────────
  cancelOp() {
    const op = this.op;
    if (!op) return;
    op.txn.rollback();
    this.op = null;
    this.revision++;
  }

  // ── Persistance du brouillon ───────────────────────────────────────────────
  snapshot(): SessionSnapshot {
    this.cancelOp();
    return {
      version: 1,
      width: this.cfg.width, height: this.cfg.height, mode: this.cfg.mode, background: this.cfg.background,
      frames: this.frames.map(f => f.data.slice()),
      cursor: this.cursor,
      log: this.log.map(a => ({ ...a })),
      entries: this.entries.map(e => ({ frame: e.frame, action: { ...e.action }, replay: e.replay.map(ev => ({ ...ev })), delta: e.delta })),
    };
  }

  static restore(snap: SessionSnapshot): DrawSession {
    const s = new DrawSession({ width: snap.width, height: snap.height, mode: snap.mode, background: snap.background });
    s.frames = snap.frames.map(d => new Bitmap(snap.width, snap.height, snap.background, d.slice()));
    s.entries = snap.entries.map(e => ({ frame: e.frame, action: e.action, replay: e.replay, delta: e.delta }));
    s.cursor = snap.cursor;
    s.log = snap.log;
    s.revision = 1;
    return s;
  }

  // ── Utilitaires ────────────────────────────────────────────────────────────
  private addSym(ev: ReplayEvent, sym: SymCfg | null) {
    if (sym && sym.m) { ev.sy = sym.m; ev.cx = sym.cx; ev.cy = sym.cy; }
  }
}
