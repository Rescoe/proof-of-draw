"use client";

// app/bench/BenchClient.tsx — Banc d'essai d'animation pour le TFT 2.8" tactile (v1, preuve de concept).
// On dessine une animation OLED 128×64 (1 bit) ; le serveur l'encode en DIFFÉRENCES entre images, la R4 la télécharge puis la joue en
// ne repeignant que les octets modifiés, agrandie ×1,875 au centre de l'écran 240×320. L'appareil renvoie ses MESURES (vitesse réelle).
//
// Éditeur : historique annuler / rétablir (lib/bench/history.ts), outils crayon · gomme · ligne · rectangle · ellipse · remplissage avec pinceaux,
// onion skin avant/arrière, grille d'octets, retournements, décalages, génération de MOUVEMENT, ordre des images, raccourcis clavier.
// Toutes les primitives sont pures et testées (lib/bench/draw.ts) ; l'éditeur ne fait que les brancher.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CLIP, clipPixel, clipPlayMs, clipStats, type ClipInput } from "@/lib/bench/clip";
import type { BenchLogLine, BenchResult, ClipPointer } from "@/lib/bench/store";
import { encodeGif } from "@/lib/bench/gif";
import { blank, ellipse, flipH, flipV, floodFill, invert, line, motion, rect, setPixel, shifted, type Brush, type Frame, W, H } from "@/lib/bench/draw";
import { histReducer, initHist, type Doc } from "@/lib/bench/history";

const DRAFT_KEY = "pod-bench-draft-v1";
const ASSUMED_LINK_BYTES_PER_SEC = 45_000;   // ESTIMATION d'affichage uniquement : la vraie valeur vient des mesures de l'appareil

// ── Utilitaires ──────────────────────────────────────────────────────────────
const toB64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hexTo565 = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (((n >> 16) & 0xff) >> 3 << 11) | (((n >> 8) & 0xff) >> 2 << 5) | ((n & 0xff) >> 3); };
const hexToRgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]; };
function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Le banc d'essai exige le firmware r4tft28-2.1 ou plus : une 2.0 ignore le mode et ne fait jamais de contrôle rapide. */
function firmwareOk(fw: string | null): boolean | null {
  if (!fw) return null;
  const m = /^r4tft28-(\d+)\.(\d+)/.exec(fw);
  return m ? Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 1) : false;
}

// ── Modèles de test (ne sont JAMAIS enregistrés dans la galerie) ─────────────
interface Anim { frames: Frame[]; delays: number[] }
const mset = (f: Frame, x: number, y: number) => { if (x >= 0 && y >= 0 && x < W && y < H) f[y * 16 + (x >> 3)] |= 0x80 >> (x & 7); };
function presetBall(): Anim {
  const frames: Frame[] = [];
  for (let k = 0; k < 28; k++) {
    const f = blank(), t = k / 28;
    const cx = Math.round(8 + (Math.abs(((t * 2) % 2) - 1)) * 111), cy = Math.round(32 + Math.sin(t * Math.PI * 4) * 22);
    for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) if (x * x + y * y <= 25) mset(f, cx + x, cy + y);
    frames.push(f);
  }
  return { frames, delays: frames.map(() => 60) };
}
function presetWave(): Anim {
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
function presetFlash(): Anim {
  const on = Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => 0xff);
  return { frames: [blank(), on, blank(), on], delays: [100, 100, 100, 100] };   // PIRE CAS : tout l'écran change à chaque image
}
function presetNoise(): Anim {
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const frames: Frame[] = [];
  for (let k = 0; k < 8; k++) { const f = blank(); for (let i = 0; i < 700; i++) mset(f, Math.floor(rnd() * W), Math.floor(rnd() * H)); frames.push(f); }
  return { frames, delays: frames.map(() => 100) };
}
function presetText(text: string): Anim {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return { frames: [blank()], delays: [100] };
  ctx.font = "bold 26px monospace";
  const tw = Math.ceil(ctx.measureText(text || " ").width), total = tw + W, step = Math.max(6, Math.ceil(total / 40));   // ≤ 40 images : le clip doit tenir en 9 Ko
  const frames: Frame[] = [];
  for (let off = 0; off < total; off += step) {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(text || " ", W - off, H / 2 + 2);
    const d = ctx.getImageData(0, 0, W, H).data, f = blank();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4] > 127) mset(f, x, y);
    frames.push(f);
  }
  return { frames, delays: frames.map(() => 60) };
}

// ── Dessin sur canevas ───────────────────────────────────────────────────────
interface PaintOpts { onionPrev?: Frame; onionNext?: Frame; grid?: boolean }
function useFramePaint(canvas: React.RefObject<HTMLCanvasElement | null>, frame: Frame, fg: string, bg: string, o: PaintOpts = {}) {
  const { onionPrev, onionNext, grid } = o;
  useEffect(() => {
    const cv = canvas.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
    const px = (f: Frame, alpha: number, color: string) => {
      ctx.globalAlpha = alpha; ctx.fillStyle = color;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (clipPixel(f, x, y)) ctx.fillRect(x, y, 1, 1);
      ctx.globalAlpha = 1;
    };
    if (onionNext) px(onionNext, 0.16, "#60a5fa");
    if (onionPrev) px(onionPrev, 0.3, "#fb923c");
    px(frame, 1, fg);
    if (grid) {                                   // colonnes d'octets (8 px) : c'est l'unité de coût d'une différence
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      for (let x = 8; x < W; x += 8) ctx.fillRect(x, 0, 1, H);
    }
  }, [canvas, frame, fg, bg, onionPrev, onionNext, grid]);
}

function Thumb({ frame, fg, bg, selected, index, onClick }: { frame: Frame; fg: string; bg: string; selected: boolean; index: number; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useFramePaint(ref, frame, fg, bg);
  return (
    <button type="button" onClick={onClick} aria-label={`Image ${index + 1}`} aria-current={selected} style={{ flex: "0 0 auto", padding: 2, borderRadius: 6, cursor: "pointer", background: "var(--bg2)", border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}` }}>
      <canvas ref={ref} width={W} height={H} style={{ width: 84, height: 42, display: "block", imageRendering: "pixelated", borderRadius: 3 }} />
      <div style={{ fontSize: 10, color: selected ? "var(--accent)" : "var(--text3)", textAlign: "center" }}>{index + 1}</div>
    </button>
  );
}

const card: React.CSSProperties = { padding: "1rem 1.1rem", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg2)", marginBottom: "1rem" };
const btn: React.CSSProperties = { padding: "0.4rem 0.75rem", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", fontSize: "0.82rem", cursor: "pointer" };
const btnOn: React.CSSProperties = { ...btn, borderColor: "var(--accent)", color: "var(--accent)", background: "rgba(124,107,255,0.1)" };
const btnOff: React.CSSProperties = { ...btn, opacity: 0.4, cursor: "not-allowed" };
const label: React.CSSProperties = { fontSize: "0.68rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" };
const muted: React.CSSProperties = { fontSize: "0.76rem", color: "var(--text3)", lineHeight: 1.5, margin: 0 };

interface Dev { deviceId: string; deviceName?: string; artistName?: string; screens: string[]; isOnline: boolean }
interface Status { mode: boolean; clip: ClipPointer | null; seenAgoMs: number | null; results: BenchResult[]; log: BenchLogLine[]; firmware: string | null; lastPingAgoMs: number | null }
type Tool = "pencil" | "eraser" | "line" | "rect" | "ellipse" | "fill";
const TOOLS: { id: Tool; icon: string; name: string; key: string }[] = [
  { id: "pencil", icon: "✏️", name: "Crayon", key: "P" }, { id: "eraser", icon: "⌫", name: "Gomme", key: "E" }, { id: "line", icon: "／", name: "Ligne", key: "L" },
  { id: "rect", icon: "▭", name: "Rectangle", key: "R" }, { id: "ellipse", icon: "◯", name: "Ellipse", key: "O" }, { id: "fill", icon: "🪣", name: "Remplir", key: "G" },
];

interface Draft { frames: string[]; delays: number[]; loops: number; fg: string; bg: string; handmade?: boolean; title?: string; v?: number }
function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    // Brouillons d'avant le 03/10 (sans v:2) : leur « 3 boucles » était la valeur par défaut, pas un choix → on passe en boucle sans fin.
    return d.v === 2 ? d : { ...d, loops: 0 };
  } catch { return null; }
}
const docFromDraft = (d: Draft | null): Doc => {
  const frames = d?.frames?.length ? d.frames.map(fromB64) : [blank()];
  const delays = d?.delays?.length === frames.length ? d.delays : frames.map(() => 100);
  return { frames, delays, cur: 0, handmade: d?.handmade ?? true };
};

export default function BenchClient() {
  const [draft] = useState(loadDraft);
  const [hist, dispatch] = useReducer(histReducer, draft, (d) => initHist(docFromDraft(d)));
  const { frames, delays, cur: idx } = hist.doc;
  const n = frames.length;
  const frame = frames[idx];
  const canUndo = hist.past.length > 0, canRedo = hist.future.length > 0;

  const [loops, setLoops] = useState(draft?.loops ?? 0);   // par défaut : en boucle jusqu'au toucher
  const [fg, setFg] = useState(draft?.fg ?? "#00ff88");
  const [bg, setBg] = useState(draft?.bg ?? "#000000");
  const [tool, setTool] = useState<Tool>("pencil");
  const [brushSize, setBrushSize] = useState(1);
  const [brushRound, setBrushRound] = useState(false);
  const [filled, setFilled] = useState(false);
  const [onionPrev, setOnionPrev] = useState(true);
  const [onionNext, setOnionNext] = useState(false);
  const [grid, setGrid] = useState(false);
  const [shiftStep, setShiftStep] = useState(1);
  const [mvN, setMvN] = useState(8);
  const [mvDx, setMvDx] = useState(4);
  const [mvDy, setMvDy] = useState(0);
  const [mvWrap, setMvWrap] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("PoD");
  // Une animation est « faite à la main » dès qu'on la modifie ; un modèle de test chargé ne l'est pas (et n'entre jamais dans la galerie).
  // L'état vit dans le document : annuler le chargement d'un modèle le restaure.
  const handmade = hist.doc.handmade !== false;
  const [title, setTitle] = useState(draft?.title ?? "");
  const [toGallery, setToGallery] = useState(true);
  const [allDevices, setAllDevices] = useState<Dev[]>([]);
  const [devices, setDevices] = useState<Dev[] | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<{ x0: number; y0: number; base: Frame; on: boolean } | null>(null);

  const prevFrame = idx > 0 ? frames[idx - 1] : n > 1 ? frames[n - 1] : undefined;
  const nextFrame = n > 1 ? frames[(idx + 1) % n] : undefined;
  useFramePaint(canvasRef, frame, fg, bg, {
    onionPrev: onionPrev && !playing ? prevFrame : undefined,
    onionNext: onionNext && !playing ? nextFrame : undefined,
    grid: grid && !playing,
  });

  // ── Édition : toute modification passe par l'historique ────────────────────
  const brush: Brush = { size: brushSize, round: brushRound };
  const editFrame = (fn: (f: Frame) => Frame) => dispatch({ type: "commit", fn: (d) => ({ ...d, handmade: true, frames: d.frames.map((f, i) => (i === d.cur ? fn(f) : f)) }) });
  const patchFrame = (fn: (f: Frame) => Frame) => dispatch({ type: "patch", fn: (d) => ({ ...d, handmade: true, frames: d.frames.map((f, i) => (i === d.cur ? fn(f) : f)) }) });
  const edit = (fn: (d: Doc) => Doc) => { setPlaying(false); dispatch({ type: "commit", fn: (d) => ({ ...fn(d), handmade: true }) }); };
  const editCur = (fn: (f: Frame) => Frame) => { setPlaying(false); editFrame(fn); };

  const undo = useCallback(() => { setPlaying(false); dispatch({ type: "undo" }); }, []);
  const redo = useCallback(() => { setPlaying(false); dispatch({ type: "redo" }); }, []);

  const addFrame = () => edit((d) => ({ frames: [...d.frames.slice(0, d.cur + 1), blank(), ...d.frames.slice(d.cur + 1)], delays: [...d.delays.slice(0, d.cur + 1), d.delays[d.cur] ?? 100, ...d.delays.slice(d.cur + 1)], cur: d.cur + 1 }));
  const dupFrame = () => edit((d) => ({ frames: [...d.frames.slice(0, d.cur + 1), d.frames[d.cur], ...d.frames.slice(d.cur + 1)], delays: [...d.delays.slice(0, d.cur + 1), d.delays[d.cur] ?? 100, ...d.delays.slice(d.cur + 1)], cur: d.cur + 1 }));
  const delFrame = () => edit((d) => d.frames.length < 2 ? { frames: [blank()], delays: [d.delays[0] ?? 100], cur: 0 } : { frames: d.frames.filter((_, i) => i !== d.cur), delays: d.delays.filter((_, i) => i !== d.cur), cur: Math.max(0, d.cur - 1) });
  const moveFrame = (dir: -1 | 1) => edit((d) => {
    const j = d.cur + dir; if (j < 0 || j >= d.frames.length) return d;
    const fr = [...d.frames], dl = [...d.delays]; [fr[d.cur], fr[j]] = [fr[j], fr[d.cur]]; [dl[d.cur], dl[j]] = [dl[j], dl[d.cur]];
    return { frames: fr, delays: dl, cur: j };
  });
  const reverseAll = () => edit((d) => ({ frames: [...d.frames].reverse(), delays: [...d.delays].reverse(), cur: d.frames.length - 1 - d.cur }));
  const pingPong = () => edit((d) => {
    if (d.frames.length < 3 || d.frames.length * 2 - 2 > CLIP.MAX_FRAMES) return d;
    const back = d.frames.slice(1, -1).reverse(), backD = d.delays.slice(1, -1).reverse();
    return { ...d, frames: [...d.frames, ...back], delays: [...d.delays, ...backD] };
  });
  const generateMotion = () => edit((d) => {
    const cnt = Math.max(2, Math.min(CLIP.MAX_FRAMES, mvN)), dl = d.delays[d.cur] ?? 100;
    return { frames: motion(d.frames[d.cur], cnt, mvDx, mvDy, mvWrap), delays: Array.from({ length: cnt }, () => dl), cur: 0 };
  });
  const setDelay = (v: number) => dispatch({ type: "patch", fn: (d) => ({ ...d, handmade: true, delays: d.delays.map((x, i) => (i === d.cur ? v : x)) }) });
  const loadAnim = (a: Anim, isTest: boolean) => { setPlaying(false); dispatch({ type: "commit", fn: () => ({ frames: a.frames, delays: a.delays, cur: 0, handmade: !isTest }) }); setMsg(null); if (isTest) setTitle(""); };

  // ── Souris / stylet ────────────────────────────────────────────────────────
  const pixelAt = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return { x: Math.max(0, Math.min(W - 1, Math.floor(((e.clientX - r.left) / r.width) * W))), y: Math.max(0, Math.min(H - 1, Math.floor(((e.clientY - r.top) / r.height) * H))) };
  };
  const shapeOf = (t: Tool, base: Frame, x0: number, y0: number, x1: number, y1: number, on: boolean): Frame =>
    t === "line" ? line(base, x0, y0, x1, y1, on, brush) : t === "rect" ? rect(base, x0, y0, x1, y1, on, filled, brush) : ellipse(base, x0, y0, x1, y1, on, filled, brush);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    setPlaying(false);
    const { x, y } = pixelAt(e);
    const on = e.button === 2 ? false : tool !== "eraser";            // clic droit = gomme, quel que soit l'outil
    if (tool === "fill") { editCur((f) => floodFill(f, x, y, on)); return; }
    dispatch({ type: "begin" });                                       // un trait = UN pas d'annulation
    strokeRef.current = { x0: x, y0: y, base: frame, on };
    if (tool === "pencil" || tool === "eraser") patchFrame((f) => setPixel(f, x, y, on, brush));
    else patchFrame(() => shapeOf(tool, frame, x, y, x, y, on));
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = pixelAt(e);
    setHover({ x, y });
    const s = strokeRef.current; if (!s) return;
    if (tool === "pencil" || tool === "eraser") { patchFrame((f) => line(f, s.x0, s.y0, x, y, s.on, brush)); s.x0 = x; s.y0 = y; }
    else patchFrame(() => shapeOf(tool, s.base, s.x0, s.y0, x, y, s.on));
  };
  const onUp = () => { strokeRef.current = null; };

  // ── Raccourcis clavier ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod || e.altKey) return;
      const picked = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (picked) { setTool(picked.id); return; }
      if (k === " ") { e.preventDefault(); setPlaying((p) => !p); return; }
      if (k === "arrowleft") { e.preventDefault(); setPlaying(false); dispatch({ type: "step", delta: -1 }); return; }
      if (k === "arrowright") { e.preventDefault(); setPlaying(false); dispatch({ type: "step", delta: 1 }); return; }
      if (k === "[") setBrushSize((s) => Math.max(1, s - 1));
      if (k === "]") setBrushSize((s) => Math.min(8, s + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ── Brouillon local ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ frames: frames.map(toB64), delays, loops, fg, bg, handmade, title, v: 2 } satisfies Draft)); } catch { /* stockage indisponible */ }
    }, 400);
    return () => clearTimeout(t);
  }, [frames, delays, loops, fg, bg, handmade, title]);

  // ── Aperçu animé (délais par image) ────────────────────────────────────────
  useEffect(() => {
    if (!playing || n < 2) return;
    const t = setTimeout(() => dispatch({ type: "step", delta: 1 }), Math.max(20, delays[idx] ?? 100));
    return () => clearTimeout(t);
  }, [playing, idx, n, delays]);

  // ── Appareils TFT 2.8" du propriétaire ─────────────────────────────────────
  useEffect(() => {
    let alive = true;
    fetch("/api/devices?mine=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { devices: [] }))
      .then((d: { devices?: Dev[] }) => {
        if (!alive) return;
        setAllDevices(d.devices ?? []);
        const mine = (d.devices ?? []).filter((x) => x.screens?.includes("tft28"));
        setDevices(mine);
        if (mine.length) setDeviceId((c) => c || mine[0].deviceId);
      })
      .catch(() => { if (alive) setDevices([]); });
    return () => { alive = false; };
  }, []);

  // ── État du banc d'essai (mode, présence, mesures, journal) ────────────────
  // Quota Upstash : chaque lecture d'état coûte ~6 commandes Redis. Rythme adaptatif : rapide (2,5 s) seulement juste après un envoi / un
  // changement de mode, 8 s tant que le mode est actif, 20 s sinon ; AUCUNE lecture quand l'onglet est caché.
  const fastUntil = useRef(0);
  const modeOn = useRef(false);
  const refreshStatus = useCallback(async () => {
    if (!deviceId) return;
    try {
      const r = await fetch(`/api/bench/status?deviceId=${deviceId}`, { cache: "no-store" });
      if (r.ok) { const s: Status = await r.json(); modeOn.current = s.mode === true; setStatus(s); }
    } catch { /* réseau : on réessaie au prochain tour */ }
  }, [deviceId]);
  useEffect(() => {
    if (!deviceId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const ms = Date.now() < fastUntil.current ? 2500 : modeOn.current ? 8000 : 20000;
      timer = setTimeout(async () => { if (stopped) return; if (!document.hidden) await refreshStatus(); if (!stopped) schedule(); }, ms);
    };
    const onVisible = () => { if (!document.hidden) { clearTimeout(timer); void refreshStatus().then(() => { if (!stopped) schedule(); }); } };
    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(() => { void refreshStatus().then(() => { if (!stopped) schedule(); }); }, 0);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [deviceId, refreshStatus]);

  // ── Statistiques du clip (même codeur que le serveur) ──────────────────────
  const input: ClipInput = useMemo(() => ({ frames, delaysMs: delays.slice(0, frames.length), loops, fg: hexTo565(fg), bg: hexTo565(bg) }), [frames, delays, loops, fg, bg]);
  const stats = useMemo(() => { try { return clipStats(input); } catch { return null; } }, [input]);
  const playMs = clipPlayMs(input.delaysMs, loops);
  const frameCost = stats && n > 1 && idx > 0 ? stats.transitionBytes[idx - 1] : null;

  // ── Export : GIF, projet (.json), import ───────────────────────────────────
  const baseName = (title.trim() || "animation").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "animation";
  const exportGif = () => download(`${baseName}.gif`, encodeGif({ frames, delaysMs: input.delaysMs, fg: hexToRgb(fg), bg: hexToRgb(bg), scale: 4 }) as BlobPart, "image/gif");
  const exportProject = () => download(`${baseName}.pod-anim.json`, JSON.stringify({ kind: "pod-bench-animation", v: 1, title, frames: frames.map(toB64), delays: input.delaysMs, loops, fg, bg }, null, 1), "application/json");
  const importProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (j.kind !== "pod-bench-animation" || !Array.isArray(j.frames) || !j.frames.length || j.frames.length > CLIP.MAX_FRAMES) throw new Error("fichier non reconnu");
      const fr: Frame[] = j.frames.map((x: string) => fromB64(String(x)));
      if (fr.some((f) => f.length !== CLIP.FRAME_BYTES)) throw new Error("images invalides");
      setPlaying(false);
      dispatch({ type: "commit", fn: () => ({ frames: fr, delays: fr.map((_, i) => Math.max(20, Math.min(2550, Number(j.delays?.[i]) || 100))), cur: 0, handmade: true }) });
      setLoops(j.loops === 0 ? 0 : Math.max(1, Math.min(CLIP.MAX_LOOPS, Number(j.loops) || 1))); setFg(/^#[0-9a-f]{6}$/i.test(j.fg) ? j.fg : "#00ff88"); setBg(/^#[0-9a-f]{6}$/i.test(j.bg) ? j.bg : "#000000");
      setTitle(String(j.title ?? "")); setMsg({ ok: true, text: "Projet importé (vous pouvez annuler avec Ctrl+Z)." });
    } catch (e) { setMsg({ ok: false, text: `Import impossible : ${e instanceof Error ? e.message : "fichier illisible"}` }); }
  };

  const device = devices?.find((d) => d.deviceId === deviceId);
  const seen = status?.seenAgoMs ?? null;
  const connected = status?.mode === true && seen !== null && seen < 15_000;
  const fwState = firmwareOk(status?.firmware ?? null);
  const authorDevice = deviceId || allDevices[0]?.deviceId || "";

  async function setMode(on: boolean) {
    setMsg(null);
    fastUntil.current = Date.now() + 30_000;
    const r = await fetch("/api/bench/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId, on }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setMsg({ ok: false, text: d.error ?? "Erreur" });
    refreshStatus();
  }
  async function clearHistory() {
    await fetch("/api/bench/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }) });
    setStatus((s) => (s ? { ...s, results: [], log: [] } : s));
  }
  async function send() {
    setBusy(true); setMsg(null);
    fastUntil.current = Date.now() + 45_000;          // l'écran télécharge puis joue : on suit de près pendant 45 s
    try {
      const r = await fetch("/api/bench/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, frames: frames.map(toB64), delaysMs: input.delaysMs, loops, fg: input.fg, bg: input.bg, ...(handmade && toGallery ? { gallery: { title: title.trim() || "Sans titre" } } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      const g = d.gallery as { id?: string; duplicate?: boolean; refused?: string } | undefined;
      const galleryText = !g ? "" : g.id ? (g.duplicate ? " Déjà présente dans la galerie Animations." : " Enregistrée dans la galerie Animations.") : ` Pas ajoutée à la galerie : ${g.refused}.`;
      setMsg(r.ok ? { ok: true, text: `Envoyé : clip ${d.clipId} (${d.bytes} octets). ${status?.mode ? "L'écran le joue dans quelques secondes." : "Activez le mode banc d'essai pour que l'écran le récupère vite."}${galleryText}` } : { ok: false, text: d.error ?? "Envoi impossible" });
      refreshStatus();
    } catch { setMsg({ ok: false, text: "Erreur réseau" }); }
    finally { setBusy(false); }
  }
  async function saveOnly() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/anim/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: authorDevice, title: title.trim() || "Sans titre", frames: frames.map(toB64), delaysMs: input.delaysMs, loops, fg: input.fg, bg: input.bg }),
      });
      const d = await r.json().catch(() => ({}));
      setMsg(r.ok ? { ok: true, text: d.duplicate ? "Cette animation est déjà dans la galerie." : "Enregistrée dans la galerie Animations." } : { ok: false, text: d.error ?? "Enregistrement impossible" });
    } catch { setMsg({ ok: false, text: "Erreur réseau" }); }
    finally { setBusy(false); }
  }

  const sizeColor = !stats ? "var(--text3)" : stats.bytes <= CLIP.MAX_CLIP_BYTES * 0.7 ? "#4ade80" : stats.fitsDevice ? "#fb923c" : "#f87171";
  const isShape = tool === "rect" || tool === "ellipse";
  const usesBrush = tool === "pencil" || tool === "eraser" || tool === "line" || (isShape && !filled);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "1.5rem 1rem 3rem" }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: "0 0 0.3rem" }}>🧪 Banc d&apos;essai animation — TFT 2.8&quot; tactile <span style={{ ...label, border: "1px solid var(--border)", borderRadius: 999, padding: "0.1rem 0.5rem", verticalAlign: "middle" }}>v1 · test</span></h1>
      <p style={{ ...muted, marginBottom: "1rem" }}>
        Dessinez une petite animation 128×64 (comme sur l&apos;OLED). Elle est envoyée sous forme de <strong>différences entre images</strong> et rejouée par l&apos;écran, agrandie ×1,875
        au centre du 240×320. L&apos;écran renvoie ses mesures : on voit ainsi la vitesse réelle atteinte. Voir aussi la <a href="/gallery-anim" style={{ color: "var(--accent)" }}>galerie Animations</a>.
      </p>

      {/* 1. Appareil + mode */}
      <div style={card}>
        <div style={label}>1 · Écran cible</div>
        {devices === null ? <p style={muted}>Chargement…</p> : devices.length === 0 ? (
          <p style={{ ...muted, color: "#fb923c", marginTop: 6 }}>Aucun TFT 2.8&quot; tactile dans votre profil. Le banc d&apos;essai ne concerne que cet écran (firmware <code>r4tft28</code>). Vous pouvez quand même dessiner, exporter en GIF et enregistrer dans la galerie.</p>
        ) : (
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            <select value={deviceId} onChange={(e) => { setDeviceId(e.target.value); setStatus(null); }} aria-label="Appareil" style={{ ...btn, minWidth: 200 }}>
              {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.deviceName || d.artistName || d.deviceId}</option>)}
            </select>
            <button type="button" onClick={() => setMode(!status?.mode)} style={status?.mode ? btnOn : btn}>{status?.mode ? "✓ Mode banc d'essai actif (couper)" : "Activer le mode banc d'essai"}</button>
            <span style={{ fontSize: "0.78rem", color: connected ? "#4ade80" : "var(--text3)" }}>
              {!status?.mode ? "mode inactif" : connected ? `● écran connecté (vu il y a ${Math.round((seen ?? 0) / 1000)} s)` : "○ en attente de l'écran… (jusqu'à 1 min : il lit le mode à son prochain contrôle)"}
            </span>
          </div>
        )}
        {device && fwState === false && (
          <p role="alert" style={{ ...muted, marginTop: 8, color: "#f87171", fontWeight: 600 }}>
            ⚠ Cet écran exécute le firmware « {status?.firmware} » : il ne connaît pas le banc d&apos;essai et ne fera jamais de contrôle rapide. Reflashez <code>pod_uno_r4</code> (version r4tft28-2.1 ou plus), puis redémarrez la carte.
          </p>
        )}
        {device && fwState === true && <p style={{ ...muted, marginTop: 8 }}>Firmware de l&apos;écran : {status?.firmware} ✓</p>}
        <p style={{ ...muted, marginTop: 8 }}>Le mode accélère les contrôles de l&apos;écran (≈ toutes les 3 s) pendant 30 minutes, puis s&apos;éteint tout seul. {device && !device.isOnline ? "⚠ L'appareil semble hors ligne." : ""}</p>
      </div>

      {/* 2. Éditeur */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <div style={label}>2 · Animation — image {idx + 1} / {n}{frameCost !== null ? ` · ${frameCost} o depuis l'image précédente` : ""}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" style={canUndo ? btn : btnOff} onClick={undo} disabled={!canUndo} aria-label="Annuler" title="Annuler (Ctrl+Z)">↶ Annuler</button>
            <button type="button" style={canRedo ? btn : btnOff} onClick={redo} disabled={!canRedo} aria-label="Rétablir" title="Rétablir (Ctrl+Maj+Z ou Ctrl+Y)">↷ Rétablir</button>
          </div>
        </div>

        {/* Outils */}
        <div role="toolbar" aria-label="Outils" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {TOOLS.map((t) => <button key={t.id} type="button" onClick={() => setTool(t.id)} style={tool === t.id ? btnOn : btn} aria-pressed={tool === t.id} title={`${t.name} (${t.key})`}>{t.icon} {t.name}</button>)}
        </div>
        <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          {usesBrush && (
            <label style={{ ...muted, display: "inline-flex", gap: 6, alignItems: "center" }}>Pinceau {brushSize} px
              <input type="range" min={1} max={8} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} aria-label="Taille du pinceau" />
              <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={brushRound} onChange={(e) => setBrushRound(e.target.checked)} /> rond</label>
            </label>
          )}
          {isShape && <label style={{ ...muted, display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} /> plein</label>}
          <span style={{ ...muted, marginLeft: "auto" }}>{hover ? `x ${hover.x} · y ${hover.y}` : "clic droit = gomme"}</span>
        </div>

        <canvas
          ref={canvasRef} width={W} height={H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)} onContextMenu={(e) => e.preventDefault()}
          aria-label="Zone de dessin 128 par 64"
          style={{ width: "100%", aspectRatio: "2 / 1", imageRendering: "pixelated", borderRadius: 8, border: "1px solid var(--border)", touchAction: "none", cursor: "crosshair", display: "block" }}
        />

        {/* Lecture et images */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          <button type="button" style={btn} onClick={() => { setPlaying(false); dispatch({ type: "step", delta: -1 }); }} aria-label="Image précédente" title="Image précédente (←)">⏮</button>
          <button type="button" style={playing ? btnOn : btn} onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Lecture"} title="Lecture / pause (espace)">{playing ? "⏸" : "▶"}</button>
          <button type="button" style={btn} onClick={() => { setPlaying(false); dispatch({ type: "step", delta: 1 }); }} aria-label="Image suivante" title="Image suivante (→)">⏭</button>
          <span style={{ width: 6 }} />
          <button type="button" style={btn} onClick={addFrame} title="Nouvelle image vide après celle-ci">＋ Image</button>
          <button type="button" style={btn} onClick={dupFrame} title="Dupliquer l'image">⎘ Dupliquer</button>
          <button type="button" style={{ ...btn, color: "#f87171" }} onClick={delFrame} title="Supprimer l'image">✕ Supprimer</button>
          <button type="button" style={idx > 0 ? btn : btnOff} onClick={() => moveFrame(-1)} disabled={idx === 0} title="Reculer l'image dans la timeline">◀ Reculer</button>
          <button type="button" style={idx < n - 1 ? btn : btnOff} onClick={() => moveFrame(1)} disabled={idx >= n - 1} title="Avancer l'image dans la timeline">Avancer ▶</button>
        </div>

        {/* Timeline */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "0.6rem 0 0.2rem" }}>
          {frames.map((f, i) => <Thumb key={i} frame={f} fg={fg} bg={bg} index={i} selected={i === idx} onClick={() => { setPlaying(false); dispatch({ type: "nav", cur: i }); }} />)}
        </div>

        {/* Transformations de l'image courante */}
        <details style={{ marginTop: 8 }} open>
          <summary style={{ ...label, cursor: "pointer" }}>Transformer l&apos;image</summary>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
            <button type="button" style={btn} onClick={() => editCur(invert)} title="Inverser allumé / éteint">◐ Inverser</button>
            <button type="button" style={btn} onClick={() => editCur(() => blank())} title="Effacer l'image">⌧ Effacer</button>
            <button type="button" style={btn} onClick={() => editCur(flipH)} title="Retourner gauche ↔ droite">⇋ Miroir</button>
            <button type="button" style={btn} onClick={() => editCur(flipV)} title="Retourner haut ↔ bas">⇅ Retourner</button>
            <span style={{ width: 8 }} />
            {([["←", -1, 0], ["→", 1, 0], ["↑", 0, -1], ["↓", 0, 1]] as [string, number, number][]).map(([l, dx, dy]) => (
              <button key={l} type="button" style={btn} onClick={() => editCur((f) => shifted(f, dx * shiftStep, dy * shiftStep))} title={`Décaler de ${shiftStep} px (bouclé)`}>{l}</button>
            ))}
            <select value={shiftStep} onChange={(e) => setShiftStep(Number(e.target.value))} aria-label="Pas du décalage" style={btn}>
              {[1, 2, 4, 8, 16].map((s) => <option key={s} value={s}>{s} px</option>)}
            </select>
          </div>
        </details>

        {/* Animation entière */}
        <details style={{ marginTop: 8 }}>
          <summary style={{ ...label, cursor: "pointer" }}>Mouvement et ordre des images</summary>
          <div style={{ marginTop: 6 }}>
            <p style={muted}>Crée un mouvement à partir de l&apos;image courante : N images, chacune décalée de (dx, dy) de plus que la précédente. <strong>Remplace toute l&apos;animation</strong> (annulable).</p>
            <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
              <label style={muted}>Images <input type="number" min={2} max={CLIP.MAX_FRAMES} value={mvN} onChange={(e) => setMvN(Number(e.target.value) || 2)} style={{ ...btn, width: 62 }} /></label>
              <label style={muted}>dx <input type="number" min={-64} max={64} value={mvDx} onChange={(e) => setMvDx(Number(e.target.value) || 0)} style={{ ...btn, width: 62 }} /></label>
              <label style={muted}>dy <input type="number" min={-32} max={32} value={mvDy} onChange={(e) => setMvDy(Number(e.target.value) || 0)} style={{ ...btn, width: 62 }} /></label>
              <label style={{ ...muted, display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={mvWrap} onChange={(e) => setMvWrap(e.target.checked)} /> boucler sur les bords</label>
              <button type="button" style={btnOn} onClick={generateMotion}>➜ Générer le mouvement</button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <button type="button" style={btn} onClick={reverseAll} title="Inverser le sens de lecture">⇄ Inverser le sens</button>
              <button type="button" style={n >= 3 && n * 2 - 2 <= CLIP.MAX_FRAMES ? btn : btnOff} onClick={pingPong} disabled={!(n >= 3 && n * 2 - 2 <= CLIP.MAX_FRAMES)} title="Ajoute la lecture à l'envers (sans doubler les extrémités)">↔ Aller-retour</button>
            </div>
          </div>
        </details>

        {/* Aide au dessin */}
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          <label style={{ ...muted, display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={onionPrev} onChange={(e) => setOnionPrev(e.target.checked)} /> <span style={{ color: "#fb923c" }}>onion précédente</span></label>
          <label style={{ ...muted, display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={onionNext} onChange={(e) => setOnionNext(e.target.checked)} /> <span style={{ color: "#60a5fa" }}>onion suivante</span></label>
          <label style={{ ...muted, display: "inline-flex", gap: 4, alignItems: "center" }} title="Lignes tous les 8 pixels : un octet = 8 pixels, c'est l'unité de coût d'une différence"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> grille d&apos;octets</label>
        </div>

        {/* Délais, boucles, couleurs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.8rem", marginTop: 10 }}>
          <div>
            <div style={label}>Délai de l&apos;image : {delays[idx] ?? 100} ms</div>
            <input
              type="range" min={20} max={1000} step={10} value={delays[idx] ?? 100} aria-label="Délai de l'image" style={{ width: "100%" }}
              onPointerDown={() => dispatch({ type: "begin" })} onKeyDown={() => dispatch({ type: "begin" })}
              onChange={(e) => setDelay(Number(e.target.value))}
            />
            <button type="button" style={{ ...btn, marginTop: 4 }} onClick={() => edit((d) => ({ ...d, delays: d.delays.map(() => d.delays[d.cur] ?? 100) }))}>Appliquer à toutes</button>
          </div>
          <div>
            <div style={label}>Boucles : {loops === 0 ? "∞" : loops}</div>
            <input type="range" min={1} max={30} value={Math.max(1, loops)} disabled={loops === 0} onChange={(e) => setLoops(Number(e.target.value))} style={{ width: "100%" }} aria-label="Boucles" />
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.78rem", marginTop: 4 }}>
              <input type="checkbox" checked={loops === 0} onChange={(e) => setLoops(e.target.checked ? 0 : 3)} />
              ∞ en boucle (jusqu&apos;au toucher ou au prochain envoi)
            </label>
            <p style={muted}>{loops === 0 ? `Un tour ≈ ${(playMs / 1000).toFixed(1)} s` : `Durée de lecture ≈ ${(playMs / 1000).toFixed(1)} s`}</p>
          </div>
          <div>
            <div style={label}>Couleurs (allumé / fond)</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} aria-label="Couleur des pixels allumés" />
              <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Couleur du fond" />
            </div>
          </div>
        </div>
        <p style={{ ...muted, marginTop: 8 }}>Raccourcis : Ctrl+Z annuler · Ctrl+Maj+Z / Ctrl+Y rétablir · P E L R O G outils · ← → images · espace lecture · [ ] pinceau.</p>
      </div>

      {/* 3. Modèles */}
      <div style={card}>
        <div style={label}>3 · Modèles de test (remplacent l&apos;animation — annulable)</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
          <button type="button" style={btn} onClick={() => loadAnim(presetBall(), true)}>🏀 Balle</button>
          <button type="button" style={btn} onClick={() => loadAnim(presetWave(), true)}>〰 Vague</button>
          <button type="button" style={btn} onClick={() => loadAnim(presetNoise(), true)}>▒ Bruit léger</button>
          <button type="button" style={btn} onClick={() => loadAnim(presetFlash(), true)}>⚡ Plein écran clignotant (pire cas)</button>
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 24))} aria-label="Texte défilant" style={{ ...btn, width: 110 }} />
          <button type="button" style={btn} onClick={() => loadAnim(presetText(text), true)}>🔤 Texte défilant</button>
        </div>
        <p style={{ ...muted, marginTop: 6 }}>Le « plein écran clignotant » change tous les pixels à chaque image : c&apos;est la limite de vitesse de l&apos;écran. Baissez le délai (20 ms minimum) pour la trouver. Un modèle devient « fait à la main » dès que vous le modifiez.</p>
      </div>

      {/* 4. Envoi + mesures */}
      <div style={card}>
        <div style={label}>4 · Envoyer et mesurer</div>
        {stats ? (
          <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", margin: "0.5rem 0" }}>
            <div><div style={{ fontWeight: 800, fontSize: "1.05rem", color: sizeColor }}>{stats.bytes} o</div><div style={muted}>clip (max {CLIP.MAX_CLIP_BYTES})</div></div>
            <div><div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{stats.avgTransitionBytes} o</div><div style={muted}>par image (moy.), max {stats.maxTransitionBytes}</div></div>
            <div><div style={{ fontWeight: 800, fontSize: "1.05rem" }}>≈ {(stats.bytes / ASSUMED_LINK_BYTES_PER_SEC).toFixed(1)} s</div><div style={muted}>téléchargement (estimation)</div></div>
          </div>
        ) : <p style={{ ...muted, color: "#f87171" }}>Animation invalide (vérifiez images, délais, boucles).</p>}
        {stats && !stats.fitsDevice && <p role="alert" style={{ ...muted, color: "#f87171" }}>Trop gros pour l&apos;appareil : moins d&apos;images, ou moins de pixels qui changent entre deux images.</p>}
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", margin: "0.4rem 0 0.7rem" }}>
          <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 60))} placeholder="Titre de l'animation" aria-label="Titre de l'animation" style={{ ...btn, minWidth: 220, flex: "1 1 220px" }} />
          <label style={{ ...muted, display: "inline-flex", gap: 6, alignItems: "center", opacity: handmade ? 1 : 0.55 }} title={handmade ? "" : "Un modèle de test n'est jamais enregistré dans la galerie : modifiez-le pour en faire votre animation."}>
            <input type="checkbox" checked={handmade && toGallery} disabled={!handmade} onChange={(e) => setToGallery(e.target.checked)} /> aussi dans la galerie <a href="/gallery-anim" style={{ color: "var(--accent)" }}>Animations</a>
            {!handmade && " (modèle de test : non)"}
          </label>
        </div>
        <button type="button" onClick={send} disabled={busy || !deviceId || !stats || !stats.fitsDevice} style={{ ...btnOn, padding: "0.55rem 1.2rem", fontWeight: 700, opacity: busy || !deviceId || !stats?.fitsDevice ? 0.5 : 1 }}>
          {busy ? "Envoi…" : "📺 Envoyer au TFT 2.8\""}
        </button>
        <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", marginLeft: 8, verticalAlign: "middle" }}>
          <button type="button" style={btn} onClick={exportGif} disabled={!stats} title="GIF animé ×4 (couleurs de l'écran)">⬇ GIF</button>
          <button type="button" style={btn} onClick={exportProject} title="Projet modifiable (.json)">⬇ Projet</button>
          <label style={{ ...btn, cursor: "pointer" }} title="Recharger un projet .json">⬆ Importer<input type="file" accept=".json,application/json" hidden onChange={(e) => { importProject(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <button type="button" style={btn} onClick={saveOnly} disabled={busy || !handmade || !authorDevice || !stats} title={handmade ? "Enregistrer dans la galerie sans l'envoyer à l'écran" : "Un modèle de test n'est pas enregistrable"}>💾 Galerie seule</button>
        </div>
        {msg && <p role="status" style={{ ...muted, color: msg.ok ? "#4ade80" : "#f87171", marginTop: 8 }}>{msg.text}</p>}

        <div style={{ ...label, marginTop: "1rem", display: "flex", gap: 10, alignItems: "center" }}>
          Mesures renvoyées par l&apos;écran
          {status && (status.results.length > 0 || status.log.length > 0) && <button type="button" style={{ ...btn, padding: "2px 8px", fontSize: "0.7rem" }} onClick={clearHistory} title="Efface les mesures et le journal de cet écran">Effacer l&apos;historique</button>}
        </div>
        {!status || status.results.length === 0 ? <p style={{ ...muted, marginTop: 4 }}>Aucune mesure pour l&apos;instant. Elles apparaissent ici après la lecture d&apos;un clip.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {status.results.map((r, i) => <ResultRow key={`${r.clipId}-${r.at}`} r={r} latest={i === 0} />)}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={label}>Journal du banc d&apos;essai</div>
        {!status || status.log.length === 0 ? <p style={{ ...muted, marginTop: 4 }}>Rien pour l&apos;instant. Chaque étape y apparaît : mode activé, clip envoyé, écran connecté, clip téléchargé, lecture terminée.</p> : (
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, fontFamily: "JetBrains Mono, monospace", fontSize: "0.72rem", lineHeight: 1.7, color: "var(--text2)" }}>
            {status.log.map((l, i) => <li key={`${l.t}-${i}`}><span style={{ color: "var(--text3)" }}>{new Date(l.t).toLocaleTimeString()}</span> {l.text}</li>)}
          </ul>
        )}
      </div>

      <p style={muted}>Brouillon enregistré dans ce navigateur. Les clips envoyés expirent au bout d&apos;1 h. Un toucher sur l&apos;écran interrompt la lecture.</p>
    </div>
  );
}

function ResultRow({ r, latest }: { r: BenchResult; latest: boolean }) {
  const secs = r.elapsedMs / 1000, fps = secs > 0 ? r.frames / secs : 0;
  const ok = !r.error && r.overruns === 0;
  return (
    <div style={{ opacity: latest ? 1 : 0.55, padding: "0.5rem 0.7rem", borderRadius: 8, border: `1px solid ${r.error ? "rgba(248,113,113,0.4)" : ok ? "rgba(74,222,128,0.3)" : "rgba(251,146,60,0.4)"}`, background: "var(--bg)", fontSize: "0.78rem", lineHeight: 1.5 }}>
      <strong style={{ color: r.error ? "#f87171" : ok ? "#4ade80" : "#fb923c" }}>{r.error ? `✗ ${r.error}` : ok ? "✓ cadence tenue" : `⚠ ${r.overruns} image(s) démarrée(s) en retard`}</strong>{" "}
      <span style={{ color: "var(--text3)" }}>{latest ? "dernier essai · " : ""}clip {r.clipId} · {new Date(r.at).toLocaleTimeString()}{r.stopped ? " · interrompu au toucher" : ""}</span>
      <div style={{ color: "var(--text2)" }}>
        {r.frames} images en {secs.toFixed(2)} s (prévu {(r.expectedMs / 1000).toFixed(2)} s) → <strong>{fps.toFixed(1)} images/s</strong> ·
        travail par image : moy. {(r.avgWorkUs / 1000).toFixed(1)} ms, max {(r.maxWorkUs / 1000).toFixed(1)} ms
        {r.avgWorkUs > 0 ? ` (capacité ≈ ${Math.floor(1_000_000 / r.avgWorkUs)} images/s)` : ""} · retard de démarrage max {r.maxLateMs} ms
        {r.minSlackMs !== undefined ? ` · marge min ${r.minSlackMs} ms` : ""} ·
        téléchargement {(r.downloadMs / 1000).toFixed(2)} s ({r.bytes} o{r.downloadMs > 0 ? `, ≈ ${(r.bytes / (r.downloadMs / 1000) / 1000).toFixed(0)} Ko/s` : ""}) · tas libre {(r.heapFree / 1000).toFixed(1)} Ko
      </div>
    </div>
  );
}
