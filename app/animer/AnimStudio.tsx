"use client";

// app/animer/AnimStudio.tsx — ATELIER D'ANIMATION (refonte du 06/10/2026). Remplace l'ancien éditeur partagé avec le banc d'essai (supprimé).
//
//   • plein écran, SANS défilement de page : la boîte à outils n'est plus sous le canvas, donc le geste de défilement ne dessine plus ;
//   • le canvas tient toujours dans la scène (paysage compris) ; disposition « empilée » (téléphone portrait) ou « latérale » (paysage / ordinateur) ;
//   • annuler / rétablir et retour toujours visibles dans la barre du haut ;
//   • 3 modes : Essentiel · Studio · Pro ; brosses (rond, carré, spray, trame, pointillé, plume, hachures) ; fantôme (onion skin) avant / après conservé ;
//   • même circuit qu'un dessin pour « Soumettre au réseau » : POST /api/draw { anim } → candidat → votes → bloc → galerie.
// Les primitives sont pures et testées (lib/bench/draw.ts, lib/bench/history.ts, lib/anim/brushes.ts, lib/anim/fit.ts).

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLeft, Redo2, Send, SlidersHorizontal, Undo2 } from "lucide-react";
import { paintDot, paintSegment, toShapeBrush, type BrushSpec } from "@/lib/anim/brushes";
import { chooseLayout } from "@/lib/anim/fit";
import { CLIP, clipPlayMs, clipStats, type ClipInput } from "@/lib/bench/clip";
import { blank, ellipse, flipH, flipV, floodFill, invert, line, motion, rect, shifted, type Frame } from "@/lib/bench/draw";
import { encodeGif } from "@/lib/bench/gif";
import { histReducer, initHist, type Doc } from "@/lib/bench/history";
import { BENCH_SCREEN_INFO, benchScreenOf } from "@/lib/bench/screens";
import { wakeNetwork } from "@/lib/wakeNetwork";
import "../draw/_studio/studio.css";
import "./anim.css";
import { ConfirmDialog, ToastHost, useToasts } from "../draw/_studio/ui";
import { ActionsSheet, BrushSheet, ColorSheet, ModeSheet, type AnimActions } from "./Sheets";
import { SendSheet, type DeviceLite } from "./SendSheet";
import { StageCanvas } from "./StageCanvas";
import { Timeline } from "./Timeline";
import { Options, ToolRail } from "./Toolbox";
import { MODES, TOOLS_BY_MODE, fpsToDelay, fromB64, isMode, loadDraft, saveDraft, templateBall, templateWave, toB64, validBrush, validTool, type Anim, type Mode, type Tool } from "./model";
import { textScrollFrames } from "./textScroll";

type SheetId = null | "brush" | "color" | "mode" | "actions" | "send";

const hexTo565 = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (((n >> 16) & 0xff) >> 3 << 11) | (((n >> 8) & 0xff) >> 2 << 5) | ((n & 0xff) >> 3); };
const hexToRgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]; };
function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.visualViewport?.height ?? window.innerHeight });
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener("resize", on);
    window.visualViewport?.addEventListener("resize", on);
    on();
    return () => { window.removeEventListener("resize", on); window.visualViewport?.removeEventListener("resize", on); };
  }, []);
  return v;
}

export default function AnimStudio() {
  const [draft] = useState(() => loadDraft());
  const [hist, dispatch] = useReducer(histReducer, draft, (d) => {
    const frames = d?.frames?.length ? d.frames.map(fromB64) : [blank()];
    const delays = d?.delays?.length === frames.length ? d.delays : frames.map(() => 100);
    return initHist({ frames, delays, cur: 0, handmade: d?.handmade ?? true } satisfies Doc);
  });
  const { frames, delays, cur: idx } = hist.doc;
  const n = frames.length;
  const frame = frames[idx];
  const handmade = hist.doc.handmade !== false;

  const [mode, setMode] = useState<Mode>(() => (isMode(draft?.mode) ? draft!.mode! : "essential"));
  const [tool, setTool] = useState<Tool>("pencil");
  const [brush, setBrush] = useState<BrushSpec>(() => ({ kind: validBrush(draft?.brush ?? "round", isMode(draft?.mode) ? draft!.mode! : "essential"), size: draft?.brushSize ?? 2, tone: 2 }));
  const [filled, setFilled] = useState(false);
  const [fg, setFg] = useState(draft?.fg ?? "#00ff88");
  const [bg, setBg] = useState(draft?.bg ?? "#000000");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [onionPrev, setOnionPrev] = useState(true);
  const [onionNext, setOnionNext] = useState(false);
  const [grid, setGrid] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [sheet, setSheet] = useState<SheetId>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const loops = 0;                                                    // les animations du réseau tournent en boucle sans fin (imposé par le serveur)
  const { toasts, push, dismiss } = useToasts();

  const vp = useViewport();
  const { layout, dense } = chooseLayout(vp.w, vp.h);
  const tools = TOOLS_BY_MODE[mode];
  const activeTool = validTool(tool, mode);

  // ── Historique : un trait = UN pas d'annulation ──────────────────────────────────────
  const strokeRef = useRef<{ x0: number; y0: number; on: boolean; carry: number; seed: number; base: Frame; live: Frame } | null>(null);
  const setCurFrame = (nf: Frame) => dispatch({ type: "patch", fn: (d) => ({ ...d, handmade: true, frames: d.frames.map((f, i) => (i === d.cur ? nf : f)) }) });
  const editCur = (fn: (f: Frame) => Frame) => { setPlaying(false); dispatch({ type: "commit", fn: (d) => ({ ...d, handmade: true, frames: d.frames.map((f, i) => (i === d.cur ? fn(f) : f)) }) }); };
  const edit = (fn: (d: Doc) => Doc) => { setPlaying(false); dispatch({ type: "commit", fn: (d) => ({ ...fn(d), handmade: true }) }); };
  const undo = useCallback(() => { setPlaying(false); strokeRef.current = null; dispatch({ type: "undo" }); }, []);
  const redo = useCallback(() => { setPlaying(false); dispatch({ type: "redo" }); }, []);
  const canUndo = hist.past.length > 0, canRedo = hist.future.length > 0;

  const shapeBrush = toShapeBrush(brush);
  const shapeOf = (t: Tool, base: Frame, x0: number, y0: number, x1: number, y1: number, on: boolean): Frame =>
    t === "line" ? line(base, x0, y0, x1, y1, on, shapeBrush) : t === "rect" ? rect(base, x0, y0, x1, y1, on, filled, shapeBrush) : ellipse(base, x0, y0, x1, y1, on, filled, shapeBrush);

  const onStart = (x: number, y: number, erase: boolean) => {
    setPlaying(false); setSheet(null);
    const on = !(erase || activeTool === "eraser");
    if (activeTool === "fill") { editCur((f) => floodFill(f, x, y, on)); return; }
    dispatch({ type: "begin" });
    const base = frame;
    const first = activeTool === "pencil" || activeTool === "eraser" ? paintDot(base, x, y, on, brush, 0) : shapeOf(activeTool, base, x, y, x, y, on);
    strokeRef.current = { x0: x, y0: y, on, carry: 0, seed: 0, base, live: first };
    setCurFrame(first);
  };
  const onMove = (x: number, y: number) => {
    const s = strokeRef.current; if (!s) return;
    if (activeTool === "pencil" || activeTool === "eraser") {
      if (x === s.x0 && y === s.y0) return;
      const r = paintSegment(s.live, s.x0, s.y0, x, y, s.on, brush, s.carry, ++s.seed);
      s.live = r.frame; s.carry = r.carry; s.x0 = x; s.y0 = y;
      setCurFrame(s.live);
    } else {
      s.live = shapeOf(activeTool, s.base, s.x0, s.y0, x, y, s.on);
      setCurFrame(s.live);
    }
  };
  const onEnd = () => { strokeRef.current = null; };
  const onCancel = () => { if (strokeRef.current) { strokeRef.current = null; dispatch({ type: "undo" }); push("Trait annulé (deux doigts détectés)", { ms: 1800 }); } };

  // ── Images ────────────────────────────────────────────────────────────────────────────
  const addFrame = () => edit((d) => ({ ...d, frames: [...d.frames.slice(0, d.cur + 1), blank(), ...d.frames.slice(d.cur + 1)], delays: [...d.delays.slice(0, d.cur + 1), d.delays[d.cur] ?? 100, ...d.delays.slice(d.cur + 1)], cur: d.cur + 1 }));
  const dupFrame = () => edit((d) => ({ ...d, frames: [...d.frames.slice(0, d.cur + 1), d.frames[d.cur], ...d.frames.slice(d.cur + 1)], delays: [...d.delays.slice(0, d.cur + 1), d.delays[d.cur] ?? 100, ...d.delays.slice(d.cur + 1)], cur: d.cur + 1 }));
  const delFrame = () => edit((d) => d.frames.length < 2 ? { ...d, frames: [blank()], delays: [d.delays[0] ?? 100], cur: 0 } : { ...d, frames: d.frames.filter((_, i) => i !== d.cur), delays: d.delays.filter((_, i) => i !== d.cur), cur: Math.min(d.cur, d.frames.length - 2) });
  const moveFrame = (dir: -1 | 1) => edit((d) => {
    const j = d.cur + dir; if (j < 0 || j >= d.frames.length) return d;
    const fr = [...d.frames], dl = [...d.delays]; [fr[d.cur], fr[j]] = [fr[j], fr[d.cur]]; [dl[d.cur], dl[j]] = [dl[j], dl[d.cur]];
    return { ...d, frames: fr, delays: dl, cur: j };
  });
  const setDelay = (v: number) => dispatch({ type: "patch", fn: (d) => ({ ...d, handmade: true, delays: d.delays.map((x, i) => (i === d.cur ? v : x)) }) });
  const setSpeed = (fps: number) => dispatch({ type: "patch", fn: (d) => ({ ...d, handmade: true, delays: d.delays.map(() => fpsToDelay(fps)) }) });
  const select = (i: number) => { setPlaying(false); dispatch({ type: "nav", cur: i }); };

  const actions: AnimActions = {
    flipH: () => editCur(flipH), flipV: () => editCur(flipV), invert: () => editCur(invert),
    shift: (dx, dy, wrap) => editCur((f) => shifted(f, dx, dy, wrap)),
    reverse: () => edit((d) => ({ ...d, frames: [...d.frames].reverse(), delays: [...d.delays].reverse(), cur: d.frames.length - 1 - d.cur })),
    pingPong: () => edit((d) => {
      if (d.frames.length < 3 || d.frames.length * 2 - 2 > CLIP.MAX_FRAMES) return d;
      return { ...d, frames: [...d.frames, ...d.frames.slice(1, -1).reverse()], delays: [...d.delays, ...d.delays.slice(1, -1).reverse()] };
    }),
    canPingPong: n >= 3 && n * 2 - 2 <= CLIP.MAX_FRAMES,
    motion: (count, dx, dy, wrap) => { edit((d) => { const c = Math.max(2, Math.min(CLIP.MAX_FRAMES, count)), dl = d.delays[d.cur] ?? 100; return { ...d, frames: motion(d.frames[d.cur], c, dx, dy, wrap), delays: Array.from({ length: c }, () => dl), cur: 0 }; }); setSheet(null); push("Mouvement généré — Annuler pour revenir", { kind: "ok" }); },
    textScroll: (text) => { const fr = textScrollFrames(text); edit((d) => ({ ...d, frames: fr, delays: fr.map(() => 60), cur: 0 })); setSheet(null); push("Texte défilant créé — Annuler pour revenir", { kind: "ok" }); },
    template: (kind) => { const a: Anim = kind === "ball" ? templateBall() : templateWave(); setPlaying(false); dispatch({ type: "commit", fn: () => ({ frames: a.frames, delays: a.delays, cur: 0, handmade: false }) }); setTitle(""); setSheet(null); push("Modèle chargé — dessinez dessus pour en faire votre œuvre", { kind: "ok" }); },
    newAnim: () => { if (handmade && frames.some((f) => f.some((b) => b !== 0))) setConfirmNew(true); else resetAnim(); },
  };
  const resetAnim = () => { setPlaying(false); dispatch({ type: "commit", fn: () => ({ frames: [blank()], delays: [100], cur: 0, handmade: true }) }); setTitle(""); setConfirmNew(false); setSheet(null); push("Nouvelle animation — Annuler pour revenir", { kind: "ok" }); };

  // ── Lecture ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || n < 2) return;
    const t = setTimeout(() => dispatch({ type: "step", delta: 1 }), Math.max(20, delays[idx] ?? 100));
    return () => clearTimeout(t);
  }, [playing, idx, n, delays]);
  useEffect(() => { if (playing && n < 2) setPlaying(false); }, [playing, n]);

  // ── Raccourcis clavier ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod || e.altKey) return;
      const keyTool = ({ p: "pencil", e: "eraser", l: "line", r: "rect", o: "ellipse", g: "fill" } as Record<string, Tool>)[k];
      if (keyTool && tools.includes(keyTool)) { setTool(keyTool); return; }
      if (k === " ") { e.preventDefault(); setPlaying((p) => !p); return; }
      if (k === "arrowleft") { e.preventDefault(); setPlaying(false); dispatch({ type: "step", delta: -1 }); return; }
      if (k === "arrowright") { e.preventDefault(); setPlaying(false); dispatch({ type: "step", delta: 1 }); return; }
      if (k === "[") setBrush((b) => ({ ...b, size: Math.max(1, b.size - 1) }));
      if (k === "]") setBrush((b) => ({ ...b, size: Math.min(12, b.size + 1) }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, tools]);

  // ── Brouillon local (même clé qu'avant : les brouillons existants se rouvrent) ─────────
  useEffect(() => {
    const t = setTimeout(() => saveDraft({ frames: frames.map(toB64), delays, loops, fg, bg, handmade, title, v: 2, mode, brush: brush.kind, brushSize: brush.size }), 400);
    return () => clearTimeout(t);
  }, [frames, delays, fg, bg, handmade, title, mode, brush.kind, brush.size]);

  useEffect(() => { wakeNetwork(); }, []);   // atelier ouvert : les écrans au repos passent à 5 min de pull

  // Plein écran : le document derrière l'atelier ne doit JAMAIS défiler (molette, geste tactile hors du canvas) ni rebondir.
  useEffect(() => {
    const html = document.documentElement, body = document.body;
    const prev = { ho: html.style.overflow, bo: body.style.overflow, ho2: html.style.overscrollBehavior };
    html.style.overflow = "hidden"; body.style.overflow = "hidden"; html.style.overscrollBehavior = "none";
    return () => { html.style.overflow = prev.ho; body.style.overflow = prev.bo; html.style.overscrollBehavior = prev.ho2; };
  }, []);

  // ── Écrans du propriétaire (pour « Soumettre au réseau ») ───────────────────────────────
  const [devices, setDevices] = useState<DeviceLite[] | null>(null);
  const [deviceId, setDeviceId] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/devices?mine=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { devices: [] }))
      .then((d: { devices?: DeviceLite[] }) => {
        if (!alive) return;
        const mine = (d.devices ?? []).filter((x) => benchScreenOf(x.screens) !== null);
        setDevices(mine);
        const wanted = new URLSearchParams(window.location.search).get("device");   // lien « 🎞 Animer » du profil
        if (mine.length) setDeviceId((c) => c || (mine.find((x) => x.deviceId === wanted) ?? mine[0]).deviceId);
      })
      .catch(() => { if (alive) setDevices([]); });
    return () => { alive = false; };
  }, []);
  const device = devices?.find((d) => d.deviceId === deviceId);
  const wantedScreen = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("screen") : null;
  const targetScreen = (wantedScreen && device?.screens.includes(wantedScreen) ? benchScreenOf([wantedScreen]) : null) ?? benchScreenOf(device?.screens) ?? "tft28";
  const screenInfo = BENCH_SCREEN_INFO[targetScreen];

  // ── Statistiques du clip (même codeur que le serveur) ─────────────────────────────────
  const input: ClipInput = useMemo(() => ({ frames, delaysMs: delays.slice(0, frames.length), loops, fg: hexTo565(fg), bg: hexTo565(bg) }), [frames, delays, fg, bg]);
  const stats = useMemo(() => { try { const s = clipStats(input); return { bytes: s.bytes, fits: s.fitsDevice, durationMs: clipPlayMs(input.delaysMs, 1) }; } catch { return null; } }, [input]);

  // ── Envoi et export ───────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submitToNetwork() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/draw", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, screen: targetScreen, workTitle: title.trim() || "Sans titre", anim: { frames: frames.map(toB64), delaysMs: input.delaysMs, loops: 0, fg: input.fg, bg: input.bg } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: d.message ?? d.error ?? "Soumission impossible" }); return; }
      const how = d.validation === "queued" ? `En file d'attente (position ${d.queuePosition}). ` : d.validation === "pending" ? `Score ${Number(d.score ?? 0).toFixed(3)} · à valider par ${d.poolSize ?? 0} appareil(s). ` : "";
      setMsg({ ok: true, text: `Animation soumise au réseau. ${how}Elle apparaîtra dans la galerie (filtre « Animations ») une fois le bloc miné.` });
    } catch { setMsg({ ok: false, text: "Erreur réseau" }); }
    finally { setBusy(false); }
  }
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
      setFg(/^#[0-9a-f]{6}$/i.test(j.fg) ? j.fg : "#00ff88"); setBg(/^#[0-9a-f]{6}$/i.test(j.bg) ? j.bg : "#000000");
      setTitle(String(j.title ?? "")); setMsg({ ok: true, text: "Projet importé (vous pouvez annuler)." });
    } catch (e) { setMsg({ ok: false, text: `Import impossible : ${e instanceof Error ? e.message : "fichier illisible"}` }); }
  };

  const changeMode = (m: Mode) => { setMode(m); setTool((t) => validTool(t, m)); setBrush((b) => ({ ...b, kind: validBrush(b.kind, m) })); if (m !== "pro") setGrid(false); };
  const goBack = () => { try { if (document.referrer && new URL(document.referrer).origin === location.origin) { history.back(); return; } } catch { /* référent illisible */ } location.href = "/profile"; };

  const prevFrame = idx > 0 ? frames[idx - 1] : n > 1 ? frames[n - 1] : undefined;
  const nextFrame = n > 1 ? frames[(idx + 1) % n] : undefined;
  const modeLabel = MODES.find((m) => m.id === mode)?.label ?? "";

  const options = (
    <Options
      mode={mode} tool={activeTool} brush={brush} filled={filled} fg={fg} bg={bg} onionPrev={onionPrev} onionNext={onionNext} grid={grid}
      onBrushSheet={() => setSheet("brush")} onSize={(size) => setBrush((b) => ({ ...b, size }))} onFilled={() => setFilled((f) => !f)} onColors={() => setSheet("color")}
      onOnionPrev={() => setOnionPrev((v) => !v)} onOnionNext={() => setOnionNext((v) => !v)} onGrid={() => setGrid((g) => !g)} onActions={() => setSheet("actions")}
    />
  );

  return (
    <div className={`studio an st--${layout}${dense ? " st--dense" : ""} an--${mode}`} style={{ ["--st-vvh" as string]: `${vp.h}px` }}>
      <header className="st-top">
        <button type="button" className="st-btn st-btn--icon" onClick={goBack} aria-label="Retour"><ArrowLeft size={24} /></button>
        <button type="button" className="st-btn st-btn--icon an-undo" onClick={undo} disabled={!canUndo} aria-label="Annuler" title="Annuler (Ctrl+Z)"><Undo2 size={24} /></button>
        <button type="button" className="st-btn st-btn--icon an-undo" onClick={redo} disabled={!canRedo} aria-label="Rétablir" title="Rétablir (Ctrl+Y)"><Redo2 size={24} /></button>
        <span className="an-top-title" aria-hidden="true">{title.trim() || "Atelier d'animation"}</span>
        <button type="button" className="st-chip an-modebtn" onClick={() => setSheet("mode")} aria-label={`Mode ${modeLabel}. Changer`}><SlidersHorizontal size={18} /> <span>{modeLabel}</span></button>
        <button type="button" className="st-send" onClick={() => setSheet("send")} aria-label="Envoyer l'animation"><Send size={17} /><span className="an-send-label">Envoyer</span></button>
      </header>

      <StageCanvas
        frame={frame} onionPrev={onionPrev && !playing ? prevFrame : undefined} onionNext={onionNext && !playing && mode !== "essential" ? nextFrame : undefined}
        fg={fg} bg={bg} grid={grid && !playing} tool={activeTool} onStart={onStart} onMove={onMove} onEnd={onEnd} onCancel={onCancel} onHover={setHover}
        overlay={(
          <div className="st-hud" aria-hidden="true">
            <span className="st-hud__chip">Image {idx + 1}/{n}</span>
            {hover && <span className="st-hud__chip">{hover.x},{hover.y}</span>}
            {playing && <span className="st-hud__chip">▶ lecture</span>}
          </div>
        )}
      />

      <Timeline
        frames={frames} delays={delays} cur={idx} fg={fg} bg={bg} playing={playing} mode={mode} stats={stats}
        onSelect={select} onTogglePlay={() => setPlaying((p) => !p)} onAdd={addFrame} onDup={dupFrame} onDel={delFrame} onMove={moveFrame} onDelay={setDelay} onSpeed={setSpeed}
      />

      {layout === "side" ? <aside className="st-side an-side"><div className="st-sect st-sect--opts">{options}</div></aside> : <div className="st-optsrow">{options}</div>}
      <ToolRail tools={tools} tool={activeTool} onTool={setTool} />

      {sheet === "brush" && <BrushSheet mode={mode} brush={brush} onBrush={setBrush} onClose={() => setSheet(null)} />}
      {sheet === "color" && <ColorSheet fg={fg} bg={bg} onFg={setFg} onBg={setBg} onClose={() => setSheet(null)} />}
      {sheet === "mode" && <ModeSheet mode={mode} onMode={changeMode} onClose={() => setSheet(null)} />}
      {sheet === "actions" && <ActionsSheet mode={mode} actions={actions} onClose={() => setSheet(null)} />}
      {sheet === "send" && (
        <SendSheet
          devices={devices} deviceId={deviceId} onDevice={setDeviceId} screenLabel={screenInfo.label} screenGeometry={screenInfo.geometry}
          title={title} onTitle={setTitle} frames={n} stats={stats} handmade={handmade} busy={busy} msg={msg}
          onSubmit={submitToNetwork} onGif={exportGif} onExport={exportProject} onImport={importProject} onClose={() => setSheet(null)}
        />
      )}
      {confirmNew && <ConfirmDialog title="Nouvelle animation ?" message="L'animation actuelle sera remplacée (vous pourrez annuler)." confirmLabel="Remplacer" danger onConfirm={resetAnim} onCancel={() => setConfirmNew(false)} />}
      <ToastHost toasts={toasts} dismiss={dismiss} bottom={layout === "side" ? 150 : 210} />
    </div>
  );
}
