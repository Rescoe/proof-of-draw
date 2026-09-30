// lib/drawEngine/color.ts
// Couleurs empaquetées (0xAABBGGRR = octets R,G,B,A en mémoire little-endian,
// identiques à un ImageData) et règles de quantification par type d'écran.
//
// Principe du moteur : l'image du canvas ne contient JAMAIS que des couleurs
// que l'écran physique sait afficher. Ce que l'utilisateur voit est donc, bit
// pour bit, ce que `canvasToScreenPayload` enverra.

export type Color = number;

export type ColorMode =
  | "bw"      // 1 bit : noir / blanc            (e-ink 2.7", OLED 0.96")
  | "bwr"     // noir / blanc / rouge            (e-ink 2.9" BWR)
  | "rgb565"; // couleur 16 bits                 (TFT 1.8")

export const pack = (r: number, g: number, b: number, a = 255): Color =>
  (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;

export const cr = (c: Color) => c & 255;
export const cg = (c: Color) => (c >>> 8) & 255;
export const cb = (c: Color) => (c >>> 16) & 255;

export const BLACK: Color = pack(0, 0, 0);
export const WHITE: Color = pack(255, 255, 255);
// Rouge de la palette BWR (#CC0000) — classé "rouge" par classifyPixel (r>150, g<100, b<100)
export const RED: Color = pack(204, 0, 0);

export function fromHex(hex: string): Color {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const v = h.length === 3
    ? h.split("").map(ch => ch + ch).join("")
    : h.padEnd(6, "0");
  return pack(parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0);
}

export function toHex(c: Color): string {
  return "#" + [cr(c), cg(c), cb(c)].map(v => v.toString(16).padStart(2, "0")).join("");
}

/** Luminance identique à `classifyPixel` / conversion OLED de canvasToScreen. */
export const luminance = (c: Color) => (cr(c) * 3 + cg(c) * 6 + cb(c)) / 10;

/** Quantification RGB565 → 8 bits par expansion pleine échelle (blanc reste blanc). */
export function quantize565(c: Color): Color {
  const r5 = cr(c) >> 3, g6 = cg(c) >> 2, b5 = cb(c) >> 3;
  return pack((r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2));
}

/** Ramène n'importe quelle couleur sur la palette réellement affichable de l'écran. */
export function snapColor(c: Color, mode: ColorMode): Color {
  if (mode === "rgb565") return quantize565(c);
  if (mode === "bwr" && cr(c) > 150 && cg(c) < 100 && cb(c) < 100) return RED;
  return luminance(c) < 128 ? BLACK : WHITE;
}

/**
 * Mélange entier déterministe (pas de flottant) : `op` en pourcentage 0..100.
 * Le résultat est quantifié RGB565 — c'est la seule situation où l'opacité existe.
 */
export function blend565(dst: Color, src: Color, op: number): Color {
  if (op >= 100) return quantize565(src);
  if (op <= 0) return dst;
  const m = (d: number, s: number) => Math.floor((d * (100 - op) + s * op + 50) / 100);
  return quantize565(pack(m(cr(dst), cr(src)), m(cg(dst), cg(src)), m(cb(dst), cb(src))));
}

/** Interpolation linéaire entière (dégradés RGB565), t en 0..256. */
export function lerp(a: Color, b: Color, t256: number): Color {
  const m = (x: number, y: number) => x + (((y - x) * t256) >> 8);
  return pack(m(cr(a), cr(b)), m(cg(a), cg(b)), m(cb(a), cb(b)));
}

/** Teinte/Saturation/Valeur (0..360, 0..1, 0..1) → couleur. Pour le sélecteur TFT. */
export function hsvToColor(h: number, s: number, v: number): Color {
  const hh = ((h % 360) + 360) % 360 / 60;
  const i = Math.floor(hh), f = hh - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return pack(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}

export function colorToHsv(c: Color): { h: number; s: number; v: number } {
  const r = cr(c) / 255, g = cg(c) / 255, b = cb(c) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Palette de dessin d'un mode, sous forme de couleurs #hex (pour l'interface). */
export function paletteForMode(mode: ColorMode): string[] {
  if (mode === "bw") return ["#000000", "#FFFFFF"];
  if (mode === "bwr") return ["#000000", "#FFFFFF", "#CC0000"];
  return [];
}

/** Déduit le mode couleur d'un profil d'écran (lib/screenProfiles.ts). */
export function modeForProfile(p: { pixelFormat: "1bpp" | "rgb565"; payloadType: "mono" | "dual" }): ColorMode {
  if (p.pixelFormat === "rgb565") return "rgb565";
  return p.payloadType === "dual" ? "bwr" : "bw";
}
