// app/animer/textScroll.ts — génère une animation de texte défilant (≤ 40 images : le clip doit tenir en 9 Ko). Navigateur seulement (canvas 2D).
import { blank, type Frame, W, H } from "@/lib/bench/draw";

export function textScrollFrames(text: string): Frame[] {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return [blank()];
  ctx.font = "bold 26px monospace";
  const tw = Math.ceil(ctx.measureText(text || " ").width), total = tw + W, step = Math.max(6, Math.ceil(total / 40));
  const frames: Frame[] = [];
  for (let off = 0; off < total; off += step) {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(text || " ", W - off, H / 2 + 2);
    const d = ctx.getImageData(0, 0, W, H).data, f = blank();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4] > 127) f[y * 16 + (x >> 3)] |= 0x80 >> (x & 7);
    frames.push(f);
  }
  return frames;
}
