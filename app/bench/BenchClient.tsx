"use client";

// app/bench/BenchClient.tsx — Banc d'essai d'animation pour le TFT 2.8" tactile (v1, preuve de concept).
// On dessine une animation OLED 128×64 (1 bit) ; le serveur l'encode en DIFFÉRENCES entre images, la R4 la télécharge puis la joue en
// ne repeignant que les octets modifiés, agrandie ×1,875 au centre de l'écran 240×320. L'appareil renvoie ses MESURES (vitesse réelle).
// Interface inspirée de l'ancien « Rescoled » : timeline de frames, ▶ ⏮ ⏭, délai par frame, onion skin, « envoyer l'animation ».

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLIP, clipPixel, clipPlayMs, clipStats, type ClipInput } from "@/lib/bench/clip";
import type { BenchLogLine, BenchResult, ClipPointer } from "@/lib/bench/store";
import { encodeGif } from "@/lib/bench/gif";

const W = CLIP.W, H = CLIP.H, RB = CLIP.ROW_BYTES;
const DRAFT_KEY = "pod-bench-draft-v1";
const ASSUMED_LINK_BYTES_PER_SEC = 45_000;   // ESTIMATION d'affichage uniquement : la vraie valeur vient des mesures de l'appareil

// ── Images 1 bit ─────────────────────────────────────────────────────────────
const blank = () => new Uint8Array(CLIP.FRAME_BYTES);
function setPx(f: Uint8Array, x: number, y: number, on: boolean) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = y * RB + (x >> 3), m = 0x80 >> (x & 7);
  if (on) f[i] |= m; else f[i] &= ~m;
}
function drawLine(f: Uint8Array, x0: number, y0: number, x1: number, y1: number, on: boolean) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (let guard = 0; guard < 1000; guard++) {
    setPx(f, x, y, on);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
function shifted(f: Uint8Array, dx: number, dy: number): Uint8Array {
  const out = blank();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (clipPixel(f, x, y)) setPx(out, (x + dx + W) % W, (y + dy + H) % H, true);
  return out;
}
const inverted = (f: Uint8Array) => Uint8Array.from(f, (v) => v ^ 0xff);
const toB64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hexTo565 = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (((n >> 16) & 0xff) >> 3 << 11) | (((n >> 8) & 0xff) >> 2 << 5) | ((n & 0xff) >> 3); };

// ── Modèles de test ──────────────────────────────────────────────────────────
interface Anim { frames: Uint8Array[]; delays: number[] }

function presetBall(): Anim {
  const frames: Uint8Array[] = [];
  for (let k = 0; k < 28; k++) {
    const f = blank(), t = k / 28;
    const cx = Math.round(8 + (Math.abs(((t * 2) % 2) - 1)) * 111), cy = Math.round(32 + Math.sin(t * Math.PI * 4) * 22);
    for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) if (x * x + y * y <= 25) setPx(f, cx + x, cy + y, true);
    frames.push(f);
  }
  return { frames, delays: frames.map(() => 60) };
}
function presetWave(): Anim {
  const frames: Uint8Array[] = [];
  for (let k = 0; k < 12; k++) {
    const f = blank(); let py = 0;
    for (let x = 0; x < W; x++) {
      const y = Math.round(32 + Math.sin((x / W) * Math.PI * 4 + (k / 12) * Math.PI * 2) * 11);
      if (x > 0) drawLine(f, x - 1, py, x, y, true);
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
  const frames: Uint8Array[] = [];
  for (let k = 0; k < 8; k++) { const f = blank(); for (let i = 0; i < 700; i++) setPx(f, Math.floor(rnd() * W), Math.floor(rnd() * H), true); frames.push(f); }
  return { frames, delays: frames.map(() => 100) };
}
function presetText(text: string): Anim {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return { frames: [blank()], delays: [100] };
  ctx.font = "bold 26px monospace";
  const tw = Math.ceil(ctx.measureText(text || " ").width), total = tw + W, step = Math.max(6, Math.ceil(total / 40));   // ≤ 40 images : le clip doit tenir en 9 Ko
  const frames: Uint8Array[] = [];
  for (let off = 0; off < total; off += step) {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(text || " ", W - off, H / 2 + 2);
    const d = ctx.getImageData(0, 0, W, H).data, f = blank();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4] > 127) setPx(f, x, y, true);
    frames.push(f);
  }
  return { frames, delays: frames.map(() => 60) };
}

// ── Petits composants ────────────────────────────────────────────────────────
function useFramePaint(canvas: React.RefObject<HTMLCanvasElement | null>, frame: Uint8Array, fg: string, bg: string, onion?: Uint8Array) {
  useEffect(() => {
    const cv = canvas.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
    if (onion) { ctx.globalAlpha = 0.28; ctx.fillStyle = fg; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (clipPixel(onion, x, y)) ctx.fillRect(x, y, 1, 1); ctx.globalAlpha = 1; }
    ctx.fillStyle = fg;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (clipPixel(frame, x, y)) ctx.fillRect(x, y, 1, 1);
  }, [canvas, frame, fg, bg, onion]);
}

function Thumb({ frame, fg, bg, selected, index, onClick }: { frame: Uint8Array; fg: string; bg: string; selected: boolean; index: number; onClick: () => void }) {
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
const label: React.CSSProperties = { fontSize: "0.68rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" };
const muted: React.CSSProperties = { fontSize: "0.76rem", color: "var(--text3)", lineHeight: 1.5, margin: 0 };

interface Dev { deviceId: string; deviceName?: string; artistName?: string; screens: string[]; isOnline: boolean }
interface Status { mode: boolean; clip: ClipPointer | null; seenAgoMs: number | null; results: BenchResult[]; log: BenchLogLine[]; firmware: string | null; lastPingAgoMs: number | null }
type Tool = "pencil" | "eraser" | "line";

interface Draft { frames: string[]; delays: number[]; loops: number; fg: string; bg: string; handmade?: boolean; title?: string }

/** Le banc d'essai exige le firmware r4tft28-2.1 ou plus : une 2.0 ignore le mode et ne fait jamais de contrôle rapide. */
function firmwareOk(fw: string | null): boolean | null {
  if (!fw) return null;
  const m = /^r4tft28-(\d+)\.(\d+)/.exec(fw);
  return m ? Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 1) : false;
}
const hexToRgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]; };
function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function loadDraft(): Draft | null {
  try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? (JSON.parse(raw) as Draft) : null; } catch { return null; }
}

export default function BenchClient() {
  const [draft] = useState(loadDraft);
  const [frames, setFrames] = useState<Uint8Array[]>(() => (draft?.frames?.length ? draft.frames.map(fromB64) : [blank()]));
  const [delays, setDelays] = useState<number[]>(() => (draft?.delays?.length === (draft?.frames?.length ?? -1) ? draft!.delays : [100]));
  const [cur, setCur] = useState(0);
  const [loops, setLoops] = useState(draft?.loops ?? 3);
  const [fg, setFg] = useState(draft?.fg ?? "#00ff88");
  const [bg, setBg] = useState(draft?.bg ?? "#000000");
  const [tool, setTool] = useState<Tool>("pencil");
  const [onion, setOnion] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [text, setText] = useState("PoD");
  const [devices, setDevices] = useState<Dev[] | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Une animation est « faite à la main » dès qu'on la modifie ; un modèle de test chargé ne l'est pas (et n'entre jamais dans la galerie).
  const [handmade, setHandmade] = useState<boolean>(draft?.handmade ?? true);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [toGallery, setToGallery] = useState(true);
  const [allDevices, setAllDevices] = useState<Dev[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x0: number; y0: number; base: Uint8Array } | null>(null);

  const n = frames.length;
  const idx = Math.min(cur, n - 1);
  const frame = frames[idx];
  useFramePaint(canvasRef, frame, fg, bg, onion && !playing && idx > 0 ? frames[idx - 1] : undefined);

  // ── Brouillon local ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ frames: frames.map(toB64), delays, loops, fg, bg, handmade, title } satisfies Draft)); } catch { /* stockage indisponible */ }
    }, 400);
    return () => clearTimeout(t);
  }, [frames, delays, loops, fg, bg, handmade, title]);

  // ── Aperçu animé (délais par image) ────────────────────────────────────────
  useEffect(() => {
    if (!playing || n < 2) return;
    const t = setTimeout(() => setCur((c) => (c + 1) % n), Math.max(20, delays[idx] ?? 100));
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
        if (mine.length) setDeviceId((cur) => cur || mine[0].deviceId);
      })
      .catch(() => { if (alive) setDevices([]); });
    return () => { alive = false; };
  }, []);

  // ── État du banc d'essai (mode, présence, mesures) ─────────────────────────
  const refreshStatus = useCallback(async () => {
    if (!deviceId) return;
    try {
      const r = await fetch(`/api/bench/status?deviceId=${deviceId}`, { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch { /* réseau : on réessaie au prochain tour */ }
  }, [deviceId]);
  useEffect(() => {
    if (!deviceId) return;
    const first = setTimeout(refreshStatus, 0);
    const t = setInterval(refreshStatus, 2500);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [deviceId, refreshStatus]);

  // ── Édition ────────────────────────────────────────────────────────────────
  const update = (fn: (f: Uint8Array) => Uint8Array) => { setHandmade(true); setFrames((fs) => fs.map((f, i) => (i === idx ? fn(f) : f))); };
  const pixelAt = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return { x: Math.max(0, Math.min(W - 1, Math.floor(((e.clientX - r.left) / r.width) * W))), y: Math.max(0, Math.min(H - 1, Math.floor(((e.clientY - r.top) / r.height) * H))) };
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    setPlaying(false);
    const { x, y } = pixelAt(e);
    dragRef.current = { x0: x, y0: y, base: Uint8Array.from(frame) };
    if (tool !== "line") update((f) => { const c = Uint8Array.from(f); setPx(c, x, y, tool === "pencil"); return c; });
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current; if (!d) return;
    const { x, y } = pixelAt(e);
    if (tool === "line") update(() => { const c = Uint8Array.from(d.base); drawLine(c, d.x0, d.y0, x, y, true); return c; });
    else { update((f) => { const c = Uint8Array.from(f); drawLine(c, d.x0, d.y0, x, y, tool === "pencil"); return c; }); d.x0 = x; d.y0 = y; }
  };
  const onUp = () => { dragRef.current = null; };

  const addFrame = () => { setHandmade(true); setFrames((fs) => [...fs.slice(0, idx + 1), blank(), ...fs.slice(idx + 1)]); setDelays((ds) => [...ds.slice(0, idx + 1), ds[idx] ?? 100, ...ds.slice(idx + 1)]); setCur(idx + 1); };
  const dupFrame = () => { setHandmade(true); setFrames((fs) => [...fs.slice(0, idx + 1), Uint8Array.from(fs[idx]), ...fs.slice(idx + 1)]); setDelays((ds) => [...ds.slice(0, idx + 1), ds[idx] ?? 100, ...ds.slice(idx + 1)]); setCur(idx + 1); };
  const delFrame = () => { setHandmade(true); if (n < 2) { setFrames([blank()]); return; } setFrames((fs) => fs.filter((_, i) => i !== idx)); setDelays((ds) => ds.filter((_, i) => i !== idx)); setCur(Math.max(0, idx - 1)); };
  const setDelay = (v: number, all: boolean) => setDelays((ds) => ds.map((d, i) => (all || i === idx ? v : d)));
  const loadPreset = (a: Anim) => { setPlaying(false); setFrames(a.frames); setDelays(a.delays); setCur(0); setMsg(null); setHandmade(false); setTitle(""); };

  // ── Statistiques du clip (même codeur que le serveur) ──────────────────────
  const input: ClipInput = useMemo(() => ({ frames, delaysMs: delays.slice(0, frames.length), loops, fg: hexTo565(fg), bg: hexTo565(bg) }), [frames, delays, loops, fg, bg]);
  const stats = useMemo(() => { try { return clipStats(input); } catch { return null; } }, [input]);
  const playMs = clipPlayMs(input.delaysMs, loops);

  // ── Export : GIF, projet (.json), import ───────────────────────────────────
  const baseName = (title.trim() || "animation").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "animation";
  const exportGif = () => download(`${baseName}.gif`, encodeGif({ frames, delaysMs: input.delaysMs, fg: hexToRgb(fg), bg: hexToRgb(bg), scale: 4 }) as BlobPart, "image/gif");
  const exportProject = () => download(`${baseName}.pod-anim.json`, JSON.stringify({ kind: "pod-bench-animation", v: 1, title, frames: frames.map(toB64), delays: input.delaysMs, loops, fg, bg } satisfies Record<string, unknown>, null, 1), "application/json");
  const importProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (j.kind !== "pod-bench-animation" || !Array.isArray(j.frames) || !j.frames.length || j.frames.length > CLIP.MAX_FRAMES) throw new Error("fichier non reconnu");
      const fr: Uint8Array[] = j.frames.map((x: string) => fromB64(String(x)));
      if (fr.some((f) => f.length !== CLIP.FRAME_BYTES)) throw new Error("images invalides");
      setPlaying(false); setFrames(fr); setDelays(fr.map((_, i) => Math.max(20, Math.min(2550, Number(j.delays?.[i]) || 100))));
      setLoops(Math.max(1, Math.min(CLIP.MAX_LOOPS, Number(j.loops) || 1))); setFg(/^#[0-9a-f]{6}$/i.test(j.fg) ? j.fg : "#00ff88"); setBg(/^#[0-9a-f]{6}$/i.test(j.bg) ? j.bg : "#000000");
      setTitle(String(j.title ?? "")); setCur(0); setHandmade(true); setMsg({ ok: true, text: "Projet importé." });
    } catch (e) { setMsg({ ok: false, text: `Import impossible : ${e instanceof Error ? e.message : "fichier illisible"}` }); }
  };

  const device = devices?.find((d) => d.deviceId === deviceId);
  const seen = status?.seenAgoMs ?? null;
  const connected = status?.mode === true && seen !== null && seen < 15_000;
  const fwState = firmwareOk(status?.firmware ?? null);
  const authorDevice = deviceId || allDevices[0]?.deviceId || "";

  async function setMode(on: boolean) {
    setMsg(null);
    const r = await fetch("/api/bench/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId, on }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setMsg({ ok: false, text: d.error ?? "Erreur" });
    refreshStatus();
  }
  async function send() {
    setBusy(true); setMsg(null);
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

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "1.5rem 1rem 3rem" }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: "0 0 0.3rem" }}>🧪 Banc d&apos;essai animation — TFT 2.8&quot; tactile <span style={{ ...label, border: "1px solid var(--border)", borderRadius: 999, padding: "0.1rem 0.5rem", verticalAlign: "middle" }}>v1 · test</span></h1>
      <p style={{ ...muted, marginBottom: "1rem" }}>
        Dessinez une petite animation 128×64 (comme sur l&apos;OLED). Elle est envoyée sous forme de <strong>différences entre images</strong> et rejouée par l&apos;écran, agrandie ×1,875
        au centre du 240×320. L&apos;écran renvoie ses mesures : on voit ainsi la vitesse réelle atteinte.
      </p>

      {/* 1. Appareil + mode */}
      <div style={card}>
        <div style={label}>1 · Écran cible</div>
        {devices === null ? <p style={muted}>Chargement…</p> : devices.length === 0 ? (
          <p style={{ ...muted, color: "#fb923c", marginTop: 6 }}>Aucun TFT 2.8&quot; tactile dans votre profil. Le banc d&apos;essai ne concerne que cet écran (firmware <code>r4tft28</code>).</p>
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
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <div style={label}>2 · Animation — image {idx + 1} / {n}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([["pencil", "✏️ Crayon"], ["eraser", "⌫ Gomme"], ["line", "／ Ligne"]] as [Tool, string][]).map(([t, l]) => <button key={t} type="button" onClick={() => setTool(t)} style={tool === t ? btnOn : btn}>{l}</button>)}
          </div>
        </div>
        <canvas
          ref={canvasRef} width={W} height={H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          aria-label="Zone de dessin 128 par 64"
          style={{ width: "100%", aspectRatio: "2 / 1", imageRendering: "pixelated", borderRadius: 8, border: "1px solid var(--border)", touchAction: "none", cursor: "crosshair", display: "block" }}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          <button type="button" style={btn} onClick={() => { setPlaying(false); setCur((idx - 1 + n) % n); }} aria-label="Image précédente">⏮</button>
          <button type="button" style={playing ? btnOn : btn} onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Lecture"}>{playing ? "⏸" : "▶"}</button>
          <button type="button" style={btn} onClick={() => { setPlaying(false); setCur((idx + 1) % n); }} aria-label="Image suivante">⏭</button>
          <button type="button" style={btn} onClick={addFrame} title="Nouvelle image vide">＋</button>
          <button type="button" style={btn} onClick={dupFrame} title="Dupliquer l'image">⎘</button>
          <button type="button" style={{ ...btn, color: "#f87171" }} onClick={delFrame} title="Supprimer l'image">✕</button>
          <button type="button" style={btn} onClick={() => update(inverted)} title="Inverser">◐</button>
          <button type="button" style={btn} onClick={() => update(() => blank())} title="Effacer">⌧</button>
          <span style={{ width: 8 }} />
          {([["←", -2, 0], ["→", 2, 0], ["↑", 0, -2], ["↓", 0, 2]] as [string, number, number][]).map(([l, dx, dy]) => <button key={l} type="button" style={btn} onClick={() => update((f) => shifted(f, dx, dy))} title="Décaler (2 px, bouclé)">{l}</button>)}
          <label style={{ ...muted, display: "inline-flex", gap: 4, alignItems: "center", marginLeft: "auto" }}><input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} /> onion skin</label>
        </div>

        {/* Timeline */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "0.6rem 0 0.2rem" }}>
          {frames.map((f, i) => <Thumb key={i} frame={f} fg={fg} bg={bg} index={i} selected={i === idx} onClick={() => { setPlaying(false); setCur(i); }} />)}
        </div>

        {/* Délais, boucles, couleurs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.8rem", marginTop: 8 }}>
          <div>
            <div style={label}>Délai de l&apos;image : {delays[idx] ?? 100} ms</div>
            <input type="range" min={20} max={1000} step={10} value={delays[idx] ?? 100} onChange={(e) => setDelay(Number(e.target.value), false)} style={{ width: "100%" }} aria-label="Délai de l'image" />
            <button type="button" style={{ ...btn, marginTop: 4 }} onClick={() => setDelay(delays[idx] ?? 100, true)}>Appliquer à toutes</button>
          </div>
          <div>
            <div style={label}>Boucles : {loops}</div>
            <input type="range" min={1} max={30} value={loops} onChange={(e) => setLoops(Number(e.target.value))} style={{ width: "100%" }} aria-label="Boucles" />
            <p style={muted}>Durée de lecture ≈ {(playMs / 1000).toFixed(1)} s</p>
          </div>
          <div>
            <div style={label}>Couleurs (allumé / fond)</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} aria-label="Couleur des pixels allumés" />
              <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Couleur du fond" />
            </div>
          </div>
        </div>
      </div>

      {/* 3. Modèles */}
      <div style={card}>
        <div style={label}>3 · Modèles de test (remplacent l&apos;animation)</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
          <button type="button" style={btn} onClick={() => loadPreset(presetBall())}>🏀 Balle</button>
          <button type="button" style={btn} onClick={() => loadPreset(presetWave())}>〰 Vague</button>
          <button type="button" style={btn} onClick={() => loadPreset(presetNoise())}>▒ Bruit léger</button>
          <button type="button" style={btn} onClick={() => loadPreset(presetFlash())}>⚡ Plein écran clignotant (pire cas)</button>
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 24))} aria-label="Texte défilant" style={{ ...btn, width: 110 }} />
          <button type="button" style={btn} onClick={() => loadPreset(presetText(text))}>🔤 Texte défilant</button>
        </div>
        <p style={{ ...muted, marginTop: 6 }}>Le « plein écran clignotant » change tous les pixels à chaque image : c&apos;est la limite de vitesse de l&apos;écran. Baissez le délai (20 ms minimum) pour la trouver.</p>
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

        <div style={{ ...label, marginTop: "1rem" }}>Mesures renvoyées par l&apos;écran</div>
        {!status || status.results.length === 0 ? <p style={{ ...muted, marginTop: 4 }}>Aucune mesure pour l&apos;instant. Elles apparaissent ici après la lecture d&apos;un clip.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {status.results.map((r) => <ResultRow key={`${r.clipId}-${r.at}`} r={r} />)}
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

function ResultRow({ r }: { r: BenchResult }) {
  const secs = r.elapsedMs / 1000, fps = secs > 0 ? r.frames / secs : 0;
  const ok = !r.error && r.overruns === 0;
  return (
    <div style={{ padding: "0.5rem 0.7rem", borderRadius: 8, border: `1px solid ${r.error ? "rgba(248,113,113,0.4)" : ok ? "rgba(74,222,128,0.3)" : "rgba(251,146,60,0.4)"}`, background: "var(--bg)", fontSize: "0.78rem", lineHeight: 1.5 }}>
      <strong style={{ color: r.error ? "#f87171" : ok ? "#4ade80" : "#fb923c" }}>{r.error ? `✗ ${r.error}` : ok ? "✓ cadence tenue" : `⚠ ${r.overruns} image(s) en retard`}</strong>{" "}
      <span style={{ color: "var(--text3)" }}>clip {r.clipId} · {new Date(r.at).toLocaleTimeString()}{r.stopped ? " · interrompu au toucher" : ""}</span>
      <div style={{ color: "var(--text2)" }}>
        {r.frames} images en {secs.toFixed(2)} s (prévu {(r.expectedMs / 1000).toFixed(2)} s) → <strong>{fps.toFixed(1)} images/s</strong> ·
        travail par image : moy. {(r.avgWorkUs / 1000).toFixed(1)} ms, max {(r.maxWorkUs / 1000).toFixed(1)} ms · retard max {r.maxLateMs} ms ·
        téléchargement {(r.downloadMs / 1000).toFixed(2)} s ({r.bytes} o{r.downloadMs > 0 ? `, ≈ ${(r.bytes / (r.downloadMs / 1000) / 1000).toFixed(0)} Ko/s` : ""}) · tas libre {(r.heapFree / 1000).toFixed(1)} Ko
      </div>
    </div>
  );
}
