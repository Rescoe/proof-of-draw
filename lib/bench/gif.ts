// lib/bench/gif.ts — export GIF89a d'une animation du banc d'essai (128×64, 2 couleurs : « allumé » / « fond »), sans dépendance.
// Palette globale de 2 entrées ; chaque pixel source est répété `scale` fois (aperçu net). Boucle infinie (extension NETSCAPE2.0) ou nombre de boucles.
// LZW GIF standard (taille minimale de code 2). Vérifié par un décodeur LZW indépendant dans tests/benchGif.test.ts.

import { CLIP, clipPixel } from "@/lib/bench/clip";

export interface GifInput {
  frames: Uint8Array[];      // images 128×64 1 bit (format du clip)
  delaysMs: number[];
  fg: [number, number, number];
  bg: [number, number, number];
  scale?: number;            // 1..8 (défaut 4)
  /** 0 = boucle infinie. */
  loops?: number;
}

/** Compresse un flux d'indices (0/1) en blocs LZW GIF. */
function lzwEncode(indices: Uint8Array, minCodeSize: number): number[] {
  const out: number[] = [minCodeSize];
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let nextCode = eoi + 1, codeSize = minCodeSize + 1;
  let table = new Map<number, number>();
  let cur = 0, curBits = 0;
  const block: number[] = [];
  const flushBlock = () => { if (block.length) { out.push(block.length, ...block); block.length = 0; } };
  const putByte = (b: number) => { block.push(b); if (block.length === 255) flushBlock(); };
  const emit = (code: number) => {
    cur |= code << curBits; curBits += codeSize;
    while (curBits >= 8) { putByte(cur & 0xff); cur >>>= 8; curBits -= 8; }
  };

  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (nextCode === 4096) { emit(clear); table = new Map(); nextCode = eoi + 1; codeSize = minCodeSize + 1; }
    else {
      if (nextCode >= (1 << codeSize)) codeSize++;
      table.set(key, nextCode++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (curBits > 0) putByte(cur & 0xff);
  flushBlock();
  out.push(0);                                          // fin des sous-blocs
  return out;
}

export function encodeGif(input: GifInput): Uint8Array {
  const scale = Math.max(1, Math.min(8, Math.round(input.scale ?? 4)));
  const w = CLIP.W * scale, h = CLIP.H * scale;
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  for (const c of "GIF89a") out.push(c.charCodeAt(0));
  u16(w); u16(h);
  out.push(0x80 | 0x70 | 0x00, 0, 0);                   // palette globale de 2 entrées (taille 2^(0+1)), fond 0, ratio 0
  out.push(...input.bg, ...input.fg);                    // indice 0 = fond, 1 = allumé
  out.push(0x21, 0xff, 0x0b); for (const c of "NETSCAPE2.0") out.push(c.charCodeAt(0));
  out.push(0x03, 0x01); u16(input.loops ?? 0); out.push(0x00);
  input.frames.forEach((frame, n) => {
    const delay = Math.max(2, Math.round((input.delaysMs[n] ?? 100) / 10));   // centièmes de seconde (les navigateurs ralentissent < 2)
    out.push(0x21, 0xf9, 0x04, 0x00); u16(delay); out.push(0x00, 0x00);
    out.push(0x2c); u16(0); u16(0); u16(w); u16(h); out.push(0x00);
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = Math.floor(y / scale);
      for (let x = 0; x < w; x++) px[y * w + x] = clipPixel(frame, Math.floor(x / scale), sy);
    }
    for (const b of lzwEncode(px, 2)) out.push(b);
  });
  out.push(0x3b);
  return Uint8Array.from(out);
}
