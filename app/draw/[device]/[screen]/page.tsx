"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { SCREEN_PROFILES, ScreenId } from "@/lib/screenProfiles";
import { OwnedDevice } from "@/lib/deviceStore";
import { canvasToScreenPayload } from "@/lib/canvasToScreen";
import type { ActionEvent } from "@/lib/types/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tool =
  | "brush" | "eraser" | "fill"
  | "line"  | "rect"   | "ellipse"
  | "eyedropper" | "move";

interface Point { x: number; y: number }

interface ImageImport {
  data: ImageData | null;
  x: number; y: number;
  scale: number; opacity: number;
  dithering: "none" | "floyd" | "ordered";
  threshold: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAW_WINDOW_SEC  = 60;
const MAX_HISTORY      = 50;
const LOCALSTORAGE_KEY = (deviceId: string, screenId: string) =>
  `pod_cooldown_${deviceId}_${screenId}`;

const TOOL_ICONS: Record<Tool, string> = {
  brush: "✏️", eraser: "⬜", fill: "🪣",
  line: "╱", rect: "▭", ellipse: "◯",
  eyedropper: "🩸", move: "✥",
};
const TOOL_LABELS: Record<Tool, string> = {
  brush: "Pinceau (B)", eraser: "Gomme (E)", fill: "Remplissage (F)",
  line: "Ligne (L)", rect: "Rectangle (R)", ellipse: "Ellipse (O)",
  eyedropper: "Pipette (I)", move: "Déplacer (V)",
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
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}
function colorsClose(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  tol = 30,
) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < tol;
}

function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number, startY: number,
  fillColor: string,
  w: number, h: number,
) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const idx = (x: number, y: number) => (y * w + x) * 4;
  const si = idx(startX, startY);
  const target = { r: data[si], g: data[si + 1], b: data[si + 2] };
  const fill = hexToRgb(fillColor);
  if (colorsClose(target, fill, 5)) return;
  const stack = [[startX, startY]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    const i = idx(x, y);
    const c = { r: data[i], g: data[i + 1], b: data[i + 2] };
    if (!colorsClose(c, target)) continue;
    data[i] = fill.r; data[i + 1] = fill.g; data[i + 2] = fill.b; data[i + 3] = 255;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  ctx.putImageData(imageData, 0, 0);
}

function ditherFloyd(imageData: ImageData, palette: string[]): ImageData {
  const d = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const data = d.data;
  const w = d.width, h = d.height;
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
      const i = (y * w + x) * 4;
      const or_ = data[i], og = data[i + 1], ob = data[i + 2];
      const n = nearest(or_, og, ob);
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

function ditherOrdered(imageData: ImageData, palette: string[], threshold: number): ImageData {
  const bayer = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  const d = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const data = d.data;
  const rgbs = palette.map(hexToRgb);
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
      const i = (y * d.width + x) * 4;
      const t = (bayer[y % 4][x % 4] / 16 - 0.5) * threshold;
      const r_ = Math.min(255, Math.max(0, data[i]     + t * 255));
      const g_ = Math.min(255, Math.max(0, data[i + 1] + t * 255));
      const b_ = Math.min(255, Math.max(0, data[i + 2] + t * 255));
      const n = nearest(r_, g_, b_);
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

// ─── useDraggable ─────────────────────────────────────────────────────────────

function useDraggable(initialX: number, initialY: number) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragging = useRef(false);
  const offset   = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    offset.current   = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const mm = (e: PointerEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
    };
    const mu = () => { dragging.current = false; };
    window.addEventListener("pointermove", mm);
    window.addEventListener("pointerup",   mu);
    return () => {
      window.removeEventListener("pointermove", mm);
      window.removeEventListener("pointerup",   mu);
    };
  }, []);

  return { pos, setPos, onPointerDown };
}

// ─── useIsMobile ──────────────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

// ─── useFullscreen — VRAI fullscreen API ─────────────────────────────────────

function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const enter = useCallback(async () => {
    try {
      const el = ref.current;
      if (!el) return;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if ((el as any).webkitRequestFullscreen) {
        await (el as any).webkitRequestFullscreen();
      }
    } catch {}
  }, [ref]);

  const exit = useCallback(async () => {
    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        await (document as any).webkitExitFullscreen();
      }
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    if (isFullscreen) exit();
    else enter();
  }, [isFullscreen, enter, exit]);

  return { isFullscreen, toggle, enter, exit };
}

// ─── FloatingPanel ────────────────────────────────────────────────────────────

function FloatingPanel({
  title, children, defaultX, defaultY, visible, onClose,
}: {
  title: string; children: React.ReactNode;
  defaultX: number; defaultY: number; visible: boolean; onClose: () => void;
}) {
  const { pos, onPointerDown } = useDraggable(defaultX, defaultY);
  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: pos.x, top: pos.y,
        zIndex: 10000,
        background: "rgba(14,14,20,0.96)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 12,
        boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
        minWidth: 190,
        userSelect: "none",
        maxHeight: "calc(100dvh - 32px)",
        overflowY: "auto",
      }}
    >
      <div
        onPointerDown={onPointerDown}
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          cursor: "grab",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: 11, fontWeight: 700,
          color: "rgba(255,255,255,0.5)",
          letterSpacing: "0.1em", textTransform: "uppercase",
          touchAction: "none",
        }}
      >
        <span>{title}</span>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none",
            color: "rgba(255,255,255,0.4)", cursor: "pointer",
            fontSize: 18, lineHeight: 1, padding: "0 0 0 10px",
          }}
        >×</button>
      </div>
      <div style={{ padding: "10px 12px" }}>{children}</div>
    </div>
  );
}

// ─── MobileBottomSheet ────────────────────────────────────────────────────────
// CORRECTIF : zIndex > barre mobile (900), fond cliquable, safe-area OK

function MobileBottomSheet({
  visible, onClose, title, children,
}: {
  visible: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  // Bloque le scroll du body quand la sheet est ouverte
  useEffect(() => {
    if (visible) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      {/* Backdrop — zIndex 1200 > barre mobile 900 */}
      <div
        onPointerDown={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 1200,
          background: "rgba(0,0,0,0.55)",
          WebkitTapHighlightColor: "transparent",
        }}
      />
      {/* Sheet — zIndex 1201 */}
      <div
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          zIndex: 1201,
          background: "rgba(14,14,22,0.99)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid rgba(255,255,255,0.14)",
          borderRadius: "18px 18px 0 0",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          maxHeight: "80dvh",
          overflowY: "auto",
          // Animation slide-up
          animation: "slideUp 0.22s cubic-bezier(0.32,0.72,0,1)",
        }}
      >
        {/* Drag handle */}
        <div style={{
          width: 40, height: 4, borderRadius: 2,
          background: "rgba(255,255,255,0.25)",
          margin: "10px auto 0",
        }} />
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 18px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.8)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {title}
          </span>
          <button
            onPointerDown={e => { e.stopPropagation(); onClose(); }}
            style={{
              background: "rgba(255,255,255,0.08)", border: "none",
              color: "rgba(255,255,255,0.6)",
              fontSize: 18, cursor: "pointer", padding: "4px 10px",
              borderRadius: 8, lineHeight: 1,
            }}
          >×</button>
        </div>
        <div style={{ padding: "14px 18px" }}>{children}</div>
      </div>
      {/* Keyframe CSS injection */}
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DrawCanvasPage() {
  const params   = useParams();
  const router   = useRouter();
  const isMobile = useIsMobile();

  const rawDevice = params.device;
  const rawScreen = params.screen;
  const deviceId  = (Array.isArray(rawDevice) ? rawDevice[0] : rawDevice) as string;
  const screenId  = (Array.isArray(rawScreen) ? rawScreen[0] : rawScreen) as ScreenId;
  const profile   = SCREEN_PROFILES[screenId];

  // ── Fullscreen ref (on the root container) ────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(rootRef);

  // ── State ──────────────────────────────────────────────────────────────────
  const [device, setDevice]         = useState<OwnedDevice | null>(null);
  const [sending, setSending]       = useState(false);
  const [status, setStatus]         = useState<{ type: "ok" | "error" | "wait"; msg: string } | null>(null);

  const [tool, setTool]             = useState<Tool>("brush");
  const [brushSize, setBrushSize]   = useState(2);
  const [activeColor, setActiveColor] = useState<string>("#000000");
  const [showGrid, setShowGrid]     = useState(false);
  const [gridSize, setGridSize]     = useState(1);
  const [opacity, setOpacity]       = useState(100);

  // Desktop floating panels (utilisés uniquement en fullscreen desktop)
  const [panels, setPanels] = useState({ tools: true, palette: true, image: false });
  const togglePanel = (id: keyof typeof panels) =>
    setPanels(p => ({ ...p, [id]: !p[id] }));

  // Mobile bottom sheets — null = fermé
  const [mobileSheet, setMobileSheet] = useState<"tools" | "palette" | "image" | null>(null);

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const drawing      = useRef(false);
  const lastPoint    = useRef<Point | null>(null);
  const shapeStart   = useRef<Point | null>(null);
  const history      = useRef<ImageData[]>([]);
  const historyIndex = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [imgImport, setImgImport] = useState<ImageImport>({
    data: null, x: 0, y: 0, scale: 1, opacity: 0.6,
    dithering: "floyd", threshold: 0.4,
  });
  const [imgMode, setImgMode] = useState(false);

  const [cooldown, setCooldown]     = useState(0);
  const cooldownRef                 = useRef<ReturnType<typeof setInterval> | null>(null);
  const [banWarning, setBanWarning] = useState(false);

  // ── Proof-of-Draw action tracking ──────────────────────────────────────────
  const actionsRef      = useRef<ActionEvent[]>([]);
  const sessionStartRef = useRef<number>(Date.now());

  // ── Canvas dimensions ──────────────────────────────────────────────────────
  const W = profile?.width  ?? 128;
  const H = profile?.height ?? 64;

  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function computeScale() {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      const pad = isMobile ? 80 : 40;
      const maxW = clientWidth  - (isMobile ? 16 : 40);
      const maxH = clientHeight - pad;
      const s = Math.min(Math.floor(maxW / W), Math.floor(maxH / H));
      setScale(Math.max(1, Math.min(s, 8)));
    }
    computeScale();
    window.addEventListener("resize", computeScale);
    return () => window.removeEventListener("resize", computeScale);
  }, [W, H, isFullscreen, isMobile]);

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
    actionsRef.current.push({ kind: "undo", t: Date.now() - sessionStartRef.current });
  }, []);

  const redo = useCallback(() => {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current++;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.putImageData(history.current[historyIndex.current], 0, 0);
    setCanUndo(true);
    setCanRedo(historyIndex.current < history.current.length - 1);
    actionsRef.current.push({ kind: "redo", t: Date.now() - sessionStartRef.current });
  }, []);

  // ── Canvas init ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    canvas.width = W; canvas.height = H;
    overlay.width = W; overlay.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);
    saveHistory();
  }, [W, H, saveHistory]);

  // ── Device load + cooldown restore ────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!profile || !deviceId || !screenId) { router.push("/draw"); return; }
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
      } catch { if (!cancelled) router.push("/draw"); }
    }
    loadDevice();
    return () => { cancelled = true; };
  }, [deviceId, screenId, profile, router]);

  // ── Cooldown ───────────────────────────────────────────────────────────────
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

  const canSend = cooldown === 0 && !sending && !imgMode;

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.key === "y" && (e.ctrlKey || e.metaKey)) || (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (e.key === "g") { setShowGrid(v => !v); return; }
      if (e.key === "f") { toggleFullscreen(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && e.ctrlKey) {
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) { ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H); saveHistory(); }
        return;
      }
      const t = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (t) setTool(t);
      if (e.key === "+" || e.key === "=") setScale(s => Math.min(s + 1, 8));
      if (e.key === "-") setScale(s => Math.max(s - 1, 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, W, H, saveHistory, toggleFullscreen]);

  // ── toCanvasPoint ──────────────────────────────────────────────────────────
  const toCanvasPoint = useCallback((e: React.PointerEvent, el: HTMLCanvasElement): Point => {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(W - 1, Math.floor((e.clientX - rect.left)  / scale))),
      y: Math.max(0, Math.min(H - 1, Math.floor((e.clientY - rect.top)   / scale))),
    };
  }, [W, H, scale]);

  // ── Drawing primitives ────────────────────────────────────────────────────
  const drawLine = useCallback((ctx: CanvasRenderingContext2D, a: Point, b: Point, size: number, color: string, alpha = 1) => {
    ctx.globalAlpha = alpha; ctx.strokeStyle = color;
    ctx.lineWidth = size; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(a.x + 0.5, a.y + 0.5); ctx.lineTo(b.x + 0.5, b.y + 0.5);
    ctx.stroke(); ctx.globalAlpha = 1;
  }, []);

  const drawRect = useCallback((ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, alpha = 1) => {
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.globalAlpha = 1;
  }, []);

  const drawEllipse = useCallback((ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, alpha = 1) => {
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke(); ctx.globalAlpha = 1;
  }, []);

  // ── Pointer events ────────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!canvasRef.current || !overlayRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt  = toCanvasPoint(e, e.currentTarget);
    const ctx = canvasRef.current.getContext("2d")!;

    drawing.current = true;
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
      actionsRef.current.push({ kind: "fill", t: Date.now() - sessionStartRef.current, tool: "fill", color: activeColor });
      drawing.current = false;
      return;
    }
    if (tool === "brush" || tool === "eraser") {
      ctx.globalAlpha = opacity / 100;
      ctx.fillStyle   = tool === "eraser" ? "#FFFFFF" : activeColor;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }, [tool, activeColor, brushSize, opacity, W, H, toCanvasPoint, saveHistory]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !canvasRef.current || !overlayRef.current) return;
    e.preventDefault();
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
    e.preventDefault();
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
    // Enregistrer l'action selon l'outil
    if (tool === "brush") {
      actionsRef.current.push({ kind: "stroke", t: Date.now() - sessionStartRef.current, tool: "brush", color: activeColor });
    } else if (tool === "eraser") {
      actionsRef.current.push({ kind: "erase", t: Date.now() - sessionStartRef.current, tool: "eraser" });
    } else if (tool === "line" || tool === "rect" || tool === "ellipse") {
      actionsRef.current.push({ kind: "shape", t: Date.now() - sessionStartRef.current, tool, color: activeColor });
    }
    saveHistory();
  }, [tool, activeColor, brushSize, W, H, toCanvasPoint, drawLine, drawRect, drawEllipse, saveHistory]);

  // ── Clear ──────────────────────────────────────────────────────────────────
  const clearCanvas = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);
    actionsRef.current.push({ kind: "fill", t: Date.now() - sessionStartRef.current, tool: "clear", color: "#FFFFFF" });
    saveHistory();
  }, [W, H, saveHistory]);

  // ── Image import ───────────────────────────────────────────────────────────
  const handleFileImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const off = document.createElement("canvas");
        off.width = W; off.height = H;
        const ctx = off.getContext("2d")!;
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        setImgImport(s => ({ ...s, data: ctx.getImageData(0, 0, W, H), x: 0, y: 0, scale: 1 }));
        setImgMode(true);
        if (!isMobile) setPanels(p => ({ ...p, image: true }));
        else setMobileSheet("image");
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [W, H, isMobile]);

  const cancelImport = useCallback(() => {
    setImgMode(false);
    setImgImport(s => ({ ...s, data: null }));
    overlayRef.current?.getContext("2d")?.clearRect(0, 0, W, H);
    setMobileSheet(null);
  }, [W, H]);

  const applyImport = useCallback(() => {
    if (!imgImport.data || !canvasRef.current) return;
    const ctx     = canvasRef.current.getContext("2d")!;
    const palette = profile?.colors ?? ["#000000", "#FFFFFF"];
    let processed = imgImport.data;
    if (imgImport.dithering === "floyd")   processed = ditherFloyd(processed, palette);
    if (imgImport.dithering === "ordered") processed = ditherOrdered(processed, palette, imgImport.threshold);
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    off.getContext("2d")!.putImageData(processed, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(off, 0, 0, W, H, imgImport.x, imgImport.y,
      Math.round(W * imgImport.scale), Math.round(H * imgImport.scale));
    actionsRef.current.push({ kind: "move", t: Date.now() - sessionStartRef.current, tool: "import" });
    saveHistory();
    setImgMode(false);
    setImgImport(s => ({ ...s, data: null }));
    setMobileSheet(null);
  }, [imgImport, W, H, profile, saveHistory]);

  // ── Image overlay rendering ────────────────────────────────────────────────
  useEffect(() => {
    const overlay = overlayRef.current?.getContext("2d");
    if (!overlay) return;
    overlay.clearRect(0, 0, W, H);
    if (!imgMode || !imgImport.data) return;
    const palette = profile?.colors ?? ["#000000", "#FFFFFF"];
    let processed = imgImport.data;
    if (imgImport.dithering === "floyd")   processed = ditherFloyd(processed, palette);
    if (imgImport.dithering === "ordered") processed = ditherOrdered(processed, palette, imgImport.threshold);
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    off.getContext("2d")!.putImageData(processed, 0, 0);
    overlay.globalAlpha = imgImport.opacity;
    overlay.drawImage(off, imgImport.x, imgImport.y,
      Math.round(W * imgImport.scale), Math.round(H * imgImport.scale));
    overlay.globalAlpha = 1;
  }, [imgImport, imgMode, W, H, profile]);

  // ── Send ───────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!device || !canSend || !canvasRef.current) return;
    setSending(true); setStatus(null);
    try {
      const payload   = canvasToScreenPayload(canvasRef.current, screenId);
      const actions   = actionsRef.current;
      const drawScore = actions.reduce((acc, a) => a.kind === "undo" ? acc - 1 : acc + 1, 0);
      const body =
        screenId === "eink29bwr"
          ? { screen: screenId, deviceId, black: (payload as any).black, red: (payload as any).red, actions, drawScore }
          : { screen: screenId, deviceId, buffer: (payload as any).buffer, actions, drawScore };
      const res  = await fetch("/api/draw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const secs = data.nextDrawIn ?? DRAW_WINDOW_SEC;
        saveCooldown(deviceId, screenId, Date.now() + secs * 1000);
        startCooldown(secs); setBanWarning(true); setStatus({ type: "wait", msg: "" }); return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const secs = data.nextDrawIn ?? DRAW_WINDOW_SEC;
      saveCooldown(deviceId, screenId, Date.now() + secs * 1000);
      startCooldown(secs); setStatus({ type: "ok", msg: "" });
    } catch (err: any) {
      setStatus({ type: "error", msg: err.message || "Erreur réseau" });
      setTimeout(() => setStatus(null), 5000);
    } finally { setSending(false); }
  }, [device, canSend, screenId, deviceId, startCooldown]);

  if (!profile) return null;

  const colors      = profile.colors;
  const colorLabels = profile.colorLabels;
  const progress    = cooldown > 0 ? ((DRAW_WINDOW_SEC - cooldown) / DRAW_WINDOW_SEC) * 100 : 0;

  const cursorStyle =
    !canSend            ? "not-allowed"
    : tool === "brush"  ? "crosshair"
    : tool === "eraser" ? "cell"
    : tool === "fill"   ? "copy"
    : tool === "eyedropper" ? "zoom-in"
    : "default";

  // ── Style helpers ──────────────────────────────────────────────────────────
  const btn = (active?: boolean): React.CSSProperties => ({
    width: 44, height: 44, borderRadius: 10,
    border: active ? "2px solid var(--accent)" : "1px solid rgba(255,255,255,0.08)",
    background: active ? "rgba(124,107,255,0.18)" : "transparent",
    color: active ? "var(--accent)" : "var(--text2)",
    cursor: "pointer", fontSize: 20,
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "all 0.12s", flexShrink: 0,
  });

  const smallBtn = (accent?: boolean): React.CSSProperties => ({
    padding: "5px 12px", borderRadius: 7,
    border: accent ? "1px solid var(--accent)" : "1px solid var(--border)",
    background: accent ? "rgba(124,107,255,0.18)" : "var(--bg3)",
    color: accent ? "var(--accent)" : "var(--text2)",
    cursor: "pointer", fontSize: 12, fontWeight: 600, flexShrink: 0,
  });

  const label: React.CSSProperties = {
    fontSize: 10, color: "var(--text3)",
    textTransform: "uppercase", letterSpacing: "0.08em",
    display: "block", marginBottom: 4,
  };

  const sidePanel: React.CSSProperties = {
    background: "var(--bg2)",
    borderLeft: "1px solid var(--border)",
  };

  // ── Contenu des panneaux (partagé mobile/desktop) ─────────────────────────
  const ToolsContent = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <span style={label}>Outil</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(Object.keys(TOOL_ICONS) as Tool[]).map(t => (
            <button key={t} onClick={() => { setTool(t); setMobileSheet(null); }}
              title={TOOL_LABELS[t]} style={{ ...btn(tool === t), width: 52, height: 52 }}>
              {TOOL_ICONS[t]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span style={label}>Taille · {brushSize}px</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[1, 2, 3, 4, 6, 8, 12].map(sz => (
            <button key={sz} onClick={() => setBrushSize(sz)} title={`${sz}px`}
              style={{ ...btn(brushSize === sz), width: 44, height: 44 }}>
              <div style={{
                width: Math.min(sz * 2.2, 28), height: Math.min(sz * 2.2, 28),
                borderRadius: "50%",
                background: brushSize === sz ? "var(--accent)" : "var(--text3)",
              }} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <span style={label}>Opacité · {opacity}%</span>
        <input type="range" min={10} max={100} value={opacity} step={5}
          onChange={e => setOpacity(Number(e.target.value))}
          style={{ width: "100%", accentColor: "var(--accent)" }} />
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button onClick={() => setShowGrid(v => !v)} style={smallBtn(showGrid)}>⊞ Grille</button>
        <select value={gridSize} onChange={e => setGridSize(Number(e.target.value))}
          style={{ fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", padding: "4px 6px" }}>
          {[1, 2, 4, 8].map(g => <option key={g} value={g}>{g}px</option>)}
        </select>
      </div>
    </div>
  );

  const PaletteContent = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {colors.map((c, i) => (
          <button key={c} onClick={() => { setActiveColor(c); setMobileSheet(null); }}
            title={colorLabels[i]}
            style={{
              width: 40, height: 40, borderRadius: 10, border: "none", cursor: "pointer",
              background: c,
              outline: activeColor === c ? "3px solid var(--accent)" : "1px solid rgba(255,255,255,0.2)",
              outlineOffset: 2, transition: "outline 0.1s", flexShrink: 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="color" defaultValue={activeColor}
          onChange={e => setActiveColor(e.target.value)}
          style={{ width: 44, height: 44, borderRadius: 8, border: "none", cursor: "pointer", padding: 0 }}
          title="Couleur libre"
        />
        <div style={{
          flex: 1, height: 44, borderRadius: 8,
          background: activeColor,
          border: "1px solid rgba(255,255,255,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: activeColor === "#FFFFFF" ? "#333" : "#fff" }}>
            {activeColor}
          </span>
        </div>
      </div>
    </div>
  );

  const ImageContent = (
    <ImagePanel
      imgImport={imgImport} setImgImport={setImgImport}
      imgMode={imgMode}
      onLoad={() => fileInputRef.current?.click()}
      onApply={applyImport}
      onCancel={cancelImport}
      W={W} H={H}
      smallBtn={smallBtn} label={label}
    />
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  // rootRef est posé sur le div racine — c'est lui qu'on passe à requestFullscreen
  return (
    <div
      ref={rootRef}
      style={{
        display: "flex", flexDirection: "column",
        // En mode fullscreen natif, le navigateur gère les dimensions —
        // on s'assure juste d'occuper 100% de la surface disponible
        height: isFullscreen ? "100dvh" : "calc(100dvh - 57px)",
        overflow: "hidden",
        background: "var(--bg)",
        // Pas de position:fixed ici — l'API Fullscreen s'en charge
      }}
    >
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={e => e.target.files?.[0] && handleFileImport(e.target.files[0])}
      />

      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: isMobile ? "6px 10px" : "6px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg2)", flexShrink: 0, flexWrap: "nowrap",
        minHeight: 48, overflow: "hidden",
      }}>
        {/* Back */}
        <button onClick={() => router.push("/draw")} style={{
          background: "none", border: "none", color: "var(--text3)",
          cursor: "pointer", fontSize: "1.2rem", padding: "0 4px", flexShrink: 0,
        }}>←</button>

        {/* Device info */}
        <div style={{ flexShrink: 1, overflow: "hidden", minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {device?.artistName || deviceId}
          </div>
          {!isMobile && (
            <div style={{ color: "var(--text3)", fontSize: "0.65rem", fontFamily: "monospace" }}>
              {profile.name} · {W}×{H}px
            </div>
          )}
        </div>

        {/* Undo / Redo / Clear / Import */}
        <div style={{ display: "flex", gap: 3, alignItems: "center", marginLeft: 4, flexShrink: 0 }}>
          <button onClick={undo} disabled={!canUndo} title="Annuler (Ctrl+Z)"
            style={{ ...smallBtn(), opacity: canUndo ? 1 : 0.4, padding: "5px 9px" }}>↩</button>
          <button onClick={redo} disabled={!canRedo} title="Rétablir (Ctrl+Y)"
            style={{ ...smallBtn(), opacity: canRedo ? 1 : 0.4, padding: "5px 9px" }}>↪</button>
          <button onClick={clearCanvas} title="Effacer tout"
            style={{ ...smallBtn(), padding: "5px 9px" }}>🗑</button>
          <button onClick={() => fileInputRef.current?.click()} title="Importer une image"
            style={{ ...smallBtn(imgMode), padding: "5px 9px" }}>📷</button>
        </div>

        {/* imgMode badge */}
        {imgMode && (
          <div style={{
            padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: "rgba(251,146,60,0.15)", color: "#fb923c",
            border: "1px solid rgba(251,146,60,0.4)", flexShrink: 0, whiteSpace: "nowrap",
          }}>
            ⚠️ {isMobile ? "Valider" : "Image non validée — valider avant envoi"}
          </div>
        )}

        {/* Fullscreen toggle */}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Quitter plein écran (F)" : "Plein écran (F)"}
          style={{ ...smallBtn(isFullscreen), marginLeft: 2 }}
        >
          {isFullscreen ? "⊡" : "⊟"}
        </button>

        {/* Status */}
        {status && !isMobile && (
          <div style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, flexShrink: 0,
            background: status.type === "ok" ? "rgba(74,222,128,0.15)" : status.type === "wait" ? "rgba(251,146,60,0.15)" : "rgba(248,113,113,0.15)",
            color: status.type === "ok" ? "var(--success)" : status.type === "wait" ? "#fb923c" : "var(--error)",
            border: "1px solid currentColor",
          }}>
            {status.type === "ok"    && cooldown > 0 && `✓ Soumis — ${formatTime(cooldown)}`}
            {status.type === "ok"    && cooldown === 0 && "✓ Prêt"}
            {status.type === "wait"  && cooldown > 0  && `⏳ ${formatTime(cooldown)}`}
            {status.type === "error" && status.msg}
          </div>
        )}

        {/* Ban warning */}
        {banWarning && !isMobile && (
          <div style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11, flexShrink: 0,
            background: "rgba(255,50,50,0.12)", color: "#ff6060",
            border: "1px solid rgba(255,50,50,0.3)", maxWidth: 220,
          }}>
            ⚠️ Envois trop fréquents — 3 abus = ban permanent
          </div>
        )}

        {/* Send button */}
        <div style={{ marginLeft: "auto", flexShrink: 0 }}>
          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{
              padding: isMobile ? "7px 14px" : "6px 20px",
              borderRadius: 9, border: "none",
              background: imgMode ? "rgba(251,146,60,0.3)" : canSend ? "var(--accent)" : "var(--bg3)",
              color: canSend && !imgMode ? "#fff" : imgMode ? "#fb923c" : "var(--text3)",
              cursor: canSend ? "pointer" : "not-allowed",
              fontWeight: 700, fontSize: "0.85rem",
              minWidth: isMobile ? 90 : 110,
              transition: "all 0.2s",
            }}
          >
            {sending   ? "Envoi…"
              : imgMode  ? "⚠️ Valider"
              : cooldown > 0 ? `⏳ ${formatTime(cooldown)}`
              : "📡 Envoyer"}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {cooldown > 0 && (
        <div style={{ height: 3, background: "var(--border)", flexShrink: 0 }}>
          <div style={{
            height: "100%", background: "var(--accent)",
            width: `${progress}%`, transition: "width 1s linear",
          }} />
        </div>
      )}

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>

        {/* ── Left toolbar (desktop non-fullscreen) ──────────────────── */}
        {!isMobile && !isFullscreen && (
          <div style={{
            background: "var(--bg2)", borderRight: "1px solid var(--border)",
            width: 60, flexShrink: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", padding: "10px 0", gap: 4,
            overflowY: "auto",
          }}>
            {(Object.keys(TOOL_ICONS) as Tool[]).map(t => (
              <button key={t} onClick={() => setTool(t)} title={TOOL_LABELS[t]} style={btn(tool === t)}>
                {TOOL_ICONS[t]}
              </button>
            ))}
            <div style={{ width: 36, height: 1, background: "var(--border)", margin: "6px 0" }} />
            {[1, 2, 3, 4, 6, 8, 12].map(sz => (
              <button key={sz} onClick={() => setBrushSize(sz)} title={`${sz}px`}
                style={{ ...btn(brushSize === sz), width: 40, height: 40 }}>
                <div style={{
                  width: Math.min(sz * 2.2, 26), height: Math.min(sz * 2.2, 26),
                  borderRadius: "50%",
                  background: brushSize === sz ? "var(--accent)" : "var(--text3)",
                }} />
              </button>
            ))}
            <div style={{ width: 36, height: 1, background: "var(--border)", margin: "6px 0" }} />
            <button onClick={() => setShowGrid(v => !v)} title="Grille (G)" style={btn(showGrid)}>⊞</button>
          </div>
        )}

        {/* ── Canvas area ─────────────────────────────────────────────── */}
        <div
          ref={containerRef}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden", position: "relative",
            background: "var(--bg)",
            paddingBottom: isMobile ? 72 : 0,
          }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file?.type.startsWith("image/")) handleFileImport(file);
          }}
        >
          <div style={{ position: "relative", lineHeight: 0 }}>
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
                touchAction: "none",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={e => { if (drawing.current) handlePointerUp(e); }}
            />

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

            {/* Grid */}
            {showGrid && (
              <svg style={{
                position: "absolute", top: 0, left: 0,
                width: displayW, height: displayH, pointerEvents: "none",
              }} viewBox={`0 0 ${displayW} ${displayH}`}>
                <defs>
                  <pattern id="grid" width={scale * gridSize} height={scale * gridSize} patternUnits="userSpaceOnUse">
                    <path d={`M ${scale * gridSize} 0 L 0 0 0 ${scale * gridSize}`}
                      fill="none" stroke="rgba(124,107,255,0.25)" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
            )}

            {imgMode && imgImport.data && (
              <div style={{
                position: "absolute",
                top: imgImport.y * scale, left: imgImport.x * scale,
                width: W * imgImport.scale * scale, height: H * imgImport.scale * scale,
                border: "1px dashed #7c6bff", pointerEvents: "none", boxSizing: "border-box",
              }} />
            )}
          </div>

          {/* Info bar */}
          <div style={{
            position: "absolute", bottom: isMobile ? 80 : 8, left: "50%", transform: "translateX(-50%)",
            fontSize: 10, color: "var(--text3)", fontFamily: "monospace",
            background: "rgba(0,0,0,0.45)", padding: "3px 9px", borderRadius: 5,
            pointerEvents: "none", whiteSpace: "nowrap",
          }}>
            {W}×{H} · ×{scale}
            {cooldown > 0 && ` · ⏳ ${formatTime(cooldown)}`}
          </div>

          {/* Zoom (desktop) */}
          {!isMobile && (
            <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", gap: 4, alignItems: "center" }}>
              <button onClick={() => setScale(s => Math.max(s - 1, 1))} style={smallBtn()}>−</button>
              <span style={{ fontSize: 11, color: "var(--text3)", minWidth: 28, textAlign: "center" }}>×{scale}</span>
              <button onClick={() => setScale(s => Math.min(s + 1, 8))} style={smallBtn()}>+</button>
            </div>
          )}

          {/* Desktop fullscreen overlay panels */}
          {isFullscreen && !isMobile && (
            <>
              <FloatingPanel title="Outils" defaultX={16} defaultY={60}
                visible={panels.tools} onClose={() => togglePanel("tools")}>
                {ToolsContent}
              </FloatingPanel>
              <FloatingPanel title="Couleurs" defaultX={16} defaultY={500}
                visible={panels.palette} onClose={() => togglePanel("palette")}>
                {PaletteContent}
              </FloatingPanel>
              <FloatingPanel title="Image"
                defaultX={typeof window !== "undefined" ? window.innerWidth - 230 : 600}
                defaultY={60}
                visible={panels.image} onClose={() => togglePanel("image")}>
                {ImageContent}
              </FloatingPanel>
              {/* Panel toggles overlay */}
              <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}>
                {(["tools", "palette", "image"] as const).map(id => (
                  <button key={id} onClick={() => togglePanel(id)} style={{
                    ...smallBtn(panels[id]),
                    background: panels[id] ? "rgba(124,107,255,0.2)" : "rgba(0,0,0,0.5)",
                    backdropFilter: "blur(8px)",
                  }}>
                    {id === "tools" ? "🛠" : id === "palette" ? "🎨" : "📷"}
                  </button>
                ))}
                <button onClick={toggleFullscreen}
                  style={{ ...smallBtn(), background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}>
                  ⊡
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Right panels (desktop non-fullscreen) ──────────────────── */}
        {!isMobile && !isFullscreen && (
          <div style={{ display: "flex", flexDirection: "column", width: 210, flexShrink: 0 }}>
            <div style={{ ...sidePanel, padding: "10px 12px", flex: "0 0 auto", overflowY: "auto" }}>
              <span style={label}>Couleurs</span>
              {PaletteContent}
            </div>
            <div style={{ ...sidePanel, borderTop: "1px solid var(--border)", padding: "10px 12px", flex: "0 0 auto" }}>
              <span style={label}>Opacité · {opacity}%</span>
              <input type="range" min={10} max={100} value={opacity} step={5}
                onChange={e => setOpacity(Number(e.target.value))}
                style={{ width: "100%", marginBottom: 8, accentColor: "var(--accent)" }} />
              <span style={label}>Grille</span>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button onClick={() => setShowGrid(v => !v)} style={smallBtn(showGrid)}>⊞ {showGrid ? "ON" : "OFF"}</button>
                <select value={gridSize} onChange={e => setGridSize(Number(e.target.value))}
                  style={{ flex: 1, fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", padding: "3px 5px" }}>
                  {[1, 2, 4, 8].map(g => <option key={g} value={g}>{g}px</option>)}
                </select>
              </div>
            </div>
            <div style={{ ...sidePanel, borderTop: "1px solid var(--border)", padding: "10px 12px", flex: 1, overflowY: "auto" }}>
              <span style={label}>Image</span>
              {ImageContent}
            </div>
          </div>
        )}
      </div>

      {/* ── Mobile bottom toolbar ─────────────────────────────────────────── */}
      {isMobile && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          // zIndex 900 — en dessous des sheets (1200+) et des FloatingPanels (10000)
          zIndex: 900,
          background: "rgba(14,14,22,0.97)",
          backdropFilter: "blur(16px)",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          padding: "8px 12px",
          paddingBottom: "max(8px, env(safe-area-inset-bottom))",
          display: "flex", gap: 8, alignItems: "center",
          overflowX: "auto",
        }}>
          {/* Outil actif → ouvre la sheet outils */}
          <button
            onPointerDown={e => { e.preventDefault(); setMobileSheet("tools"); }}
            style={{ ...btn(true), width: 52, height: 52, flexShrink: 0 }}
          >
            {TOOL_ICONS[tool]}
          </button>

          {/* Couleur active → ouvre la sheet palette */}
          <button
            onPointerDown={e => { e.preventDefault(); setMobileSheet("palette"); }}
            style={{
              width: 52, height: 52, borderRadius: 10, flexShrink: 0,
              background: activeColor,
              border: "2px solid var(--accent)",
              cursor: "pointer",
            }}
          />

          <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

          {/* Swatches rapides */}
          {colors.slice(0, 6).map((c, i) => (
            <button
              key={c}
              onPointerDown={e => { e.preventDefault(); setActiveColor(c); }}
              title={colorLabels[i]}
              style={{
                width: 38, height: 38, borderRadius: 8, border: "none", flexShrink: 0,
                background: c,
                outline: activeColor === c ? "3px solid var(--accent)" : "1px solid rgba(255,255,255,0.15)",
                outlineOffset: 2, cursor: "pointer",
              }}
            />
          ))}

          <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

          {/* Zoom */}
          <button onPointerDown={e => { e.preventDefault(); setScale(s => Math.max(s - 1, 1)); }}
            style={{ ...smallBtn(), padding: "8px 12px" }}>−</button>
          <span style={{ fontSize: 12, color: "var(--text3)", minWidth: 28, textAlign: "center", flexShrink: 0 }}>×{scale}</span>
          <button onPointerDown={e => { e.preventDefault(); setScale(s => Math.min(s + 1, 8)); }}
            style={{ ...smallBtn(), padding: "8px 12px" }}>+</button>

          <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexShrink: 0 }}>
            {/* Plein écran */}
            <button
              onPointerDown={e => { e.preventDefault(); toggleFullscreen(); }}
              style={{ ...smallBtn(isFullscreen), padding: "8px 10px" }}
            >
              {isFullscreen ? "⊡" : "⊟"}
            </button>
            {/* Image */}
            <button
              onPointerDown={e => { e.preventDefault(); setMobileSheet("image"); }}
              style={{ ...smallBtn(imgMode), padding: "8px 10px" }}
            >
              📷
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile bottom sheets ──────────────────────────────────────────── */}
      <MobileBottomSheet visible={mobileSheet === "tools"}   onClose={() => setMobileSheet(null)} title="Outils">
        {ToolsContent}
      </MobileBottomSheet>
      <MobileBottomSheet visible={mobileSheet === "palette"} onClose={() => setMobileSheet(null)} title="Couleurs">
        {PaletteContent}
      </MobileBottomSheet>
      <MobileBottomSheet visible={mobileSheet === "image"}   onClose={() => setMobileSheet(null)} title="Image">
        {ImageContent}
      </MobileBottomSheet>

      {/* ── Keyboard hints (desktop) ─────────────────────────────────────── */}
      {!isMobile && !isFullscreen && (
        <div style={{
          padding: "3px 14px", fontSize: 10, color: "var(--text3)",
          borderTop: "1px solid var(--border)", background: "var(--bg2)",
          display: "flex", gap: 14, flexWrap: "wrap", flexShrink: 0,
        }}>
          <span>B pinceau</span><span>E gomme</span><span>F remplissage</span>
          <span>L ligne</span><span>R rect</span><span>O ellipse</span>
          <span>G grille</span><span>Ctrl+Z annuler</span><span>+/− zoom</span>
        </div>
      )}
    </div>
  );
}

// ─── ImagePanel ───────────────────────────────────────────────────────────────

function ImagePanel({
  imgImport, setImgImport, imgMode,
  onLoad, onApply, onCancel,
  W, H, smallBtn, label,
}: {
  imgImport: ImageImport;
  setImgImport: React.Dispatch<React.SetStateAction<ImageImport>>;
  imgMode: boolean;
  onLoad: () => void; onApply: () => void; onCancel: () => void;
  W: number; H: number;
  smallBtn: (accent?: boolean) => React.CSSProperties;
  label: React.CSSProperties;
}) {
  if (!imgImport.data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={onLoad} style={{ ...smallBtn(), width: "100%", padding: "12px" }}>
          📂 Charger une image
        </button>
        <div style={{
          border: "1px dashed var(--border)", borderRadius: 8, padding: "14px",
          textAlign: "center", fontSize: 12, color: "var(--text3)", lineHeight: 1.6,
        }}>
          Ou glisser-déposer<br />sur le canvas
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}>
          <span style={label}>X</span>
          <input type="number" value={imgImport.x} min={-W} max={W}
            onChange={e => setImgImport(im => ({ ...im, x: Number(e.target.value) }))}
            style={{ width: "100%", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", padding: "4px 6px" }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <span style={label}>Y</span>
          <input type="number" value={imgImport.y} min={-H} max={H}
            onChange={e => setImgImport(im => ({ ...im, y: Number(e.target.value) }))}
            style={{ width: "100%", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", padding: "4px 6px" }}
          />
        </div>
      </div>

      <div>
        <span style={label}>Échelle · {Math.round(imgImport.scale * 100)}%</span>
        <input type="range" min={0.1} max={3} step={0.05} value={imgImport.scale}
          onChange={e => setImgImport(im => ({ ...im, scale: Number(e.target.value) }))}
          style={{ width: "100%", accentColor: "var(--accent)" }} />
      </div>

      <div>
        <span style={label}>Aperçu opacité · {Math.round(imgImport.opacity * 100)}%</span>
        <input type="range" min={0.1} max={1} step={0.05} value={imgImport.opacity}
          onChange={e => setImgImport(im => ({ ...im, opacity: Number(e.target.value) }))}
          style={{ width: "100%", accentColor: "var(--accent)" }} />
      </div>

      <div>
        <span style={label}>Tramage</span>
        <select value={imgImport.dithering}
          onChange={e => setImgImport(im => ({ ...im, dithering: e.target.value as any }))}
          style={{ width: "100%", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", padding: "5px 6px" }}>
          <option value="none">Aucun (seuil)</option>
          <option value="floyd">Floyd-Steinberg</option>
          <option value="ordered">Bayer ordonné</option>
        </select>
      </div>

      {imgImport.dithering !== "floyd" && (
        <div>
          <span style={label}>Seuil · {Math.round(imgImport.threshold * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={imgImport.threshold}
            onChange={e => setImgImport(im => ({ ...im, threshold: Number(e.target.value) }))}
            style={{ width: "100%", accentColor: "var(--accent)" }} />
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button onClick={onApply} style={{ ...smallBtn(true), flex: 1, padding: "10px 0" }}>✓ Appliquer</button>
        <button onClick={onCancel} style={{ ...smallBtn(), flex: 1, padding: "10px 0" }}>✕ Annuler</button>
      </div>
    </div>
  );
}