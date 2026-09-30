"use client";
// app/draw/_studio/Stage.tsx
// Scène de dessin : canvas pixel-exact + calque de guides (espace écran) + gestes.
//
//  • 1 doigt / souris / stylet : dessine (ou déplace la vue s'il commence hors du canvas)
//  • 2 doigts : zoom + déplacement (annule un début de trait fait en posant les doigts)
//  • molette : zoom ; Espace/clic milieu : déplacer ; Maj : contraindre les formes
//  • stylet détecté : les doigts ne dessinent plus (rejet de la paume), ils servent aux gestes
//  • pointercancel / lostpointercapture : le geste en cours est annulé proprement
// Une seule convention d'activation : les actions ponctuelles se valident au relâchement.

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef,
} from "react";
import { DrawSession, Pt, anchorX, anchorY, brushMask, measureText, selectionEdges } from "@/lib/drawEngine";
import type { GridSettings, ModelImage, ToolId, ToolSettings } from "./types";
import type { SessionClock } from "./storage";
import {
  View, MAX_SCALE, MIN_SCALE, clampView, cssTransform, fitView, rotateViewCw, toScreen, toWorld, zoomAt,
} from "./view";
import {
  constrainPoint, fillSettings, gradientSettings, shapeSettings, strokeSettings,
} from "./settings";

export interface StageApi {
  fit(): void;
  zoomBy(factor: number): void;
  rotate(): void;
  /** Remet la vue à l'endroit (rotation 0°). */
  resetRotation(): void;
  invalidate(): void;
  polyCommit(): boolean;
  polyCancel(): void;
  getView(): View;
}

export interface StageProps {
  session: DrawSession;
  clock: SessionClock;
  tool: ToolId;
  cfgRef: React.MutableRefObject<ToolSettings>;
  grid: GridSettings;
  frameLabel: string;
  model: ModelImage | null;
  modelEdit: boolean;
  onModelChange: (m: ModelImage) => void;
  panelOpen: boolean;
  onDismissPanel: () => void;
  penOnly: boolean;
  onPickColor: (hex: string) => void;
  onSelectionChange: () => void;
  onFloatCommit: () => void;
  onTextPoint: (p: Pt) => void;
  textDraft: { p: Pt; str: string; scale: number } | null;
  onPolyCount: (n: number) => void;
  onViewChange: (info: { scale: number; fitted: boolean; rot: number }) => void;
  onHover: (p: Pt | null) => void;
  onHint: (msg: string) => void;
}

interface Ptr { id: number; x: number; y: number; type: string; sx: number; sy: number; t0: number }

type DrawState =
  | { kind: "stroke"; id: number; erase: boolean; stab: { x: number; y: number } | null; t0: number; moved: number }
  | { kind: "shape"; id: number; a: Pt; b: Pt }
  | { kind: "fill"; id: number; a: Pt; b: Pt; moved: boolean }
  | { kind: "pick"; id: number }
  | { kind: "poly"; id: number }
  | { kind: "selrect"; id: number; a: Pt; b: Pt }
  | { kind: "lasso"; id: number; pts: number[] }
  | { kind: "selwand"; id: number; a: Pt }
  | { kind: "selmove"; id: number; start: Pt; baseDx: number; baseDy: number }
  | { kind: "text"; id: number }
  | { kind: "model"; id: number; last: { x: number; y: number } };

const GRACE_MS = 380;          // délai pendant lequel un 2e doigt transforme un trait en geste
const OFFSET_PX = 68;          // curseur déporté au-dessus du doigt (mode précision)
const STAB_K = [1, 0.6, 0.42, 0.3, 0.21, 0.15, 0.1];

export const Stage = forwardRef<StageApi, StageProps>(function Stage(props, ref) {
  const { session } = props;
  const W = session.cfg.width, H = session.cfg.height;

  const P = useRef(props);
  P.current = props;

  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);

  const viewRef = useRef<View>({ s: 2, tx: 0, ty: 0, rot: 0 });
  const fittedRef = useRef(true);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const ptrs = useRef(new Map<number, Ptr>());
  const modeRef = useRef<"idle" | "draw" | "gesture" | "pan" | "ignore">("idle");
  const drawRef = useRef<DrawState | null>(null);
  const gestRef = useRef<{ d0: number; mx0: number; my0: number; view0: View } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const penSeen = useRef(false);
  const shiftHeld = useRef(false);
  const spaceDown = useRef(false);
  const hover = useRef<Pt | null>(null);
  const cursorPt = useRef<{ p: Pt; sx: number; sy: number } | null>(null);   // point actif tactile (déporté)
  const polyPts = useRef<number[]>([]);
  const dirty = useRef({ main: true, overlay: true });
  const rafId = useRef(0);
  const imgRef = useRef<ImageData | null>(null);
  const modelDrag = useRef<{ view0: { x: number; y: number; w: number; h: number }; d0: number; mx0: number; my0: number } | null>(null);

  // ─── Rendu ─────────────────────────────────────────────────────────────────
  const invalidate = useCallback((main = true, overlay = true) => {
    if (main) dirty.current.main = true;
    if (overlay) dirty.current.overlay = true;
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0;
      if (dirty.current.main) { dirty.current.main = false; renderMain(); }
      if (dirty.current.overlay) { dirty.current.overlay = false; renderOverlay(); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderMain = () => {
    const canvas = mainRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bmp = P.current.session.bitmap;
    if (!imgRef.current || imgRef.current.width !== bmp.w || imgRef.current.height !== bmp.h) {
      imgRef.current = new ImageData(bmp.toRGBA(), bmp.w, bmp.h);
    } else if (imgRef.current.data.buffer !== bmp.data.buffer) {
      imgRef.current = new ImageData(bmp.toRGBA(), bmp.w, bmp.h);
    }
    ctx.putImageData(imgRef.current, 0, 0);
  };

  const applyView = (v: View, report = true) => {
    viewRef.current = v;
    const w = worldRef.current;
    if (w) w.style.transform = cssTransform(v);
    dirty.current.overlay = true;
    invalidate(false, true);
    if (report) P.current.onViewChange({ scale: v.s, fitted: fittedRef.current, rot: v.rot });
  };

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    fittedRef.current = true;
    applyView(fitView(w, h, W, H, viewRef.current.rot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H]);

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy(factor: number) {
      const { w, h } = sizeRef.current;
      fittedRef.current = false;
      applyView(clampView(zoomAt(viewRef.current, factor, w / 2, h / 2), w, h, W, H));
    },
    rotate() {
      const { w, h } = sizeRef.current;
      fittedRef.current = true;
      applyView(rotateViewCw(viewRef.current, w, h, W, H));
    },
    resetRotation() {
      const { w, h } = sizeRef.current;
      fittedRef.current = true;
      applyView(fitView(w, h, W, H, 0));
    },
    invalidate: () => invalidate(true, true),
    polyCommit() {
      const s = P.current.session;
      if (!s.hasShape) return false;
      const ok = s.commitShape(P.current.clock.now());
      polyPts.current = [];
      P.current.onPolyCount(0);
      invalidate();
      return ok;
    },
    polyCancel() {
      P.current.session.cancelShape();
      polyPts.current = [];
      P.current.onPolyCount(0);
      invalidate();
    },
    getView: () => viewRef.current,
  }), [fit, invalidate, W, H]);

  // Taille de la scène (ResizeObserver) + canvas de guides à la densité de l'écran
  useLayoutEffect(() => {
    const el = stageRef.current, ov = overlayRef.current;
    if (!el || !ov) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const first = sizeRef.current.w === 0;
      sizeRef.current = { w: r.width, h: r.height, dpr };
      ov.width = Math.max(1, Math.round(r.width * dpr));
      ov.height = Math.max(1, Math.round(r.height * dpr));
      ov.style.width = r.width + "px";
      ov.style.height = r.height + "px";
      if (first || fittedRef.current) fit();
      else applyView(clampView(viewRef.current, r.width, r.height, W, H));
      invalidate();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H]);

  // Rafraîchit le canvas quand la session change (annuler, rétablir, restauration…)
  useEffect(() => {
    imgRef.current = null;
    invalidate();
    return session.subscribe(() => { invalidate(); P.current.onSelectionChange(); });
  }, [session, invalidate]);

  useEffect(() => { invalidate(false, true); }, [props.grid, props.tool, props.frameLabel, props.textDraft, props.model, props.modelEdit, invalidate]);

  // "Fourmis marchantes" : animation légère tant qu'une sélection existe
  useEffect(() => {
    const id = window.setInterval(() => {
      if (P.current.session.selection) invalidate(false, true);
    }, 130);
    return () => window.clearInterval(id);
  }, [invalidate]);

  useEffect(() => () => { if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = 0; } }, []);

  // ─── Coordonnées ───────────────────────────────────────────────────────────
  const stagePoint = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const toCanvasPt = (sx: number, sy: number): { p: Pt; inside: boolean; fx: number; fy: number } => {
    const w = toWorld(viewRef.current, sx, sy);
    const inside = w.x >= -0.5 && w.y >= -0.5 && w.x <= W + 0.5 && w.y <= H + 0.5;
    return {
      p: { x: Math.max(0, Math.min(W - 1, Math.floor(w.x))), y: Math.max(0, Math.min(H - 1, Math.floor(w.y))) },
      inside, fx: w.x, fy: w.y,
    };
  };

  /** Point actif d'un pointeur : décalé au-dessus du doigt en mode précision. */
  const activePoint = (ptr: Ptr) => {
    const offset = P.current.cfgRef.current.precision && ptr.type === "touch" ? OFFSET_PX : 0;
    const sx = ptr.x, sy = ptr.y - offset;
    const c = toCanvasPt(sx, sy);
    return { ...c, sx, sy };
  };

  // ─── Loupe ─────────────────────────────────────────────────────────────────
  const showLoupe = (pt: Pt | null, sx: number, sy: number) => {
    const el = loupeRef.current, main = mainRef.current;
    if (!el) return;
    if (!pt || !main) { el.style.display = "none"; return; }
    const size = 104, half = 6;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    el.style.display = "block";
    const { w } = sizeRef.current;
    const lx = Math.max(4, Math.min(w - size - 4, sx - size / 2));
    const ly = sy - size - 26 < 4 ? sy + 60 : sy - size - 26;
    el.style.left = lx + "px";
    el.style.top = ly + "px";
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(main, pt.x - half, pt.y - half, half * 2 + 1, half * 2 + 1, 0, 0, size, size);
    const cell = size / (half * 2 + 1);
    ctx.strokeStyle = "#7c6bff";
    ctx.lineWidth = 2;
    ctx.strokeRect(half * cell + 1, half * cell + 1, cell - 2, cell - 2);
  };

  // ─── Début / fin de geste ──────────────────────────────────────────────────
  const beginDraw = (ptr: Ptr) => {
    const { tool, session: s, clock } = P.current;
    const cfg = P.current.cfgRef.current;
    const a = activePoint(ptr);
    const t = clock.now();

    if (P.current.modelEdit) {
      drawRef.current = { kind: "model", id: ptr.id, last: { x: ptr.x, y: ptr.y } };
      modeRef.current = "draw";
      return;
    }
    if (!a.inside) {            // hors du canvas : un doigt déplace la vue
      modeRef.current = "pan";
      panRef.current = { x: ptr.x, y: ptr.y };
      return;
    }
    modeRef.current = "draw";
    cursorPt.current = { p: a.p, sx: a.sx, sy: a.sy };
    if (P.current.textDraft) {
      drawRef.current = { kind: "text", id: ptr.id };
      P.current.onTextPoint(a.p);
      return;
    }

    switch (tool) {
      case "brush":
      case "eraser": {
        const erase = tool === "eraser";
        s.beginStroke(ptr.id, a.p, t, strokeSettings(cfg, erase, W, H));
        const stab = cfg.stabilizer > 0 && !erase ? { x: a.fx, y: a.fy } : null;
        drawRef.current = { kind: "stroke", id: ptr.id, erase, stab, t0: performance.now(), moved: 0 };
        break;
      }
      case "fill":
        drawRef.current = { kind: "fill", id: ptr.id, a: a.p, b: a.p, moved: false };
        break;
      case "eyedropper":
        drawRef.current = { kind: "pick", id: ptr.id };
        if (ptr.type === "touch") showLoupe(a.p, a.sx, a.sy);
        break;
      case "shape":
        if (cfg.shape === "poly") drawRef.current = { kind: "poly", id: ptr.id };
        else {
          s.previewShape(shapeSettings(cfg, W, H), a.p, a.p, t);
          drawRef.current = { kind: "shape", id: ptr.id, a: a.p, b: a.p };
        }
        break;
      case "select": {
        const sel = s.selection, fl = s.floating;
        const b = fl ? fl.bounds : sel ? { x: sel.sel.x, y: sel.sel.y, w: sel.sel.w, h: sel.sel.h } : null;
        const inBox = b && a.p.x >= b.x && a.p.y >= b.y && a.p.x < b.x + b.w && a.p.y < b.y + b.h;
        if (inBox) {
          drawRef.current = { kind: "selmove", id: ptr.id, start: a.p, baseDx: fl ? fl.dx : 0, baseDy: fl ? fl.dy : 0 };
        } else {
          if (fl) P.current.onFloatCommit();
          if (sel) s.clearSelection();
          P.current.onSelectionChange();
          if (cfg.selectKind === "rect") drawRef.current = { kind: "selrect", id: ptr.id, a: a.p, b: a.p };
          else if (cfg.selectKind === "lasso") drawRef.current = { kind: "lasso", id: ptr.id, pts: [a.p.x, a.p.y] };
          else drawRef.current = { kind: "selwand", id: ptr.id, a: a.p };
        }
        break;
      }
      case "text":
        drawRef.current = { kind: "text", id: ptr.id };
        P.current.onTextPoint(a.p);
        break;
    }
    if (ptr.type === "touch" && cfg.precision) showLoupe(a.p, a.sx, a.sy);
    invalidate();
  };

  const moveDraw = (ptr: Ptr) => {
    const st = drawRef.current;
    if (!st || st.id !== ptr.id) return;
    const { session: s, clock } = P.current;
    const cfg = P.current.cfgRef.current;
    const t = clock.now();

    if (st.kind === "model") {
      const m = P.current.model;
      if (m) {
        const dwx = (ptr.x - st.last.x) / viewRef.current.s, dwy = (ptr.y - st.last.y) / viewRef.current.s;
        const v = viewRef.current;
        const [ax, ay] = v.rot === 0 ? [dwx, dwy] : v.rot === 1 ? [dwy, -dwx] : v.rot === 2 ? [-dwx, -dwy] : [-dwy, dwx];
        P.current.onModelChange({ ...m, x: m.x + ax, y: m.y + ay });
      }
      st.last = { x: ptr.x, y: ptr.y };
      return;
    }

    const a = activePoint(ptr);
    cursorPt.current = { p: a.p, sx: a.sx, sy: a.sy };
    if (ptr.type === "touch" && (cfg.precision || st.kind === "pick")) showLoupe(a.p, a.sx, a.sy);

    switch (st.kind) {
      case "stroke": {
        let p = a.p;
        if (st.stab) {
          const k = STAB_K[Math.min(cfg.stabilizer, STAB_K.length - 1)];
          st.stab.x += (a.fx - st.stab.x) * k;
          st.stab.y += (a.fy - st.stab.y) * k;
          p = { x: Math.max(0, Math.min(W - 1, Math.floor(st.stab.x))), y: Math.max(0, Math.min(H - 1, Math.floor(st.stab.y))) };
        }
        if (s.moveStroke(ptr.id, p, t)) invalidate();
        break;
      }
      case "shape": {
        let b = a.p;
        if (cfg.constrain || shiftHeld.current) b = constrainPoint(cfg.shape, st.a, b);
        st.b = b;
        s.previewShape(shapeSettings(cfg, W, H), st.a, b, t);
        invalidate();
        break;
      }
      case "poly": {
        const pts = polyPts.current;
        if (pts.length >= 2) {
          s.previewShape(shapeSettings(cfg, W, H), { x: pts[0], y: pts[1] }, a.p, t, [...pts, a.p.x, a.p.y]);
          invalidate();
        }
        break;
      }
      case "fill":
        st.b = a.p;
        if (Math.abs(a.p.x - st.a.x) + Math.abs(a.p.y - st.a.y) > 2) st.moved = true;
        invalidate(false, true);
        break;
      case "selrect": st.b = a.p; invalidate(false, true); break;
      case "lasso": {
        const n = st.pts.length;
        if (st.pts[n - 2] !== a.p.x || st.pts[n - 1] !== a.p.y) st.pts.push(a.p.x, a.p.y);
        invalidate(false, true);
        break;
      }
      case "selmove":
        s.floatUpdate({ dx: st.baseDx + (a.p.x - st.start.x), dy: st.baseDy + (a.p.y - st.start.y) });
        P.current.onSelectionChange();
        invalidate();
        break;
      case "text": P.current.onTextPoint(a.p); break;
      case "pick": invalidate(false, true); break;
    }
  };

  const endDraw = (ptr: Ptr, cancelled: boolean) => {
    const st = drawRef.current;
    if (!st || st.id !== ptr.id) return;
    drawRef.current = null;
    showLoupe(null, 0, 0);
    cursorPt.current = null;
    const { session: s, clock } = P.current;
    const cfg = P.current.cfgRef.current;
    const t = clock.now();
    const a = st.kind === "model" ? null : activePoint(ptr);

    if (cancelled) {
      // pointercancel : on annule proprement, image et journal restent intacts
      if (st.kind === "stroke") s.cancelStroke(ptr.id);
      else if (st.kind === "shape") s.cancelShape();
      else if (st.kind === "selmove") s.floatUpdate({ dx: st.baseDx, dy: st.baseDy });
      invalidate(); P.current.onSelectionChange();
      return;
    }
    if (!a) return;

    switch (st.kind) {
      case "stroke": s.endStroke(ptr.id, a.p, t); break;
      case "shape": {
        let b = a.p;
        if (cfg.constrain || shiftHeld.current) b = constrainPoint(cfg.shape, st.a, b);
        s.previewShape(shapeSettings(cfg, W, H), st.a, b, t);
        s.commitShape(t);
        break;
      }
      case "poly": {
        const pts = polyPts.current;
        const last = pts.length >= 2 ? { x: pts[pts.length - 2], y: pts[pts.length - 1] } : null;
        if (!last || last.x !== a.p.x || last.y !== a.p.y) pts.push(a.p.x, a.p.y);
        // fermer en touchant le premier sommet
        const first = { x: pts[0], y: pts[1] };
        const closeTap = pts.length >= 8 && Math.hypot((first.x - a.p.x) * viewRef.current.s, (first.y - a.p.y) * viewRef.current.s) < 16;
        if (closeTap) { pts.length -= 2; }
        s.previewShape(shapeSettings(cfg, W, H), first, { x: pts[pts.length - 2], y: pts[pts.length - 1] }, t, pts.slice());
        P.current.onPolyCount(pts.length / 2);
        if (closeTap) { s.commitShape(t); polyPts.current = []; P.current.onPolyCount(0); }
        break;
      }
      case "fill": {
        if (cfg.fillGradient && st.moved) s.gradientFill(st.a, a.p, t, gradientSettings(cfg));
        else if (cfg.fillGradient) { /* un simple tap en mode dégradé : rien (évite un remplissage par erreur) */ }
        else s.fill(st.a, t, fillSettings(cfg));
        break;
      }
      case "pick": {
        const c = s.pick(a.p);
        const hex = "#" + [c & 255, (c >>> 8) & 255, (c >>> 16) & 255].map(v => v.toString(16).padStart(2, "0")).join("");
        P.current.onPickColor(hex);
        break;
      }
      case "selrect": {
        const x = Math.min(st.a.x, a.p.x), y = Math.min(st.a.y, a.p.y);
        const w = Math.abs(a.p.x - st.a.x) + 1, h = Math.abs(a.p.y - st.a.y) + 1;
        if (w >= 2 || h >= 2) s.selectRegion({ t: "rect", x, y, w, h });
        break;
      }
      case "lasso":
        if (st.pts.length >= 6) s.selectRegion({ t: "poly", pts: st.pts });
        break;
      case "selwand":
        s.selectRegion({ t: "wand", x: st.a.x, y: st.a.y, g: cfg.selectGlobal ? 1 : 0 });
        break;
      case "selmove": break;
      case "text": break;
    }
    invalidate();
    P.current.onSelectionChange();
  };

  // ─── Gestes multi-doigts / déplacement ─────────────────────────────────────
  const startGesture = () => {
    const [p1, p2] = [...ptrs.current.values()].filter(p => p.type === "touch");
    if (!p1 || !p2) return;
    if (P.current.modelEdit) {
      const m = P.current.model;
      if (m) modelDrag.current = { view0: { x: m.x, y: m.y, w: m.w, h: m.h }, d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, mx0: (p1.x + p2.x) / 2, my0: (p1.y + p2.y) / 2 };
    }
    gestRef.current = {
      d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
      mx0: (p1.x + p2.x) / 2, my0: (p1.y + p2.y) / 2,
      view0: { ...viewRef.current },
    };
    modeRef.current = "gesture";
  };

  const moveGesture = () => {
    const g = gestRef.current;
    const [p1, p2] = [...ptrs.current.values()].filter(p => p.type === "touch");
    if (!g || !p1 || !p2) return;
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    if (P.current.modelEdit && modelDrag.current && P.current.model) {
      const md = modelDrag.current, k = d / md.d0;
      const m = P.current.model;
      const nw = Math.max(4, md.view0.w * k), nh = Math.max(4, md.view0.h * k);
      P.current.onModelChange({ ...m, w: nw, h: nh, x: md.view0.x - (nw - md.view0.w) / 2, y: md.view0.y - (nh - md.view0.h) / 2 });
      return;
    }
    const w0 = toWorld(g.view0, g.mx0, g.my0);
    const nv: View = { ...g.view0, s: Math.max(MIN_SCALE, Math.min(MAX_SCALE, g.view0.s * (d / g.d0))) };
    const p = toScreen(nv, w0.x, w0.y);
    nv.tx += mx - p.x;
    nv.ty += my - p.y;
    fittedRef.current = false;
    applyView(clampView(nv, sizeRef.current.w, sizeRef.current.h, W, H));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const el = stageRef.current!;
    const sp = stagePoint(e);
    if (e.pointerType === "pen") penSeen.current = true;

    // Un panneau est ouvert : ce geste sert à le fermer, il ne dessine pas.
    if (P.current.panelOpen && ptrs.current.size === 0) {
      P.current.onDismissPanel();
      modeRef.current = "ignore";
      ptrs.current.set(e.pointerId, { id: e.pointerId, x: sp.x, y: sp.y, type: e.pointerType, sx: sp.x, sy: sp.y, t0: performance.now() });
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const ptr: Ptr = { id: e.pointerId, x: sp.x, y: sp.y, type: e.pointerType, sx: sp.x, sy: sp.y, t0: performance.now() };
    ptrs.current.set(e.pointerId, ptr);
    shiftHeld.current = e.shiftKey;

    // Souris : clic milieu/droit ou Espace = déplacer la vue
    if (e.pointerType === "mouse" && (e.button === 1 || e.button === 2 || spaceDown.current)) {
      modeRef.current = "pan";
      panRef.current = { x: sp.x, y: sp.y };
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;

    // Alt + clic (souris) : pipette temporaire, quel que soit l'outil de dessin
    if (e.pointerType === "mouse" && e.altKey && (P.current.tool === "brush" || P.current.tool === "eraser" || P.current.tool === "fill" || P.current.tool === "shape" || P.current.tool === "text")) {
      const c = toCanvasPt(sp.x, sp.y);
      if (c.inside) {
        const px = P.current.session.pick(c.p);
        P.current.onPickColor("#" + [px & 255, (px >>> 8) & 255, (px >>> 16) & 255].map(v => v.toString(16).padStart(2, "0")).join(""));
      }
      ptrs.current.delete(e.pointerId);
      return;
    }

    const touches = [...ptrs.current.values()].filter(p => p.type === "touch");
    if (e.pointerType === "touch") {
      if (touches.length >= 2) {
        // 2e doigt : geste de vue. Annule un trait commencé il y a très peu de temps.
        const st = drawRef.current;
        const young = st && performance.now() - (st.kind === "stroke" ? st.t0 : ptrs.current.get(st.id)?.t0 ?? 0) < GRACE_MS;
        if (modeRef.current === "draw" && st && !young) return;      // 2e doigt = paume : ignoré
        if (modeRef.current === "draw" && st) {
          const first = ptrs.current.get(st.id);
          if (first) { endDraw(first, true); }
          drawRef.current = null;
        }
        startGesture();
        return;
      }
      if (penSeen.current && P.current.penOnly) {
        // stylet connu : le doigt ne dessine pas, il déplace la vue
        modeRef.current = "pan";
        panRef.current = { x: sp.x, y: sp.y };
        return;
      }
    }
    if (modeRef.current !== "idle") return;
    beginDraw(ptr);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const sp = stagePoint(e);
    const ptr = ptrs.current.get(e.pointerId);
    shiftHeld.current = e.shiftKey;

    if (!ptr) {
      // survol (souris/stylet) : aperçu de l'empreinte
      if (e.pointerType !== "touch") {
        const c = toCanvasPt(sp.x, sp.y);
        hover.current = c.inside ? c.p : null;
        P.current.onHover(hover.current);
        invalidate(false, true);
      }
      return;
    }
    ptr.x = sp.x; ptr.y = sp.y;
    if (e.pointerType !== "touch") {
      const c = toCanvasPt(sp.x, sp.y);
      hover.current = c.inside ? c.p : null;
      P.current.onHover(hover.current);
    }

    const mode = modeRef.current;
    if (mode === "gesture") { moveGesture(); return; }
    if (mode === "pan" && panRef.current) {
      const dx = sp.x - panRef.current.x, dy = sp.y - panRef.current.y;
      panRef.current = { x: sp.x, y: sp.y };
      fittedRef.current = false;
      const v = viewRef.current;
      applyView(clampView({ ...v, tx: v.tx + dx, ty: v.ty + dy }, sizeRef.current.w, sizeRef.current.h, W, H));
      return;
    }
    if (mode === "draw") moveDraw(ptr);
  };

  const finishPointer = (e: React.PointerEvent, cancelled: boolean) => {
    const ptr = ptrs.current.get(e.pointerId);
    if (!ptr) return;
    const sp = stagePoint(e);
    ptr.x = sp.x; ptr.y = sp.y;
    if (modeRef.current === "draw") endDraw(ptr, cancelled);
    ptrs.current.delete(e.pointerId);
    try { stageRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (modeRef.current === "gesture") {
      if ([...ptrs.current.values()].filter(p => p.type === "touch").length < 2) { gestRef.current = null; modelDrag.current = null; }
    }
    if (ptrs.current.size === 0) {
      modeRef.current = "idle";
      panRef.current = null;
      gestRef.current = null;
      drawRef.current = null;
      P.current.onViewChange({ scale: viewRef.current.s, fitted: fittedRef.current, rot: viewRef.current.rot });
    } else if (modeRef.current === "gesture" || modeRef.current === "pan") {
      // il reste un doigt après un geste : il ne doit pas se mettre à dessiner
      modeRef.current = "ignore";
    }
  };

  const onPointerUp = (e: React.PointerEvent) => finishPointer(e, false);
  const onPointerCancel = (e: React.PointerEvent) => finishPointer(e, true);
  const onLostCapture = (e: React.PointerEvent) => {
    // le navigateur a repris le pointeur (geste système) : annule le geste sans rien enregistrer
    if (ptrs.current.has(e.pointerId)) finishPointer(e, true);
  };

  // Molette : zoom sur le curseur (Ctrl/pincement trackpad aussi)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sp = stagePoint(e);
      if (P.current.modelEdit && P.current.model) {
        const m = P.current.model, k = Math.exp(-e.deltaY * 0.0015);
        P.current.onModelChange({ ...m, w: m.w * k, h: m.h * k, x: m.x - (m.w * k - m.w) / 2, y: m.y - (m.h * k - m.h) / 2 });
        return;
      }
      if (e.shiftKey && !e.ctrlKey) {
        const v = viewRef.current;
        fittedRef.current = false;
        applyView(clampView({ ...v, tx: v.tx - e.deltaY, ty: v.ty }, sizeRef.current.w, sizeRef.current.h, W, H));
        return;
      }
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      fittedRef.current = false;
      applyView(clampView(zoomAt(viewRef.current, factor, sp.x, sp.y), sizeRef.current.w, sizeRef.current.h, W, H));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H]);

  // Espace = main (déplacer la vue) ; Maj = contrainte
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.code === "Space") { spaceDown.current = true; e.preventDefault(); }
      if (e.key === "Shift") shiftHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
      if (e.key === "Shift") shiftHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // ─── Calque de guides (espace écran) ───────────────────────────────────────
  const renderOverlay = () => {
    const cv = overlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const v = viewRef.current;
    const { session: s, tool, grid } = P.current;
    const cfg = P.current.cfgRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const rectPath = (x: number, y: number, rw: number, rh: number) => {
      const c = [toScreen(v, x, y), toScreen(v, x + rw, y), toScreen(v, x + rw, y + rh), toScreen(v, x, y + rh)];
      ctx.beginPath();
      ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath();
    };

    // 1) ombre + cadre du canvas
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#000";
    rectPath(0, 0, W, H);
    ctx.fill();
    ctx.restore();
    ctx.save();
    rectPath(0, 0, W, H);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    rectPath(0, 0, W, H);
    ctx.stroke();

    // 1 bis) repère du HAUT de l'écran : il tourne avec la vue, pour ne jamais se tromper de sens
    {
      const top = toScreen(v, W / 2, 0);
      const flipped = v.rot !== 0;
      const label = flipped ? `▲ HAUT DE L'ÉCRAN · vue pivotée ${v.rot * 90}°` : "▲ HAUT";
      ctx.save();
      ctx.translate(top.x, top.y);
      ctx.rotate((v.rot * Math.PI) / 2);            // le repère suit l'axe x du dessin
      ctx.font = "700 10.5px 'DM Sans', system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      const pw = tw + 16, ph = 17, py = -ph - 6;    // posé juste au-dessus du bord haut, à l'extérieur
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(-pw / 2, py, pw, ph, 8.5); else ctx.rect(-pw / 2, py, pw, ph);
      ctx.fillStyle = flipped ? "#fbbf24" : "rgba(30,30,46,0.92)";
      ctx.fill();
      if (!flipped) { ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.fillStyle = flipped ? "#1a1204" : "rgba(255,255,255,0.78)";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, 0, py + ph / 2 + 0.5);
      ctx.restore();
    }

    // 2) grille
    const px = v.s;
    const gridStep = grid.step;
    if (grid.show && px * gridStep >= 4) {
      ctx.strokeStyle = "rgba(124,107,255,0.30)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = gridStep; x < W; x += gridStep) { const a = toScreen(v, x, 0), b = toScreen(v, x, H); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      for (let y = gridStep; y < H; y += gridStep) { const a = toScreen(v, 0, y), b = toScreen(v, W, y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }
    if (px >= 9) {   // grille de pixels quand on est assez près
      ctx.strokeStyle = "rgba(128,128,150,0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < W; x++) { const a = toScreen(v, x, 0), b = toScreen(v, x, H); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      for (let y = 1; y < H; y++) { const a = toScreen(v, 0, y), b = toScreen(v, W, y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }

    // 3) axes de symétrie
    if (cfg.sym && (tool === "brush" || tool === "shape")) {
      const cx = cfg.symCx || W / 2, cy = cfg.symCy || H / 2;
      ctx.save();
      ctx.strokeStyle = "rgba(255,107,157,0.75)";
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const line = (x0: number, y0: number, x1: number, y1: number) => { const a = toScreen(v, x0, y0), b = toScreen(v, x1, y1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };
      if (cfg.sym === "v" || cfg.sym === "vh") line(cx, 0, cx, H);
      if (cfg.sym === "h" || cfg.sym === "vh") line(0, cy, W, cy);
      if (cfg.sym[0] === "r") {
        const n = parseInt(cfg.sym.slice(1), 10) || 4;
        const R = Math.max(W, H);
        for (let k = 0; k < n; k++) { const ang = (Math.PI * k) / n; line(cx - Math.cos(ang) * R, cy - Math.sin(ang) * R, cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); }
      }
      ctx.stroke();
      ctx.restore();
    }

    // 4) sélection (fourmis marchantes) + cadre flottant
    const sel = s.selection, fl = s.floating;
    const dashOffset = -((Date.now() / 60) % 16);
    const ants = (draw: () => void) => {
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff"; ctx.setLineDash([5, 5]); ctx.lineDashOffset = dashOffset; draw();
      ctx.strokeStyle = "#111111"; ctx.lineDashOffset = dashOffset + 5; draw();
      ctx.restore();
    };
    if (fl) {
      const b = fl.bounds;
      ants(() => { rectPath(b.x, b.y, b.w, b.h); ctx.stroke(); });
    } else if (sel) {
      const isRect = sel.sel.mask.every(m => m === 1);
      if (isRect) ants(() => { rectPath(sel.sel.x, sel.sel.y, sel.sel.w, sel.sel.h); ctx.stroke(); });
      else if (sel.sel.w * sel.sel.h < 20000) {
        const edges = selectionEdges(sel.sel);
        ants(() => {
          ctx.beginPath();
          for (const e of edges) {
            const [x0, y0, x1, y1] = e.dir === "t" ? [e.x, e.y, e.x + 1, e.y] : e.dir === "b" ? [e.x, e.y + 1, e.x + 1, e.y + 1] : e.dir === "l" ? [e.x, e.y, e.x, e.y + 1] : [e.x + 1, e.y, e.x + 1, e.y + 1];
            const a = toScreen(v, x0, y0), b = toScreen(v, x1, y1);
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          }
          ctx.stroke();
        });
      }
    }
    const st = drawRef.current;
    if (st?.kind === "selrect") {
      const x = Math.min(st.a.x, st.b.x), y = Math.min(st.a.y, st.b.y);
      ants(() => { rectPath(x, y, Math.abs(st.b.x - st.a.x) + 1, Math.abs(st.b.y - st.a.y) + 1); ctx.stroke(); });
    }
    if (st?.kind === "lasso" && st.pts.length >= 4) {
      ants(() => {
        ctx.beginPath();
        for (let i = 0; i < st.pts.length; i += 2) { const p = toScreen(v, st.pts[i] + 0.5, st.pts[i + 1] + 0.5); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
        ctx.stroke();
      });
    }
    if (st?.kind === "fill" && cfg.fillGradient) {
      const a = toScreen(v, st.a.x + 0.5, st.a.y + 0.5), b = toScreen(v, st.b.x + 0.5, st.b.y + 0.5);
      ctx.save();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = "#7c6bff"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }

    // 5) polygone en cours
    const pts = polyPts.current;
    if (pts.length >= 2 && tool === "shape" && cfg.shape === "poly") {
      ctx.save();
      ctx.fillStyle = "#ff6b9d";
      for (let i = 0; i < pts.length; i += 2) {
        const p = toScreen(v, pts[i] + 0.5, pts[i + 1] + 0.5);
        ctx.beginPath(); ctx.arc(p.x, p.y, i === 0 ? 7 : 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // 6) texte en cours d'édition : cadre pointillé autour du texte
    const td = P.current.textDraft;
    if (td) {
      const m = measureText(td.str || " ", td.scale);
      ants(() => { rectPath(td.p.x - 1, td.p.y - 1, m.w + 2, m.h + 2); ctx.stroke(); });
    }

    // 7) empreinte du pinceau / curseur
    const cp = cursorPt.current?.p ?? hover.current;
    if (cp && !P.current.modelEdit && (tool === "brush" || tool === "eraser" || tool === "shape" || tool === "eyedropper" || tool === "select" || tool === "fill" || tool === "text")) {
      ctx.save();
      const drawCell = (x: number, y: number, fill: boolean) => {
        const a = toScreen(v, x, y), b = toScreen(v, x + 1, y + 1);
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), sz = Math.abs(b.x - a.x) || Math.abs(b.y - a.y);
        if (fill) { ctx.fillStyle = "rgba(124,107,255,0.22)"; ctx.fillRect(x0, y0, sz, sz); }
        ctx.strokeStyle = "rgba(124,107,255,0.95)"; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, sz - 1), Math.max(1, sz - 1));
      };
      if (tool === "brush" || tool === "eraser") {
        const erase = tool === "eraser";
        const m = brushMask(erase ? "square" : cfg.brush, erase ? cfg.eraserSize : cfg.size);
        const ax = anchorX(m), ay = anchorY(m);
        if (m.w * m.h <= 1200) {
          for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (m.bits[j * m.w + i]) drawCell(cp.x - ax + i, cp.y - ay + j, true);
        } else drawCell(cp.x, cp.y, true);
      } else drawCell(cp.x, cp.y, false);
      // curseur déporté : petite croix
      if (cursorPt.current && cursorPt.current.sy !== undefined) {
        const c = cursorPt.current;
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(c.sx - 10, c.sy); ctx.lineTo(c.sx + 10, c.sy); ctx.moveTo(c.sx, c.sy - 10); ctx.lineTo(c.sx, c.sy + 10); ctx.stroke();
      }
      ctx.restore();
    }
  };

  // ─── DOM ───────────────────────────────────────────────────────────────────
  const model = props.model;
  return (
    <div
      ref={stageRef}
      className="st-stage"
      data-tool={props.tool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostCapture}
      onPointerLeave={() => { hover.current = null; P.current.onHover(null); invalidate(false, true); }}
      onContextMenu={e => e.preventDefault()}
    >
      <div ref={worldRef} className="st-world" style={{ width: W, height: H }}>
        <canvas ref={mainRef} className="st-canvas" width={W} height={H} aria-label={`Zone de dessin ${W} par ${H} pixels`} role="img" />
        {model && model.visible && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={model.url} alt="" draggable={false}
            className="st-model"
            style={{ left: model.x, top: model.y, width: model.w, height: model.h, opacity: model.opacity, filter: model.gray ? "grayscale(1) contrast(1.05)" : undefined }}
          />
        )}
      </div>
      <canvas ref={overlayRef} className="st-overlay" />
      <canvas ref={loupeRef} className="st-loupe" width={104} height={104} style={{ display: "none" }} />
    </div>
  );
});
