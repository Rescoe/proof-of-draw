"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef, useReducer, useMemo } from "react";
import { SCREEN_PROFILES, ScreenId } from "@/lib/screenProfiles";
import { OwnedDevice } from "@/lib/deviceStore";
import { canvasToScreenPayload } from "@/lib/canvasToScreen";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tool =
  | "brush" | "eraser" | "fill"
  | "line" | "rect" | "ellipse"
  | "eyedropper" | "move";

interface Point { x: number; y: number }

interface PanelState {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

interface ImageImport {
  data: ImageData | null;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  dithering: "none" | "floyd" | "ordered";
  threshold: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAW_WINDOW_SEC  = 900;
const MAX_HISTORY      = 50;
const LOCALSTORAGE_KEY = (deviceId: string, screenId: string) =>
  `pod_cooldown_${deviceId}_${screenId}`;

const TOOL_ICONS: Record<Tool, string> = {
  brush:      "✏️",
  eraser:     "⬜",
  fill:       "🪣",
  line:       "╱",
  rect:       "▭",
  ellipse:    "◯",
  eyedropper: "🩸",
  move:       "✥",
};

const TOOL_LABELS: Record<Tool, string> = {
  brush:      "Pinceau (B)",
  eraser:     "Gomme (E)",
  fill:       "Remplissage (F)",
  line:       "Ligne (L)",
  rect:       "Rectangle (R)",
  ellipse:    "Ellipse (O)",
  eyedropper: "Pipette (I)",
  move:       "Déplacer (V)",
};

const TOOL_SHORTCUTS: Record<string, Tool> = {
  b: "brush", e: "eraser", f: "fill",
  l: "line",  r: "rect",   o: "ellipse",
  i: "eyedropper", v: "move",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function colorsClose(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, tol = 30) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < tol;
}

// Flood fill algorithm
function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number, startY: number,
  fillColor: string,
  w: number, h: number,
) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const data      = imageData.data;
  const idx       = (x: number, y: number) => (y * w + x) * 4;
  const si        = idx(startX, startY);
  const target    = { r: data[si], g: data[si + 1], b: data[si + 2] };
  const fill      = hexToRgb(fillColor);

  if (colorsClose(target, fill, 5)) return;

  const stack = [[startX, startY]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    const i = idx(x, y);
    const c = { r: data[i], g: data[i + 1], b: data[i + 2] };
    if (!colorsClose(c, target)) continue;
    data[i]     = fill.r;
    data[i + 1] = fill.g;
    data[i + 2] = fill.b;
    data[i + 3] = 255;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  ctx.putImageData(imageData, 0, 0);
}

// Floyd-Steinberg dithering
function ditherFloyd(imageData: ImageData, palette: string[]): ImageData {
  const d    = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const data = d.data;
  const w    = d.width;
  const h    = d.height;
  const rgbs = palette.map(hexToRgb);

  function nearest(r: number, g: number, b: number) {
    let best = 0, bestDist = Infinity;
    rgbs.forEach((c, i) => {
      const dist = Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return rgbs[best];
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i   = (y * w + x) * 4;
      const or_ = data[i], og = data[i + 1], ob = data[i + 2];
      const n   = nearest(or_, og, ob);
      data[i] = n.r; data[i + 1] = n.g; data[i + 2] = n.b;
      const er = or_ - n.r, eg = og - n.g, eb = ob - n.b;
      const spread = (dx: number, dy: number, f: number) => {
        const ni = ((y + dy) * w + (x + dx)) * 4;
        if (x + dx >= 0 && x + dx < w && y + dy < h) {
          data[ni]     = Math.min(255, Math.max(0, data[ni]     + er * f));
          data[ni + 1] = Math.min(255, Math.max(0, data[ni + 1] + eg * f));
          data[ni + 2] = Math.min(255, Math.max(0, data[ni + 2] + eb * f));
        }
      };
      spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16);
      spread(0, 1, 5 / 16); spread(1,  1, 1 / 16);
    }
  }
  return d;
}

// Ordered (Bayer) dithering
function ditherOrdered(imageData: ImageData, palette: string[], threshold: number): ImageData {
  const bayer = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  const d     = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const data  = d.data;
  const rgbs  = palette.map(hexToRgb);

  function nearest(r: number, g: number, b: number) {
    let best = 0, bestDist = Infinity;
    rgbs.forEach((c, i) => {
      const dist = Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return rgbs[best];
  }

  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const i   = (y * d.width + x) * 4;
      const t   = (bayer[y % 4][x % 4] / 16 - 0.5) * threshold;
      const r_  = Math.min(255, Math.max(0, data[i]     + t * 255));
      const g_  = Math.min(255, Math.max(0, data[i + 1] + t * 255));
      const b_  = Math.min(255, Math.max(0, data[i + 2] + t * 255));
      const n   = nearest(r_, g_, b_);
      data[i] = n.r; data[i + 1] = n.g; data[i + 2] = n.b;
    }
  }
  return d;
}

// ─── Cooldown persistence ─────────────────────────────────────────────────────

function saveCooldown(deviceId: string, screenId: string, expiresAt: number) {
  try { localStorage.setItem(LOCALSTORAGE_KEY(deviceId, screenId), String(expiresAt)); } catch {}
}

function loadCooldown(deviceId: string, screenId: string): number {
  try {
    const v = localStorage.getItem(LOCALSTORAGE_KEY(deviceId, screenId));
    if (!v) return 0;
    const remaining = Math.ceil((parseInt(v) - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  } catch { return 0; }
}

function clearCooldown(deviceId: string, screenId: string) {
  try { localStorage.removeItem(LOCALSTORAGE_KEY(deviceId, screenId)); } catch {}
}

// ─── Panel dragging hook ──────────────────────────────────────────────────────

function useDraggable(initialX: number, initialY: number) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragging      = useRef(false);
  const offset        = useRef({ x: 0, y: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    offset.current   = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const mm = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
    };
    const mu = () => { dragging.current = false; };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    return () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); };
  }, []);

  return { pos, setPos, onMouseDown };
}

// ─── Floating Panel ───────────────────────────────────────────────────────────

function FloatingPanel({
  id, title, children, defaultX, defaultY, visible, onClose,
}: {
  id: string; title: string; children: React.ReactNode;
  defaultX: number; defaultY: number; visible: boolean; onClose: () => void;
}) {
  const { pos, onMouseDown } = useDraggable(defaultX, defaultY);
  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: pos.x, top: pos.y,
        zIndex: 1000,
        background: "rgba(18, 18, 24, 0.92)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        minWidth: 180,
        userSelect: "none",
      }}
    >
      <div
        onMouseDown={onMouseDown}
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          cursor: "grab",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          fontWeight: 600,
          color: "rgba(255,255,255,0.6)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <span>{title}</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 0 0 8px" }}
        >×</button>
      </div>
      <div style={{ padding: "10px 12px" }}>{children}</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DrawCanvasPage() {
  const params    = useParams();
  const router    = useRouter();

  const rawDevice = params.device;
  const rawScreen = params.screen;
  const deviceId  = (Array.isArray(rawDevice) ? rawDevice[0] : rawDevice) as string;
  const screenId  = (Array.isArray(rawScreen) ? rawScreen[0] : rawScreen) as ScreenId;
  const profile   = SCREEN_PROFILES[screenId];

  // ── State ──────────────────────────────────────────────────────────────────
  const [device, setDevice]       = useState<OwnedDevice | null>(null);
  const [sending, setSending]     = useState(false);
  const [status, setStatus]       = useState<{ type: "ok" | "error" | "wait" | "ban"; msg: string } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Tool state
  const [tool, setTool]           = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(2);
  const [activeColor, setActiveColor] = useState<string>("#000000");
  const [showGrid, setShowGrid]   = useState(false);
  const [gridSize, setGridSize]   = useState(1);
  const [opacity, setOpacity]     = useState(100);

  // Panels visibility (floating in fullscreen, sidebar otherwise)
  const [panels, setPanels] = useState({
    tools:   true,
    palette: true,
    image:   false,
    info:    false,
  });

  const togglePanel = (id: keyof typeof panels) =>
    setPanels(p => ({ ...p, [id]: !p[id] }));

  // Canvas refs
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const overlayRef  = useRef<HTMLCanvasElement>(null); // preview layer for shapes/lines
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drawing state
  const drawing       = useRef(false);
  const lastPoint     = useRef<Point | null>(null);
  const shapeStart    = useRef<Point | null>(null);
  const history       = useRef<ImageData[]>([]);
  const historyIndex  = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Image import state
  const [imgImport, setImgImport] = useState<ImageImport>({
    data: null, x: 0, y: 0, scale: 1, opacity: 0.6,
    dithering: "floyd", threshold: 0.4,
  });
  const [imgMode, setImgMode]     = useState(false); // true = placing imported image

  // Cooldown
  const [cooldown, setCooldown]       = useState(0);
  const cooldownRef                   = useRef<ReturnType<typeof setInterval> | null>(null);
  const [banWarning, setBanWarning]   = useState(false);

  // ── Canvas dimensions ──────────────────────────────────────────────────────
  const W = profile?.width  ?? 128;
  const H = profile?.height ?? 64;

  // Scale for display: target max 90% of viewport
  const [scale, setScale] = useState(1);
  const containerRef       = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function computeScale() {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      const maxW = clientWidth  - 40;
      const maxH = clientHeight - 40;
      const s    = Math.min(Math.floor(maxW / W), Math.floor(maxH / H));
      setScale(Math.max(1, Math.min(s, 8)));
    }
    computeScale();
    window.addEventListener("resize", computeScale);
    return () => window.removeEventListener("resize", computeScale);
  }, [W, H, fullscreen]);

  const displayW = W * scale;
  const displayH = H * scale;

  // ── History ────────────────────────────────────────────────────────────────
  const saveHistory = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, W, H);
    history.current = history.current.slice(0, historyIndex.current + 1);
    history.current.push(snap);
    if (history.current.length > MAX_HISTORY) history.current.shift();
    historyIndex.current = history.current.length - 1;
    setCanUndo(historyIndex.current > 0);
    setCanRedo(false);
  }, [W, H]);

  const undo = useCallback(() => {
    if (historyIndex.current <= 0) return;
    historyIndex.current--;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.putImageData(history.current[historyIndex.current], 0, 0);
    setCanUndo(historyIndex.current > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current++;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.putImageData(history.current[historyIndex.current], 0, 0);
    setCanUndo(true);
    setCanRedo(historyIndex.current < history.current.length - 1);
  }, []);

  // ── Canvas init ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    canvas.width  = W; canvas.height  = H;
    overlay.width = W; overlay.height = H;

    const ctx = canvas.getContext("2d")!;
    // White background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);
    saveHistory();
  }, [W, H, saveHistory]);

  // ── Device load + cooldown restore ────────────────────────────────────────
  useEffect(() => {
    if (!profile || !deviceId || !screenId) { router.push("/draw"); return; }

    // Restore cooldown from localStorage
    const remaining = loadCooldown(deviceId, screenId);
    if (remaining > 0) startCooldown(remaining);

    let cancelled = false;
    async function loadDevice(attempt = 0) {
      try {
        const res  = await fetch("/api/devices?mine=1");
        const data = await res.json();
        if (cancelled) return;
        const d = (data.devices ?? []).find(
          (d: OwnedDevice) => String(d.deviceId).trim() === String(deviceId).trim()
        );
        if (!d || !d.screens?.includes(screenId)) {
          if (attempt < 5 && !cancelled) setTimeout(() => loadDevice(attempt + 1), 1000);
          else if (!cancelled) router.push("/draw");
          return;
        }
        setDevice(d);
      } catch {
        if (!cancelled) router.push("/draw");
      }
    }
    loadDevice();
    return () => { cancelled = true; };
  }, [deviceId, screenId, profile, router]);

  // ── Cooldown timer ─────────────────────────────────────────────────────────
  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          cooldownRef.current = null;
          setStatus(null);
          setBanWarning(false);
          clearCooldown(deviceId, screenId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [deviceId, screenId]);

  useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

  const canSend = cooldown === 0 && !sending;

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.key === "y" && (e.ctrlKey || e.metaKey)) || (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (e.key === "g") { setShowGrid(g => !g); return; }
if (e.key === "f") { setFullscreen(f => !f); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (e.ctrlKey) {
          const ctx = canvasRef.current?.getContext("2d");
          if (ctx) { ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H); saveHistory(); }
        }
        return;
      }

      const t = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (t) setTool(t);

      // +/- zoom
      if (e.key === "+" || e.key === "=") setScale(s => Math.min(s + 1, 8));
      if (e.key === "-")                  setScale(s => Math.max(s - 1, 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, W, H, saveHistory]);

  // ── Pointer → canvas coordinates ──────────────────────────────────────────
  const toCanvasPoint = useCallback((e: React.PointerEvent | React.TouchEvent, el: HTMLCanvasElement): Point => {
    const rect = el.getBoundingClientRect();
    let cx: number, cy: number;
    if ("touches" in e) {
      cx = e.touches[0].clientX - rect.left;
      cy = e.touches[0].clientY - rect.top;
    } else {
      cx = (e as React.PointerEvent).clientX - rect.left;
      cy = (e as React.PointerEvent).clientY - rect.top;
    }
    return {
      x: Math.max(0, Math.min(W - 1, Math.floor(cx / scale))),
      y: Math.max(0, Math.min(H - 1, Math.floor(cy / scale))),
    };
  }, [W, H, scale]);

  // ── Drawing primitives ────────────────────────────────────────────────────
  const drawLine = useCallback((ctx: CanvasRenderingContext2D, a: Point, b: Point, size: number, color: string, alpha = 1) => {
    ctx.globalAlpha    = alpha;
    ctx.strokeStyle    = color;
    ctx.lineWidth      = size;
    ctx.lineCap        = "round";
    ctx.lineJoin       = "round";
    ctx.beginPath();
    ctx.moveTo(a.x + 0.5, a.y + 0.5);
    ctx.lineTo(b.x + 0.5, b.y + 0.5);
    ctx.stroke();
    ctx.globalAlpha    = 1;
  }, []);

  const drawRect = useCallback((ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.globalAlpha = 1;
  }, []);

  const drawEllipse = useCallback((ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, []);

  // ── Pointer events ─────────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !overlayRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt  = toCanvasPoint(e, e.currentTarget);
    const ctx = canvasRef.current.getContext("2d")!;

    drawing.current   = true;
    lastPoint.current = pt;
    shapeStart.current = pt;

    if (tool === "eyedropper") {
      const px = ctx.getImageData(pt.x, pt.y, 1, 1).data;
      const hex = "#" + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, "0")).join("");
      setActiveColor(hex);
      drawing.current = false;
      return;
    }

    if (tool === "fill") {
      saveHistory();
      floodFill(ctx, pt.x, pt.y, activeColor, W, H);
      drawing.current = false;
      return;
    }

    if (tool === "brush" || tool === "eraser") {
      ctx.globalAlpha = opacity / 100;
      ctx.fillStyle   = tool === "eraser" ? "#FFFFFF" : activeColor;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }, [tool, activeColor, brushSize, opacity, W, H, toCanvasPoint, saveHistory]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !canvasRef.current || !overlayRef.current) return;
    const pt      = toCanvasPoint(e, e.currentTarget);
    const ctx     = canvasRef.current.getContext("2d")!;
    const overlay = overlayRef.current.getContext("2d")!;

    if (tool === "brush" || tool === "eraser") {
      const color = tool === "eraser" ? "#FFFFFF" : activeColor;
      if (lastPoint.current) drawLine(ctx, lastPoint.current, pt, brushSize, color, opacity / 100);
      lastPoint.current = pt;
    } else if (tool === "line" || tool === "rect" || tool === "ellipse") {
      overlay.clearRect(0, 0, W, H);
      if (shapeStart.current) {
        if (tool === "line")    drawLine(overlay, shapeStart.current, pt, brushSize, activeColor);
        if (tool === "rect")    drawRect(overlay, shapeStart.current, pt, activeColor);
        if (tool === "ellipse") drawEllipse(overlay, shapeStart.current, pt, activeColor);
      }
    }
  }, [tool, activeColor, brushSize, opacity, W, H, toCanvasPoint, drawLine, drawRect, drawEllipse]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !canvasRef.current || !overlayRef.current) return;
    const pt      = toCanvasPoint(e, e.currentTarget);
    const ctx     = canvasRef.current.getContext("2d")!;
    const overlay = overlayRef.current.getContext("2d")!;

    if (tool === "line" || tool === "rect" || tool === "ellipse") {
      if (shapeStart.current) {
        if (tool === "line")    drawLine(ctx, shapeStart.current, pt, brushSize, activeColor);
        if (tool === "rect")    drawRect(ctx, shapeStart.current, pt, activeColor);
        if (tool === "ellipse") drawEllipse(ctx, shapeStart.current, pt, activeColor);
      }
      overlay.clearRect(0, 0, W, H);
    }

    drawing.current = false;
    lastPoint.current = null;
    shapeStart.current = null;
    saveHistory();
  }, [tool, activeColor, brushSize, W, H, toCanvasPoint, drawLine, drawRect, drawEllipse, saveHistory]);

  // ── Clear ──────────────────────────────────────────────────────────────────
  const clearCanvas = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);
    saveHistory();
  }, [W, H, saveHistory]);

  // ── Image import ───────────────────────────────────────────────────────────
  const handleFileImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const offscreen = document.createElement("canvas");
        offscreen.width  = W;
        offscreen.height = H;
        const ctx = offscreen.getContext("2d")!;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        const raw = ctx.getImageData(0, 0, W, H);
        setImgImport(s => ({ ...s, data: raw, x: 0, y: 0, scale: 1 }));
        setImgMode(true);
        togglePanel("image");
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [W, H]);

  const applyImport = useCallback(() => {
    if (!imgImport.data || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d")!;

    // Apply dithering
    let processed = imgImport.data;
    const palette  = profile?.colors ?? ["#000000", "#FFFFFF"];
    if (imgImport.dithering === "floyd")   processed = ditherFloyd(processed, palette);
    if (imgImport.dithering === "ordered") processed = ditherOrdered(processed, palette, imgImport.threshold);

    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    off.getContext("2d")!.putImageData(processed, 0, 0);

    ctx.globalAlpha = 1;
    ctx.drawImage(off,
      0, 0, W, H,
      imgImport.x, imgImport.y,
      Math.round(W * imgImport.scale),
      Math.round(H * imgImport.scale)
    );
    saveHistory();
    setImgMode(false);
    setImgImport(s => ({ ...s, data: null }));
  }, [imgImport, W, H, profile, saveHistory]);

  // ── Image import overlay rendering ─────────────────────────────────────────
  useEffect(() => {
    const overlay = overlayRef.current?.getContext("2d");
    if (!overlay) return;
    overlay.clearRect(0, 0, W, H);
    if (!imgMode || !imgImport.data) return;

    let processed = imgImport.data;
    const palette  = profile?.colors ?? ["#000000", "#FFFFFF"];
    if (imgImport.dithering === "floyd")   processed = ditherFloyd(processed, palette);
    if (imgImport.dithering === "ordered") processed = ditherOrdered(processed, palette, imgImport.threshold);

    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    off.getContext("2d")!.putImageData(processed, 0, 0);

    overlay.globalAlpha = imgImport.opacity;
    overlay.drawImage(off, imgImport.x, imgImport.y,
      Math.round(W * imgImport.scale),
      Math.round(H * imgImport.scale)
    );
    overlay.globalAlpha = 1;
  }, [imgImport, imgMode, W, H, profile]);

  // ── Send ───────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!device || !canSend || !canvasRef.current) return;
    setSending(true);
    setStatus(null);

    try {
      const payload = canvasToScreenPayload(canvasRef.current, screenId);
      const body =
        screenId === "eink29bwr"
          ? { screen: screenId, deviceId, black: (payload as any).black, red: (payload as any).red }
          : { screen: screenId, deviceId, buffer: (payload as any).buffer };

      const res  = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 429) {
        const secs = data.nextDrawIn ?? DRAW_WINDOW_SEC;
        saveCooldown(deviceId, screenId, Date.now() + secs * 1000);
        startCooldown(secs);
        setBanWarning(true);
        setStatus({ type: "wait", msg: "" });
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const secs = data.nextDrawIn ?? DRAW_WINDOW_SEC;
      saveCooldown(deviceId, screenId, Date.now() + secs * 1000);
      startCooldown(secs);
      setStatus({ type: "ok", msg: "" });
    } catch (err: any) {
      setStatus({ type: "error", msg: err.message || "Erreur réseau" });
      setTimeout(() => setStatus(null), 5000);
    } finally {
      setSending(false);
    }
  }, [device, canSend, canvasRef, screenId, deviceId, startCooldown]);

  if (!profile) return null;

  // ── Colors from profile ────────────────────────────────────────────────────
  const colors      = profile.colors;
  const colorLabels = profile.colorLabels;

  // Progress bar %
  const progress = cooldown > 0 ? ((DRAW_WINDOW_SEC - cooldown) / DRAW_WINDOW_SEC) * 100 : 0;

  // ── Canvas cursor ──────────────────────────────────────────────────────────
  const cursorStyle =
    !canSend             ? "not-allowed"
    : tool === "brush"   ? "crosshair"
    : tool === "eraser"  ? "cell"
    : tool === "fill"    ? "copy"
    : tool === "eyedropper" ? "zoom-in"
    : "default";

  // ── Shared styles ──────────────────────────────────────────────────────────
  const s = {
    panel: {
      background: "var(--bg2)",
      borderRight: "1px solid var(--border)",
    } as React.CSSProperties,
    btn: (active?: boolean): React.CSSProperties => ({
      width: 40, height: 40, borderRadius: 8,
      border: active ? "2px solid var(--accent)" : "1px solid transparent",
      background: active ? "rgba(124,107,255,0.18)" : "transparent",
      color: active ? "var(--accent)" : "var(--text2)",
      cursor: "pointer", fontSize: 18,
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.12s",
    }),
    smallBtn: (): React.CSSProperties => ({
      padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)",
      background: "var(--bg3)", color: "var(--text2)", cursor: "pointer",
      fontSize: 12, fontWeight: 500,
    }),
    label: (): React.CSSProperties => ({
      fontSize: 10, color: "var(--text3)",
      textTransform: "uppercase", letterSpacing: "0.07em",
      display: "block", marginBottom: 4,
    }),
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: fullscreen ? "100vh" : "calc(100vh - 57px)",
      overflow: "hidden",
      background: "var(--bg)",
      position: fullscreen ? "fixed" : "relative",
      inset: fullscreen ? 0 : undefined,
      zIndex: fullscreen ? 9999 : undefined,
    }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={e => e.target.files?.[0] && handleFileImport(e.target.files[0])}
      />

      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg2)", flexShrink: 0, flexWrap: "wrap",
      }}>
        {/* Back */}
        <button onClick={() => router.push("/draw")} style={{
          background: "none", border: "none", color: "var(--text3)",
          cursor: "pointer", fontSize: "1.1rem", padding: "0 4px",
        }}>←</button>

        {/* Device info */}
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>{device?.artistName || deviceId}</div>
          <div style={{ color: "var(--text3)", fontSize: "0.65rem", fontFamily: "monospace" }}>
            {profile.name} · {W}×{H}px
          </div>
        </div>

        {/* Center: undo/redo/clear + image import */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 8 }}>
          <button onClick={undo} disabled={!canUndo} title="Annuler (Ctrl+Z)" style={s.smallBtn()}>↩</button>
          <button onClick={redo} disabled={!canRedo} title="Rétablir (Ctrl+Y)" style={s.smallBtn()}>↪</button>
          <button onClick={clearCanvas} title="Effacer tout (Ctrl+Delete)" style={s.smallBtn()}>🗑</button>
          <button onClick={() => fileInputRef.current?.click()} title="Importer une image" style={s.smallBtn()}>📷</button>
        </div>

        {/* View toggles */}
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button onClick={() => setShowGrid(g => !g)} title="Grille (G)" style={{
            ...s.smallBtn(),
            background: showGrid ? "rgba(124,107,255,0.2)" : "var(--bg3)",
            borderColor: showGrid ? "var(--accent)" : "var(--border)",
            color: showGrid ? "var(--accent)" : "var(--text2)",
          }}>⊞</button>
          <button onClick={() => setFullscreen(f => !f)} title="Plein écran (F)" style={s.smallBtn()}>
            {fullscreen ? "⊡" : "⊟"}
          </button>
        </div>

        {/* Status */}
        {status && (
          <div style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: status.type === "ok"    ? "rgba(74,222,128,0.15)"
                      : status.type === "wait"  ? "rgba(251,146,60,0.15)"
                      : status.type === "error" ? "rgba(248,113,113,0.15)"
                      : "rgba(255,80,80,0.15)",
            color:      status.type === "ok"    ? "var(--success)"
                      : status.type === "wait"  ? "#fb923c"
                      : status.type === "error" ? "var(--error)"
                      : "#ff5050",
            border: "1px solid currentColor",
          }}>
            {status.type === "ok"   && cooldown > 0 && `✓ Soumis — prochain dans ${formatTime(cooldown)}`}
            {status.type === "ok"   && cooldown === 0 && "✓ Prêt"}
            {status.type === "wait" && cooldown > 0 && `⏳ ${formatTime(cooldown)}`}
            {status.type === "error" && status.msg}
          </div>
        )}

        {/* Ban warning */}
        {banWarning && (
          <div style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11,
            background: "rgba(255,50,50,0.12)", color: "#ff6060",
            border: "1px solid rgba(255,50,50,0.3)", maxWidth: 260,
          }}>
            ⚠️ Envois trop fréquents — {3} abus entraînent un ban permanent de l'ESP
          </div>
        )}

        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{
              padding: "6px 20px", borderRadius: 8, border: "none",
              background: canSend ? "var(--accent)" : "var(--bg3)",
              color: canSend ? "#fff" : "var(--text3)",
              cursor: canSend ? "pointer" : "not-allowed",
              fontWeight: 700, fontSize: "0.85rem", minWidth: 110,
              transition: "all 0.2s",
            }}
          >
            {sending ? "Envoi…" : cooldown > 0 ? `⏳ ${formatTime(cooldown)}` : "📡 Envoyer"}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {cooldown > 0 && (
        <div style={{ height: 2, background: "var(--border)", flexShrink: 0 }}>
          <div style={{
            height: "100%", background: "var(--accent)",
            width: `${progress}%`, transition: "width 1s linear",
          }} />
        </div>
      )}

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left: Tools panel ─────────────────────────────────────────── */}
        {(!fullscreen || panels.tools) && (
          <div style={{
            ...(fullscreen
              ? {} // rendered as FloatingPanel below in fullscreen
              : { ...s.panel, width: 56, flexShrink: 0 }),
            display: "flex", flexDirection: "column",
            alignItems: "center", padding: "10px 0", gap: 4,
            overflowY: "auto",
          }}>
            {/* Tool buttons */}
            {(Object.keys(TOOL_ICONS) as Tool[]).map(t => (
              <button
                key={t}
                onClick={() => setTool(t)}
                title={TOOL_LABELS[t]}
                style={s.btn(tool === t)}
              >
                {TOOL_ICONS[t]}
              </button>
            ))}

            <div style={{ width: 32, height: 1, background: "var(--border)", margin: "6px 0" }} />

            {/* Brush size dots */}
            {[1, 2, 3, 4, 6, 8, 12].map(sz => (
              <button key={sz} onClick={() => setBrushSize(sz)} title={`${sz}px`}
                style={{
                  ...s.btn(brushSize === sz),
                  width: 36, height: 36,
                }}
              >
                <div style={{
                  width: Math.min(sz * 2.2, 28), height: Math.min(sz * 2.2, 28),
                  borderRadius: "50%",
                  background: brushSize === sz ? "var(--accent)" : "var(--text3)",
                }} />
              </button>
            ))}

            <div style={{ width: 32, height: 1, background: "var(--border)", margin: "6px 0" }} />

            {/* Grid toggle */}
            <button onClick={() => setShowGrid(g => !g)} title="Grille (G)" style={s.btn(showGrid)}>
              ⊞
            </button>
          </div>
        )}

        {/* ── Center: Canvas area ───────────────────────────────────────── */}
        <div
          ref={containerRef}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden", position: "relative",
            background: "var(--bg)",
          }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file?.type.startsWith("image/")) handleFileImport(file);
          }}
        >
          {/* Canvas stack */}
          <div style={{ position: "relative", lineHeight: 0 }}>
            {/* Main canvas */}
            <canvas
              ref={canvasRef}
              width={W} height={H}
              style={{
                display: "block",
                width: displayW, height: displayH,
                imageRendering: "pixelated",
                cursor: cursorStyle,
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 0 0 1px rgba(124,107,255,0.25), 0 12px 40px rgba(0,0,0,0.6)",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            />

            {/* Overlay canvas (shapes preview + image import) */}
            <canvas
              ref={overlayRef}
              width={W} height={H}
              style={{
                position: "absolute", top: 0, left: 0,
                width: displayW, height: displayH,
                imageRendering: "pixelated",
                pointerEvents: "none",
                opacity: imgMode ? 1 : 0.9,
              }}
            />

            {/* Grid overlay */}
            {showGrid && (
              <svg
                style={{
                  position: "absolute", top: 0, left: 0,
                  width: displayW, height: displayH,
                  pointerEvents: "none",
                }}
                viewBox={`0 0 ${displayW} ${displayH}`}
              >
                <defs>
                  <pattern id="grid" width={scale * gridSize} height={scale * gridSize} patternUnits="userSpaceOnUse">
                    <path d={`M ${scale * gridSize} 0 L 0 0 0 ${scale * gridSize}`} fill="none" stroke="rgba(124,107,255,0.25)" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
            )}

            {/* Image import placement handles */}
            {imgMode && imgImport.data && (
              <div style={{
                position: "absolute",
                top: imgImport.y * scale,
                left: imgImport.x * scale,
                width: W * imgImport.scale * scale,
                height: H * imgImport.scale * scale,
                border: "1px dashed #7c6bff",
                pointerEvents: "none",
                boxSizing: "border-box",
              }} />
            )}
          </div>

          {/* Coordinates display (bottom center) */}
          <div style={{
            position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
            fontSize: 10, color: "var(--text3)", fontFamily: "monospace",
            background: "rgba(0,0,0,0.4)", padding: "3px 8px", borderRadius: 4,
            pointerEvents: "none",
          }}>
            {W}×{H}px · affiché {displayW}×{displayH}px · zoom ×{scale}
            {cooldown > 0 && ` · ⏳ ${formatTime(cooldown)}`}
          </div>

          {/* Zoom controls bottom-right */}
          <div style={{
            position: "absolute", bottom: 8, right: 8,
            display: "flex", gap: 4, alignItems: "center",
          }}>
            <button onClick={() => setScale(s => Math.max(s - 1, 1))} style={s.smallBtn()}>−</button>
            <span style={{ fontSize: 11, color: "var(--text3)", minWidth: 30, textAlign: "center" }}>×{scale}</span>
            <button onClick={() => setScale(s => Math.min(s + 1, 8))} style={s.smallBtn()}>+</button>
          </div>

          {/* Fullscreen floating panels */}
          {fullscreen && (
            <>
              <FloatingPanel id="tools" title="Outils" defaultX={16} defaultY={80}
                visible={panels.tools} onClose={() => togglePanel("tools")}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 140 }}>
                  {(Object.keys(TOOL_ICONS) as Tool[]).map(t => (
                    <button key={t} onClick={() => setTool(t)} title={TOOL_LABELS[t]} style={s.btn(tool === t)}>
                      {TOOL_ICONS[t]}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span style={s.label()}>Taille</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {[1, 2, 3, 4, 6, 8, 12].map(sz => (
                      <button key={sz} onClick={() => setBrushSize(sz)} style={s.btn(brushSize === sz)}>
                        <div style={{
                          width: Math.min(sz * 2, 24), height: Math.min(sz * 2, 24),
                          borderRadius: "50%", background: brushSize === sz ? "var(--accent)" : "var(--text3)",
                        }} />
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <span style={s.label()}>Opacité</span>
                  <input type="range" min={10} max={100} value={opacity} step={5}
                    onChange={e => setOpacity(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>{opacity}%</span>
                </div>
                <div style={{ marginTop: 6, display: "flex", gap: 4 }}>
                  <button onClick={() => setShowGrid(g => !g)} style={{ ...s.smallBtn(), color: showGrid ? "var(--accent)" : "var(--text2)" }}>⊞ Grille</button>
                  <select value={gridSize} onChange={e => setGridSize(Number(e.target.value))} style={{ fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)" }}>
                    {[1, 2, 4, 8].map(g => <option key={g} value={g}>{g}px</option>)}
                  </select>
                </div>
              </FloatingPanel>

              <FloatingPanel id="palette" title="Couleurs" defaultX={16} defaultY={480}
                visible={panels.palette} onClose={() => togglePanel("palette")}
              >
                <PalettePanel
                  colors={colors} colorLabels={colorLabels}
                  activeColor={activeColor} setActiveColor={setActiveColor}
                  s={s}
                />
              </FloatingPanel>

              <FloatingPanel id="image" title="Image" defaultX={window.innerWidth - 230} defaultY={80}
                visible={panels.image} onClose={() => togglePanel("image")}
              >
                <ImagePanel
                  imgImport={imgImport} setImgImport={setImgImport}
                  imgMode={imgMode}
                  onLoad={() => fileInputRef.current?.click()}
                  onApply={applyImport}
                  onCancel={() => { setImgMode(false); setImgImport(s => ({ ...s, data: null })); overlayRef.current?.getContext("2d")?.clearRect(0, 0, W, H); }}
                  W={W} H={H} s={s}
                />
              </FloatingPanel>
            </>
          )}

          {/* Fullscreen panel toggle buttons */}
          {fullscreen && (
            <div style={{
              position: "absolute", top: 8, right: 8,
              display: "flex", gap: 4,
            }}>
              {(Object.keys(panels) as (keyof typeof panels)[]).map(id => (
                <button key={id} onClick={() => togglePanel(id)} style={{
                  ...s.smallBtn(),
                  background: panels[id] ? "rgba(124,107,255,0.2)" : "rgba(0,0,0,0.4)",
                  color: panels[id] ? "var(--accent)" : "var(--text3)",
                  backdropFilter: "blur(8px)",
                }}>
                  {id === "tools" ? "🛠" : id === "palette" ? "🎨" : id === "image" ? "📷" : "ℹ"}
                </button>
              ))}
              <button onClick={() => setFullscreen(false)} style={{
                ...s.smallBtn(), background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)",
              }}>⊡</button>
            </div>
          )}
        </div>

        {/* ── Right side panels (non-fullscreen) ───────────────────────── */}
        {!fullscreen && (
          <div style={{ display: "flex", flexDirection: "column", width: 200, flexShrink: 0 }}>

            {/* Palette */}
            <div style={{
              ...s.panel, borderLeft: "1px solid var(--border)", borderRight: "none",
              padding: "10px 10px", overflowY: "auto", flex: "0 0 auto",
            }}>
              <span style={s.label()}>Couleurs</span>
              <PalettePanel
                colors={colors} colorLabels={colorLabels}
                activeColor={activeColor} setActiveColor={setActiveColor}
                s={s}
              />
            </div>

            {/* Brush options */}
            <div style={{
              ...s.panel, borderLeft: "1px solid var(--border)", borderRight: "none",
              borderTop: "1px solid var(--border)",
              padding: "10px", flex: "0 0 auto",
            }}>
              <span style={s.label()}>Opacité · {opacity}%</span>
              <input type="range" min={10} max={100} value={opacity} step={5}
                onChange={e => setOpacity(Number(e.target.value))}
                style={{ width: "100%", marginBottom: 8 }}
              />
              <span style={s.label()}>Grille</span>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button onClick={() => setShowGrid(g => !g)} style={{
                  ...s.smallBtn(),
                  color: showGrid ? "var(--accent)" : "var(--text2)",
                }}>⊞ {showGrid ? "ON" : "OFF"}</button>
                <select value={gridSize} onChange={e => setGridSize(Number(e.target.value))}
                  style={{ flex: 1, fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", padding: "2px 4px" }}
                >
                  {[1, 2, 4, 8].map(g => <option key={g} value={g}>{g}px</option>)}
                </select>
              </div>
            </div>

            {/* Image import */}
            <div style={{
              ...s.panel, borderLeft: "1px solid var(--border)", borderRight: "none",
              borderTop: "1px solid var(--border)",
              padding: "10px", flex: 1, overflowY: "auto",
            }}>
              <span style={s.label()}>Image</span>
              <ImagePanel
                imgImport={imgImport} setImgImport={setImgImport}
                imgMode={imgMode}
                onLoad={() => fileInputRef.current?.click()}
                onApply={applyImport}
                onCancel={() => {
                  setImgMode(false);
                  setImgImport(s => ({ ...s, data: null }));
                  overlayRef.current?.getContext("2d")?.clearRect(0, 0, W, H);
                }}
                W={W} H={H} s={s}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Keyboard shortcuts hint (bottom, once) ──────────────────────── */}
      <div style={{
        padding: "4px 14px", fontSize: 10, color: "var(--text3)",
        borderTop: "1px solid var(--border)", background: "var(--bg2)",
        display: "flex", gap: 16, flexWrap: "wrap",
      }}>
        <span>B pinceau</span><span>E gomme</span><span>F remplissage</span>
        <span>L ligne</span><span>R rect</span><span>O ellipse</span><span>I pipette</span>
        <span>G grille</span><span>Ctrl+Z annuler</span><span>+/− zoom</span>
        <span>Glisser-déposer image</span>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PalettePanel({
  colors, colorLabels, activeColor, setActiveColor, s,
}: {
  colors: string[]; colorLabels: string[];
  activeColor: string; setActiveColor: (c: string) => void;
  s: any;
}) {
  const [customColor, setCustomColor] = useState(activeColor);

  return (
    <div>
      {/* Screen palette */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {colors.map((c, i) => (
          <button key={c} onClick={() => setActiveColor(c)} title={colorLabels[i]}
            style={{
              width: 32, height: 32, borderRadius: 6, border: "none", cursor: "pointer",
              background: c,
              outline: activeColor === c ? "3px solid var(--accent)" : "1px solid rgba(255,255,255,0.2)",
              outlineOffset: 2,
              transition: "outline 0.12s",
            }}
          />
        ))}
      </div>

      {/* Custom color (all hues possible — useful for future screens) */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="color"
          value={customColor}
          onChange={e => setCustomColor(e.target.value)}
          style={{ width: 32, height: 32, borderRadius: 6, border: "none", cursor: "pointer", padding: 0 }}
          title="Couleur personnalisée"
        />
        <button onClick={() => setActiveColor(customColor)} style={s.smallBtn()}>
          Appliquer
        </button>
      </div>

      {/* Current color swatch */}
      <div style={{
        marginTop: 8, width: "100%", height: 28, borderRadius: 6,
        background: activeColor,
        border: "1px solid rgba(255,255,255,0.15)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{
          fontSize: 10, fontFamily: "monospace",
          color: activeColor === "#FFFFFF" ? "#333" : "#fff",
          textShadow: activeColor === "#FFFFFF" ? "none" : "0 1px 2px rgba(0,0,0,0.5)",
        }}>{activeColor}</span>
      </div>
    </div>
  );
}

function ImagePanel({
  imgImport, setImgImport, imgMode,
  onLoad, onApply, onCancel,
  W, H, s,
}: {
  imgImport: ImageImport; setImgImport: React.Dispatch<React.SetStateAction<ImageImport>>;
  imgMode: boolean; onLoad: () => void; onApply: () => void; onCancel: () => void;
  W: number; H: number; s: any;
}) {
  if (!imgImport.data) {
    return (
      <div>
        <button onClick={onLoad} style={{ ...s.smallBtn(), width: "100%", marginBottom: 6 }}>
          📂 Charger une image
        </button>
        <div style={{
          border: "1px dashed var(--border)", borderRadius: 6, padding: "12px 8px",
          textAlign: "center", fontSize: 11, color: "var(--text3)",
        }}>
          Ou glisser-déposer<br />sur le canvas
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={s.label()}>Position</span>
      <div style={{ display: "flex", gap: 4 }}>
        <div style={{ flex: 1 }}>
          <span style={{ ...s.label(), marginBottom: 2 }}>X</span>
          <input type="number" value={imgImport.x} min={-W} max={W}
            onChange={e => setImgImport(im => ({ ...im, x: Number(e.target.value) }))}
            style={{ width: "100%", fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", padding: "2px 4px" }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ ...s.label(), marginBottom: 2 }}>Y</span>
          <input type="number" value={imgImport.y} min={-H} max={H}
            onChange={e => setImgImport(im => ({ ...im, y: Number(e.target.value) }))}
            style={{ width: "100%", fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", padding: "2px 4px" }}
          />
        </div>
      </div>

      <span style={s.label()}>Échelle · {Math.round(imgImport.scale * 100)}%</span>
      <input type="range" min={0.1} max={3} step={0.05} value={imgImport.scale}
        onChange={e => setImgImport(im => ({ ...im, scale: Number(e.target.value) }))}
        style={{ width: "100%" }}
      />

      <span style={s.label()}>Aperçu opacité · {Math.round(imgImport.opacity * 100)}%</span>
      <input type="range" min={0.1} max={1} step={0.05} value={imgImport.opacity}
        onChange={e => setImgImport(im => ({ ...im, opacity: Number(e.target.value) }))}
        style={{ width: "100%" }}
      />

      <span style={s.label()}>Tramage</span>
      <select value={imgImport.dithering}
        onChange={e => setImgImport(im => ({ ...im, dithering: e.target.value as any }))}
        style={{ fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", padding: "3px 4px" }}
      >
        <option value="none">Aucun (seuil)</option>
        <option value="floyd">Floyd-Steinberg</option>
        <option value="ordered">Bayer ordonné</option>
      </select>

      {imgImport.dithering !== "floyd" && (
        <>
          <span style={s.label()}>Seuil · {Math.round(imgImport.threshold * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={imgImport.threshold}
            onChange={e => setImgImport(im => ({ ...im, threshold: Number(e.target.value) }))}
            style={{ width: "100%" }}
          />
        </>
      )}

      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <button onClick={onApply} style={{
          ...s.smallBtn(), flex: 1,
          background: "rgba(124,107,255,0.2)", color: "var(--accent)",
          borderColor: "var(--accent)",
        }}>✓ Appliquer</button>
        <button onClick={onCancel} style={{ ...s.smallBtn(), flex: 1 }}>✕ Annuler</button>
      </div>
    </div>
  );
}