// lib/canvasPrimitives.ts
// Primitives de dessin canvas partagées entre la capture live (page de dessin)
// et le replay (reconstruction). Les deux doivent produire le même rendu à
// partir des mêmes événements — d'où le partage plutôt que la duplication.

export interface Point { x: number; y: number }

export function hexToRgb(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

export function colorsClose(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  tol = 30,
) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < tol;
}

export function floodFill(
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

export function drawLine(
  ctx: CanvasRenderingContext2D, a: Point, b: Point,
  size: number, color: string, alpha = 1,
) {
  ctx.globalAlpha = alpha; ctx.strokeStyle = color;
  ctx.lineWidth = size; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(a.x + 0.5, a.y + 0.5); ctx.lineTo(b.x + 0.5, b.y + 0.5);
  ctx.stroke(); ctx.globalAlpha = 1;
}

export function drawRect(
  ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, alpha = 1,
) {
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.globalAlpha = 1;
}

export function drawEllipse(
  ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, alpha = 1,
) {
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1;
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke(); ctx.globalAlpha = 1;
}
