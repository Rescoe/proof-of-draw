"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { SCREEN_PROFILES, ScreenId } from "@/lib/screenProfiles";
import { OwnedDevice } from "@/lib/deviceStore";
import { canvasToScreenPayload } from "@/lib/canvasToScreen";
import type { ActionEvent, ReplayEvent } from "@/lib/types/actions";

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

const DRAW_WINDOW_SEC  = 900;  // 15 min — doit correspondre à DRAW_WINDOW_SEC serveur
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
  const [isGuest, setIsGuest]       = useState(false);        // true si ESP public non possédé
  const [guestName, setGuestName]   = useState("");           // nom de l'artiste invité
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
    data: null, x: 0, y: 0, scale: 1, opacity: 0.3,
    dithering: "floyd", threshold: 0.4,
  });
  const [imgMode, setImgMode] = useState(false);
  const [guideActive, setGuideActive] = useState(false);

  const [cooldown, setCooldown]     = useState(0);
  const cooldownRef                 = useRef<ReturnType<typeof setInterval> | null>(null);
  const [banWarning, setBanWarning] = useState(false);

  // ── Proof-of-Draw action tracking ──────────────────────────────────────────
  const actionsRef           = useRef<ActionEvent[]>([]);
  const sessionStartRef      = useRef<number>(Date.now());

  // ── Axe 4 : score courant + checkpoints (pour clear) ──────────────────────
  const scoreRef             = useRef<number>(0);
  const scoreCheckpointsRef  = useRef<number[]>([]);
  const lastActionWasClearRef= useRef<boolean>(false);

  // ── Axe 4 : replay pixel-perfect ──────────────────────────────────────────
  const replayRef            = useRef<ReplayEvent[]>([]);
  const lastReplayT          = useRef<number>(0);
  const REPLAY_THROTTLE_MS   = 16; // ~60fps max
  // Longueur du replay à chaque point de l'historique (pour restauration sur undo)
  const replaySnapshots      = useRef<number[]>([]);

  // ── Import d'image — tracking provenance ──────────────────────────────────
  // (Anciens refs d'import supprimés — l'image ne peut plus être appliquée au canvas)

  // ── Titre de l'œuvre ───────────────────────────────────────────────────────
  const [workTitle, setWorkTitle]     = useState("");
  const [titleError, setTitleError]   = useState(false);

  // ── Toast envoi mobile ─────────────────────────────────────────────────────
  const [showSendToast, setShowSendToast]     = useState(false);
  const [toastTitle, setToastTitle]           = useState("");
  const [toastGuestName, setToastGuestName]   = useState("");

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
    // Enregistrer la longueur du replay à ce point (pour restauration sur undo)
    replaySnapshots.current = replaySnapshots.current.slice(0, historyIndex.current);
    replaySnapshots.current.push(replayRef.current.length);
    setCanUndo(historyIndex.current > 0);
    setCanRedo(false);
  }, [W, H]);

  const undo = useCallback(() => {
    if (historyIndex.current <= 0) return;
    historyIndex.current--;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.putImageData(history.current[historyIndex.current], 0, 0);
    // Restaurer le replay à l'état de ce point historique
    const snapshotLen = replaySnapshots.current[historyIndex.current] ?? 0;
    replayRef.current = replayRef.current.slice(0, snapshotLen);
    replaySnapshots.current = replaySnapshots.current.slice(0, historyIndex.current + 1);
    setCanUndo(historyIndex.current > 0);
    setCanRedo(true);
    actionsRef.current.push({ kind: "undo", t: Date.now() - sessionStartRef.current });
    // Axe 4 : undo après clear → restaurer le checkpoint
    if (lastActionWasClearRef.current && scoreCheckpointsRef.current.length > 0) {
      scoreRef.current = scoreCheckpointsRef.current.pop()!;
    } else {
      scoreRef.current = Math.max(0, scoreRef.current - 1);
    }
    lastActionWasClearRef.current = false;
  }, []);

  const redo = useCallback(() => {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current++;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.putImageData(history.current[historyIndex.current], 0, 0);
    setCanUndo(true);
    setCanRedo(historyIndex.current < history.current.length - 1);
    actionsRef.current.push({ kind: "redo", t: Date.now() - sessionStartRef.current });
    lastActionWasClearRef.current = false;
    // redo est neutre sur le score
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
        if (d && d.screens?.includes(screenId)) {
          setDevice(d);
          setIsGuest(false);
          return;
        }
        // Pas dans mes devices → vérifier si c'est un ESP public
        const pubRes  = await fetch("/api/public-screens");
        const pubData = await pubRes.json();
        if (cancelled) return;
        const pub = (pubData.devices ?? []).find(
          (p: { deviceId: string; screens: string[] }) =>
            String(p.deviceId).trim() === String(deviceId).trim() &&
            p.screens?.includes(screenId)
        );
        if (pub) {
          // Construit un OwnedDevice minimal pour le mode invité
          setDevice({
            deviceId:   pub.deviceId,
            artistName: pub.artistName,
            screens:    pub.screens,
            firmware:   "",
            framesSent: 0,
            lastPing:   0,
            lastSeen:   0,
            createdAt:  0,
            isOnline:   pub.isOnline,
            hasPairCode: false,
            publicMode: true,
          });
          setIsGuest(true);
          return;
        }
        // Ni possédé ni public → retry puis redirect
        if (attempt < 5 && !cancelled) setTimeout(() => loadDevice(attempt + 1), 1000);
        else if (!cancelled) router.push("/draw");
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
  const needsTitle = canSend && !workTitle.trim();

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
      scoreRef.current += 1;
      lastActionWasClearRef.current = false;
      drawing.current = false;
      return;
    }
    if (tool === "brush" || tool === "eraser") {
      ctx.globalAlpha = opacity / 100;
      ctx.fillStyle   = tool === "eraser" ? "#FFFFFF" : activeColor;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Axe 4 : enregistrer l'événement de replay "down"
      const t = Date.now() - sessionStartRef.current;
      replayRef.current.push({
        kind: "down", t, x: pt.x, y: pt.y,
        tool, color: tool === "eraser" ? "#FFFFFF" : activeColor, size: brushSize,
      });
      lastReplayT.current = t;
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
      // Axe 4 : enregistrer le mouvement (throttlé à 16ms)
      const t = Date.now() - sessionStartRef.current;
      if (t - lastReplayT.current >= REPLAY_THROTTLE_MS) {
        replayRef.current.push({
          kind: "move", t, x: pt.x, y: pt.y,
          tool, color, size: brushSize,
        });
        lastReplayT.current = t;
      }
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
    const t = Date.now() - sessionStartRef.current;
    // Enregistrer l'action selon l'outil
    if (tool === "brush") {
      actionsRef.current.push({ kind: "stroke", t, tool: "brush", color: activeColor });
      scoreRef.current += 1;
      lastActionWasClearRef.current = false;
      // Axe 4 : enregistrer "up"
      replayRef.current.push({ kind: "up", t, x: pt.x, y: pt.y, tool });
    } else if (tool === "eraser") {
      actionsRef.current.push({ kind: "erase", t, tool: "eraser" });
      // erase = 0 : ne contribue pas au score Proof-of-Draw
      lastActionWasClearRef.current = false;
      replayRef.current.push({ kind: "up", t, x: pt.x, y: pt.y, tool });
    } else if (tool === "line" || tool === "rect" || tool === "ellipse") {
      actionsRef.current.push({ kind: "shape", t, tool, color: activeColor });
      scoreRef.current += 1;
      lastActionWasClearRef.current = false;
    }
    saveHistory();
  }, [tool, activeColor, brushSize, W, H, toCanvasPoint, drawLine, drawRect, drawEllipse, saveHistory]);

  // ── Clear ──────────────────────────────────────────────────────────────────
  const clearCanvas = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);
    // Axe 4 : empiler le score courant et remettre à 0
    scoreCheckpointsRef.current.push(scoreRef.current);
    scoreRef.current = 0;
    lastActionWasClearRef.current = true;
    actionsRef.current.push({ kind: "clear", t: Date.now() - sessionStartRef.current, tool: "clear", color: "#FFFFFF" });
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
    setGuideActive(false);
    setImgImport(s => ({ ...s, data: null }));
    overlayRef.current?.getContext("2d")?.clearRect(0, 0, W, H);
    setMobileSheet(null);
  }, [W, H]);

  // Activer l'image comme guide visuel — NE la dessine PAS sur le canvas principal.
  // L'image reste sur le canvas overlay à 30% d'opacité comme repère de dessin.
  // Elle ne sera jamais incluse dans le payload soumis.
  const activateGuide = useCallback(() => {
    if (!imgImport.data) return;
    setImgMode(false);
    setGuideActive(true);
    setMobileSheet(null);
  }, [imgImport.data]);

  // Retirer le guide sans toucher au canvas de dessin
  const deactivateGuide = useCallback(() => {
    setGuideActive(false);
    setImgMode(false);
    setImgImport(s => ({ ...s, data: null }));
    overlayRef.current?.getContext("2d")?.clearRect(0, 0, W, H);
    setMobileSheet(null);
  }, [W, H]);

  // ── Image overlay rendering ────────────────────────────────────────────────
  // Deux modes :
  //   guideActive=true → guide visuel brut (sans tramage), semi-transparent
  //   imgMode=true     → aperçu de positionnement avant activation (même rendu brut)
  useEffect(() => {
    const overlay = overlayRef.current?.getContext("2d");
    if (!overlay) return;
    overlay.clearRect(0, 0, W, H);
    if (!imgImport.data || (!imgMode && !guideActive)) return;
    // Rendu brut sans tramage — l'image est un guide visuel, pas un dessin à convertir
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    off.getContext("2d")!.putImageData(imgImport.data, 0, 0);
    overlay.globalAlpha = imgImport.opacity;
    overlay.drawImage(off, imgImport.x, imgImport.y,
      Math.round(W * imgImport.scale), Math.round(H * imgImport.scale));
    overlay.globalAlpha = 1;
  }, [imgImport, imgMode, guideActive, W, H]);

  // ── Send ───────────────────────────────────────────────────────────────────
  // titleOverride / guestOverride : utilisés par le toast mobile pour passer les valeurs saisies
  const handleSend = useCallback(async (titleOverride?: string, guestOverride?: string) => {
    if (!device || !canSend || !canvasRef.current) return;

    const effectiveTitle = titleOverride ?? workTitle;
    const effectiveGuest = guestOverride ?? guestName;

    // Titre obligatoire
    if (!effectiveTitle.trim()) {
      if (!titleOverride) { setTitleError(true); setTimeout(() => setTitleError(false), 2500); }
      return;
    }

    setSending(true); setStatus(null);
    try {
      const payload      = canvasToScreenPayload(canvasRef.current, screenId);
      const actions      = actionsRef.current;
      const replayEvents = replayRef.current;
      // Axe 4 : utiliser le score calculé en temps réel plutôt que de recalculer
      const drawScore    = scoreRef.current;
      // Mode invité : inclure le nom de l'artiste dessinateur
      const drawArtistName = isGuest && effectiveGuest.trim() ? effectiveGuest.trim() : undefined;

      const baseBody = {
        screen: screenId, deviceId, actions, replayEvents, drawScore, drawArtistName,
        workTitle: effectiveTitle.trim(),
      };
      const body =
        screenId === "eink29bwr"
          ? { ...baseBody, black: (payload as any).black, red: (payload as any).red }
          : { ...baseBody, buffer: (payload as any).buffer };
      const res  = await fetch("/api/draw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const secs = data.nextDrawIn ?? DRAW_WINDOW_SEC;
        saveCooldown(deviceId, screenId, Date.now() + secs * 1000);
        startCooldown(secs); setBanWarning(true); setStatus({ type: "wait", msg: "" }); return;
      }
      // File d'attente pleine (503)
      if (res.status === 503 && data.queueFull) {
        setStatus({ type: "error", msg: `File d'attente pleine (${data.queueLen}/${data.queueLen} dessins en attente). Réessayez dans quelques minutes.` });
        setTimeout(() => setStatus(null), 8000);
        return;
      }
      // Rejet explicite (dessin invalide) — affiche le message lisible sans bloquer le cooldown
      if (!res.ok && data.validation === "rejected") {
        setStatus({ type: "error", msg: data.message || data.reason || "Dessin rejeté" });
        setTimeout(() => setStatus(null), 8000);
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      const secs = data.nextDrawIn ?? DRAW_WINDOW_SEC;
      saveCooldown(deviceId, screenId, Date.now() + secs * 1000);
      startCooldown(secs);
      // Afficher la position en file si le dessin est mis en attente
      if (data.validation === "queued") {
        setStatus({ type: "ok", msg: `En file d'attente (position ${data.queuePosition}/${50}) — traitement dans ~${data.expiresIn ?? "?"}s` });
        setTimeout(() => setStatus(null), 6000);
      } else if (data.validation === "fallback_direct") {
        // Diffusion directe sans validation blockchain — erreur de configuration serveur
        setStatus({ type: "error", msg: `⚠ Diffusé sans validation (INTERNAL_API_SECRET manquant ou submit-candidate indisponible). Vérifiez les variables d'environnement Vercel.` });
        setTimeout(() => setStatus(null), 12000);
      } else {
        setStatus({ type: "ok", msg: "" });
      }
      // Réinitialiser après envoi réussi
      setWorkTitle("");
    } catch (err: any) {
      setStatus({ type: "error", msg: err.message || "Erreur réseau" });
      setTimeout(() => setStatus(null), 5000);
    } finally { setSending(false); }
  }, [device, canSend, screenId, deviceId, isGuest, guestName, workTitle, startCooldown]); // effectiveTitle/Guest viennent des args ou de la closure

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

  // Taille des swatches adaptée à la palette :
  // > 16 couleurs (TFT 48 couleurs) → grille compacte 28px
  // ≤ 16 couleurs (e-ink mono/bwr, OLED) → swatches confortables 40px
  const isFullColor  = screenId === "tft18";
  const swatchSize   = colors.length > 16 ? 28 : 40;
  const swatchRadius = colors.length > 16 ? 6  : 10;
  const swatchGap    = colors.length > 16 ? 4  : 8;

  const PaletteContent = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Écrans RGB565 (TFT) : sélecteur libre en tête — toutes les couleurs possibles */}
      {isFullColor && (
        <div style={{ display: "flex", gap: 8, alignItems: "stretch", marginBottom: 2 }}>
          <input
            type="color"
            value={activeColor}
            onChange={e => setActiveColor(e.target.value)}
            style={{ width: 56, height: 56, borderRadius: 10, border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}
            title="Couleur libre — toutes les couleurs RGB565"
          />
          <div style={{
            flex: 1, borderRadius: 10,
            background: activeColor,
            border: "2px solid rgba(255,255,255,0.18)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 2,
          }}>
            <span style={{
              fontSize: 13, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.05em",
              color: parseInt(activeColor.slice(1, 3), 16) * 0.299
                   + parseInt(activeColor.slice(3, 5), 16) * 0.587
                   + parseInt(activeColor.slice(5, 7), 16) * 0.114 > 150 ? "#111" : "#fff",
            }}>
              {activeColor.toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* Grille de couleurs — compacte pour les grandes palettes */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, ${swatchSize}px)`,
        gap: swatchGap,
      }}>
        {colors.map((c, i) => (
          <button key={c} onClick={() => { setActiveColor(c); setMobileSheet(null); }}
            title={colorLabels[i]}
            style={{
              width: swatchSize, height: swatchSize,
              borderRadius: swatchRadius,
              border: "none", cursor: "pointer",
              background: c,
              outline: activeColor === c ? "3px solid var(--accent)" : "1px solid rgba(255,255,255,0.18)",
              outlineOffset: 2, transition: "outline 0.1s", flexShrink: 0,
            }}
          />
        ))}
      </div>

      {/* Écrans mono/bwr : sélecteur libre en bas (couleur libre sur fond noir/blanc) */}
      {!isFullColor && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="color" value={activeColor}
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
      )}
    </div>
  );

  const ImageContent = (
    <ImagePanel
      imgImport={imgImport} setImgImport={setImgImport}
      imgMode={imgMode} guideActive={guideActive}
      onLoad={() => fileInputRef.current?.click()}
      onApply={activateGuide}
      onCancel={cancelImport}
      onDeactivate={deactivateGuide}
      W={W} H={H}
      smallBtn={smallBtn} label={label}
    />
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  // rootRef est posé sur le div racine — c'est lui qu'on passe à requestFullscreen
  return (
    <>
    {/* Animation CSS du ticker TFT — injectée une seule fois dans la page */}
    {isFullColor && (
      <style>{`
        @keyframes tftTicker {
          0%   { transform: translateX(0%); }
          20%  { transform: translateX(0%); }
          60%  { transform: translateX(-50%); }
          80%  { transform: translateX(-50%); }
          100% { transform: translateX(0%); }
        }
      `}</style>
    )}
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

        {/* Device info — ticker animé pour TFT (plus d'infos à afficher) */}
        <div style={{ flexShrink: 1, overflow: "hidden", minWidth: 0 }}>
          {isFullColor ? (
            /* TFT : marquee CSS pour faire défiler les infos dans la barre étroite */
            <div style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
              <span style={{
                display: "inline-block",
                fontWeight: 700, fontSize: "0.82rem",
                animation: "tftTicker 10s linear infinite",
              }}>
                {isGuest ? `🔓 ESP de ${device?.artistName || deviceId}` : (device?.artistName || deviceId)}
                &nbsp;·&nbsp;
                <span style={{ color: "var(--text3)", fontWeight: 400, fontFamily: "monospace", fontSize: "0.72rem" }}>
                  {profile.name}&nbsp;{W}×{H}&nbsp;RGB565
                </span>
                &nbsp;&nbsp;&nbsp;&nbsp;
              </span>
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {isGuest ? `ESP de ${device?.artistName || deviceId}` : (device?.artistName || deviceId)}
              </div>
              {!isMobile && (
                <div style={{ color: "var(--text3)", fontSize: "0.65rem", fontFamily: "monospace" }}>
                  {isGuest ? "🔓 ESP partagé · " : ""}{profile.name} · {W}×{H}px
                </div>
              )}
            </>
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

        {/* Guide actif badge */}
        {guideActive && !imgMode && (
          <div
            onClick={deactivateGuide}
            title="Cliquer pour retirer le guide"
            style={{
              padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: "rgba(96,165,250,0.12)", color: "#60a5fa",
              border: "1px solid rgba(96,165,250,0.35)", flexShrink: 0, whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            🎯 {isMobile ? "Guide" : "Guide actif — cliquer pour retirer"}
          </div>
        )}

        {/* imgMode badge (positionnement en cours) */}
        {imgMode && (
          <div style={{
            padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: "rgba(96,165,250,0.12)", color: "#60a5fa",
            border: "1px solid rgba(96,165,250,0.35)", flexShrink: 0, whiteSpace: "nowrap",
          }}>
            🎯 {isMobile ? "Positionner" : "Positionnez le guide, puis activez"}
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
            {status.type === "ok" && status.msg && status.msg.length > 0 && status.msg}
            {status.type === "ok" && (!status.msg || status.msg.length === 0) && cooldown > 0 && `✓ Soumis — ${formatTime(cooldown)}`}
            {status.type === "ok" && (!status.msg || status.msg.length === 0) && cooldown === 0 && "✓ Prêt"}
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
            onClick={isMobile
              ? () => { setToastTitle(workTitle); setToastGuestName(guestName); setShowSendToast(true); }
              : () => handleSend()}
            disabled={!canSend}
            style={{
              padding: isMobile ? "7px 14px" : "6px 20px",
              borderRadius: 9, border: "none",
              background: needsTitle
                  ? "rgba(248,113,113,0.18)"
                  : canSend ? "var(--accent)" : "var(--bg3)",
              color: canSend && !needsTitle ? "#fff"
                : needsTitle ? "#f87171"
                : "var(--text3)",
              cursor: canSend ? "pointer" : "not-allowed",
              fontWeight: 700, fontSize: "0.85rem",
              minWidth: isMobile ? 90 : 110,
              transition: "all 0.2s",
            }}
          >
            {sending        ? "Envoi…"

              : cooldown > 0 ? `⏳ ${formatTime(cooldown)}`
              : needsTitle  ? "✏️ Titre ?"
              : "📡 Envoyer"}
          </button>
        </div>
      </div>

      {/* ── Titre de l'œuvre (requis) — caché sur mobile (géré via toast) ─── */}
      <div style={{
        display: isMobile ? "none" : "flex", alignItems: "center", gap: 8,
        padding: "4px 14px",
        background: titleError ? "rgba(248,113,113,0.06)" : "var(--bg2)",
        borderBottom: `1px solid ${titleError ? "rgba(248,113,113,0.4)" : "var(--border)"}`,
        flexShrink: 0,
        transition: "background 0.2s, border-color 0.2s",
      }}>
        <span style={{
          fontSize: 10, color: titleError ? "#f87171" : "var(--text3)",
          whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.06em",
          flexShrink: 0,
        }}>
          {titleError ? "⚠ Titre requis" : "Titre"}
        </span>
        <input
          type="text"
          placeholder="Nom de l'œuvre (obligatoire avant envoi)…"
          value={workTitle}
          onChange={e => { setWorkTitle(e.target.value.slice(0, 80)); setTitleError(false); }}
          maxLength={80}
          style={{
            flex: 1,
            padding: "3px 10px",
            borderRadius: 6,
            border: titleError ? "1px solid #f87171" : "1px solid rgba(124,107,255,0.25)",
            background: titleError ? "rgba(248,113,113,0.1)" : "rgba(0,0,0,0.3)",
            color: "var(--text)",
            fontSize: 12,
            outline: "none",
            transition: "border-color 0.2s, background 0.2s",
          }}
        />
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

      {/* ── Bannière mode invité — cachée sur mobile (saisie via toast) ─────── */}
      {isGuest && !isMobile && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "6px 14px",
          background: "rgba(124,107,255,0.08)",
          borderBottom: "1px solid rgba(124,107,255,0.2)",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, whiteSpace: "nowrap" }}>
            🔓 ESP partagé
          </span>
          <span style={{ fontSize: 11, color: "var(--text3)", whiteSpace: "nowrap" }}>
            Votre dessin sera signé :
          </span>
          <input
            type="text"
            placeholder="Votre nom d'artiste…"
            value={guestName}
            onChange={e => setGuestName(e.target.value.slice(0, 40))}
            maxLength={40}
            style={{
              flex: 1, minWidth: 140, maxWidth: 260,
              padding: "4px 10px", borderRadius: 6,
              border: "1px solid rgba(124,107,255,0.35)",
              background: "rgba(0,0,0,0.3)",
              color: "var(--text)",
              fontSize: 12,
              outline: "none",
            }}
          />
          {!guestName.trim() && (
            <span style={{ fontSize: 10, color: "var(--text3)", fontStyle: "italic" }}>
              (anonyme si vide)
            </span>
          )}
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

      {/* ── Toast d'envoi mobile ──────────────────────────────────────────── */}
      {showSendToast && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowSendToast(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 3000,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}
        >
          <div style={{
            width: "100%", maxWidth: 480,
            background: "var(--bg1, #13192b)",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "16px 16px 0 0",
            padding: "20px 20px 32px",
            animation: "slideUp 0.2s ease",
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>📡 Envoyer le dessin</span>
              <button
                onClick={() => setShowSendToast(false)}
                style={{ background: "none", border: "none", color: "var(--text3)", fontSize: 20, cursor: "pointer", padding: "2px 8px" }}
              >✕</button>
            </div>

            {/* Titre */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Titre de l'œuvre <span style={{ color: "#f87171" }}>*</span>
              </label>
              <input
                type="text"
                placeholder="Nom de l'œuvre (obligatoire)…"
                value={toastTitle}
                onChange={e => setToastTitle(e.target.value.slice(0, 80))}
                autoFocus
                maxLength={80}
                style={{
                  padding: "10px 14px", borderRadius: 8,
                  border: toastTitle.trim() ? "1px solid rgba(124,107,255,0.4)" : "1px solid rgba(248,113,113,0.5)",
                  background: "rgba(0,0,0,0.35)", color: "var(--text)", fontSize: 14, outline: "none",
                }}
              />
            </div>

            {/* Nom d'artiste (mode invité) */}
            {isGuest && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  🔓 Votre nom d'artiste
                </label>
                <input
                  type="text"
                  placeholder="Votre nom (anonyme si vide)…"
                  value={toastGuestName}
                  onChange={e => setToastGuestName(e.target.value.slice(0, 40))}
                  maxLength={40}
                  style={{
                    padding: "10px 14px", borderRadius: 8,
                    border: "1px solid rgba(124,107,255,0.3)",
                    background: "rgba(0,0,0,0.35)", color: "var(--text)", fontSize: 14, outline: "none",
                  }}
                />
              </div>
            )}

            {/* Bouton confirmer */}
            <button
              onClick={() => {
                if (!toastTitle.trim()) return;
                setShowSendToast(false);
                handleSend(toastTitle, toastGuestName);
              }}
              disabled={!toastTitle.trim() || sending}
              style={{
                padding: "13px", borderRadius: 10, border: "none", marginTop: 4,
                background: toastTitle.trim() && !sending ? "var(--accent)" : "var(--bg3)",
                color: toastTitle.trim() && !sending ? "#fff" : "var(--text3)",
                fontWeight: 700, fontSize: 15,
                cursor: toastTitle.trim() && !sending ? "pointer" : "not-allowed",
                transition: "all 0.2s",
              }}
            >
              {sending ? "Envoi en cours…" : "Confirmer et envoyer"}
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
    </>
  );
}

// ─── ImagePanel ───────────────────────────────────────────────────────────────

function ImagePanel({
  imgImport, setImgImport, imgMode, guideActive,
  onLoad, onApply, onCancel, onDeactivate,
  W, H, smallBtn, label,
}: {
  imgImport: ImageImport;
  setImgImport: React.Dispatch<React.SetStateAction<ImageImport>>;
  imgMode: boolean;
  guideActive: boolean;
  onLoad: () => void; onApply: () => void; onCancel: () => void; onDeactivate: () => void;
  W: number; H: number;
  smallBtn: (accent?: boolean) => React.CSSProperties;
  label: React.CSSProperties;
}) {
  // Aucune image chargée — proposer le chargement
  if (!imgImport.data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={onLoad} style={{ ...smallBtn(), width: "100%", padding: "12px" }}>
          📂 Charger une image de référence
        </button>
        <div style={{
          border: "1px dashed var(--border)", borderRadius: 8, padding: "14px",
          textAlign: "center", fontSize: 11, color: "var(--text3)", lineHeight: 1.6,
        }}>
          Ou glisser-déposer sur le canvas
          <br />
          <span style={{ color: "#60a5fa", fontWeight: 600 }}>
            🎯 Guide uniquement — jamais soumis
          </span>
        </div>
      </div>
    );
  }

  // Contrôles communs position/échelle/opacité
  const posControls = (
    <>
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
        <span style={label}>Opacité guide · {Math.round(imgImport.opacity * 100)}%</span>
        <input type="range" min={0.1} max={0.6} step={0.05} value={imgImport.opacity}
          onChange={e => setImgImport(im => ({ ...im, opacity: Number(e.target.value) }))}
          style={{ width: "100%", accentColor: "var(--accent)" }} />
      </div>
    </>
  );

  // Guide actif — l'image est visible sur le canvas comme référence
  if (guideActive) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{
          padding: "8px 10px", borderRadius: 8, fontSize: 11, lineHeight: 1.5,
          background: "rgba(96,165,250,0.08)", color: "#60a5fa",
          border: "1px solid rgba(96,165,250,0.25)",
        }}>
          🎯 Guide visible sur le canvas<br />
          <span style={{ color: "var(--text3)" }}>Dessinez par-dessus — l'image n'est pas dans le dessin soumis.</span>
        </div>
        {posControls}
        <button onClick={onDeactivate} style={{ ...smallBtn(), width: "100%", padding: "9px 0", marginTop: 4 }}>
          🗑 Retirer le guide
        </button>
      </div>
    );
  }

  // Mode positionnement (image chargée, pas encore activée comme guide)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{
        padding: "6px 10px", borderRadius: 7, fontSize: 11, lineHeight: 1.5,
        background: "rgba(96,165,250,0.06)", color: "var(--text3)",
        border: "1px solid rgba(96,165,250,0.18)",
      }}>
        Positionnez l'image puis activez-la comme guide de dessin.
        <br /><span style={{ color: "#60a5fa", fontWeight: 600 }}>Elle ne sera jamais soumise.</span>
      </div>
      {posControls}
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button onClick={onApply} style={{ ...smallBtn(true), flex: 1, padding: "10px 0" }}>🎯 Activer comme guide</button>
        <button onClick={onCancel} style={{ ...smallBtn(), flex: 1, padding: "10px 0" }}>✕ Annuler</button>
      </div>
    </div>
  );
}