// app/draw/_studio/view.ts — transformation d'affichage (zoom, déplacement, rotation de la vue)
// Matrice affine restreinte aux quarts de tour : monde (pixels du canvas) ↔ écran (px CSS).

export interface View { s: number; tx: number; ty: number; rot: 0 | 1 | 2 | 3 }

// [a, b, c, d] = paramètres CSS matrix(a,b,c,d,…)
const ROT: [number, number, number, number][] = [
  [1, 0, 0, 1],
  [0, 1, -1, 0],
  [-1, 0, 0, -1],
  [0, -1, 1, 0],
];

export const MIN_SCALE = 0.4;
export const MAX_SCALE = 48;

export function toScreen(v: View, wx: number, wy: number): { x: number; y: number } {
  const [a, b, c, d] = ROT[v.rot];
  return { x: v.s * (a * wx + c * wy) + v.tx, y: v.s * (b * wx + d * wy) + v.ty };
}

export function toWorld(v: View, sx: number, sy: number): { x: number; y: number } {
  const [a, b, c, d] = ROT[v.rot];
  const px = (sx - v.tx) / v.s, py = (sy - v.ty) / v.s;
  return { x: a * px + b * py, y: c * px + d * py };
}

export function cssTransform(v: View): string {
  const [a, b, c, d] = ROT[v.rot];
  return `matrix(${a * v.s},${b * v.s},${c * v.s},${d * v.s},${v.tx},${v.ty})`;
}

/** Ajuste la vue pour montrer tout le canvas dans la scène, avec une marge. */
export function fitView(stageW: number, stageH: number, W: number, H: number, rot: View["rot"], pad = 14): View {
  const rw = rot % 2 ? H : W, rh = rot % 2 ? W : H;
  let s = Math.min((stageW - pad * 2) / rw, (stageH - pad * 2) / rh);
  if (!Number.isFinite(s) || s <= 0) s = 1;
  if (s >= 4) s = Math.floor(s);   // grands agrandissements : pixels de largeur régulière
  s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
  return centered(stageW, stageH, W, H, s, rot);
}

function centered(stageW: number, stageH: number, W: number, H: number, s: number, rot: View["rot"]): View {
  const v: View = { s, tx: 0, ty: 0, rot };
  const c = toScreen(v, W / 2, H / 2);
  v.tx = stageW / 2 - c.x;
  v.ty = stageH / 2 - c.y;
  return v;
}

/** Zoome en gardant fixe le point d'écran (ax, ay). */
export function zoomAt(v: View, factor: number, ax: number, ay: number): View {
  const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.s * factor));
  const w = toWorld(v, ax, ay);
  const nv: View = { ...v, s };
  const p = toScreen(nv, w.x, w.y);
  nv.tx += ax - p.x;
  nv.ty += ay - p.y;
  return nv;
}

/** Empêche de perdre le canvas hors de la scène : au moins `keep` px restent visibles. */
export function clampView(v: View, stageW: number, stageH: number, W: number, H: number, keep = 56): View {
  const corners = [toScreen(v, 0, 0), toScreen(v, W, 0), toScreen(v, 0, H), toScreen(v, W, H)];
  const minX = Math.min(...corners.map(c => c.x)), maxX = Math.max(...corners.map(c => c.x));
  const minY = Math.min(...corners.map(c => c.y)), maxY = Math.max(...corners.map(c => c.y));
  let dx = 0, dy = 0;
  if (maxX < keep) dx = keep - maxX;
  else if (minX > stageW - keep) dx = stageW - keep - minX;
  if (maxY < keep) dy = keep - maxY;
  else if (minY > stageH - keep) dy = stageH - keep - minY;
  return dx || dy ? { ...v, tx: v.tx + dx, ty: v.ty + dy } : v;
}

/** Tourne la vue d'un quart de tour (sens horaire) autour du centre de la scène. */
export function rotateViewCw(v: View, stageW: number, stageH: number, W: number, H: number): View {
  const rot = ((v.rot + 1) % 4) as View["rot"];
  return fitView(stageW, stageH, W, H, rot);
}
