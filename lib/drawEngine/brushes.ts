// lib/drawEngine/brushes.ts
// Empreintes de brosse pixel-exactes (aucun anti-aliasing) : un masque de 0/1
// posé à chaque pas du tracé. Les brosses personnalisées sont de petits
// masques dessinés par l'utilisateur, embarqués tels quels dans le replay.

export interface BrushInfo {
  id: string;
  label: string;
  hint: string;
}

export const BRUSH_TYPES: BrushInfo[] = [
  { id: "round",   label: "Rond",       hint: "Le classique, bords arrondis" },
  { id: "square",  label: "Carré",      hint: "Trait net, idéal pour les aplats" },
  { id: "pixel",   label: "Pixel",      hint: "1 pixel exact, coins en L nettoyés" },
  { id: "diamond", label: "Losange",    hint: "Pointe en diamant" },
  { id: "hbar",    label: "Plat —",     hint: "Pinceau plat horizontal" },
  { id: "vbar",    label: "Plat |",     hint: "Pinceau plat vertical" },
  { id: "slash",   label: "Calli /",    hint: "Calligraphie inclinée /" },
  { id: "bslash",  label: "Calli \\",   hint: "Calligraphie inclinée \\" },
  { id: "spray",   label: "Spray",      hint: "Aérographe de points" },
];

export interface BrushMask {
  w: number;
  h: number;
  bits: Uint8Array;   // w*h de 0/1
  spray: boolean;
}

const cache = new Map<string, BrushMask>();

function disc(s: number): Uint8Array {
  const bits = new Uint8Array(s * s);
  const c = s / 2, r = (s - 0.5) / 2, r2 = r * r;
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const dx = i + 0.5 - c, dy = j + 0.5 - c;
    if (dx * dx + dy * dy <= r2) bits[j * s + i] = 1;
  }
  return bits;
}

function diamond(s: number): Uint8Array {
  const bits = new Uint8Array(s * s);
  const c = s / 2;
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    if (Math.abs(i + 0.5 - c) + Math.abs(j + 0.5 - c) <= c) bits[j * s + i] = 1;
  }
  return bits;
}

/** Identifiant d'une brosse personnalisée : "c:WxH:<base64 des bits, MSB d'abord>". */
export function encodeCustomBrush(w: number, h: number, bits: ArrayLike<number>): string {
  const n = Math.ceil((w * h) / 8);
  const bytes = new Uint8Array(n);
  for (let k = 0; k < w * h; k++) if (bits[k]) bytes[k >> 3] |= 0x80 >> (k & 7);
  let bin = "";
  for (let i = 0; i < n; i++) bin += String.fromCharCode(bytes[i]);
  return `c:${w}x${h}:${btoa(bin)}`;
}

export function decodeCustomBrush(id: string): { w: number; h: number; bits: Uint8Array } | null {
  const m = /^c:(\d{1,2})x(\d{1,2}):([A-Za-z0-9+/=]*)$/.exec(id);
  if (!m) return null;
  const w = +m[1], h = +m[2];
  if (w < 1 || h < 1 || w > 32 || h > 32) return null;
  let bin: string;
  try { bin = atob(m[3]); } catch { return null; }
  const bits = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) {
    const byte = bin.charCodeAt(k >> 3) || 0;
    bits[k] = (byte >> (7 - (k & 7))) & 1;
  }
  return { w, h, bits };
}

export function isCustomBrush(id: string) {
  return id.startsWith("c:");
}

/** Masque d'une brosse pour une taille donnée (mis en cache). */
export function brushMask(id: string, size: number): BrushMask {
  const s = Math.max(1, Math.min(64, Math.round(size)));
  const key = id + "|" + s;
  const hit = cache.get(key);
  if (hit) return hit;

  let m: BrushMask;
  switch (id) {
    case "square":  m = { w: s, h: s, bits: new Uint8Array(s * s).fill(1), spray: false }; break;
    case "diamond": m = { w: s, h: s, bits: diamond(s), spray: false }; break;
    case "pixel":   m = { w: 1, h: 1, bits: new Uint8Array([1]), spray: false }; break;
    case "hbar":    m = { w: s, h: 1, bits: new Uint8Array(s).fill(1), spray: false }; break;
    case "vbar":    m = { w: 1, h: s, bits: new Uint8Array(s).fill(1), spray: false }; break;
    case "slash": {
      const bits = new Uint8Array(s * s);
      for (let i = 0; i < s; i++) bits[(s - 1 - i) * s + i] = 1;
      m = { w: s, h: s, bits, spray: false }; break;
    }
    case "bslash": {
      const bits = new Uint8Array(s * s);
      for (let i = 0; i < s; i++) bits[i * s + i] = 1;
      m = { w: s, h: s, bits, spray: false }; break;
    }
    case "spray":   m = { w: s, h: s, bits: disc(s), spray: true }; break;
    default: {
      const custom = isCustomBrush(id) ? decodeCustomBrush(id) : null;
      if (custom) {
        // Taille demandée → facteur d'agrandissement entier (plus petit = échelle 1).
        const k = Math.max(1, Math.round(s / Math.max(custom.w, custom.h)));
        if (k === 1) { m = { ...custom, spray: false }; break; }
        const w = custom.w * k, h = custom.h * k, bits = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits[y * w + x] = custom.bits[Math.floor(y / k) * custom.w + Math.floor(x / k)];
        m = { w, h, bits, spray: false };
      } else {
        m = { w: s, h: s, bits: disc(s), spray: false };   // "round" et repli
      }
    }
  }
  if (cache.size > 400) cache.clear();
  cache.set(key, m);
  return m;
}

/** Ancre : la brosse est centrée sur le pixel visé. */
export const anchorX = (m: BrushMask) => Math.floor(m.w / 2);
export const anchorY = (m: BrushMask) => Math.floor(m.h / 2);

/** Générateur pseudo-aléatoire déterministe (mulberry32) — le spray se rejoue à l'identique. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
