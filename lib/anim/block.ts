// lib/anim/block.ts — une ANIMATION comme candidat au consensus (même pipeline qu'un dessin : candidat → vote signé → bloc miné).
//
// Pur et déterministe (aucun accès Redis) : testable, et recalculable par n'importe qui à partir du clip stocké avec le bloc.
//
//   • Le clip PBC1 (lib/bench/clip.ts, ≤ 9 Ko) est LA source : tout le reste en est dérivé, image par image.
//   • Pour CHAQUE image : empreinte SHA-256 des 1024 octets, et score de complexité (entropie · transitions · RLE, comme un dessin).
//   • Score du candidat = moyenne des scores d'images. C'est ce score que les ESP signent (« deviceId:candidateId:score »), exactement
//     comme pour un dessin : un ESP ne télécharge pas les pixels (tas de 47 Ko), il vote sur `score_server`.
//   • `root` = SHA-256 de (empreintes d'images + délais + boucles + couleurs) : il remplace `imageHash` dans le bloc, donc le hash du
//     bloc — et les signatures des validateurs sur le candidat — couvrent chaque image et le rythme de lecture.
//   • L'affiche (poster) = image au meilleur score, mise au format de l'écran : c'est la frame « statique » diffusée aux écrans qui ne
//     jouent pas d'animation (et aux conversions) ; elle est déduite du clip, jamais fournie par le client.
//
// Écrans qui jouent un clip : tft28 (240×320), tft18 (128×160), oled096 (128×64) — lib/bench/screens.ts.

import { createHash } from "node:crypto";
import { CLIP, clipPixel, clipPlayMs, clipStats, decodeClip, encodeClip, validateClipInput, type ClipInput } from "@/lib/bench/clip";
import { computeComplexity } from "@/lib/crypto";
import type { BenchScreen } from "@/lib/bench/screens";

export type AnimScreen = BenchScreen;

/** Ce que le candidat porte (puis le bloc, dans `chain:anim:{hash}`). */
export interface AnimCandidatePart {
  v: 1;
  clip: string;             // PBC1 en base64
  bytes: number;
  frames: number;
  loops: number;
  playMs: number;
  fg: number;
  bg: number;
  frameHashes: string[];    // SHA-256 hex de chaque image (1024 o)
  frameScores: number[];    // score de complexité de chaque image, 4 décimales
  root: string;             // SHA-256 hex : empreinte de l'animation entière
  posterIndex: number;      // image choisie pour l'affiche
}

/** Résumé porté par le bloc lui-même (léger : ni clip ni empreintes). */
export interface AnimBlockMeta {
  frames: number;
  loops: number;
  playMs: number;
  bytes: number;
  root: string;
}

export interface AnimSubmission {
  part: AnimCandidatePart;
  /** Affiche au format de l'écran (base64), prête pour `payload.buffer`. */
  posterBuffer: string;
  metrics: { entropy: number; transitions: number; rle: number; score: number };
  /** Nombre d'images différentes de la précédente (≥ 1) : tient lieu de « score Proof-of-Draw ». */
  drawScore: number;
}

const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const r4 = (v: number): number => Math.round(v * 10_000) / 10_000;
const delayMsOf = (d: number): number => Math.max(2, Math.min(255, Math.round(d / 10))) * 10;

/** Refus d'une animation sans intérêt : une seule image, images toutes identiques, ou rien de dessiné. */
export function animRefusal(input: ClipInput): string | null {
  if (input.frames.length < 2) return "une animation a au moins 2 images";
  const first = input.frames[0];
  if (input.frames.every((f) => f.every((v, i) => v === first[i]))) return "toutes les images sont identiques";
  if (input.frames.every((f) => f.every((v) => v === 0))) return "rien n'est dessiné";
  return null;
}

/** Pixels 0/1 d'une image 128×64, dans l'ordre ligne par ligne (entrée de computeComplexity). */
function frameToPixels(frame: Uint8Array): Uint8Array {
  const px = new Uint8Array(CLIP.W * CLIP.H);
  for (let y = 0; y < CLIP.H; y++) for (let x = 0; x < CLIP.W; x++) px[y * CLIP.W + x] = clipPixel(frame, x, y);
  return px;
}

const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64");

/**
 * Affiche d'une image pour un écran. Même géométrie que le lecteur de clips du firmware :
 *   oled096  128×64, 1 bit page-major (bit 1 = allumé) · tft18  128×160 RGB565 LE, clip 1:1 centré · tft28  240×320 RGB565 LE, clip ×1,875 centré.
 */
export function posterFor(frame: Uint8Array, screen: AnimScreen, fg: number, bg: number): string {
  if (screen === "oled096") {
    const buf = new Uint8Array(1024);
    for (let y = 0; y < CLIP.H; y++) for (let x = 0; x < CLIP.W; x++) if (clipPixel(frame, x, y)) buf[(y >> 3) * CLIP.W + x] |= 1 << (y & 7);
    return b64(buf);
  }
  const W = screen === "tft28" ? 240 : 128, H = screen === "tft28" ? 320 : 160;
  const aw = screen === "tft28" ? 240 : 128, ah = screen === "tft28" ? 120 : 64;   // zone occupée par le clip
  const ax = (W - aw) >> 1, ay = (H - ah) >> 1;
  const out = new Uint8Array(W * H * 2);
  for (let i = 0; i < W * H; i++) { out[i * 2] = bg & 0xff; out[i * 2 + 1] = bg >> 8; }
  for (let y = 0; y < ah; y++) {
    const sy = Math.floor((y * CLIP.H) / ah);
    for (let x = 0; x < aw; x++) {
      if (!clipPixel(frame, Math.floor((x * CLIP.W) / aw), sy)) continue;
      const o = ((ay + y) * W + ax + x) * 2;
      out[o] = fg & 0xff; out[o + 1] = fg >> 8;
    }
  }
  return b64(out);
}

/** Dérive TOUT d'un clip : c'est la fonction que le serveur rejoue à la soumission, et qu'un tiers peut rejouer pour vérifier un bloc. */
export function buildAnimSubmissionFromClip(bin: Uint8Array, screen: AnimScreen): AnimSubmission {
  const clip = decodeClip(bin);   // refuse tout clip altéré (CRC, structure, retour à l'image 0)
  const input: ClipInput = { frames: clip.frames, delaysMs: clip.delaysMs, loops: clip.loops, fg: clip.fg, bg: clip.bg };
  const refusal = validateClipInput(input) ?? animRefusal(input);
  if (refusal) throw new Error(refusal);
  const stats = clipStats(input);
  if (!stats.fitsDevice) throw new Error(`clip trop gros pour l'appareil : ${stats.bytes} octets (maximum ${CLIP.MAX_CLIP_BYTES})`);

  const perFrame = clip.frames.map((f) => computeComplexity(frameToPixels(f), CLIP.W, CLIP.H));
  const frameHashes = clip.frames.map((f) => sha256Hex(f));
  const frameScores = perFrame.map((m) => r4(m.score));
  const mean = (pick: (m: (typeof perFrame)[number]) => number) => r4(perFrame.reduce((s, m) => s + pick(m), 0) / perFrame.length);
  const metrics = { entropy: mean((m) => m.entropy), transitions: mean((m) => m.transitions), rle: mean((m) => m.rle), score: mean((m) => m.score) };
  const root = sha256Hex(JSON.stringify({ v: 1, frames: frameHashes, delaysMs: clip.delaysMs.map(delayMsOf), loops: clip.loops, fg: clip.fg, bg: clip.bg }));
  const posterIndex = frameScores.reduce((best, s, i) => (s > frameScores[best] ? i : best), 0);

  let changes = 0;
  for (let i = 1; i < clip.frames.length; i++) if (clip.frames[i].some((v, k) => v !== clip.frames[i - 1][k])) changes++;

  return {
    part: {
      v: 1, clip: b64(bin), bytes: bin.length, frames: clip.frames.length, loops: clip.loops,
      playMs: clipPlayMs(clip.delaysMs, clip.loops), fg: clip.fg, bg: clip.bg, frameHashes, frameScores, root, posterIndex,
    },
    posterBuffer: posterFor(clip.frames[posterIndex], screen, clip.fg, clip.bg),
    metrics,
    drawScore: Math.max(1, changes),
  };
}

/** Depuis les images brutes envoyées par l'interface (le serveur ENCODE : l'interface n'est jamais la source de vérité). */
export function buildAnimSubmission(rawInput: ClipInput, screen: AnimScreen): AnimSubmission & { bin: Uint8Array } {
  // Une animation de bloc tourne TOUJOURS en boucle (loops = 0) : le choix de l'auteur sur le nombre de boucles est ignoré, c'est le serveur qui décide.
  const input: ClipInput = { ...rawInput, loops: 0 };
  const invalid = validateClipInput(input) ?? animRefusal(input);
  if (invalid) throw new Error(invalid);
  const bin = encodeClip(input);
  return { ...buildAnimSubmissionFromClip(bin, screen), bin };
}

export const animBlockMeta = (part: AnimCandidatePart): AnimBlockMeta => ({ frames: part.frames, loops: part.loops, playMs: part.playMs, bytes: part.bytes, root: part.root });

/** Forme stockée avec le bloc (`chain:anim:{hash}`, permanente) : de quoi rejouer ET vérifier l'animation. */
export interface AnimBlockDoc {
  v: 1;
  clip: string;
  frameHashes: string[];
  frameScores: number[];
  root: string;
  fg: number;
  bg: number;
  loops: number;
  posterIndex: number;
}
export const animBlockDoc = (p: AnimCandidatePart): AnimBlockDoc => ({
  v: 1, clip: p.clip, frameHashes: p.frameHashes, frameScores: p.frameScores, root: p.root, fg: p.fg, bg: p.bg, loops: p.loops, posterIndex: p.posterIndex,
});

/** Vérification publique d'un document de bloc : recalcule empreintes, scores et racine depuis le clip. null = cohérent. */
export function verifyAnimDoc(doc: AnimBlockDoc, screen: AnimScreen): string | null {
  try {
    const re = buildAnimSubmissionFromClip(new Uint8Array(Buffer.from(doc.clip, "base64")), screen).part;
    if (re.root !== doc.root) return "racine différente";
    if (re.frameHashes.join() !== doc.frameHashes.join()) return "empreintes d'images différentes";
    if (re.frameScores.join() !== doc.frameScores.join()) return "scores d'images différents";
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "clip illisible";
  }
}
