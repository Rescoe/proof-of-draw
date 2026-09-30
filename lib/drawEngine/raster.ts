// lib/drawEngine/raster.ts
// Primitives géométriques pixel-exactes : elles énumèrent des pixels, sans jamais
// toucher un canvas. Aucune dépendance au DOM → testable en Node.

export type Plot = (x: number, y: number) => void;
export interface Pt { x: number; y: number }

/** Bresenham, extrémités incluses. */
export function bresenham(x0: number, y0: number, x1: number, y1: number, plot: Plot) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Rectangle plein (coins inclus, ordre quelconque). */
export function rectFill(x0: number, y0: number, x1: number, y1: number, plot: Plot) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) plot(x, y);
}

/** Contour de rectangle d'épaisseur t, rentrant vers l'intérieur. */
export function rectRing(x0: number, y0: number, x1: number, y1: number, t: number, plot: Plot) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    if (x - ax < t || bx - x < t || y - ay < t || by - y < t) plot(x, y);
  }
}

/**
 * Ellipse fine (1 px) inscrite dans le rectangle de pixels (x0,y0)-(x1,y1) inclus.
 * Algorithme de Bresenham à quatre quadrants (Zingl) : contour fermé, sans trou,
 * symétrique.
 */
export function ellipseThin(x0: number, y0: number, x1: number, y1: number, plot: Plot) {
  let a = Math.abs(x1 - x0);
  const b = Math.abs(y1 - y0);
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b, dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a, e2: number;
  if (x0 > x1) { x0 = x1; x1 += a; }
  if (y0 > y1) y0 = y1;
  y0 += Math.floor((b + 1) / 2); y1 = y0 - b1;
  a *= 8 * a; b1 = 8 * b * b;
  do {
    plot(x1, y0); plot(x0, y0); plot(x0, y1); plot(x1, y1);
    e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; err += dy += a; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    plot(x0 - 1, y0); plot(x1 + 1, y0++); plot(x0 - 1, y1); plot(x1 + 1, y1--);
  }
}

/** Pixels dont le centre est dans l'ellipse inscrite au rectangle (x0,y0)-(x1,y1) inclus. */
export function ellipseInside(x0: number, y0: number, x1: number, y1: number, plot: Plot, shrink = 0) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const cx = (ax + bx + 1) / 2, cy = (ay + by + 1) / 2;
  const rx = (bx - ax + 1) / 2 - shrink, ry = (by - ay + 1) / 2 - shrink;
  if (rx <= 0 || ry <= 0) return;
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    if (nx * nx + ny * ny <= 1) plot(x, y);
  }
}

/** Contour d'ellipse d'épaisseur t (t=1 → tracé fin de Bresenham, sinon anneau). */
export function ellipseRing(x0: number, y0: number, x1: number, y1: number, t: number, plot: Plot) {
  if (t <= 1) { ellipseThin(x0, y0, x1, y1, plot); return; }
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  if (bx - ax + 1 <= 2 * t || by - ay + 1 <= 2 * t) { ellipseInside(x0, y0, x1, y1, plot); return; }
  const cx = (ax + bx + 1) / 2, cy = (ay + by + 1) / 2;
  const rx = (bx - ax + 1) / 2, ry = (by - ay + 1) / 2;
  const irx = rx - t, iry = ry - t;
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    if (nx * nx + ny * ny > 1) continue;
    const mx = (x + 0.5 - cx) / irx, my = (y + 0.5 - cy) / iry;
    if (mx * mx + my * my > 1) plot(x, y);
  }
}

/** Remplissage de polygone (règle pair/impair), sommets = pixels (centres des pixels). */
export function polygonFill(pts: number[], w: number, h: number, plot: Plot) {
  const n = pts.length >> 1;
  if (n < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minY = Math.min(minY, pts[2 * i + 1]); maxY = Math.max(maxY, pts[2 * i + 1]); }
  minY = Math.max(0, minY); maxY = Math.min(h - 1, maxY);
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[2 * i] + 0.5, ay = pts[2 * i + 1] + 0.5, bx = pts[2 * j] + 0.5, by = pts[2 * j + 1] + 0.5;
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5)), to = Math.min(w - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = from; x <= to; x++) plot(x, y);
    }
  }
}

/**
 * Région à remplir : indices des pixels de même couleur que (x,y), comparaison stricte.
 * `contiguous` = connexité 4 (pot de peinture) ; sinon toute l'image (remplacement de couleur).
 */
export function floodRegion(data: Uint32Array, w: number, h: number, x: number, y: number, contiguous: boolean): Int32Array {
  if (x < 0 || y < 0 || x >= w || y >= h) return new Int32Array(0);
  const target = data[y * w + x];
  const out: number[] = [];
  if (!contiguous) {
    for (let i = 0; i < data.length; i++) if (data[i] === target) out.push(i);
    return Int32Array.from(out);
  }
  const seen = new Uint8Array(w * h);
  const stack: number[] = [x, y];
  while (stack.length) {
    const sy = stack.pop()!, sx = stack.pop()!;
    if (seen[sy * w + sx] || data[sy * w + sx] !== target) continue;
    let l = sx, r = sx;
    while (l > 0 && !seen[sy * w + l - 1] && data[sy * w + l - 1] === target) l--;
    while (r < w - 1 && !seen[sy * w + r + 1] && data[sy * w + r + 1] === target) r++;
    for (let i = l; i <= r; i++) { seen[sy * w + i] = 1; out.push(sy * w + i); }
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inSpan = false;
      for (let i = l; i <= r; i++) {
        const ok = !seen[ny * w + i] && data[ny * w + i] === target;
        if (ok && !inSpan) { stack.push(i, ny); inSpan = true; }
        else if (!ok) inSpan = false;
      }
    }
  }
  return Int32Array.from(out);
}

// ─── Symétries ────────────────────────────────────────────────────────────────

export interface SymCfg { m: string; cx: number; cy: number }

// Table cos/sin en littéraux : les fonctions transcendantes ne sont pas
// garanties identiques d'un moteur JS à l'autre, les littéraux si.
const ROT: Record<number, [number, number][]> = {
  2: [[-1, 0]],
  3: [[-0.5, 0.866025403784439], [-0.5, -0.866025403784438]],
  4: [[0, 1], [-1, 0], [0, -1]],
  5: [[0.309016994374947, 0.951056516295154], [-0.809016994374947, 0.587785252292473], [-0.809016994374947, -0.587785252292473], [0.309016994374947, -0.951056516295154]],
  6: [[0.5, 0.866025403784439], [-0.5, 0.866025403784439], [-1, 0], [-0.5, -0.866025403784438], [0.5, -0.866025403784439]],
  7: [[0.623489801858734, 0.78183148246803], [-0.222520933956314, 0.974927912181824], [-0.900968867902419, 0.433883739117558], [-0.900968867902419, -0.433883739117558], [-0.222520933956315, -0.974927912181824], [0.623489801858733, -0.78183148246803]],
  8: [[0.707106781186548, 0.707106781186547], [0, 1], [-0.707106781186547, 0.707106781186548], [-1, 0], [-0.707106781186548, -0.707106781186547], [0, -1], [0.707106781186547, -0.707106781186548]],
};

export const SYMMETRY_MODES: { id: string; label: string }[] = [
  { id: "",   label: "Aucune" },
  { id: "v",  label: "Miroir |" },
  { id: "h",  label: "Miroir —" },
  { id: "vh", label: "Miroir ✚" },
  { id: "r3", label: "Rotation ×3" },
  { id: "r4", label: "Rotation ×4" },
  { id: "r6", label: "Rotation ×6" },
  { id: "r8", label: "Rotation ×8" },
];

/** Copie symétrique d'un point ; fx/fy = l'empreinte de brosse doit être retournée. */
export interface SymCopy { x: number; y: number; fx: boolean; fy: boolean }

/** Copies symétriques d'un point (l'original en premier). Les doublons sont inoffensifs. */
export function symmetricCopies(x: number, y: number, s: SymCfg | null | undefined): SymCopy[] {
  const out: SymCopy[] = [{ x, y, fx: false, fy: false }];
  if (!s || !s.m) return out;
  const mx = (px: number) => Math.round(2 * s.cx - px - 1);
  const my = (py: number) => Math.round(2 * s.cy - py - 1);
  if (s.m === "v") out.push({ x: mx(x), y, fx: true, fy: false });
  else if (s.m === "h") out.push({ x, y: my(y), fx: false, fy: true });
  else if (s.m === "vh") out.push({ x: mx(x), y, fx: true, fy: false }, { x, y: my(y), fx: false, fy: true }, { x: mx(x), y: my(y), fx: true, fy: true });
  else if (s.m[0] === "r") {
    const table = ROT[parseInt(s.m.slice(1), 10)];
    if (table) {
      const px = x + 0.5 - s.cx, py = y + 0.5 - s.cy;
      for (const [c, sn] of table) {
        out.push({ x: Math.floor(s.cx + px * c - py * sn), y: Math.floor(s.cy + px * sn + py * c), fx: false, fy: false });
      }
    }
  }
  return out;
}
