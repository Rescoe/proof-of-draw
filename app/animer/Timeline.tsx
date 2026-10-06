"use client";
// app/animer/Timeline.tsx — la ligne de temps : lecture, images (miniatures), ajout / duplication / suppression / déplacement, vitesse.
// Le défilement est HORIZONTAL seulement (touch-action: pan-x) : il ne peut jamais déclencher de dessin ni faire défiler la page.

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Copy, Pause, Play, Plus, Trash2 } from "lucide-react";
import { clipPixel } from "@/lib/bench/clip";
import { CLIP } from "@/lib/bench/clip";
import { H, W, type Frame } from "@/lib/bench/draw";
import { Slider } from "../draw/_studio/ui";
import { delayToFps, fpsToDelay, type Mode } from "./model";

const hexRgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

function Thumb({ frame, fg, bg, selected, index, onClick }: { frame: Frame; fg: string; bg: string; selected: boolean; index: number; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d"); if (!ctx) return;
    const img = ctx.createImageData(W, H), cF = hexRgb(fg), cB = hexRgb(bg);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = clipPixel(frame, x, y) ? cF : cB, i = (y * W + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }, [frame, fg, bg]);
  useEffect(() => { if (selected) buttonRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }, [selected]);
  return (
    <button ref={buttonRef} type="button" className={"an-thumb" + (selected ? " an-thumb--on" : "")} onClick={onClick} aria-label={`Image ${index + 1}`} aria-current={selected}>
      <canvas ref={ref} width={W} height={H} />
      <span>{index + 1}</span>
    </button>
  );
}

export interface TimelineStats { bytes: number; fits: boolean; durationMs: number }

export function Timeline(props: {
  frames: Frame[]; delays: number[]; cur: number; fg: string; bg: string; playing: boolean; mode: Mode; stats: TimelineStats | null;
  onSelect: (i: number) => void; onTogglePlay: () => void; onAdd: () => void; onDup: () => void; onDel: () => void; onMove: (dir: -1 | 1) => void;
  onDelay: (ms: number) => void; onSpeed: (fps: number) => void;
}) {
  const { frames, delays, cur, mode, stats } = props;
  const n = frames.length;
  const full = n >= CLIP.MAX_FRAMES;
  const fps = delayToFps(delays[cur] ?? 100);
  const budget = stats ? stats.bytes / CLIP.MAX_CLIP_BYTES : 0;
  return (
    <section className="an-timeline" aria-label="Ligne de temps">
      <div className="an-tl-ctrl">
        <button type="button" className={"st-btn st-btn--icon" + (props.playing ? " st-btn--accent" : " st-btn--solid")} onClick={props.onTogglePlay} disabled={n < 2} aria-label={props.playing ? "Pause" : "Lire l'animation"} title="Lire / pause (Espace)">
          {props.playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button type="button" className="st-btn st-btn--icon st-btn--solid" onClick={props.onAdd} disabled={full} aria-label="Nouvelle image vide après celle-ci" title="Nouvelle image"><Plus size={22} /></button>
        <button type="button" className="st-btn st-btn--icon st-btn--solid" onClick={props.onDup} disabled={full} aria-label="Dupliquer cette image" title="Dupliquer (la base d'un mouvement)"><Copy size={20} /></button>
        <button type="button" className="st-btn st-btn--icon st-btn--solid st-btn--danger" onClick={props.onDel} aria-label={n < 2 ? "Effacer cette image" : "Supprimer cette image"} title="Supprimer"><Trash2 size={20} /></button>
        {mode !== "essential" && (
          <>
            <button type="button" className="st-btn st-btn--icon" onClick={() => props.onMove(-1)} disabled={cur === 0} aria-label="Déplacer l'image vers la gauche"><ChevronLeft size={22} /></button>
            <button type="button" className="st-btn st-btn--icon" onClick={() => props.onMove(1)} disabled={cur >= n - 1} aria-label="Déplacer l'image vers la droite"><ChevronRight size={22} /></button>
          </>
        )}
        <div className="an-tl-speed">
          {mode === "pro" ? (
            <Slider label="Délai de cette image (ms)" value={Math.max(20, Math.min(1000, delays[cur] ?? 100))} min={20} max={1000} step={10} onChange={props.onDelay} format={(v) => `${v} ms`} />
          ) : (
            <Slider label="Vitesse de l'animation (images par seconde)" value={fps} min={1} max={25} onChange={(v) => props.onSpeed(v)} format={(v) => `${v} i/s`} />
          )}
        </div>
        {stats && (
          <span className="an-tl-stats" title={stats.fits ? "L'animation tient dans la mémoire de l'écran" : "Trop lourde pour l'écran : retirez des images ou simplifiez"} style={{ color: stats.fits ? (budget > 0.7 ? "var(--st-warn)" : "var(--st-text-2)") : "var(--st-err)" }}>
            {n} img · {(stats.bytes / 1024).toFixed(1)}/{(CLIP.MAX_CLIP_BYTES / 1024).toFixed(0)} Ko · {(stats.durationMs / 1000).toFixed(1)} s
          </span>
        )}
      </div>
      <div className="an-strip" role="listbox" aria-label="Images de l'animation">
        {frames.map((f, i) => <Thumb key={i} frame={f} fg={props.fg} bg={props.bg} selected={i === cur} index={i} onClick={() => props.onSelect(i)} />)}
        <button type="button" className="an-thumb an-thumb--add" onClick={props.onAdd} disabled={full} aria-label="Ajouter une image"><Plus size={22} /></button>
      </div>
    </section>
  );
}

export { fpsToDelay };
