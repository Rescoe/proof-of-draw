// lib/drawEngine/patterns.ts
// Textures ("trames") pixel-exactes. Sur un écran 1 bit il n'existe pas de gris
// vrai : un ton intermédiaire est un motif de pixels allumés/éteints. Chaque
// texture est un carré 8×8 répété ; un pixel n'est peint que là où le motif
// vaut 1. Aucun seuillage ultérieur : l'aperçu est identique à l'écran.

const BAYER8: number[] = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

export interface TextureInfo {
  id: string;
  label: string;
  /** Part approximative de pixels peints, 0..1 (pour l'affichage). */
  density: number;
}

// Un motif = 64 bits (Uint8Array(64) de 0/1), index y*8+x.
type Tile = Uint8Array;

function fromFn(fn: (x: number, y: number) => boolean): Tile {
  const t = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = fn(x, y) ? 1 : 0;
  return t;
}

const bayer = (level: number) => fromFn((x, y) => BAYER8[y * 8 + x] < level);

const BUILTIN: { info: TextureInfo; tile: Tile | null }[] = [
  { info: { id: "solid", label: "Plein",       density: 1 },     tile: null },
  { info: { id: "b88",   label: "Dense 88 %",  density: 56 / 64 }, tile: bayer(56) },
  { info: { id: "b75",   label: "Trame 75 %",  density: 48 / 64 }, tile: bayer(48) },
  { info: { id: "b50",   label: "Trame 50 %",  density: 32 / 64 }, tile: bayer(32) },
  { info: { id: "b25",   label: "Trame 25 %",  density: 16 / 64 }, tile: bayer(16) },
  { info: { id: "b12",   label: "Léger 12 %",  density: 8 / 64 },  tile: bayer(8) },
  { info: { id: "hl",    label: "Lignes —",    density: 0.5 },     tile: fromFn((_x, y) => y % 2 === 0) },
  { info: { id: "vl",    label: "Lignes |",    density: 0.5 },     tile: fromFn((x) => x % 2 === 0) },
  { info: { id: "dg",    label: "Diagonales /", density: 0.25 },   tile: fromFn((x, y) => ((x + y) & 3) === 0) },
  { info: { id: "dg2",   label: "Diagonales \\", density: 0.25 },  tile: fromFn((x, y) => ((x - y) & 3) === 0) },
  { info: { id: "chk",   label: "Damier",      density: 0.5 },     tile: fromFn((x, y) => ((x + y) & 1) === 0) },
  { info: { id: "dot",   label: "Points",      density: 1 / 16 }, tile: fromFn((x, y) => (x & 3) === 0 && (y & 3) === 0) },
  { info: { id: "crs",   label: "Quadrillage", density: 0.44 },    tile: fromFn((x, y) => (x & 3) === 0 || (y & 3) === 0) },
  { info: { id: "brk",   label: "Briques",     density: 0.34 },    tile: fromFn((x, y) => (y & 3) === 0 || ((x + (((y >> 2) & 1) * 4)) & 7) === 0) },
  { info: { id: "wav",   label: "Vagues",      density: 0.25 },    tile: fromFn((x, y) => ((y + (x < 4 ? x : 8 - x)) & 3) === 0) },
];

const BY_ID = new Map(BUILTIN.map(b => [b.info.id, b]));

/** Liste des textures intégrées (ordre d'affichage : du plus plein au plus léger, puis motifs). */
export const TEXTURES: TextureInfo[] = BUILTIN.map(b => b.info);

/** Textures proposées pour "l'opacité" sur un écran 1 bit : les 5 densités de trame + plein. */
export const DENSITY_TEXTURES = ["solid", "b88", "b75", "b50", "b25", "b12"];

const customCache = new Map<string, Tile>();

/** Identifiant d'une texture personnalisée 8×8 : "c:" + 16 hex (8 lignes, bit 7 = x 0). */
export function customTextureId(tile: ArrayLike<number>): string {
  let hex = "";
  for (let y = 0; y < 8; y++) {
    let row = 0;
    for (let x = 0; x < 8; x++) if (tile[y * 8 + x]) row |= 0x80 >> x;
    hex += row.toString(16).padStart(2, "0");
  }
  return "c:" + hex;
}

export function parseCustomTexture(id: string): Tile | null {
  if (!id.startsWith("c:") || id.length !== 18) return null;
  const hit = customCache.get(id);
  if (hit) return hit;
  const t = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const row = parseInt(id.slice(2 + y * 2, 4 + y * 2), 16);
    if (Number.isNaN(row)) return null;
    for (let x = 0; x < 8; x++) t[y * 8 + x] = (row >> (7 - x)) & 1;
  }
  customCache.set(id, t);
  return t;
}

/** Motif 8×8 (64 valeurs 0/1) d'une texture, ou null pour "plein". */
export function textureTile(id: string): Tile | null {
  if (id === "solid" || !id) return null;
  const b = BY_ID.get(id);
  if (b) return b.tile;
  return parseCustomTexture(id);
}

/** Vrai si le pixel (x,y) doit être peint avec cette texture. */
export function textureBit(id: string, x: number, y: number): boolean {
  const t = textureTile(id);
  return t ? t[((y & 7) << 3) | (x & 7)] === 1 : true;
}

/** Seuil Bayer 0..63 d'un pixel — utilisé par les dégradés tramés. */
export function bayerThreshold(x: number, y: number): number {
  return BAYER8[((y & 7) << 3) | (x & 7)];
}

export function textureLabel(id: string): string {
  return BY_ID.get(id)?.info.label ?? (id.startsWith("c:") ? "Personnalisée" : id);
}
