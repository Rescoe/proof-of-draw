// lib/bench/clip.ts — « clip » du banc d'essai d'animation (TFT 2.8" tactile).
//
// Une animation 1 bit au format OLED (128×64) est envoyée sous forme de DIFFÉRENCES : l'image 0 en entier (1024 octets), puis, pour
// chaque image suivante, seulement les octets qui changent par rapport à la précédente (comme on le faisait « à l'ancienne »).
// L'écran garde lui-même l'image N-1 ; le firmware tient en plus une copie 1 Ko de l'image courante pour appliquer les différences.
// Le firmware agrandit ×1,875 (128 → 240 px de large) au centre de l'écran 240×320 : un octet source (8 pixels) = exactement 15 pixels.
//
// Format binaire « PBC1 » (little-endian) — MÊME contrat que arduino_uno_r4/pod_uno_r4/pod_bench.h (testé octet pour octet) :
//   En-tête 20 o : 0..3 "PBC1" · 4 version (1) · 5 largeur (128) · 6 hauteur (64) · 7 drapeaux (0)
//                  8..9 N images (1..64) · 10 boucles (0..100 ; 0 = EN BOUCLE jusqu'à un toucher ou au prochain envoi) · 11 réservé (0) · 12..13 couleur « allumé » RGB565 · 14..15 couleur « éteint » RGB565
//                  16..17 T transitions (= N si N > 1, sinon 0) · 18..19 taille du corps
//   Corps : étape 0 = u8 délai (×10 ms) + 1024 o de l'image 0 (lignes de 16 octets, MSB = pixel de gauche)
//           puis T transitions : u8 délai (×10 ms) · u16 nbRuns · nbRuns × ( u16 décalage · u8 longueur 1..255 · octets )
//           transition i (1 ≤ i < N) → image i ; transition N = RETOUR à l'image 0 (boucle). Le délai est celui de l'image affichée.
//   Pied : CRC32 (u32) de l'en-tête + du corps.
// Lecture : image 0, puis transitions 1..N-1 ; à chaque boucle suivante : transition N (retour) puis 1..N-1 ; la dernière boucle s'arrête sur N-1.

import { crc32 } from "@/lib/scene/package";

export const CLIP = {
  MAGIC: "PBC1",
  VERSION: 1,
  W: 128,
  H: 64,
  ROW_BYTES: 16,
  FRAME_BYTES: 1024,
  HEADER_BYTES: 20,
  MAX_FRAMES: 64,
  MAX_LOOPS: 100,
  MIN_DELAY_MS: 20,
  MAX_DELAY_MS: 2550,
  /** Plafond du clip côté appareil : il tient dans le tas de la R4 (32 Ko de RAM) avec la copie de l'image courante. */
  MAX_CLIP_BYTES: 9216,
  MAX_PLAY_MS: 120_000,
  /** Les trous de ≤ 3 octets identiques sont fondus dans le run voisin (un run coûte 3 octets d'en-tête). */
  MERGE_GAP: 3,
} as const;

export interface ClipInput {
  /** N images de 1024 octets (128×64, 1 bit/pixel, lignes de 16 octets, MSB = pixel de gauche). */
  frames: Uint8Array[];
  /** Temps d'affichage de chaque image, en ms (arrondi à 10 ms, 20..2550). */
  delaysMs: number[];
  loops: number;
  /** Couleurs RGB565 des pixels allumés / éteints. */
  fg: number;
  bg: number;
}

export interface DecodedClip extends ClipInput {
  transitionBytes: number[];   // taille de chaque transition (1..N) — pour les statistiques
}

const delayUnits = (ms: number) => Math.max(2, Math.min(255, Math.round(ms / 10)));

/** Durée de lecture ; `loops = 0` (en boucle) : la durée d'UN tour. */
export function clipPlayMs(delaysMs: number[], loops: number): number {
  return delaysMs.reduce((a, d) => a + delayUnits(d) * 10, 0) * Math.max(1, loops);
}

/** Contrôles communs (serveur ET interface) : retourne un message d'erreur lisible, ou null si le clip est acceptable. */
export function validateClipInput(input: ClipInput): string | null {
  const n = input.frames.length;
  if (n < 1 || n > CLIP.MAX_FRAMES) return `1 à ${CLIP.MAX_FRAMES} images (reçu ${n})`;
  if (input.delaysMs.length !== n) return "un délai par image est requis";
  for (const f of input.frames) if (!(f instanceof Uint8Array) || f.length !== CLIP.FRAME_BYTES) return `chaque image doit faire ${CLIP.FRAME_BYTES} octets`;
  if (!Number.isInteger(input.loops) || input.loops < 0 || input.loops > CLIP.MAX_LOOPS) return `boucles : 0 (en boucle) à ${CLIP.MAX_LOOPS}`;
  for (const c of [input.fg, input.bg]) if (!Number.isInteger(c) || c < 0 || c > 0xffff) return "couleur RGB565 invalide";
  if (input.delaysMs.some((d) => !Number.isFinite(d))) return "délai invalide";
  if (clipPlayMs(input.delaysMs, input.loops) > CLIP.MAX_PLAY_MS) return `durée totale > ${CLIP.MAX_PLAY_MS / 1000} s`;
  return null;
}

/** Runs d'octets différents entre deux images (trous ≤ MERGE_GAP fondus, longueur ≤ 255). */
function diffRuns(prev: Uint8Array, next: Uint8Array): { off: number; len: number }[] {
  const runs: { off: number; len: number }[] = [];
  let i = 0;
  while (i < CLIP.FRAME_BYTES) {
    if (prev[i] === next[i]) { i++; continue; }
    const start = i;
    let end = i + 1;                       // fin exclusive du run
    let j = end;
    while (j < CLIP.FRAME_BYTES && j - end <= CLIP.MERGE_GAP) {
      if (prev[j] !== next[j]) end = j + 1;
      j++;
    }
    i = end;
    for (let o = start; o < end; o += 255) runs.push({ off: o, len: Math.min(255, end - o) });
  }
  return runs;
}

/** Corps du clip (étape 0 + transitions) et taille de chaque transition. Pas de limite de taille ici : sert aussi aux statistiques. */
function buildBody(input: ClipInput): { body: number[]; transitionBytes: number[] } {
  const n = input.frames.length;
  const body: number[] = [];
  const transitionBytes: number[] = [];
  body.push(delayUnits(input.delaysMs[0]));
  for (const b of input.frames[0]) body.push(b);
  const transitions = n > 1 ? n : 0;
  for (let t = 1; t <= transitions; t++) {
    const prev = input.frames[t - 1];
    const next = input.frames[t % n];                   // t = n : retour à l'image 0
    const delay = delayUnits(input.delaysMs[t % n]);
    const runs = diffRuns(prev, next);
    const before = body.length;
    body.push(delay, runs.length & 0xff, runs.length >> 8);
    for (const r of runs) {
      body.push(r.off & 0xff, r.off >> 8, r.len);
      for (let k = 0; k < r.len; k++) body.push(next[r.off + k]);
    }
    transitionBytes.push(body.length - before);
  }
  return { body, transitionBytes };
}

export function encodeClip(input: ClipInput): Uint8Array {
  const err = validateClipInput(input);
  if (err) throw new Error(err);
  const n = input.frames.length;
  const transitions = n > 1 ? n : 0;
  const { body } = buildBody(input);
  if (body.length > 0xffff) throw new Error(`clip trop gros (${body.length} octets, maximum absolu 65 535)`);
  const out = new Uint8Array(CLIP.HEADER_BYTES + body.length + 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = CLIP.MAGIC.charCodeAt(i);
  out[4] = CLIP.VERSION; out[5] = CLIP.W; out[6] = CLIP.H; out[7] = 0;
  dv.setUint16(8, n, true); out[10] = input.loops; out[11] = 0;
  dv.setUint16(12, input.fg, true); dv.setUint16(14, input.bg, true);
  dv.setUint16(16, transitions, true); dv.setUint16(18, body.length, true);
  out.set(body, CLIP.HEADER_BYTES);
  dv.setUint32(CLIP.HEADER_BYTES + body.length, crc32(out.subarray(0, CLIP.HEADER_BYTES + body.length)), true);
  return out;
}

/** Décodeur de RÉFÉRENCE (tests + prévisualisation) : refuse tout clip altéré ou incohérent. */
export function decodeClip(bin: Uint8Array): DecodedClip {
  const fail = (m: string): never => { throw new Error(`clip invalide : ${m}`); };
  if (bin.length < CLIP.HEADER_BYTES + 4) fail("trop court");
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < 4; i++) if (bin[i] !== CLIP.MAGIC.charCodeAt(i)) fail("signature");
  if (bin[4] !== CLIP.VERSION) fail("version");
  if (bin[5] !== CLIP.W || bin[6] !== CLIP.H || bin[7] !== 0 || bin[11] !== 0) fail("dimensions / drapeaux");
  const n = dv.getUint16(8, true), loops = bin[10], transitions = dv.getUint16(16, true), bodyBytes = dv.getUint16(18, true);
  if (n < 1 || n > CLIP.MAX_FRAMES || loops > CLIP.MAX_LOOPS) fail("compteurs");
  if (transitions !== (n > 1 ? n : 0)) fail("transitions");
  if (CLIP.HEADER_BYTES + bodyBytes + 4 !== bin.length) fail("taille");
  if (dv.getUint32(CLIP.HEADER_BYTES + bodyBytes, true) !== crc32(bin.subarray(0, CLIP.HEADER_BYTES + bodyBytes))) fail("CRC");
  let p = CLIP.HEADER_BYTES;
  const end = CLIP.HEADER_BYTES + bodyBytes;
  const delays: number[] = [bin[p] * 10]; p++;
  if (bin[p - 1] < 2) fail("délai");
  const frames: Uint8Array[] = [bin.slice(p, p + CLIP.FRAME_BYTES)]; p += CLIP.FRAME_BYTES;
  const transitionBytes: number[] = [];
  const cur = Uint8Array.from(frames[0]);
  for (let t = 1; t <= transitions; t++) {
    const start = p;
    if (p + 3 > end) fail("transition tronquée");
    const delay = bin[p]; p++;
    if (delay < 2) fail("délai");
    const runs = bin[p] | (bin[p + 1] << 8); p += 2;
    for (let r = 0; r < runs; r++) {
      if (p + 3 > end) fail("run tronqué");
      const off = bin[p] | (bin[p + 1] << 8), len = bin[p + 2]; p += 3;
      if (len < 1 || off + len > CLIP.FRAME_BYTES || p + len > end) fail("run hors image");
      cur.set(bin.subarray(p, p + len), off); p += len;
    }
    transitionBytes.push(p - start);
    if (t < n) { frames.push(Uint8Array.from(cur)); delays.push(delay * 10); }
    else if (!cur.every((v, i) => v === frames[0][i]) || delay * 10 !== delays[0]) fail("le retour ne ramène pas à l'image 0");
  }
  if (p !== end) fail("octets en trop");
  return { frames, delaysMs: delays, loops, fg: dv.getUint16(12, true), bg: dv.getUint16(14, true), transitionBytes };
}

export interface ClipStats {
  bytes: number;
  frames: number;
  playMs: number;
  /** Octets de chaque transition (retour compris) — pour repérer les images « lourdes ». */
  transitionBytes: number[];
  avgTransitionBytes: number;
  maxTransitionBytes: number;
  fitsDevice: boolean;
}

export function clipStats(input: ClipInput): ClipStats {
  const err = validateClipInput(input);
  if (err) throw new Error(err);
  const { body, transitionBytes: tb } = buildBody(input);   // sans limite de taille : on veut aussi chiffrer un clip trop gros
  return {
    bytes: CLIP.HEADER_BYTES + body.length + 4,
    frames: input.frames.length,
    playMs: clipPlayMs(input.delaysMs, input.loops),
    transitionBytes: tb,
    avgTransitionBytes: tb.length ? Math.round(tb.reduce((a, b) => a + b, 0) / tb.length) : 0,
    maxTransitionBytes: tb.length ? Math.max(...tb) : 0,
    fitsDevice: CLIP.HEADER_BYTES + body.length + 4 <= CLIP.MAX_CLIP_BYTES,
  };
}

/** Pixel (x, y) d'une image : 1 = allumé. */
export const clipPixel = (frame: Uint8Array, x: number, y: number): number => (frame[y * CLIP.ROW_BYTES + (x >> 3)] >> (7 - (x & 7))) & 1;
