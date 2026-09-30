"use client";
// app/draw/_studio/previews.tsx — vignettes de brosses / textures générées par le moteur lui-même
// (ce que montre la vignette est exactement ce que la brosse dessinera).

import { useEffect, useMemo, useRef } from "react";
import { DrawSession, textureTile } from "@/lib/drawEngine";

function drawBitmapTo(canvas: HTMLCanvasElement, s: DrawSession, scale: number, tint?: string) {
  const bmp = s.bitmap;
  canvas.width = bmp.w * scale; canvas.height = bmp.h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const small = document.createElement("canvas");
  small.width = bmp.w; small.height = bmp.h;
  small.getContext("2d")!.putImageData(new ImageData(bmp.toRGBA(), bmp.w, bmp.h), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  if (tint) { ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = tint; ctx.fillRect(0, 0, canvas.width, canvas.height); }
}

/** Petit tracé ondulé avec la brosse donnée. */
export function BrushPreview({ brush, size, texture = "solid", w = 64, h = 26, scale = 2, className }: {
  brush: string; size: number; texture?: string; w?: number; h?: number; scale?: number; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const session = useMemo(() => {
    const s = new DrawSession({ width: w, height: h, mode: "bw" });
    s.minMoveMs = 0;
    const id = 1;
    s.beginStroke(id, { x: 6, y: Math.round(h / 2) }, 1000, {
      erase: false, brush, size: Math.min(size, Math.floor(h * 0.7)), color: "#000000", opacity: 100, texture, sym: null, pixelPerfect: brush === "pixel",
    });
    for (let x = 8; x <= w - 6; x += 2) {
      s.moveStroke(id, { x, y: Math.round(h / 2 + Math.sin((x / w) * Math.PI * 2) * (h * 0.22)) }, 1000 + x * 20);
    }
    s.endStroke(id, { x: w - 6, y: Math.round(h / 2) }, 3000);
    return s;
  }, [brush, size, texture, w, h]);
  useEffect(() => { if (ref.current) drawBitmapTo(ref.current, session, scale); }, [session, scale]);
  return <canvas ref={ref} className={className} style={{ width: w * scale, height: h * scale }} aria-hidden />;
}

/** Aplat de texture 8×8 répété. */
export function TexturePreview({ texture, w = 24, h = 16, scale = 2, className }: {
  texture: string; w?: number; h?: number; scale?: number; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = w * scale; c.height = h * scale;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#111";
    const tile = textureTile(texture);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!tile || tile[((y & 7) << 3) | (x & 7)]) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }, [texture, w, h, scale]);
  return <canvas ref={ref} className={className} style={{ width: w * scale, height: h * scale }} aria-hidden />;
}
