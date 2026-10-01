// lib/poemRender.ts
// Rend un poème (texte) en bitmap niveaux de gris à la taille EXACTE d'un type d'écran, prêt pour
// encodeForScreen() (aucun redimensionnement). Police 5×7 du moteur de dessin (accents français).
//
// Mise en page :
//  • avatar du Normie auteur (40×40, 0 = encre / 255 = blanc) réservé à gauche (OLED, e-ink : ×2 sur e-ink)
//    ou en haut à gauche (TFT, titre à sa droite) ; sans avatar, le texte prend toute la surface ;
//  • texte retourné à la ligne par mots, taille ×2 si tout y tient (e-ink), sinon ×1 condensé ;
//  • trop long : tronqué avec « ... » (le défilement multi-frames viendra plus tard).
// Fonction pure, déterministe, sans I/O.

import { Bitmap, Txn } from "@/lib/drawEngine/bitmap";
import { WHITE } from "@/lib/drawEngine/color";
import { drawText, TEXT_ALIASES } from "@/lib/drawEngine/text";
import { makeInk, type Surface } from "@/lib/drawEngine/ops";
import { SCREEN_PROFILES, type ScreenId } from "@/lib/screenProfiles";

export const AVATAR_SIZE = 40;
const MAX_CHARS = 2000;
const MARGIN = 3;
const CELL_W = 6;
// Interligne : ×1 condensé (7 lignes sur l'OLED), ×2 un peu plus aéré
const pitch = (sc: number) => (sc === 1 ? 8 : 17);

export interface PoemInput {
  text: string;
  title?: string;
  avatar?: Uint8Array;   // 40×40 niveaux de gris, row-major (0 = encre)
}

export interface RenderedPoem {
  pixels: Uint8Array;    // w×h, 0 = encre, 255 = blanc
  w: number;
  h: number;
  truncated: boolean;
  lines: number;
}

interface Layout { avatarScale: number; avatarTop: boolean; scales: number[]; titleLines: number }

const LAYOUT: Record<ScreenId, Layout> = {
  oled096:   { avatarScale: 1, avatarTop: false, scales: [1],    titleLines: 0 },
  tft18:     { avatarScale: 1, avatarTop: true,  scales: [1],    titleLines: 4 },
  eink27bw:  { avatarScale: 2, avatarTop: false, scales: [2, 1], titleLines: 1 },
  eink29bwr: { avatarScale: 2, avatarTop: false, scales: [2, 1], titleLines: 1 },
};

/** Normalise le texte (apostrophes/tirets typographiques, retours chariot). */
function clean(s: string): string {
  let out = "";
  for (const ch of s.replace(/\r\n?/g, "\n").slice(0, MAX_CHARS)) out += TEXT_ALIASES[ch] ?? ch;
  return out.replace(/[ \t]+\n/g, "\n").trim();
}

/** Retour à la ligne par mots ; coupe les mots plus longs qu'une ligne. Les lignes vides sont conservées. */
export function wrapText(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while ([...word].length > cols) {
        if (line) { out.push(line); line = ""; }
        out.push([...word].slice(0, cols).join(""));
        word = [...word].slice(cols).join("");
      }
      if (!line) line = word;
      else if ([...line].length + 1 + [...word].length <= cols) line += " " + word;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
  }
  return out;
}

export function renderPoem(input: PoemInput, screen: ScreenId): RenderedPoem {
  const prof = SCREEN_PROFILES[screen];
  const lay = LAYOUT[screen];
  const W = prof.width, H = prof.height;
  const bmp = new Bitmap(W, H, WHITE);
  const surf: Surface = { bmp, txn: new Txn(bmp), mode: "bw" };
  const ink = makeInk("#000000", "bw");

  const avatar = input.avatar && input.avatar.length === AVATAR_SIZE * AVATAR_SIZE ? input.avatar : null;
  const as = lay.avatarScale, aSize = AVATAR_SIZE * as;
  if (avatar) {
    const ax = MARGIN, ay = lay.avatarTop ? MARGIN : Math.max(0, Math.floor((H - aSize) / 2));
    for (let y = 0; y < aSize; y++) for (let x = 0; x < aSize; x++) {
      if (avatar[Math.floor(y / as) * AVATAR_SIZE + Math.floor(x / as)] < 128) plot(surf, ink, ax + x, ay + y);
    }
  }

  // Zones de texte : titre (TFT : à droite de l'avatar) puis corps
  const side = avatar && !lay.avatarTop ? aSize + MARGIN * 2 : MARGIN;
  const bodyX = side, bodyW = W - side - MARGIN;
  const bodyTop = avatar && lay.avatarTop ? aSize + MARGIN * 2 : MARGIN;
  const bodyH = H - bodyTop - MARGIN;

  const title = clean(input.title ?? "");
  const body  = clean(input.text);

  // Titre (si la place existe) — petit, une ou plusieurs lignes
  let titleRows: string[] = [];
  let titleX = bodyX, titleY = bodyTop, titleW = bodyW;
  if (lay.titleLines > 0 && title) {
    if (avatar && lay.avatarTop) { titleX = MARGIN * 2 + aSize; titleY = MARGIN; titleW = W - titleX - MARGIN; }
    titleRows = wrapText(title, Math.floor((titleW + 1) / CELL_W)).slice(0, lay.titleLines);
  }
  const titleBlock = !(avatar && lay.avatarTop) && titleRows.length ? titleRows.length * 9 + 5 : 0;
  if (titleRows.length) {
    titleRows.forEach((t, i) => drawText(surf, ink, { x: titleX, y: titleY + 2 + i * 9 }, t, 1));
  }

  const textTop = bodyTop + titleBlock;
  const textH = bodyH - titleBlock;

  // Choix de l'échelle : la plus grande qui contient tout ; sinon ×1 tronqué
  let chosen = lay.scales[lay.scales.length - 1], rows: string[] = [], truncated = false;
  for (const sc of lay.scales) {
    const cols = Math.floor((bodyW + 1) / (CELL_W * sc));
    const cap = Math.floor((textH - 2 * sc) / pitch(sc));
    const wrapped = wrapText(body, cols);
    if (wrapped.length <= cap || sc === lay.scales[lay.scales.length - 1]) {
      chosen = sc;
      if (wrapped.length > cap) {
        truncated = true;
        rows = wrapped.slice(0, Math.max(1, cap));
        const last = rows[rows.length - 1];
        const room = Math.max(0, cols - 3);
        rows[rows.length - 1] = [...last].slice(0, room).join("").trimEnd() + "...";
      } else rows = wrapped;
      break;
    }
  }
  rows.forEach((r, i) => { if (r) drawText(surf, ink, { x: bodyX, y: textTop + 2 * chosen + i * pitch(chosen) }, r, chosen); });

  const pixels = new Uint8Array(W * H).fill(255);
  for (let i = 0; i < W * H; i++) if (bmp.data[i] !== WHITE) pixels[i] = 0;
  return { pixels, w: W, h: H, truncated, lines: rows.length };
}

function plot(s: Surface, ink: ReturnType<typeof makeInk>, x: number, y: number) {
  if (!s.bmp.inBounds(x, y)) return;
  s.txn.write(y * s.bmp.w + x, ink.color);
}
