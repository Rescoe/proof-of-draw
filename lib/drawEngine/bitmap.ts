// lib/drawEngine/bitmap.ts
// Image du canvas (pixels empaquetés) + transaction d'écriture avec journal des
// pixels modifiés. La transaction est ce qui rend l'historique "par deltas"
// possible : annuler = réécrire les valeurs d'avant, refaire = réécrire celles d'après.

import { Color, WHITE } from "./color";

export class Bitmap {
  readonly w: number;
  readonly h: number;
  data: Uint32Array;

  constructor(w: number, h: number, fill: Color = WHITE, data?: Uint32Array) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Uint32Array(w * h).fill(fill);
  }

  clone(): Bitmap {
    return new Bitmap(this.w, this.h, WHITE, this.data.slice());
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Color {
    return this.data[y * this.w + x];
  }

  fill(c: Color) {
    this.data.fill(c);
  }

  equals(o: Bitmap): boolean {
    if (o.w !== this.w || o.h !== this.h) return false;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== o.data[i]) return false;
    return true;
  }

  /** Octets RGBA prêts pour `ImageData` (little-endian : zéro copie). */
  toRGBA(): Uint8ClampedArray<ArrayBuffer> {
    if (IS_LE) return new Uint8ClampedArray(this.data.buffer as ArrayBuffer, this.data.byteOffset, this.data.byteLength);
    const out = new Uint8ClampedArray(this.data.length * 4);
    for (let i = 0; i < this.data.length; i++) {
      const c = this.data[i];
      out[i * 4] = c & 255; out[i * 4 + 1] = (c >>> 8) & 255;
      out[i * 4 + 2] = (c >>> 16) & 255; out[i * 4 + 3] = (c >>> 24) & 255;
    }
    return out;
  }

  /** Charge des octets RGBA (ex. `ImageData.data`) dans le bitmap. */
  static fromRGBA(rgba: ArrayLike<number>, w: number, h: number): Bitmap {
    const b = new Bitmap(w, h);
    for (let i = 0; i < w * h; i++) {
      b.data[i] = ((rgba[i * 4 + 3] & 255) << 24 | (rgba[i * 4 + 2] & 255) << 16 | (rgba[i * 4 + 1] & 255) << 8 | (rgba[i * 4] & 255)) >>> 0;
    }
    return b;
  }
}

const IS_LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

// ─── Delta d'historique ───────────────────────────────────────────────────────

export interface Delta {
  frame: number;
  idx: Int32Array;      // indices des pixels réellement modifiés
  before: Uint32Array;  // valeur avant
  after: Uint32Array;   // valeur après
}

export function deltaBytes(d: Delta): number {
  return d.idx.byteLength + d.before.byteLength + d.after.byteLength;
}

export function applyDelta(bmp: Bitmap, d: Delta, dir: "undo" | "redo") {
  const src = dir === "undo" ? d.before : d.after;
  for (let k = 0; k < d.idx.length; k++) bmp.data[d.idx[k]] = src[k];
}

// ─── Transaction ──────────────────────────────────────────────────────────────

export class Txn {
  readonly bmp: Bitmap;
  private pos: Int32Array;                 // pos[i] = rang dans idxs, ou -1
  private idxs: number[] = [];
  private befores: number[] = [];

  constructor(bmp: Bitmap) {
    this.bmp = bmp;
    this.pos = new Int32Array(bmp.w * bmp.h).fill(-1);
  }

  /** Écrit un pixel en mémorisant sa valeur d'origine (première écriture seulement). */
  write(i: number, c: Color) {
    if (this.pos[i] < 0) {
      this.pos[i] = this.idxs.length;
      this.idxs.push(i);
      this.befores.push(this.bmp.data[i]);
    }
    this.bmp.data[i] = c;
  }

  touched(i: number): boolean {
    return this.pos[i] >= 0;
  }

  /** Valeur du pixel avant la transaction (ou valeur actuelle s'il n'a pas été touché). */
  original(i: number): Color {
    const p = this.pos[i];
    return p >= 0 ? this.befores[p] : this.bmp.data[i];
  }

  /** Restaure le bitmap tel qu'il était au début de la transaction et la vide. */
  rollback() {
    for (let k = 0; k < this.idxs.length; k++) {
      const i = this.idxs[k];
      this.bmp.data[i] = this.befores[k];
      this.pos[i] = -1;
    }
    this.idxs.length = 0;
    this.befores.length = 0;
  }

  /** Nombre de pixels dont la valeur diffère réellement de l'original. */
  changedCount(): number {
    let n = 0;
    for (let k = 0; k < this.idxs.length; k++) if (this.bmp.data[this.idxs[k]] !== this.befores[k]) n++;
    return n;
  }

  /** Clôt la transaction : retourne le delta (pixels réellement modifiés) ou null s'il n'y en a aucun. */
  commit(frame: number): Delta | null {
    const idx: number[] = [], before: number[] = [], after: number[] = [];
    for (let k = 0; k < this.idxs.length; k++) {
      const i = this.idxs[k];
      const a = this.bmp.data[i];
      if (a !== this.befores[k]) { idx.push(i); before.push(this.befores[k]); after.push(a); }
      this.pos[i] = -1;
    }
    this.idxs.length = 0;
    this.befores.length = 0;
    if (idx.length === 0) return null;
    return { frame, idx: Int32Array.from(idx), before: Uint32Array.from(before), after: Uint32Array.from(after) };
  }
}
