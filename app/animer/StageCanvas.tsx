"use client";
// app/animer/StageCanvas.tsx — la scène : le canvas 128×64, TOUJOURS entier dans l'espace disponible, et le dessin au doigt / stylet / souris.
//
// Ce qui change par rapport à l'ancien éditeur (06/10/2026) :
//   • le canvas est calculé pour TENIR dans la scène (fitCanvas) : plus de débordement en paysage ;
//   • la scène n'a AUCUN défilement (touch-action: none, overscroll-behavior: none) et la boîte à outils n'est plus dessous : le geste de défilement ne peut plus dessiner ;
//   • un second doigt qui se pose pendant un trait ANNULE ce trait (paume, pincement) au lieu de laisser un trait parasite.

import { useEffect, useRef, useState } from "react";
import { clipPixel } from "@/lib/bench/clip";
import { fitCanvas } from "@/lib/anim/fit";
import { H, W, type Frame } from "@/lib/bench/draw";

export interface StageProps {
  frame: Frame;
  onionPrev?: Frame;
  onionNext?: Frame;
  fg: string;
  bg: string;
  grid: boolean;
  tool: string;
  onStart: (x: number, y: number, erase: boolean) => void;
  onMove: (x: number, y: number) => void;
  onEnd: () => void;
  onCancel: () => void;
  onHover?: (p: { x: number; y: number } | null) => void;
  /** Superposé à la scène (pastilles d'information). */
  overlay?: React.ReactNode;
}

const hexRgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function StageCanvas({ frame, onionPrev, onionNext, fg, bg, grid, tool, onStart, onMove, onEnd, onCancel, onHover, overlay }: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 320, h: 160 });
  const active = useRef<number | null>(null);        // pointeur qui dessine
  const cancelled = useRef(false);                   // trait annulé par un 2e doigt : on ignore le reste du geste

  // ── Ajustement à l'espace disponible ───────────────────────────────────────────────
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = fitCanvas(size.w, size.h, W, H, 14);

  // ── Peinture : fond, fantômes (orange = avant, bleu = après), image, grille d'octets ──
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const img = ctx.createImageData(W, H), d = img.data;
    const cBg = hexRgb(bg), cFg = hexRgb(fg), cPrev: [number, number, number] = [251, 146, 60], cNext: [number, number, number] = [96, 165, 250];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let c = cBg;
      if (onionNext && clipPixel(onionNext, x, y)) c = mix(c, cNext, 0.2);
      if (onionPrev && clipPixel(onionPrev, x, y)) c = mix(c, cPrev, 0.34);
      if (clipPixel(frame, x, y)) c = cFg;
      if (grid && x % 8 === 0 && c === cBg) c = mix(c, [255, 255, 255], 0.1);
      const i = (y * W + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [frame, onionPrev, onionNext, fg, bg, grid]);

  // ── Entrées ────────────────────────────────────────────────────────────────────────
  const pixelAt = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(W - 1, Math.floor(((clientX - r.left) / r.width) * W))), y: Math.max(0, Math.min(H - 1, Math.floor(((clientY - r.top) / r.height) * H))) };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
    if (active.current !== null && active.current !== e.pointerId) {               // un 2e doigt : on annule le trait en cours
      if (!cancelled.current) { cancelled.current = true; onCancel(); }
      return;
    }
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointeur déjà perdu : le trait continue sans capture */ }
    active.current = e.pointerId;
    cancelled.current = false;
    const p = pixelAt(e.clientX, e.clientY);
    onStart(p.x, p.y, e.pointerType === "mouse" && e.button === 2);                // clic droit = gomme, quel que soit l'outil
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pixelAt(e.clientX, e.clientY);
    onHover?.(p);
    if (active.current !== e.pointerId || cancelled.current) return;
    const native = e.nativeEvent as PointerEvent;
    const pts = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    if (pts.length > 1) for (const ev of pts) { const q = pixelAt(ev.clientX, ev.clientY); onMove(q.x, q.y); }   // trajet fin : tous les points intermédiaires
    else onMove(p.x, p.y);
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (active.current === e.pointerId) {
      active.current = null;
      if (!cancelled.current) onEnd();
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
    }
    if (active.current === null) cancelled.current = false;
  };

  return (
    <div ref={stageRef} className="an-stage" data-tool={tool}>
      <canvas
        ref={canvasRef} width={W} height={H} className="an-canvas"
        style={{ width: fit.width, height: fit.height }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onPointerLeave={() => onHover?.(null)} onContextMenu={(e) => e.preventDefault()}
        aria-label="Zone de dessin de l'image courante"
      />
      {overlay}
    </div>
  );
}
