// lib/renderLayout.ts — RASTERISEUR DE RÉFÉRENCE du rendu final (fit + cartel) et hashes `frameHash` / `renderHash`. Lot 8A, docs/LOT_8A_RASTERISEUR_REFERENCE_2026_10_07.md.
//
// Pur, déterministe, sans DOM, sans Redis, sans réseau, sans flottant : toute arithmétique est ENTIÈRE. C'est la SOURCE UNIQUE de ce que `layoutVersion = 1` signifie (contrat gelé :
// docs/SPEC_LOT_7_CARTELS_RENDU_2026_10_07.md § 4-5). Le port C++ (consensus-pod/src/podRender.h) est vérifié contre les vecteurs générés par ce fichier ; les firmwares l'adopteront au lot 8B.
// ⚠ RÉFÉRENCE LOGICIELLE SEULEMENT : jamais essayée sur un écran. `renderHash` désigne le framebuffer LOGIQUE envoyé au pilote, pas les pixels physiquement visibles.
//
// Ce que `layoutVersion = 1` fixe (toute modification d'un de ces points incrémente la version) :
//   • géométrie des bandes et séparateurs (lib/cartelZones.ts : e-ink 2,9″ 0..13 / 114..127 ; 2,7″ 0..13 / 162..175 ; TFT 1,8″ 0..14 / 146..159) ;
//   • police 5×7 (6 colonnes d'avance), 42 glyphes : 0-9, A-Z, « : . - / # » et l'espace — TABLE DE LA R4 (bit 0 = ligne du haut), les autres caractères sont rendus comme l'espace ;
//   • casse (majuscules), repli des accents (table Latin-1 de la R4, tout autre caractère non ASCII → « ? » → espace), contrôles → espace ;
//   • troncature (suppression des derniers caractères), centrage entier (e-ink) ou alignement à gauche (TFT), séparateur « - » entre artiste et titre, texte de repli « PROOF-OF-DRAW » ;
//   • palette du TFT (RGB565 : fond 0x10C4, or 0xFEA0, gris 0x7BEF, blanc 0xFFFF) ; encodage des octets : mêmes conventions que lib/canvasToScreen.ts (e-ink : bit 0 = encré, rotation 90° ; TFT : RGB565 petit-boutiste).
//   • `fit` : transformation au rendu, ratio conservé, centrage, plus proche voisin, ENTIER (voir fitGrid).

import { createHash } from "node:crypto";
import { cartelZonesFor, type CartelZones } from "@/lib/cartelZones";
import { SCREEN_PROFILES, type ScreenId } from "@/lib/screenProfiles";

export const LAYOUT_VERSION = 1;
export const CARTEL_MODES = ["overlay", "fit", "hidden"] as const;
export type CartelMode = (typeof CARTEL_MODES)[number];

/** Métadonnées du cartel (octets UTF-8 tels que le serveur les envoie dans `cartelMeta`). */
export interface RenderMeta { ts: Uint8Array; blockIndex: number; artist: Uint8Array; title: Uint8Array }

// e-ink : 0 = blanc, 1 = noir, 2 = rouge ; TFT : RGB565 ; la grille est toujours LOGIQUE (canvas paysage / portrait du profil), ligne par ligne.
export type Grid = Uint16Array;
export const WHITE = 0, BLACK = 1, RED = 2;
export const T_DARK = 0x10c4, T_GOLD = 0xfea0, T_GREY = 0x7bef, T_WHITE = 0xffff, T_BLACK = 0x0000;

export const isEink = (s: ScreenId) => s === "eink29bwr" || s === "eink27bw";
export const planeCount = (s: ScreenId) => (s === "eink29bwr" ? 2 : 1);
export const dimsOf = (s: ScreenId) => ({ w: SCREEN_PROFILES[s].width, h: SCREEN_PROFILES[s].height });
/** Octets d'un plan (tel qu'envoyé au pilote). */
export const planeBytes = (s: ScreenId) => { const { w, h } = dimsOf(s); return s === "oled096" ? 1024 : isEink(s) ? (w * h) / 8 : w * h * 2; };

// ─── Encodage / décodage pilote ⇄ grille logique (mêmes conventions que lib/canvasToScreen.ts, vérifiées par test) ─────────────────────────────────────────────────────────────
/** Décode les plans reçus (e-ink et TFT seulement). e-ink : bit 0 du plan noir = noir, bit 0 du plan rouge = rouge (le rouge l'emporte). */
export function decodeGrid(screen: ScreenId, planes: readonly Uint8Array[]): Grid {
  const { w, h } = dimsOf(screen), g = new Uint16Array(w * h);
  if (isEink(screen)) {
    const bpr = h / 8;   // octets par ligne du pilote (portrait : 128/8 = 16 ; 176/8 = 22)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bufCol = h - 1 - y, idx = x * bpr + (bufCol >> 3), bit = 7 - (bufCol & 7);
      const black = !((planes[0][idx] >> bit) & 1), red = planes.length > 1 && !((planes[1][idx] >> bit) & 1);
      g[y * w + x] = red ? RED : black ? BLACK : WHITE;
    }
  } else if (screen === "tft18" || screen === "tft28") {
    for (let i = 0; i < w * h; i++) g[i] = planes[0][2 * i] | (planes[0][2 * i + 1] << 8);
  } else throw new Error(`${screen} : pas de cartel gravé, pas de décodage`);
  return g;
}

export function encodeGrid(screen: ScreenId, g: Grid): Uint8Array[] {
  const { w, h } = dimsOf(screen);
  if (isEink(screen)) {
    const bpr = h / 8, black = new Uint8Array(bpr * w).fill(0xff), red = new Uint8Array(bpr * w).fill(0xff);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = g[y * w + x]; if (v === WHITE) continue;
      const bufCol = h - 1 - y, idx = x * bpr + (bufCol >> 3), mask = (~(1 << (7 - (bufCol & 7)))) & 0xff;
      if (v === RED) red[idx] &= mask; else black[idx] &= mask;
    }
    return screen === "eink29bwr" ? [black, red] : [black];
  }
  if (screen === "tft18" || screen === "tft28") {
    const b = new Uint8Array(w * h * 2);
    for (let i = 0; i < w * h; i++) { b[2 * i] = g[i] & 0xff; b[2 * i + 1] = g[i] >> 8; }
    return [b];
  }
  throw new Error(`${screen} : pas de cartel gravé, pas d'encodage`);
}

// ─── Texte : repli des accents, casse, glyphes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Table Latin-1 (U+00C0..U+00FF) de la R4 : un caractère ASCII par lettre accentuée (× → « * », ÷ → « / », Þ → « T », ß → « s »). */
const L1 = "AAAAAAACEEEEIIIIDNOOOOO*OUUUUYTsaaaaaaaceeeeiiiidnooooo/ouuuuyty";

/** UTF-8 → ASCII, MAJUSCULES. Algorithme figé (identique à `asciiFold` de la R4 + `toUpperCase`) : ASCII imprimable conservé, contrôles → espace, « Ã+0x80..0xBF » → table Latin-1, tout autre caractère multi-octets → UN « ? »
 *  (ses octets de continuation sont sautés), octet de continuation isolé → ignoré. */
export function foldText(utf8: Uint8Array): string {
  let out = "";
  for (let i = 0; i < utf8.length; i++) {
    const c = utf8[i];
    if (c < 0x80) { out += c >= 32 && c < 127 ? String.fromCharCode(c) : " "; continue; }
    if (c === 0xc3 && i + 1 < utf8.length) { const d = utf8[++i]; out += d >= 0x80 && d < 0xc0 ? L1[d - 0x80] : "?"; continue; }
    if (c >= 0xc0) { out += "?"; while (i + 1 < utf8.length && (utf8[i + 1] & 0xc0) === 0x80) i++; }
  }
  return out.replace(/[a-z]/g, (m) => m.toUpperCase());
}

/** Police 5×7, TABLE DE LA R4 (arduino_uno_r4/pod_uno_r4_eink29) : une colonne = un octet, bit 0 = ligne du HAUT. Indices : 0-9, A-Z (10..35), « : » 36, « . » 37, « - » 38, « / » 39, espace 40, « # » 41. */
export const FONT_5X7: readonly (readonly number[])[] = [
  [0x3E,0x51,0x49,0x45,0x3E],[0x00,0x42,0x7F,0x40,0x00],[0x42,0x61,0x51,0x49,0x46],
  [0x21,0x41,0x45,0x4B,0x31],[0x18,0x14,0x12,0x7F,0x10],[0x27,0x45,0x45,0x45,0x39],
  [0x3C,0x4A,0x49,0x49,0x30],[0x01,0x71,0x09,0x05,0x03],[0x36,0x49,0x49,0x49,0x36],
  [0x06,0x49,0x49,0x29,0x1E],[0x7C,0x12,0x11,0x12,0x7C],[0x7F,0x49,0x49,0x49,0x36],
  [0x3E,0x41,0x41,0x41,0x22],[0x7F,0x41,0x41,0x22,0x1C],[0x7F,0x49,0x49,0x49,0x41],
  [0x7F,0x09,0x09,0x09,0x01],[0x3E,0x41,0x49,0x49,0x7A],[0x7F,0x08,0x08,0x08,0x7F],
  [0x00,0x41,0x7F,0x41,0x00],[0x20,0x40,0x41,0x3F,0x01],[0x7F,0x08,0x14,0x22,0x41],
  [0x7F,0x40,0x40,0x40,0x40],[0x7F,0x02,0x0C,0x02,0x7F],[0x7F,0x04,0x08,0x10,0x7F],
  [0x3E,0x41,0x41,0x41,0x3E],[0x7F,0x09,0x09,0x09,0x06],[0x3E,0x41,0x51,0x21,0x5E],
  [0x7F,0x09,0x19,0x29,0x46],[0x46,0x49,0x49,0x49,0x31],[0x01,0x01,0x7F,0x01,0x01],
  [0x3F,0x40,0x40,0x40,0x3F],[0x1F,0x20,0x40,0x20,0x1F],[0x3F,0x40,0x38,0x40,0x3F],
  [0x63,0x14,0x08,0x14,0x63],[0x07,0x08,0x70,0x08,0x07],[0x61,0x51,0x49,0x45,0x43],
  [0x00,0x36,0x36,0x00,0x00],[0x00,0x60,0x60,0x00,0x00],[0x08,0x08,0x08,0x08,0x08],
  [0x02,0x01,0x02,0x04,0x02],[0x00,0x00,0x00,0x00,0x00],[0x14,0x7F,0x14,0x7F,0x14],
];
export const glyphIndex = (c: string): number => {
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
  if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 65 + 10;
  if (c === ":") return 36; if (c === ".") return 37; if (c === "-") return 38; if (c === "/") return 39; if (c === "#") return 41;
  return 40;   // espace et tout caractère sans glyphe
};
export const ADVANCE = 6;

function drawText(g: Grid, w: number, x: number, y: number, text: string, color: number) {
  for (let i = 0; i < text.length; i++) {
    const glyph = FONT_5X7[glyphIndex(text[i])];
    for (let col = 0; col < 5; col++) for (let row = 0; row < 7; row++) {
      if (!((glyph[col] >> row) & 1)) continue;
      const px = x + i * ADVANCE + col, py = y + row;
      if (px >= 0 && px < w && py >= 0 && py < g.length / w) g[py * w + px] = color;
    }
  }
}

// ─── Lignes du cartel ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const FALLBACK_TEXT = "PROOF-OF-DRAW";
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** Ligne du haut e-ink : date (ou repli) puis « #N » ; tronquée à ⌊(W−4)/6⌋ caractères. */
export function eInkTopLine(m: RenderMeta, w: number): string {
  let top = m.ts.length > 0 ? foldText(m.ts) : FALLBACK_TEXT;
  if (m.blockIndex >= 0) top += " #" + String(m.blockIndex);
  return cut(top, Math.floor((w - 4) / ADVANCE));
}
/** Ligne du bas : « ARTISTE - TITRE », ou l'un des deux, ou le repli ; tronquée à `max` caractères. */
export function bottomLine(m: RenderMeta, max: number): string {
  const a = foldText(m.artist), t = foldText(m.title);
  const line = a.length && t.length ? a + " - " + t : a.length ? a : t;
  return cut(line.length === 0 ? FALLBACK_TEXT : line, max);
}

function fillRows(g: Grid, w: number, y0: number, y1: number, color: number) { for (let y = y0; y <= y1; y++) g.fill(color, y * w, (y + 1) * w); }

/** Grave le cartel PAR-DESSUS la grille (écrase les bandes). Ne fait rien pour un écran sans cartel gravé. */
function burnCartel(screen: ScreenId, g: Grid, m: RenderMeta) {
  const z = cartelZonesFor(screen); if (!z) return;
  const { w, h } = dimsOf(screen);
  if (isEink(screen)) {
    fillRows(g, w, 0, z.top.y1 - 1, WHITE); fillRows(g, w, z.top.y1, z.top.y1, BLACK);                       // bande haute blanchie, séparateur noir à la ligne y1
    const top = eInkTopLine(m, w), maxB = Math.floor((w - 4) / ADVANCE), bot = bottomLine(m, maxB);
    drawText(g, w, Math.max(0, Math.floor((w - top.length * ADVANCE) / 2)), 3, top, BLACK);
    fillRows(g, w, z.bottom.y0, z.bottom.y0, BLACK); fillRows(g, w, z.bottom.y0 + 1, h - 1, WHITE);        // séparateur noir à y0, bande basse blanchie
    drawText(g, w, Math.max(0, Math.floor((w - bot.length * ADVANCE) / 2)), z.bottom.y0 + 3, bot, BLACK);
  } else {   // TFT 1,8″ : bandeau sombre, liseré or, « RESCOE » or à gauche, « #N » gris à droite, ligne du bas blanche alignée à gauche
    fillRows(g, w, 0, z.top.y1 - 1, T_DARK); fillRows(g, w, z.top.y1, z.top.y1, T_GOLD);
    drawText(g, w, 3, 4, "RESCOE", T_GOLD);
    if (m.blockIndex >= 0) { const s = "#" + String(m.blockIndex); drawText(g, w, Math.max(50, w - 3 - s.length * ADVANCE), 4, s, T_GREY); }
    fillRows(g, w, z.bottom.y0, z.bottom.y0, T_GOLD); fillRows(g, w, z.bottom.y0 + 1, h - 1, T_DARK);
    drawText(g, w, 3, z.bottom.y0 + 4, bottomLine(m, Math.floor((w - 6) / ADVANCE)), T_WHITE);
  }
}

/**
 * FIT : l'image entière est ramenée dans les lignes sûres (ratio conservé, centrée, plus proche voisin), le reste est blanc. Arithmétique ENTIÈRE :
 *   hauteur cible hs = lignes sûres ; largeur cible nw = ⌊W·hs / H⌋ ; décalage x0 = ⌊(W − nw)/2⌋ ; y0 = première ligne sûre ;
 *   pixel source : sx = ⌊(2·(x − x0) + 1)·W / (2·nw)⌋ , sy = ⌊(2·(y − y0) + 1)·H / (2·hs)⌋ (centre du pixel de destination).
 */
export function fitGrid(screen: ScreenId, g: Grid): Grid {
  const z = cartelZonesFor(screen)!, { w, h } = dimsOf(screen), white = isEink(screen) ? WHITE : T_WHITE;
  const hs = z.safe.h, nw = Math.floor((w * hs) / h), x0 = Math.floor((w - nw) / 2), y0 = z.safe.y0, out = new Uint16Array(w * h).fill(white);
  for (let y = 0; y < hs; y++) {
    const sy = Math.floor(((2 * y + 1) * h) / (2 * hs));
    for (let x = 0; x < nw; x++) out[(y0 + y) * w + x0 + x] = g[sy * w + Math.floor(((2 * x + 1) * w) / (2 * nw))];
  }
  return out;
}

/** Grille finale. `hidden` : image inchangée, sans cartel ; `overlay` : cartel par-dessus ; `fit` : image ajustée entre les bandes puis cartel. Un écran sans cartel gravé renvoie l'image inchangée quel que soit le mode. */
export function renderGrid(screen: ScreenId, g: Grid, mode: CartelMode, meta: RenderMeta): Grid {
  if (!cartelZonesFor(screen) || mode === "hidden") return Uint16Array.from(g);
  const base = mode === "fit" ? fitGrid(screen, g) : Uint16Array.from(g);
  burnCartel(screen, base, meta);
  return base;
}

// ─── Hashes (domaines GELÉS : docs/SPEC_LOT_7_CARTELS_RENDU_2026_10_07.md § 4) ───────────────────────────────────────────────────────────────────────────────────────────────────
const sha = (parts: Uint8Array[]) => { const h = createHash("sha256"); for (const p of parts) h.update(p); return h.digest("hex"); };
const utf8 = (s: string) => new TextEncoder().encode(s);
export const frameHashOf = (screen: ScreenId, planes: readonly Uint8Array[]): string => {
  const { w, h } = dimsOf(screen);
  return sha([utf8(`pod-frame-v1|${screen}|${w}x${h}|${planes.length}|`), ...planes]);
};
export const renderHashOf = (screen: ScreenId, planes: readonly Uint8Array[], mode: CartelMode, layoutVersion = LAYOUT_VERSION): string => {
  const { w, h } = dimsOf(screen);
  return sha([utf8(`pod-render-v1|${screen}|${w}x${h}|${planes.length}|${layoutVersion}|${mode}|`), ...planes]);
};

export interface RenderResult { planes: Uint8Array[]; frameHash: string; renderHash: string }

/** Rendu complet à partir des plans REÇUS : `frameHash` du buffer reçu, plans finaux, `renderHash` du buffer final. */
export function renderFrame(screen: ScreenId, planes: readonly Uint8Array[], mode: CartelMode, meta: RenderMeta): RenderResult {
  if (planes.length !== planeCount(screen) || planes.some((p) => p.length !== planeBytes(screen))) throw new Error(`${screen} : plans de taille inattendue`);
  const frameHash = frameHashOf(screen, planes);
  const final = cartelZonesFor(screen) && mode !== "hidden" ? encodeGrid(screen, renderGrid(screen, decodeGrid(screen, planes), mode, meta)) : planes.map((p) => Uint8Array.from(p));
  return { planes: final, frameHash, renderHash: renderHashOf(screen, final, mode) };
}

// ─── Motifs de test déterministes (les mêmes dans le port C++) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const PATTERNS = ["white", "full", "border", "limits", "checker", "stripes", "noise", "bwr"] as const;
export type PatternName = (typeof PATTERNS)[number];

/** Mélange 32 bits (identique en C++ : arithmétique modulo 2³²). */
export function hash32(seed: number, x: number, y: number): number {
  let h = (seed + Math.imul(x, 73856093) + Math.imul(y, 19349663)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h = (h ^ (h >>> 12)) >>> 0; h = Math.imul(h, 0x297a2d39) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return h;
}
const TFT_PALETTE = [T_BLACK, T_WHITE, 0xf800, 0x07e0, 0x001f, 0xffe0, 0xf81f, 0x07ff];

export function patternGrid(screen: ScreenId, name: PatternName, seed: number): Grid {
  const { w, h } = dimsOf(screen), z = cartelZonesFor(screen) as CartelZones, g = new Uint16Array(w * h), eink = isEink(screen), bwr = screen === "eink29bwr";
  const white = eink ? WHITE : T_WHITE, black = eink ? BLACK : T_BLACK, accent = eink ? (bwr ? RED : BLACK) : 0xf800;
  g.fill(white);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = white;
    switch (name) {
      case "white": break;
      case "full": v = black; break;
      case "border": v = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? black : white; break;
      case "limits": v = y === z.safe.y0 - 1 || y === z.safe.y0 || y === z.safe.y1 || y === z.safe.y1 + 1 ? black : x === 0 || x === w - 1 || x === (w >> 1) ? accent : white; break;
      case "checker": v = (x + y) & 1 ? black : white; break;
      case "stripes": v = y % 3 === 0 ? black : y % 7 === 3 ? accent : white; break;
      case "noise": { const r = hash32(seed, x, y); v = eink ? (bwr ? r % 3 : r % 2) : TFT_PALETTE[r & 7]; break; }
      case "bwr": { const r = hash32(seed, x, y) % 11; v = eink ? (r < 3 ? black : r < 5 ? accent : white) : r < 3 ? black : r < 5 ? 0xf800 : white; break; }
    }
    g[y * w + x] = v;
  }
  return g;
}

/** Octets d'un écran sans cartel gravé (OLED, TFT 2,8″) : flux pseudo-aléatoire déterministe. */
export function bytesPlane(screen: ScreenId, seed: number): Uint8Array {
  const n = planeBytes(screen), b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = hash32(seed, i, 0) & 0xff;
  return b;
}

// ─── Identité canonique de l'œuvre (`artworkHash`) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type ArtworkSource = "block-content-hash" | "anim-root-v3" | "anim-root-v1" | "ana-declared";
export interface ArtworkIdentity { hash: string | null; source: ArtworkSource | null; reason: string }
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * TABLE de l'`artworkHash` (jamais inventé : une identité absente reste VIDE). Entrées = champs déjà présents dans les blocs :
 *   bloc humain v2 (blockVersion 2)          → `contentHash` (rawHash d'une image fixe, animRoot v3 pour une animation)   — recalculable par un tiers depuis l'image / le clip ;
 *   animation v1 (kind « animation », sans blockVersion) → `anim.root` v1 (SHA-256 des empreintes d'images, délais, boucles, couleurs) — recalculable depuis le clip stocké, domaine DIFFÉRENT du v3 ;
 *   bloc humain v1 / legacy (image fixe)     → AUCUNE : `imageHash` n'est qu'un hash du JSON base64 du tampon d'UN écran, il n'est pas le rawHash voté ; le recalculer exigerait de relire l'image
 *                                              (lecture Redis) et produirait une valeur que personne n'a jamais votée ;
 *   œuvre ANA avec `contentHash` valide       → ce hash, étiqueté « déclaré par ANA » (PoD ne sait pas le recalculer) ;
 *   œuvre ANA sans `contentHash` (anciennes) → AUCUNE : le hash d'un bloc ANA (`blockHash`) identifie la PUBLICATION (sourceId, écran, agent, date), pas le contenu — une révision garde le même hash.
 */
export function artworkIdentity(b: { source?: string; blockVersion?: number; contentHash?: string; kind?: string; rulesVersion?: number; anim?: { root?: string }; anaContentHash?: string }): ArtworkIdentity {
  const none = (reason: string): ArtworkIdentity => ({ hash: null, source: null, reason });
  if (b.source === "ana-agent" || b.anaContentHash !== undefined) {
    return typeof b.anaContentHash === "string" && HEX64.test(b.anaContentHash) ? { hash: b.anaContentHash, source: "ana-declared", reason: "contentHash déclaré par ANA (non recalculable par PoD)" } : none("œuvre ANA sans contentHash valide : le hash du bloc identifie la publication, pas le contenu");
  }
  if (b.blockVersion === 2) {
    if (typeof b.contentHash === "string" && HEX64.test(b.contentHash)) return { hash: b.contentHash, source: b.rulesVersion === 2 ? "anim-root-v3" : "block-content-hash", reason: "contentHash du bloc v2" };
    return none("bloc v2 sans contentHash valide");
  }
  if (b.kind === "animation" && typeof b.anim?.root === "string" && HEX64.test(b.anim.root)) return { hash: b.anim.root, source: "anim-root-v1", reason: "racine d'animation v1 (recalculable depuis le clip)" };
  return none("bloc v1 / legacy : aucune identité canonique recalculable sans relire l'image");
}
